/**
 * Owns the terminal's capability probe and the modes the session turns on.
 *
 * One query asks for the keyboard protocol, the reported colors and scheme,
 * and DEC mode 2031 support; a trailing device-attributes request is the
 * sentinel every terminal answers, so the probe settles on its reply instead
 * of a timeout. Replies that arrive after settlement — late palette entries,
 * color-scheme pushes — are adopted and coalesced into one `colorsChanged`
 * call per burst.
 * @module @agi-fans/dsh-tui/terminal-session
 */

import { COLOR_QUERY, COLOR_SCHEME_QUERY, mergeColorReply, type TerminalColors } from '../chrome/terminal-colors.ts'
import type { KeyEvent } from '../input/keys.ts'
import { KITTY_KEYBOARD, TerminalModes, type TerminalMode } from './terminal-modes.ts'
import { KEYBOARD_PROTOCOL_QUERY, negotiateKeyboard, type KeyboardProtocol } from './terminal-probe.ts'

/**
 * The one startup probe. The device-attributes request MUST stay last:
 * terminals answer in order, so its reply marks the end of every reply the
 * earlier queries produced.
 */
export const CAPABILITY_QUERY = KEYBOARD_PROTOCOL_QUERY + COLOR_QUERY + COLOR_SCHEME_QUERY + '\x1b[?2031$p' + '\x1b[c'

/** DEC mode 2031 enable/disable, armed only after DECRQM reports support. */
const COLOR_SCHEME_NOTIFY: TerminalMode = { enable: '\x1b[?2031h', disable: '\x1b[?2031l' }

/** How long the startup probe may wait for the DA1 sentinel. */
const DEFAULT_PROBE_TIMEOUT_MS = 200
/** Color replies are coalesced into one colorsChanged call per this window. */
const COLORS_CHANGED_MS = 30
/** A scheme change re-queries the colors after this debounce. */
const SCHEME_REQUERY_MS = 100

export interface TerminalSessionHost {
  write(bytes: string): void
  /** Renderer hooks for per-screen Kitty stacks. */
  alternateActive(): boolean
  setAlternateScreenModes(modes: { enter: string; exit: string }): void
  deferUntilMainScreen(bytes: string): void
  /** Called (coalesced) when reported colors or scheme changed after settlement. */
  colorsChanged(): void
  /** Called exactly once when the startup probe settles (DA1 reply or timeout). */
  probeSettled(): void
}

export class TerminalSession {
  readonly #host: TerminalSessionHost
  readonly #probeTimeoutMs: number
  readonly #modes: TerminalModes
  #colors: TerminalColors = {}
  #keyboardProtocol: KeyboardProtocol | undefined
  #querySent = false
  #settled = false
  #settleNotified = false
  #probeTimer: ReturnType<typeof setTimeout> | undefined
  #colorTimer: ReturnType<typeof setTimeout> | undefined
  #schemeTimer: ReturnType<typeof setTimeout> | undefined
  #disposed = false

  constructor(host: TerminalSessionHost, options?: { probeTimeoutMs?: number }) {
    this.#host = host
    this.#probeTimeoutMs = options?.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
    this.#modes = new TerminalModes(bytes => { host.write(bytes) })
  }

  get colors(): TerminalColors { return this.#colors }
  get keyboardProtocol(): KeyboardProtocol | undefined { return this.#keyboardProtocol }
  get settled(): boolean { return this.#settled }

  /** Write the one-time capability query and arm its deadline. */
  start(): void {
    if (this.#querySent) return
    this.#querySent = true
    this.#host.write(CAPABILITY_QUERY)
    this.#probeTimer = setTimeout(() => {
      this.#probeTimer = undefined
      this.#settle()
    }, this.#probeTimeoutMs)
  }

  setMode(name: string, mode: TerminalMode, on: boolean): void {
    if (on) this.#modes.enable(name, mode)
    else this.#modes.disable(name)
  }

  handOff(): void { this.#modes.handOff() }
  takeBack(): void { this.#modes.takeBack() }
  release(): void { this.#modes.release() }

  /**
   * Consume one decoded event. Returns true for capability replies — color,
   * scheme, keyboard and mode reports — so the caller drops them rather than
   * treating them as input.
   */
  handle(event: KeyEvent): boolean {
    if (event.type === 'color-reply') {
      this.#colors = mergeColorReply(this.#colors, event.reply)
      this.#colorsDirty()
      return true
    }
    if (event.type === 'color-scheme') {
      const previous = this.#colors.scheme
      this.#colors = { ...this.#colors, scheme: event.scheme }
      this.#colorsDirty()
      // A scheme flip after settlement re-queries the palette so quantized
      // colors follow the new polarity; identical reports need nothing.
      if (this.#settled && previous !== event.scheme && this.#schemeTimer === undefined) {
        this.#schemeTimer = setTimeout(() => {
          this.#schemeTimer = undefined
          if (!this.#disposed) this.#host.write(COLOR_QUERY)
        }, SCHEME_REQUERY_MS)
      }
      return true
    }
    if (event.type === 'kitty-flags' || event.type === 'device-attributes') {
      const step = negotiateKeyboard(this.#keyboardProtocol, event)
      if (step.output !== undefined && step.protocol === 'kitty') {
        if (this.#host.alternateActive()) {
          // The overlay owns this Kitty stack; the main screen's push waits
          // for the exit so each buffer sees exactly one.
          this.#modes.adopt('keyboard', KITTY_KEYBOARD)
          this.#host.deferUntilMainScreen(KITTY_KEYBOARD.enable)
        } else {
          this.#modes.enable('keyboard', KITTY_KEYBOARD)
        }
        this.#host.setAlternateScreenModes({ enter: KITTY_KEYBOARD.enable, exit: KITTY_KEYBOARD.disable })
      }
      this.#keyboardProtocol = step.protocol ?? this.#keyboardProtocol
      if (event.type === 'device-attributes' && !this.#settled) this.#settle()
      return true
    }
    if (event.type === 'mode-report') {
      if (event.mode === 2031 && (event.state === 1 || event.state === 2)) {
        this.#modes.enable('color-scheme-notify', COLOR_SCHEME_NOTIFY)
      }
      return true
    }
    return false
  }

  dispose(): void {
    this.#disposed = true
    if (this.#probeTimer !== undefined) clearTimeout(this.#probeTimer)
    if (this.#colorTimer !== undefined) clearTimeout(this.#colorTimer)
    if (this.#schemeTimer !== undefined) clearTimeout(this.#schemeTimer)
    this.#probeTimer = this.#colorTimer = this.#schemeTimer = undefined
    this.#modes.release()
  }

  #settle(): void {
    if (this.#settled) return
    this.#settled = true
    if (this.#probeTimer !== undefined) {
      clearTimeout(this.#probeTimer)
      this.#probeTimer = undefined
    }
    if (this.#settleNotified) return
    this.#settleNotified = true
    // Replies buffered while probing are part of the settled frame, so only
    // changes from here on notify.
    if (this.#colorTimer !== undefined) {
      clearTimeout(this.#colorTimer)
      this.#colorTimer = undefined
    }
    this.#host.probeSettled()
  }

  /** Mark accumulated colors dirty; changes notify only after settlement. */
  #colorsDirty(): void {
    if (!this.#settled || this.#colorTimer !== undefined) return
    this.#colorTimer = setTimeout(() => {
      this.#colorTimer = undefined
      if (!this.#disposed) this.#host.colorsChanged()
    }, COLORS_CHANGED_MS)
  }
}
