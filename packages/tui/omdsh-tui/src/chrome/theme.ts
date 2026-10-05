/**
 * Semantic palettes, paired surface colors, rounded box chrome, and status
 * glyphs used by terminal views.
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

/** Status / list glyphs: monochrome Unicode, never emoji-presentation. */
export const SYMBOL = {
  success: '✔',
  error: '✘',
  warning: '▲',
  info: 'ⓘ',
  pending: '○',
  running: '⟳',
  done: '•',
  /**
   * The model's thinking, in the gutter. Three stacked dots read as a deduction
   * and collide with no status mark, which is what `⋆` did: it looked like a
   * stray speck and a `✔` column beside it carried the real weight anyway.
   */
  reasoning: '∴',
  /** Disclosure markers for a folded process group. */
  folded: '▸',
  unfolded: '▾',
  /**
   * Tree rail. A run's shape is carried by the rail rather than by indentation
   * alone, so a reader can tell where one run ends and the next begins.
   */
  rail: '│',
  railBranch: '├',
  railEnd: '└',
  /** The reader's own prompt. */
  prompt: '›',
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
  | 'syntaxString'
  | 'syntaxNumber'
  | 'syntaxFunction'
  | 'syntaxType'
  | 'mdQuote'
  | 'mdListBullet'
  | 'thinkingText'
  | 'customMessageLabel'

/** Resolved palette entry: hex, empty (default fg/bg), or a 256-color index. */
type Swatch = string | number

/** Dark palette with paired card ink and backgrounds. */
const DARK_PALETTE: Record<ThemeColor, Swatch> = {
  accent: '#febc38',
  border: '#178fb9',
  borderAccent: '#0088fa',
  borderMuted: '#3d424a',
  success: '#89d281',
  error: '#fc4353',
  warning: '#e4c00f',
  muted: '#858a94',
  dim: '#666d7b',
  text: '',
  userMessageText: '#e0e0e0',
  userMessageBg: '#221d1a',
  toolPendingBg: '#1d2129',
  toolSuccessBg: '#161a1f',
  toolErrorBg: '#291d1d',
  toolTitle: '#e0e0e0',
  toolOutput: '#858a94',
  toolDiffAdded: '#89d281',
  toolDiffRemoved: '#fc4353',
  toolDiffContext: '#838a98',
  mdHeading: '#febc38',
  mdLink: '#0088fa',
  mdLinkUrl: '#5f6673',
  mdCode: '#8a9099',
  mdCodeBlock: '#9cdcfe',
  mdCodeBlockBorder: '#3d424a',
  mdKeyword: '#569cd6',
  syntaxString: '#ce9178',
  syntaxNumber: '#b5cea8',
  syntaxFunction: '#dcdcaa',
  syntaxType: '#4ec9b0',
  mdQuote: '#777d88',
  mdListBullet: '#febc38',
  thinkingText: '#6b7280',
  customMessageLabel: '#b281d6',
}

/** Light palette with paired card ink and backgrounds. */
const LIGHT_PALETTE: Record<ThemeColor, Swatch> = {
  accent: '#4c6c6c',
  border: '#547da7',
  borderAccent: '#5a8080',
  borderMuted: '#b0b0b0',
  success: '#588458',
  error: '#9f4f4f',
  warning: '#9a7326',
  muted: '#666666',
  dim: '#767676',
  text: '',
  userMessageText: '#242424',
  userMessageBg: '#e8e8e8',
  toolPendingBg: '#e8e8f0',
  toolSuccessBg: '#e8f0e8',
  toolErrorBg: '#f0e8e8',
  toolTitle: '#242424',
  toolOutput: '#666666',
  toolDiffAdded: '#4a6f4a',
  toolDiffRemoved: '#9f4f4f',
  toolDiffContext: '#666666',
  mdHeading: '#9a7326',
  mdLink: '#5077a0',
  mdLinkUrl: '#767676',
  mdCode: '#567b7b',
  mdCodeBlock: '#567b7b',
  mdCodeBlockBorder: '#6c6c6c',
  mdKeyword: '#0451a5',
  syntaxString: '#a31515',
  syntaxNumber: '#098558',
  syntaxFunction: '#795e26',
  syntaxType: '#267e97',
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
  muted: '#878d96',
  dim: '#686f7e',
  text: '',
  userMessageBg: '#1a1b26',
  toolPendingBg: '#16161e',
  toolSuccessBg: '#1b2430',
  toolErrorBg: '#2a1b26',
  toolOutput: '#878d96',
  toolDiffAdded: '#9ece6a',
  toolDiffRemoved: '#f7768e',
  toolDiffContext: '#858d9a',
  mdHeading: '#bb9af7',
  mdLink: '#7dcfff',
  mdLinkUrl: '#626a77',
  mdCode: '#7f8799',
  mdCodeBlock: '#9aa5ce',
  mdCodeBlockBorder: '#3d424a',
  mdKeyword: '#bb9af7',
  syntaxString: '#9ece6a',
  syntaxNumber: '#ff9e64',
  syntaxFunction: '#7aa2f7',
  syntaxType: '#2ac3de',
  mdQuote: '#777d88',
  mdListBullet: '#7aa2f7',
  thinkingText: '#6a7394',
  customMessageLabel: '#bb9af7',
  userMessageText: '#c0caf5',
  toolTitle: '#c0caf5',
}

const SOLARIZED_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#c39400',
  border: '#268bd2',
  borderAccent: '#2aa198',
  borderMuted: '#586e75',
  success: '#859900',
  error: '#e87b79',
  warning: '#cb4b16',
  muted: '#8e9e9f',
  dim: '#668088',
  text: '',
  userMessageBg: '#073642',
  toolPendingBg: '#002b36',
  toolSuccessBg: '#073642',
  toolErrorBg: '#3b2020',
  toolOutput: '#8e9e9f',
  toolDiffAdded: '#8fa500',
  toolDiffRemoved: '#e87b79',
  toolDiffContext: '#889fa6',
  mdHeading: '#b58900',
  mdLink: '#3496da',
  mdLinkUrl: '#5e767d',
  mdCode: '#93a1a1',
  mdCodeBlock: '#2aa198',
  mdCodeBlockBorder: '#073642',
  mdKeyword: '#859900',
  syntaxString: '#2aa198',
  syntaxNumber: '#de66a0',
  syntaxFunction: '#3496da',
  syntaxType: '#b58900',
  mdQuote: '#839496',
  mdListBullet: '#b58900',
  thinkingText: '#5e767d',
  customMessageLabel: '#6c71c4',
  userMessageText: '#93a1a1',
  toolTitle: '#93a1a1',
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
  muted: '#989db0',
  dim: '#7a7d93',
  text: '',
  userMessageBg: '#181825',
  toolPendingBg: '#313244',
  toolSuccessBg: '#181825',
  toolErrorBg: '#11111b',
  toolTitle: '#b4befe',
  toolOutput: '#989db0',
  toolDiffAdded: '#a6e3a1',
  toolDiffRemoved: '#f38ba8',
  toolDiffContext: '#989db0',
  mdHeading: '#fab387',
  mdLink: '#89b4fa',
  mdLinkUrl: '#6c7086',
  mdCode: '#a6adc8',
  mdCodeBlock: '#cdd6f4',
  mdCodeBlockBorder: '#313244',
  mdKeyword: '#cba6f7',
  syntaxString: '#a6e3a1',
  syntaxNumber: '#fab387',
  syntaxFunction: '#89b4fa',
  syntaxType: '#f9e2af',
  mdQuote: '#7f849c',
  mdListBullet: '#fab387',
  thinkingText: '#6c7086',
  customMessageLabel: '#cba6f7',
  userMessageText: '#cdd6f4',
}

