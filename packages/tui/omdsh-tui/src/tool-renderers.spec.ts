import { describe, expect, it } from 'vitest'
import { renderTool, type TuiToolRenderer } from './tool-renderers.ts'

describe('renderTool', () => {
  it('renders bash and file arguments as coding-agent summaries', () => {
    expect(renderTool({ name: 'bash', arguments: '{"command":"pnpm test","cwd":"/repo"}', output: 'ok', status: 'ok', expanded: true }))
      .toMatchObject({ title: 'bash', summary: '$ pnpm test  ·  /repo', lines: ['ok'] })
    expect(renderTool({ name: 'read', arguments: '{"path":"src/a.ts","offset":5,"limit":10}', output: '', status: 'ok', expanded: true }))
      .toMatchObject({ summary: 'src/a.ts:5:10' })
  })

  it('lets the last exact-name contribution win and falls back if it throws', () => {
    const custom: TuiToolRenderer = { names: ['x'], render: () => ({ summary: 'custom' }) }
    expect(renderTool({ name: 'x', arguments: '{}', output: '', status: 'running', expanded: false }, [custom]).summary).toBe('custom')
    expect(renderTool({ name: 'x', arguments: '{}', output: 'safe', status: 'ok', expanded: false }, [
      custom,
      { names: ['x'], render: () => { throw new Error('broken') } },
    ])).toMatchObject({ title: 'x', lines: ['safe'] })
  })
})
