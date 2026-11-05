import { describe, expect, it } from 'vitest'
import type { TuiWorkflowRun } from '../definition.ts'
import { workflowOptions, workflowMemberStatus } from './workflow.ts'
import { renderSubagents } from './transcript-render.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import { renderPromptTreePage } from './prompt-selector.ts'
import { localizePrompt } from '../locale/prompt.ts'

const run: TuiWorkflowRun = { id: 'run', name: 'Review', status: 'open', members: [
  { seq: 1, childId: 'one', label: 'Source', phase: 'Check' },
  { seq: 2, childId: 'two', label: 'Tests', phase: 'Check', outcome: 'failed' },
  { seq: 3, childId: 'three', label: 'No phase' },
  { seq: 4, childId: 'four', label: 'Empty phase', phase: '' },
  { seq: 5, childId: 'five', label: 'Later source', phase: 'Check', outcome: 'completed' },
] }

describe('workflow navigation view', () => {
  it('groups actual members by exact phase identity and keeps stable sequence keys', () => {
    const options = workflowOptions(run, member => member.seq === 1)
    expect(options.filter(row => row.parentValue === 'run').map(row => row.label)).toEqual(['Check', '—', '“”'])
    expect(options.filter(row => row.parentValue === 'phase:value:Check').map(row => row.value)).toEqual(['member:1', 'member:2', 'member:5'])
    expect(options.find(row => row.value === 'phase:value:Check')?.badge?.label).toBe('3 · Failed')
    expect(options.filter(row => !row.disabled).map(row => row.value)).toEqual(['member:1'])
  })

  it('distinguishes abandoned members from members with a recorded outcome', () => {
    const interrupted = { ...run, status: 'interrupted' }
    expect(workflowMemberStatus(interrupted, run.members[0]!)).toBe('interrupted')
    expect(workflowMemberStatus(interrupted, run.members[1]!)).toBe('failed')
  })

  it('translates statuses while preserving run, phase and member names', () => {
    const names = { ...run, name: 'Settings', members: [{ seq: 1, childId: 'one', label: 'Running', phase: 'General' }] }
    const prompt = localizePrompt({ title: 'Workflow', question: '', localize: ['title', 'question'], options: workflowOptions(names, () => true) }, 'zh-CN')
    expect(prompt.title).toBe('工作流')
    expect(prompt.options?.map(row => row.label)).toEqual(['Settings', 'General', 'Running'])
    expect(prompt.options?.[2]?.badge?.label).toBe('运行中')
  })

  it.each([false, true])('shows workflows without child sessions and bounds the shared roster (colors=%s)', colors => {
    const workflows = Array.from({ length: 30 }, (_, index) => ({ ...run, id: String(index), name: `检查 é🐳 ${index}` }))
    for (const width of [12, 40, 90]) {
      const rows = renderSubagents({ agents: [], workflows }, createTheme(colors), width, 0, undefined, 24)
      expect(rows.length).toBeLessThanOrEqual(8)
      expect(rows.every(row => visibleWidth(row) <= width)).toBe(true)
      if (width === 90) expect(rows.map(stripAnsi).join('\n')).toContain('❯ Workflow · 检查 é🐳 24 · Running')
    }
  })
})


it('localizes workflow tree controls and offers Enter only on an available member', () => {
  const theme = createTheme(false, 'truecolor', 'dark', undefined, 'zh-CN')
  const request = localizePrompt({ title: 'Workflow', question: '', presentation: 'tree', localize: ['title'], options: workflowOptions(run, member => member.seq === 1) }, 'zh-CN')
  const render = (selected: number) => stripAnsi(renderPromptTreePage({ request, selected, checked: new Set() }, theme, 110, 20, '', 0, 'omdsh').lines.join('\n'))
  expect(render(0)).not.toContain('Enter')
  const member = render(2)
  expect(member).toContain('Enter 打开')
  expect(member).toContain('Esc 返回')
  expect(member).toContain('←→ 折叠')
  expect(member).toContain('输入筛选')
  expect(member).toContain('Ctrl+↑↓ 预览')
})
