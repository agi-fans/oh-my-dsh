/**
 * Colors the terminal reports about itself (OSC 10 foreground, OSC 11
 * background, OSC 4 palette entries, CSI ?997 color scheme) and the perceptual
 * math used to adapt a palette to them.
 *
 * A terminal only answers these when it is interactive and willing; every
 * helper here is pure so a caller can probe once, keep whatever arrived, and
 * fall back to the shipped palettes when nothing did.
 * @module @agi-fans/dsh-tui/terminal-colors
 */

/** One sRGB color with 8-bit channels. */
export interface Rgb {
  r: number
  g: number
  b: number
}

/** What a terminal told us about itself; every field is independently optional. */
export interface TerminalColors {
  foreground?: Rgb
  background?: Rgb
  /**
   * ANSI 0-15, present only when the terminal reported all sixteen. Consumers
   * read this, never {@link TerminalColors.entries}.
   */
  palette?: readonly Rgb[]
  /**
   * Replies arrive one palette index at a time and in any order, so the partial
   * report is accumulated here. A sparse array would report `length === 16`
   * while still missing entries, which is how an incomplete palette once
   * reached the nearest-color scan.
   */
  entries?: readonly (Rgb | undefined)[]
  scheme?: 'dark' | 'light'
}

/**
 * Query the default foreground, background and all sixteen palette entries.
 * `ST` terminates instead of `BEL` because a query is written before the
 * terminal has proven it understands either form.
 */
export const COLOR_QUERY = '\x1b]10;?\x1b\\\x1b]11;?\x1b\\'
  + Array.from({ length: 16 }, (_, index) => `\x1b]4;${index};?\x1b\\`).join('')

/** Query whether the terminal considers itself dark or light (CSI ?997). */
export const COLOR_SCHEME_QUERY = '\x1b[?997;?n'

/** One parsed color reply: which slot it answers and the color, when parseable. */
export interface OscColorReply {
  target: 'foreground' | 'background' | number
  color?: Rgb
}

const OSC_COLOR_REPLY = /^(?:1([01])|4;(\d{1,3}));(.+)$/u
const HEX6 = /^#([0-9a-f]{6})$/iu
const HEX12 = /^#([0-9a-f]{12})$/iu
const RGB_SPEC = /^rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})$/iu

function channel(hex: string): number {
  return Math.round((Number.parseInt(hex, 16) / (16 ** hex.length - 1)) * 255)
}

/** Parse one OSC 10/11/4 reply body (the text between the introducer and the terminator). */
export function parseOscColorReply(body: string): OscColorReply | undefined {
  const match = OSC_COLOR_REPLY.exec(body)
  if (match === null) return undefined
  const target: OscColorReply['target'] = match[1] === '0' ? 'foreground'
    : match[1] === '1' ? 'background'
      : Number.parseInt(match[2] ?? '', 10)
  if (typeof target === 'number' && !(target >= 0 && target <= 15)) return undefined
  const color = parseColorSpec(match[3] ?? '')
  return color === undefined ? { target } : { target, color }
}

/** Parse the color spec a terminal uses in a color reply (`#rrggbb`, `#rrrrggggbbbb`, `rgb:r/g/b`). */
export function parseColorSpec(spec: string): Rgb | undefined {
  const value = spec.trim()
  const hex6 = HEX6.exec(value)
  if (hex6 !== null) {
    const hex = hex6[1]!
    return { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16) }
  }
  const hex12 = HEX12.exec(value)
  if (hex12 !== null) {
    const hex = hex12[1]!
    return { r: channel(hex.slice(0, 4)), g: channel(hex.slice(4, 8)), b: channel(hex.slice(8, 12)) }
  }
  const rgb = RGB_SPEC.exec(value)
  if (rgb !== null) return { r: channel(rgb[1]!), g: channel(rgb[2]!), b: channel(rgb[3]!) }
  return undefined
}

