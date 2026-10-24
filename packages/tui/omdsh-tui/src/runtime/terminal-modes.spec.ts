import { describe, expect, it } from 'vitest'
import { BRACKETED_PASTE, FOCUS_REPORTING, KITTY_KEYBOARD, MOUSE_TRACKING, TerminalModes } from './terminal-modes.ts'

function setup(): { modes: TerminalModes; out: () => string } {
  let written = ''
  return { modes: new TerminalModes(bytes => { written += bytes }), out: () => written }
}

describe('TerminalModes', () => {
  it('enables each mode once and disables it once', () => {
    const { modes, out } = setup()
    modes.enable('paste', BRACKETED_PASTE)
    modes.enable('paste', BRACKETED_PASTE)
    modes.disable('paste')
    modes.disable('paste')
    expect(out()).toBe('\x1b[?2004h\x1b[?2004l')
  })

  it('hands every mode back in reverse order and takes the same set back', () => {
    const { modes, out } = setup()
    modes.enable('paste', BRACKETED_PASTE)
    modes.enable('focus', FOCUS_REPORTING)
    modes.enable('keyboard', KITTY_KEYBOARD)
    const enabled = out()
    modes.handOff()
    expect(out().slice(enabled.length)).toBe('\x1b[<u\x1b[?1004l\x1b[?2004l')
    const handed = out()
    modes.takeBack()
    expect(out().slice(handed.length)).toBe('\x1b[?2004h\x1b[?1004h\x1b[>1u')
  })

  it('records changes made while handed off and applies them on the way back', () => {
    const { modes, out } = setup()
    modes.enable('focus', FOCUS_REPORTING)
    modes.handOff()
    const handed = out()
    modes.enable('mouse', MOUSE_TRACKING)
    modes.disable('focus')
    // Nothing reaches a terminal another program owns.
    expect(out()).toBe(handed)
    modes.takeBack()
    expect(out().slice(handed.length)).toBe(MOUSE_TRACKING.enable)
  })

  it('releases once, and not again after a hand-off already gave everything back', () => {
    const { modes, out } = setup()
    modes.enable('keyboard', KITTY_KEYBOARD)
    modes.release()
    modes.release()
    expect(out()).toBe('\x1b[>1u\x1b[<u')

    const second = setup()
    second.modes.enable('keyboard', KITTY_KEYBOARD)
    second.modes.handOff()
    second.modes.release()
    expect(second.out()).toBe('\x1b[>1u\x1b[<u')
    expect(second.modes.has('keyboard')).toBe(false)
  })

  it('keeps every push and pop balanced through any hand-off sequence', () => {
    const { modes, out } = setup()
    modes.enable('keyboard', KITTY_KEYBOARD)
    for (let round = 0; round < 3; round += 1) {
      modes.handOff()
      modes.handOff()
      modes.takeBack()
      modes.takeBack()
    }
    modes.release()
    const pushes = out().split('\x1b[>1u').length - 1
    const pops = out().split('\x1b[<u').length - 1
    expect(pushes).toBe(4)
    expect(pops).toBe(pushes)
  })
})
