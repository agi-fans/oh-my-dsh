/** Shared text extraction from message content blocks. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export interface ContentTextOptions {
  /** Block `type` values whose `text` contributes; defaults to `['text']`. */
  readonly kinds?: readonly ContentBlock['type'][]
  /** Segment separator; defaults to `'\n'`. */
  readonly join?: string
  /** Collapse whitespace runs into single spaces and trim the joined result. */
  readonly collapse?: boolean
}

/** Flatten the text of selected content blocks into one string. */
export function blocksText(content: readonly ContentBlock[], options: ContentTextOptions = {}): string {
  const kinds = new Set(options.kinds ?? ['text'])
  const parts: string[] = []
  for (const block of content) {
    if (kinds.has(block.type) && 'text' in block) parts.push(block.text)
  }
  const text = parts.join(options.join ?? '\n')
  return options.collapse === true ? text.replace(/\s+/gu, ' ').trim() : text
}
