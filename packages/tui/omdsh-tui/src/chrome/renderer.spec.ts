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
})
