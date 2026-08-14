/**
 * Transcript state machine: SessionEvent -> display blocks, and the pure
 * view that composes blocks + status + input into a render frame.

 * applyEvent is the single writer of TranscriptState; renderView is the
 * single reader. windowTranscript clips the body the way OMP's ScrollView
 * does. Both are pure so the whole rendering pipeline is testable without
 * a terminal.
 * @module @omdsh/tui
 */

import type { CallId, ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, ToolResultMessage } from '@deepseek-ai/dsh-session'
import type { AutocompleteItem, SlashCommand } from './autocomplete.ts'
import { renderAutocomplete, slashInlineHint } from './autocomplete.ts'
import { HISTORY_SEARCH_MAX_VISIBLE, type HistorySearchState, renderHistorySearch } from './history-search.ts'
import { editorStatusLabel, renderEditor, renderFramedBlock, renderWelcome, renderWorking } from './box.ts'
import { renderMarkdown } from './markdown.ts'
import type { Frame, TranscriptScroll } from './renderer.ts'
import { renderCopySelector, type CopySelectorState } from './copy-selector.ts'
import { renderSettings, type SettingsState, type StatusPreset } from './settings-list.ts'
import { renderPromptSelector, type PromptSelectorState } from './prompt-selector.ts'
import { renderSessionStatusLabel } from './status-line.ts'
import { createTheme, SPINNER, SYMBOL, type Theme, type ThemeName } from './theme.ts'
import { padToWidth, truncateToWidth, visibleWidth, wrapText } from './width.ts'
import type { TuiRecentSession, TuiSessionStats } from './definition.ts'
import { BUILTIN_TOOL_RENDERERS, renderTool, type TuiToolRenderer } from './tool-renderers.ts'

/** Display state of one tool invocation. */
export type ToolBlockStatus = 'running' | 'ok' | 'error'

/** One rendered block of the transcript. */
export type Block =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; turn: number; step: number; text: string; reasoning: string; streaming: boolean }
  | { kind: 'tool'; callId: CallId; name: string; args: string; status: ToolBlockStatus; output: string; partial?: boolean }
  | { kind: 'notice'; level: 'info' | 'error'; text: string }

/** Live session status shown on the status line. */
export type SessionStatus = 'idle' | 'running'

/** Mutable-free transcript state produced by applyEvent. */
export interface TranscriptState {
  /** Ordered display blocks (user, assistant, tool). */
  blocks: Block[]
  /** Whole-agent liveness for the status line. */
  status: SessionStatus
  /** The most recent turn number. */
  turn: number
}

/** Empty starting state. */
export function initialTranscript(): TranscriptState {
  return { blocks: [], status: 'idle', turn: 0 }
}

/** Extract plain text from text blocks, ignoring other block kinds. */
function contentToText(content: readonly ContentBlock[]): string {
  return content
    .flatMap((block) => {
      if (block.type === 'text') return [block.text]
      if (block.type === 'image') {
        const ref = block.attachment
        return [`[image ${ref.width}×${ref.height} · ${ref.mediaType}]`]
      }
      return []
    })
    .join('')
}

/** Extract reasoning text from reasoning blocks. */
function contentToReasoning(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'reasoning' }> => block.type === 'reasoning')
    .map((block) => block.text)
    .join('')
}

/** Compact pretty-print of a tool call's raw arguments JSON. */
function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw))
  } catch {
    return raw
  }
}

/** The streaming assistant block if it is the last block, else undefined. */
function streamingBlock(state: TranscriptState, turn: number, step: number): Block | undefined {
  const last = state.blocks[state.blocks.length - 1]
  if (last?.kind === 'assistant' && last.streaming && last.turn === turn && last.step === step) return last
  return undefined
}

/** Replace the trailing streaming block with a settled one, or append. */
function settleAssistant(state: TranscriptState, turn: number, step: number, text: string, reasoning: string): TranscriptState {
  const blocks = state.blocks.slice()
  const last = blocks[blocks.length - 1]
  if (last?.kind === 'assistant' && last.streaming && last.turn === turn && last.step === step) {
    blocks[blocks.length - 1] = { kind: 'assistant', turn, step, text, reasoning, streaming: false }
  } else {
    blocks.push({ kind: 'assistant', turn, step, text, reasoning, streaming: false })
  }
  return { ...state, blocks }
}

