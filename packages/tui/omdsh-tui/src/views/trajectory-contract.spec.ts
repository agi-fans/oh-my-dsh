import { describe, expect, it } from 'vitest'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc/types'
import type {} from '@deepseek-ai/dsh-tools'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { KeyEvent } from '../input/keys.ts'
import {
  applyTrajectoryEvent, appendTrajectoryEvent, createTrajectory, renderTrajectory,
  trajectoryClick, trajectoryDetailScrollLimit, trajectoryLeftWidth, trajectoryVisibleRecords,
  type TrajectoryState,
} from './trajectory.ts'
import { trajectoryTimeline, wallClockMs } from './trajectory-timeline.ts'

const callId = ToolCallId('native')
const input = JSON.stringify({ command: 'printf "中文 🐳"\n  pwd', description: 'Inspect the workspace' })
const call = {
  type: 'tool/call', seq: SessionSeq(1), time: 100,
  data: { turn: 1, step: 1, callId, name: 'bash', arguments: input },
} satisfies SessionEvent<'tool/call'>
const result = (text = 'done\n', isError = false): SessionEvent<'tool/result'> => ({
  type: 'tool/result', seq: SessionSeq(2), time: 350, surfaceOp: 'append',
  data: { turn: 1, step: 1, message: {
    role: 'tool', id: MessageId('result'), source: { kind: 'tool', callId },
    toolCallId: callId, isError, content: text === '' ? [] : [{ type: 'text', text }],
  } },
})
const context = (seq: number, text: string): SessionEvent<'developer/message'> => ({
  type: 'developer/message', seq: SessionSeq(seq), time: seq * 100, surfaceOp: 'append',
  data: { turn: 1, step: 1, message: {
    role: 'developer', id: MessageId(`context-${seq}`), source: { kind: 'tool-registry' }, content: [{ type: 'text', text }],
  } },
})
const ptcStart = {
  type: 'tool/ptc-dispatch-start', seq: SessionSeq(3), time: 150,
  data: { rootCallId: callId, parentCallId: callId, subCallId: ToolCallId('child'), name: 'read', arguments: { file_path: 'README.md' } },
} satisfies SessionEvent<'tool/ptc-dispatch-start'>
const ptcResult = {
  type: 'tool/ptc-dispatch', seq: SessionSeq(4), time: 200,
  data: { ...ptcStart.data, content: [{ type: 'text', text: 'child result' }], isError: false },
} satisfies SessionEvent<'tool/ptc-dispatch'>
const theme = createTheme(false)
const plain = (state: TrajectoryState, width = 120, height = 30): string[] => renderTrajectory(state, theme, width, height).lines.map(stripAnsi)
const key = (state: TrajectoryState, event: KeyEvent, width = 120, height = 20): TrajectoryState => {
  const command = applyTrajectoryEvent(state, event, { width, height, maxDetailScroll: trajectoryDetailScrollLimit(state, theme, width, height) })
  if (!('state' in command)) throw new Error('Expected a state change')
  return command.state
}
const press = (state: TrajectoryState, id: Extract<KeyEvent, { type: 'key' }>['id'], width = 120): TrajectoryState => key(state, { type: 'key', id }, width)
const text = (state: TrajectoryState, value: string): TrajectoryState => key(state, { type: 'text', value })

