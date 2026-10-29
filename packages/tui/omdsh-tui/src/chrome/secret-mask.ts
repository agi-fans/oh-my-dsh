/**
 * Credential masking for drawn user text.
 *
 * A terminal is shown to other people: a screen share, a recording, a screenshot
 * pasted into an issue. When someone sends an API key by accident, the transcript
 * is the copy that outlives the mistake. This masks a recognized credential's
 * tail in what is drawn and nothing else — the stored message, the copy action
 * and the model input keep the original characters, so the key still works and
 * `Ctrl+C` on the selection still gives the reader what they sent.
 *
 * Recognition follows published formats only, the same rule the Harness client
 * uses: a provider key or token after its fixed prefix, a JSON Web Token, and a
 * private key block. Free-form passwords and `name=value` assignments have no
 * published format, so they stay plain — guessing would mask ordinary prose and
 * teach the reader to distrust the mask.
 *
 * @module @agi-fans/dsh-tui/chrome/secret-mask
 */

/** What replaces each hidden character. */
const MASK = '*'
/** Characters of a prefixed key left readable: the provider prefix and little else. */
const VISIBLE_PREFIX = 8

/** How a prefixed format's run after the literal is validated. */
type RunRule = {
  /** Fixed literal the candidate begins with. */
  readonly literal: string
  /** Minimum run length after the literal. */
  readonly min: number
  /** Maximum run length after the literal; omitted when unbounded. */
  readonly max?: number
  /** The run must contain a digit, which hyphenated identifiers rarely do. */
  readonly digit?: boolean
}

/**
 * The formats worth recognizing in a terminal.
 *
 * `sk-` requires a digit and twenty characters because they are the model keys
 * people paste by accident; without both, a hyphenated identifier reads as a
 * credential. Cloud key ids are bounded because their length is fixed by format.
 */
const RUN_FORMATS: readonly RunRule[] = [
  { literal: 'sk-', min: 20, digit: true },
  { literal: 'AIza', min: 35 },
  { literal: 'ghp_', min: 36 },
  { literal: 'gho_', min: 36 },
  { literal: 'ghu_', min: 36 },
  { literal: 'ghs_', min: 36 },
  { literal: 'ghr_', min: 36 },
  { literal: 'github_pat_', min: 22 },
  { literal: 'glpat-', min: 20 },
  { literal: 'npm_', min: 36 },
  { literal: 'hf_', min: 30 },
  { literal: 'AKIA', min: 16, max: 16 },
  { literal: 'ASIA', min: 16, max: 16 },
  { literal: 'LTAI', min: 12, max: 20 },
  { literal: 'AKID', min: 28, max: 36 },
  { literal: 'xoxa-', min: 10 },
  { literal: 'xoxb-', min: 10 },
  { literal: 'xoxp-', min: 10 },
  { literal: 'xoxr-', min: 10 },
  { literal: 'xoxs-', min: 10 },
  { literal: 'sk_live_', min: 16 },
  { literal: 'sk_test_', min: 16 },
  { literal: 'rk_live_', min: 16 },
  { literal: 'rk_test_', min: 16 },
  { literal: 'whsec_', min: 24 },
]

const KEY_BLOCK_BEGIN = '-----BEGIN '
const KEY_BLOCK_END = '-----END'
const JWT_PREFIX = 'eyJ'

/** Characters a key or token run may contain. */
function isKeyChar(code: number): boolean {
  return (code >= 0x30 && code <= 0x39)
    || (code >= 0x41 && code <= 0x5a)
    || (code >= 0x61 && code <= 0x7a)
    || code === 0x5f || code === 0x2d
}

function runEnd(text: string, from: number): number {
  let at = from
  while (at < text.length && isKeyChar(text.charCodeAt(at))) at += 1
  return at
}

function hasDigit(text: string, start: number, end: number): boolean {
  for (let at = start; at < end; at += 1) {
    const code = text.charCodeAt(at)
    if (code >= 0x30 && code <= 0x39) return true
  }
  return false
}

/** One credential range found in the text, as offsets. */
interface Range {
  start: number
  end: number
  /** A key block keeps its BEGIN line and any END line readable. */
  block?: boolean
}

/** The prefixed key or token starting at `start`, when the literal and run both validate. */
function prefixedAt(text: string, start: number): Range | undefined {
  for (const format of RUN_FORMATS) {
    if (!text.startsWith(format.literal, start)) continue
    const runStart = start + format.literal.length
    const end = runEnd(text, runStart)
    const length = end - runStart
    if (length < format.min) continue
    if (format.max !== undefined && length > format.max) continue
    if (format.digit === true && !hasDigit(text, runStart, end)) continue
    return { start, end }
  }
  return undefined
}

/** A JSON Web Token: three base64url runs joined by dots, starting with the header prefix. */
function jwtAt(text: string, start: number): Range | undefined {
  if (!text.startsWith(JWT_PREFIX, start)) return undefined
  const headerEnd = runEnd(text, start)
  if (text[headerEnd] !== '.' || !text.startsWith('.eyJ', headerEnd)) return undefined
  const payloadEnd = runEnd(text, headerEnd + 1)
  if (text[payloadEnd] !== '.') return undefined
  const end = runEnd(text, payloadEnd + 1)
  return end > payloadEnd + 1 ? { start, end } : undefined
}

/** A private key block, from its BEGIN line through the END line when one is present. */
function keyBlockAt(text: string, start: number): Range | undefined {
  if (!text.startsWith(KEY_BLOCK_BEGIN, start)) return undefined
  const lineEnd = text.indexOf('\n', start)
  if (lineEnd === -1) return undefined
  const endAt = text.indexOf('\n' + KEY_BLOCK_END, lineEnd)
  return { start, end: endAt === -1 ? text.length : endAt, block: true }
}

/** Every credential range in `text`, in order and never overlapping. */
export function findSecrets(text: string): readonly Range[] {
  const found: Range[] = []
  let at = 0
  while (at < text.length) {
    const next = keyBlockAt(text, at) ?? prefixedAt(text, at) ?? jwtAt(text, at)
    if (next === undefined) { at += 1; continue }
    found.push(next)
    at = next.end
  }
  return found
}

/** The drawn form of a key block: its BEGIN line, a mask per body line, its END line. */
function maskBlock(text: string, range: Range): string {
  const bodyStart = text.indexOf('\n', range.start)
  if (bodyStart === -1) return text.slice(range.start, range.start + VISIBLE_PREFIX).padEnd(range.end - range.start, MASK)
  // Lines and their breaks stay in place so a block does not change the height of
  // what the reader already scrolled past.
  let out = text.slice(range.start, bodyStart + 1)
  for (let at = bodyStart + 1; at <= range.end; at += 1) {
    const code = text.charCodeAt(at)
    if (at === range.end) return out
    if (code === 10) out += '\n'
    else if (code === 13) out += '\r'
    else out += MASK
  }
  return out
}

/**
 * Mask every recognized credential in `text`.
 *
 * Returns the text unchanged when nothing matched, so a caller can compare by
 * identity to know whether the drawn form differs from the stored one.
 */
export function maskSecrets(text: string): string {
  const ranges = findSecrets(text)
  if (ranges.length === 0) return text
  let out = ''
  let at = 0
  for (const range of ranges) {
    out += text.slice(at, range.start)
    out += range.block === true
      ? maskBlock(text, range)
      : text.slice(range.start, range.start + VISIBLE_PREFIX)
        .padEnd(range.end - range.start, MASK)
    at = range.end
  }
  return out + text.slice(at)
}
