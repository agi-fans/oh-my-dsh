import { describe, expect, it } from 'vitest'
import { GOLDEN, TAB_GOLDEN, isClusterBoundary, oracleWidth } from './width.oracle.ts'
import { expandTabs, padToWidth, stripAnsi, truncateToWidth, visibleWidth, wrapText } from './width.ts'

describe('golden width table', () => {
  it.each(GOLDEN)('measures %j as %i cells (%s)', (input, cells) => {
    // The oracle is calibrated against the same hand-checked value, so a bug
    // in the oracle itself fails here rather than masking a width regression.
    expect(oracleWidth(input)).toBe(cells)
    expect(visibleWidth(input)).toBe(cells)
  })

  it.each(TAB_GOLDEN)('places %j at %i cells (%s)', (input, cells) => {
    expect(oracleWidth(input)).toBe(cells)
  })
})

describe('oracle self-check', () => {
  it('equals the string length for pure ASCII', () => {
    expect(oracleWidth('hello world')).toBe(11)
  })

  it('agrees with truncation-free padding for CJK', () => {
    expect(oracleWidth('中文')).toBe(4)
  })
})

describe('tab expansion', () => {
  it('advances to the next stop from the given column', () => {
    expect(expandTabs('\tab', 8, 0)).toBe('        ab')
    expect(oracleWidth(expandTabs('\tab', 8, 0))).toBe(10)
    expect(oracleWidth(expandTabs('ab\t', 8, 0))).toBe(8)
  })

  it('counts the cells a wide glyph already occupied', () => {
    expect(oracleWidth(expandTabs('中\t', 8, 0))).toBe(8)
  })
})

describe('width invariants', () => {
  const samples = GOLDEN.map(([input]) => input)

  it('never returns a truncated row wider than the requested width', () => {
    for (const sample of samples) {
      for (const width of [1, 2, 3, 5, 8, 13]) {
        const out = truncateToWidth(sample, width)
        expect(oracleWidth(out), `truncateToWidth(${JSON.stringify(sample)}, ${width})`).toBeLessThanOrEqual(width)
      }
    }
  })

  it('cuts only on a grapheme boundary, never inside a cluster', () => {
    for (const sample of samples) {
      const plain = stripAnsi(sample + sample)
      for (const width of [1, 2, 3, 4, 5]) {
        const out = stripAnsi(truncateToWidth(sample + sample, width))
        if (!out.includes('…')) continue
        const kept = out.slice(0, -1)
        expect(plain.startsWith(kept), `${JSON.stringify(out)} is not a prefix of the source`).toBe(true)
        expect(isClusterBoundary(plain, kept.length), `cut inside a cluster at ${kept.length} of ${JSON.stringify(plain)}`).toBe(true)
      }
    }
  })

  it('pads an emoji-bearing line to an exact cell count', () => {
    for (const sample of samples) {
      expect(oracleWidth(padToWidth(sample, 12)), `padToWidth(${JSON.stringify(sample)}, 12)`).toBe(12)
    }
  })

  it('wraps emoji-bearing text without exceeding the width', () => {
    for (const sample of samples) {
      for (const width of [2, 4, 7]) {
        for (const line of wrapText(`${sample} ${sample}`, width)) {
          expect(oracleWidth(line), `wrapText(${JSON.stringify(sample)}, ${width})`).toBeLessThanOrEqual(width)
        }
      }
    }
  })
})
