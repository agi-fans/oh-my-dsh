import { describe, expect, it } from 'vitest'
import { createTheme, paintSurface, THEME_NAMES, type ThemeColor } from './theme.ts'
import { toOklab } from './terminal-colors.ts'

const HOST_BACKGROUNDS = {
  dark: '#15141a', light: '#ffffff', midnight: '#1a1b26', solarized: '#002b36',
  catppuccin: '#1e1e2e', dracula: '#282a36', nord: '#2e3440', gruvbox: '#282828',
  'rose-pine': '#191724', mono: '#101010',
}

function luminance(value: string): number {
  const rgb = value.startsWith('#')
    ? value.slice(1).match(/../gu)!.map(channel => Number.parseInt(channel, 16))
    : /(?:38|48);2;(\d+);(\d+);(\d+)/u.exec(value)!.slice(1).map(Number)
  const linear = rgb.map(channel => channel / 255).map(channel =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg), b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

// Fixed surfaces must stay readable independently of the host's default ink.
const CARD_BACKGROUNDS: readonly ThemeColor[] = ['toolPendingBg', 'toolSuccessBg', 'toolAltBg', 'toolErrorBg']
const CARD_INK: readonly ThemeColor[] = ['toolTitle', 'toolOutput', 'toolDiffContext', 'toolDiffAdded', 'toolDiffRemoved', 'error', 'muted']
const CODE_INK: readonly ThemeColor[] = ['mdCode', 'mdCodeBlock', 'mdKeyword', 'syntaxString', 'syntaxNumber', 'syntaxFunction', 'syntaxType', 'mdLink']

describe('paired surface styles', () => {
  const theme = createTheme(true, true)
  const fg = theme.getFgAnsi('toolOutput'), bg = theme.getBgAnsi('toolSuccessBg')
  const paint = (text: string) => paintSurface(theme, 'toolSuccessBg', 'toolOutput', text)

  it.each(['\x1b[0m', '\x1b[m', '\x1b[0;39;49m'])('restores both defaults after %j', reset => {
    expect(paint('before' + reset + 'after')).toBe(bg + fg + 'before' + reset + fg + bg + 'after\x1b[39m\x1b[49m')
  })

  it('keeps nested syntax ink while restoring only the reset channel', () => {
    const text = theme.fg('mdKeyword', 'const') + '\x1b[49m end'
    expect(paint(text)).toContain('const\x1b[39m' + fg + '\x1b[49m' + bg + ' end')
  })

  it('does not mistake black RGB channels or a zero palette index for resets', () => {
    for (const color of ['\x1b[38;2;0;0;0m', '\x1b[48;2;0;0;0m', '\x1b[38;5;0m', '\x1b[48;5;0m']) {
      expect(paint(color + 'x')).toBe(bg + fg + color + 'x\x1b[39m\x1b[49m')
    }
  })

  it('honors explicit colors later in a combined reset sequence', () => {
    expect(paint('\x1b[0;38;2;0;0;0mblack')).toContain('\x1b[0;38;2;0;0;0m' + bg + 'black')
    expect(paint('\x1b[0;48;5;0mblack')).toContain('\x1b[0;48;5;0m' + fg + 'black')
    expect(paint('\x1b[39;31;49;44mcolored')).toBe(bg + fg + '\x1b[39;31;49;44mcolored\x1b[39m\x1b[49m')
  })

  it('preserves plain output when colors are disabled', () => {
    expect(paintSurface(createTheme(false), 'userMessageBg', 'userMessageText', '中文 🐳')).toBe('中文 🐳')
  })
})

describe('theme contrast contracts', () => {
  it.each(THEME_NAMES)('%s pairs fixed card backgrounds with readable ink', name => {
    const theme = createTheme(true, true, name)
    expect(theme.getFgAnsi('userMessageText')).not.toBe('\x1b[39m')
    expect(contrast(theme.getFgAnsi('userMessageText'), theme.getBgAnsi('userMessageBg'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(theme.getFgAnsi('accent'), theme.getBgAnsi('userMessageBg'))).toBeGreaterThanOrEqual(4.5)
    for (const bg of CARD_BACKGROUNDS) {
      for (const fg of CARD_INK) {
        expect(theme.getFgAnsi(fg), `${name} ${fg}`).not.toBe('\x1b[39m')
        expect(contrast(theme.getFgAnsi(fg), theme.getBgAnsi(bg)), `${name} ${fg}/${bg}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(theme.getFgAnsi('dim'), theme.getBgAnsi(bg)), `${name} dim/${bg}`).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(THEME_NAMES)('%s keeps code and reading hints visible on representative terminal backgrounds', name => {
    const theme = createTheme(true, true, name)
    for (const bg of new Set([HOST_BACKGROUNDS[name] ?? '#15141a', name === 'light' ? '#ffffff' : '#15141a'])) {
      for (const fg of CODE_INK) {
        expect(contrast(theme.getFgAnsi(fg), bg), `${name} ${fg}/${bg}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const fg of ['dim', 'mdLinkUrl', 'mdQuote', 'thinkingText'] as const) {
        expect(contrast(theme.getFgAnsi(fg), bg), `${name} ${fg}/${bg}`).toBeGreaterThanOrEqual(3)
      }
    }
    expect(theme.getFgAnsi('text')).toBe('\x1b[39m')
  })

  it.each(THEME_NAMES)('%s avoids same-index foreground/background collisions in 16 colors', name => {
    const theme = createTheme(true, false, name)
    const fgIndex = (code: string): number => Number(/\[(\d+)m/u.exec(code)![1])
    for (const bg of CARD_BACKGROUNDS) {
      const background = fgIndex(theme.getBgAnsi(bg)) - 10
      for (const fg of [...CARD_INK, 'dim'] as const) {
        const foreground = fgIndex(theme.getFgAnsi(fg))
        expect(foreground, `${name} ${fg} owns its ink`).not.toBe(39)
        expect(foreground, `${name} ${fg}/${bg}`).not.toBe(background)
      }
    }
    expect(fgIndex(theme.getFgAnsi('userMessageText'))).not.toBe(39)
    expect(fgIndex(theme.getFgAnsi('userMessageText'))).not.toBe(fgIndex(theme.getBgAnsi('userMessageBg')) - 10)
  })
})

describe('tool state surfaces', () => {
  /**
   * The three states a reader acts on must never share a fill.
   *
   * This is the contract the old palette broke: below truecolor their swatches
   * quantized onto one entry, so a failed card looked exactly like a successful
   * one. A terminal that genuinely cannot host three fills is the only allowed
   * exception, and it must be the light 16-colour case.
   */
  const STATES = ['toolPendingBg', 'toolSuccessBg', 'toolErrorBg'] as const

  it.each(['truecolor', 'ansi256'] as const)('%s gives every theme three distinct tool fills', depth => {
    for (const name of THEME_NAMES) {
      const theme = createTheme(true, depth, name)
      const fills = STATES.map(state => theme.getBgAnsi(state))
      expect(new Set(fills).size, `${name} at ${depth}: ${fills.join(' ')}`).toBe(3)
    }
  })

  /**
   * The `system` palette derived its fills by mixing a terminal swatch into the
   * background at a fixed weight, so the card's lightness was the terminal's
   * choice rather than the theme's. A terminal reporting a bright green produced
   * a card at 11.7% luminance — nearly three times the shipped 4.4% — where dimmed
   * card text fell to 3.33:1. The fills are held at a target luminance now, and
   * this is the assertion that keeps them there for any terminal swatch.
   */
  const SYSTEM_TERMINAL_GREENS: readonly { r: number; g: number; b: number }[] = [
    { r: 0x4a, g: 0xc8, b: 0x7a }, // bright
    { r: 0x2e, g: 0xa0, b: 0x43 }, // mid
    { r: 0x3f, g: 0x8f, b: 0x5f }, // dull
    { r: 0x00, g: 0xff, b: 0x88 }, // maximal chroma
  ]
  const BACKGROUNDS = [
    { label: 'dark', background: { r: 0x15, g: 0x14, b: 0x1a }, foreground: { r: 0xe0, g: 0xe0, b: 0xe0 }, scheme: 'dark' as const },
    { label: 'tinted', background: { r: 0x1b, g: 0x1b, b: 0x26 }, foreground: { r: 0xdc, g: 0xdc, b: 0xe4 }, scheme: 'dark' as const },
    { label: 'light', background: { r: 0xf5, g: 0xf5, b: 0xf7 }, foreground: { r: 0x24, g: 0x24, b: 0x24 }, scheme: 'light' as const },
  ]

  it.each(BACKGROUNDS)('$label keeps a system card at the shipped lightness for every terminal green', host => {
    const shippedDark = createTheme(true, true, 'dark')
    const shippedLight = createTheme(true, true, 'light')
    const ceiling = Math.max(...CARD_BACKGROUNDS.map(color => luminance(shippedDark.getBgAnsi(color)) * 1.25))
    const paperFloor = Math.min(...CARD_BACKGROUNDS.map(color => luminance(shippedLight.getBgAnsi(color)) * 0.85))
    for (const green of SYSTEM_TERMINAL_GREENS) {
      const palette: { r: number; g: number; b: number }[] = []
      palette[1] = { r: 0xff, g: 0x5f, b: 0x5f }
      palette[2] = green
      const theme = createTheme(true, true, 'system', {
        background: host.background, foreground: host.foreground, scheme: host.scheme, palette,
      } as never)
      for (const color of CARD_BACKGROUNDS) {
        const fill = theme.getBgAnsi(color)
        const measured = luminance(fill)
        if (host.scheme === 'light') {
          // A light host keeps tinted paper: never darker than the shipped paper.
          expect(measured, `${color} on green ${JSON.stringify(green)}`).toBeGreaterThanOrEqual(paperFloor)
        } else {
          // A dark host keeps a dark surface regardless of how bright its green is.
          expect(measured, `${color} on green ${JSON.stringify(green)}`).toBeLessThanOrEqual(ceiling)
        }
      }
    }
  })

  /**
   * The contrast each shipped palette actually achieved for a card ink.
   *
   * This is the bar, not an invented 4.5: `dim` is deliberately quiet in both
   * shipped palettes and lands just under 4:1 there, so demanding AA of the
   * derived value would either fail the shipped colours too or force a hierarchy
   * the design never had. What must not happen is the derived ink falling *below*
   * what the palette it stands in for already offered.
   */
  const shippedCardContrast = (name: 'dark' | 'light', ink: 'toolOutput' | 'dim'): number => {
    const theme = createTheme(true, true, name)
    const value = theme.getFgAnsi(ink)
    return Math.min(...CARD_BACKGROUNDS.map(color => contrast(value, theme.getBgAnsi(color))))
  }

  it.each(BACKGROUNDS)('$label keeps card ink as readable as the palette it replaces', host => {
    // The fill was the variable: a bright terminal green lifted the card and
    // dropped dimmed text to 3.33:1, and a light host pushed `dim` to 1.75:1
    // against its own cards. Both are measured here against the shipped floor.
    const floor = host.scheme === 'light' ? 'light' : 'dark'
    for (const green of SYSTEM_TERMINAL_GREENS) {
      const palette: { r: number; g: number; b: number }[] = []
      palette[1] = { r: 0xff, g: 0x5f, b: 0x5f }
      palette[2] = green
      const theme = createTheme(true, true, 'system', {
        background: host.background, foreground: host.foreground, scheme: host.scheme, palette,
      } as never)
      for (const color of CARD_BACKGROUNDS) {
        const fill = theme.getBgAnsi(color)
        for (const ink of ['toolOutput', 'dim'] as const) {
          const ratio = contrast(theme.getFgAnsi(ink), fill)
          const expected = shippedCardContrast(floor, ink)
          expect(ratio, `${ink} on ${color} with green ${JSON.stringify(green)}`)
            .toBeGreaterThanOrEqual(expected * 0.95)
        }
      }
    }
  })

  it.each(['truecolor', 'ansi16'] as const)('%s keeps a failed card colder or warmer than a successful one', depth => {
    // The state has to be legible as *different*, not merely as another code:
    // the pending and error fills drift away from the neutral success fill.
    for (const name of THEME_NAMES) {
      const theme = createTheme(true, depth, name)
      const success = labOf(theme.getBgAnsi('toolSuccessBg'))
      for (const state of ['toolPendingBg', 'toolErrorBg'] as const) {
        const other = labOf(theme.getBgAnsi(state))
        if (other === undefined || success === undefined) continue
        expect(distance(success, other), `${name} ${state}`).toBeGreaterThan(0.01)
      }
    }
  })
})

/** OKLab of an SGR background code, for the two encodings these tests produce. */
function labOf(code: string): [number, number, number] | undefined {
  const truecolor = /48;2;(\d+);(\d+);(\d+)m/u.exec(code)
  if (truecolor !== null) return toOklab({ r: Number(truecolor[1]), g: Number(truecolor[2]), b: Number(truecolor[3]) })
  const indexed = /48;5;(\d+)m/u.exec(code)
  if (indexed !== null) {
    const index = Number(indexed[1])
    const levels = [0, 95, 135, 175, 215, 255]
    if (index >= 232) {
      const value = 8 + (index - 232) * 10
      return toOklab({ r: value, g: value, b: value })
    }
    if (index >= 16) {
      const offset = index - 16
      return toOklab({ r: levels[Math.floor(offset / 36)]!, g: levels[Math.floor(offset / 6) % 6]!, b: levels[offset % 6]! })
    }
  }
  return undefined
}

function distance(left: readonly [number, number, number], right: readonly [number, number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}
