/**
 * Transcript seam contract.
 *
 * Switching transcript documents makes the live view and the terminal's
 * history describe different documents, and the older rows stay in
 * that history rather than being erased. The seam is the only thing that tells
 * a reader scrolling upwards why the rows above stopped matching, so its row
 * has to fit every width, and it has to be chrome rather than a message.
 */
import { describe, expect, it } from 'vitest'
import { initialTranscript, processGroups } from './event-views.ts'
import { blockLines, transcriptSeam, type TranscriptSeam } from './transcript-render.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { TranscriptState } from './transcript-types.ts'

const theme = createTheme(false)

function seamRow(reason: TranscriptSeam, width: number): string {
  const lines = blockLines(transcriptSeam(reason), theme, width).map(stripAnsi)
  expect(lines).toHaveLength(1)
  return lines[0]!
}

describe('transcript seam', () => {
  it('names the cause and says the earlier output stayed', () => {
    expect(seamRow('cleared', 74)).toContain('transcript cleared · earlier output retained')
    expect(seamRow('session-opened', 74)).toContain('session opened · earlier output retained')
  })

  it('gives the row the full terminal width at every size that fits it', () => {
    for (const width of [30, 40, 50, 74, 100, 200]) {
      expect(visibleWidth(seamRow('cleared', width))).toBe(width)
    }
  })

  it('keeps the cause when the terminal is too narrow for the whole label', () => {
    // The rules are decoration and the tail of the sentence is detail. A narrow
    // terminal keeps the part that says what happened, and never overflows.
    for (const width of [12, 16, 20, 24]) {
      const row = seamRow('cleared', width)
      expect(row.startsWith('transcript')).toBe(true)
      expect(visibleWidth(row)).toBe(width)
    }
    // At the widths where the sentence no longer fits, the reader is told the
    // row was cut rather than left to guess at a hard right edge.
    expect(seamRow('cleared', 12)).toContain('…')
  })

  it('survives a terminal too narrow for any of the label', () => {
    // One cell is the floor the rest of the renderer works to; the seam owes
    // the same, because a seam that throws is worse than an unreadable one.
    for (const width of [1, 2, 3]) {
      expect(visibleWidth(seamRow('cleared', width))).toBe(width)
    }
  })

  it('closes a run rather than folding the seam into it', () => {
    // The seam is not work. Left out of this, a group could open across it and
    // swallow the one row that explains why the rows above stopped matching.
    const call = (id: string) => ({ kind: 'tool', callId: id as never, name: 'read', args: '{}', status: 'ok', output: 'a' }) as const
    const state: TranscriptState = {
      ...initialTranscript(),
      blocks: [call('c1'), transcriptSeam('cleared'), call('c2')],
    }
    expect(processGroups(state.blocks)).toHaveLength(0)
  })
})
