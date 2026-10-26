import { describe, expect, it } from 'vitest'
import { BOX, colorDisabledByEnv, createTheme, DEEPSEEK_LOGO, detectColorDepth, gradientLogo, parseThemeName, SYMBOL, THEME_NAMES, type ThemeColor } from './theme.ts'

/** Every semantic color a view can address; mirrors the `ThemeColor` union. */
const THEME_COLORS: readonly ThemeColor[] = [
  'accent', 'border', 'borderAccent', 'borderMuted', 'success', 'error', 'warning',
  'muted', 'dim', 'text', 'userMessageText', 'userMessageBg', 'toolPendingBg',
  'toolSuccessBg', 'toolAltBg', 'toolErrorBg', 'toolTitle', 'toolOutput', 'toolDiffAdded',
  'toolDiffRemoved', 'toolDiffContext', 'mdHeading', 'mdLink', 'mdLinkUrl', 'mdCode',
  'mdCodeBlock', 'mdCodeBlockBorder', 'mdKeyword', 'mdQuote', 'mdListBullet',
  'thinkingText', 'customMessageLabel',
  'syntaxString', 'syntaxNumber', 'syntaxFunction', 'syntaxType',
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
    expect(theme.getFgAnsi('accent')).toBe('\x1b[38;2;124;147;255m')
    expect(theme.getFgAnsi('mdLink')).toBe('\x1b[38;2;124;147;255m')
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
    // The tool states no longer share a fill, so the error card is not the same
    // code the plain card uses.
    expect(dark.getBgAnsi('toolErrorBg')).not.toBe(dark.getBgAnsi('toolSuccessBg'))
    expect(dark.getBgAnsi('text')).toBe('\x1b[49m')
    const light = createTheme(true, false, 'light')
    expect(light.getBgAnsi('userMessageBg')).toBe('\x1b[47m')
    expect(light.getBgAnsi('toolSuccessBg')).toBe('\x1b[47m')
    expect(light.getBgAnsi('accent')).toBe('\x1b[44m')
  })

  it('builds the system palette from what the terminal reported', () => {
    const background = { r: 0x10, g: 0x12, b: 0x18 }
    const foreground = { r: 0xe6, g: 0xe6, b: 0xe6 }
    const terminal = { background, foreground, scheme: 'dark' as const }
    const theme = createTheme(true, true, 'system', terminal)
    // Ink follows the reported foreground instead of the shipped palette.
    expect(theme.getFgAnsi('text')).toBe('\x1b[38;2;230;230;230m')
    // The two call surfaces stay apart, which is what makes alternation readable.
    expect(theme.getBgAnsi('toolSuccessBg')).not.toBe(theme.getBgAnsi('toolAltBg'))
    expect(theme.getBgAnsi('toolAltBg')).not.toBe('\x1b[48;2;16;18;24m')
  })

  it('follows the reported color scheme for the system palette', () => {
    const light = createTheme(true, true, 'system', { scheme: 'light' })
    const dark = createTheme(true, true, 'system', { scheme: 'dark' })
    expect(light.getFgAnsi('userMessageText')).not.toBe(dark.getFgAnsi('userMessageText'))
    // Without a probe the system palette is the neutral one.
    expect(createTheme(true, true, 'system').getFgAnsi('text')).toBe(createTheme(true, true, 'dark').getFgAnsi('text'))
  })

  it('does not crash when a terminal reports an incomplete palette', () => {
    // The reported regression: a sparse palette reached the nearest-color scan
    // and threw while the TUI was starting.
    const sparse = Array.from({ length: 16 }, () => undefined) as unknown as { r: number; g: number; b: number }[]
    sparse[2] = { r: 0, g: 128, b: 0 }
    const terminal = { background: { r: 0, g: 0, b: 0 }, foreground: { r: 255, g: 255, b: 255 }, palette: sparse }
    expect(() => createTheme(true, false, 'system', terminal)).not.toThrow()
    expect(() => createTheme(true, false, 'system', terminal).getFgAnsi('text')).not.toThrow()
  })

  it('quantizes to the reported 16-color palette instead of a fixed shift', () => {
    const palette = Array.from({ length: 16 }, (_, index) => ({ r: index * 16, g: 0, b: 0 }))
    const terminal = { background: { r: 0, g: 0, b: 0 }, foreground: { r: 240, g: 240, b: 240 }, palette }
    const theme = createTheme(true, false, 'system', terminal)
    // Scheme/inventory is taken from the terminal, so ink is a plain ANSI code.
    expect(theme.getFgAnsi('text')).toMatch(/^\x1b\[(3[0-7]|9[0-7])m$/u)
    expect(theme.getBgAnsi('toolSuccessBg')).toMatch(/^\x1b\[(4[0-7]|10[0-7]|49)m$/u)
  })

  it('keeps exact 24-bit swatches on a true-color terminal that reports its palette', () => {
    // Every modern terminal answers OSC 4; that report must not downgrade a
    // true-color theme to the sixteen entries it lists.
    const palette = Array.from({ length: 16 }, (_, index) => ({ r: index * 16, g: index * 16, b: index * 16 }))
    for (const name of THEME_NAMES) {
      const plain = createTheme(true, true, name)
      const reported = createTheme(true, true, name, { palette })
      expect(reported.getBgAnsi('toolSuccessBg')).toBe(plain.getBgAnsi('toolSuccessBg'))
      expect(reported.getBgAnsi('toolAltBg')).toBe(plain.getBgAnsi('toolAltBg'))
      expect(reported.getFgAnsi('accent')).toBe(plain.getFgAnsi('accent'))
    }
    expect(createTheme(true, true, 'dark', { palette }).getBgAnsi('toolSuccessBg')).toMatch(/^\x1b\[48;2;/u)
  })

  it('encodes hex swatches on the 256-color cube at 256-color depth', () => {
    const theme = createTheme(true, 'ansi256', 'dark')
    expect(theme.trueColor).toBe(false)
    expect(theme.depth).toBe('ansi256')
    const fill = theme.getBgAnsi('toolSuccessBg')
    expect(fill).toMatch(/^\x1b\[48;5;(\d+)m$/u)
    // The user-configurable first sixteen entries are never chosen.
    expect(Number(/48;5;(\d+)m/u.exec(fill)![1])).toBeGreaterThanOrEqual(16)
    expect(theme.getFgAnsi('accent')).toMatch(/^\x1b\[38;5;\d+m$/u)
    // A reported palette does not change a 256-color encoding.
    const palette = Array.from({ length: 16 }, (_, index) => ({ r: index * 16, g: 0, b: 0 }))
    expect(createTheme(true, 'ansi256', 'dark', { palette }).getBgAnsi('toolSuccessBg')).toBe(fill)
  })

  it('detects the color depth from the environment', () => {
    expect(detectColorDepth({ COLORTERM: 'truecolor', TERM: 'xterm-256color' })).toBe('truecolor')
    expect(detectColorDepth({ TERM: 'xterm-256color', TERM_PROGRAM: 'Apple_Terminal' })).toBe('ansi256')
    expect(detectColorDepth({ COLORTERM: 'truecolor', TERM_PROGRAM: 'Apple_Terminal' })).toBe('truecolor')
    expect(detectColorDepth({ TERM: 'linux' })).toBe('ansi16')
    expect(detectColorDepth({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe('ansi16')
    expect(detectColorDepth({ TERM: 'xterm-256color' })).toBe('truecolor')
    expect(detectColorDepth({ TERM: 'xterm-256color', TERM_PROGRAM: 'Apple_Terminal' })).toBe('ansi256')
  })

  it('keeps the three tool states on three different 16-color backgrounds', () => {
    // A tool card's state used to be invisible below truecolor: pending,
    // success, and error all quantized onto SGR 40. The three fills are now
    // resolved as a group, so at least the states a reader acts on differ.
    const dark = createTheme(true, false, 'dark')
    expect(dark.getBgAnsi('toolPendingBg')).not.toBe(dark.getBgAnsi('toolSuccessBg'))
    expect(dark.getBgAnsi('toolErrorBg')).not.toBe(dark.getBgAnsi('toolSuccessBg'))
    // Alternation stays a truecolor affordance: the 16-color tier has no spare
    // subtle fill, so the alternating card drops its own instead of inventing
    // one that would erase the hints drawn on it.
    expect(dark.getBgAnsi('toolAltBg')).toBe('\x1b[49m')
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
    expect(light.getFgAnsi('accent')).toBe('\x1b[38;2;59;87;224m')
    expect(light.getFgAnsi('accent')).not.toBe(dark.getFgAnsi('accent'))
  })

  it('ships one dark, one light, and the theme that follows the terminal', () => {
    // A theme is a legibility contract for every card, diff, and syntax token,
    // and a palette that cannot meet it is worse than no palette at all.
    expect(THEME_NAMES).toEqual(['dark', 'light', 'system'])
    for (const name of THEME_NAMES) {
      const theme = createTheme(true, true, name)
      expect(theme.name).toBe(name)
      expect(theme.getFgAnsi('thinkingText')).not.toBe(theme.getFgAnsi('text'))
    }
  })

  it('keeps muted borders and fence keywords off the UI accent', () => {
    for (const name of ['dark', 'light'] as const) {
      const theme = createTheme(true, true, name)
      expect(theme.getFgAnsi('mdKeyword'), name).not.toBe(theme.getFgAnsi('accent'))
      expect(theme.getFgAnsi('borderMuted'), name).not.toBe(theme.getFgAnsi('border'))
    }
  })

  it('keeps thinking text quieter than muted chrome', () => {
    const dark = createTheme(true, true, 'dark')
    expect(dark.getFgAnsi('thinkingText')).toBe('\x1b[38;2;107;114;128m')
    expect(dark.getFgAnsi('thinkingText')).not.toBe(dark.getFgAnsi('text'))
    expect(dark.getFgAnsi('thinkingText')).not.toBe(dark.getFgAnsi('muted'))
    expect(dark.getFgAnsi('thinkingText')).not.toBe(dark.getFgAnsi('dim'))
  })

  it('lets the terminal own body ink while keeping thinking explicitly muted', () => {
    for (const name of THEME_NAMES) {
      const theme = createTheme(true, true, name)
      expect(theme.getFgAnsi('text'), name).toBe('\x1b[39m')
      expect(theme.getFgAnsi('thinkingText'), name).not.toBe(theme.getFgAnsi('text'))
      expect(theme.getFgAnsi('thinkingText'), name).not.toBe(theme.getFgAnsi('dim'))
    }
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
    for (const name of ['dark', 'light'] as const) {
      const theme = createTheme(true, true, name)
      expect(theme.getFgAnsi('mdCode'), name).not.toBe(theme.getFgAnsi('accent'))
      expect(theme.getFgAnsi('mdCode'), name).not.toBe(theme.getFgAnsi('text'))
    }
    expect(createTheme(true, false).getFgAnsi('mdCode')).toBe('\x1b[90m')
  })
})

describe('parseThemeName', () => {
  it('accepts shipped names and falls back to dark', () => {
    expect(parseThemeName('light')).toBe('light')
    expect(parseThemeName('dark')).toBe('dark')
    expect(parseThemeName('system')).toBe('system')
    // A palette this version no longer ships falls back rather than failing to
    // start: the setting outlives the theme that once matched it.
    expect(parseThemeName('catppuccin')).toBe('dark')
    expect(parseThemeName('nope')).toBe('dark')
    expect(parseThemeName(undefined)).toBe('dark')
  })
})

describe('detectColorDepth disabling hints', () => {
  it('lets NO_COLOR and FORCE_COLOR=0 outrank every capability hint', () => {
    expect(detectColorDepth({ NO_COLOR: '1' })).toBe('ansi16')
    expect(detectColorDepth({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe('ansi16')
    expect(detectColorDepth({ NO_COLOR: '0', COLORTERM: 'truecolor' })).toBe('ansi16')
    expect(detectColorDepth({ NO_COLOR: '1', WT_SESSION: '{guid}' })).toBe('ansi16')
    expect(detectColorDepth({ FORCE_COLOR: '0' })).toBe('ansi16')
    expect(detectColorDepth({ FORCE_COLOR: '0', COLORTERM: 'truecolor' })).toBe('ansi16')
  })

  it('treats an empty NO_COLOR as unset', () => {
    // https://no-color.org only disables color for a non-empty value.
    expect(detectColorDepth({ NO_COLOR: '', TERM: 'xterm-256color' })).toBe('truecolor')
    expect(detectColorDepth({ NO_COLOR: '', COLORTERM: 'truecolor' })).toBe('truecolor')
    expect(detectColorDepth({ NO_COLOR: '', TERM: 'dumb' })).toBe('ansi16')
  })

  it('separates an unset FORCE_COLOR from FORCE_COLOR=0', () => {
    expect(detectColorDepth({ FORCE_COLOR: undefined, TERM: 'xterm-256color' })).toBe('truecolor')
    expect(detectColorDepth({ FORCE_COLOR: '1', TERM: 'xterm-256color' })).toBe('truecolor')
    expect(detectColorDepth({ FORCE_COLOR: '0', TERM: 'xterm-256color' })).toBe('ansi16')
  })

  it('honors COLORTERM, Windows Terminal, and known 16-color TERMs', () => {
    expect(detectColorDepth({ COLORTERM: 'truecolor' })).toBe('truecolor')
    expect(detectColorDepth({ COLORTERM: '24bit' })).toBe('truecolor')
    expect(detectColorDepth({ WT_SESSION: '{guid}' })).toBe('truecolor')
    // No 256-color tier yet, so *-256color stays on the 24-bit path.
    expect(detectColorDepth({ TERM: 'xterm-256color' })).toBe('truecolor')
    expect(detectColorDepth({ TERM: 'linux' })).toBe('ansi16')
    expect(detectColorDepth({ TERM: 'dumb' })).toBe('ansi16')
    expect(detectColorDepth({ TERM: '' })).toBe('ansi16')
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

describe('theme.key', () => {
  it('changes with the color depth and the reported terminal colors', () => {
    expect(createTheme(true, 'ansi16').key).not.toBe(createTheme(true, 'ansi256').key)
    const dark = createTheme(true, 'truecolor', 'system', { background: { r: 10, g: 10, b: 10 }, scheme: 'dark' })
    const light = createTheme(true, 'truecolor', 'system', { background: { r: 245, g: 245, b: 245 }, scheme: 'light' })
    expect(dark.key).not.toBe(light.key)
  })
})

describe('Apple Terminal depth', () => {
  const apple = (version?: string) => ({ TERM: 'xterm-256color', TERM_PROGRAM: 'Apple_Terminal', ...(version === undefined ? {} : { TERM_PROGRAM_VERSION: version }) })
  it('keeps the 256-color palette before Terminal 2.15 (build 464)', () => {
    expect(detectColorDepth(apple('455.1'))).toBe('ansi256')
    expect(detectColorDepth(apple())).toBe('ansi256')
  })
  it('enables 24-bit color on Terminal 2.15 and later', () => {
    expect(detectColorDepth(apple('464'))).toBe('truecolor')
    expect(detectColorDepth(apple('465.2'))).toBe('truecolor')
    expect(detectColorDepth({ ...apple('455.1'), COLORTERM: 'truecolor' })).toBe('truecolor')
  })
})
