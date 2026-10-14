/** Versioned NDJSON output owned exclusively by the script entry point. */

export const EXEC_SCHEMA_VERSION = 1
export type ExecOutcome = 'completed' | 'failed' | 'requires_input' | 'cancelled'
export interface ExecResult {
  outcome: ExecOutcome
  exitCode: number
  sessionId?: string
  text: string
  sessionTotals?: { stats?: unknown; tokens?: unknown }
  error?: { code: string; message: string }
}

type OutputStream = Pick<NodeJS.WritableStream, 'write'>
const MAX_QUEUED_BYTES = 32 * 1024 * 1024

/** Ordered writes respect pipe backpressure; an unavailable pipe fails the run. */
export class ExecOutput {
  readonly #stream: OutputStream
  readonly #onFailure: (error: Error) => void
  #tail: Promise<void> = Promise.resolve()
  #failure: Error | undefined
  #queued = 0
  #sequence = 0
  #finished = false
  #activeReject: ((error: Error) => void) | undefined

  constructor(stream: OutputStream, onFailure: (error: Error) => void = () => {}) {
    this.#stream = stream
    this.#onFailure = onFailure
  }

  emit(type: string, data: unknown): void {
    if (this.#finished) throw new Error('exec output is already finished')
    if (this.#failure !== undefined) return
    const text = JSON.stringify({ schemaVersion: EXEC_SCHEMA_VERSION, sequence: ++this.#sequence, type, data }) + '\n'
    const bytes = Buffer.byteLength(text)
    if (this.#queued + bytes > MAX_QUEUED_BYTES) {
      this.#fail(new Error('Execution output exceeded the 32 MiB pending-write limit.'))
      return
    }
    this.#queued += bytes
    this.#tail = this.#tail.then(async () => {
      try {
        if (this.#failure === undefined) await new Promise<void>((resolve, reject) => {
          this.#activeReject = reject
          this.#stream.write(text, error => { this.#activeReject = undefined; if (error != null) reject(error); else resolve() })
        })
      }
      finally { this.#queued -= bytes }
    }).catch(error => { this.#fail(error instanceof Error ? error : new Error(String(error))) })
  }

  async finish(result: ExecResult): Promise<void> {
    this.emit('run.finished', result)
    this.#finished = true
    await this.flush()
  }

  async flush(): Promise<void> {
    await this.#tail
    if (this.#failure !== undefined) throw this.#failure
  }

  #fail(error: Error): void {
    if (this.#failure !== undefined) return
    this.#failure = error
    this.#activeReject?.(error)
    this.#activeReject = undefined
    this.#onFailure(error)
  }
}

/**
 * Reserve stdout before loading plugins. Console and ordinary plugin writes go
 * to stderr; the returned bound writer alone writes protocol records to stdout.
 */
export function reserveExecStdout(): { stream: OutputStream; restore(): void } {
  const original = process.stdout.write
  const stream: OutputStream = { write: original.bind(process.stdout) }
  process.stdout.write = process.stderr.write.bind(process.stderr)
  return { stream, restore: () => { process.stdout.write = original } }
}
