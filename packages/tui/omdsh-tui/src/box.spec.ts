import { describe, expect, it } from 'vitest'
import { editorStatusLabel, renderEditor, renderFramedBlock, renderWelcome, renderWorking } from './box.ts'
import { createTheme } from './theme.ts'
import { stripAnsi, visibleWidth } from './width.ts'

const theme = createTheme(false)

describe('renderFramedBlock', () => {
  it('draws a rounded box with a header and body', () => {
    const lines = renderFramedBlock({ header: '✔ bash', lines: ['output'], width: 40, state: 'ok' }, theme)
    expect(lines[0]).toMatch(/^╭───/)
    expect(lines[0]).toContain('✔ bash')
    expect(lines.some((line) => line.includes('output'))).toBe(true)
    expect(lines[lines.length - 1]).toMatch(/^╰/)
    for (const line of lines) expect(visibleWidth(line)).toBe(40)
  })
})

describe('renderWelcome', () => {
  it('paints the two-column welcome card', () => {
    const lines = renderWelcome({
      width: 60, model: 'deepseek-v4-flash', provider: 'omdsh', version: '0.1.0', appName: 'omdsh',
    }, theme)
    const text = lines.map(stripAnsi).join('\n')
    expect(text).toContain('omdsh v0.1.0')
    expect(text).toContain('Welcome back!')
    expect(text).toContain('Tips')
    expect(text).toContain('/  commands')
    expect(text).toContain('^R search')
    expect(text).toContain('Pg↑ scroll')
    expect(text).toContain('⇥ complete')
    expect(text).toContain('Type / for commands')
    expect(text).toContain('deepseek-v4-flash')
    expect(lines[0]?.startsWith('╭')).toBe(true)
  })
})

describe('renderEditor', () => {
  it('embeds status in the top border and input on the bottom cap', () => {
    const status = editorStatusLabel(theme, { appName: 'omdsh', model: 'm', status: 'idle', pwd: '~/p' })
    const frame = renderEditor({ width: 40, input: 'hi', inputCursor: 2, status, border: 'border' }, theme)
    expect(frame.lines).toHaveLength(2)
    expect(frame.lines[0]).toMatch(/^╭─/)
    expect(frame.lines[0]).toContain('omdsh')
    expect(frame.lines[1]).toMatch(/^╰─/)
    expect(frame.lines[1]).toContain('hi')
    expect(frame.cursor).toEqual({ row: 1, column: 4 })
  })
})

describe('renderWorking', () => {
  it('shows the OMP working row', () => {
    const line = renderWorking(theme, 0)[0] ?? ''
    expect(line).toContain('Working...')
    expect(line).toContain('ctrl-c')
  })
})
