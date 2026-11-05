import { describe, expect, it } from 'vitest'
import { initialTranscript, renderView } from './event-views.ts'
import type { Block } from './transcript-types.ts'

const tool = { kind: 'tool', callId: 'c', turn: 1, name: 'owned', args: '{}', output: '', status: 'ok',
  presentation: { cwd: '/original', call: { card: 'generic', title: 'Read a.ts', locations: [{ path: 'a.ts' }] } } } as Block
const assistant = { kind: 'assistant', turn: 1, step: 1, text: 'Done', reasoning: '', streaming: false } as Block
const options = { width: 80, height: 40, model: 'm', input: '', inputCursor: 0, colors: false }

describe('file regions', () => {
  it('tracks visible tool spans and does not make folded-away calls clickable', () => {
    const state = { ...initialTranscript(), blocks: [tool, assistant], turn: 1 }
    expect(renderView(state, options).transcript?.fileRegions).toEqual([])
    const open = renderView(state, { ...options, toolsExpanded: true })
    const region = open.transcript?.fileRegions?.find(region => region.block === 0)
    expect(region).toBeDefined()
    // Regions are document rows; the frame may precede them with spare rows.
    const top = open.documentRows?.frameStart ?? 0
    expect(open.lines.slice(top + region!.start, top + region!.end).join('\n')).toContain('Read a.ts')
    expect(open.lines.slice(top + region!.start, top + region!.end).join('\n')).not.toContain('Done')
  })

  it('maps only visible Changed files rows and keeps the folded more-files label inactive', () => {
    const block = { kind: 'workspace', turn: 1, summary: { turn: 1, cwd: '/original', total: 10, added: 10, deleted: 0,
      files: Array.from({ length: 10 }, (_, index) => ({ path: `file-${index}.ts`, display: `file-${index}.ts`, added: 1, deleted: 0 })) } } as Block
    const state = { ...initialTranscript(), blocks: [block] }
    const folded = renderView(state, options)
    const regions = folded.transcript!.fileRegions!
    expect(regions.filter(region => region.file !== undefined)).toHaveLength(8)
    const omittedRow = folded.lines.findIndex(line => line.includes('more files'))
    expect(regions.some(region => omittedRow >= region.start && omittedRow < region.end)).toBe(false)
    const expanded = renderView(state, { ...options, toolsExpanded: true })
    expect(expanded.transcript!.fileRegions!.filter(region => region.file !== undefined)).toHaveLength(10)
  })
})

it.each([false, true])('shows one selected tool menu button and cell-safe selection buttons (colors=%s)', colors => {
  for (const width of [12, 20, 40, 80]) {
    const frame = renderView({ ...initialTranscript(), blocks: [tool, assistant], turn: 1 },
      { ...options, width, colors, toolsExpanded: true, selectedProcess: 0, selectionActions: 'copy-quote' })
    const menu = frame.transcript?.disclosures?.filter(target => target.actionColumn !== undefined) ?? []
    expect(menu).toHaveLength(width < 20 ? 0 : 1)
    if (width >= 40) expect(frame.lines.join('\n')).not.toContain('…')
    expect(frame.selectionActions?.length).toBeGreaterThan(0)
    for (const target of frame.selectionActions ?? []) {
      expect(target.column + target.width).toBeLessThanOrEqual(width)
      expect(frame.lines[target.row]).toContain(target.action === 'copy' ? 'Copy' : 'Quote')
    }
    const feedback = renderView(initialTranscript(), { ...options, width, selectionActions: 'copy-quote', transientStatus: 'Copied' })
    expect(feedback.selectionActions).toEqual([])
  }
})
