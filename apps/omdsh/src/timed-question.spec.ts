import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bootTuiTurn } from './test-support/tui-boot.ts'

describe('timed questions through the shipped CLI', () => {
  it.each(['standard', 'code'])('records a pending answer and continues in the %s preset', async (preset) => {
    const home = mkdtempSync(join(tmpdir(), 'omdsh-timed-'))
    const question = { questions: [{ id: 'scope', question: 'Which scope?', options: [{ label: 'Project' }] }], timeout: 1 }
    try {
      const turn = await bootTuiTurn({
        preset, home,
        toolCall: preset === 'standard'
          ? { name: 'ask_user_question', arguments: JSON.stringify(question) }
          : { name: 'run_code', arguments: JSON.stringify({
              description: 'Ask which scope to use',
              code: `return await tools.ask_user_question(${JSON.stringify(question)})`,
            }) },
      })
      expect(turn.status, turn.output.slice(-2_000)).toBe(0)
      expect(turn.output).toContain('Which scope?')
      expect(turn.bodies).toHaveLength(2)
      const continuation = JSON.stringify(turn.bodies[1])
      expect(continuation).toContain('pending')
      expect(continuation).toContain('callId')
      expect(continuation).not.toContain('ASK_ABORTED')
      expect(turn.output).not.toContain('mock script exhausted')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 180_000)
})
