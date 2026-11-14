/** Browser authorization and shared-grant removal stay owned by the Harness account service. */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { DeepSeekAccount, AccountClientMetadata, AccountView, SignInAttemptView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import { APP_VERSION } from '../session/package-metadata.ts'
import { openExternal } from './open-external.ts'

interface WebServerLike {
  protocol: 'http:' | 'https:'
  host: string
  port: number
}

export function accountClientMetadata(ctx: Context): AccountClientMetadata {
  return {
    version: APP_VERSION,
    locale: resolveUiLanguage(ctx.tui.prefs().uiLanguage),
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

function accountCallbackOrigin(ctx: Context): string | undefined {
  const server = ctx.get('webServer') as WebServerLike | undefined
  if (server === undefined || typeof server.port !== 'number' || server.port === 0) return undefined
  return `${server.protocol}//${server.host}:${server.port}`
}

function accountFailure(attempt: SignInAttemptView | null | undefined): string | undefined {
  if (attempt?.phase === 'expired') return 'The DeepSeek sign-in expired. Run /login to try again.'
  if (attempt?.phase === 'failed') return `DeepSeek sign-in failed${attempt.errorCode === undefined ? '' : ` (${attempt.errorCode})`}. Run /login to try again.`
  if (attempt?.phase === 'cancelled') return 'DeepSeek sign-in was cancelled.'
  return undefined
}

async function waitForAccount(invocation: Pick<CommandInvocation, 'signal'>, account: DeepSeekAccount, id: SignInAttemptId, timeoutMs: number): Promise<CommandResult> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (invocation.signal.aborted) {
      await account.cancelSignIn(id).catch(() => undefined)
      return { kind: 'success' }
    }
    const state = await account.getState().catch(() => undefined)
    if (state === undefined) {
      await new Promise(resolve => setTimeout(resolve, 400))
      continue
    }
    if (state.attempt?.id !== id) return { kind: 'success' }
    if (state.status === 'credential-stored' && state.attempt.phase === 'succeeded') {
      return { kind: 'success', text: 'Signed in to the DeepSeek account.' }
    }
    const failure = accountFailure(state?.attempt)
    if (failure !== undefined) return { kind: 'error', text: failure }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  await account.cancelSignIn(id).catch(() => undefined)
  return { kind: 'error', text: 'DeepSeek sign-in timed out before the browser completed. Run /login to try again.' }
}

export async function loginDeepSeekAccount(ctx: Context, invocation: Pick<CommandInvocation, 'signal'>, config: { openBrowser?: boolean } = {}): Promise<CommandResult> {
  const account = ctx.get('deepseekAccount')
  if (account === undefined) return { kind: 'error', text: 'DeepSeek account integration is not mounted in this build.' }
  let state: AccountView
  try {
    state = await account.getState()
  } catch {
    return { kind: 'error', text: 'Could not read the shared DeepSeek account state.' }
  }

  if (invocation.signal.aborted || state.status === 'credential-stored') return { kind: 'success' }

  const server = ctx.get('webServer') as WebServerLike | undefined
  if (server === undefined || ctx.tui.interactive === false) {
    return {
      kind: 'error',
      text: 'The loopback sign-in host is unavailable. Start omdsh with its normal terminal host, or sign in through DSH Web/Desktop and rerun /login.',
    }
  }
  const origin = accountCallbackOrigin(ctx)
  if (origin === undefined) return { kind: 'error', text: 'The loopback sign-in host did not expose a port.' }

  let initial: AccountView
  try {
    initial = await account.startSignIn(accountClientMetadata(ctx), origin, 'web')
  } catch {
    return { kind: 'error', text: 'Could not start DeepSeek sign-in.' }
  }
  const attempt = initial.attempt
  if (invocation.signal.aborted) {
    if (attempt) await account.cancelSignIn(attempt.id).catch(() => undefined)
    return { kind: 'success' }
  }
  if (initial.status === 'credential-stored') return { kind: 'success', text: 'Signed in to the DeepSeek account.' }
  if (attempt === null) return { kind: 'error', text: 'Could not start DeepSeek sign-in.' }
  const failure = accountFailure(attempt)
  if (failure !== undefined) return { kind: 'error', text: failure }
  let url = attempt?.authorizeUrl
  for (let i = 0; i < 40 && url === undefined; i += 1) {
    if (invocation.signal.aborted) break
    await new Promise(resolve => setTimeout(resolve, 100))
    const next = await account.getState().catch(() => undefined)
    if (next !== undefined && next.attempt?.id !== attempt.id) return { kind: 'success' }
    if (next?.status === 'credential-stored') return { kind: 'success', text: 'Signed in to the DeepSeek account.' }
    const nextFailure = accountFailure(next?.attempt)
    if (nextFailure !== undefined) return { kind: 'error', text: nextFailure }
    url = next?.attempt?.authorizeUrl
  }
  if (url === undefined || invocation.signal.aborted) {
    await account.cancelSignIn(attempt.id).catch(() => undefined)
    if (invocation.signal.aborted) return { kind: 'success' }
    return { kind: 'error', text: 'DeepSeek did not return a browser URL for this sign-in attempt.' }
  }

  if (config.openBrowser !== false) openExternal(url)
  const browser = new AbortController()
  const browserSignal = AbortSignal.any([invocation.signal, browser.signal])
  let completed: AccountView | undefined
  void (async () => {
    try {
      for await (const update of account.watch(browserSignal)) {
        if (browserSignal.aborted) break
        const next = update.state
        if (next.attempt?.id !== attempt.id || next.status === 'credential-stored' || accountFailure(next.attempt)) {
          completed = next
          browser.abort()
          break
        }
      }
    } catch { /* Manual confirmation still works if the subscription fails. */ }
  })()
  let answer: string | null
  try {
    answer = await ctx.tui.prompt({ localize: true,
      title: 'DeepSeek account',
      question: 'Complete sign-in in your browser, then return here.',
      detail: `${url}\n\n${uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), 'This terminal is listening on {origin}/oauth/callback until the attempt ends.', { origin })}`,
      options: [
        { label: 'I completed sign-in', value: 'done' },
        { label: 'Cancel', value: 'cancel', description: 'Withdraw this sign-in attempt.' },
      ],
      initialValue: 'done',
      allowCustom: false,
      notify: false,
      signal: browserSignal,
    })
  } finally { browser.abort() }
  if (completed && !invocation.signal.aborted) {
    if (completed.status === 'credential-stored') return { kind: 'success', text: 'Signed in to the DeepSeek account.' }
    const failure = accountFailure(completed.attempt)
    return failure === undefined ? { kind: 'success' } : { kind: 'error', text: failure }
  }
  if (answer !== 'done' || invocation.signal.aborted) {
    await account.cancelSignIn(attempt.id).catch(() => undefined)
    return { kind: 'success', text: 'DeepSeek sign-in cancelled.' }
  }
  return waitForAccount(invocation, account, attempt.id, 120_000)
}

export async function logoutDeepSeekAccount(ctx: Context, invocation: Pick<CommandInvocation, 'signal'>): Promise<CommandResult> {
  const account = ctx.get('deepseekAccount')
  if (account === undefined) return { kind: 'error', text: 'DeepSeek account integration is not mounted in this build.' }
  let state: AccountView
  try {
    state = await account.getState()
  } catch {
    return { kind: 'error', text: 'Could not read the shared DeepSeek account state.' }
  }
  if (state.status !== 'credential-stored') {
    return { kind: 'success', text: 'No DeepSeek account grant is stored.' }
  }
  const answer = await ctx.tui.prompt({ localize: true,
    title: 'Logout from DeepSeek account',
    question: 'Sign out of the shared DeepSeek account?',
    detail: 'Removes the local grant and revokes it in the background. The browser session is not signed out.',
    options: [
      { label: 'Cancel', value: 'cancel', description: 'Keep the account grant.' },
      { label: 'Sign out', value: 'logout', description: 'Remove the local grant and revoke it in the background.' },
    ],
    initialValue: 'cancel',
    allowCustom: false,
    notify: false,
    signal: invocation.signal,
  })
  if (answer !== 'logout' || invocation.signal.aborted) return { kind: 'success' }
  try {
    await account.signOut(accountClientMetadata(ctx))
  } catch {
    return { kind: 'error', text: 'Could not sign out of the DeepSeek account. Try again from DSH Web/Desktop.' }
  }
  return { kind: 'success', text: 'Signed out of the DeepSeek account. The local grant was removed; remote revocation continues in the background.' }
}
