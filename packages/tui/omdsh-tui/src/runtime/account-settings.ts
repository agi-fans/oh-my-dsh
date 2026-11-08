/** Account UI consumes safe Harness projections; grants and request lifetimes stay in the provider. */
import type { Context } from '@deepseek-ai/cordis'
import type { AccountDetails, AccountView } from '@deepseek-ai/dsh-deepseek-account'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { TuiPrompt } from '../definition.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import { accountClientMetadata, loginDeepSeekAccount, logoutDeepSeekAccount } from '../commands/auth-account.ts'
import { openModelPicker } from '../commands/model.ts'

const text = (ctx: Context, source: string): string => uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), source)
const running = (state: AccountView | undefined): boolean => ['initializing', 'waiting-browser', 'exchanging', 'committing'].includes(state?.attempt?.phase ?? '')

/** Decimal arithmetic keeps Platform precision, including scientific notation and sub-cent balances. */
export function formatAccountBalance(raw: string): string {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/iu.exec(raw)
  if (match === null || !(match[2] || match[3])) return raw
  const digits = (match[2]! + (match[3] ?? '')).replace(/^0+/u, '')
  if (digits === '') return '0.00'
  const negative = match[1] === '-'
  const shift = Number(match[4] ?? 0) - (match[3]?.length ?? 0) + 2
  // Do not allocate unbounded strings for an extreme, but syntactically valid, exponent.
  if (digits.length + shift > 1_000) return raw
  let cents: bigint
  if (shift >= 0) cents = BigInt(digits + '0'.repeat(shift))
  else {
    const point = digits.length + shift
    cents = point > 0 ? BigInt(digits.slice(0, point)) : 0n
    if (negative && point >= 0 && Number(digits[point] ?? 0) >= 5) cents += 1n
  }
  if (cents === 0n) {
    if (!negative) return '<0.01'
    cents = 1n
  }
  const amount = cents.toString().padStart(3, '0')
  return `${negative ? '-' : ''}${amount.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${amount.slice(-2)}`
}

export function accountSettingsEntry(ctx: Context) {
  return ctx.get('deepseekAccount') === undefined ? [] : [{ id: 'account:deepseek', label: 'DeepSeek account', section: 'models' as const, subgroup: 'Accounts and API keys', fields: [],
    description: 'Manage DeepSeek sign-in, profile and wallet balances shared with DSH.', summary: 'Manage' }]
}

function report(ctx: Context, result: CommandResult, signal: AbortSignal): void {
  if (!signal.aborted && result.text) ctx.tui.notice(text(ctx, result.text), { level: result.kind === 'error' ? 'error' : 'info', transient: true })
}

