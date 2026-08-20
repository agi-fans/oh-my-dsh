import { describe, expect, it } from 'vitest'
import {
  applySlashCompletion,
  buildSlashArgumentCompletions,
  buildSlashCommandCompletions,
  BUILTIN_SLASH_COMMANDS,
  findLeadingSlashCommandStart,
  formatHelpText,
  leadingSlashCommandNameRange,
  parseSlashInput,
  renderAutocomplete,
  hitTestAutocomplete,
  resolveSlashCommand,
  scoreCommandTextMatch,
  slashInlineHint,
  slashSuggestions,
} from './autocomplete.ts'
import { createTheme } from '../chrome/theme.ts'

const theme = createTheme(false)

describe('findLeadingSlashCommandStart', () => {
  it('allows leading whitespace and rejects prose', () => {
    expect(findLeadingSlashCommandStart('/help')).toBe(0)
    expect(findLeadingSlashCommandStart('  /help')).toBe(2)
    expect(findLeadingSlashCommandStart('say /help')).toBe(null)
    expect(findLeadingSlashCommandStart('help')).toBe(null)
  })
})

describe('leadingSlashCommandNameRange', () => {
  it('covers the leading /name token the way parseSlashInput splits it', () => {
    expect(leadingSlashCommandNameRange('/')).toEqual({ start: 0, end: 1 })
    expect(leadingSlashCommandNameRange('/help')).toEqual({ start: 0, end: 5 })
    expect(leadingSlashCommandNameRange('  /copy text')).toEqual({ start: 2, end: 7 })
    expect(leadingSlashCommandNameRange('/foo:bar')).toEqual({ start: 0, end: 4 })
    expect(leadingSlashCommandNameRange('/skill:code-review focus')).toEqual({ start: 0, end: 18 })
  })

  it('rejects prose, multiline buffers, and absolute-path lookalikes', () => {
    expect(leadingSlashCommandNameRange('say /help')).toBe(null)
    expect(leadingSlashCommandNameRange('/help\nmore')).toBe(null)
    expect(leadingSlashCommandNameRange('/tmp/foo')).toBe(null)
  })
})

describe('scoreCommandTextMatch', () => {
  it('ranks exact and prefix above fuzzy', () => {
    expect(scoreCommandTextMatch('help', 'help')).toBe(1000)
    expect(scoreCommandTextMatch('he', 'help')).toBe(900)
    expect(scoreCommandTextMatch('hlp', 'help')).toBeGreaterThan(0)
    expect(scoreCommandTextMatch('he', 'help')).toBe(scoreCommandTextMatch('he', 'hex'))
    expect(scoreCommandTextMatch('z', 'help')).toBe(0)
  })
})

describe('buildSlashCommandCompletions', () => {
  it('keeps registry order for an empty prefix', () => {
    const items = buildSlashCommandCompletions(BUILTIN_SLASH_COMMANDS, '')
    expect(items.map((item) => item.value)).toEqual([
      'help', 'settings', 'copy', 'tools', 'clear', 'quit',
    ])
  })

  it('matches aliases and still completes the canonical name', () => {
    const items = buildSlashCommandCompletions(BUILTIN_SLASH_COMMANDS, 'q')
    expect(items).toHaveLength(1)
    expect(items[0]?.value).toBe('quit')
    expect(items[0]?.label).toBe('q')
  })
})

