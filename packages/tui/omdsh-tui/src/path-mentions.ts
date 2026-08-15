/** Theme-aware rendering for `@path` mentions in submitted user messages. */

import type { Theme } from './theme.ts'
import { wrapIndexed } from './width.ts'

const PATH_MENTION = /@(?:"[^"\n]+"|'[^'\n]+'|[^\s@]+)/gu
const MENTION_BOUNDARY = /[\s([{<"'`，。；：！？（【《]/u
const TRAILING_PUNCTUATION = /[)\]}>.,;:!?"'`，。；：！？）】》]/u

interface MentionRange {
  start: number
  end: number
}

function mentionRanges(text: string): MentionRange[] {
  const ranges: MentionRange[] = []
  for (const match of text.matchAll(PATH_MENTION)) {
    const start = match.index
    if (start === undefined || (start > 0 && !MENTION_BOUNDARY.test(text[start - 1] ?? ''))) continue
    const raw = match[0]
    const quoted = raw.startsWith('@"') || raw.startsWith("@'")
    let end = start + raw.length
    if (!quoted) {
      while (end > start + 1 && TRAILING_PUNCTUATION.test(text[end - 1] ?? '')) end -= 1
    }
    if (end > start + 1) ranges.push({ start, end })
  }
  return ranges
}

function paintMentionSlice(
  text: string,
  sourceStart: number,
  ranges: readonly MentionRange[],
  theme: Theme,
): string {
  if (!theme.colors || ranges.length === 0) return text
  const sourceEnd = sourceStart + text.length
  const open = theme.getFgAnsi('accent') + '\x1b[1m'
  const close = '\x1b[22m' + (theme.getFgAnsi('userMessageText') || '\x1b[39m')
  let output = ''
  let cursor = 0
  for (const range of ranges) {
    const start = Math.max(range.start, sourceStart)
    const end = Math.min(range.end, sourceEnd)
    if (start >= end) continue
    const localStart = start - sourceStart
    const localEnd = end - sourceStart
    output += text.slice(cursor, localStart)
    output += open + text.slice(localStart, localEnd) + close
    cursor = localEnd
  }
  return output + text.slice(cursor)
}

/** Wrap plain user text, then paint every visible slice of an `@path` mention. */
export function renderPathMentionRows(text: string, width: number, theme: Theme): string[] {
  const ranges = mentionRanges(text)
  return wrapIndexed(text, width).map(row => paintMentionSlice(row.text, row.start, ranges, theme))
}
