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
  mathMode?(): import('../chrome/math.ts').MathMode
  mermaidMode?(): import('../chrome/mermaid.ts').MermaidMode
  /** Pipe output prints every thought in full; a reader cannot fold it later. */
  hideThinking?(): boolean
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

  prompt(): void {
    this.#startReader()
    this.#pump()
  }

  resumeInput(): void {
    queueMicrotask(() => this.#pump())
  }

  readline(signal?: AbortSignal): Promise<TuiSubmission | null> {
    if (signal?.aborted) return Promise.resolve(null)
    this.#startReader()
    return new Promise((resolve) => {
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

  #startReader(): void {
    if (this.#lineReader !== null || this.#closed) return
    this.#lineReader = createInterface({ input: this.#deps.term.input })
    this.#lineReader.on('line', (line: string) => {
      this.#queue.push(line)
      this.#pump()
    })
    this.#lineReader.on('close', () => {
      this.#closed = true
      this.#pump()
    })
  }

  #pump(): void {
    if (this.#queue.length === 0 && !this.#closed) return
    const request = this.#deps.promptRequest()
    if (request?.presentation === 'progress' && (this.#queue.length > 0 || !this.#closed)) return
    if (request !== undefined) {
      const line = this.#queue.shift()
      this.#deps.finishPrompt(line === undefined ? null : promptAnswer(request, line))
      if (line !== undefined) {
        if (this.#pending !== null) queueMicrotask(() => this.#pump())
        return
      }
    }
    const pending = this.#pending
    if (pending === null) return
    const line = this.#queue.shift()
    pending.offAbort?.()
    this.#pending = null
    pending.resolve(line === undefined ? null : { text: line, images: [] })
  }

  /** Print blocks that settled since the last flush. */
  print(): void {
    const theme = createTheme(false, false)
    const width = this.#deps.term.width()
    const blocks = this.#deps.blocks()
    let out = ''
    for (const block of blocks.slice(this.#printed)) {
      // Pipe / CI output is not a viewport: print the full tool body.
      for (const line of blockLines(block, theme, width, {
        toolsExpanded: true,
        mathMode: this.#deps.mathMode?.() ?? 'auto',
        mermaidMode: this.#deps.mermaidMode?.() ?? 'auto',
        hideThinking: this.#deps.hideThinking?.() === true,
        thinkingOpen: this.#deps.hideThinking?.() !== true,
      })) out += line + '\n'
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

function promptAnswer(request: TuiPrompt, line: string): string | null {
  const value = line.trim()
  if (value === '') {
    if (request.skippable === true || request.multiSelect === true && request.allowEmptySelection === true) {
      return request.answerFormat === 'json' ? JSON.stringify({ selected: [] }) : ''
    }
    return null
  }
  const options = request.options ?? []
  const findOption = (token: string) => {
    if (/^\d+$/u.test(token)) return options[Number(token) - 1]
    return options.find(option => option.label.toLowerCase() === token.toLowerCase() || option.value === token)
  }
  const exact = findOption(value)
  const tokens = exact !== undefined || request.multiSelect !== true ? [value] : value.split(',').map(token => token.trim())
  const selected = new Set<string>()
  const unmatched: string[] = []
  for (const token of tokens) {
    const option = findOption(token)
    if (option?.disabled === true) return null
    if (option === undefined) unmatched.push(token)
    else selected.add(option.value ?? option.label)
  }
  if (unmatched.length === 0) {
    return request.answerFormat === 'json' ? JSON.stringify({ selected: [...selected] }) : [...selected].join(', ')
  }
  if (request.allowCustom === false) return null
  const original = request.preserveWhitespace === true ? line : value
  if (request.answerFormat !== 'json') return original
  const custom = selected.size === 0 ? original : unmatched.join(', ')
  return JSON.stringify({ selected: [...selected], ...(custom === '' ? {} : { custom }) })
}
