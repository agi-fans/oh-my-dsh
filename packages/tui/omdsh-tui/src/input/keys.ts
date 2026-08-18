/**
 * Terminal key decoder. Turns raw stdin (legacy CSI, SS3, Kitty CSI-u,
 * modifyOtherKeys) into the same key-id vocabulary oh-my-pi uses:
 * `enter`, `ctrl+a`, `alt+left`, `shift+enter`, …
 * @module @agi-fans/dsh-tui
 */

/** One decoded SGR mouse report (`\x1b[<button;col;rowM`). */
export interface MouseEvent {
  type: 'mouse'
  /** Raw button code (bit 32 = motion, bit 64 = wheel). */
  button: number
  /** 0-based column. */
  col: number
  /** 0-based row. */
  row: number
  /** True for a release report (`m` suffix). */
  release: boolean
  /** Wheel direction: -1 up, 1 down, null when not a wheel event. */
  wheel: -1 | 1 | null
  /** Pointer moved (hover or drag). */
  motion: boolean
  /** Left-button press (not motion, release, or wheel). */
  leftClick: boolean
}

/** One decoded input event. */
export type KeyEvent =
  | { type: 'key'; id: string }
  | { type: 'text'; value: string }
  | { type: 'paste-start' }
  | { type: 'paste-end' }
  | MouseEvent

/** Enable SGR button tracking (wheel + clicks; no motion flood). */
export const MOUSE_TRACKING_ON = '\x1b[?1000h\x1b[?1006h'

/** Disable the modes enabled by {@link MOUSE_TRACKING_ON}. */
export const MOUSE_TRACKING_OFF = '\x1b[?1006l\x1b[?1000l'

const CTRL: Record<number, string> = {
  0x01: 'ctrl+a',
  0x02: 'ctrl+b',
  0x03: 'ctrl+c',
  0x04: 'ctrl+d',
  0x05: 'ctrl+e',
  0x06: 'ctrl+f',
  0x07: 'ctrl+g',
  0x08: 'backspace',
  0x09: 'tab',
  0x0a: 'ctrl+j',
  0x0b: 'ctrl+k',
  0x0c: 'ctrl+l',
  0x0d: 'enter',
  0x0e: 'ctrl+n',
  0x0f: 'ctrl+o',
  0x10: 'ctrl+p',
  0x11: 'ctrl+q',
  0x12: 'ctrl+r',
  0x13: 'ctrl+s',
  0x14: 'ctrl+t',
  0x15: 'ctrl+u',
  0x16: 'ctrl+v',
  0x17: 'ctrl+w',
  0x18: 'ctrl+x',
  0x19: 'ctrl+y',
  0x1a: 'ctrl+z',
  0x1d: 'ctrl+]',
  0x1f: 'ctrl+-',
  0x7f: 'backspace',
}

const CSI_LETTER: Record<string, string> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  Z: 'shift+tab',
}

const CSI_TILDE: Record<number, string> = {
  1: 'home',
  2: 'insert',
  3: 'delete',
  4: 'end',
  5: 'pageUp',
  6: 'pageDown',
}

const KITTY: Record<number, string> = {
  9: 'tab',
  13: 'enter',
  27: 'escape',
  127: 'backspace',
  57399: 'escape',
}

const ALT_SPECIAL: Record<string, string> = {
  '\x7f': 'alt+backspace',
  '\x08': 'alt+backspace',
  '\r': 'alt+enter',
  '\n': 'alt+enter',
  '\x1d': 'ctrl+alt+]',
}

/** Build `ctrl+shift+alt+name` from a CSI modifier parameter (1 = none). */
export function withMods(name: string, modifier: number): string {
  const bits = Math.max(0, modifier - 1)
  const parts: string[] = []
  if (bits & 4) parts.push('ctrl')
  if (bits & 1) parts.push('shift')
  if (bits & 2) parts.push('alt')
  if (bits & 8) parts.push('super')
  if (parts.length === 0) return name
  return `${parts.join('+')}+${name}`
}

function asEvent(id: string): KeyEvent {
  if (id.length === 1 && id >= ' ') return { type: 'text', value: id }
  return { type: 'key', id }
}

function kittyEvent(code: number, modifier: number): KeyEvent {
  const named = KITTY[code]
  if (named !== undefined) return asEvent(withMods(named, modifier))
  if (code >= 32 && code < 127) return asEvent(withMods(String.fromCharCode(code), modifier))
  return { type: 'key', id: withMods(`code${code}`, modifier) }
}

/**
 * Decode one SGR mouse report. `data` is the full CSI including ESC
 * (`\x1b[<64;10;5M`); returns null when the string is not a complete report.
 */
export function parseSgrMouse(data: string): MouseEvent | null {
  const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(data)
  if (match === null) return null
  const button = Number(match[1])
  const col = Number(match[2]) - 1
  const row = Number(match[3]) - 1
  const release = match[4] === 'm'
  const wheel = (button & 64) !== 0 ? ((button & 1) !== 0 ? 1 : -1) as 1 | -1 : null
  const motion = (button & 32) !== 0 && wheel === null
  const leftClick = !release && wheel === null && !motion && (button & 3) === 0
  return { type: 'mouse', button, col, row, release, wheel, motion, leftClick }
}

