/** Provider-neutral Harness tool views mapped into terminal card content. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { FileDiff, ToolCallView, ToolResultView, WebSource } from '@deepseek-ai/dsh-tools'
import { alignFileDiffs, countDiffStats, formatDiffRows, formatDiffStats } from './diff-render.ts'
import { TOOL_ARG_FIELDS, toolArgsObject } from './tool-args.ts'

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
  /** Arguments are still streaming, so the text may be an unfinished JSON prefix. */
  partial?: boolean
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

function parsedObject(raw: string): Record<string, unknown> | undefined {
  return toolArgsObject(raw)
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  return typeof field === 'string' ? field : ''
}

/**
 * Read declared fields through one accessor into displayable lines. A shell
 * command is the whole intent, so it stops the scan rather than letting the
 * remaining fields stack around it.
 */
function previewFieldLines(read: (field: string) => string | undefined): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const field of TOOL_ARG_FIELDS) {
    const value = read(field)
    if (value === undefined || value.trim() === '' || seen.has(value)) continue
    seen.add(value)
    lines.push(...value.split('\n'))
    if (field === 'command') break
  }
  return lines
}

/**
 * Close an unterminated string and any container left open, so a streamed
 * argument prefix parses as the object it is still becoming. Returns undefined
 * when the fragment does not even start a JSON object or array.
 */
function repairedJsonPrefix(raw: string): string | undefined {
  const text = raw.trim()
  if (text === '' || (text[0] !== '{' && text[0] !== '[')) return undefined
  const open: string[] = []
  const out: string[] = []
  let inString = false
  let escaped = false
  for (const char of text) {
    if (inString) {
      out.push(char)
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') open.push(char)
    else if (char === '}' || char === ']') open.pop()
    out.push(char)
  }
  if (inString) {
    // A lone trailing backslash cannot escape the quote added here.
    if (escaped) out.pop()
    out.push('"')
  }
  for (const opener of open.reverse()) out.push(opener === '{' ? '}' : ']')
  return out.join('')
}

/** Read one string field straight out of a fragment that is not valid JSON yet. */
function extractedStringField(raw: string, field: string): string | undefined {
  const match = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"?`, 'su').exec(raw)
  const captured = match?.[1]
  if (captured === undefined) return undefined
  try {
    const value: unknown = JSON.parse(`"${captured}"`)
    if (typeof value === 'string') return value
  } catch {
    // A value truncated inside an escape sequence still reads better than its source.
  }
  return captured
}

/**
 * Decode streamed argument fragments into the lines a card should show while the
 * call is still arriving. A prefix is parsed once its open string and containers
 * are closed; otherwise its known fields are read directly. Returns undefined for
 * an undecodable fragment so the caller keeps its raw-text fallback.
 */
function partialArgumentLines(raw: string): string[] | undefined {
  const repaired = repairedJsonPrefix(raw)
  const parsed = parsedObject(raw) ?? (repaired === undefined ? undefined : parsedObject(repaired))
  if (parsed !== undefined) {
    const lines = previewFieldLines((field) => {
      const value = parsed[field]
      return typeof value === 'string' ? value : undefined
    })
    return lines.length === 0 ? undefined : lines
  }
  const lines = previewFieldLines(field => extractedStringField(raw, field))
  return lines.length === 0 ? undefined : lines
}

function isSubagentToolName(name: string): boolean {
  return name === 'subagent' || name.startsWith('subagent_')
}

interface PresentedArgument {
  path: string
  description?: string
}

/** Declared deliverables from a `present` call, ignoring malformed entries. */
function presentedFiles(raw: string): PresentedArgument[] {
  const files = parsedObject(raw)?.['files']
  if (!Array.isArray(files)) return []
  const declared: PresentedArgument[] = []
  for (const entry of files) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const path = record['path']
    if (typeof path !== 'string' || path.trim() === '') continue
    const description = typeof record['description'] === 'string' ? record['description'].trim() : ''
    declared.push(description === '' ? { path } : { path, description })
  }
  return declared
}

/**
 * Presentation for the Harness `present` tool, which ships no presentCall: the
 * card lists the declared source paths instead of the raw JSON arguments. The
 * durable result only echoes those paths back, so it is hidden when it does.
 */
function presentFallback(name: string, raw: string, output: string): PartialToolPresentation | undefined {
  if (name !== 'present') return undefined
  const files = presentedFiles(raw)
  if (files.length === 0) return undefined
  const rendered = output.trim()
  const echoed = rendered === '' || rendered.split('\n').every(line => line.startsWith('Presented '))
  return {
    title: 'Deliverables',
    summary: files.length === 1 ? '1 file' : `${files.length} files`,
    lines: files.map(file => (file.description === undefined ? file.path : `${file.path} — ${file.description}`)),
    ...(echoed ? { hideOutput: true } : {}),
  }
}