/**
 * Fold one session-log event into the transcript state.
 * @param state - prior state.
 * @param event - the appended session event.
 * @returns the next state.
 */
export function applyEvent(state: TranscriptState, event: SessionEvent): TranscriptState {
  switch (event.type) {
    case 'turn/start':
      return { ...state, status: 'running', turn: event.data.turn }
    case 'turn/end': {
      const blocks = state.blocks.slice()
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'assistant' && last.streaming) {
        blocks[blocks.length - 1] = { ...last, streaming: false }
      }
      const reason = event.data.reason
      if (reason.kind === 'error') {
        blocks.push({ kind: 'notice', level: 'error', text: 'error: ' + reason.error.code + ': ' + reason.error.message })
      } else if (reason.kind === 'aborted') {
        blocks.push({ kind: 'notice', level: 'info', text: 'interrupted' })
      }
      return { ...state, blocks, status: 'idle' }
    }
    case 'user/message': {
      // Synthetic plugin injections (system-prompt runtime context, skill
      // catalog) reach the surface as user-role messages but are model input,
      // not what the human typed; only human prompts render as transcript.
      if (event.data.source.kind !== 'user') return state
      const text = contentToText(event.data.content)
      if (text === '') return state
      return { ...state, blocks: [...state.blocks, { kind: 'user', text }] }
    }
    case 'assistant/chunk': {
      const { turn, step, chunk } = event.data
      if (chunk.type === 'text-delta') {
        const blocks = state.blocks.slice()
        const last = streamingBlock(state, turn, step)
        if (last !== undefined) {
          const idx = blocks.length - 1
          const found = blocks[idx]
          if (found?.kind === 'assistant') blocks[idx] = { ...found, text: found.text + chunk.text }
        } else {
          blocks.push({ kind: 'assistant', turn, step, text: chunk.text, reasoning: '', streaming: true })
        }
        return { ...state, blocks }
      }
      if (chunk.type === 'reasoning-delta') {
        const blocks = state.blocks.slice()
        const last = streamingBlock(state, turn, step)
        if (last !== undefined) {
          const idx = blocks.length - 1
          const found = blocks[idx]
          if (found?.kind === 'assistant') blocks[idx] = { ...found, reasoning: found.reasoning + chunk.text }
        } else {
          blocks.push({ kind: 'assistant', turn, step, text: '', reasoning: chunk.text, streaming: true })
        }
        return { ...state, blocks }
      }
      if (chunk.type === 'tool-call-delta') {
        const blocks = state.blocks.slice()
        const index = blocks.findIndex(block => block.kind === 'tool' && block.callId === chunk.id)
        const existing = blocks[index]
        if (existing?.kind === 'tool') {
          blocks[index] = {
            ...existing,
            name: chunk.name ?? existing.name,
            args: existing.args + chunk.argumentsDelta,
            partial: true,
          }
        } else {
          blocks.push({
            kind: 'tool', callId: chunk.id, name: chunk.name ?? 'tool',
            args: chunk.argumentsDelta, status: 'running', output: '', partial: true,
          })
        }
        return { ...state, blocks }
      }
      return state
    }
    case 'assistant/message': {
      const { turn, step, message } = event.data
      return settleAssistant(state, turn, step, contentToText(message.content), contentToReasoning(message.content))
    }
    case 'tool/call': {
      const block: Block = {
        kind: 'tool',
        callId: event.data.callId,
        name: event.data.name,
        args: prettyArgs(event.data.arguments),
        status: 'running',
        output: '',
      }
      const blocks = state.blocks.slice()
      const partial = blocks.findIndex(item => item.kind === 'tool' && item.callId === event.data.callId)
      if (partial >= 0) blocks[partial] = block
      else blocks.push(block)
      return { ...state, blocks }
    }
    case 'tool/result':
      return applyToolResult(state, event.data.message, event.data.error)
    // Log-only vocabulary (boundaries, usage, compaction, approvals, ...):
    // nothing to display; the recognized core events above own the surface.
    default:
      return state
  }
}

