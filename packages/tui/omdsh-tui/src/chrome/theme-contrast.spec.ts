import { describe, expect, it } from 'vitest'
import { createTheme, paintSurface, THEME_NAMES, type ThemeColor } from './theme.ts'

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
const CARD_BACKGROUNDS: readonly ThemeColor[] = ['toolPendingBg', 'toolSuccessBg', 'toolErrorBg']
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
    for (const bg of new Set([HOST_BACKGROUNDS[name], name === 'light' ? '#ffffff' : '#15141a'])) {
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
