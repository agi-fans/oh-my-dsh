/** Pure complete-session Markdown export, independent of viewport truncation. */

import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { marked } from 'marked'

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

function escapeHtml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
}

/** Prevent raw transcript HTML from becoming active while preserving fenced code contents. */
function escapeRawHtml(markdown: string): string {
  let fenced = false
  return markdown.split('\n').map((line) => {
    if (/^\s*```/u.test(line)) {
      fenced = !fenced
      return line
    }
    return fenced ? line : line.replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  }).join('\n')
}

/** Standalone, CSP-locked HTML export independent of terminal ANSI rendering. */
export function formatTranscriptHtml(
  sessionId: string,
  title: string,
  events: readonly SessionEvent[],
): string {
  const markdown = escapeRawHtml(formatTranscriptMarkdown(sessionId, title, events))
  const body = marked.parse(markdown, { async: false }) as string
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(title)} · omdsh transcript</title>
<style>
:root{color-scheme:light dark;--bg:#0d0e13;--panel:#15171f;--text:#d8d8df;--muted:#888c9b;--accent:#f0a928;--border:#343846;--code:#101219}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,#19202b 0,var(--bg) 42%);color:var(--text);font:16px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}main{width:min(960px,calc(100% - 32px));margin:40px auto 80px;padding:clamp(22px,5vw,56px);background:color-mix(in srgb,var(--panel) 94%,transparent);border:1px solid var(--border);border-radius:20px;box-shadow:0 24px 80px #0008}h1{color:var(--accent);font-size:clamp(28px,5vw,48px);line-height:1.15}h2{margin-top:2.4em;padding-top:1em;border-top:1px solid var(--border);font-size:18px}p,li{overflow-wrap:anywhere}blockquote{margin-left:0;padding-left:18px;border-left:3px solid var(--accent);color:var(--muted)}pre{overflow:auto;padding:18px;border:1px solid var(--border);border-radius:12px;background:var(--code)}code{font-family:inherit;color:#9bdcff}p code,li code{padding:.15em .4em;border-radius:5px;background:var(--code)}a{color:#72c7ff}@media(max-width:600px){main{width:100%;margin:0;border:0;border-radius:0;padding:20px}}
</style>
</head>
<body><main>${body}</main></body>
</html>
`
}