/** Fold one tool result into its tool block. */
function applyToolResult(
  state: TranscriptState,
  message: ToolResultMessage,
  error: { name: string; code: string } | undefined,
): TranscriptState {
  // A tool-result message carries exactly one tool-result block; the call
  // identity and outcome live on that inner block.
  const inner = message.content[0]
  if (inner?.type !== 'tool-result') return state
  const blocks = state.blocks.slice()
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (block?.kind === 'tool' && block.callId === inner.toolCallId) {
      blocks[i] = {
        ...block,
        status: error !== undefined || inner.isError === true ? 'error' : 'ok',
        output: contentToText(inner.content),
      }
      return { ...state, blocks }
    }
  }
  return state
}

/** View options: terminal geometry and live input state. */
export interface ViewOptions {
  /** Terminal width in columns. */
  width: number
  /** Terminal height in rows; the view keeps the frame inside it. */
  height: number
  /** Model name for the status line. */
  model: string
  /** Current input buffer text. */
  input: string
  /** Cursor column inside the input buffer (0-based, before the prefix). */
  inputCursor: number
  /** Whether to emit color SGR sequences. */
  colors: boolean
  /** Working directory shown in the editor cap. */
  pwd?: string
  /** Git branch shown in the editor cap. */
  branch?: string
  /** Product version painted on the welcome title. */
  version?: string
  /** Product name painted on the welcome title and editor cap. */
  appName?: string
  /** Spinner phase while a turn or tool is running. */
  spinnerFrame?: number
  /** 24-bit color; defaults to off so tests stay deterministic. */
  trueColor?: boolean
  /** Shipped palette; defaults to dark. */
  themeName?: ThemeName
  /** Slash-command popup sitting under the editor. */
  autocomplete?: { items: readonly AutocompleteItem[]; selected: number }
  /** Ctrl+R history-search overlay; replaces the editor while open. */
  historySearch?: HistorySearchState
  /** `/settings` overlay; replaces the editor while open. */
  settings?: SettingsState
  /** `/copy` picker overlay; replaces the editor while open. */
  copySelector?: CopySelectorState
  /** Human-interaction selector; replaces the normal editor while active. */
  promptSelector?: PromptSelectorState
  /** Effective local + agent-scoped slash command catalog. */
  commands?: readonly SlashCommand[]
  /** Durable rows shown in the welcome card. */
  recentSessions?: readonly TuiRecentSession[]
  /** Whole-session figures rendered in the editor's bottom border. */
  sessionStats?: TuiSessionStats
  /** Amount of session telemetry shown in the editor chrome. */
  statusPreset?: StatusPreset
  /** Built-in plus plugin-contributed exact-name tool renderers. */
  toolRenderers?: readonly TuiToolRenderer[]
  /**
   * First transcript row to show (0 = top). Omit or pass +Infinity to pin
   * the window to the latest lines — the OMP follow-tail default.
   */
  scrollStart?: number
  /**
   * When true, tool blocks paint their full output (OMP `ctrl+o`). Default
   * is the collapsed preview of {@link TOOL_COLLAPSED_LINES} rows.
   */
  toolsExpanded?: boolean
  /** Individual tool calls expanded by the user. */
  expandedTools?: ReadonlySet<string>
}

/** Collapsed tool-output preview height (OMP `DEFAULT_TERMINAL_PREVIEW_LINES`). */
export const TOOL_COLLAPSED_LINES = 10

/** OMP AssistantMessage uses one horizontal cell of padding and no vertical padding. */
const ASSISTANT_PADDING_X = 1

function assistantContentLines(lines: readonly string[], width: number, paddingX: number): string[] {
  const margin = ' '.repeat(paddingX)
  return lines.map((line) => padToWidth(margin + line + margin, width))
}

