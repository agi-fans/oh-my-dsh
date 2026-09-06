/**
 * Grapheme-boundary geometry shared by the input editor and the query editor.
 *
 * Movement and deletion operate on Unicode grapheme clusters rather than
 * UTF-16 code units, so an emoji or combining sequence can never be split
 * into a lone surrogate or a broken segment. Offsets remain UTF-16 indices
 * into the original string (the internal buffer representation).
 * @module @agi-fans/dsh-tui
 */

let graphemeSegmenter: Intl.Segmenter | undefined

function graphemes(text: string): Iterable<{ index: number; segment: string }> {
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return graphemeSegmenter.segment(text)
}

/** Index of the grapheme boundary before `cursor` (UTF-16 index). */
export function moveGraphemeLeft(text: string, cursor: number): number {
  if (cursor <= 0) return cursor
  let prev = cursor
  for (const part of graphemes(text)) {
    if (part.index >= cursor) return prev
    prev = part.index
  }
  return prev
}

/** Index of the grapheme boundary after `cursor` (UTF-16 index). */
export function moveGraphemeRight(text: string, cursor: number): number {
  if (cursor >= text.length) return cursor
  for (const part of graphemes(text)) {
    if (part.index < cursor && cursor < part.index + part.segment.length) {
      return part.index + part.segment.length
    }
    if (part.index >= cursor) return part.index + part.segment.length
  }
  return text.length
}

/** Snap a UTF-16 offset forward to the grapheme boundary it belongs to. */
export function snapToGraphemeBoundary(text: string, cursor: number): number {
  for (const part of graphemes(text)) {
    if (part.index < cursor && cursor < part.index + part.segment.length) {
      return part.index + part.segment.length
    }
  }
  return cursor
}
