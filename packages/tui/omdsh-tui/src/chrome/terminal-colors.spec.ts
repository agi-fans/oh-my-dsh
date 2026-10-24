import { describe, expect, it } from 'vitest'
import {
  contrastRatio, mergeColorReply, nearestPaletteIndex, parseColorSpec, parseOscColorReply,
  parseSchemeReply, toOklab,
} from './terminal-colors.ts'

const black = { r: 0, g: 0, b: 0 }
const white = { r: 255, g: 255, b: 255 }
const red = { r: 255, g: 0, b: 0 }
const green = { r: 0, g: 128, b: 0 }
const blue = { r: 0, g: 0, b: 255 }
const grey = { r: 64, g: 64, b: 64 }
const palette = [black, red, green, blue, grey, white]

describe('terminal color replies', () => {
  it('parses every color spec shape a terminal uses', () => {
    expect(parseColorSpec('#1a2b3c')).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c })
    expect(parseColorSpec('#ffff00000000')).toEqual({ r: 255, g: 0, b: 0 })
    expect(parseColorSpec('rgb:ffff/0000/0000')).toEqual({ r: 255, g: 0, b: 0 })
    expect(parseColorSpec('rgb:1a/2b/3c')).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c })
    expect(parseColorSpec('nonsense')).toBeUndefined()
  })

  it('maps OSC 10, 11 and 4 replies to their slots', () => {
    expect(parseOscColorReply('10;rgb:ffff/ffff/ffff')).toEqual({ target: 'foreground', color: white })
    expect(parseOscColorReply('11;#000000')).toEqual({ target: 'background', color: black })
    expect(parseOscColorReply('4;3;rgb:0000/0000/ffff')).toEqual({ target: 3, color: blue })
  })

  it('ignores replies that are not color reports', () => {
    expect(parseOscColorReply('7501;?')).toBeUndefined()
    expect(parseOscColorReply('4;99;#ffffff')).toBeUndefined()
    expect(parseOscColorReply('10;notacolor')).toEqual({ target: 'foreground' })
  })

  it('reads the color scheme report', () => {
    expect(parseSchemeReply('\x1b[?997;1n')).toBe('dark')
    expect(parseSchemeReply('\x1b[?997;2n')).toBe('light')
    expect(parseSchemeReply('\x1b[?997;3n')).toBeUndefined()
  })

  it('keeps a palette only once every entry arrived', () => {
    let colors = mergeColorReply({}, { target: 'background', color: black })
    colors = mergeColorReply(colors, { target: 'foreground', color: white })
    expect(colors).toEqual({ background: black, foreground: white })
    colors = mergeColorReply(colors, { target: 0, color: black })
    expect(colors.palette).toBeUndefined()
    for (let index = 1; index < 16; index += 1) colors = mergeColorReply(colors, { target: index, color: white })
    expect(colors.palette).toHaveLength(16)
  })
})

describe('perceptual color math', () => {
  it('orders Oklab lightness from black to white', () => {
    expect(toOklab(black)[0]).toBeLessThan(0.1)
    expect(toOklab(white)[0]).toBeGreaterThan(0.99)
  })

  it('picks the perceptually nearest palette entry', () => {
    expect(nearestPaletteIndex({ r: 250, g: 5, b: 5 }, palette)).toBe(1)
    expect(nearestPaletteIndex({ r: 2, g: 2, b: 200 }, palette)).toBe(3)
    expect(nearestPaletteIndex(grey, palette)).toBe(4)
    expect(nearestPaletteIndex(grey, [])).toBeUndefined()
  })

  it('measures contrast the WCAG way', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 0)
    expect(contrastRatio(black, black)).toBe(1)
    expect(contrastRatio(grey, black)).toBeGreaterThan(1)
  })
})

describe('partial palettes', () => {
  it('accumulates out-of-order replies and publishes only a complete palette', () => {
    const colors = { r: 1, g: 2, b: 3 }
    // Fifteen of sixteen entries, deliberately out of order.
    let state = mergeColorReply({}, { target: 15, color: colors })
    for (let index = 0; index < 14; index += 1) state = mergeColorReply(state, { target: index, color: colors })
    expect(state.palette).toBeUndefined()
    // The last one closes the set, and what is published has no holes.
    state = mergeColorReply(state, { target: 14, color: colors })
    expect(state.palette).toHaveLength(16)
    expect(state.palette?.every(entry => entry !== undefined)).toBe(true)
    expect(state.palette?.[15]).toEqual(colors)
  })

  it('survives a sparse palette instead of reading properties of a hole', () => {
    const sparse = Array.from({ length: 16 }, () => undefined) as unknown as { r: number; g: number; b: number }[]
    sparse[3] = { r: 10, g: 20, b: 30 }
    expect(() => nearestPaletteIndex({ r: 10, g: 20, b: 30 }, sparse)).not.toThrow()
    expect(nearestPaletteIndex({ r: 10, g: 20, b: 30 }, sparse)).toBe(3)
  })
})
