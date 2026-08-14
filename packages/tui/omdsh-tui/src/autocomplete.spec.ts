import { describe, expect, it } from 'vitest'
import {
  applySlashCompletion,
  buildSlashCommandCompletions,
  BUILTIN_SLASH_COMMANDS,
  findLeadingSlashCommandStart,
  formatHelpText,
  parseSlashInput,
  renderAutocomplete,
  resolveSlashCommand,
  scoreCommandTextMatch,
  slashSuggestions,
} from './autocomplete.ts'
import { createTheme } from './theme.ts'

const theme = createTheme(false)

describe('findLeadingSlashCommandStart', () => {
  it('allows leading whitespace and rejects prose', () => {
    expect(findLeadingSlashCommandStart('/help')).toBe(0)
    expect(findLeadingSlashCommandStart('  /help')).toBe(2)
    expect(findLeadingSlashCommandStart('say /help')).toBe(null)
    expect(findLeadingSlashCommandStart('help')).toBe(null)
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
    expect(items.map((item) => item.value)).toEqual(['help', 'settings', 'theme', 'clear', 'quit'])
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

  it('hides once arguments start or the token is mid-prose', () => {
    expect(slashSuggestions('/help ', 6)).toBe(null)
    expect(slashSuggestions('run /he', 7)).toBe(null)
    expect(slashSuggestions('/he\nmore', 3)).toBe(null)
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
})

describe('parseSlashInput / resolveSlashCommand', () => {
  it('splits name and args and resolves aliases', () => {
    expect(parseSlashInput('/help')).toEqual({ name: 'help', args: '' })
    expect(parseSlashInput('  /clear now  ')).toEqual({ name: 'clear', args: 'now' })
    expect(parseSlashInput('/foo:bar')).toEqual({ name: 'foo', args: 'bar' })
    expect(parseSlashInput('/')).toEqual({ name: '', args: '' })
    expect(parseSlashInput('hello')).toBe(null)
    expect(resolveSlashCommand('q')?.name).toBe('quit')
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
    expect(text).toContain('/theme')
    expect(text).toContain('/quit')
    expect(text).toContain('/q')
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
  })
})
