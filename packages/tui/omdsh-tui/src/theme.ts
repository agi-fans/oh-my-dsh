/**
 * oh-my-pi dark theme, ported to Node (no Bun.color). Semantic colors, rounded
 * box chrome, and status glyphs — the visual vocabulary the rest of the view
 * paints with.
 * @module @omdsh/tui
 */

/** Rounded-box drawing characters (OMP unicode preset). */
export const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeUp: '┴',
  teeDown: '┬',
  teeLeft: '┤',
  teeRight: '├',
  cross: '┼',
} as const

/** Status / list glyphs matching OMP's unicode symbol preset. */
export const SYMBOL = {
  success: '✔',
  error: '✘',
  warning: '⚠',
  info: 'ⓘ',
  pending: '⏳',
  running: '⟳',
  done: '•',
  bullet: '•',
  cursor: '❯',
} as const

/** Braille activity spinner (OMP unicode activity frames). */
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

/** Semantic colors the view addresses. */
export type ThemeColor =
  | 'accent'
  | 'border'
  | 'success'
  | 'error'
  | 'warning'
  | 'muted'
  | 'dim'
  | 'text'
  | 'userMessageText'
  | 'userMessageBg'
  | 'toolPendingBg'
  | 'toolSuccessBg'
  | 'toolErrorBg'
  | 'toolTitle'
  | 'toolOutput'
  | 'mdHeading'
  | 'mdLink'
  | 'mdLinkUrl'
  | 'mdCode'
  | 'mdCodeBlockBorder'
  | 'mdQuote'
  | 'mdListBullet'
  | 'thinkingText'
  | 'customMessageLabel'

/** Resolved palette entry: hex, empty (default fg/bg), or a 256-color index. */
type Swatch = string | number

/** OMP `dark.json` palette. */
const DARK_PALETTE: Record<ThemeColor, Swatch> = {
  accent: '#febc38',
  border: '#178fb9',
  success: '#89d281',
  error: '#fc3a4b',
  warning: '#e4c00f',
  muted: '#777d88',
  dim: '#5f6673',
  text: '',
  userMessageText: '',
  userMessageBg: '#221d1a',
  toolPendingBg: '#1d2129',
  toolSuccessBg: '#161a1f',
  toolErrorBg: '#291d1d',
  toolTitle: '',
  toolOutput: '#777d88',
  mdHeading: '#febc38',
  mdLink: '#0088fa',
  mdLinkUrl: '#5f6673',
  mdCode: '#e5c1ff',
  mdCodeBlockBorder: '#3d424a',
  mdQuote: '#777d88',
  mdListBullet: '#febc38',
  thinkingText: '#777d88',
  customMessageLabel: '#b281d6',
}

/** OMP `light.json` palette. */
const LIGHT_PALETTE: Record<ThemeColor, Swatch> = {
  accent: '#5a8080',
  border: '#547da7',
  success: '#588458',
  error: '#aa5555',
  warning: '#9a7326',
  muted: '#6c6c6c',
  dim: '#767676',
  text: '',
  userMessageText: '',
  userMessageBg: '#e8e8e8',
  toolPendingBg: '#e8e8f0',
  toolSuccessBg: '#e8f0e8',
  toolErrorBg: '#f0e8e8',
  toolTitle: '',
  toolOutput: '#6c6c6c',
  mdHeading: '#9a7326',
  mdLink: '#547da7',
  mdLinkUrl: '#767676',
  mdCode: '#5a8080',
  mdCodeBlockBorder: '#6c6c6c',
  mdQuote: '#6c6c6c',
  mdListBullet: '#588458',
  thinkingText: '#6c6c6c',
  customMessageLabel: '#7e57c2',
}

const MIDNIGHT_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#7aa2f7', border: '#3d59a1', success: '#9ece6a', warning: '#e0af68',
  userMessageBg: '#1a1b26', toolPendingBg: '#16161e', toolSuccessBg: '#1b2430',
  mdHeading: '#bb9af7', mdLink: '#7dcfff', mdCode: '#ff9e64',
}

const SOLARIZED_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#b58900', border: '#268bd2', success: '#859900', error: '#dc322f',
  warning: '#cb4b16', muted: '#839496', dim: '#586e75', userMessageBg: '#073642',
  toolPendingBg: '#002b36', toolSuccessBg: '#073642', toolErrorBg: '#3b2020',
  mdHeading: '#b58900', mdLink: '#268bd2', mdCode: '#2aa198', mdQuote: '#839496',
}

const MONO_PALETTE: Record<ThemeColor, Swatch> = Object.fromEntries(
  Object.keys(DARK_PALETTE).map(key => [key, '']),
) as Record<ThemeColor, Swatch>

