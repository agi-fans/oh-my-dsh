import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { blocksText } from './content-text.ts'

/** One direct human turn that can become a safe fork boundary. */
export interface ConversationTurn {
  /** Harness turn number shown to the user. */
  turn: number
  /** Index of the direct user/message event in the immutable log. */
  messageIndex: number
  /** Balanced seed boundary immediately before this turn starts. */
  branchIndex: number
  /** Single-line selector preview. */
  preview: string
  /** Number of image blocks in the selected message. */
  imageCount: number
}

/** Find direct human messages whose preceding log prefix is safe to seed into a fork. */
export function conversationTurns(events: readonly SessionEvent[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let open: { turn: number; branchIndex: number } | undefined
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'turn/start') {
      open = { turn: event.data.turn, branchIndex: index }
      continue
    }
    if (event.type === 'turn/end') {
      if (open?.turn === event.data.turn) open = undefined
      continue
    }
    if (open === undefined || event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const text = blocksText(event.data.content, { collapse: true })
    const imageCount = event.data.content.filter(block => block.type === 'image').length
    if (text === '' && imageCount === 0) continue
    turns.push({
      turn: open.turn,
      messageIndex: index,
      branchIndex: open.branchIndex,
      preview: text === '' ? (imageCount === 1 ? 'Image' : `${imageCount} images`) : text,
      imageCount,
    })
  }
  return turns
}

