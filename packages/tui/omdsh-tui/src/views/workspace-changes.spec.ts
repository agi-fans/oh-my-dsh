import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkspaceChangesSummary } from '@deepseek-ai/dsh-workspace-changes'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import { applyEvent, initialTranscript, replayEvents, withWorkspaceSummary } from './event-views.ts'
import { blockLines, blockSearchText } from './transcript-render.ts'
import type { Block } from './transcript-types.ts'
import { WORKSPACE_COLLAPSED_LINES, workspaceBlockLines } from './workspace-changes.ts'

const theme = createTheme('dark')
const WIDTH = 80

function summary(overrides: Partial<WorkspaceChangesSummary> = {}): WorkspaceChangesSummary {
  return {
    turn: 3,
    cwd: '/repo',
    files: [
      { path: 'src/a.ts', display: 'src/a.ts', added: 12, deleted: 3 },
      { path: 'src/b.ts', display: 'src/b.ts', added: 5, deleted: 0 },
    ],
    total: 2,
    added: 17,
    deleted: 3,
    ...overrides,
  }
}

function changesEvent(seq: number, turn: number): SessionEvent {
  return { type: 'workspace/changes', seq, time: 0, data: { turn } } as unknown as SessionEvent
}

/** Rendered lines with ANSI stripped, ready for plain-text assertions. */
function render(block: Block, expanded = false): string[] {
  return blockLines(block, theme, WIDTH, { toolsExpanded: expanded }).map(stripAnsi)
}

describe('workspace/changes fold', () => {
  it('appends a turn-only block when no host summary is served', () => {
    const state = applyEvent(initialTranscript(), changesEvent(7, 3))
    expect(state.blocks).toEqual([{ kind: 'workspace', turn: 3 }])
  })

  it('carries the served summary onto the block', () => {
    const state = applyEvent(initialTranscript(), changesEvent(7, 3), undefined, summary())
    expect(state.blocks).toEqual([{ kind: 'workspace', turn: 3, summary: summary() }])
  })

  it('replaces the block when the same turn is announced again', () => {
    let state = applyEvent(initialTranscript(), changesEvent(7, 3), undefined, summary())
    state = applyEvent(state, changesEvent(9, 3), undefined, summary({ total: 5 }))
    expect(state.blocks).toHaveLength(1)
    expect(state.blocks[0]).toMatchObject({ kind: 'workspace', turn: 3, summary: { total: 5 } })
  })

  it('keeps one block per turn when turns interleave', () => {
    let state = applyEvent(initialTranscript(), changesEvent(1, 1), undefined, summary({ turn: 1 }))
    state = applyEvent(state, changesEvent(2, 2), undefined, summary({ turn: 2 }))
    state = applyEvent(state, changesEvent(3, 1), undefined, summary({ turn: 1 }))
    expect(state.blocks.filter(b => b.kind === 'workspace')).toHaveLength(2)
  })

  it('replays summaries by event sequence', () => {
    const events = [changesEvent(4, 1), changesEvent(6, 2)]
    const state = replayEvents(events, undefined, new Map([[6, summary({ turn: 2 })]]))
    const blocks = state.blocks.filter(b => b.kind === 'workspace')
    expect(blocks).toEqual([
      { kind: 'workspace', turn: 1 },
      { kind: 'workspace', turn: 2, summary: summary({ turn: 2 }) },
    ])
  })

  it('leaves the prior state untouched (the fold is pure)', () => {
    const before = initialTranscript()
    const after = applyEvent(before, changesEvent(7, 3), undefined, summary())
    expect(before.blocks).toHaveLength(0)
    expect(after.blocks).toHaveLength(1)
  })
})

describe('withWorkspaceSummary', () => {
  it('fills the summary into a block that was folded without one', () => {
    const folded = applyEvent(initialTranscript(), changesEvent(7, 3))
    const enriched = withWorkspaceSummary(folded, 3, summary())
    expect(enriched.blocks).toEqual([{ kind: 'workspace', turn: 3, summary: summary() }])
  })

  it('does not mutate the state it was given', () => {
    const folded = applyEvent(initialTranscript(), changesEvent(7, 3))
    withWorkspaceSummary(folded, 3, summary())
    expect(folded.blocks).toEqual([{ kind: 'workspace', turn: 3 }])
  })

  it('keeps an existing summary rather than overwriting it', () => {
    const folded = applyEvent(initialTranscript(), changesEvent(7, 3), undefined, summary({ total: 9 }))
    expect(withWorkspaceSummary(folded, 3, summary({ total: 1 }))).toBe(folded)
  })

  it('is a no-op for a turn that has no block', () => {
    const folded = applyEvent(initialTranscript(), changesEvent(7, 3))
    expect(withWorkspaceSummary(folded, 99, summary())).toBe(folded)
  })
})

