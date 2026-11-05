import { Context } from '@deepseek-ai/cordis'
import type { AccountView, AccountDetails } from '@deepseek-ai/dsh-deepseek-account'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TuiPrompt } from '../definition.ts'
import { accountClientMetadata, loginDeepSeekAccount } from '../commands/auth-account.ts'
import { accountSettingsEntry, bindAccountNotices, formatAccountBalance, openAccountSettings } from './account-settings.ts'

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve)) }
const signedIn: AccountView = { status: 'credential-stored', attempt: null, links: { usageUrl: 'https://example.test/usage', topUpUrl: 'https://example.test/top_up' } }
const signedOut: AccountView = { ...signedIn, status: 'signed-out' }
const profile: AccountDetails['profile'] = { status: 'ready', value: { id: null, name: 'Test account', contact: 'a***@example.test' } }
const balance: AccountDetails['balance'] = { status: 'ready', value: [{ currency: 'CNY', balance: '1234.567' }], bonusWallets: [{ currency: 'USD', balance: '0.001' }] }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
function harness(initial = signedIn, language: 'en' | 'zh-CN' = 'en') {
  const ctx = new Context(); contexts.push(ctx)
  let state = initial
  const listeners = new Set<() => void>()
  const account = {
    getState: vi.fn(async () => state),
    getProfile: vi.fn(async (): Promise<AccountDetails['profile'] | null> => profile),
    getBalance: vi.fn(async (): Promise<AccountDetails['balance'] | null> => balance),
    startSignIn: vi.fn(async () => state),
    signOut: vi.fn(async () => { update(signedOut); return state }),
    cancelSignIn: vi.fn(async () => { update(signedOut); return state }),
    watch: async function* (signal: AbortSignal) {
      let dirty = true, wake: (() => void) | undefined
      const changed = () => { dirty = true; wake?.() }
      listeners.add(changed); signal.addEventListener('abort', changed, { once: true })
      try {
        while (!signal.aborted) {
          if (dirty) { dirty = false; yield state }
          else await new Promise<void>(resolve => { wake = resolve })
        }
      } finally { listeners.delete(changed); signal.removeEventListener('abort', changed) }
    },
  }
  const update = (next: AccountView) => { state = next; for (const listener of listeners) listener() }
  let request: TuiPrompt | undefined, answer: ((answer: string | null) => void) | undefined
  const prompt = vi.fn((value: TuiPrompt) => {
    request = value
    return new Promise<string | null>(resolve => {
      const abort = () => resolve(null)
      answer = value => { request?.signal?.removeEventListener('abort', abort); resolve(value) }
      value.signal?.addEventListener('abort', abort, { once: true })
    })
  })
  const notice = vi.fn()
  ctx.provide('deepseekAccount', account as never)
  ctx.provide('tui', { prompt, notice, prefs: () => ({ uiLanguage: language }) } as never)
  const abort = new AbortController()
  return { ctx, account, prompt, notice, update, abort, listeners, request: () => request!, answer: (value: string | null) => answer!(value),
    run: () => openAccountSettings(ctx, abort.signal), detail: () => request!.refreshDocument!(), options: () => request!.refreshOptions!() }
}

