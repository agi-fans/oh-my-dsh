/**
 * Keyboard protocol negotiation: whether to speak the Kitty keyboard protocol,
 * and the sequences that ask for it and give it back.
 *
 * The query only asks (`CSI ? u`) and never changes the terminal's state; the
 * primary device-attributes request that follows is answered by every
 * terminal, so it marks the end of the round trip. A terminal that reports
 * Kitty flags gets exactly one push of the disambiguate flag; the session's
 * mode registry pops it on hand-off and exit and pushes it again on resume. A
 * terminal that answers only the device attributes keeps its legacy encoding.
 * @module @agi-fans/dsh-tui/terminal-probe
 */

import type { KeyEvent } from '../input/keys.ts'

/** Ask for the current Kitty flags, then the device attributes as a sentinel. Changes nothing. */
export const KEYBOARD_PROTOCOL_QUERY = '\x1b[?u\x1b[c'
/** Push Kitty flag 1 (disambiguate escape codes) for this session. */
export const KITTY_PROTOCOL_ON = '\x1b[>1u'
/** Pop the one Kitty entry this session pushed. */
export const KITTY_PROTOCOL_OFF = '\x1b[<u'

/** The protocol a session settled on; absent while negotiating or when the terminal offers none. */
export type KeyboardProtocol = 'kitty'

/** One step of the negotiation. */
export interface NegotiationStep {
  protocol?: KeyboardProtocol
  /** The enable sequence the caller must write, at most once per session. */
  output?: string
  /** True once the terminal has answered enough for the choice to be final. */
  settled: boolean
}

/**
 * Advance the negotiation with one decoded event.
 * @param protocol - what the session currently speaks, if anything.
 * @param event - the decoded input event.
 * @returns the next protocol, any sequence to write, and whether the choice is final.
 */
export function negotiateKeyboard(protocol: KeyboardProtocol | undefined, event: KeyEvent): NegotiationStep {
  if (protocol !== undefined) return { protocol, settled: true }
  // Any flags report, zero included, proves the terminal implements the
  // protocol; the reported value is only what is enabled right now.
  if (event.type === 'kitty-flags') return { protocol: 'kitty', output: KITTY_PROTOCOL_ON, settled: true }
  // The sentinel arrived without a flags report: keep the legacy encoding.
  if (event.type === 'device-attributes') return { settled: true }
  return { settled: false }
}