const PALETTES: Record<ThemeName, Record<ThemeColor, Swatch>> = {
  dark: DARK_PALETTE,
  light: LIGHT_PALETTE,
  midnight: MIDNIGHT_PALETTE,
  solarized: SOLARIZED_PALETTE,
  mono: MONO_PALETTE,
}

/** 16-color fallbacks when the terminal is not truecolor. */
const DARK_ANSI16: Record<ThemeColor, string> = {
  accent: '33',
  border: '36',
  success: '32',
  error: '31',
  warning: '33',
  muted: '90',
  dim: '90',
  text: '39',
  userMessageText: '39',
  userMessageBg: '40',
  toolPendingBg: '40',
  toolSuccessBg: '40',
  toolErrorBg: '41',
  toolTitle: '39',
  toolOutput: '90',
  mdHeading: '33',
  mdLink: '36',
  mdLinkUrl: '90',
  mdCode: '35',
  mdCodeBlockBorder: '90',
  mdQuote: '90',
  mdListBullet: '33',
  thinkingText: '90',
  customMessageLabel: '35',
}

const LIGHT_ANSI16: Record<ThemeColor, string> = {
  accent: '36',
  border: '34',
  success: '32',
  error: '31',
  warning: '33',
  muted: '90',
  dim: '90',
  text: '39',
  userMessageText: '39',
  userMessageBg: '47',
  toolPendingBg: '47',
  toolSuccessBg: '42',
  toolErrorBg: '41',
  toolTitle: '39',
  toolOutput: '90',
  mdHeading: '33',
  mdLink: '34',
  mdLinkUrl: '90',
  mdCode: '36',
  mdCodeBlockBorder: '90',
  mdQuote: '90',
  mdListBullet: '32',
  thinkingText: '90',
  customMessageLabel: '35',
}

const ANSI16: Record<ThemeName, Record<ThemeColor, string>> = {
  dark: DARK_ANSI16,
  light: LIGHT_ANSI16,
  midnight: DARK_ANSI16,
  solarized: DARK_ANSI16,
  mono: Object.fromEntries(Object.keys(DARK_ANSI16).map(key => [key, '39'])) as Record<ThemeColor, string>,
}

const RESET = '\x1b[0m'

/** Built-in palettes (OMP `dark.json` / `light.json`). */
export const THEME_NAMES = ['dark', 'light', 'midnight', 'solarized', 'mono'] as const

/** One shipped palette name. */
export type ThemeName = (typeof THEME_NAMES)[number]

/** True when `value` is a shipped palette name. */
export function isThemeName(value: string): value is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(value)
}

/** Normalize a config/CLI token to a palette name (`dark` when unknown). */
export function parseThemeName(value: string | undefined): ThemeName {
  return value !== undefined && isThemeName(value) ? value : 'dark'
}

/** Paint helpers the view uses; identity functions when colors are off. */
export interface Theme {
  /** Active palette name. */
  readonly name: ThemeName
  /** Whether SGR is emitted. */
  readonly colors: boolean
  /** Whether hex colors become 24-bit SGR (else 16-color). */
  readonly trueColor: boolean
  fg(color: ThemeColor, text: string): string
  bg(color: ThemeColor, text: string): string
  getFgAnsi(color: ThemeColor): string
  getBgAnsi(color: ThemeColor): string
  bold(text: string): string
  italic(text: string): string
  underline(text: string): string
  strikethrough(text: string): string
  dim(text: string): string
}

function hexToRgb(hex: string): [number, number, number] {
  const body = hex.startsWith('#') ? hex.slice(1) : hex
  return [
    Number.parseInt(body.slice(0, 2), 16),
    Number.parseInt(body.slice(2, 4), 16),
    Number.parseInt(body.slice(4, 6), 16),
  ]
}

function fgCode(swatch: Swatch, trueColor: boolean, fallback: string): string {
  if (swatch === '') return '\x1b[39m'
  if (typeof swatch === 'number') return `\x1b[38;5;${swatch}m`
  if (!trueColor) return `\x1b[${fallback}m`
  const [r, g, b] = hexToRgb(swatch)
  return `\x1b[38;2;${r};${g};${b}m`
}

function bgCode(swatch: Swatch, trueColor: boolean, fallback: string): string {
  if (swatch === '') return '\x1b[49m'
  if (typeof swatch === 'number') return `\x1b[48;5;${swatch}m`
  if (!trueColor) return `\x1b[${fallback}m`
  const [r, g, b] = hexToRgb(swatch)
  return `\x1b[48;2;${r};${g};${b}m`
}

/**
 * Detect 24-bit color the way OMP does: COLORTERM, Windows Terminal, else
 * assume truecolor unless TERM is a known 16-color host.
 */
export function detectTrueColor(env: NodeJS.ProcessEnv = process.env): boolean {
  const colorterm = env.COLORTERM ?? ''
  if (colorterm === 'truecolor' || colorterm === '24bit') return true
  if (env.WT_SESSION) return true
  const term = env.TERM ?? ''
  if (term === 'dumb' || term === '' || term === 'linux') return false
  return true
}

