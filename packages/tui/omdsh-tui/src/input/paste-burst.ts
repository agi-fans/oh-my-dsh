/** Paste detection for legacy terminals; ordinary text and IME commits pass through immediately. */
import type { KeyEvent } from './keys.ts'

export type PasteEmission = KeyEvent | { type: 'paste'; value: string }
const PASTE_WAIT_MS = 25
const ENTER_GUARD_MS = 60
const RAPID_KEY_MS = 6
const BURST_KEYS = 8

export class PasteBurst {
  #text = ''
  #last = Number.NEGATIVE_INFINITY
  #rapidKeys = 0
  #enterUntil = Number.NEGATIVE_INFINITY

  get pending(): boolean { return this.#text !== '' }
  get delay(): number { return PASTE_WAIT_MS }

  clear(): void {
    this.#text = ''
    this.#rapidKeys = 0
    this.#last = Number.NEGATIVE_INFINITY
    this.#enterUntil = Number.NEGATIVE_INFINITY
  }

  flush(now: number, force = false): PasteEmission[] {
    if (!this.pending || (!force && now - this.#last < PASTE_WAIT_MS)) return []
    const event: PasteEmission = { type: 'paste', value: this.#text }
    this.#text = ''
    return [event]
  }

  /** An Enter followed by more text in one read is evidence of a multiline paste. */
  pushBatch(events: readonly KeyEvent[], now: number): PasteEmission[] {
    const plain = events.every(event => event.type === 'text'
      || (event.type === 'key' && ['enter', 'ctrl+j', 'tab'].includes(event.id)))
    const newline = events.findIndex(event => event.type === 'key' && ['enter', 'ctrl+j'].includes(event.id))
    if (plain && newline >= 0 && events.slice(newline + 1).some(event => event.type === 'text')) {
      this.#enterUntil = now + ENTER_GUARD_MS
    }
    return events.flatMap(event => this.push(event, now))
  }

  push(event: KeyEvent, now: number): PasteEmission[] {
    const ready = this.flush(now)
    if (event.type === 'text') {
      const asciiKey = /^[\x20-\x7e]$/u.test(event.value)
      this.#rapidKeys = asciiKey ? (now - this.#last <= RAPID_KEY_MS ? this.#rapidKeys + 1 : 1) : 0
      if (this.#rapidKeys >= BURST_KEYS || [...event.value].length > 1000) this.#enterUntil = now + ENTER_GUARD_MS
      this.#last = now
      if (now <= this.#enterUntil) {
        this.#text += event.value
        this.#enterUntil = now + ENTER_GUARD_MS
        return ready
      }
      return [...ready, event]
    }
    if (event.type === 'key' && ['enter', 'ctrl+j', 'tab'].includes(event.id) && now <= this.#enterUntil) {
      this.#text += event.id === 'tab' ? '\t' : '\n'
      this.#last = now
      this.#enterUntil = now + ENTER_GUARD_MS
      return ready
    }
    const tail = this.flush(now, true)
    this.clear()
    return [...ready, ...tail, event]
  }
}
