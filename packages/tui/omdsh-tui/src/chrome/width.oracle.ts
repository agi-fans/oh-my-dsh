/**
 * Independent terminal-cell oracle for rendering tests.
 *
 * Expectations must not be computed with the code they check: a width table
 * that reports an emoji as one cell satisfies an expectation derived from the
 * same table, so the defect stays invisible. Everything here is therefore
 * derived from Unicode properties through `Intl.Segmenter` plus a hand-checked
 * constant table, and never imports `chrome/width.ts`.
 *
 * The module is excluded from the package build (`tsconfig.json`), is not
 * matched by the vitest `*.spec.ts` pattern, and is imported by test files
 * only. Product code must not depend on it.
 * @module @agi-fans/dsh-tui/width-oracle
 */

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Minimal SGR/OSC stripper, kept separate from the module under test. */
const ANSI_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|].*?(?:\x07|\x1b\\))/g

const DEFAULT_EMOJI = /\p{Emoji_Presentation}/u
const REGIONAL_PAIR = /^\p{Regional_Indicator}{2}$/u
const MARKS_ONLY = /^[\p{Mn}\p{Me}\p{Cf}]+$/u
const WIDE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

const TAB_STOP = 8

function clusterWidth(cluster: string, column: number): number {
  if (cluster === '\t') return TAB_STOP - (column % TAB_STOP)
  // Emoji presentation selector and ZWJ both collapse a whole cluster into one
  // two-cell glyph on every mainstream terminal.
  if (cluster.includes('\uFE0F')) return 2
  if (cluster.includes('\u200D')) return 2
  if (REGIONAL_PAIR.test(cluster)) return 2
  if (MARKS_ONLY.test(cluster)) return 0
  const base = [...cluster][0] ?? ''
  const cp = base.codePointAt(0) ?? 0
  if (cp === 0 || cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0
  // Default emoji presentation is what makes a glyph occupy two cells.
  // `Extended_Pictographic` alone is too broad: it also covers text-default
  // pictographs such as ✔ (U+2714) that terminals draw in one cell.
  if (WIDE_SCRIPT.test(base) || DEFAULT_EMOJI.test(base)) return 2
  return 1
}

/** Terminal cells for `text`, computed without going through `width.ts`. */
export function oracleWidth(text: string): number {
  let column = 0
  for (const part of segmenter.segment(text.replace(ANSI_RE, ''))) {
    column += clusterWidth(part.segment, column)
  }
  return column
}

/** Whether `index` sits on a grapheme boundary of `text`. */
export function isClusterBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true
  for (const part of segmenter.segment(text)) {
    if (part.index === index) return true
  }
  return false
}

/** Split `text` into grapheme clusters, for per-cluster assertions. */
export function oracleClusters(text: string): string[] {
  return [...segmenter.segment(text.replace(ANSI_RE, ''))].map(part => part.segment)
}

/**
 * Hand-checked cell widths. Every row states what a mainstream terminal
 * actually draws, not what any implementation happens to compute.
 */
export const GOLDEN: ReadonlyArray<readonly [string, number, string]> = [
  ['abc', 3, 'ASCII'],
  ['你好', 4, 'CJK'],
  ['中文abc', 7, 'CJK mixed with ASCII'],
  ['é', 1, 'precomposed Latin-1'],
  ['e\u0301', 1, 'decomposed combining acute'],
  ['\u0301', 0, 'lone combining mark'],
  ['✅', 2, 'white heavy check mark'],
  ['⭐', 2, 'white medium star'],
  ['🚀', 2, 'rocket U+1F680'],
  ['🛸', 2, 'flying saucer U+1F6F8'],
  ['🕐', 2, 'clock face U+1F550'],
  ['😀', 2, 'grinning face'],
  ['👍', 2, 'thumbs up'],
  ['👍🏽', 2, 'skin tone modifier collapses into the base glyph'],
  ['👋🏿', 2, 'dark skin tone modifier'],
  ['👨\u200D👩\u200D👧', 2, 'ZWJ family'],
  ['👨\u200D👩\u200D👧\u200D👦', 2, 'ZWJ family of four'],
  ['🧑\u200D💻', 2, 'ZWJ technologist'],
  ['🏳\uFE0F\u200D🌈', 2, 'ZWJ rainbow flag'],
  ['❤\uFE0F', 2, 'VS16 heart'],
  ['⚠\uFE0F', 2, 'VS16 warning sign'],
  ['1\uFE0F\u20E3', 2, 'keycap'],
  ['🇨🇳', 2, 'regional indicator pair'],
  ['🇨🇳🇺🇸', 4, 'two flags'],
]

/**
 * Tab expectations are tab-stop positions, not cell widths: a literal tab has
 * no width until a block-render entry point expands it against a column, so
 * only the oracle, which tracks the column, can check them.
 */
export const TAB_GOLDEN: ReadonlyArray<readonly [string, number, string]> = [
  ['\t', 8, 'tab at column 0'],
  ['ab\t', 8, 'tab at column 2 advances to the next stop'],
  ['abcdefgh\t', 16, 'tab at column 8 advances a full stop'],
]
