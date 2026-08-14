/** Pure complete-session Markdown export, independent of viewport truncation. */

import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function contentMarkdown(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const value of content) {
    if (typeof value !== 'object' || value === null) continue
    const block = value as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'reasoning' && typeof block.text === 'string') parts.push(`> Reasoning: ${block.text}`)
    else if (block.type === 'tool-call') parts.push(`Tool call ${String(block.name ?? '')}\n\n\`\`\`json\n${String(block.arguments ?? '')}\n\`\`\``)
    else if (block.type === 'tool-result') parts.push(contentMarkdown(block.content))
    else if (block.type === 'image') {
      const attachment = typeof block.attachment === 'object' && block.attachment !== null
        ? block.attachment as Record<string, unknown>
        : {}
      const size = typeof attachment.width === 'number' && typeof attachment.height === 'number'
        ? ` ${attachment.width}×${attachment.height}`
        : ''
      parts.push(`[image${size}${typeof attachment.mediaType === 'string' ? ' · ' + attachment.mediaType : ''}]`)
    } else if (typeof block.type === 'string') parts.push(`[${block.type}]`)
  }
  return parts.filter(Boolean).join('\n\n')
}

function eventMarkdown(event: SessionEvent): string {
  if (event.type === 'user/message') return contentMarkdown(event.data.content)
  if (event.type === 'assistant/message') return contentMarkdown(event.data.message.content)
  if (event.type === 'tool/call') return `\`\`\`json\n${event.data.arguments}\n\`\`\``
  if (event.type === 'tool/result') return contentMarkdown(event.data.message.content)
  return extractSessionEventText(event)
}

function heading(event: SessionEvent): string {
  if (event.type === 'user/message') return 'User'
  if (event.type === 'assistant/message') return 'Assistant'
  if (event.type === 'tool/call') return `Tool call: ${event.data.name}`
  if (event.type === 'tool/result') return 'Tool result'
  return event.type
}

/** Serialize every searchable semantic event in log order. */
export function formatTranscriptMarkdown(
  sessionId: string,
  title: string,
  events: readonly SessionEvent[],
): string {
  const sections: string[] = [`# ${title}`, '', `Session: \`${sessionId}\``, '']
  for (const event of events) {
    const body = eventMarkdown(event).trim()
    if (body === '') continue
    sections.push(`## ${heading(event)}`, '', body, '')
  }
  return sections.join('\n')
}
