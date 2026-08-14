import { describe, expect, it } from 'vitest'
import { flushPending, parseKeys, parseSgrMouse, withMods } from './keys.ts'

describe('parseKeys', () => {
  it('decodes printable text and emacs control keys', () => {
    expect(parseKeys('ab').events).toEqual([{ type: 'text', value: 'ab' }])
    expect(parseKeys('\x01').events).toEqual([{ type: 'key', id: 'ctrl+a' }])
    expect(parseKeys('\x05').events).toEqual([{ type: 'key', id: 'ctrl+e' }])
    expect(parseKeys('\x17').events).toEqual([{ type: 'key', id: 'ctrl+w' }])
    expect(parseKeys('\x0b').events).toEqual([{ type: 'key', id: 'ctrl+k' }])
    expect(parseKeys('\x15').events).toEqual([{ type: 'key', id: 'ctrl+u' }])
    expect(parseKeys('\x19').events).toEqual([{ type: 'key', id: 'ctrl+y' }])
    expect(parseKeys('\x0a').events).toEqual([{ type: 'key', id: 'ctrl+j' }])
    expect(parseKeys('\r').events).toEqual([{ type: 'key', id: 'enter' }])
    expect(parseKeys('\x7f').events).toEqual([{ type: 'key', id: 'backspace' }])
    expect(parseKeys('\x04').events).toEqual([{ type: 'key', id: 'ctrl+d' }])
    expect(parseKeys('\x1a').events).toEqual([{ type: 'key', id: 'ctrl+z' }])
    expect(parseKeys('\x1f').events).toEqual([{ type: 'key', id: 'ctrl+-' }])
    expect(parseKeys('\x0f').events).toEqual([{ type: 'key', id: 'ctrl+o' }])
  })

  it('decodes arrows, home/end, delete, and modified CSI', () => {
    expect(parseKeys('\x1b[A').events).toEqual([{ type: 'key', id: 'up' }])
    expect(parseKeys('\x1b[1;5D').events).toEqual([{ type: 'key', id: 'ctrl+left' }])
    expect(parseKeys('\x1b[1;3C').events).toEqual([{ type: 'key', id: 'alt+right' }])
    expect(parseKeys('\x1b[3~').events).toEqual([{ type: 'key', id: 'delete' }])
    expect(parseKeys('\x1b[5~').events).toEqual([{ type: 'key', id: 'pageUp' }])
    expect(parseKeys('\x1b[6~').events).toEqual([{ type: 'key', id: 'pageDown' }])
    expect(parseKeys('\x1b[1;2A').events).toEqual([{ type: 'key', id: 'shift+up' }])
    expect(parseKeys('\x1b[H').events).toEqual([{ type: 'key', id: 'home' }])
    expect(parseKeys('\x1b[F').events).toEqual([{ type: 'key', id: 'end' }])
    expect(parseKeys('\x1bOA').events).toEqual([{ type: 'key', id: 'up' }])
  })

  it('decodes alt letters, alt+enter, and kitty/modifyOtherKeys enter', () => {
    expect(parseKeys('\x1bb').events).toEqual([{ type: 'key', id: 'alt+b' }])
    expect(parseKeys('\x1b\r').events).toEqual([{ type: 'key', id: 'alt+enter' }])
    expect(parseKeys('\x1b\x7f').events).toEqual([{ type: 'key', id: 'alt+backspace' }])
    expect(parseKeys('\x1bl').events).toEqual([{ type: 'key', id: 'alt+l' }])
    expect(parseKeys('\x1b[13;2u').events).toEqual([{ type: 'key', id: 'shift+enter' }])
    expect(parseKeys('\x1b[27;2;13~').events).toEqual([{ type: 'key', id: 'shift+enter' }])
  })

  it('decodes bracketed paste markers', () => {
    expect(parseKeys('\x1b[200~hello\x1b[201~').events).toEqual([
      { type: 'paste-start' },
      { type: 'text', value: 'hello' },
      { type: 'paste-end' },
    ])
  })

  it('decodes SGR mouse wheel and holds a partial report', () => {
    expect(parseKeys('\x1b[<64;10;5M').events).toEqual([
      {
        type: 'mouse',
        button: 64,
        col: 9,
        row: 4,
        release: false,
        wheel: -1,
        motion: false,
        leftClick: false,
      },
    ])
    expect(parseKeys('\x1b[<65;1;1M').events[0]).toMatchObject({ type: 'mouse', wheel: 1 })
    expect(parseKeys('\x1b[<0;4;8M').events[0]).toMatchObject({ type: 'mouse', wheel: null, leftClick: true })
    expect(parseKeys('\x1b[<0;4;8m').events[0]).toMatchObject({ type: 'mouse', release: true, leftClick: false })
    expect(parseKeys('\x1b[<64;10')).toEqual({ events: [], rest: '\x1b[<64;10' })
    expect(parseSgrMouse('\x1b[<64;10;5M')?.wheel).toBe(-1)
    expect(parseSgrMouse('x')).toBe(null)
  })

  it('holds a lone ESC as rest and flushes it as escape', () => {
    expect(parseKeys('\x1b')).toEqual({ events: [], rest: '\x1b' })
    expect(flushPending('\x1b')).toEqual([{ type: 'key', id: 'escape' }])
  })
})

describe('withMods', () => {
  it('maps CSI modifier bits the way xterm/kitty do', () => {
    expect(withMods('left', 1)).toBe('left')
    expect(withMods('left', 2)).toBe('shift+left')
    expect(withMods('left', 3)).toBe('alt+left')
    expect(withMods('left', 5)).toBe('ctrl+left')
    expect(withMods('enter', 2)).toBe('shift+enter')
  })
})
