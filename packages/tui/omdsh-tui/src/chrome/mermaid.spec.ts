import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as lovely from 'lovely-mermaid'
import { mermaidLines } from './mermaid.ts'
import { createTheme } from './theme.ts'
import { stripAnsi } from './width.ts'
import { oracleWidth } from './width.oracle.ts'

const theme = createTheme(false)
const draw = (source: string, width = 160) => mermaidLines(source, theme, width)

vi.mock('lovely-mermaid', async importOriginal => {
  const actual = await importOriginal<typeof import('lovely-mermaid')>()
  return { ...actual, render: vi.fn(actual.render) }
})

beforeEach(() => { vi.mocked(lovely.render).mockClear() })

describe('terminal Mermaid diagrams', () => {
  it('draws branches, labels and nested groups as connected boxes', () => {
    const rows = draw('flowchart TD\nsubgraph work[Work]\nA[Start] --> B{Check}\nB -->|yes| C[Done]\nB -->|no| A\nend')!
    const text = rows.join('\n')
    for (const label of ['Work', 'Start', 'Check', 'Done', 'yes', 'no']) expect(text).toContain(label)
    expect(text).toMatch(/[┌╭╔]/u)
    expect(text).toMatch(/[│║]/u)
    expect(text).not.toContain('-->')
  })

  it.each([
    ['sequenceDiagram\nparticipant A as Agent\nparticipant U as User\nalt accepted\nA->>U: done\nelse rejected\nU-->>A: retry\nend', ['Agent', 'User', 'done', 'retry']],
    ['stateDiagram-v2\n[*] --> Ready\nReady --> Done', ['Ready', 'Done']],
    ['classDiagram\nclass Agent\nclass Session\nAgent --> Session', ['Agent', 'Session']],
    ['erDiagram\nAGENT ||--o{ SESSION : owns', ['AGENT', 'SESSION']],
    ['mindmap\n  root((Project))\n    Tools\n    Sessions', ['Project', 'Tools', 'Sessions']],
  ])('draws supported diagram families: %s', (source, labels) => {
    const text = draw(source)!.join('\n')
    for (const label of labels) expect(text).toContain(label)
  })

  it('preserves right-to-left flow direction', () => {
    const row = draw('flowchart RL\nA[First] --> B[Second]')!.find(row => row.includes('First'))!
    expect(row).toContain('Second')
    expect(row.indexOf('Second')).toBeLessThan(row.indexOf('First'))
  })

  it('aligns Chinese, emoji and combining graphemes in display cells', () => {
    const rows = draw('flowchart TD\nA[中文 🐳 👩‍💻 e\u0301]')!
    expect(rows.join('\n')).toContain('中文 🐳 👩‍💻 e\u0301')
    expect(new Set(rows.map(oracleWidth)).size).toBe(1)
  })

  it.each(['graph TD\nA[Start --> B', 'stateDiagram-v2\nA --> B\nsome garbage line', 'gantt\ntitle Unknown'])('rejects partial or unsupported output: %s', source => {
    expect(draw(source)).toBeUndefined()
  })

  it('leaves oversized and terminal-control input as source', () => {
    expect(draw('graph TD\nA[' + 'x'.repeat(16_384) + ']')).toBeUndefined()
    expect(draw('graph TD\n' + 'A-->B\n'.repeat(201))).toBeUndefined()
    expect(draw('graph TD\nA[bad\x1b[31m]')).toBeUndefined()
    expect(draw('graph TD\n' + Array.from({ length: 130 }, (_, i) => `N${i}[Node ${i}]`).join('\n'))).toBeUndefined()
  })

  it('never clips or wraps an overwide diagram', () => {
    const source = 'graph LR\nA[Starting] --> B[Finished]'
    const rows = draw(source)!
    const width = Math.max(...rows.map(oracleWidth))
    expect(draw(source, width)).toEqual(rows)
    expect(draw(source, width - 1)).toBeUndefined()
  })

  it('paints geometry with the current theme without adopting source class colors', () => {
    const source = 'graph TD\nA[Theme]:::hot --> B[Done]\nclassDef hot fill:#123456,color:#abcdef'
    const plain = draw(source)!
    const dark = mermaidLines(source, createTheme(true, true, 'dark'), 160)!
    const light = mermaidLines(source, createTheme(true, true, 'light'), 160)!
    expect(dark.map(stripAnsi)).toEqual(plain)
    expect(light.map(stripAnsi)).toEqual(plain)
    expect(dark).not.toEqual(light)
    expect(dark.join('\n')).not.toContain('18;52;86')
    expect(dark.join('\n')).not.toContain('171;205;239')
  })

  it('reuses geometry across widths and themes', () => {
    const spy = vi.mocked(lovely.render)
    const source = 'graph TD\nA[Cached geometry] --> B[End]'
    expect(draw(source)).toBeDefined()
    expect(draw(source, 1)).toBeUndefined()
    expect(mermaidLines(source, createTheme(true), 160)).toBeDefined()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('contains renderer failures and caches a source fallback', () => {
    const spy = vi.mocked(lovely.render).mockImplementationOnce(() => { throw new Error('layout failure') })
    const source = 'graph TD\nA[Failed geometry]'
    expect(draw(source)).toBeUndefined()
    expect(draw(source)).toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
