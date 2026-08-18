import { describe, expect, it } from 'vitest'
import { renderPathMentionRows } from './path-mentions.ts'
import { createTheme } from './theme.ts'
import { stripAnsi } from './width.ts'

const theme = createTheme(true, true)
const mentionOpen = theme.getFgAnsi('accent') + '\x1b[1m'
const mentionClose = '\x1b[22m' + theme.getFgAnsi('userMessageText')

describe('renderPathMentionRows', () => {
  it('highlights @ paths while leaving trailing prose punctuation outside', () => {
    const rendered = renderPathMentionRows('see @src/index.ts, then continue', 80, theme).join('\n')

    expect(rendered).toContain(mentionOpen + '@src/index.ts' + mentionClose + ',')
    expect(stripAnsi(rendered)).toBe('see @src/index.ts, then continue')
  })

  it('highlights every wrapped slice of a quoted path containing spaces', () => {
    const rows = renderPathMentionRows('open @"docs/my file.md" now', 10, theme)
    const mentionRows = rows.filter(row => /docs|file\.md/u.test(stripAnsi(row)))

    expect(mentionRows.length).toBeGreaterThan(1)
    expect(mentionRows.every(row => row.includes(mentionOpen))).toBe(true)
    expect(stripAnsi(rows.join(' '))).toContain('@"docs/my file.md"')
  })

  it('does not treat email addresses as path mentions', () => {
    const rendered = renderPathMentionRows('mail dev@example.com or open @README.md', 80, theme).join('\n')

    expect(rendered.split(mentionOpen)).toHaveLength(2)
    expect(rendered).toContain(mentionOpen + '@README.md' + mentionClose)
    expect(rendered).not.toContain(mentionOpen + '@example.com')
  })

  it('remains plain text when colors are disabled', () => {
    expect(renderPathMentionRows('see @src/index.ts', 80, createTheme(false))).toEqual([
      'see @src/index.ts',
    ])
  })
})
