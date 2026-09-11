/** Durable JSONL input history shared across omdsh processes. */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export class HistoryStore {
  constructor(readonly path: string, readonly limit = 1000) {}

  load(): string[] {
    try {
      return readFileSync(this.path, 'utf8').split('\n').filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed: unknown = JSON.parse(line)
            return typeof parsed === 'string' ? [parsed] : []
          } catch { return [] }
        }).slice(-this.limit)
    } catch { return [] }
  }

  add(text: string): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      appendFileSync(this.path, JSON.stringify(text) + '\n', { encoding: 'utf8', mode: 0o600 })
    } catch { /* convenience state must not break input in a read-only home */ }
  }
}
