/**
 * Shared frame sanitization contract: content-owned cursor/screen controls
 * are stripped while styling escapes survive, so tool output can never move
 * the terminal cursor or leave phantom rows.
 */
import { describe, expect, it } from 'vitest'
import { sanitizeDisplayLine } from './renderer.ts'

describe('sanitizeDisplayLine', () => {
  it('removes content-owned cursor controls while preserving SGR styles', () => {
    expect(sanitizeDisplayLine('safe\x1b[2A\x1b[31mred\x1b[0m\r\nnext')).toBe(
      'safe\x1b[31mred\x1b[0m  next',
    )
  })

  it('preserves OSC 8 hyperlinks and OSC 133 semantic prompt markers while stripping arbitrary OSC escapes', () => {
    const line = '\x1b]133;A\x07\x1b]8;;file:///repo/a.ts\x07a.ts\x1b]8;;\x07\x1b]52;c;ZHVtbXk=\x07'
    expect(sanitizeDisplayLine(line)).toBe('\x1b]133;A\x07\x1b]8;;file:///repo/a.ts\x07a.ts\x1b]8;;\x07')
  })
})
