/** Bounded, paused snapshots over the Harness's newest-relative scrollback pages. */

import type { TerminalReadRequest, TerminalReadResult } from '@deepseek-ai/dsh-terminal'
import type { TuiDocumentSource } from '../definition.ts'

const PAGE_LINES = 300
const OVERLAP_LINES = 20
const MAX_LINES = 10_000
const MAX_BYTES = 4 * 1024 * 1024

export class TerminalReader {
  readonly #read: (request: TerminalReadRequest) => TerminalReadResult
  #page: TerminalReadResult | undefined
  #lines: string[] = []
  #firstLine = 1
  #note = ''
  #source: TuiDocumentSource | undefined

  constructor(read: (request: TerminalReadRequest) => TerminalReadResult) { this.#read = read }

  /** Following returns the latest page; pausing keeps the exact text already displayed. */
  refresh(following: boolean): TuiDocumentSource {
    if (following || this.#page === undefined) {
      const page = this.#read({ offset: 0, count: PAGE_LINES })
      if (page.text !== this.#page?.text || page.totalLines !== this.#page.totalLines || page.lineEnd !== this.#page.lineEnd
        || page.truncated !== this.#page.truncated || this.#note !== '') this.#source = undefined
      this.#page = page
      this.#lines = page.lineEnd === page.lineBegin ? [] : page.text.split('\n')
      this.#note = ''
      const bytes = Buffer.from(page.text)
      if (bytes.length > MAX_BYTES) {
        this.#lines = bytes.subarray(bytes.length - MAX_BYTES).toString('utf8').split('\n')
        this.#page = { ...page, lineEnd: page.lineBegin + this.#lines.length }
        this.#note = 'Reader limit: 4 MiB; leading text clipped'
      }
      this.#firstLine = Math.max(1, page.totalLines - this.#page.lineEnd + 1)
    }
    return this.#document()
  }

  /** Prepend an older page only when its overlap still identifies this frozen snapshot. */
  loadEarlier(): number {
    if (this.#page === undefined) this.refresh(false)
    const snapshot = this.#page!
    if (this.#lines.length >= MAX_LINES) return this.#stop('Reader limit: 10,000 lines')
    if (this.#firstLine <= 1) return this.#stop('No earlier retained output')
    const newest = this.#read({ offset: 0, count: 1 })
    const overlap = Math.min(OVERLAP_LINES, this.#lines.length)
    const offset = newest.totalLines - snapshot.totalLines + snapshot.lineEnd - overlap
    if (newest.totalLines < snapshot.totalLines || offset < 0) return this.#expired()
    const older = this.#read({ offset, count: Math.min(PAGE_LINES, MAX_LINES - this.#lines.length) + overlap })
    const lines = older.lineEnd === older.lineBegin ? [] : older.text.split('\n')
    // A capped scrollback can rotate without changing totalLines. Never splice
    // pages merely because their numeric offsets happen to line up.
    if (older.totalLines !== newest.totalLines || lines.length <= overlap
      || lines.slice(-overlap).some((line, at) => line !== this.#lines[at])) return this.#expired()
    const prefix = lines.slice(0, -overlap)
    const next = [...prefix, ...this.#lines]
    if (Buffer.byteLength(next.join('\n')) > MAX_BYTES) return this.#stop('Reader limit: 4 MiB')
    this.#lines = next
    this.#firstLine = Math.max(1, this.#firstLine - prefix.length)
    this.#page = older
    this.#note = ''
    this.#source = undefined
    return prefix.length
  }

  #expired(): number {
    return this.#stop('History changed or was clipped; End refreshes the latest output')
  }

  #stop(note: string): number {
    if (this.#note !== note) this.#source = undefined
    this.#note = note
    return 0
  }

  #document(): TuiDocumentSource {
    if (this.#source !== undefined) return this.#source
    const status = (this.#note === '' ? '' : `${this.#note} · `) + `${this.#lines.length} loaded`
      + (this.#page?.truncated === true ? ' · Retention clipped' : '')
    // The source renderer removes one terminator; keep a real empty final PTY
    // line so registry offsets and the reader's source rows remain identical.
    const text = this.#lines.length === 0 ? '' : this.#lines.join('\n') + '\n'
    this.#source = { text, firstLine: this.#firstLine, status }
    return this.#source
  }
}