describe('slashSuggestions', () => {
  it('suggests commands for a leading slash token', () => {
    const result = slashSuggestions('/he', 3)
    expect(result?.items[0]?.value).toBe('help')
    expect(result?.prefix).toBe('/he')
  })

  it('hides unsupported arguments and commands embedded in prose', () => {
    expect(slashSuggestions('/help ', 6)?.items.map(item => item.value)).toEqual(['full'])
    expect(slashSuggestions('run /he', 7)).toBe(null)
    expect(slashSuggestions('/he\nmore', 3)).toBe(null)
  })

  it('suggests /copy arguments after a space', () => {
    const copy = slashSuggestions('/copy c', 7)
    expect(copy?.items.map((item) => item.value)).toEqual(['code', 'cmd'])
    expect(slashSuggestions('/settings ', 10)).toBe(null)
  })

  it('filters namespaced skills as one flat command catalog', () => {
    const commands = [
      ...BUILTIN_SLASH_COMMANDS,
      { name: 'skill:code-review', description: 'Review a change for correctness' },
      { name: 'skill:research', description: 'Investigate primary sources' },
    ]
    const result = slashSuggestions('/skill:', 7, commands)
    expect(result?.items).toEqual([
      expect.objectContaining({ value: 'skill:code-review', description: 'Review a change for correctness' }),
      expect.objectContaining({ value: 'skill:research', description: 'Investigate primary sources' }),
    ])
  })
})

describe('slashInlineHint', () => {
  it('shows the catalog after /name and remaining chars of a prefix', () => {
    expect(slashInlineHint('/copy ', 6)).toBe('text|code|cmd')
    expect(slashInlineHint('/copy com', 9)).toBe('mand')
    expect(slashInlineHint('/settings ', 10)).toBe(null)
    expect(slashInlineHint('/help ', 6)).toBe('full')
  })
})

describe('buildSlashArgumentCompletions', () => {
  it('matches aliases and still completes the canonical value', () => {
    const items = buildSlashArgumentCompletions(
      resolveSlashCommand('copy')?.arguments ?? [],
      'com',
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ value: 'cmd', label: 'command', kind: 'argument' })
  })
})

describe('applySlashCompletion', () => {
  it('replaces the live token with /name and a trailing space', () => {
    expect(applySlashCompletion('/he', 3, { value: 'help', label: 'help' })).toEqual({
      text: '/help ',
      cursor: 6,
    })
    expect(applySlashCompletion('  /q', 4, { value: 'quit', label: 'q' })).toEqual({
      text: '  /quit ',
      cursor: 8,
    })
  })

  it('replaces the live argument token without rewriting the command', () => {
    expect(applySlashCompletion('  /copy com', 11, {
      value: 'cmd',
      label: 'command',
      kind: 'argument',
    })).toEqual({ text: '  /copy cmd ', cursor: 12 })
  })
})

describe('parseSlashInput / resolveSlashCommand', () => {
  it('splits name and args and resolves aliases', () => {
    expect(parseSlashInput('/help')).toEqual({ name: 'help', args: '' })
    expect(parseSlashInput('  /clear now  ')).toEqual({ name: 'clear', args: 'now' })
    expect(parseSlashInput('/foo:bar')).toEqual({ name: 'foo', args: 'bar' })
    expect(parseSlashInput('/skill:code-review')).toEqual({ name: 'skill:code-review', args: '' })
    expect(parseSlashInput('/skill:code-review focus on auth')).toEqual({
      name: 'skill:code-review',
      args: 'focus on auth',
    })
    expect(parseSlashInput('/')).toEqual({ name: '', args: '' })
    expect(parseSlashInput('hello')).toBe(null)
    expect(resolveSlashCommand('dirs')).toBeUndefined()
    expect(resolveSlashCommand('q')?.name).toBe('quit')
    expect(resolveSlashCommand('exit')?.name).toBe('quit')
    expect(resolveSlashCommand('?')?.name).toBe('help')
    expect(resolveSlashCommand('set')?.name).toBe('settings')
    expect(resolveSlashCommand('nope')).toBeUndefined()
  })
})