const DRACULA_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#bd93f9',
  border: '#bd93f9',
  borderAccent: '#ff79c6',
  borderMuted: '#44475a',
  success: '#50fa7b',
  error: '#ff5a5a',
  warning: '#f1fa8c',
  muted: '#8693b9',
  dim: '#6f7492',
  text: '',
  userMessageBg: '#1f2029',
  toolPendingBg: '#21222c',
  toolSuccessBg: '#1a1f1e',
  toolErrorBg: '#2a2028',
  toolTitle: '#8be9fd',
  toolOutput: '#8693b9',
  toolDiffAdded: '#50fa7b',
  toolDiffRemoved: '#ff5a5a',
  toolDiffContext: '#8693b9',
  mdHeading: '#bd93f9',
  mdLink: '#8be9fd',
  mdLinkUrl: '#6474a5',
  mdCode: '#9aa3c7',
  mdCodeBlock: '#f8f8f2',
  mdCodeBlockBorder: '#44475a',
  mdKeyword: '#ff79c6',
  syntaxString: '#f1fa8c',
  syntaxNumber: '#bd93f9',
  syntaxFunction: '#50fa7b',
  syntaxType: '#8be9fd',
  mdQuote: '#6474a5',
  mdListBullet: '#ff79c6',
  thinkingText: '#6474a5',
  customMessageLabel: '#bd93f9',
  userMessageText: '#f8f8f2',
}

