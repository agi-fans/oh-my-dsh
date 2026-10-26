import { describe, expect, it } from 'vitest'
import { formatHelpText } from '../views/autocomplete.ts'
import { renderCommandOutput, renderCommandSeparator, renderShell } from './command-output.ts'
import { createTheme } from './theme.ts'
import { stripAnsi, visibleWidth } from './width.ts'
import { stripAnsi, visibleWidth } from './width.ts'

const theme = createTheme(false)

describe('renderCommandOutput', () => {
  it('renders multiline command results without a generic outer frame', () => {
    const lines = renderCommandOutput('session', [
      'Session Details',
      '',
      '| Field | Value |',
      '|---|---|',
      '| Model | `deepseek-v4-flash` |',
      '| Status | idle |',
    ].join('\n'), theme, 60)
    const text = lines.map(stripAnsi).join('\n')

    expect(text).toContain('Session Details')
    expect(text).toContain('Model')
    expect(text).toContain('deepseek-v4-flash')
    expect(text).toContain('├')
    expect(stripAnsi(lines[0] ?? '')).toBe(' Session Details')
    expect(stripAnsi(lines[0] ?? '')).not.toMatch(/[╭│╰]/u)
    expect(lines.every(line => visibleWidth(line) <= 60)).toBe(true)
  })

  it('keeps every help command in a distinct compact row', () => {
    const source = formatHelpText([
      { name: 'help', aliases: ['h', '?'], description: 'Show available slash commands' },
      { name: 'copy', inputHint: '[text|code|cmd]', description: 'Pick content to copy' },
    ])
    const lines = renderCommandOutput('help', source, theme, 64).map(stripAnsi)
    const text = lines.join('\n')

    expect(text).toContain('/help, /h, /?')
    expect(text).toContain('/copy [text|code|cmd]')
    expect(lines.filter(line => line.includes('Show available slash commands'))).toHaveLength(1)
    expect(lines.filter(line => /^\s*├.*┼.*┤$/u.test(line))).toHaveLength(0)
  })

  it('renders short results inline and separators with side insets', () => {
    expect(renderCommandOutput('compact', 'Compacted.', theme, 24)).toEqual(['  Compacted.'])
    const separator = stripAnsi(renderCommandSeparator(theme, 24))
    expect(separator).toBe(' ' + '─'.repeat(22) + ' ')
    expect(visibleWidth(separator)).toBe(24)
  })
})

describe('renderShell', () => {
  const theme = createTheme(false)

  it('drops the prompt the shell paints after a command', () => {
    // The card already names the command; the shell's own prompt underneath is a
    // second, differently spelled copy of the same fact.
    const lines = renderShell({ command: 'echo "Hello"', output: 'Hello\ndsh>', status: 'ok' }, theme, 40).map(stripAnsi)
    expect(lines.some(line => line.includes('Hello'))).toBe(true)
    expect(lines.some(line => line.trim() === 'dsh>')).toBe(false)
  })

  it('keeps output that merely ends with a prompt-like character', () => {
    // A line is chrome only when the marker ends it; anything after it is output.
    const lines = renderShell({ command: 'ls', output: 'a > b\nsrc>file.ts', status: 'ok' }, theme, 40).map(stripAnsi)
    expect(lines.some(line => line.includes('a > b'))).toBe(true)
    expect(lines.some(line => line.includes('src>file.ts'))).toBe(true)
  })

  it('carries a fill and spans the full width in every state', () => {
    const color = createTheme(true, true, 'dark')
    for (const status of ['running', 'ok', 'error'] as const) {
      const fill = status === 'running' ? 'toolPendingBg' : status === 'error' ? 'toolErrorBg' : 'toolSuccessBg'
      const painted = renderShell({ command: 'ls', output: 'a', status }, color, 40)
      for (const row of painted) {
        expect(row, `${status} row`).toContain(color.getBgAnsi(fill))
        expect(visibleWidth(row), `${status} width`).toBe(40)
      }
    }
  })

  it('paints the command in the shell ink rather than one flat title colour', () => {
    const color = createTheme(true, true, 'dark')
    const head = renderShell({ command: 'ls', output: '', status: 'ok' }, color, 40)[0] ?? ''
    expect(head).toContain(color.getFgAnsi('shellMode'))
  })
})
