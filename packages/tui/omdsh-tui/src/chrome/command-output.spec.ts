import { describe, expect, it } from 'vitest'
import { formatHelpText } from '../views/autocomplete.ts'
import { renderCommandOutput, renderCommandSeparator } from './command-output.ts'
import { createTheme } from './theme.ts'
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