describe('published Trajectory event contracts', () => {
  it('settles native calls by toolCallId and preserves source input and result', () => {
    const state = createTrajectory([call, result()])
    expect(state.ledger.records).toHaveLength(1)
    expect(state.ledger.records[0]).toMatchObject({
      status: 'ok', durationMs: 250, input, result: 'done\n', resultRecorded: true, summary: 'Inspect the workspace',
    })
    expect(JSON.parse(state.ledger.records[0]!.rawResult!)).toEqual(result().data)
    const overview = plain(press(state, 'enter')).join('\n')
    expect(overview).toContain('Input')
    expect(overview).toContain('Result')
    expect(overview).toContain('printf "中文 🐳"')
    expect(overview).not.toContain('live')
  })

  it.each(['', '  \n  ', 'failed'])('retains empty, whitespace and failed results: %j', output => {
    const state = createTrajectory([call, result(output, output === 'failed')])
    expect(state.ledger.records[0]).toMatchObject({ result: output, resultRecorded: true, status: output === 'failed' ? 'error' : 'ok' })
    const detail = { ...press(state, 'enter'), detailTab: 'result' as const }
    const copy = applyTrajectoryEvent(detail, { type: 'text', value: 'y' })
    expect(copy).toEqual({ copy: output, label: 'Result' })
    if (output === '') expect(plain(detail).join('\n')).toContain('No text output.')
  })

  it('retains an orphan result without inventing timing or arguments', () => {
    const record = createTrajectory([result()]).ledger.records[0]
    expect(record).toMatchObject({ status: 'ok', result: 'done\n', startedAt: null, durationMs: null, payload: '' })
    expect(record?.input).toBeUndefined()
  })

  it('marks unsettled tools interrupted without pretending they succeeded or timed out', () => {
    const end = { type: 'turn/end', seq: SessionSeq(3), time: 500, data: { turn: 1, reason: { kind: 'interrupted' } } } satisfies SessionEvent<'turn/end'>
    const state = createTrajectory([call, end])
    expect(state.ledger.records[0]).toMatchObject({ status: 'warning', durationMs: null, result: '' })
    expect(trajectoryVisibleRecords(text(state, 'e'))).toHaveLength(2)
  })

  it('uses published header.tools for Schema and does not reuse a removed schema', () => {
    const header = {
      type: 'request/header', seq: SessionSeq(0), time: 0,
      data: { reason: 'initial', header: { config: { provider: 'mock', model: 'test' }, tools: [{ name: 'bash', description: 'Execute command', parameters: { type: 'object' } }] } },
    } satisfies SessionEvent<'request/header'>
    let state = createTrajectory([header, call])
    expect(JSON.parse(state.ledger.records[0]!.schema).name).toBe('bash')
    expect(plain(press(state, 'enter')).join('\n')).toContain('Schema')
    state = appendTrajectoryEvent(state, { ...header, seq: SessionSeq(3), data: { reason: 'change', header: { config: header.data.header.config } } })
    state = appendTrajectoryEvent(state, { ...call, seq: SessionSeq(4), data: { ...call.data, callId: ToolCallId('next') } })
    expect(state.ledger.records.at(-1)?.schema).toBe('')
  })

  it('associates PTC children by subCallId during replay and incremental updates', () => {
    const events: SessionEvent[] = [call, ptcStart, ptcResult, result()]
    const replay = createTrajectory(events)
    let live = createTrajectory([])
    for (const event of events) live = appendTrajectoryEvent(live, event)
    expect(live.ledger.records).toEqual(replay.ledger.records)
    expect(replay.ledger.records[1]).toMatchObject({ id: 'tool:child', parentCallId: 'native', status: 'ok', result: 'child result', durationMs: 50 })
    expect(replay.selectedId).toBe('tool:native')
    expect(trajectoryVisibleRecords(replay)).toHaveLength(1)
    expect(trajectoryVisibleRecords(text(replay, ' '))).toHaveLength(2)
    expect(trajectoryTimeline(replay.ledger.records, { width: 40 })?.totalMs).toBe(250)
    expect(trajectoryTimeline(replay.ledger.records.slice(1), { width: 40 })?.totalMs).toBe(50)
  })

  it('distinguishes accumulated parallel call durations from elapsed time', () => {
    const state = createTrajectory([call, result()])
    const record = state.ledger.records[0]!
    const records = [record, { ...record, id: 'tool:parallel', startedAt: 100 }]
    expect(trajectoryTimeline(records, { width: 40 })?.totalMs).toBe(500)
    expect(wallClockMs(records)).toBe(250)
  })
})