/** Presentation for Harness delegation tools that do not ship presentCall. */
function subagentFallback(name: string, raw: string, output: string): PartialToolPresentation | undefined {
  const args = parsedObject(raw) ?? {}
  if (isSubagentToolName(name)) {
    const description = stringField(args, 'description')
    const prompt = stringField(args, 'prompt')
    const background = args.run_in_background === true
    const trimmed = output.trim()
    const startNotice = /^(?:started (?:subagent|background subagent task) )\S+$/u.test(trimmed)
    const summary = startNotice
      ? trimmed
      : output === '' ? (background ? 'background' : 'running') : ''
    return {
      title: description === '' ? 'Subagent' : description,
      ...(summary === '' ? {} : { summary }),
      ...(prompt === '' ? {} : { lines: prompt.split('\n') }),
      ...(startNotice ? { hideOutput: true } : {}),
    }
  }
  if (name === 'send_message') {
    const message = stringField(args, 'message')
    const id = stringField(args, 'agent_id') || stringField(args, 'subagent_id')
    return {
      title: 'Message',
      ...(id === '' ? {} : { summary: id }),
      ...(message === '' ? {} : { lines: message.split('\n') }),
    }
  }
  if (name === 'interrupt_agent') {
    const id = stringField(args, 'agent_id')
    return {
      title: 'Interrupt',
      ...(id === '' ? {} : { summary: id }),
    }
  }
  if (name === 'list_agents') return { title: 'Agents' }
  return undefined
}

function contentLines(content: readonly ContentBlock[] | undefined): string[] {
  if (content === undefined) return []
  const lines: string[] = []
  for (const block of content) {
    if (block.type === 'text' || block.type === 'reasoning') lines.push(...block.text.split('\n'))
    else if (block.type === 'image') lines.push(`[image ${block.attachment.width}×${block.attachment.height}]`)
    else if (block.type === 'file') lines.push(`[file ${block.attachment.name} · ${block.attachment.bytes} bytes]`)
    else if (block.type === 'tool-call') lines.push(`${block.name} ${block.arguments}`)
    else if (block.type === 'tool-result') lines.push(...contentLines(block.content))
  }
  return lines
}

function presentDiffs(diffs: readonly FileDiff[]): { lines: string[]; summary?: string } {
  const rows = alignFileDiffs(diffs)
  const stats = countDiffStats(rows)
  const summary = formatDiffStats(stats.added, stats.removed)
  return {
    lines: formatDiffRows(rows),
    ...(summary === undefined ? {} : { summary }),
  }
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
  /** When set, skip durable output text because the summary already carries it. */
  hideOutput?: boolean
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
      {
        const presented = presentDiffs(view.diffs)
        return {
          title: view.title,
          ...(presented.summary === undefined ? {} : { summary: presented.summary }),
          lines: presented.lines,
        }
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
      {
        const presented = presentDiffs(view.diffs)
        return {
          ...(view.title === undefined ? {} : { title: view.title }),
          ...(presented.summary === undefined ? {} : { summary: presented.summary }),
          lines: presented.lines,
        }
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
  const fallback = input.presentation === undefined
    ? presentFallback(input.name, input.arguments, input.output)
      ?? subagentFallback(input.name, input.arguments, input.output)
    : undefined
  const call = callPresentation(input.presentation?.call, input.name)
  const result = resultPresentation(input.presentation?.result)
  // A tool that supplied a call card with a semantic title has already decided
  // how the invocation reads; raw argument JSON would only duplicate it. The
  // raw fallback stays for tools that ship no call presentation at all.
  const semanticCall = input.presentation?.call !== undefined && call.title !== undefined
  // A streamed prefix has no card yet, so a decoded preview replaces the raw
  // JSON fragment. Predicates such as `present` still own their richer fallback.
  const partialLines = input.partial === true ? partialArgumentLines(input.arguments) : undefined
  const callLines = call.lines
    ?? (semanticCall ? [] : fallback?.lines ?? partialLines ?? fallbackArgumentLines(input.arguments))
  const outputLines = result.lines ?? (
    fallback?.hideOutput === true || input.output === '' ? [] : input.output.split('\n')
  )
  const duplicateDiff = input.presentation?.call?.card === 'diff' && input.presentation.result?.card === 'diff'
  const summary = result.summary ?? call.summary ?? fallback?.summary
  return {
    title: result.title ?? call.title ?? fallback?.title ?? input.name,
    ...(summary === undefined || summary === '' ? {} : { summary }),
    input: duplicateDiff ? [] : callLines,
    output: outputLines,
    outputPreview: call.outputPreview ?? 'head',
  }
}