export async function openAccountSettings(ctx: Context, signal: AbortSignal, config: { signIn?: boolean; openBrowser?: boolean } = {}): Promise<void> {
  const account = ctx.get('deepseekAccount')
  if (account === undefined || signal.aborted) return
  const lifetime = new AbortController()
  const live = AbortSignal.any([signal, lifetime.signal])
  let state: AccountView | undefined, stateFailed = false, generation = 0
  let profile: AccountDetails['profile'] | null | undefined, balance: AccountDetails['balance'] | null | undefined
  let cachedOptions: NonNullable<TuiPrompt['options']> = [], optionsKey = ''
  const accept = (next: AccountView): void => {
    const version = ++generation
    state = next; stateFailed = false; profile = undefined; balance = undefined
    if (next.status !== 'credential-stored') return
    const client = accountClientMetadata(ctx)
    const current = (): boolean => !live.aborted && version === generation
    // Independent outcomes keep a slow balance request from hiding the profile.
    void account.getProfile(client).catch(() => ({ status: 'failed' as const })).then(value => { if (current()) profile = value })
    void account.getBalance(client).catch(() => ({ status: 'failed' as const })).then(value => { if (current()) balance = value })
  }
  const reload = async (): Promise<void> => {
    const version = ++generation
    profile = undefined; balance = undefined
    try {
      const next = await account.getState()
      if (!live.aborted && version === generation) accept(next)
    } catch {
      if (!live.aborted && version === generation) { state = undefined; stateFailed = true }
    }
  }
  const details = (): string => {
    const t = (source: string): string => text(ctx, source)
    if (stateFailed) return t('Could not read the shared DeepSeek account state.')
    if (state === undefined) return t('Loading account…')
    if (state.status !== 'credential-stored') return t(running(state) ? 'Browser authorization is in progress.' : 'Signed out')
    const identity = profile === undefined ? t('Loading profile…') : profile?.status === 'ready'
      ? [profile.value.name, profile.value.contact].filter(Boolean).join(' · ') || t('Profile has no display name or contact.')
      : t('Could not load the profile. Refresh to retry.')
    const wallets = balance === undefined ? [t('Loading balances…')] : balance?.status === 'ready'
      ? [
        ...balance.value.map(wallet => `${t('Recharge balance')}: ${wallet.currency} ${formatAccountBalance(wallet.balance)}`),
        ...balance.bonusWallets.map(wallet => `${t('Bonus balance')}: ${wallet.currency} ${formatAccountBalance(wallet.balance)}`),
        ...(balance.value.length + balance.bonusWallets.length === 0 ? [t('No wallets returned.')] : []),
      ] : [t('Could not load balances. Refresh to retry.')]
    return [t('Signed in · shared with DSH'), identity, ...wallets].join('\n')
  }
  const options = (): NonNullable<TuiPrompt['options']> => {
    const t = (source: string): string => text(ctx, source)
    const key = `${resolveUiLanguage(ctx.tui.prefs().uiLanguage)}:${state?.status}:${running(state)}`
    if (key === optionsKey) return cachedOptions
    optionsKey = key
    cachedOptions = [
      ...(state?.status === 'credential-stored' ? [
        { label: t('Use account route'), value: 'use', description: t('Choose an account model') },
        { label: t('Sign out'), value: 'out' },
      ] : state === undefined ? [] : running(state) ? [
        { label: t('Continue sign-in'), value: 'in' },
        { label: t('Cancel authorization'), value: 'cancel-auth' },
      ] : [{ label: t('Sign in'), value: 'in' }]),
      { label: t('Refresh'), value: 'refresh' }, { label: t('Back'), value: 'back' },
    ]
    return cachedOptions
  }
  let watching = false
  const subscribe = (): void => {
    if (watching || live.aborted) return
    watching = true
    const initialSnapshot = JSON.stringify(state)
    void (async () => {
      let initial = true
      try {
        for await (const next of account.watch(live)) {
          if (live.aborted) break
          // watch includes an initial snapshot; do not query details twice just for subscribing.
          const sameInitial = initial && JSON.stringify(next) === initialSnapshot
          initial = false
          if (!sameInitial) accept(next)
        }
      } catch {
        if (!live.aborted) { ++generation; state = undefined; profile = undefined; balance = undefined; stateFailed = true }
      } finally { watching = false }
    })()
  }
  try {
    await reload()
    if (live.aborted) return
    if (config.signIn && state?.status === 'signed-out') {
      report(ctx, await loginDeepSeekAccount(ctx, { signal: live }, config), live)
      await reload()
    }
    if (live.aborted) return
    subscribe()
    while (!live.aborted) {
      const action = await ctx.tui.prompt({ localize: ['title', 'question', 'actions'], title: 'DeepSeek account', question: 'Manage the account shared with DSH',
        detail: details(), refreshDocument: details, options: options(), refreshOptions: options, allowCustom: false, notify: false, signal: live })
      if (action == null || action === 'back' || live.aborted) return
      if (action === 'refresh') { await reload(); subscribe(); continue }
      try {
        // Recheck the service before acting on a row whose displayed snapshot may be stale.
        const latest = await account.getState()
        if (live.aborted) return
        if (action === 'in' && latest.status !== 'credential-stored') report(ctx, await loginDeepSeekAccount(ctx, { signal: live }, config), live)
        if (action === 'out' && latest.status === 'credential-stored') report(ctx, await logoutDeepSeekAccount(ctx, { signal: live }), live)
        if (action === 'cancel-auth' && running(latest) && latest.attempt) await account.cancelSignIn(latest.attempt.id)
        if (action === 'use' && latest.status === 'credential-stored') {
          const session = ctx.get('omdshSession'), agent = session?.agent
          if (agent === undefined || ctx.get('llm') === undefined) ctx.tui.notice(text(ctx, 'Account models are unavailable in this session.'), { transient: true })
          else report(ctx, await openModelPicker(ctx, { agent, signal: live }, false, 'deepseek-account'), live)
        }
      } catch {
        if (!live.aborted) ctx.tui.notice(text(ctx, 'Could not complete the account action. Refresh and retry.'), { level: 'error', transient: true })
      }
      await reload()
      subscribe()
    }
  } finally {
    lifetime.abort()
    // Closing the page never waits for a remote profile or balance request.
  }
}

/** Only live service events notify; snapshots and replay never produce expiry messages. */
export function bindAccountNotices(ctx: Context): void {
  const account = ctx.get('deepseekAccount')
  if (account === undefined) return
  ctx.effect(() => {
    const lifetime = new AbortController()
    let notified = false, previous: AccountView['status'] | undefined
    const notify = (source: string): void => {
      if (notified || lifetime.signal.aborted) return
      notified = true
      ctx.tui.notice(text(ctx, source), { transient: true })
    }
    const off = [
      ctx.on('deepseek-account/session-expired', () => { notify('DeepSeek sign-in expired. Sign in again from Settings → DeepSeek account.') }),
      ctx.on('deepseek-account/model-sign-in-required', () => { notify('This model requires a DeepSeek account. Sign in from Settings → DeepSeek account.') }),
    ]
    void (async () => {
      try {
        for await (const state of account.watch(lifetime.signal)) {
          if (lifetime.signal.aborted) break
          if (state.status === 'credential-stored' && previous === 'signed-out') notified = false
          previous = state.status
        }
      } catch { /* The account page owns state-read failures, not a background notification. */ }
    })()
    return () => { lifetime.abort(); off.forEach(dispose => dispose()) }
  }, 'DeepSeek account live notices')
}