function assistantMarkdown(source: string, theme: Theme, width: number): string[] {
  const paddingX = width > ASSISTANT_PADDING_X * 2 ? ASSISTANT_PADDING_X : 0
  const contentWidth = Math.max(1, width - paddingX * 2)
  return assistantContentLines(renderMarkdown(source, theme, contentWidth), width, paddingX)
}

function userBubble(text: string, theme: Theme, width: number): string[] {
  const inner = Math.max(1, width - 2)
  const wrapped = wrapText(text, inner)
  const rows = ['', ...wrapped, '']
  return rows.map((row) => {
    const content = row === '' ? padToWidth('', width) : padToWidth(' ' + row, width)
    return theme.colors ? theme.bg('userMessageBg', content) : content
  })
}

function toolIcon(status: ToolBlockStatus, theme: Theme, spinnerFrame: number): string {
  if (status === 'running') {
    return theme.fg('accent', SPINNER[spinnerFrame % SPINNER.length] ?? SYMBOL.running)
  }
  if (status === 'ok') return theme.fg('success', SYMBOL.success)
  return theme.fg('error', SYMBOL.error)
}

/** Render one tool block as an OMP framed output box. */
function toolBlockLines(
  block: Extract<Block, { kind: 'tool' }>,
  theme: Theme,
  width: number,
  spinnerFrame: number,
  expanded: boolean,
  renderers: readonly TuiToolRenderer[],
): string[] {
  const icon = toolIcon(block.status, theme, spinnerFrame)
  const presentation = renderTool({
    name: block.name,
    arguments: prettyArgs(block.args),
    output: block.output,
    status: block.status,
    expanded,
  }, renderers)
  const summary = presentation.summary === undefined || presentation.summary === ''
    ? ''
    : theme.fg('dim', ' ' + presentation.summary)
  const header = icon + ' ' + theme.bold(presentation.title ?? block.name) + summary
  const raw = [...(presentation.lines ?? [])]
  const hidden = expanded ? 0 : Math.max(0, raw.length - TOOL_COLLAPSED_LINES)
  const shown = hidden > 0 ? raw.slice(0, TOOL_COLLAPSED_LINES) : raw
  const output = shown.map((line) => theme.fg('toolOutput', line))
  if (hidden > 0) {
    output.push(theme.fg('dim', '… ' + hidden + ' more lines (ctrl+o to expand)'))
  }
  const state = block.status === 'running' ? 'running' : block.status === 'ok' ? 'ok' : 'error'
  return renderFramedBlock({ header, state, lines: output, width }, theme)
}

/**
 * Render one transcript block to display lines. Pure; shared by the tty view
 * and the non-tty plain printer.
 * @param block - the block to render.
 * @param theme - active theme.
 * @param width - terminal width in columns.
 * @param spinnerFrame - activity spinner phase for running tools.
 * @param toolsExpanded - paint full tool output instead of the collapsed preview.
 * @returns display lines (already width-fitted).
 */
export function blockLines(
  block: Block,
  theme: Theme,
  width: number,
  spinnerFrame = 0,
  toolsExpanded = false,
  toolRenderers: readonly TuiToolRenderer[] = BUILTIN_TOOL_RENDERERS,
): string[] {
  if (block.kind === 'user') return userBubble(block.text, theme, width)
  if (block.kind === 'assistant') {
    const lines: string[] = []
    if (block.reasoning !== '') {
      for (const part of assistantMarkdown(block.reasoning, theme, width)) {
        lines.push(theme.italic(theme.fg('thinkingText', part)))
      }
      if (block.text !== '') lines.push('')
    }
    if (block.text === '' && block.streaming) {
      const paddingX = width > ASSISTANT_PADDING_X * 2 ? ASSISTANT_PADDING_X : 0
      lines.push(...assistantContentLines([theme.fg('dim', '…')], width, paddingX))
    } else if (block.text !== '') {
      lines.push(...assistantMarkdown(block.text, theme, width))
    }
    return lines
  }
  if (block.kind === 'tool') return toolBlockLines(block, theme, width, spinnerFrame, toolsExpanded, toolRenderers)
  if (block.level === 'info' && !block.text.includes('\n')) {
    const prefix = '  ' + theme.fg('dim', SYMBOL.done) + ' '
    const continuation = ' '.repeat(visibleWidth(prefix))
    return wrapText(block.text, Math.max(1, width - visibleWidth(prefix))).map((line, index) =>
      truncateToWidth((index === 0 ? prefix : continuation) + theme.fg('dim', line), width))
  }
  const state = block.level === 'error' ? 'error' : 'idle'
  const icon = block.level === 'error' ? theme.fg('error', SYMBOL.error) : theme.fg('dim', SYMBOL.done)
  const paint = (text: string): string => (block.level === 'error' ? theme.fg('error', text) : theme.fg('dim', text))
  const wrapped = wrapText(block.text, Math.max(1, width - 4))
  return renderFramedBlock({
    header: icon + ' ' + paint(wrapped[0] ?? ''),
    state,
    width,
    lines: wrapped.slice(1).map(paint),
  }, theme)
}