describe('account projections and actions', () => {
  it('loads once on entry, displays masked identity and separate wallets, and preserves service strings', async () => {
    const h = harness(), run = h.run(); await flush()
    expect(accountSettingsEntry(h.ctx)[0]?.section).toBe('models')
    expect(h.detail()).toContain('Test account · a***@example.test')
    expect(h.detail()).toContain('Recharge balance: CNY 1,234.56')
    expect(h.detail()).toContain('Bonus balance: USD <0.01')
    expect(h.account.getBalance).toHaveBeenCalledTimes(1)
    expect(balance.value[0]?.balance).toBe('1234.567')
    h.answer(null); await run; await flush(); expect(h.listeners.size).toBe(0)
  })

  it('keeps profile visible while balance loads, reports failure without zero and supports retry', async () => {
    const h = harness(), pending = deferred<AccountDetails['balance']>()
    h.account.getBalance.mockReturnValueOnce(pending.promise)
    const run = h.run(); await flush()
    expect(h.detail()).toContain('Test account'); expect(h.detail()).toContain('Loading balances')
    pending.resolve({ status: 'failed' }); await flush()
    expect(h.detail()).toContain('Could not load balances'); expect(h.detail()).not.toContain('0.00')
    h.answer('refresh'); await flush()
    expect(h.detail()).toContain('CNY 1,234.56'); expect(h.account.signOut).not.toHaveBeenCalled()
    h.answer(null); await run
  })

  it('clears details after external sign-out and ignores a late result from the previous grant', async () => {
    const h = harness(), pending = deferred<AccountDetails['balance']>()
    h.account.getBalance.mockReturnValueOnce(pending.promise)
    const run = h.run(); await flush(); h.update(signedOut); await flush()
    expect(h.detail()).toBe('Signed out')
    expect(h.options().map(row => row.value)).toEqual(['in', 'refresh', 'back'])
    pending.resolve(balance); await flush(); expect(h.detail()).toBe('Signed out')
    h.update(signedIn); await flush(); expect(h.detail()).toContain('Test account')
    h.answer(null); await run
  })

  it('ignores obsolete refreshes and closes without waiting for remote details', async () => {
    const h = harness(), stale = deferred<AccountDetails['balance']>()
    h.account.getBalance.mockReturnValueOnce(stale.promise)
    const run = h.run(); await flush(); h.answer('refresh'); await flush()
    stale.resolve({ status: 'failed' }); await flush(); expect(h.detail()).toContain('CNY 1,234.56')
    const never = deferred<AccountDetails['balance']>(); h.account.getBalance.mockReturnValueOnce(never.promise)
    h.answer('refresh'); await flush(); h.abort.abort(); await run; await flush()
    expect(h.listeners.size).toBe(0)
    never.resolve(balance); await flush(); expect(h.notice).not.toHaveBeenCalled()
  })

  it('shows state read failure without claiming sign-out and retries', async () => {
    const h = harness(); h.account.getState.mockRejectedValueOnce(new Error('private failure'))
    const run = h.run(); await flush()
    // watch may recover the snapshot independently of the failed read.
    expect(h.detail()).not.toContain('private failure')
    h.answer('refresh'); await flush(); expect(h.detail()).toContain('Test account')
    h.answer(null); await run
  })

  it('requires confirmation to sign out and leaves API-key storage untouched', async () => {
    const h = harness(), removeKey = vi.fn(); h.ctx.provide('credentials', { unset: removeKey } as never)
    const run = h.run(); await flush(); h.answer('out'); await flush()
    expect(h.request().title).toBe('Logout from DeepSeek account')
    h.answer('cancel'); await flush(); expect(h.account.signOut).not.toHaveBeenCalled()
    h.answer('out'); await flush(); h.answer('logout'); await flush()
    expect(h.detail()).toBe('Signed out'); expect(h.account.signOut).toHaveBeenCalledTimes(1); expect(removeKey).not.toHaveBeenCalled()
    h.answer(null); await run
  })

  it('cancels the active browser authorization by its provider-owned id', async () => {
    const h = harness({ ...signedOut, attempt: { id: 'attempt' as never, phase: 'waiting-browser' } })
    const run = h.run(); await flush()
    expect(h.options().map(row => row.value)).toContain('cancel-auth')
    h.answer('cancel-auth'); await flush()
    expect(h.account.cancelSignIn).toHaveBeenCalledWith('attempt'); expect(h.detail()).toBe('Signed out')
    h.answer(null); await run
  })

  it('opens only account models and preserves the shared picker’s session-only action', async () => {
    const h = harness(), agent = {} as never, changeSelection = vi.fn()
    const listModels = vi.fn(async () => [{ id: 'v4', name: 'DeepSeek V4' }])
    h.ctx.provide('llm', { listProviders: () => [{ id: 'deepseek-account' }, { id: 'unrelated' }], listModels,
      resolveModelInfo: async () => ({ reasoning: { defaultEffort: 'high' } }) } as never)
    h.ctx.provide('omdshSession', { agent, selection: () => ({ provider: 'unrelated', model: 'x' }), changeSelection } as never)
    const run = h.run(); await flush(); h.answer('use'); await flush()
    expect(h.request().title).toBe('Account models'); expect(listModels).toHaveBeenCalledTimes(1)
    expect(listModels).toHaveBeenCalledWith('deepseek-account')
    const prefix = h.request().actions?.[0]?.valuePrefix
    h.answer(`${prefix}deepseek-account/v4`); await flush()
    expect(changeSelection).toHaveBeenCalledWith(agent, { provider: 'deepseek-account', model: 'v4', reasoningEffort: 'high' }, expect.anything(), { persist: false })
    h.answer(null); await run
  })

  it.each(['en', 'zh-CN'] as const)('uses active UI language for account requests and copy (%s)', async language => {
    const h = harness(signedIn, language), run = h.run(); await flush()
    expect(h.account.getProfile).toHaveBeenCalledWith(expect.objectContaining({ locale: language, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 }))
    expect(h.account.getBalance).toHaveBeenCalledWith(accountClientMetadata(h.ctx))
    expect(h.detail()).toContain(language === 'en' ? 'Recharge balance' : '充值余额')
    h.answer(null); await run
  })

  it('notifies only on live expiry, deduplicates requests, resets on sign-in and disposes subscriptions', async () => {
    const h = harness(signedOut); bindAccountNotices(h.ctx); await flush()
    expect(h.notice).not.toHaveBeenCalled()
    h.ctx.emit('deepseek-account/session-expired'); h.ctx.emit('deepseek-account/model-sign-in-required')
    expect(h.notice).toHaveBeenCalledTimes(1)
    expect(h.notice.mock.calls[0]?.[1]).toEqual({ transient: true })
    h.update(signedIn); await flush(); h.update(signedOut); await flush(); h.ctx.emit('deepseek-account/session-expired')
    expect(h.notice).toHaveBeenCalledTimes(2)
    await h.ctx.fiber.dispose(); await flush(); expect(h.listeners.size).toBe(0)
    h.ctx.emit('deepseek-account/session-expired'); expect(h.notice).toHaveBeenCalledTimes(2)
  })

  it('closes browser authorization automatically on success and releases its subscription', async () => {
    const h = harness(signedOut, 'zh-CN')
    h.ctx.provide('webServer', { protocol: 'http:', host: '127.0.0.1', port: 43210 } as never)
    const pending: AccountView = { ...signedOut, attempt: { id: 'own-attempt' as never, phase: 'waiting-browser', authorizeUrl: 'https://example.test/dsh/authorize' } }
    h.account.startSignIn.mockImplementation(async () => { h.update(pending); return pending })
    const run = loginDeepSeekAccount(h.ctx, { signal: h.abort.signal }, { openBrowser: false }); await flush()
    expect(h.account.startSignIn).toHaveBeenCalledWith(expect.objectContaining({ locale: 'zh-CN' }), 'http://127.0.0.1:43210', 'web')
    expect(h.request().detail).toContain('等待登录回调')
    h.update({ ...signedIn, attempt: { id: 'own-attempt' as never, phase: 'succeeded' } })
    expect(await run).toEqual({ kind: 'success', text: 'Signed in to the DeepSeek account.' })
    await flush(); expect(h.listeners.size).toBe(0); expect(h.account.cancelSignIn).not.toHaveBeenCalled()
  })

  it('cancels only its own authorization after manual confirmation is interrupted', async () => {
    const h = harness(signedOut)
    h.ctx.provide('webServer', { protocol: 'http:', host: '127.0.0.1', port: 43210 } as never)
    const pending: AccountView = { ...signedOut, attempt: { id: 'own-attempt' as never, phase: 'waiting-browser', authorizeUrl: 'https://example.test/dsh/authorize' } }
    h.account.startSignIn.mockImplementation(async () => { h.update(pending); return pending })
    const run = loginDeepSeekAccount(h.ctx, { signal: h.abort.signal }, { openBrowser: false }); await flush()
    h.answer('done'); await flush()
    h.update({ ...signedOut, attempt: { id: 'later-attempt' as never, phase: 'waiting-browser' } })
    h.abort.abort(); await run
    expect(h.account.cancelSignIn).toHaveBeenCalledWith('own-attempt')
    expect(h.account.cancelSignIn).not.toHaveBeenCalledWith('later-attempt')
  })

  it('restarts a failed state subscription when Refresh is selected', async () => {
    const h = harness(), watch = h.account.watch
    let fail = true
    h.account.watch = async function* (signal) {
      if (fail) { fail = false; throw new Error('storage') }
      yield* watch(signal)
    }
    const run = h.run(); await flush()
    expect(h.detail()).toContain('Could not read')
    h.answer('refresh'); await flush(); expect(h.detail()).toContain('Test account')
    h.update(signedOut); await flush(); expect(h.detail()).toBe('Signed out')
    h.answer(null); await run
  })

  it('does not start authorization when the request was cancelled during the state read', async () => {
    const h = harness(signedOut), pending = deferred<AccountView>(); h.account.getState.mockReturnValueOnce(pending.promise)
    h.ctx.provide('webServer', { protocol: 'http:', host: '127.0.0.1', port: 43210 } as never)
    const run = loginDeepSeekAccount(h.ctx, { signal: h.abort.signal }, { openBrowser: false })
    h.abort.abort(); pending.resolve(signedOut); await run
    expect(h.account.startSignIn).not.toHaveBeenCalled()
  })
})

describe('wallet display precision', () => {
  it.each([
    ['0E-16', '0.00'], ['5.0000000000000000', '5.00'], ['.009', '<0.01'], ['.0199', '0.01'],
    ['-0.0001', '-0.01'], ['-1.235', '-1.24'], ['-1.234', '-1.23'], ['-0.9999', '-1.00'],
    ['1.23456e3', '1,234.56'], ['999999999999999999.999', '999,999,999,999,999,999.99'],
    ['1e-100000000', '<0.01'], ['1e100000000', '1e100000000'], ['-0', '0.00'], ['invalid', 'invalid'],
  ])('%s → %s', (raw, formatted) => { expect(formatAccountBalance(raw)).toBe(formatted) })
})
