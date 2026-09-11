/** Shared text extraction from message content blocks, typed or raw session JSON. */

export interface ContentTextOptions {
  /** Block `type` values whose `text` contributes; defaults to `['text']`. */
  readonly kinds?: readonly string[]
  /** Segment separator; defaults to `'\n'`. */
  readonly join?: string
  /** Collapse whitespace runs into single spaces and trim the joined result. */
  readonly collapse?: boolean
}

/** Flatten the text of selected content blocks into one string. */
export function blocksText(content: unknown, options: ContentTextOptions = {}): string {
  if (!Array.isArray(content)) return ''
  const kinds = new Set(options.kinds ?? ['text'])
  const parts: string[] = []
  for (const value of content) {
    if (typeof value !== 'object' || value === null) continue
    const block = value as { type?: unknown; text?: unknown }
    if (typeof block.type === 'string' && kinds.has(block.type) && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  const text = parts.join(options.join ?? '\n')
  return options.collapse === true ? text.replace(/\s+/gu, ' ').trim() : text
}