const NORD_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#88c0d0',
  border: '#5e81ac',
  borderAccent: '#88c0d0',
  borderMuted: '#434c5e',
  success: '#a3be8c',
  error: '#daa2a8',
  warning: '#ebcb8b',
  muted: '#a8b1c1',
  dim: '#8490a7',
  text: '',
  userMessageBg: '#3b4252',
  toolPendingBg: '#3b4252',
  toolSuccessBg: '#2e3440',
  toolErrorBg: '#3b2f31',
  toolTitle: '#88c0d0',
  toolOutput: '#a8b1c1',
  toolDiffAdded: '#a3be8c',
  toolDiffRemoved: '#daa2a8',
  toolDiffContext: '#a8b1c1',
  mdHeading: '#88c0d0',
  mdLink: '#88c0d0',
  mdLinkUrl: '#727f9a',
  mdCode: '#82a2c1',
  mdCodeBlock: '#d8dee9',
  mdCodeBlockBorder: '#434c5e',
  mdKeyword: '#82a2c1',
  syntaxString: '#a3be8c',
  syntaxNumber: '#b793b1',
  syntaxFunction: '#88c0d0',
  syntaxType: '#8fbcbb',
  mdQuote: '#7b88a1',
  mdListBullet: '#81a1c1',
  thinkingText: '#747f95',
  customMessageLabel: '#b48ead',
  userMessageText: '#d8dee9',
}

const GRUVBOX_PALETTE: Record<ThemeColor, Swatch> = {
  ...DARK_PALETTE,
  accent: '#fe8019',
  border: '#458588',
  borderAccent: '#8ec07c',
  borderMuted: '#504945',
  success: '#b8bb26',
  error: '#fc6c5c',
  warning: '#fabd2f',
  muted: '#a4988b',
  dim: '#87796d',
  text: '',
  userMessageBg: '#1d2021',
  toolPendingBg: '#32302f',
  toolSuccessBg: '#1d2021',
  toolErrorBg: '#3c2021',
  toolTitle: '#ebdbb2',
  toolOutput: '#a4988b',
  toolDiffAdded: '#b8bb26',
  toolDiffRemoved: '#fc6c5c',
  toolDiffContext: '#a4988b',
  mdHeading: '#fabd2f',
  mdLink: '#8ec07c',
  mdLinkUrl: '#7e7165',
  mdCode: '#bdae93',
  mdCodeBlock: '#ebdbb2',
  mdCodeBlockBorder: '#504945',
  mdKeyword: '#d3869b',
  syntaxString: '#b8bb26',
  syntaxNumber: '#d3869b',
  syntaxFunction: '#fabd2f',
  syntaxType: '#8ec07c',
  mdQuote: '#928374',
  mdListBullet: '#fe8019',
  thinkingText: '#7e7165',
  customMessageLabel: '#d3869b',
  userMessageText: '#ebdbb2',
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
  muted: '#8c89a2',
  dim: '#6f6b8b',
  text: '',
  userMessageBg: '#21202e',
  toolPendingBg: '#1f1d2e',
  toolSuccessBg: '#21202e',
  toolErrorBg: '#2d1f26',
  toolTitle: '#9ccfd8',
  toolOutput: '#8c89a2',
  toolDiffAdded: '#9ccfd8',
  toolDiffRemoved: '#eb6f92',
  toolDiffContext: '#8c89a2',
  mdHeading: '#c4a7e7',
  mdLink: '#9ccfd8',
  mdLinkUrl: '#908caa',
  mdCode: '#a8a4c4',
  mdCodeBlock: '#e0def4',
  mdCodeBlockBorder: '#403d52',
  mdKeyword: '#3b8cac',
  syntaxString: '#f6c177',
  syntaxNumber: '#ebbcba',
  syntaxFunction: '#9ccfd8',
  syntaxType: '#c4a7e7',
  mdQuote: '#6e6a86',
  mdListBullet: '#c4a7e7',
  thinkingText: '#6e6a86',
  customMessageLabel: '#c4a7e7',
  userMessageText: '#e0def4',
}