describe('Trajectory reading interactions', () => {
  it('groups injected context and reveals search hits after clearing a query', () => {
    let state = createTrajectory([context(1, 'workspace rules'), context(2, 'unique needle')])
    expect(trajectoryVisibleRecords(state)).toHaveLength(1)
    expect(plain(state).join('\n')).toContain('2 injected entries')
    state = text(state, '/')
    state = text(state, 'unique needle')
    state = press(state, 'enter')
    expect(state.selectedId).toBe('2:developer/message')
    state = { ...state, query: '' }
    expect(trajectoryVisibleRecords(state)).toHaveLength(2)
    expect(trajectoryVisibleRecords(text(state, ' '))).toHaveLength(1)
  })

  it('wraps tool output without inventing a second line-number gutter', () => {
    const state = { ...press(createTrajectory([call, result('42: ' + 'source '.repeat(20))]), 'enter'), detailTab: 'result' as const }
    const rows = plain(state, 60, 20)
    expect(rows.find(row => row.includes('42:'))?.trimStart()).toMatch(/^42: /u)
    expect(rows.some(row => /^\s*1 42:/u.test(row))).toBe(false)
    expect(rows.filter(row => row.includes('source')).length).toBeGreaterThan(1)
  })

  it('puts a group disclosure at its actual mouse target without opening details', () => {
    let state = createTrajectory([context(1, 'rules'), context(2, 'catalog')])
    const rows = plain(state)
    const row = rows.findIndex(line => line.includes('2 injected entries'))
    expect(rows[row]?.indexOf('▸')).toBe(2)
    state = trajectoryClick(state, 120, 30, row, 2)
    expect(state.details).toBe(false)
    expect(trajectoryVisibleRecords(state)).toHaveLength(2)
    expect(plain(state)[row]?.indexOf('▾')).toBe(2)
    state = trajectoryClick(state, 120, 30, row, 2)
    expect(trajectoryVisibleRecords(state)).toHaveLength(1)
  })

  it('keeps selection visible when hiding calls', () => {
    const state = createTrajectory([context(0, 'question'), call, result()])
    const folded = text(state, 'c')
    expect(folded.selectedId).not.toBe(state.selectedId)
    expect(trajectoryVisibleRecords(folded).some(record => record.id === folded.selectedId)).toBe(true)
  })

  it('bounds End and repeated wheel scrolling, and can immediately scroll back', () => {
    let state = press(createTrajectory([call, result(Array.from({ length: 80 }, (_, i) => `output-${i}`).join('\n'))]), 'enter')
    state = { ...state, detailTab: 'result' }
    state = press(state, 'end')
    expect(state.detailScroll).toBe(67)
    for (let i = 0; i < 10; i++) state = key(state, { type: 'wheel', direction: 'down', column: 90 })
    expect(state.detailScroll).toBe(67)
    state = press(state, 'up')
    expect(state.detailScroll).toBe(66)
    state = key(state, { type: 'wheel', direction: 'up', column: 90 })
    expect(state.detailScroll).toBeLessThan(66)
    state = press(state, 'tab')
    expect(state.focus).toBe('list')
    state = text(state, 'f')
    expect(state.fullDetail).toBe(true)
    expect(plain(state).every(row => !row.includes('│'))).toBe(true)
  })

  it('clicks a whole record row and switches sections using the displayed geometry', () => {
    let state = createTrajectory([call, result()])
    const rows = plain(state)
    const row = rows.findIndex(line => line.includes('Inspect the workspace'))
    state = trajectoryClick(state, 120, 30, row, 65)
    expect(state.details).toBe(true)
    const tabRow = plain(state)[4]!
    state = trajectoryClick(state, 120, 30, 4, tabRow.indexOf('Result'))
    expect(state.detailTab).toBe('result')
    expect(state.focus).toBe('detail')
    state = trajectoryClick(state, 120, 30, 8, trajectoryLeftWidth(120) + 8)
    expect(state.focus).toBe('detail')
  })

  it('jumps through slow calls and reveals a hidden parent chain', () => {
    const base = createTrajectory([call, ptcStart, ptcResult, result()])
    let state = text({ ...base, selectedId: null }, 's')
    expect(state.selectedId).toBe('tool:native')
    state = text(state, 's')
    expect(state.selectedId).toBe('tool:child')
    expect(trajectoryVisibleRecords(state)).toHaveLength(2)
    expect(text(state, 's').selectedId).toBe('tool:native')
  })

  it.each([1, 12, 60, 95, 96, 120, 200])('bounds CJK/emoji/combining content at %i cells with and without color', width => {
    const state = press(createTrajectory([call, result(('中文 🐳 é '.repeat(50) + '\n').repeat(3))]), 'enter', width)
    for (const colors of [false, true]) {
      for (const tab of ['summary', 'input', 'result', 'payload'] as const) {
        const frame = renderTrajectory({ ...state, detailTab: tab }, createTheme(colors), width, 20)
        expect(frame.lines).toHaveLength(20)
        expect(frame.lines.every(row => visibleWidth(row) <= width)).toBe(true)
      }
    }
  })
})
