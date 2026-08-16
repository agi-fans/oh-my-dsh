/** Provider-neutral Harness tool views mapped into terminal card content. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { FileDiff, ToolCallView, ToolResultView, WebSource } from '@deepseek-ai/dsh-tools'

export interface TuiToolPresentation {
  readonly call?: ToolCallView
  readonly result?: ToolResultView
}

export interface ToolRenderInput {
  name: string
  arguments: string
  output: string
  status: 'running' | 'ok' | 'error'
  expanded: boolean
  presentation?: TuiToolPresentation
}

export interface ToolPresentation {
  title?: string
  summary?: string
  /** Human- or tool-authored call input, retained after the result settles. */
  input: readonly string[]
  /** Result content, kept separate so the view can render an Output section. */
  output: readonly string[]
  /** Terminal output favors its most recent rows; other cards favor their start. */
  outputPreview: 'head' | 'tail'
}

function printable(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, undefined, 2)
  } catch {
    return String(value)
  }
}

function printableLines(value: unknown): string[] {
  return printable(value).split('\n')
}

function fallbackArgumentLines(raw: string): string[] {
  if (raw.trim() === '' || raw.trim() === '{}') return []
  try {
    return printableLines(JSON.parse(raw))
  } catch {
    return raw.split('\n')
  }
}

function contentLines(content: readonly ContentBlock[] | undefined): string[] {
  if (content === undefined) return []
  const lines: string[] = []
  for (const block of content) {
    if (block.type === 'text' || block.type === 'reasoning') lines.push(...block.text.split('\n'))
    else if (block.type === 'image') lines.push(`[image ${block.attachment.width}×${block.attachment.height}]`)
    else if (block.type === 'tool-call') lines.push(`${block.name} ${block.arguments}`)
    else if (block.type === 'tool-result') lines.push(...contentLines(block.content))
  }
  return lines
}

function diffLines(diffs: readonly FileDiff[]): string[] {
  const lines: string[] = []
  for (const diff of diffs) {
    if (lines.length > 0) lines.push('')
    lines.push(`--- ${diff.oldText === null ? '/dev/null' : diff.path}`, `+++ ${diff.path}`)
    if (diff.oldText !== null) lines.push(...diff.oldText.split('\n').map(line => `- ${line}`))
    lines.push(...diff.newText.split('\n').map(line => `+ ${line}`))
  }
  return lines
}

function sourceLine(source: WebSource): string {
  const label = source.title ?? source.url
  return `${label}${label === source.url ? '' : ` — ${source.url}`}${source.snippet === undefined ? '' : `\n  ${source.snippet}`}`
}

interface PartialToolPresentation {
  title?: string
  summary?: string
  lines?: readonly string[]
  outputPreview?: 'head' | 'tail'
}

function callPresentation(view: ToolCallView | undefined, fallbackTitle: string): PartialToolPresentation {
  if (view === undefined) return {}
  switch (view.card) {
    case 'generic':
      {
        const lines = [
          ...(view.rawInput === undefined ? [] : printableLines(view.rawInput)),
          ...contentLines(view.content),
        ]
        return {
          title: view.title,
          ...(lines.length === 0 ? {} : { lines }),
        }
      }
    case 'terminal':
      return {
        title: fallbackTitle,
        summary: [view.description, view.cwd].filter(Boolean).join(' · '),
        lines: view.title.split('\n'),
        outputPreview: 'tail',
      }
    case 'diff':
      return {
        title: view.title,
        summary: view.diffs.map(diff => diff.path).join(', '),
        lines: diffLines(view.diffs),
      }
  }
}

function resultPresentation(view: ToolResultView | undefined): PartialToolPresentation {
  if (view === undefined) return {}
  switch (view.card) {
    case 'generic':
      {
        const lines = contentLines(view.content)
        return {
          ...(view.title === undefined ? {} : { title: view.title }),
          ...(lines.length === 0 ? {} : { lines }),
        }
      }
    case 'terminal':
      return {
        ...(view.title === undefined ? {} : { title: view.title }),
        ...(view.exitCode === undefined
          ? (view.signal === undefined ? {} : { summary: view.signal })
          : { summary: `exit ${view.exitCode}` }),
        ...(view.output === undefined ? {} : { lines: view.output.split('\n') }),
      }
    case 'diff':
      return {
        ...(view.title === undefined ? {} : { title: view.title }),
        lines: diffLines(view.diffs),
      }
    case 'search':
      if (view.shape === 'paths') {
        return {
          ...(view.title === undefined ? {} : { title: view.title }),
          summary: `${view.total} path${view.total === 1 ? '' : 's'}${view.truncated ? ' · truncated' : ''}`,
          lines: [...view.paths],
        }
      }
      return {
        ...(view.title === undefined ? {} : { title: view.title }),
        summary: `${view.total} match${view.total === 1 ? '' : 'es'}${view.truncated ? ' · truncated' : ''}`,
        lines: view.files.flatMap(file => [file.path, ...file.matches.map(match => `  ${match.lineNumber}: ${match.line}`)]),
      }
    case 'read':
      return {
        title: view.title ?? `Read ${view.path}`,
        summary: `${view.lines.length}/${view.totalLines} lines`,
        lines: view.lines.map(line => `${String(line.number).padStart(4)}  ${line.text}`),
      }
    case 'web':
      if (view.kind === 'fetch') {
        return {
          ...(view.title === undefined ? {} : { title: view.title }),
          summary: `${view.statusCode} · ${view.url}${view.truncated ? ' · truncated' : ''}`,
        }
      }
      return {
        ...(view.title === undefined ? {} : { title: view.title }),
        summary: `${view.sources.length} source${view.sources.length === 1 ? '' : 's'}${view.truncated ? ' · truncated' : ''}`,
        lines: [...(view.answer === undefined ? [] : [view.answer, '']), ...view.sources.map(sourceLine)],
      }
  }
}

/** Render a Harness presentation intent, falling back to durable raw arguments/result text. */
export function renderTool(input: ToolRenderInput): ToolPresentation {
  const call = callPresentation(input.presentation?.call, input.name)
  const result = resultPresentation(input.presentation?.result)
  const callLines = call.lines ?? fallbackArgumentLines(input.arguments)
  const outputLines = result.lines ?? (input.output === '' ? [] : input.output.split('\n'))
  const duplicateDiff = input.presentation?.call?.card === 'diff' && input.presentation.result?.card === 'diff'
  const summary = result.summary ?? call.summary
  return {
    title: result.title ?? call.title ?? input.name,
    ...(summary === undefined || summary === '' ? {} : { summary }),
    input: duplicateDiff ? [] : callLines,
    output: outputLines,
    outputPreview: call.outputPreview ?? 'head',
  }
}
