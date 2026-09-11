/** Non-TTY line input and incremental transcript printing. */

import { createInterface, type Interface } from 'node:readline'
import type { TuiPrompt, TuiSubmission } from '../definition.ts'
import type { Block } from '../views/event-views.ts'
import { blockLines } from '../views/event-views.ts'
import { createTheme } from '../chrome/theme.ts'
import type { TerminalLike } from './provider-local.ts'

export type PendingRead = {
  resolve: (submission: TuiSubmission | null) => void
  signal?: AbortSignal | null
  /** Detaches this read's abort listener once the read settles. */
  offAbort?: () => void
}

export interface PlainTuiDeps {
  readonly term: TerminalLike
  /** Transcript blocks, read live so `print()` always flushes the newest tail. */
  blocks(): readonly Block[]
  /** The in-flight human prompt's request, if one is waiting on an answer. */
  promptRequest(): TuiPrompt | undefined
  /** Resolve the in-flight prompt; the provider owns prompt bookkeeping. */
  finishPrompt(answer: string | null): void
}

/**
 * Pipe-mode counterpart of the TTY reader: a readline queue that buffers lines
 * until the runner asks for the next submission, plus incremental transcript
 * printing that emits each settled block exactly once.
 */
export class PlainTui {
  readonly #deps: PlainTuiDeps
  #lineReader: Interface | null = null
  #pending: PendingRead | null = null
  readonly #queue: string[] = []
  #closed = false
  #printed = 0

  constructor(deps: PlainTuiDeps) {
    this.#deps = deps
  }

  readline(signal?: AbortSignal): Promise<TuiSubmission | null> {
    return new Promise((resolve) => {
      if (this.#lineReader === null) {
        this.#lineReader = createInterface({ input: this.#deps.term.input })
        // Permanent listeners: once() handlers would auto-pause the input
        // stream after one line and miss the EOF close.
        this.#lineReader.on('line', (line: string) => { this.#resolveLine(line) })
        this.#lineReader.on('close', () => {
          this.#closed = true
          this.#resolveLine(null)
        })
      }
      const pending: PendingRead = { resolve, signal: signal ?? null }
      this.#pending = pending
      if (signal !== undefined) {
        const onAbort = (): void => {
          if (this.#pending !== pending) return
          this.#pending = null
          resolve(null)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        pending.offAbort = () => { signal.removeEventListener('abort', onAbort) }
      }
      this.#pump()
    })
  }

  /**
   * Queue one readline delivery, then drain. A single stream chunk can carry
   * several lines; every line is buffered until the runner asks for the next
   * read, and EOF waits for the queue before closing the reader.
   */
  #resolveLine(line: string | null): void {
    const request = this.#deps.promptRequest()
    if (request !== undefined && line !== null) {
      const value = line.trim()
      if (value === '') {
        this.#deps.finishPrompt(null)
      } else if (request.allowCustom === false) {
        const options = request.options ?? []
        const numeric = /^\d+$/u.test(value) ? Number(value) - 1 : -1
        const option = numeric >= 0
          ? options[numeric]
          : options.find(item => item.label.toLowerCase() === value.toLowerCase())
        this.#deps.finishPrompt(option?.value ?? option?.label ?? null)
      } else {
        this.#deps.finishPrompt(value)
      }
      return
    }
    if (request !== undefined) this.#deps.finishPrompt(null)
    if (line !== null) this.#queue.push(line)
    this.#pump()
  }

  /** Resolve the pending read from the queue, or close it after EOF drained. */
  #pump(): void {
    const pending = this.#pending
    if (pending === null) return
    const line = this.#queue.shift()
    if (line !== undefined) {
      pending.offAbort?.()
      this.#pending = null
      pending.resolve({ text: line, images: [] })
      return
    }
    if (this.#closed) {
      pending.offAbort?.()
      this.#pending = null
      pending.resolve(null)
    }
  }

  /** Print blocks that settled since the last flush. */
  print(): void {
    const theme = createTheme(false, false)
    const width = this.#deps.term.width()
    const blocks = this.#deps.blocks()
    let out = ''
    for (const block of blocks.slice(this.#printed)) {
      // Pipe / CI output is not a viewport: print the full tool body.
      for (const line of blockLines(block, theme, width, 0, true)) out += line + '\n'
    }
    this.#printed = blocks.length
    if (out !== '') this.#deps.term.output.write(out)
  }

  /** Forget the print cursor so a replaced transcript reprints in full. */
  resetPrinted(): void {
    this.#printed = 0
  }

  dispose(): void {
    this.#lineReader?.close()
  }
}