const MONO_PALETTE: Record<ThemeColor, Swatch> = {
  accent: '#e8e8e8',
  border: '#888888',
  borderAccent: '#b8b8b8',
  borderMuted: '#444444',
  success: '#c0c0c0',
  error: '#f0f0f0',
  warning: '#a8a8a8',
  muted: '#939393',
  dim: '#757575',
  text: '',
  userMessageText: '#e8e8e8',
  userMessageBg: '#202020',
  toolPendingBg: '#242424',
  toolSuccessBg: '#1c1c1c',
  toolErrorBg: '#2a2a2a',
  toolTitle: '#e8e8e8',
  toolOutput: '#939393',
  toolDiffAdded: '#c0c0c0',
  toolDiffRemoved: '#f0f0f0',
  toolDiffContext: '#939393',
  mdHeading: '#e8e8e8',
  mdLink: '#b8b8b8',
  mdLinkUrl: '#666666',
  mdCode: '#a0a0a0',
  mdCodeBlock: '#c0c0c0',
  mdCodeBlockBorder: '#444444',
  mdKeyword: '#b8b8b8',
  syntaxString: '#c0c0c0',
  syntaxNumber: '#a0a0a0',
  syntaxFunction: '#e8e8e8',
  syntaxType: '#b8b8b8',
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

/**
 * 16-color foreground fallbacks when the terminal is not truecolor. Entries
 * named `*Bg` describe a background, so they hold the foreground code whose
 * shift in {@link ANSI16_BG} yields the intended background SGR.
 */
const DARK_ANSI16: Record<ThemeColor, string> = {
  syntaxString: '32',
  syntaxNumber: '35',
  syntaxFunction: '33',
  syntaxType: '36',
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
  userMessageText: '37',
  userMessageBg: '30',
  // Neutral fills avoid same-index collisions with error and diff ink.
  toolPendingBg: '30',
  toolSuccessBg: '30',
  toolErrorBg: '30',
  toolTitle: '37',
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
  syntaxString: '31',
  syntaxNumber: '30',
  syntaxFunction: '30',
  syntaxType: '34',
  accent: '34',
  border: '34',
  borderAccent: '34',
  borderMuted: '90',
  success: '30',
  error: '31',
  warning: '30',
  muted: '30',
  dim: '90',
  text: '39',
  userMessageText: '30',
  userMessageBg: '37',
  toolPendingBg: '37',
  toolSuccessBg: '37',
  toolErrorBg: '37',
  toolTitle: '30',
  toolOutput: '30',
  toolDiffAdded: '30',
  toolDiffRemoved: '31',
  toolDiffContext: '90',
  mdHeading: '30',
  mdLink: '34',
  mdLinkUrl: '90',
  mdCode: '30',
  mdCodeBlock: '34',
  mdCodeBlockBorder: '90',
  mdKeyword: '34',
  mdQuote: '30',
  mdListBullet: '30',
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
  syntaxString: '37',
  syntaxNumber: '37',
  syntaxFunction: '97',
  syntaxType: '37',
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

/** Distance from a foreground SGR code to its background twin: 31 → 41, 39 → 49. */
const BG_CODE_OFFSET = 10

/**
 * Build the background twin of a 16-color foreground table. Every result is a
 * background SGR code, which keeps `bgCode` from ever emitting a foreground
 * code even when a palette paints a foreground swatch as a background.
 */
function toBackgrounds(foreground: Record<ThemeColor, string>): Record<ThemeColor, string> {
  const result = {} as Record<ThemeColor, string>
  for (const color of Object.keys(foreground) as ThemeColor[]) {
    const code = Number.parseInt(foreground[color], 10)
    result[color] = Number.isFinite(code) ? String(code + BG_CODE_OFFSET) : foreground[color]
  }
  return result
}

/** 16-color background fallbacks when the terminal is not truecolor. */
const ANSI16_BG: Record<ThemeName, Record<ThemeColor, string>> = {
  dark: toBackgrounds(DARK_ANSI16),
  light: toBackgrounds(LIGHT_ANSI16),
  midnight: toBackgrounds(MIDNIGHT_ANSI16),
  solarized: toBackgrounds(SOLARIZED_ANSI16),
  catppuccin: toBackgrounds(CATPPUCCIN_ANSI16),
  dracula: toBackgrounds(DRACULA_ANSI16),
  nord: toBackgrounds(NORD_ANSI16),
  gruvbox: toBackgrounds(GRUVBOX_ANSI16),
  'rose-pine': toBackgrounds(ROSE_PINE_ANSI16),
  mono: toBackgrounds(MONO_ANSI16),
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

/** Paint a fixed surface, restoring its paired ink and fill after nested resets. */
export function paintSurface(theme: Theme, background: ThemeColor, foreground: ThemeColor, text: string): string {
  if (!theme.colors) return text
  const fg = theme.getFgAnsi(foreground)
  const bg = theme.getBgAnsi(background)
  const restored = text.replace(/\x1b\[([0-9;]*)m/gu, (escape: string, params: string) => {
    const codes = params.split(';').map(Number)
    let resetFg = false, resetBg = false
    for (let at = 0; at < codes.length; at += 1) {
      const code = codes[at]!
      if (code === 0) { resetFg = true; resetBg = true }
      else if (code === 39) resetFg = true
      else if (code === 49) resetBg = true
      else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) resetFg = false
      else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) resetBg = false
      else if (code === 38 || code === 48) {
        if (code === 38) resetFg = false
        else resetBg = false
        // Color channels and palette indices are data, including zero.
        if (codes[at + 1] === 2) at += 4
        else if (codes[at + 1] === 5) at += 2
      }
    }
    return escape + (resetFg ? fg : '') + (resetBg ? bg : '')
  })
  return bg + fg + restored + FG_RESET + BG_RESET
}

function hexToRgb(hex: string): [number, number, number] {
  const body = hex.startsWith('#') ? hex.slice(1) : hex
  return [
    Number.parseInt(body.slice(0, 2), 16),
    Number.parseInt(body.slice(2, 4), 16),
    Number.parseInt(body.slice(4, 6), 16),
  ]
}

/** Foreground SGR for one swatch; `fallback` is a code from {@link ANSI16}. */
function fgCode(swatch: Swatch, trueColor: boolean, fallback: string): string {
  if (swatch === '') return '\x1b[39m'
  if (typeof swatch === 'number') return `\x1b[38;5;${swatch}m`
  if (!trueColor) return `\x1b[${fallback}m`
  const [r, g, b] = hexToRgb(swatch)
  return `\x1b[38;2;${r};${g};${b}m`
}

/** Background SGR for one swatch; `fallback` is a code from {@link ANSI16_BG}. */
function bgCode(swatch: Swatch, trueColor: boolean, fallback: string): string {
  if (swatch === '') return '\x1b[49m'
  if (typeof swatch === 'number') return `\x1b[48;5;${swatch}m`
  if (!trueColor) return `\x1b[${fallback}m`
  const [r, g, b] = hexToRgb(swatch)
  return `\x1b[48;2;${r};${g};${b}m`
}

/**
 * True when the environment asks for no color at all: a non-empty `NO_COLOR`
 * (https://no-color.org) or `FORCE_COLOR=0`. An empty `NO_COLOR` counts as
 * unset, so callers can safely branch on this alone.
 */
export function colorDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NO_COLOR !== undefined && env.NO_COLOR !== '') || env.FORCE_COLOR === '0'
}

/**
 * Detect 24-bit color. `NO_COLOR` (any non-empty value) and `FORCE_COLOR=0`
 * suppress 24-bit color and outrank every capability hint; `COLORTERM` and
 * Windows Terminal enable it, and only known 16-color hosts disqualify it.
 */
export function detectTrueColor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (colorDisabledByEnv(env)) return false
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
  const ansiBg = ANSI16_BG[name]
  const getFgAnsi = (color: ThemeColor): string =>
    colors ? fgCode(palette[color], tc, ansi[color]) : ''
  const getBgAnsi = (color: ThemeColor): string =>
    colors ? bgCode(palette[color], tc, ansiBg[color]) : ''
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
