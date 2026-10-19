import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installConsoleLogSink } from './console-log.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('TUI console log sink', () => {
  it('moves plugin console output into the local log instead of stdout', async () => {
    const home = mkdtempSync(join(tmpdir(), 'omdsh-console-log-'))
    roots.push(home)
    const original = {
      log: console.log, info: console.info, debug: console.debug,
      warn: console.warn, error: console.error, trace: console.trace,
    }
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const path = installConsoleLogSink(home)
      expect(path).toBe(join(home, 'omdsh', 'logs', 'omdsh.log'))
      console.info('[llm-deepseek-account] model listing loaded %d models', 2)
      console.warn('diagnostic')
      await new Promise(resolve => setTimeout(resolve, 50))
      const text = readFileSync(path!, 'utf8')
      expect(text).toContain('INFO [llm-deepseek-account] model listing loaded 2 models')
      expect(text).toContain('WARN diagnostic')
      expect(stdout).not.toHaveBeenCalled()
    } finally {
      Object.assign(console, original)
    }
  })
})