/**
 * Build a theme.
 * @param colors - emit SGR when true.
 * @param trueColor - 24-bit hex; ignored when colors is false.
 * @param name - shipped palette (`dark` default).
 */
export function createTheme(
  colors: boolean,
  trueColor = detectTrueColor(),
  name: ThemeName = 'dark',
): Theme {
  const tc = colors && trueColor
  const palette = PALETTES[name]
  const ansi = ANSI16[name]
  const getFgAnsi = (color: ThemeColor): string =>
    colors ? fgCode(palette[color], tc, ansi[color]) : ''
  const getBgAnsi = (color: ThemeColor): string =>
    colors ? bgCode(palette[color], tc, ansi[color]) : ''
  const paint = (open: string, text: string): string =>
    colors && open !== '' ? open + text + RESET : text
  return {
    name,
    colors,
    trueColor: tc,
    getFgAnsi,
    getBgAnsi,
    fg: (color, text) => paint(getFgAnsi(color), text),
    bg: (color, text) => paint(getBgAnsi(color), text),
    bold: (text) => (colors ? `\x1b[1m${text}${RESET}` : text),
    italic: (text) => (colors ? `\x1b[3m${text}${RESET}` : text),
    underline: (text) => (colors ? `\x1b[4m${text}${RESET}` : text),
    strikethrough: (text) => (colors ? `\x1b[9m${text}${RESET}` : text),
    dim: (text) => paint(getFgAnsi('dim'), text),
  }
}

/** DeepSeek mark adapted from the official SVG for a 20×6 terminal cell. */
export const DEEPSEEK_LOGO = [
  '         ⢀⣀  ⢀⡀     ',
  '⢀⣤⣶⣿⣿⣿⣿⣿⣿⣿⣧⣄⡀⢻⣿⣷⣶⣶⣶⡿',
  '⣿⡟⠛⠛⠛⠿⢿⣿⣿⣿⣿⡿⢿⣷⣾⣿⣿⠉⠉ ',
  '⢻⣿⣄⡀  ⢀⠈⠛⢿⣿⣿⣶⣿⣿⡿⠃   ',
  ' ⠙⠻⢿⣶⣦⣼⣿⣷⣦⣭⣿⠿⣿⣷⠦    ',
  '     ⠉⠉⠉⠉⠉⠁         ',
] as const

/** @deprecated Use {@link DEEPSEEK_LOGO}; retained for API compatibility. */
export const PI_LOGO = [
  '▀██████████▀',
  ' ╘██    ██  ',
  '  ██    ██  ',
  '  ██    ██  ',
  ' ▄██▄  ▄██▄ ',
] as const

const GRADIENT_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [255, 92, 200],
  [200, 110, 255],
  [120, 130, 255],
  [60, 200, 255],
  [120, 255, 220],
]

const GRADIENT_RAMP_256 = [199, 171, 135, 99, 75, 51, 87]

function gradientEscape(t: number, trueColor: boolean): string {
  if (trueColor) {
    const seg = t * (GRADIENT_STOPS.length - 1)
    const i = Math.min(GRADIENT_STOPS.length - 2, Math.floor(seg))
    const f = seg - i
    const a = GRADIENT_STOPS[i] ?? GRADIENT_STOPS[0]!
    const b = GRADIENT_STOPS[i + 1] ?? a
    const r = Math.round(a[0] + (b[0] - a[0]) * f)
    const g = Math.round(a[1] + (b[1] - a[1]) * f)
    const bl = Math.round(a[2] + (b[2] - a[2]) * f)
    return `\x1b[38;2;${r};${g};${bl}m`
  }
  const idx = Math.min(GRADIENT_RAMP_256.length - 1, Math.max(0, Math.floor(t * (GRADIENT_RAMP_256.length - 1) + 0.5)))
  return `\x1b[38;5;${GRADIENT_RAMP_256[idx]}m`
}

/**
 * Diagonal gradient across the DeepSeek logo.
 * Unstyled when colors are off.
 */
export function gradientLogo(theme: Theme, lines: readonly string[] = DEEPSEEK_LOGO): string[] {
  if (!theme.colors) return [...lines]
  const reset = '\x1b[0m'
  const rows = lines.length
  const cols = Math.max(0, ...lines.map((line) => line.length))
  const span = Math.max(1, cols + rows - 1)
  return lines.map((line, y) => {
    let out = ''
    for (let x = 0; x < line.length; x += 1) {
      const ch = line[x] ?? ' '
      if (ch === ' ') {
        out += ch
        continue
      }
      const t = (x + (rows - 1 - y)) / span
      out += gradientEscape(t, theme.trueColor) + ch + reset
    }
    return out
  })
}
