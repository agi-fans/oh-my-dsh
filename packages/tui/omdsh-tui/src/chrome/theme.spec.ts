import { describe, expect, it } from 'vitest'
import { BOX, colorDisabledByEnv, createTheme, DEEPSEEK_LOGO, detectTrueColor, gradientLogo, parseThemeName, SYMBOL, THEME_NAMES, type ThemeColor } from './theme.ts'

/** Every semantic color a view can address; mirrors the `ThemeColor` union. */
const THEME_COLORS: readonly ThemeColor[] = [
  'accent', 'border', 'borderAccent', 'borderMuted', 'success', 'error', 'warning',
  'muted', 'dim', 'text', 'userMessageText', 'userMessageBg', 'toolPendingBg',
  'toolSuccessBg', 'toolErrorBg', 'toolTitle', 'toolOutput', 'toolDiffAdded',
  'toolDiffRemoved', 'toolDiffContext', 'mdHeading', 'mdLink', 'mdLinkUrl', 'mdCode',
  'mdCodeBlock', 'mdCodeBlockBorder', 'mdKeyword', 'mdQuote', 'mdListBullet',
  'thinkingText', 'customMessageLabel',
]

function sgrLuminance(ansi: string): number {
  const match = /38;2;(\d+);(\d+);(\d+)/u.exec(ansi)
  if (match === null) return Number.NaN
  const channels = [match[1], match[2], match[3]].map(value => Number(value) / 255)
  const linear = channels.map(channel => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
}

function rgbLuminance(red: number, green: number, blue: number): number {
  const channels = [red, green, blue].map(value => value / 255).map(channel => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

function contrastRatio(foreground: number, background: number): number {
  const lighter = Math.max(foreground, background)
  const darker = Math.min(foreground, background)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('createTheme', () => {
  it('is identity when colors are off', () => {
    const theme = createTheme(false, true)
    expect(theme.fg('accent', 'x')).toBe('x')
    expect(theme.bold('x')).toBe('x')
    expect(theme.underline('x')).toBe('x')
    expect(theme.strikethrough('x')).toBe('x')
    expect(theme.inverse('x')).toBe('x')
    expect(theme.getFgAnsi('accent')).toBe('')
  })

  it('emits 24-bit SGR for hex colors', () => {
    const theme = createTheme(true, true)
    expect(theme.getFgAnsi('accent')).toBe('\x1b[38;2;254;188;56m')
    expect(theme.getFgAnsi('mdLink')).toBe('\x1b[38;2;0;136;250m')
    expect(theme.underline('x')).toBe('\x1b[4mx\x1b[24m')
    expect(theme.strikethrough('x')).toBe('\x1b[9mx\x1b[29m')
    expect(theme.inverse('x')).toBe('\x1b[7mx\x1b[27m')
    expect(theme.bold('x')).toBe('\x1b[1mx\x1b[22m')
    expect(theme.italic('x')).toBe('\x1b[3mx\x1b[23m')
    expect(theme.fg('success', 'ok')).toContain('ok')
    expect(theme.fg('success', 'ok')).toContain('\x1b[39m')
    expect(theme.fg('success', 'ok')).not.toContain('\x1b[0m')
    expect(theme.bg('userMessageBg', 'x')).toContain('\x1b[49m')
  })

  it('falls back to 16-color SGR without truecolor', () => {
    const theme = createTheme(true, false)
    expect(theme.getFgAnsi('error')).toBe('\x1b[31m')
    expect(theme.trueColor).toBe(false)
    expect(createTheme(false, true).trueColor).toBe(false)
    expect(createTheme(true, true).trueColor).toBe(true)
  })

  it('paints every 16-color background with a background SGR code', () => {
    const backgroundCode = /^\x1b\[(?:4[0-7]|49|10[0-7])m$/u
    for (const name of THEME_NAMES) {
      const theme = createTheme(true, false, name)
      for (const color of THEME_COLORS) {
        expect(theme.getBgAnsi(color), `${name} ${color}`).toMatch(backgroundCode)
      }
    }
  })

  it('derives 16-color backgrounds from the foreground fallback table', () => {
    const dark = createTheme(true, false, 'dark')
    expect(dark.getBgAnsi('error')).toBe('\x1b[41m')
    expect(dark.getFgAnsi('error')).toBe('\x1b[31m')
    expect(dark.getBgAnsi('userMessageBg')).toBe('\x1b[40m')
    expect(dark.getBgAnsi('toolErrorBg')).toBe('\x1b[41m')
    expect(dark.getBgAnsi('text')).toBe('\x1b[49m')
    const light = createTheme(true, false, 'light')
    expect(light.getBgAnsi('userMessageBg')).toBe('\x1b[47m')
    expect(light.getBgAnsi('toolSuccessBg')).toBe('\x1b[42m')
    expect(light.getBgAnsi('accent')).toBe('\x1b[46m')
  })

  it('documents the shared 16-color dark tool-card background', () => {
    // SGR 40 is the only dark background both states can use without a
    // 256-color tier; a fabricated difference would misreport tool state.
    const dark = createTheme(true, false, 'dark')
    expect(dark.getBgAnsi('toolPendingBg')).toBe('\x1b[40m')
    expect(dark.getBgAnsi('toolSuccessBg')).toBe('\x1b[40m')
  })

  it('preserves body and metadata hierarchy in every 16-color fallback', () => {
    for (const name of THEME_NAMES) {
      const theme = createTheme(true, false, name)
      expect(theme.getFgAnsi('text'), `${name} text`).toBe('\x1b[39m')
      expect(theme.getFgAnsi('muted'), `${name} muted`).not.toBe(theme.getFgAnsi('dim'))
    }
  })

  it('paints the light palette with a different accent', () => {
    const dark = createTheme(true, true, 'dark')
    const light = createTheme(true, true, 'light')
    expect(dark.name).toBe('dark')
    expect(light.name).toBe('light')
    expect(light.getFgAnsi('accent')).toBe('\x1b[38;2;90;128;128m')
    expect(light.getFgAnsi('accent')).not.toBe(dark.getFgAnsi('accent'))
  })

  it('ships additional coding palettes', () => {
    expect(THEME_NAMES).toEqual([
      'dark', 'light', 'midnight', 'solarized',
      'catppuccin', 'dracula', 'nord', 'gruvbox', 'rose-pine',
      'mono',
    ])
    expect(createTheme(true, true, 'catppuccin').name).toBe('catppuccin')
    expect(createTheme(true, true, 'rose-pine').getFgAnsi('thinkingText')).not.toBe(
      createTheme(true, true, 'rose-pine').getFgAnsi('text'),
    )
  })

  it('keeps muted borders and fence keywords off the UI accent', () => {
    const dark = createTheme(true, true, 'dark')
    const midnight = createTheme(true, true, 'midnight')
    const solarized = createTheme(true, true, 'solarized')
    expect(dark.getFgAnsi('borderMuted')).toBe('\x1b[38;2;61;66;74m')
    expect(dark.getFgAnsi('mdKeyword')).toBe('\x1b[38;2;86;156;214m')
    expect(dark.getFgAnsi('mdKeyword')).not.toBe(dark.getFgAnsi('accent'))
    expect(midnight.getFgAnsi('muted')).toBe('\x1b[38;2;119;125;136m')
    expect(midnight.getFgAnsi('error')).toBe('\x1b[38;2;247;118;142m')
    expect(midnight.getFgAnsi('borderMuted')).not.toBe(midnight.getFgAnsi('border'))
    expect(solarized.getFgAnsi('mdKeyword')).toBe('\x1b[38;2;133;153;0m')
    expect(solarized.getFgAnsi('customMessageLabel')).toBe('\x1b[38;2;108;113;196m')
  })

  it('keeps thinking text quieter than muted chrome', () => {
    const dark = createTheme(true, true, 'dark')
    expect(dark.getFgAnsi('thinkingText')).toBe('\x1b[38;2;107;114;128m')
    expect(dark.getFgAnsi('thinkingText')).not.toBe(dark.getFgAnsi('text'))
    expect(dark.getFgAnsi('thinkingText')).not.toBe(dark.getFgAnsi('muted'))
    expect(dark.getFgAnsi('thinkingText')).not.toBe(dark.getFgAnsi('dim'))
  })

  it('lets the terminal own body ink while keeping thinking explicitly muted', () => {
    const midnight = createTheme(true, true, 'midnight')
    expect(midnight.getFgAnsi('text')).toBe('\x1b[39m')
    expect(midnight.getFgAnsi('thinkingText')).toBe('\x1b[38;2;106;115;148m')
    expect(midnight.getFgAnsi('thinkingText')).not.toBe(midnight.getFgAnsi('text'))
    expect(midnight.getFgAnsi('thinkingText')).not.toBe(midnight.getFgAnsi('dim'))
  })

  it('uses the terminal foreground for body ink on every palette', () => {
    for (const name of THEME_NAMES) {
      const theme = createTheme(true, true, name)
      expect(theme.getFgAnsi('text'), name).toBe('\x1b[39m')
    }
  })

  it('keeps every dark color palette readable and visibly layered', () => {
    const background = rgbLuminance(0x15, 0x14, 0x1a)
    for (const name of THEME_NAMES) {
      if (name === 'light') continue
      const theme = createTheme(true, true, name)
      const muted = contrastRatio(sgrLuminance(theme.getFgAnsi('muted')), background)
      const dim = contrastRatio(sgrLuminance(theme.getFgAnsi('dim')), background)
      const border = contrastRatio(sgrLuminance(theme.getFgAnsi('borderMuted')), background)
      const accent = contrastRatio(sgrLuminance(theme.getFgAnsi('accent')), background)
      expect(muted, `${name} muted`).toBeGreaterThanOrEqual(3.5)
      expect(dim, `${name} dim`).toBeGreaterThanOrEqual(1.95)
      expect(muted - dim, `${name} muted/dim gap`).toBeGreaterThanOrEqual(1)
      expect(border, `${name} borderMuted`).toBeLessThanOrEqual(dim + 0.05)
      expect(accent, `${name} accent`).toBeGreaterThanOrEqual(4.3)
    }
  })

  it('keeps the light palette readable and layered on a light surface', () => {
    const light = createTheme(true, true, 'light')
    const background = rgbLuminance(0xff, 0xff, 0xff)
    const muted = contrastRatio(sgrLuminance(light.getFgAnsi('muted')), background)
    const dim = contrastRatio(sgrLuminance(light.getFgAnsi('dim')), background)
    const border = contrastRatio(sgrLuminance(light.getFgAnsi('borderMuted')), background)
    const accent = contrastRatio(sgrLuminance(light.getFgAnsi('accent')), background)
    expect(muted).toBeGreaterThanOrEqual(4.5)
    expect(dim).toBeGreaterThanOrEqual(4.5)
    expect(muted).toBeGreaterThan(dim)
    expect(border).toBeGreaterThanOrEqual(2)
    expect(border).toBeLessThan(dim)
    expect(accent).toBeGreaterThanOrEqual(4.3)
  })

  it('keeps inline markdown code closer to muted text than to accent', () => {
    const dark = createTheme(true, true, 'dark')
    const midnight = createTheme(true, true, 'midnight')
    expect(dark.getFgAnsi('mdCode')).toBe('\x1b[38;2;138;144;153m')
    expect(midnight.getFgAnsi('mdCode')).toBe('\x1b[38;2;127;135;153m')
    expect(midnight.getFgAnsi('mdCode')).not.toBe('\x1b[38;2;255;158;100m')
    expect(createTheme(true, false).getFgAnsi('mdCode')).toBe('\x1b[90m')
  })
})

describe('parseThemeName', () => {
  it('accepts shipped names and falls back to dark', () => {
    expect(parseThemeName('light')).toBe('light')
    expect(parseThemeName('dark')).toBe('dark')
    expect(parseThemeName('midnight')).toBe('midnight')
    expect(parseThemeName('catppuccin')).toBe('catppuccin')
    expect(parseThemeName('rose-pine')).toBe('rose-pine')
    expect(parseThemeName('nope')).toBe('dark')
    expect(parseThemeName(undefined)).toBe('dark')
  })
})

describe('detectTrueColor', () => {
  it('lets NO_COLOR and FORCE_COLOR=0 outrank every capability hint', () => {
    expect(detectTrueColor({ NO_COLOR: '1' })).toBe(false)
    expect(detectTrueColor({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe(false)
    expect(detectTrueColor({ NO_COLOR: '0', COLORTERM: 'truecolor' })).toBe(false)
    expect(detectTrueColor({ NO_COLOR: '1', WT_SESSION: '{guid}' })).toBe(false)
    expect(detectTrueColor({ FORCE_COLOR: '0' })).toBe(false)
    expect(detectTrueColor({ FORCE_COLOR: '0', COLORTERM: 'truecolor' })).toBe(false)
  })

  it('treats an empty NO_COLOR as unset', () => {
    // https://no-color.org only disables color for a non-empty value.
    expect(detectTrueColor({ NO_COLOR: '', TERM: 'xterm-256color' })).toBe(true)
    expect(detectTrueColor({ NO_COLOR: '', COLORTERM: 'truecolor' })).toBe(true)
    expect(detectTrueColor({ NO_COLOR: '', TERM: 'dumb' })).toBe(false)
  })

  it('separates an unset FORCE_COLOR from FORCE_COLOR=0', () => {
    expect(detectTrueColor({ FORCE_COLOR: undefined, TERM: 'xterm-256color' })).toBe(true)
    expect(detectTrueColor({ FORCE_COLOR: '1', TERM: 'xterm-256color' })).toBe(true)
    expect(detectTrueColor({ FORCE_COLOR: '0', TERM: 'xterm-256color' })).toBe(false)
  })

  it('honors COLORTERM, Windows Terminal, and known 16-color TERMs', () => {
    expect(detectTrueColor({ COLORTERM: 'truecolor' })).toBe(true)
    expect(detectTrueColor({ COLORTERM: '24bit' })).toBe(true)
    expect(detectTrueColor({ WT_SESSION: '{guid}' })).toBe(true)
    // No 256-color tier yet, so *-256color stays on the 24-bit path.
    expect(detectTrueColor({ TERM: 'xterm-256color' })).toBe(true)
    expect(detectTrueColor({ TERM: 'linux' })).toBe(false)
    expect(detectTrueColor({ TERM: 'dumb' })).toBe(false)
    expect(detectTrueColor({ TERM: '' })).toBe(false)
  })
})

describe('colorDisabledByEnv', () => {
  it('counts only a non-empty NO_COLOR or FORCE_COLOR=0 as a request for no color', () => {
    expect(colorDisabledByEnv({ NO_COLOR: '1' })).toBe(true)
    expect(colorDisabledByEnv({ NO_COLOR: '0' })).toBe(true)
    expect(colorDisabledByEnv({ NO_COLOR: '' })).toBe(false)
    expect(colorDisabledByEnv({ FORCE_COLOR: '0' })).toBe(true)
    expect(colorDisabledByEnv({ FORCE_COLOR: '1' })).toBe(false)
    expect(colorDisabledByEnv({})).toBe(false)
  })
})

describe('chrome', () => {
  it('exports OMP rounded-box and status glyphs', () => {
    expect(BOX.topLeft).toBe('╭')
    expect(SYMBOL.success).toBe('✔')
    expect(SYMBOL.error).toBe('✘')
    expect(SYMBOL.pending).toBe('○')
    expect(SYMBOL.warning).toBe('▲')
  })

  it('paints the DeepSeek logo without styling when colors are off', () => {
    const lines = gradientLogo(createTheme(false))
    expect(lines).toEqual(DEEPSEEK_LOGO)
    expect(lines.every((line) => line.length === 20)).toBe(true)
    expect(lines[1]).toContain('⣿')
    expect(lines[0]).not.toContain('\x1b[')
  })
})
