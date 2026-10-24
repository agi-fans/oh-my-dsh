/**
 * Terminal modes the TUI turns on, owned in one place so they are always
 * given back.
 *
 * Every mode is a pair of sequences. The controller remembers which modes are
 * on, in the order they were turned on, and gives them all back — in reverse —
 * when the terminal is handed to someone else (`Ctrl+Z`, an external editor),
 * when the session ends, or when the process exits without disposing. Taking
 * the terminal back re-enables the same set. A mode added or removed while the
 * terminal is handed off is recorded and applied on the way back, so no caller
 * has to know whether the terminal is currently ours.
 * @module @agi-fans/dsh-tui/terminal-modes
 */

import { KITTY_PROTOCOL_OFF, KITTY_PROTOCOL_ON } from './terminal-probe.ts'

/** One reversible terminal mode. */
export interface TerminalMode {
  readonly enable: string
  readonly disable: string
}

/** Bracketed paste (DEC 2004). */
export const BRACKETED_PASTE: TerminalMode = { enable: '\x1b[?2004h', disable: '\x1b[?2004l' }
/** Focus in/out reports (DEC 1004). */
export const FOCUS_REPORTING: TerminalMode = { enable: '\x1b[?1004h', disable: '\x1b[?1004l' }
/** Button, drag and wheel reports in SGR encoding (DEC 1000, 1002, 1006). */
export const MOUSE_TRACKING: TerminalMode = {
  enable: '\x1b[?1000h\x1b[?1002h\x1b[?1006h',
  disable: '\x1b[?1006l\x1b[?1002l\x1b[?1000l',
}
/** One entry on the Kitty keyboard stack with the disambiguate flag. */
export const KITTY_KEYBOARD: TerminalMode = { enable: KITTY_PROTOCOL_ON, disable: KITTY_PROTOCOL_OFF }

/** Named modes, applied in insertion order and given back in reverse. */
export class TerminalModes {
  readonly #write: (bytes: string) => void
  readonly #active = new Map<string, TerminalMode>()
  #handedOff = false

  constructor(write: (bytes: string) => void) {
    this.#write = write
  }

  /** Whether the terminal is currently handed to another program. */
  get handedOff(): boolean { return this.#handedOff }

  /** Whether `name` is on (or will be on once the terminal is taken back). */
  has(name: string): boolean { return this.#active.has(name) }

  /** Turn one mode on; a mode that is already on is left alone. */
  enable(name: string, mode: TerminalMode): void {
    if (this.#active.has(name)) return
    this.#active.set(name, mode)
    if (!this.#handedOff) this.#write(mode.enable)
  }

  /** Record a mode as on without writing, for a push deferred to another screen. */
  adopt(name: string, mode: TerminalMode): void {
    if (!this.#active.has(name)) this.#active.set(name, mode)
  }

  /** Turn one mode off; a mode that is not on is left alone. */
  disable(name: string): void {
    const mode = this.#active.get(name)
    if (mode === undefined) return
    this.#active.delete(name)
    if (!this.#handedOff) this.#write(mode.disable)
  }

  /** Give every mode back, keeping the set, before another program owns the terminal. */
  handOff(): void {
    if (this.#handedOff) return
    this.#handedOff = true
    this.#write(this.#disableAll())
  }

  /** Re-enable the recorded set once the terminal is ours again. */
  takeBack(): void {
    if (!this.#handedOff) return
    this.#handedOff = false
    this.#write([...this.#active.values()].map(mode => mode.enable).join(''))
  }

  /** Give every mode back for good. Safe to call more than once. */
  release(): void {
    const bytes = this.#handedOff ? '' : this.#disableAll()
    this.#active.clear()
    this.#handedOff = false
    if (bytes !== '') this.#write(bytes)
  }

  #disableAll(): string {
    return [...this.#active.values()].reverse().map(mode => mode.disable).join('')
  }
}
