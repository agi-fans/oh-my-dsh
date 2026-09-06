import { describe, expect, it } from 'vitest'
import { moveGraphemeLeft, moveGraphemeRight, snapToGraphemeBoundary } from './grapheme.ts'

describe('grapheme geometry', () => {
  it('moves between boundaries without splitting a surrogate pair', () => {
    const whale = '🐳'
    expect(moveGraphemeLeft('a' + whale, 3)).toBe(1)
    expect(moveGraphemeRight('a' + whale, 1)).toBe(3)
    expect(moveGraphemeLeft('ab', 2)).toBe(0)
    expect(moveGraphemeRight('ab', 0)).toBe(2)
  })

  it('clamps at the edges', () => {
    expect(moveGraphemeLeft('ab', 0)).toBe(0)
    expect(moveGraphemeRight('ab', 2)).toBe(2)
    expect(moveGraphemeLeft('', 0)).toBe(0)
  })

  it('snaps an offset inside a grapheme forward to its end', () => {
    const whale = '🐳'
    expect(snapToGraphemeBoundary('a' + whale, 2)).toBe(3)
    expect(snapToGraphemeBoundary('a' + whale, 1)).toBe(1)
    // Offset 2 is the boundary before the whale: stays put.
    expect(snapToGraphemeBoundary('a\n' + whale, 2)).toBe(2)
    expect(snapToGraphemeBoundary('a\n' + whale, 3)).toBe(4)
  })

  it('keeps combining sequences whole', () => {
    const grapheme = 'e\u0301' // e + combining acute
    expect(grapheme.length).toBe(2)
    expect(moveGraphemeLeft('a' + grapheme, 3)).toBe(1)
    expect(moveGraphemeRight('a' + grapheme, 1)).toBe(3)
  })
})
