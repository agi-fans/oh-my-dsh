/** Registration projection missing from Harness 0.2.2-rc.1; execution stays upstream. */
import type { Context } from '@deepseek-ai/cordis'
import WebRuntime, { type WebRuntimeConfig, type WebSearchProvider, type WebFetchProvider } from '@deepseek-ai/dsh-web'
import type { WebSettingsProvider } from '@agi-fans/dsh-tui'

export const Config = WebRuntime.Config

export default class OmdshWebRuntime extends WebRuntime {
  private readonly catalog = { search: new Map<string, WebSearchProvider>(), fetch: new Map<string, WebFetchProvider>() }

  constructor(ctx: Context, config: WebRuntimeConfig) {
    super(ctx, config)
    ctx.provide('omdshWebProviders', { list: () => {
      const rows = (providers: Iterable<WebSearchProvider | WebFetchProvider>): WebSettingsProvider[] => [...providers].map(provider => {
        try { return { id: provider.id, available: provider.available() } }
        catch { return { id: provider.id, available: false } }
      })
      return { search: rows(this.catalog.search.values()), fetch: rows(this.catalog.fetch.values()) }
    } })
  }

  override registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.track(this.catalog.search, provider, () => super.registerSearchProvider(provider))
  }

  override registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.track(this.catalog.fetch, provider, () => super.registerFetchProvider(provider))
  }

  private track<T extends WebSearchProvider | WebFetchProvider>(catalog: Map<string, T>, provider: T, register: () => () => void): () => void {
    const notify = (): void => {
      for (const listener of this.ctx.events.dispatch('emit', ['omdsh/web-providers-changed'])) {
        try { void Promise.resolve(listener()).catch(() => {}) } catch { /* An observer cannot veto registration or disposal. */ }
      }
    }
    const effect = this.ctx.effect(() => {
      const dispose = register()
      catalog.set(provider.id, provider)
      notify()
      return () => {
        dispose()
        if (catalog.get(provider.id) === provider) catalog.delete(provider.id)
        notify()
      }
    })
    return () => void effect()
  }
}
