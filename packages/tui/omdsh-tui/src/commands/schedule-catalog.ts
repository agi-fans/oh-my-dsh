/** One live, session-scoped projection of the Harness task catalog. */
import type { Context } from '@deepseek-ai/cordis'
import type { ScheduleCatalogEntry } from '@deepseek-ai/dsh-schedule'
import type { SessionId } from '@deepseek-ai/dsh-session'

export function scheduleCatalog(ctx: Context, sessionId: SessionId, signal: AbortSignal) {
  let entries: ScheduleCatalogEntry[] = [], error = false, closed = false, dirty = true, generation = 0
  let pending: Promise<void> | undefined
  const invalidate = (): void => { dirty = true; generation++ }
  const off = ctx.on('schedule/changed', invalidate)
  const refresh = (): Promise<void> => {
    invalidate()
    return read()
  }
  const read = (): Promise<void> => {
    if (pending) return pending
    pending = (async () => {
      while (dirty && !closed && !signal.aborted) {
        dirty = false
        const version = generation
        try {
          const next = await ctx.schedule.catalog()
          if (closed || signal.aborted || version !== generation) continue
          entries = next.filter(entry => entry.involvedSessionIds.includes(sessionId))
          error = false
        } catch {
          if (!closed && !signal.aborted && version === generation) error = true
        }
      }
    })().finally(() => { pending = undefined })
    return pending
  }
  const dispose = (): void => { closed = true; generation++; off(); signal.removeEventListener('abort', dispose) }
  signal.addEventListener('abort', dispose, { once: true })
  return {
    refresh,
    snapshot: () => { if (dirty && !closed && !signal.aborted) void read(); return { entries, error } },
    dispose,
  }
}