describe('formatHelpText / renderAutocomplete', () => {
  it('lists every builtin command', () => {
    const text = formatHelpText()
    expect(text).toContain('/help')
    expect(text).toContain('/settings')
    expect(text).toContain('/set')
    expect(text).not.toContain('/theme')
    expect(text).not.toContain('/hotkeys')
    expect(text).toContain('/help [full]')
    expect(text).toContain('/copy [text|code|cmd]')
    expect(text).not.toContain('/settings [')
    expect(text).toContain('/tools')
    expect(text).not.toContain('/pwd')
    expect(text).not.toContain('/dirs')
    expect(text).toContain('/clear')
    expect(text).toContain('/quit')
    expect(text).toContain('/q')
    expect(text).toContain('/exit')
  })

  it('groups plugin skills and formats commands as compact Markdown rows', () => {
    const text = formatHelpText([
      ...BUILTIN_SLASH_COMMANDS,
      { name: 'resume', description: 'Resume a durable session', inputHint: '[session-id]' },
      {
        name: 'skill:code-review',
        description: 'Review changes against repository standards and the originating specification',
      },
      { name: 'skill:research', description: 'Investigate a question against high-trust primary sources' },
    ])
    const lines = text.split('\n')
    expect(lines[0]).toBe('Commands · 7 core · 2 skills')
    expect(text).toContain('**Terminal Commands · 6**')
    expect(text).toContain('**Agent Commands · 1**')
    expect(text).not.toContain('| Command | Description |')
    expect(text).toContain('/resume [session-id]')
    expect(text).toContain('**Skills · 2**')
    expect(text).toContain('Type `/skill:` to browse and filter skills')
    expect(text).not.toContain('/skill:code-review')
    expect(lines.filter(line => line.startsWith('- `/'))).toHaveLength(7)
  })

  it('paints the selected row with a cursor and windows long lists', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      value: 'c' + i,
      label: 'c' + i,
      description: 'd' + i,
    }))
    const lines = renderAutocomplete(items, 6, theme, 40)
    expect(lines.some((line) => line.includes('❯'))).toBe(true)
    expect(lines.some((line) => line.includes('/c6'))).toBe(true)
    expect(lines.some((line) => line.includes('7/8'))).toBe(true)
    expect(lines.every((line) => !line.includes('/c0'))).toBe(true)
    expect(hitTestAutocomplete(8, 6, 0)).toBe(3)
    expect(hitTestAutocomplete(8, 6, 3)).toBe(6)
    expect(hitTestAutocomplete(8, 6, 5)).toBeUndefined()
  })

  it('paints unselected command names in the accent color', () => {
    const color = createTheme(true, true)
    const lines = renderAutocomplete(
      [
        { value: 'help', label: 'help', description: 'Show commands' },
        { value: 'quit', label: 'q', description: 'Quit' },
      ],
      0,
      color,
      40,
    )
    expect(lines.some(line => line.includes(color.bold(color.fg('accent', '/help'))))).toBe(true)
    expect(lines.some(line => line.includes(color.fg('accent', '/q')) && !line.includes(color.bold(color.fg('accent', '/q'))))).toBe(true)
  })

  it('paints argument rows without a leading slash', () => {
    const lines = renderAutocomplete(
      [{ value: 'dark', label: 'dark', description: 'Dark palette', kind: 'argument' }],
      0,
      theme,
      40,
    )
    expect(lines.some((line) => line.includes('dark'))).toBe(true)
    expect(lines.every((line) => !line.includes('/dark'))).toBe(true)
  })

  it('paints heading rows without a cursor and keeps session labels bare', () => {
    const lines = renderAutocomplete(
      [
        { value: '', label: 'Files & folders', kind: 'heading' },
        { value: '@README.md', label: 'README.md', kind: 'path' },
        { value: '', label: 'Session conversations', kind: 'heading' },
        { value: '@[notes](dsh-session:abc)', label: 'notes', kind: 'session' },
      ],
      1,
      theme,
      80,
    )
    expect(lines.some((line) => line.includes('Files & folders') && !line.includes('❯'))).toBe(true)
    expect(lines.some((line) => line.includes('❯') && line.includes('README.md'))).toBe(true)
    expect(lines.some((line) => line.includes('notes') && !line.includes('/notes'))).toBe(true)
    expect(lines.at(-1)).toContain('↑↓ select')
  })
})
