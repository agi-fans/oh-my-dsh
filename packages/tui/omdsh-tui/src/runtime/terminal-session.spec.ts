import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLOR_QUERY } from '../chrome/terminal-colors.ts'
import type { KeyEvent } from '../input/keys.ts'
import { CAPABILITY_QUERY, TerminalSession, type TerminalSessionHost } from './terminal-session.ts'

interface FakeHost {
  host: TerminalSessionHost
  writes: string[]
  deferred: string[]
  altModes: { enter: string; exit: string }[]
  colorsChanged: number
  probeSettled: number
  setAlt(active: boolean): void
}

function fakeHost(): FakeHost {
  let alt = false
  const state: FakeHost = {
    writes: [],
    deferred: [],
    altModes: [],
    colorsChanged: 0,
    probeSettled: 0,
    setAlt(active: boolean) { alt = active },
    host: {
      write: bytes => { state.writes.push(bytes) },
      alternateActive: () => alt,
      setAlternateScreenModes: modes => { state.altModes.push(modes) },
      deferUntilMainScreen: bytes => { state.deferred.push(bytes) },
      colorsChanged: () => { state.colorsChanged += 1 },
      probeSettled: () => { state.probeSettled += 1 },
    },
  }
  return state
}

const DA1: KeyEvent = { type: 'device-attributes' }
const out = (state: FakeHost): string => state.writes.join('')

describe('TerminalSession', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('writes one query that opens with the Kitty probe and ends with the DA1 sentinel', () => {
    const state = fakeHost()
    const session = new TerminalSession(state.host)
    session.start()
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0]).toBe(CAPABILITY_QUERY)
    expect(CAPABILITY_QUERY.startsWith('\x1b[?u')).toBe(true)
    expect(CAPABILITY_QUERY.endsWith('\x1b[c')).toBe(true)
    session.start()
    expect(state.writes).toHaveLength(1)
  })

  it('settles on the DA1 reply exactly once, ignoring a late second reply', () => {
    const state = fakeHost()
    const session = new TerminalSession(state.host)
    session.start()
    session.handle(DA1)
    expect(state.probeSettled).toBe(1)
    session.handle(DA1)
    vi.advanceTimersByTime(500)
    expect(state.probeSettled).toBe(1)
  })

  it('settles after the probe timeout and swallows the late DA1', () => {
    const state = fakeHost()
    const session = new TerminalSession(state.host)
    session.start()
    vi.advanceTimersByTime(200)
    expect(state.probeSettled).toBe(1)
    session.handle(DA1)
    expect(state.probeSettled).toBe(1)
  })

  it('buffers color replies before settlement and coalesces later bursts into one colorsChanged', () => {
    const state = fakeHost()
    const session = new TerminalSession(state.host)
    session.start()
    const reply: KeyEvent = { type: 'color-reply', reply: { target: 'background', color: { r: 1, g: 2, b: 3 } } }
    session.handle(reply)
    session.handle(reply)
    vi.advanceTimersByTime(100)
    expect(state.colorsChanged).toBe(0)
    session.handle(DA1)
    session.handle(reply)
    session.handle(reply)
    vi.advanceTimersByTime(30)
    expect(state.colorsChanged).toBe(1)
    expect(session.colors.background).toEqual({ r: 1, g: 2, b: 3 })
  })

  it('writes the Kitty push directly when no alternate screen is active', () => {
    const state = fakeHost()
    const session = new TerminalSession(state.host)
    session.start()
    session.handle({ type: 'kitty-flags', flags: 0 })
    expect(out(state)).toContain('\x1b[>1u')
    expect(state.deferred).toHaveLength(0)
    expect(state.altModes).toEqual([{ enter: '\x1b[>1u', exit: '\x1b[<u' }])
    session.release()
    expect(out(state)).toContain('\x1b[<u')
  })

  it('defers the Kitty push to the main screen while an overlay holds the alternate buffer', () => {
    const state = fakeHost()
    state.setAlt(true)
    const session = new TerminalSession(state.host)
    session.start()
    session.handle({ type: 'kitty-flags', flags: 1 })
    expect(out(state)).not.toContain('\x1b[>1u')
    expect(state.deferred).toEqual(['\x1b[>1u'])
    expect(state.altModes).toEqual([{ enter: '\x1b[>1u', exit: '\x1b[<u' }])
    // The mode is recorded as on, so release still pops it.
    session.release()
    expect(out(state)).toContain('\x1b[<u')
  })

  it('enables color-scheme notifications after DECRQM reports support and releases them', () => {
    const state = fakeHost()
    const session = new TerminalSession(state.host)
    session.start()
    session.handle({ type: 'mode-report', mode: 2031, state: 2 })
    expect(out(state)).toContain('\x1b[?2031h')
    session.release()
    expect(out(state)).toContain('\x1b[?2031l')
  })

  it('ignores DECRPM reports that deny support or name another mode', () => {
    const state = fakeHost()
    const session = new TerminalSession(state.host)
    session.start()
    const written = state.writes.length
    session.handle({ type: 'mode-report', mode: 2031, state: 0 })
    session.handle({ type: 'mode-report', mode: 2004, state: 1 })
    expect(state.writes).toHaveLength(written)
  })

  it('re-queries colors 100ms after a scheme flip post-settlement, but not for a repeat report', () => {
    const state = fakeHost()
    const session = new TerminalSession(state.host)
    session.start()
    session.handle(DA1)
    session.handle({ type: 'color-scheme', scheme: 'light' })
    vi.advanceTimersByTime(100)
    const afterFlip = out(state)
    expect(afterFlip).toContain(COLOR_QUERY)
    const count = afterFlip.split(COLOR_QUERY).length - 1
    session.handle({ type: 'color-scheme', scheme: 'light' })
    vi.advanceTimersByTime(200)
    expect(out(state).split(COLOR_QUERY).length - 1).toBe(count)
  })

  it('leaves unhandled events for the application', () => {
    const state = fakeHost()
    const session = new TerminalSession(state.host)
    session.start()
    expect(session.handle({ type: 'key', id: 'ctrl+a' })).toBe(false)
    expect(session.handle({ type: 'text', value: 'x' })).toBe(false)
    expect(session.handle({ type: 'color-reply', reply: { target: 'foreground' } })).toBe(true)
  })

  it('dispose clears timers and gives every mode back', () => {
    const state = fakeHost()
    const session = new TerminalSession(state.host)
    session.start()
    session.setMode('probe-x', { enable: '\x1b[?1h', disable: '\x1b[?1l' }, true)
    session.dispose()
    expect(out(state)).toContain('\x1b[?1l')
    session.handle({ type: 'color-reply', reply: { target: 'background', color: { r: 0, g: 0, b: 0 } } })
    vi.advanceTimersByTime(1000)
    expect(state.colorsChanged).toBe(0)
    // The probe timer was cleared, so nothing settles after dispose.
    expect(state.probeSettled).toBe(0)
  })
})