describe('workspace block rendering', () => {
  it('names the file count and the turn line totals', () => {
    const lines = render({ kind: 'workspace', turn: 3, summary: summary() })
    expect(lines).toEqual([
      '  Changed 2 files +17/-3',
      '    src/a.ts  +12/-3',
      '    src/b.ts  +5',
    ])
  })

  it('uses the singular form for one file', () => {
    const lines = render({ kind: 'workspace', turn: 3, summary: summary({
      files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }], total: 1, added: 1, deleted: 0,
    }) })
    expect(lines[0]).toBe('  Changed 1 file +1')
    expect(lines[1]).toBe('    a.ts  +1')
  })

  it('falls back to a turn-only line when the host serves nothing', () => {
    const lines = render({ kind: 'workspace', turn: 4 })
    expect(lines).toEqual(['  Workspace changes recorded for turn 4'])
  })

  it('says so when a measured turn changed nothing', () => {
    const lines = render({ kind: 'workspace', turn: 5, summary: summary({ files: [], total: 0, added: 0, deleted: 0 }) })
    expect(lines[0]).toBe('  Changed 0 files')
    expect(lines[1]).toBe('    No file changes')
  })

  it('marks binary and oversized files instead of printing meaningless counts', () => {
    const lines = render({ kind: 'workspace', turn: 6, summary: summary({
      files: [
        { path: 'logo.png', display: 'logo.png', added: 0, deleted: 0, binary: true },
        { path: 'big.bin', display: 'big.bin', added: 0, deleted: 0, oversized: true },
      ],
      total: 2,
    }) })
    expect(lines[1]).toContain('logo.png')
    expect(lines[1]).toContain('binary')
    expect(lines[2]).toContain('too large')
  })

  it('omits the deleted side when nothing was deleted', () => {
    const lines = render({ kind: 'workspace', turn: 7, summary: summary({ added: 4, deleted: 0 }) })
    expect(lines[0]).toBe('  Changed 2 files +4')
  })

  it('folds past the collapsed file limit and reports the remainder', () => {
    const files = Array.from({ length: WORKSPACE_COLLAPSED_LINES + 3 }, (_, i) => ({
      path: `f${i}.ts`, display: `f${i}.ts`, added: 1, deleted: 0,
    }))
    const collapsed = render({ kind: 'workspace', turn: 8, summary: summary({
      files, total: files.length, added: files.length, deleted: 0,
    }) })
    expect(collapsed).toHaveLength(1 + WORKSPACE_COLLAPSED_LINES + 1)
    expect(collapsed.at(-1)).toBe('    … 3 more files · ⟨Ctrl+O: Expand⟩')

    const expanded = render({ kind: 'workspace', turn: 8, summary: summary({
      files, total: files.length, added: files.length, deleted: 0,
    }) }, true)
    expect(expanded).toHaveLength(1 + files.length)
    expect(expanded.at(-1)).toContain(`f${files.length - 1}.ts`)
  })

  it('separates the plugin cap from the fold remainder', () => {
    const files = [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }]
    const lines = render({ kind: 'workspace', turn: 9, summary: summary({
      files, total: 4, added: 9, deleted: 0,
    }) })
    expect(lines.at(-1)).toBe('    … 3 more files not listed')
  })

  it('never exceeds the terminal width in display cells', () => {
    const files = [
      { path: 'x'.repeat(120), display: `${'x'.repeat(120)}.ts`, added: 1, deleted: 1 },
      { path: 'wide.ts', display: '目录/文件.ts', added: 2, deleted: 0 },
    ]
    for (const width of [20, 40, 80, 120]) {
      for (const block of [
        { kind: 'workspace' as const, turn: 1, summary: summary({ files, total: 2 }) },
        { kind: 'workspace' as const, turn: 2 },
      ]) {
        for (const line of workspaceBlockLines(block, theme, width, false)) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width)
        }
      }
    }
  })

  it('keeps the distinguishing tail of a long path visible', () => {
    const long = `src/${'nested/'.repeat(12)}target.ts`
    const lines = render({ kind: 'workspace', turn: 10, summary: summary({
      files: [{ path: long, display: long, added: 1, deleted: 0 }], total: 1, added: 1, deleted: 0,
    }) })
    expect(lines[1]).toContain('…')
    expect(lines[1]).toContain('target.ts')
  })
})

describe('workspace block search text', () => {
  it('indexes the served file paths', () => {
    const block = { kind: 'workspace', turn: 3, summary: summary() } as Block
    expect(blockSearchText(block)).toBe('src/a.ts\nsrc/b.ts')
  })

  it('still contributes text when no summary is served', () => {
    expect(blockSearchText({ kind: 'workspace', turn: 4 })).toBe('turn 4')
  })
})
