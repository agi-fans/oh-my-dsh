/**
 * Semantic palettes, paired surface colors, rounded box chrome, and status
 * glyphs used by terminal views.
 * @module @agi-fans/dsh-tui
 */

import {
  contrastRatio, labDistance, nearestPaletteIndex, nearestXterm256, nearestXterm256Grey, relativeLuminance, toOklab,
  type Rgb, type TerminalColors, terminalColorsKey,
} from './terminal-colors.ts'

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
  | 'toolAltBg'
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
  | 'mdQuoteBorder'
  | 'mdHr'
  | 'mdListBullet'
  | 'shellMode'
  | 'thinkingText'
  | 'customMessageLabel'

/** Resolved palette entry: hex, empty (default fg/bg), or a 256-color index. */
type Swatch = string | number

/** Dark palette with paired card ink and backgrounds. */
const DARK_PALETTE: Record<ThemeColor, Swatch> = {
  accent: '#7c93ff',
  border: '#3556b8',
  borderAccent: '#4d6bfe',
  borderMuted: '#3d424a',
  // Every content colour sits near 67% lightness, which is what lets one ink
  // stay readable across all three card fills. A 55% red reached 4.5:1 on a
  // near-black card and only 3.4:1 once that card became a real grey.
  success: '#89d281',
  error: '#ff8a8a',
  warning: '#e4c00f',
  muted: '#a3a8b2',
  dim: '#858c99',
  text: '',
  userMessageText: '#e4e9f7',
  userMessageBg: '#141b30',
  // The three states differ by hue and saturation at one lightness, the way pi's
  // do. Three near-black fills a few units apart could only ever read as "dark";
  // at 24% lightness a neutral pending, a green success, and a red failure name
  // themselves without any status glyph.
  toolPendingBg: '#34383a',
  toolSuccessBg: '#254131',
  toolAltBg: '#2b2f31',
  toolErrorBg: '#5b282a',
  toolTitle: '#e0e0e0',
  toolOutput: '#a3a8b2',
  toolDiffAdded: '#89d281',
  toolDiffRemoved: '#ff8a8a',
  toolDiffContext: '#a8aeb8',
  mdHeading: '#7c93ff',
  mdLink: '#7c93ff',
  mdLinkUrl: '#7186bd',
  mdCode: '#8a9099',
  mdCodeBlock: '#9cdcfe',
  mdCodeBlockBorder: '#3d424a',
  mdKeyword: '#569cd6',
  syntaxString: '#ce9178',
  syntaxNumber: '#b5cea8',
  syntaxFunction: '#dcdcaa',
  syntaxType: '#4ec9b0',
  mdQuote: '#777d88',
  mdQuoteBorder: '#3d424a',
  mdHr: '#3d424a',
  mdListBullet: '#7c93ff',
  // The composer's border while a `!` line is being typed. Green because that
  // is the one signal that says "this leaves the model and runs on your machine".
  shellMode: '#89d281',
  thinkingText: '#6b7280',
  customMessageLabel: '#b281d6',
}

/** Light palette with paired card ink and backgrounds. */
const LIGHT_PALETTE: Record<ThemeColor, Swatch> = {
  accent: '#3b57e0',
  border: '#8aa0dd',
  borderAccent: '#4d6bfe',
  borderMuted: '#b0b0b0',
  success: '#588458',
  error: '#8f3a3a',
  warning: '#9a7326',
  muted: '#666666',
  dim: '#767676',
  text: '',
  userMessageText: '#1c2438',
  userMessageBg: '#e7ecf9',
  // The same three states on paper: one lightness, three hues.
  toolPendingBg: '#e7e8ea',
  toolSuccessBg: '#dee9e1',
  toolAltBg: '#eff0f2',
  toolErrorBg: '#eee2e1',
  toolTitle: '#242424',
  toolOutput: '#666666',
  toolDiffAdded: '#4a6f4a',
  toolDiffRemoved: '#93403f',
  toolDiffContext: '#666666',
  mdHeading: '#3b57e0',
  mdLink: '#3b57e0',
  mdLinkUrl: '#5b6f9e',
  mdCode: '#567b7b',
  mdCodeBlock: '#567b7b',
  mdCodeBlockBorder: '#6c6c6c',
  mdKeyword: '#0451a5',
  syntaxString: '#a31515',
  syntaxNumber: '#098558',
  syntaxFunction: '#795e26',
  syntaxType: '#267e97',
  mdQuote: '#6c6c6c',
  mdQuoteBorder: '#b8b8b8',
  mdHr: '#b8b8b8',
  mdListBullet: '#3b57e0',
  shellMode: '#2f8f4e',
  thinkingText: '#6c6c6c',
  customMessageLabel: '#7e57c2',
}









