/**
 * oh-my-pi dark theme, ported to Node (no Bun.color). Semantic colors, rounded
 * box chrome, and status glyphs — the visual vocabulary the rest of the view
 * paints with.
 * @module @agi-fans/dsh-tui
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
  | 'borderAccent'
  | 'borderMuted'
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
  | 'toolDiffAdded'
  | 'toolDiffRemoved'
  | 'toolDiffContext'
  | 'mdHeading'
  | 'mdLink'
  | 'mdLinkUrl'
  | 'mdCode'
  | 'mdCodeBlock'
  | 'mdCodeBlockBorder'
  | 'mdKeyword'
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
  borderAccent: '#0088fa',
  borderMuted: '#3d424a',
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
  toolDiffAdded: '#89d281',
  toolDiffRemoved: '#fc3a4b',
  toolDiffContext: '#5f6673',
  mdHeading: '#febc38',
  mdLink: '#0088fa',
  mdLinkUrl: '#5f6673',
  mdCode: '#8a9099',
  mdCodeBlock: '#9cdcfe',
  mdCodeBlockBorder: '#3d424a',
  mdKeyword: '#569cd6',
  mdQuote: '#777d88',
  mdListBullet: '#febc38',
  thinkingText: '#6b7280',
  customMessageLabel: '#b281d6',
}

/** OMP `light.json` palette. */
const LIGHT_PALETTE: Record<ThemeColor, Swatch> = {
  accent: '#5a8080',
  border: '#547da7',
  borderAccent: '#5a8080',
  borderMuted: '#b0b0b0',
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
  toolDiffAdded: '#588458',
  toolDiffRemoved: '#aa5555',
  toolDiffContext: '#767676',
  mdHeading: '#9a7326',
  mdLink: '#547da7',
  mdLinkUrl: '#767676',
  mdCode: '#5a8080',
  mdCodeBlock: '#5a8080',
  mdCodeBlockBorder: '#6c6c6c',
  mdKeyword: '#0451a5',
  mdQuote: '#6c6c6c',
  mdListBullet: '#588458',
  thinkingText: '#6c6c6c',
  customMessageLabel: '#7e57c2',
}

const MIDNIGHT_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#7aa2f7',
  border: '#3d59a1',
  borderAccent: '#7dcfff',
  borderMuted: '#3d424a',
  success: '#9ece6a',
  error: '#f7768e',
  warning: '#e0af68',
  muted: '#777d88',
  dim: '#5f6673',
  text: '',
  userMessageBg: '#1a1b26',
  toolPendingBg: '#16161e',
  toolSuccessBg: '#1b2430',
  toolErrorBg: '#2a1b26',
  toolOutput: '#777d88',
  toolDiffAdded: '#9ece6a',
  toolDiffRemoved: '#f7768e',
  toolDiffContext: '#5f6673',
  mdHeading: '#bb9af7',
  mdLink: '#7dcfff',
  mdLinkUrl: '#5f6673',
  mdCode: '#7f8799',
  mdCodeBlock: '#9aa5ce',
  mdCodeBlockBorder: '#3d424a',
  mdKeyword: '#bb9af7',
  mdQuote: '#777d88',
  mdListBullet: '#7aa2f7',
  thinkingText: '#6a7394',
  customMessageLabel: '#bb9af7',
}

const SOLARIZED_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#b58900',
  border: '#268bd2',
  borderAccent: '#2aa198',
  borderMuted: '#586e75',
  success: '#859900',
  error: '#dc322f',
  warning: '#cb4b16',
  muted: '#839496',
  dim: '#586e75',
  text: '',
  userMessageBg: '#073642',
  toolPendingBg: '#002b36',
  toolSuccessBg: '#073642',
  toolErrorBg: '#3b2020',
  toolOutput: '#839496',
  toolDiffAdded: '#859900',
  toolDiffRemoved: '#dc322f',
  toolDiffContext: '#586e75',
  mdHeading: '#b58900',
  mdLink: '#268bd2',
  mdLinkUrl: '#586e75',
  mdCode: '#93a1a1',
  mdCodeBlock: '#2aa198',
  mdCodeBlockBorder: '#073642',
  mdKeyword: '#859900',
  mdQuote: '#839496',
  mdListBullet: '#b58900',
  thinkingText: '#586e75',
  customMessageLabel: '#6c71c4',
}