function fitFrame(lines: string[], width: number): string[] {
  return lines.map((line) => {
    if (visibleWidth(line) <= width) return line
    return truncateToWidth(line, width)
  })
}

interface TranscriptBodyCache {
  width: number
  colors: boolean
  trueColor: boolean
  themeName: ThemeName
  spinnerFrame: number
  toolsExpanded: boolean
  expandedTools: string
  toolRenderers: readonly TuiToolRenderer[]
  lines: readonly string[]
}

/**
 * Scroll changes only the viewport. Cache the expensive Markdown/tool fold by
 * immutable TranscriptState identity so wheel frames slice already-rendered
 * rows instead of formatting the complete session again.
 */
const transcriptBodyCache = new WeakMap<TranscriptState, TranscriptBodyCache>()

function sameRenderers(left: readonly TuiToolRenderer[], right: readonly TuiToolRenderer[]): boolean {
  return left.length === right.length && left.every((renderer, index) => renderer === right[index])
}

function renderTranscriptBody(
  state: TranscriptState,
  options: ViewOptions,
  theme: Theme,
  spinnerFrame: number,
): readonly string[] {
  const toolRenderers = options.toolRenderers ?? BUILTIN_TOOL_RENDERERS
  const toolsExpanded = options.toolsExpanded === true
  const expandedTools = [...(options.expandedTools ?? [])].sort().join('\0')
  const themeName = options.themeName ?? 'dark'
  const trueColor = options.trueColor === true
  const cached = transcriptBodyCache.get(state)
  if (cached !== undefined
    && cached.width === options.width
    && cached.colors === options.colors
    && cached.trueColor === trueColor
    && cached.themeName === themeName
    && cached.spinnerFrame === spinnerFrame
    && cached.toolsExpanded === toolsExpanded
    && cached.expandedTools === expandedTools
    && sameRenderers(cached.toolRenderers, toolRenderers)) {
    return cached.lines
  }

  const lines: string[] = []
  for (const block of state.blocks) {
    if (lines.length > 0) lines.push('')
    const expanded = toolsExpanded || (block.kind === 'tool' && options.expandedTools?.has(block.callId) === true)
    lines.push(...blockLines(block, theme, options.width, spinnerFrame, expanded, toolRenderers))
  }
  transcriptBodyCache.set(state, {
    width: options.width,
    colors: options.colors,
    trueColor,
    themeName,
    spinnerFrame,
    toolsExpanded,
    expandedTools,
    toolRenderers: [...toolRenderers],
    lines,
  })
  return lines
}

/** Rows moved per Shift+Arrow (OMP ScrollView `fastScrollLines`). */
export const TRANSCRIPT_FAST_SCROLL = 5

/** Rows moved per mouse-wheel notch. */
export const TRANSCRIPT_WHEEL_SCROLL = 3

function earlierLabel(count: number): string {
  return '… ↑ ' + count + ' earlier line' + (count === 1 ? '' : 's')
}

function laterLabel(count: number): string {
  return '… ↓ ' + count + ' later line' + (count === 1 ? '' : 's')
}