/** Parse a CSI ?997 report; `2` means the terminal describes itself as light. */
export function parseSchemeReply(data: string): 'dark' | 'light' | undefined {
  const match = /^\x1b\[\?997;([12])n$/u.exec(data)
  if (match === null) return undefined
  return match[1] === '2' ? 'light' : 'dark'
}

/** Fold one reply into the accumulated description, keeping earlier fields the reply does not answer. */
export function mergeColorReply(colors: TerminalColors, reply: OscColorReply): TerminalColors {
  if (reply.target === 'foreground') return reply.color === undefined ? colors : { ...colors, foreground: reply.color }
  if (reply.target === 'background') return reply.color === undefined ? colors : { ...colors, background: reply.color }
  if (reply.color === undefined) return colors
  const entries = Array.from({ length: 16 }, (_, index) => colors.entries?.[index] ?? colors.palette?.[index])
  entries[reply.target] = reply.color
  // Publishing needs every index present; the accumulator keeps the partial
  // report until then.
  return entries.every((entry): entry is Rgb => entry !== undefined)
    ? { ...colors, entries, palette: entries }
    : { ...colors, entries }
}

/** Convert one 8-bit sRGB color to Oklab (Björn Ottosson's transform). */
export function toOklab(color: Rgb): [number, number, number] {
  const linear = (value: number): number => {
    const channelValue = value / 255
    return channelValue <= 0.04045 ? channelValue / 12.92 : ((channelValue + 0.055) / 1.055) ** 2.4
  }
  const r = linear(color.r)
  const g = linear(color.g)
  const b = linear(color.b)
  const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b)
  const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b)
  const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b)
  return [
    0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
  ]
}

/** Squared Oklab distance; ordering is all that matters for nearest-color picks. */
function labDistance(left: readonly [number, number, number], right: readonly [number, number, number]): number {
  const dl = left[0] - right[0]
  const da = left[1] - right[1]
  const db = left[2] - right[2]
  return dl * dl + da * da + db * db
}

/**
 * Index of the palette entry closest to `color` in Oklab, which is what a
 * 16-color terminal can actually show. Returns undefined for an empty palette.
 */
export function nearestPaletteIndex(color: Rgb, palette: readonly Rgb[]): number | undefined {
  if (palette.length === 0) return undefined
  const target = toOklab(color)
  let best: number | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < palette.length; index += 1) {
    const entry = palette[index]
    // A caller may hand us a partial report; a missing entry is not a color.
    if (entry === undefined) continue
    const distance = labDistance(target, toOklab(entry))
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  return best
}

/** WCAG relative luminance of one color. */
export function relativeLuminance(color: Rgb): number {
  const channelLuminance = (value: number): number => {
    const channelValue = value / 255
    return channelValue <= 0.039_28 ? channelValue / 12.92 : ((channelValue + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channelLuminance(color.r) + 0.7152 * channelLuminance(color.g) + 0.0722 * channelLuminance(color.b)
}

/** WCAG contrast ratio; 1 means identical colors. */
export function contrastRatio(left: Rgb, right: Rgb): number {
  const a = relativeLuminance(left)
  const b = relativeLuminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** The xterm 256-color entries above the sixteen the user configures: the 6×6×6 cube and the gray ramp. */
const XTERM_256: readonly { index: number; lab: [number, number, number] }[] = (() => {
  const levels = [0, 95, 135, 175, 215, 255]
  const entries: { index: number; lab: [number, number, number] }[] = []
  for (let index = 16; index < 232; index += 1) {
    const offset = index - 16
    entries.push({ index, lab: toOklab({ r: levels[Math.floor(offset / 36)]!, g: levels[Math.floor(offset / 6) % 6]!, b: levels[offset % 6]! }) })
  }
  for (let index = 232; index < 256; index += 1) {
    const value = 8 + (index - 232) * 10
    entries.push({ index, lab: toOklab({ r: value, g: value, b: value }) })
  }
  return entries
})()

const xterm256Cache = new Map<string, number>()

/**
 * The xterm-256 entry closest to `color` in Oklab, from the fixed cube and
 * gray ramp only: indices 0-15 follow the user's palette and would make the
 * result depend on a terminal theme we cannot see.
 */
export function nearestXterm256(color: Rgb): number {
  const key = `${color.r},${color.g},${color.b}`
  const known = xterm256Cache.get(key)
  if (known !== undefined) return known
  const target = toOklab(color)
  let best = 16
  let bestDistance = Number.POSITIVE_INFINITY
  for (const entry of XTERM_256) {
    const distance = labDistance(target, entry.lab)
    if (distance < bestDistance) {
      bestDistance = distance
      best = entry.index
    }
  }
  xterm256Cache.set(key, best)
  return best
}