const CATPPUCCIN_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#fab387',
  border: '#89b4fa',
  borderAccent: '#b4befe',
  borderMuted: '#313244',
  success: '#a6e3a1',
  error: '#f38ba8',
  warning: '#f9e2af',
  muted: '#7f849c',
  dim: '#6c7086',
  text: '',
  userMessageBg: '#181825',
  toolPendingBg: '#313244',
  toolSuccessBg: '#181825',
  toolErrorBg: '#11111b',
  toolTitle: '#b4befe',
  toolOutput: '#7f849c',
  toolDiffAdded: '#a6e3a1',
  toolDiffRemoved: '#f38ba8',
  toolDiffContext: '#7f849c',
  mdHeading: '#fab387',
  mdLink: '#89b4fa',
  mdLinkUrl: '#6c7086',
  mdCode: '#a6adc8',
  mdCodeBlock: '#cdd6f4',
  mdCodeBlockBorder: '#313244',
  mdKeyword: '#cba6f7',
  mdQuote: '#7f849c',
  mdListBullet: '#fab387',
  thinkingText: '#6c7086',
  customMessageLabel: '#cba6f7',
}

const DRACULA_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#bd93f9',
  border: '#bd93f9',
  borderAccent: '#ff79c6',
  borderMuted: '#44475a',
  success: '#50fa7b',
  error: '#ff5555',
  warning: '#f1fa8c',
  muted: '#6272a4',
  dim: '#44475a',
  text: '',
  userMessageBg: '#1f2029',
  toolPendingBg: '#21222c',
  toolSuccessBg: '#1a1f1e',
  toolErrorBg: '#2a2028',
  toolTitle: '#8be9fd',
  toolOutput: '#6272a4',
  toolDiffAdded: '#50fa7b',
  toolDiffRemoved: '#ff5555',
  toolDiffContext: '#6272a4',
  mdHeading: '#bd93f9',
  mdLink: '#8be9fd',
  mdLinkUrl: '#6272a4',
  mdCode: '#9aa3c7',
  mdCodeBlock: '#f8f8f2',
  mdCodeBlockBorder: '#44475a',
  mdKeyword: '#ff79c6',
  mdQuote: '#6272a4',
  mdListBullet: '#ff79c6',
  thinkingText: '#6272a4',
  customMessageLabel: '#bd93f9',
}

const NORD_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#88c0d0',
  border: '#5e81ac',
  borderAccent: '#88c0d0',
  borderMuted: '#434c5e',
  success: '#a3be8c',
  error: '#bf616a',
  warning: '#ebcb8b',
  muted: '#7b88a1',
  dim: '#4c566a',
  text: '',
  userMessageBg: '#3b4252',
  toolPendingBg: '#3b4252',
  toolSuccessBg: '#2e3440',
  toolErrorBg: '#3b2f31',
  toolTitle: '#88c0d0',
  toolOutput: '#7b88a1',
  toolDiffAdded: '#a3be8c',
  toolDiffRemoved: '#bf616a',
  toolDiffContext: '#7b88a1',
  mdHeading: '#88c0d0',
  mdLink: '#88c0d0',
  mdLinkUrl: '#4c566a',
  mdCode: '#81a1c1',
  mdCodeBlock: '#d8dee9',
  mdCodeBlockBorder: '#434c5e',
  mdKeyword: '#81a1c1',
  mdQuote: '#7b88a1',
  mdListBullet: '#81a1c1',
  thinkingText: '#6b768d',
  customMessageLabel: '#b48ead',
}

const GRUVBOX_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#fe8019',
  border: '#458588',
  borderAccent: '#8ec07c',
  borderMuted: '#504945',
  success: '#b8bb26',
  error: '#fb4934',
  warning: '#fabd2f',
  muted: '#928374',
  dim: '#7c6f64',
  text: '',
  userMessageBg: '#1d2021',
  toolPendingBg: '#32302f',
  toolSuccessBg: '#1d2021',
  toolErrorBg: '#3c2021',
  toolTitle: '#ebdbb2',
  toolOutput: '#928374',
  toolDiffAdded: '#b8bb26',
  toolDiffRemoved: '#fb4934',
  toolDiffContext: '#928374',
  mdHeading: '#fabd2f',
  mdLink: '#8ec07c',
  mdLinkUrl: '#7c6f64',
  mdCode: '#bdae93',
  mdCodeBlock: '#ebdbb2',
  mdCodeBlockBorder: '#504945',
  mdKeyword: '#d3869b',
  mdQuote: '#928374',
  mdListBullet: '#fe8019',
  thinkingText: '#7c6f64',
  customMessageLabel: '#d3869b',
}