/**
 * Window `body` into `budget` rows with ↑/↓ overflow markers.
 * `start` is the first body row to keep; non-finite values pin to the tail.
 */
export function windowTranscript(
  body: readonly string[],
  budget: number,
  start: number,
  theme: Theme,
): TranscriptScroll & { lines: string[] } {
  const len = body.length
  if (budget <= 0) {
    return { lines: [], start: 0, maxStart: 0, budget, hiddenAbove: len, hiddenBelow: 0 }
  }
  if (len <= budget) {
    return { lines: [...body], start: 0, maxStart: 0, budget, hiddenAbove: 0, hiddenBelow: 0 }
  }

  const maxStart = Math.max(0, len - (budget - 1))
  const s = Number.isFinite(start) ? Math.max(0, Math.min(Math.trunc(start), maxStart)) : maxStart
  const atTail = s >= maxStart
  const atTop = s <= 0

  if (budget === 1) {
    const label = atTail
      ? earlierLabel(len)
      : atTop
        ? laterLabel(len)
        : '… ↑ ' + s + ' · ↓ ' + (len - s)
    return {
      lines: [theme.fg('dim', label)],
      start: s,
      maxStart,
      budget,
      hiddenAbove: atTail ? len : s,
      hiddenBelow: atTail ? 0 : len - s,
    }
  }

  if (atTail) {
    const take = budget - 1
    const hiddenAbove = len - take
    return {
      lines: [theme.fg('dim', earlierLabel(hiddenAbove)), ...body.slice(hiddenAbove)],
      start: hiddenAbove,
      maxStart,
      budget,
      hiddenAbove,
      hiddenBelow: 0,
    }
  }

  if (atTop) {
    const take = budget - 1
    const hiddenBelow = len - take
    return {
      lines: [...body.slice(0, take), theme.fg('dim', laterLabel(hiddenBelow))],
      start: 0,
      maxStart,
      budget,
      hiddenAbove: 0,
      hiddenBelow,
    }
  }

  if (budget === 2) {
    return {
      lines: [theme.fg('dim', earlierLabel(s)), body[s] ?? ''],
      start: s,
      maxStart,
      budget,
      hiddenAbove: s,
      hiddenBelow: len - s - 1,
    }
  }

  const take = budget - 2
  const hiddenBelow = len - s - take
  return {
    lines: [
      theme.fg('dim', earlierLabel(s)),
      ...body.slice(s, s + take),
      theme.fg('dim', laterLabel(hiddenBelow)),
    ],
    start: s,
    maxStart,
    budget,
    hiddenAbove: s,
    hiddenBelow,
  }
}

/**
 * Compose the welcome card, transcript, working row, and rounded editor into
 * one frame — the oh-my-pi surface.
 * @param state - transcript state.
 * @param options - terminal geometry and input state.
 * @returns the frame to hand to a renderer.
 */
