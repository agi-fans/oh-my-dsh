import { describe, expect, it, vi } from 'vitest'
import { cancellable } from './cancellable.ts'
import type { TuiService } from '../definition.ts'

/** A terminal whose prompt settles only when the test says so. */
function harness(options: { interactive?: boolean; answered?: string | null } = {}) {
  const requests: Parameters<TuiService['prompt']>[0][] = []
  let settle: (value: string | null) => void = () => {}
  const prompt = vi.fn(async (request: Parameters<TuiService['prompt']>[0]) => {
    requests.push(request)
    if (options.answered !== undefined) return options.answered
    return new Promise<string | null>(resolve => {
      settle = resolve
      request.signal?.addEventListener('abort', () => resolve(null), { once: true })
    })
  })
  const tui = { prompt, ...(options.interactive === undefined ? {} : { interactive: options.interactive }) } as unknown as TuiService
  return {
    tui,
    requests,
    /** Answer the open surface, as a reader pressing its cancel option would. */
    answer: (value: string | null) => settle(value),
  }
}

const surface = { title: 'Work', question: 'Doing the work', surface: true }

describe('cancellable', () => {
  it('passes a signal that combines the caller and the surface', async () => {
    const h = harness()
    const parent = new AbortController()
    let seen: AbortSignal | undefined
    const outcome = await cancellable(h.tui, surface, parent.signal, async signal => {
      seen = signal
      // Cancel from the surface while the work is running, the way a reader does,
      // and wait for the work to observe it before settling.
      h.answer(null)
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return 'done'
    })
    expect(seen).toBeDefined()
    // The reader cancelled, so the caller learns which event it was.
    expect(outcome?.reason).toBe('cancelled')
  })

  it('does not treat the work finishing as a cancellation', async () => {
    // This is the invariant every hand-written copy needed a second controller
    // for: dismissing the surface because the work ended must not abort the work.
    const h = harness()
    const parent = new AbortController()
    const outcome = await cancellable(h.tui, surface, parent.signal, async () => 'value')
    expect(outcome?.value).toBe('value')
    expect(outcome?.reason).toBeUndefined()
    // The surface was opened once and dismissed once.
    expect(h.requests).toHaveLength(1)
  })

  it('reports a superseding surface separately from a reader cancel', async () => {
    const h = harness()
    const parent = new AbortController()
    const run = cancellable(h.tui, surface, parent.signal, async signal => {
      h.requests[0]?.onSuperseded?.('')
      expect(signal.aborted).toBe(true)
      return 'partial'
    })
    // A superseded surface still returns the partial value; only the reason differs.
    expect((await run)?.reason).toBe('superseded')
  })

  it('exposes the interrupt hook so the surface can stop the work', async () => {
    const h = harness()
    const parent = new AbortController()
    let aborted = false
    const run = cancellable(h.tui, surface, parent.signal, async signal => {
      expect(h.requests[0]?.interrupt?.()).toBe(true)
      aborted = signal.aborted
      return 'stopped'
    })
    await run
    expect(aborted).toBe(true)
  })

  it('runs without a surface when the caller asks for none', async () => {
    const h = harness({ interactive: false })
    const parent = new AbortController()
    const outcome = await cancellable(h.tui, { ...surface, surface: false }, parent.signal, async signal => {
      expect(signal.aborted).toBe(false)
      return 'quiet'
    })
    expect(outcome).toMatchObject({ value: 'quiet', reason: undefined })
    // A pipe has no reader to cancel, so opening a prompt would claim a screen
    // the caller does not own.
    expect(h.requests).toHaveLength(0)
  })

  it('returns undefined when the caller aborted before the work started', async () => {
    const h = harness()
    const parent = new AbortController()
    parent.abort()
    const run = vi.fn(async () => 'never')
    expect(await cancellable(h.tui, surface, parent.signal, run)).toBeUndefined()
    expect(run).not.toHaveBeenCalled()
    expect(h.requests).toHaveLength(0)
  })

  it('does not report a caller abort as a reader cancellation', async () => {
    const h = harness()
    const parent = new AbortController()
    const run = cancellable(h.tui, surface, parent.signal, async signal => {
      parent.abort()
      expect(signal.aborted).toBe(true)
      return 'partial'
    })
    // The reader did not cancel; the caller did. A caller that reports a partial
    // outcome must be able to tell the two apart.
    expect((await run)?.reason).toBeUndefined()
  })

  it('dismisses the surface when the work throws', async () => {
    const h = harness()
    const parent = new AbortController()
    const run = cancellable(h.tui, surface, parent.signal, async () => {
      throw new Error('work failed')
    })
    await expect(run).rejects.toThrow('work failed')
    // The surface is dismissed in `finally`, so a failure never leaves it open.
    expect(h.requests[0]?.title).toBe('Work')
  })

  it('carries the detail and the document refresher to the surface', async () => {
    const h = harness()
    const parent = new AbortController()
    await cancellable(h.tui, {
      ...surface,
      detail: 'What cancelling does',
      presentation: 'document',
      document: () => 'live text',
      cancelLabel: 'Stop',
    }, parent.signal, async () => 'ok')
    const request = h.requests[0]
    expect(request).toMatchObject({
      title: 'Work',
      detail: 'What cancelling does',
      presentation: 'document',
      allowCustom: false,
      notify: false,
      options: [{ label: 'Stop', value: 'cancel' }],
    })
    expect(request?.refreshDocument?.()).toBe('live text')
  })
})