const ROSE_PINE_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#c4a7e7',
  border: '#31748f',
  borderAccent: '#9ccfd8',
  borderMuted: '#403d52',
  success: '#9ccfd8',
  error: '#eb6f92',
  warning: '#f6c177',
  muted: '#6e6a86',
  dim: '#524f67',
  text: '',
  userMessageBg: '#21202e',
  toolPendingBg: '#1f1d2e',
  toolSuccessBg: '#21202e',
  toolErrorBg: '#2d1f26',
  toolTitle: '#9ccfd8',
  toolOutput: '#6e6a86',
  toolDiffAdded: '#9ccfd8',
  toolDiffRemoved: '#eb6f92',
  toolDiffContext: '#6e6a86',
  mdHeading: '#c4a7e7',
  mdLink: '#9ccfd8',
  mdLinkUrl: '#908caa',
  mdCode: '#a8a4c4',
  mdCodeBlock: '#e0def4',
  mdCodeBlockBorder: '#403d52',
  mdKeyword: '#31748f',
  mdQuote: '#6e6a86',
  mdListBullet: '#c4a7e7',
  thinkingText: '#6e6a86',
  customMessageLabel: '#c4a7e7',
}

const MONO_PALETTE: Record<ThemeColor, Swatch> = {
  accent: '#e8e8e8',
  border: '#888888',
  borderAccent: '#b8b8b8',
  borderMuted: '#444444',
  success: '#c0c0c0',
  error: '#f0f0f0',
  warning: '#a8a8a8',
  muted: '#888888',
  dim: '#666666',
  text: '',
  userMessageText: '',
  userMessageBg: '#202020',
  toolPendingBg: '#242424',
  toolSuccessBg: '#1c1c1c',
  toolErrorBg: '#2a2a2a',
  toolTitle: '',
  toolOutput: '#888888',
  toolDiffAdded: '#c0c0c0',
  toolDiffRemoved: '#f0f0f0',
  toolDiffContext: '#666666',
  mdHeading: '#e8e8e8',
  mdLink: '#b8b8b8',
  mdLinkUrl: '#666666',
  mdCode: '#a0a0a0',
  mdCodeBlock: '#c0c0c0',
  mdCodeBlockBorder: '#444444',
  mdKeyword: '#b8b8b8',
  mdQuote: '#888888',
  mdListBullet: '#b8b8b8',
  thinkingText: '#767676',
  customMessageLabel: '#a8a8a8',
}

const PALETTES: Record<ThemeName, Record<ThemeColor, Swatch>> = {
  dark: DARK_PALETTE,
  light: LIGHT_PALETTE,
  midnight: MIDNIGHT_PALETTE,
  solarized: SOLARIZED_PALETTE,
  catppuccin: CATPPUCCIN_PALETTE,
  dracula: DRACULA_PALETTE,
  nord: NORD_PALETTE,
  gruvbox: GRUVBOX_PALETTE,
  'rose-pine': ROSE_PINE_PALETTE,
  mono: MONO_PALETTE,
}

/** 16-color fallbacks when the terminal is not truecolor. */
const DARK_ANSI16: Record<ThemeColor, string> = {
  accent: '33',
  border: '36',
  borderAccent: '36',
  borderMuted: '90',
  success: '32',
  error: '31',
  warning: '33',
  muted: '37',
  dim: '90',
  text: '39',
  userMessageText: '39',
  userMessageBg: '40',
  toolPendingBg: '40',
  toolSuccessBg: '40',
  toolErrorBg: '41',
  toolTitle: '39',
  toolOutput: '37',
  toolDiffAdded: '32',
  toolDiffRemoved: '31',
  toolDiffContext: '90',
  mdHeading: '33',
  mdLink: '36',
  mdLinkUrl: '90',
  mdCode: '90',
  mdCodeBlock: '36',
  mdCodeBlockBorder: '90',
  mdKeyword: '36',
  mdQuote: '37',
  mdListBullet: '33',
  thinkingText: '90',
  customMessageLabel: '35',
}

const LIGHT_ANSI16: Record<ThemeColor, string> = {
  accent: '36',
  border: '34',
  borderAccent: '36',
  borderMuted: '90',
  success: '32',
  error: '31',
  warning: '33',
  muted: '30',
  dim: '90',
  text: '39',
  userMessageText: '39',
  userMessageBg: '47',
  toolPendingBg: '47',
  toolSuccessBg: '42',
  toolErrorBg: '41',
  toolTitle: '39',
  toolOutput: '30',
  toolDiffAdded: '32',
  toolDiffRemoved: '31',
  toolDiffContext: '90',
  mdHeading: '33',
  mdLink: '34',
  mdLinkUrl: '90',
  mdCode: '90',
  mdCodeBlock: '36',
  mdCodeBlockBorder: '90',
  mdKeyword: '34',
  mdQuote: '30',
  mdListBullet: '32',
  thinkingText: '90',
  customMessageLabel: '35',
}

const MIDNIGHT_ANSI16: Record<ThemeColor, string> = {
  ...DARK_ANSI16,
  accent: '34',
  border: '34',
  borderAccent: '36',
  mdHeading: '35',
  mdLink: '36',
  mdKeyword: '35',
  mdListBullet: '34',
  customMessageLabel: '35',
}