export function renderView(state: TranscriptState, options: ViewOptions): Frame {
  const theme = createTheme(options.colors, options.trueColor === true, options.themeName ?? 'dark')
  const width = options.width
  const height = options.height
  const appName = options.appName ?? 'omdsh'
  const version = options.version ?? '0.1.0'
  const pwd = options.pwd ?? ''
  const spinnerFrame = options.spinnerFrame ?? 0
  const welcome = renderWelcome({
    width,
    model: options.model,
    provider: appName,
    version,
    appName,
    ...(options.recentSessions === undefined ? {} : { recentSessions: options.recentSessions }),
  }, theme)

  const transcript = renderTranscriptBody(state, options, theme, spinnerFrame)
  const body: string[] = [...welcome]
  if (transcript.length > 0) {
    if (body.length > 0) body.push('')
    body.push(...transcript)
  }

  const working = state.status === 'running' ? renderWorking(theme, spinnerFrame) : []
  const preset = options.statusPreset ?? 'compact'
  const statusWord = state.status === 'running' ? 'running' : 'idle'
  const inlineHint = slashInlineHint(options.input, options.inputCursor, options.commands)
  const sessionStatus = renderSessionStatusLabel(options.sessionStats, preset, theme, Math.max(0, width - 4))
  const editorOpts: Parameters<typeof renderEditor>[0] = {
    width,
    input: options.input,
    inputCursor: options.inputCursor,
    status: editorStatusLabel(theme, {
      appName: '🐳',
      model: options.model,
      status: statusWord,
      pwd,
      ...(options.branch !== undefined && options.branch !== '' ? { branch: options.branch } : {}),
    }),
    ...(sessionStatus !== '' ? { footer: sessionStatus } : {}),
    border: state.status === 'running' ? 'accent' : 'border',
    ...(inlineHint !== null ? { inlineHint } : {}),
  }
  const promptSelector = options.promptSelector === undefined
    ? undefined
    : renderPromptSelector(
      options.promptSelector,
      theme,
      width,
      options.input,
      options.inputCursor,
      Math.max(3, Math.min(10, height - working.length - 14)),
    )
  const settings = promptSelector !== undefined || options.settings === undefined
    ? undefined
    : renderSettings(options.settings, theme, width)
  const copySelector = promptSelector !== undefined || settings !== undefined || options.copySelector === undefined
    ? undefined
    : renderCopySelector(options.copySelector, theme, width)
  const search = promptSelector !== undefined || settings !== undefined || copySelector !== undefined || options.historySearch === undefined
    ? undefined
    : renderHistorySearch(
      options.historySearch,
      theme,
      width,
      Math.max(1, Math.min(HISTORY_SEARCH_MAX_VISIBLE, height - working.length - 8)),
    )
  const editor = promptSelector === undefined && settings === undefined && copySelector === undefined && search === undefined
    ? renderEditor(editorOpts, theme)
    : undefined
  const autocomplete = promptSelector !== undefined || settings !== undefined || copySelector !== undefined || search !== undefined
    || options.autocomplete === undefined
    ? []
    : renderAutocomplete(options.autocomplete.items, options.autocomplete.selected, theme, width)
  const inputLines = promptSelector?.lines ?? settings?.lines ?? copySelector?.lines ?? search?.lines
    ?? (editor === undefined ? [] : editor.lines)
  const spacer = 1
  const reserved = inputLines.length + working.length + spacer + autocomplete.length
  const budget = Math.max(0, height - reserved)
  const windowed = windowTranscript(body, budget, options.scrollStart ?? Number.POSITIVE_INFINITY, theme)
  const visible = windowed.lines

  const lines: string[] = [...visible]
  if (visible.length > 0) lines.push('')
  lines.push(...working)
  const editorStart = lines.length
  lines.push(...inputLines)
  lines.push(...autocomplete)
  const trimmed = fitFrame(lines, width)
  const caret = promptSelector?.cursor ?? settings?.cursor ?? copySelector?.cursor ?? search?.cursor ?? editor?.cursor ?? { row: 0, column: 0 }
  return {
    lines: trimmed,
    cursor: {
      row: editorStart + caret.row,
      column: Math.min(caret.column, width),
    },
    ...(promptSelector?.editor !== undefined
      ? { editor: { start: editorStart + promptSelector.editor.start, rows: promptSelector.editor.rows } }
      : editor === undefined ? {} : { editor: { start: editorStart, rows: editor.lines.length } }),
    ...(settings !== undefined
      ? { overlay: { kind: 'settings' as const, start: editorStart } }
      : copySelector !== undefined
        ? { overlay: { kind: 'copy' as const, start: editorStart } }
        : search !== undefined
          ? { overlay: { kind: 'search' as const, start: editorStart, resultsRow: search.resultsRow } }
          : autocomplete.length > 0
            ? { overlay: { kind: 'autocomplete' as const, start: editorStart + (editor?.lines.length ?? 0) } }
            : {}),
    transcript: {
      start: windowed.start,
      maxStart: windowed.maxStart,
      budget: windowed.budget,
      hiddenAbove: windowed.hiddenAbove,
      hiddenBelow: windowed.hiddenBelow,
    },
  }
}
