import { describe, expect, it } from 'vitest'
import { BOX, createTheme, DEEPSEEK_LOGO, detectTrueColor, gradientLogo, parseThemeName, SYMBOL } from './theme.ts'

describe('createTheme', () => {
  it('is identity when colors are off', () => {
    const theme = createTheme(false, true)
    expect(theme.fg('accent', 'x')).toBe('x')
    expect(theme.bold('x')).toBe('x')
    expect(theme.underline('x')).toBe('x')
    expect(theme.strikethrough('x')).toBe('x')
    expect(theme.getFgAnsi('accent')).toBe('')
  })

  it('emits 24-bit SGR for hex colors', () => {
    const theme = createTheme(true, true)
    expect(theme.getFgAnsi('accent')).toBe('\x1b[38;2;254;188;56m')
    expect(theme.getFgAnsi('mdLink')).toBe('\x1b[38;2;0;136;250m')
    expect(theme.underline('x')).toBe('\x1b[4mx\x1b[0m')
    expect(theme.strikethrough('x')).toBe('\x1b[9mx\x1b[0m')
    expect(theme.fg('success', 'ok')).toContain('ok')
    expect(theme.fg('success', 'ok')).toContain('\x1b[0m')
  })

  it('falls back to 16-color SGR without truecolor', () => {
    const theme = createTheme(true, false)
    expect(theme.getFgAnsi('error')).toBe('\x1b[31m')
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
    expect(createTheme(true, true, 'midnight').name).toBe('midnight')
    expect(createTheme(true, true, 'solarized').name).toBe('solarized')
    expect(createTheme(true, true, 'mono').name).toBe('mono')
  })
})

describe('parseThemeName', () => {
  it('accepts shipped names and falls back to dark', () => {
    expect(parseThemeName('light')).toBe('light')
    expect(parseThemeName('dark')).toBe('dark')
    expect(parseThemeName('midnight')).toBe('midnight')
    expect(parseThemeName('nope')).toBe('dark')
    expect(parseThemeName(undefined)).toBe('dark')
  })
})

describe('detectTrueColor', () => {
  it('honors COLORTERM and known 16-color TERMs', () => {
    expect(detectTrueColor({ COLORTERM: 'truecolor' })).toBe(true)
    expect(detectTrueColor({ TERM: 'linux' })).toBe(false)
  })
})

describe('chrome', () => {
  it('exports OMP rounded-box and status glyphs', () => {
    expect(BOX.topLeft).toBe('╭')
    expect(SYMBOL.success).toBe('✔')
    expect(SYMBOL.error).toBe('✘')
  })

  it('paints the DeepSeek logo without styling when colors are off', () => {
    const lines = gradientLogo(createTheme(false))
    expect(lines).toEqual(DEEPSEEK_LOGO)
    expect(lines.every((line) => line.length === 20)).toBe(true)
    expect(lines[1]).toContain('⣿')
    expect(lines[0]).not.toContain('\x1b[')
  })
})