const PALETTES: Record<ThemeName, Record<ThemeColor, Swatch>> = {
  dark: DARK_PALETTE,
  light: LIGHT_PALETTE,
  // `system` starts from the neutral palette and is rebuilt from the reported
  // terminal colors when a launch can probe them.
  system: DARK_PALETTE,
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
  accent: '94',
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
  toolAltBg: '30',
  toolErrorBg: '30',
  toolTitle: '37',
  toolOutput: '37',
  toolDiffAdded: '32',
  toolDiffRemoved: '31',
  toolDiffContext: '90',
  mdHeading: '94',
  mdLink: '94',
  mdLinkUrl: '90',
  mdCode: '90',
  mdCodeBlock: '36',
  mdCodeBlockBorder: '90',
  mdKeyword: '36',
  mdQuote: '37',
  mdQuoteBorder: '90',
  mdHr: '90',
  mdListBullet: '94',
  shellMode: '92',
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
  // This table holds *foreground* codes; `toBackgrounds` adds the 10 that turns
  // them into fills, so `37` here is the white `\x1b[47m` card a light terminal
  // needs under its dark ink.
  toolPendingBg: '37',
  toolSuccessBg: '37',
  toolAltBg: '37',
  toolErrorBg: '37',
  toolTitle: '30',
  toolOutput: '30',
  toolDiffAdded: '30',
  toolDiffRemoved: '31',
  toolDiffContext: '90',
  mdHeading: '34',
  mdLink: '34',
  mdLinkUrl: '90',
  mdCode: '30',
  mdCodeBlock: '34',
  mdCodeBlockBorder: '90',
  mdKeyword: '34',
  mdQuote: '30',
  mdQuoteBorder: '90',
  mdHr: '90',
  mdListBullet: '34',
  shellMode: '32',
  thinkingText: '90',
  customMessageLabel: '35',
}