const SOLARIZED_ANSI16: Record<ThemeColor, string> = {
  ...DARK_ANSI16,
  accent: '33',
  border: '34',
  borderAccent: '36',
  mdHeading: '33',
  mdLink: '34',
  mdKeyword: '32',
  mdCodeBlock: '36',
  mdListBullet: '33',
  customMessageLabel: '35',
}

const CATPPUCCIN_ANSI16: Record<ThemeColor, string> = {
  ...DARK_ANSI16,
  accent: '33',
  border: '34',
  borderAccent: '35',
  mdHeading: '33',
  mdLink: '34',
  mdKeyword: '35',
  mdListBullet: '33',
  customMessageLabel: '35',
}

const DRACULA_ANSI16: Record<ThemeColor, string> = {
  ...DARK_ANSI16,
  accent: '35',
  border: '35',
  borderAccent: '35',
  mdHeading: '35',
  mdLink: '36',
  mdKeyword: '35',
  mdListBullet: '35',
  customMessageLabel: '35',
}

const NORD_ANSI16: Record<ThemeColor, string> = {
  ...DARK_ANSI16,
  accent: '36',
  border: '34',
  borderAccent: '36',
  mdHeading: '36',
  mdLink: '36',
  mdKeyword: '34',
  mdListBullet: '34',
  customMessageLabel: '35',
}

const GRUVBOX_ANSI16: Record<ThemeColor, string> = {
  ...DARK_ANSI16,
  accent: '33',
  border: '36',
  borderAccent: '32',
  mdHeading: '33',
  mdLink: '32',
  mdKeyword: '35',
  mdListBullet: '33',
  customMessageLabel: '35',
}

const ROSE_PINE_ANSI16: Record<ThemeColor, string> = {
  ...DARK_ANSI16,
  accent: '35',
  border: '36',
  borderAccent: '36',
  mdHeading: '35',
  mdLink: '36',
  mdKeyword: '36',
  mdListBullet: '35',
  customMessageLabel: '35',
}

const MONO_ANSI16: Record<ThemeColor, string> = {
  ...DARK_ANSI16,
  accent: '97',
  border: '37',
  borderAccent: '97',
  success: '37',
  error: '97',
  warning: '37',
  muted: '37',
  mdHeading: '97',
  mdLink: '37',
  mdCodeBlock: '37',
  mdKeyword: '37',
  mdListBullet: '37',
  customMessageLabel: '37',
}

const ANSI16: Record<ThemeName, Record<ThemeColor, string>> = {
  dark: DARK_ANSI16,
  light: LIGHT_ANSI16,
  midnight: MIDNIGHT_ANSI16,
  solarized: SOLARIZED_ANSI16,
  catppuccin: CATPPUCCIN_ANSI16,
  dracula: DRACULA_ANSI16,
  nord: NORD_ANSI16,
  gruvbox: GRUVBOX_ANSI16,
  'rose-pine': ROSE_PINE_ANSI16,
  mono: MONO_ANSI16,
}

const FG_RESET = '\x1b[39m'
const BG_RESET = '\x1b[49m'
const BOLD_RESET = '\x1b[22m'
const ITALIC_RESET = '\x1b[23m'
const UNDERLINE_RESET = '\x1b[24m'
const STRIKE_RESET = '\x1b[29m'
const INVERSE_RESET = '\x1b[27m'

/** Built-in palettes, including a few well-known oh-my-pi coding themes. */
export const THEME_NAMES = [
  'dark', 'light', 'midnight', 'solarized',
  'catppuccin', 'dracula', 'nord', 'gruvbox', 'rose-pine',
  'mono',
] as const

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
  /** Inverse video that leaves surrounding foreground intact (`27` not `0`). */
  inverse(text: string): string
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
  const paint = (open: string, text: string, close: string): string =>
    colors && open !== '' ? open + text + close : text
  return {
    name,
    colors,
    trueColor: tc,
    getFgAnsi,
    getBgAnsi,
    fg: (color, text) => paint(getFgAnsi(color), text, FG_RESET),
    bg: (color, text) => paint(getBgAnsi(color), text, BG_RESET),
    bold: (text) => (colors ? `\x1b[1m${text}${BOLD_RESET}` : text),
    italic: (text) => (colors ? `\x1b[3m${text}${ITALIC_RESET}` : text),
    underline: (text) => (colors ? `\x1b[4m${text}${UNDERLINE_RESET}` : text),
    strikethrough: (text) => (colors ? `\x1b[9m${text}${STRIKE_RESET}` : text),
    dim: (text) => paint(getFgAnsi('dim'), text, FG_RESET),
    inverse: (text) => (colors ? `\x1b[7m${text}${INVERSE_RESET}` : text),
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
  const reset = FG_RESET
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