function parseSgr(body: string): { event: KeyEvent; used: number } | 'partial' | null {
  // body is the CSI payload after '['
  const match = /^<(\d+);(\d+);(\d+)([Mm])/.exec(body)
  if (match !== null) {
    const event = parseSgrMouse('\x1b[' + match[0])
    if (event === null) return null
    return { event, used: 1 + match[0].length }
  }
  if (body.length < 32 && /^<\d*(?:;\d*){0,2}$/.test(body)) return 'partial'
  return null
}

function parseCsi(seq: string): { event: KeyEvent; used: number } | 'partial' | null {
  // seq starts after ESC; first char is '['
  const body = seq.slice(1)
  if (body === '') return 'partial'
  if (body[0] === '<') return parseSgr(body)
  const match = /^(?:(\d+)?(?:;(\d+))?(?:;(\d+))?)?([A-Za-z~u])/.exec(body)
  if (match === null) {
    if (/^[\d;]*$/.test(body) && body.length < 32) return 'partial'
    return null
  }
  const used = 1 + match[0].length
  const p1 = match[1] === undefined || match[1] === '' ? 1 : Number(match[1])
  const p2 = match[2] === undefined || match[2] === '' ? 1 : Number(match[2])
  const p3 = match[3] === undefined || match[3] === '' ? undefined : Number(match[3])
  const cmd = match[4] ?? ''
  if (cmd === 'u') return { event: kittyEvent(p1, p2), used }
  if (cmd === '~') {
    if (p1 === 200) return { event: { type: 'paste-start' }, used }
    if (p1 === 201) return { event: { type: 'paste-end' }, used }
    if (p1 === 27 && p3 !== undefined) {
      return { event: kittyEvent(p3, p2), used }
    }
    const name = CSI_TILDE[p1]
    if (name === undefined) return { event: { type: 'key', id: `csi-${p1}` }, used }
    return { event: asEvent(withMods(name, p2)), used }
  }
  const letter = CSI_LETTER[cmd]
  if (letter === undefined) return { event: { type: 'key', id: `csi-${cmd}` }, used }
  return { event: asEvent(withMods(letter, p2 === 1 && p1 > 1 ? p1 : p2)), used }
}

function parseSs3(seq: string): { event: KeyEvent; used: number } | 'partial' | null {
  const next = seq[1]
  if (next === undefined) return 'partial'
  const letter = CSI_LETTER[next]
  if (letter === undefined) return null
  return { event: asEvent(letter), used: 2 }
}

/**
 * Decode a stdin string into events, leaving an incomplete escape in `rest`.
 */
export function parseKeys(input: string): { events: KeyEvent[]; rest: string } {
  const events: KeyEvent[] = []
  let i = 0
  while (i < input.length) {
    const code = input.charCodeAt(i)
    if (code === 0x1b) {
      const tail = input.slice(i)
      const second = tail[1]
      if (second === undefined) return { events, rest: tail }
      if (second === '[') {
        const parsed = parseCsi(tail.slice(1))
        if (parsed === 'partial') return { events, rest: tail }
        if (parsed === null) {
          i += 1
          continue
        }
        events.push(parsed.event)
        i += 1 + parsed.used
        continue
      }
      if (second === 'O') {
        const parsed = parseSs3(tail.slice(1))
        if (parsed === 'partial') return { events, rest: tail }
        if (parsed === null) {
          i += 1
          continue
        }
        events.push(parsed.event)
        i += 1 + parsed.used
        continue
      }
      const alt = ALT_SPECIAL[second]
      if (alt !== undefined) {
        events.push({ type: 'key', id: alt })
        i += 2
        continue
      }
      if (second >= ' ' && second !== '\x7f') {
        events.push({ type: 'key', id: `alt+${second.toLowerCase()}` })
        i += 2
        continue
      }
      events.push({ type: 'key', id: 'escape' })
      i += 1
      continue
    }
    const ctrl = CTRL[code]
    if (ctrl !== undefined) {
      events.push({ type: 'key', id: ctrl })
      i += 1
      continue
    }
    if (code < 0x20) {
      i += 1
      continue
    }
    // Consume a run of printable text (no ESC / C0).
    let j = i + 1
    while (j < input.length) {
      const next = input.charCodeAt(j)
      if (next < 0x20 || next === 0x1b || next === 0x7f) break
      j += 1
    }
    events.push({ type: 'text', value: input.slice(i, j) })
    i = j
  }
  return { events, rest: '' }
}

/**
 * Turn a leftover incomplete sequence into events when the ESC timeout fires.
 * A lone ESC becomes `escape`; anything else is dropped.
 */
export function flushPending(rest: string): KeyEvent[] {
  if (rest === '\x1b') return [{ type: 'key', id: 'escape' }]
  return []
}