const ANSI16: Record<ThemeName, Record<ThemeColor, string>> = {
  dark: DARK_ANSI16,
  light: LIGHT_ANSI16,
  system: DARK_ANSI16,
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

/**
 * Backgrounds for the three tool states, chosen so they stay distinct.
 *
 * This is the group form of the problem {@link nearestXterm256} solves for one
 * colour: the states differ mostly in hue and only slightly in lightness, so
 * quantising each swatch on its own collapses them. The assignment below picks a
 * distinct entry per state and then orders the three by lightness, so pending,
 * success, and error remain recognizable even on a terminal that offers only
 * eight backgrounds.
 *
 * A 16-colour terminal simply has fewer backgrounds than the states that need
 * one. Rather than paint three states the same black, the ones it cannot tint
 * fall back to `toolSuccessBg` and the error state — the only one a reader must
 * act on — is given the red it already has in `ansiBg` when the palette has a
 * usable red background.
 */
function resolveToolFills(
  name: ThemeName,
  depth: ColorDepth,
  terminal: TerminalColors | undefined,
): Partial<Record<ThemeColor, string>> | undefined {
  const palette = name === 'system' ? systemPalette(terminal) : PALETTES[name]
  const reported = depth === 'ansi16' && terminal?.palette !== undefined && terminal.palette.length === 16
    ? terminal.palette
    : undefined
  const states: readonly ThemeColor[] = ['toolPendingBg', 'toolSuccessBg', 'toolErrorBg']
  const swatches = states.map(state => {
    const swatch = palette[state]
    if (typeof swatch !== 'string' || swatch === '') return undefined
    const [r, g, b] = hexToRgb(swatch)
    return { r, g, b }
  })
  const filled = swatches.every((swatch): swatch is Rgb => swatch !== undefined)
  if (!filled) return undefined

  if (depth === 'ansi256') {
    // The neutral ramp is where the three near-black surfaces actually live; the
    // colour cube would round them all to the same corner.
    const indices = swatches.map(swatch => nearestXterm256Grey(swatch))
    return assignDistinct(states, indices, index => `\x1b[48;5;${index}m`)
  }

  if (reported !== undefined) {
    // Sixteen colours are not enough for three surfaces, so each state claims a
    // *different* entry from the ones its own hue actually reaches, rather than
    // nudging a number that has no meaning in this palette.
    return pickDistinctPaletteEntries(name, states, swatches, reported, index => ansiIndexSgr(index, true))
  }
  // The terminal never answered our colour query, so the standard xterm ANSI
  // meanings are assumed: three different backgrounds that carry text. Guessing
  // per swatch here is exactly what collapsed the three states into one. Red is
  // deliberately not one of them — a red fill would share its palette slot with
  // the red `error` and `toolDiffRemoved` ink drawn on top of it.
  // A light card is white paper under dark ink, and the eight backgrounds an
  // ANSI-16 terminal offers contain exactly one that carries it. Pending and
  // success therefore share it, and the failing card — the state a reader has to
  // act on — is the one that gets a fill of its own.
  return name === 'light'
    ? { toolPendingBg: '\x1b[47m', toolSuccessBg: '\x1b[47m', toolErrorBg: '\x1b[45m' }
    : { toolPendingBg: '\x1b[44m', toolSuccessBg: '\x1b[40m', toolErrorBg: '\x1b[45m' }
}

/**
 * Give each state the nearest palette entry no other state has taken.
 *
 * A 16-colour terminal cannot express a subtle tint, so the question stops being
 * "which entry is nearest" and becomes "which entry can this state have". Each
 * state is served in turn, by increasing distance, and only entries whose
 * luminance is low enough to hold card text are considered — a bright palette
 * entry would turn a tool card into a block of white.
 */
function pickDistinctPaletteEntries(
  name: ThemeName,
  states: readonly ThemeColor[],
  swatches: readonly Rgb[],
  palette: readonly Rgb[],
  encode: (index: number) => string,
): Partial<Record<ThemeColor, string>> | undefined {
  // A palette slot already used as ink on a card is not available as a fill: a
  // red background under red diff lines erases them. The check runs against the
  // same fallback table the foreground codes come from, so the two can never
  // disagree about which slot a colour occupies.
  const takenByInk = new Set(CARD_INK_COLORS
    .map(color => Number.parseInt(ANSI16[name][color], 10))
    .filter(code => Number.isInteger(code) && code < 8))
  const ceiling = SURFACE_MAX_LUMINANCE[name]
  // A light card's ink is a black that owns slot 0, so its fills come from the
  // bright end instead; the test is "far enough from the ink", not "dark".
  const eligible = (entry: Rgb | undefined, index: number): boolean => entry !== undefined
    && !takenByInk.has(index)
    && (name === 'light' ? relativeLuminance(entry) >= ceiling : relativeLuminance(entry) < ceiling)
  if (palette.filter(eligible).length < states.length) return undefined
  const ranked = palette
    .flatMap((entry, index) => entry === undefined ? [] : [{ index, entry: entry as Rgb }])
    .filter(({ entry, index }) => eligible(entry, index))
    .map(({ index, entry }) => ({ index, lab: toOklab(entry) }))
  if (ranked.length < states.length) return undefined
  const used = new Set<number>()
  const result: Partial<Record<ThemeColor, string>> = {}
  for (let at = 0; at < states.length; at += 1) {
    const target = toOklab(swatches[at]!)
    let best: { index: number; distance: number } | undefined
    for (const candidate of ranked) {
      if (used.has(candidate.index)) continue
      const distance = labDistance(target, candidate.lab)
      if (best === undefined || distance < best.distance) best = { index: candidate.index, distance }
    }
    if (best === undefined) return undefined
    used.add(best.index)
    result[states[at]!] = encode(best.index)
  }
  return result
}

/** Ink drawn on a tool card, by theme token and ANSI-16 fallback code. */
const CARD_INK_COLORS: readonly ThemeColor[] = [
  'toolTitle', 'toolOutput', 'toolDiffAdded', 'toolDiffRemoved', 'toolDiffContext',
  'mdKeyword', 'syntaxString', 'syntaxNumber', 'syntaxFunction', 'syntaxType',
  'mdCodeBlock', 'mdLink', 'mdHeading', 'mdQuote', 'dim', 'muted', 'accent',
  'success', 'error', 'warning', 'thinkingText', 'mdListBullet', 'mdHr',
  'mdQuoteBorder', 'mdCodeBlockBorder', 'mdCode', 'mdLinkUrl',
]

/**
 * How light a card fill may be, per palette.
 *
 * The constraint is not "dark" — it is "far from the ink". A dark theme draws
 * light text on a dark fill and a light theme draws dark text on a light fill, so
 * each palette states its own ceiling instead of sharing a dark one that would
 * make every card on a light terminal a black block.
 */
const SURFACE_MAX_LUMINANCE: Readonly<Record<ThemeName, number>> = {
  dark: 0.5, system: 0.5,
  // A light card's fill comes from the bright end; the ceiling is its floor.
  light: 0.98,
}

/**
 * Give every state its own encoding, nudging the ones that collided.
 *
 * `preferred` is the honest per-state choice; when two states land on it, the
 * one further from the light end is pushed to a neighbouring entry. A terminal
 * whose palette has no room left keeps the collision rather than inventing a
 * colour it cannot draw, which is why this returns `undefined` in that case.
 */
function assignDistinct(
  states: readonly ThemeColor[],
  preferred: readonly number[],
  encode: (index: number) => string,
): Partial<Record<ThemeColor, string>> | undefined {
  const used = new Set<number>()
  const result: Partial<Record<ThemeColor, string>> = {}
  for (let at = 0; at < states.length; at += 1) {
    const state = states[at]!
    let index = preferred[at] ?? 0
    for (let step = 1; used.has(index) && step < 8; step += 1) {
      // Alternate lighter and darker so a nudge stays close to the intent.
      index = preferred[at]! + (step % 2 === 1 ? -step : step)
    }
    if (used.has(index)) return undefined
    used.add(index)
    result[state] = encode(index)
  }
  return result
}

/** 16-color background fallbacks when the terminal is not truecolor. */
const ANSI16_BG: Record<ThemeName, Record<ThemeColor, string>> = {
  dark: toBackgrounds(DARK_ANSI16),
  light: toBackgrounds(LIGHT_ANSI16),
  system: toBackgrounds(DARK_ANSI16),
}

const FG_RESET = '\x1b[39m'
const BG_RESET = '\x1b[49m'
const BOLD_RESET = '\x1b[22m'
const ITALIC_RESET = '\x1b[23m'
const UNDERLINE_RESET = '\x1b[24m'
const STRIKE_RESET = '\x1b[29m'
const INVERSE_RESET = '\x1b[27m'

/** Built-in palettes, including a few well-known oh-my-pi coding themes. */
/**
 * Shipped palettes: one dark, one light, and the one that follows the terminal.
 *
 * A theme is a contract the whole TUI is read through — every card, diff, and
 * syntax token has to stay legible on it — so the set stays small enough to hold
 * to that standard. `system` is not a third design: it derives its surfaces from
 * the colours the terminal reports and then follows the same rules.
 */
export const THEME_NAMES = ['dark', 'light', 'system'] as const

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
  /** Whether hex colors become 24-bit SGR. */
  readonly trueColor: boolean
  /** How swatches are encoded; meaningful only when {@link Theme.colors} is true. */
  readonly depth: ColorDepth
  /** Cache fingerprint covering the palette, SGR flag, depth, and reported terminal colors. */
  readonly key: string
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

/**
 * How many colors the terminal can show, which decides how a swatch is
 * encoded. It is independent of what the terminal reports about its palette:
 * a report changes the target values, never the encoding.
 */
export type ColorDepth = 'ansi16' | 'ansi256' | 'truecolor'

/**
 * SGR for one swatch at a color depth; `fallback` is a code from
 * {@link ANSI16} or {@link ANSI16_BG}. `layer` is 38 for ink and 48 for fill.
 */
function swatchCode(swatch: Swatch, depth: ColorDepth, fallback: string, layer: 38 | 48): string {
  if (swatch === '') return layer === 38 ? '\x1b[39m' : '\x1b[49m'
  if (typeof swatch === 'number') return `\x1b[${layer};5;${swatch}m`
  if (depth === 'ansi16') return `\x1b[${fallback}m`
  const [r, g, b] = hexToRgb(swatch)
  if (depth === 'ansi256') return `\x1b[${layer};5;${nearestXterm256({ r, g, b })}m`
  return `\x1b[${layer};2;${r};${g};${b}m`
}

/** Mix two colors in linear light; `weight` is the share of `to`. */
function mixRgb(from: Rgb, to: Rgb, weight: number): Rgb {
  const linear = (value: number): number => {
    const channelValue = value / 255
    return channelValue <= 0.04045 ? channelValue / 12.92 : ((channelValue + 0.055) / 1.055) ** 2.4
  }
  const encode = (value: number): number => {
    const clamped = Math.max(0, Math.min(1, value))
    return Math.round(255 * (clamped <= 0.003_130_8 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055))
  }
  const mix = (left: number, right: number): number => linear(left) * (1 - weight) + linear(right) * weight
  return { r: encode(mix(from.r, to.r)), g: encode(mix(from.g, to.g)), b: encode(mix(from.b, to.b)) }
}

function toHex(color: Rgb): string {
  const part = (value: number): string => Math.round(value).toString(16).padStart(2, '0')
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`
}

/** The fixed red a `system` error surface mixes toward when the palette has none. */
const SYSTEM_ERROR_RED: Rgb = { r: 0xff, g: 0x5f, b: 0x5f }
/** The fixed green a `system` success surface mixes toward when the palette has none. */
const SYSTEM_SUCCESS_GREEN: Rgb = { r: 0x4a, g: 0xc8, b: 0x7a }
/** The fixed blue a `system` notice surface mixes toward when the palette has none. */
const SYSTEM_NOTICE_BLUE: Rgb = { r: 0x6f, g: 0xa8, b: 0xff }

/**
 * Rebuild the surface and ink swatches from what the terminal reported, so the
 * cards sit on the user's own background instead of a guessed one. The two
 * successful-call surfaces are separated by design: alternation only reads if
 * the pair is perceptibly different.
 */
function systemPalette(terminal: TerminalColors | undefined): Record<ThemeColor, Swatch> {
  const background = terminal?.background
  const light = terminal?.scheme === 'light'
  const base = light ? LIGHT_PALETTE : DARK_PALETTE
  if (background === undefined) return base
  const foreground = terminal?.foreground ?? (light ? { r: 0x24, g: 0x24, b: 0x24 } : { r: 0xe0, g: 0xe0, b: 0xe0 })
  const accent = terminal?.palette?.[4] ?? SYSTEM_NOTICE_BLUE
  const error = terminal?.palette?.[1] ?? SYSTEM_ERROR_RED
  const successInk = terminal?.palette?.[2] ?? SYSTEM_SUCCESS_GREEN
  const card = (weight: number): string => toHex(mixRgb(background, foreground, weight))
  /**
   * A state fill carries its own hue, the way the shipped palettes do.
   *
   * Mixing toward the terminal's *foreground* produced three greys: the states
   * were separated only by lightness, which on a dark background is the one axis
   * a reader cannot see. Mixing toward the state colour instead keeps the card on
   * the user's own background and gives it the meaning at the same time.
   */
  const stateCard = (tint: Rgb, weight: number): string => toHex(mixRgb(background, tint, weight))
  const pending = card(0.10)
  const success = stateCard(successInk, light ? 0.16 : 0.20)
  // The alternating pair is a plain lightness step: two successive successful
  // cards must be told apart, not two different states.
  const altCard = card(0.05)
  const alt = contrastRatio(mixRgb(background, successInk, light ? 0.16 : 0.20), mixRgb(background, foreground, 0.05)) < 1.06
    ? card(0.18) : altCard
  return {
    ...base,
    text: toHex(foreground),
    muted: toHex(mixRgb(foreground, background, 0.28)),
    dim: toHex(mixRgb(foreground, background, 0.45)),
    userMessageBg: toHex(mixRgb(background, accent, 0.14)),
    toolPendingBg: pending,
    toolSuccessBg: success,
    toolAltBg: alt,
    toolErrorBg: stateCard(error, light ? 0.14 : 0.22),
  }
}

/** 16-color SGR for one ANSI palette index, as ink or as a fill. */
function ansiIndexSgr(index: number, asBackground: boolean): string {
  const base = asBackground ? 4 : 3
  if (index < 8) return `\x1b[${base}${index}m`
  const bright = asBackground ? 10 : 9
  return `\x1b[${bright}${index - 8}m`
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
 * Detect the color depth. `NO_COLOR` (any non-empty value) and `FORCE_COLOR=0`
 * outrank every capability hint and leave 16 colors; `COLORTERM` and Windows
 * Terminal prove 24-bit color. Apple Terminal advertises `xterm-256color` but
 * misdraws 24-bit sequences on the releases still in use, so it gets the
 * 256-color cube. Known 16-color hosts stay at 16, and every other terminal is
 * assumed to be a modern 24-bit one.
 */
export function detectColorDepth(env: NodeJS.ProcessEnv = process.env): ColorDepth {
  if (colorDisabledByEnv(env)) return 'ansi16'
  const colorterm = (env.COLORTERM ?? '').toLowerCase()
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor'
  if (env.WT_SESSION) return 'truecolor'
  const term = env.TERM ?? ''
  if (term === 'dumb' || term === '' || term === 'linux') return 'ansi16'
  if (env.TERM_PROGRAM === 'Apple_Terminal') {
    const build = Number.parseInt((env.TERM_PROGRAM_VERSION ?? '').split('.')[0] ?? '', 10)
    return Number.isInteger(build) && build >= FIRST_TRUECOLOR_APPLE_TERMINAL_BUILD ? 'truecolor' : 'ansi256'
  }
  return 'truecolor'
}

/** Terminal 2.15, macOS 26 Tahoe, is the first Apple Terminal with real 24-bit color. */
const FIRST_TRUECOLOR_APPLE_TERMINAL_BUILD = 464

/**
 * Build a theme.
 * @param colors - emit SGR when true.
 * @param depth - color depth, or a boolean for 24-bit versus 16 colors; ignored when colors is false.
 * @param name - shipped palette (`dark` default).
 * @param terminal - what the terminal reported about itself, when a probe answered.
 */
export function createTheme(
  colors: boolean,
  depth: ColorDepth | boolean = detectColorDepth(),
  name: ThemeName = 'dark',
  terminal?: TerminalColors,
): Theme {
  const resolvedDepth: ColorDepth = depth === true ? 'truecolor' : depth === false ? 'ansi16' : depth
  const tc = colors && resolvedDepth === 'truecolor'
  const palette = name === 'system' ? systemPalette(terminal) : PALETTES[name]
  const ansi = ANSI16[name]
  const ansiBg = ANSI16_BG[name]
  // The reported sixteen colors decide the encoding only on a 16-color
  // terminal; 256- and 24-bit terminals encode the exact swatch themselves.
  const reported = resolvedDepth === 'ansi16' && terminal?.palette !== undefined && terminal.palette.length === 16 ? terminal.palette : undefined
  /**
   * Without 24-bit color a hex swatch is quantized to the entry the terminal
   * actually has, which is perceptual nearest rather than a fixed code shift.
   */
  const quantized = (swatch: Swatch, asBackground: boolean): string | undefined => {
    if (reported === undefined || typeof swatch !== 'string' || swatch === '') return undefined
    const [r, g, b] = hexToRgb(swatch)
    const index = nearestPaletteIndex({ r, g, b }, reported)
    return index === undefined ? undefined : ansiIndexSgr(index, asBackground)
  }
  const getFgAnsi = (color: ThemeColor): string => {
    if (!colors) return ''
    return quantized(palette[color], false) ?? swatchCode(palette[color], resolvedDepth, ansi[color], 38)
  }
  const rawBgAnsi = (color: ThemeColor): string => {
    if (!colors) return ''
    return quantized(palette[color], true) ?? swatchCode(palette[color], resolvedDepth, ansiBg[color], 48)
  }
  /**
   * A tool card must keep telling pending from done from failed on every
   * terminal, so the three fills are resolved together rather than one at a
   * time.
   *
   * A palette with only sixteen backgrounds, or a 256-color cube with six
   * levels per channel, has no entries that differ by the handful of units the
   * truecolor swatches do: nearest-neighbour quantisation sent pending,
   * success, and error to one and the same black. Every icon that says which
   * state a card is in was therefore invisible on any terminal that was not
   * truecolor.
   */
  const toolFills = colors && !tc ? resolveToolFills(name, resolvedDepth, terminal) : undefined
  const fillsFor = (color: ThemeColor): string => toolFills !== undefined && Object.hasOwn(toolFills, color)
    ? toolFills[color as keyof typeof toolFills]!
    : rawBgAnsi(color)
  /**
   * A 16- or 256-color terminal can still collapse the two *alternating* card
   * surfaces onto one entry. The alternating card then gives up its fill instead
   * of pretending to have a second one, which keeps consecutive calls readable.
   */
  const altBg = colors && !tc && fillsFor('toolSuccessBg') === fillsFor('toolAltBg') ? BG_RESET : undefined
  const getBgAnsi = (color: ThemeColor): string =>
    color === 'toolAltBg' && altBg !== undefined ? altBg : fillsFor(color)
  const paint = (open: string, text: string, close: string): string =>
    colors && open !== '' ? open + text + close : text
  return {
    name,
    colors,
    trueColor: tc,
    depth: resolvedDepth,
    key: [name, colors ? 1 : 0, resolvedDepth, terminalColorsKey(terminal)].join('|'),
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
  [47, 73, 224],
  [77, 107, 254],
  [53, 200, 222],
  [124, 231, 242],
]

const GRADIENT_RAMP_256 = [63, 69, 75, 81, 45, 51, 87]

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
