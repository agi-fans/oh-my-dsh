/**
 * Transcript state machine: SessionEvent -> display blocks, and the pure
 * view that composes blocks + status + input into a render frame.

 * applyEvent is the single writer of TranscriptState; renderView is the
 * single reader. windowTranscript clips the body the way OMP's ScrollView
 * does. Both are pure so the whole rendering pipeline is testable without
 * a terminal.
 * @module @agi-fans/dsh-tui
 */

import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type { CallId, ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, ToolResultMessage } from '@deepseek-ai/dsh-session'
import type { FileDiff } from '@deepseek-ai/dsh-tools'
import type { AutocompleteItem, SlashCommand } from './autocomplete.ts'
import { renderAutocomplete, slashInlineHint } from './autocomplete.ts'
import { HISTORY_SEARCH_MAX_VISIBLE, type HistorySearchState, renderHistorySearch } from './history-search.ts'
import { renderEditor, renderFramedBlock, renderWelcome, renderWorking } from '../chrome/box.ts'
import { renderMarkdown, type MarkdownStyle } from '../chrome/markdown.ts'
import type { Frame, TranscriptScroll } from '../chrome/renderer.ts'
import { renderCopySelector, type CopySelectorState } from './copy-selector.ts'
import { renderSettings, type SettingsState } from './settings-list.ts'
import {
  renderPlanReviewPage,
  renderPromptSelector,
  renderPromptSelectorPage,
  type PromptSelectorState,
} from './prompt-selector.ts'
import { resolveStatusBarConfig, type StatusBarConfig, type StatusPreset } from '../chrome/status-config.ts'
import { renderPermissionBadge, renderStatusFooter } from '../chrome/status-line.ts'
import { createTheme, SPINNER, SYMBOL, type Theme, type ThemeName } from '../chrome/theme.ts'
import { padToWidth, stripAnsi, truncateToWidth, visibleWidth, wrapText } from '../chrome/width.ts'
import type {
  TuiInspectedSubagent,
  TuiLoopStatus,
  TuiRecentSession,
  TuiSessionControls,
  TuiSessionStats,
  TuiSubagentPhase,
  TuiSubagentRoster,
  TuiSubagentView,
  TuiSubmission,
} from '../definition.ts'
import {
  alignFileDiffs,
  countDiffStats,
  paintDiffStats,
  paintPrefixedDiffLine,
  wrapPaintedDiffRows,
} from '../chrome/diff-render.ts'
import { renderTool, type TuiToolPresentation } from '../chrome/tool-renderers.ts'
import { renderToolsPanel, type ToolInfo } from '../chrome/tools-list.ts'
import { renderCommandOutput, renderCommandSeparator } from '../chrome/command-output.ts'
import type { WelcomeTip } from '../chrome/welcome-tips.ts'
import { renderPathMentionRows } from '../chrome/path-mentions.ts'

type TodoItem = Extract<SessionEvent, { type: 'todo/write' }>['data']['todos'][number]

/** Display state of one tool invocation. */
export type ToolBlockStatus = 'running' | 'ok' | 'error'

/** One rendered block of the transcript. */
export type Block =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; turn: number; step: number; text: string; reasoning: string; streaming: boolean }
  | { kind: 'tool'; callId: CallId; name: string; args: string; status: ToolBlockStatus; output: string; partial?: boolean; presentation?: TuiToolPresentation }
  | { kind: 'toolCatalog'; tools: readonly ToolInfo[] }
  | { kind: 'commandOutput'; command: string; text: string }
  | { kind: 'notice'; level: 'info' | 'error'; text: string; framed?: boolean }

/** Live session activity controlling the composer and activity row. */
export type SessionStatus = 'idle' | 'running' | 'compacting'

/** Mutable-free transcript state produced by applyEvent. */
export interface TranscriptState {
  /** Ordered display blocks (user, assistant, tool). */
  blocks: Block[]
  /** Whole-agent liveness for the status line. */
  status: SessionStatus
  /** The most recent turn number. */
  turn: number
  /** Latest whole Todo projection emitted by the Harness for this turn. */
  todos: TodoItem[]
  /** Lifecycle id of a manual compact command currently owning the UI. */
  compactCommandId: string | undefined
  /** Durable follow-up turns waiting in the Harness-owned agent inbox. */
  nextTurnInbox: UserMessage[]
  /** Durable steering/context waiting for a later step (kept for splice fidelity). */
  nextStepInbox: UserMessage[]
}

/** Empty starting state. */
export function initialTranscript(): TranscriptState {
  return {
    blocks: [],
    status: 'idle',
    turn: 0,
    todos: [],
    compactCommandId: undefined,
    nextTurnInbox: [],
    nextStepInbox: [],
  }
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
function editableBlocks(state: TranscriptState, mutable: boolean): Block[] {
  return mutable ? state.blocks as Block[] : state.blocks.slice()
}

function settleAssistant(
  state: TranscriptState,
  turn: number,
  step: number,
  text: string,
  reasoning: string,
  mutable: boolean,
): TranscriptState {
  const blocks = editableBlocks(state, mutable)
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
export function applyEvent(
  state: TranscriptState,
  event: SessionEvent,
  presentation?: TuiToolPresentation,
): TranscriptState {
  return foldEvent(state, event, presentation, false)
}

/**
 * Replay one immutable event log without repeatedly copying its growing block
 * array. The mutable array is private to this fold and becomes readonly when
 * the completed state escapes.
 */
export function replayEvents(
  events: readonly SessionEvent[],
  presentations?: ReadonlyMap<number, TuiToolPresentation>,
): TranscriptState {
  let state = initialTranscript()
  const indexes: ReplayIndexes = { toolByCallId: new Map() }
  for (const event of events) state = foldEvent(state, event, presentations?.get(event.seq), true, indexes)
  return state
}

interface ReplayIndexes {
  readonly toolByCallId: Map<string, number>
}

function foldEvent(
  state: TranscriptState,
  event: SessionEvent,
  presentation: TuiToolPresentation | undefined,
  mutable: boolean,
  indexes?: ReplayIndexes,
): TranscriptState {
  switch (event.type) {
    case 'turn/start':
      return { ...state, status: 'running', turn: event.data.turn, todos: [], compactCommandId: undefined }
    case 'turn/end': {
      const last = state.blocks[state.blocks.length - 1]
      const reason = event.data.reason
      const changesBlocks = (last?.kind === 'assistant' && last.streaming)
        || reason.kind === 'error'
        || reason.kind === 'aborted'
      const blocks = changesBlocks ? editableBlocks(state, mutable) : state.blocks
      if (last?.kind === 'assistant' && last.streaming) {
        blocks[blocks.length - 1] = { ...last, streaming: false }
      }
      if (reason.kind === 'error') {
        blocks.push({ kind: 'notice', level: 'error', text: 'error: ' + reason.error.code + ': ' + reason.error.message })
      } else if (reason.kind === 'aborted') {
        blocks.push({ kind: 'notice', level: 'info', text: 'interrupted' })
      }
      return { ...state, blocks, status: 'idle', compactCommandId: undefined }
    }
    case 'user/message': {
      // Synthetic plugin injections (system-prompt runtime context, skill
      // catalog) reach the surface as user-role messages but are model input,
      // not what the human typed; only human prompts render as transcript.
      if (event.data.source.kind !== 'user') return state
      const text = contentToText(event.data.content)
      if (text === '') return state
      const blocks = editableBlocks(state, mutable)
      blocks.push({ kind: 'user', text })
      return { ...state, blocks }
    }
    case 'assistant/chunk': {
      const { turn, step, chunk } = event.data
      if (chunk.type === 'text-delta') {
        const blocks = editableBlocks(state, mutable)
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
        const blocks = editableBlocks(state, mutable)
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
        const blocks = editableBlocks(state, mutable)
        const index = indexes === undefined
          ? blocks.findIndex(block => block.kind === 'tool' && block.callId === chunk.id)
          : indexes.toolByCallId.get(chunk.id) ?? -1
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
          indexes?.toolByCallId.set(chunk.id, blocks.length - 1)
        }
        return { ...state, blocks }
      }
      return state
    }
    case 'assistant/message': {
      const { turn, step, message } = event.data
      return settleAssistant(state, turn, step, contentToText(message.content), contentToReasoning(message.content), mutable)
    }
    case 'tool/call': {
      const block: Block = {
        kind: 'tool',
        callId: event.data.callId,
        name: event.data.name,
        args: prettyArgs(event.data.arguments),
        status: 'running',
        output: '',
        ...(presentation === undefined ? {} : { presentation }),
      }
      const blocks = editableBlocks(state, mutable)
      const partial = indexes === undefined
        ? blocks.findIndex(item => item.kind === 'tool' && item.callId === event.data.callId)
        : indexes.toolByCallId.get(event.data.callId) ?? -1
      if (partial >= 0) blocks[partial] = block
      else {
        blocks.push(block)
        indexes?.toolByCallId.set(event.data.callId, blocks.length - 1)
      }
      return { ...state, blocks }
    }
    case 'tool/result':
      return applyToolResult(state, event.data.message, event.data.error, presentation, mutable, indexes)
    case 'todo/write':
      return { ...state, todos: event.data.todos.map(todo => ({ ...todo })) }
    case 'command/run':
      if (event.data.name !== 'compact') return state
      return {
        ...state,
        status: 'compacting',
        compactCommandId: event.data.commandId,
      }
    case 'command/done':
      if (state.compactCommandId !== event.data.commandId) return state
      return { ...state, status: 'idle', compactCommandId: undefined }
    case 'agent/inbox/spliced': {
      const key = event.data.target === 'next-turn' ? 'nextTurnInbox' : 'nextStepInbox'
      return {
        ...state,
        [key]: state[key].toSpliced(
          event.data.start,
          event.data.removedCount ?? 0,
          ...event.data.inserted,
        ),
      }
    }
    case 'session/end-seed':
      return { ...state, nextTurnInbox: [], nextStepInbox: [] }
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
  presentation: TuiToolPresentation | undefined,
  mutable: boolean,
  indexes?: ReplayIndexes,
): TranscriptState {
  // A tool-result message carries exactly one tool-result block; the call
  // identity and outcome live on that inner block.
  const inner = message.content[0]
  if (inner?.type !== 'tool-result') return state
  const blocks = editableBlocks(state, mutable)
  const indexed = indexes?.toolByCallId.get(inner.toolCallId)
  if (indexed !== undefined) {
    const block = blocks[indexed]
    if (block?.kind === 'tool') {
      blocks[indexed] = settleTool(block, inner, error, presentation)
      return { ...state, blocks }
    }
  }
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (block?.kind === 'tool' && block.callId === inner.toolCallId) {
      blocks[i] = settleTool(block, inner, error, presentation)
      return { ...state, blocks }
    }
  }
  return state
}

function settleTool(
  block: Extract<Block, { kind: 'tool' }>,
  result: Extract<ToolResultMessage['content'][number], { type: 'tool-result' }>,
  error: { name: string; code: string } | undefined,
  presentation: TuiToolPresentation | undefined,
): Extract<Block, { kind: 'tool' }> {
  return {
    ...block,
    status: error !== undefined || result.isError === true ? 'error' : 'ok',
    output: contentToText(result.content),
    ...(presentation === undefined ? {} : { presentation }),
  }
}

/** View options: terminal geometry and live input state. */
export interface ViewOptions {
  /** Terminal width in columns. */
  width: number
  /** Terminal height in rows; the view keeps the frame inside it. */
  height: number
  /** Model name for the fixed footer. */
  model: string
  /** Effective reasoning effort for the selected model, including adapter defaults. */
  reasoningEffort?: string
  /** Current input buffer text. */
  input: string
  /** Cursor column inside the input buffer (0-based, before the prefix). */
  inputCursor: number
  /** Number of client-owned image drafts represented by input markers. */
  inputImages?: number
  /** Composer submissions accepted while the active turn is still running. */
  queuedSubmissions?: readonly TuiSubmission[]
  /** Whether to emit color SGR sequences. */
  colors: boolean
  /** Working directory shown in the footer. */
  pwd?: string
  /** Git branch shown in the footer. */
  branch?: string
  /** Product version painted on the welcome title. */
  version?: string
  /** Product name painted on the welcome title. */
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
  /** Startup-stable sample of hints shown in the welcome card. */
  welcomeTips?: readonly WelcomeTip[]
  /** Whole-session figures rendered in the footer's telemetry row. */
  sessionStats?: TuiSessionStats
  /** Harness-owned collaboration and permission state. Permission paints on the composer cap. */
  sessionControls?: TuiSessionControls
  /** Process-local repeated-prompt state rendered beside model controls. */
  loopStatus?: TuiLoopStatus
  /** Live descendant-subagent roster rendered above the composer. */
  subagents?: TuiSubagentRoster
  /** Descendant whose transcript is currently filling the viewport. */
  inspected?: TuiInspectedSubagent
  /** Visible groups, order, and label style for the status line. */
  statusBar?: StatusBarConfig
  /** Legacy status preset accepted while direct render callers migrate. */
  statusPreset?: StatusPreset
  /**
   * First transcript row to show (0 = top). Omit or pass +Infinity to pin
   * the window to the latest lines — the OMP follow-tail default.
   */
  scrollStart?: number
  /** Open one transcript block at its first row instead of following the tail. */
  focusBlock?: number
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
export const TOOL_INPUT_COLLAPSED_LINES = 3

interface ToolPreview {
  lines: string[]
  hidden: number
}

function slicePreview(
  lines: readonly string[],
  limit: number,
  expanded: boolean,
  direction: 'head' | 'tail',
): ToolPreview {
  if (expanded || lines.length <= limit) return { lines: [...lines], hidden: 0 }
  const hidden = lines.length - limit
  return {
    lines: direction === 'tail' ? lines.slice(hidden) : lines.slice(0, limit),
    hidden,
  }
}

function toolPreview(
  lines: readonly string[],
  width: number,
  limit: number,
  expanded: boolean,
  direction: 'head' | 'tail',
): ToolPreview {
  const contentWidth = Math.max(1, width - 4)
  return slicePreview(lines.flatMap(line => wrapText(line, contentWidth)), limit, expanded, direction)
}

function exclusiveDiffs(presentation: TuiToolPresentation | undefined): readonly FileDiff[] | undefined {
  if (presentation?.result?.card === 'diff') return presentation.result.diffs
  if (presentation?.result !== undefined) return undefined
  if (presentation?.call?.card === 'diff') return presentation.call.diffs
  return undefined
}

/** OMP AssistantMessage uses one horizontal cell of padding and no vertical padding. */
const ASSISTANT_PADDING_X = 1

function assistantContentLines(lines: readonly string[], width: number, paddingX: number): string[] {
  const margin = ' '.repeat(paddingX)
  return lines.map((line) => padToWidth(margin + line + margin, width))
}

function lockThinkingLine(line: string, theme: Theme): string {
  if (line === '' || !theme.colors) return line
  return theme.italic(theme.fg('thinkingText', stripAnsi(line)))
}

function hasExplicitTextColor(theme: Theme): boolean {
  const ansi = theme.getFgAnsi('text')
  return ansi !== '' && ansi !== '\x1b[39m'
}

function assistantMarkdown(
  source: string,
  theme: Theme,
  width: number,
  style?: MarkdownStyle,
): string[] {
  const paddingX = width > ASSISTANT_PADDING_X * 2 ? ASSISTANT_PADDING_X : 0
  const contentWidth = Math.max(1, width - paddingX * 2)
  const rendered = renderMarkdown(source, theme, contentWidth, style)
  if (style?.color !== 'thinkingText') return assistantContentLines(rendered, width, paddingX)
  return assistantContentLines(rendered.map(line => lockThinkingLine(line, theme)), width, paddingX)
}

function userBubble(text: string, theme: Theme, width: number): string[] {
  const inner = Math.max(1, width - 2)
  const wrapped = renderPathMentionRows(text, inner, theme)
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
): string[] {
  const icon = toolIcon(block.status, theme, spinnerFrame)
  const presentation = renderTool({
    name: block.name,
    arguments: prettyArgs(block.args),
    output: block.output,
    status: block.status,
    expanded,
    ...(block.presentation === undefined ? {} : { presentation: block.presentation }),
  })
  const diffs = exclusiveDiffs(block.presentation)
  if (diffs !== undefined) {
    const rows = alignFileDiffs(diffs)
    const stats = countDiffStats(rows)
    const statsLabel = paintDiffStats(stats.added, stats.removed, theme)
    const header = icon + ' ' + theme.bold(presentation.title ?? block.name)
      + (statsLabel === '' ? '' : ' ' + statsLabel)
    const painted = wrapPaintedDiffRows(rows, theme, width)
    const output = slicePreview(painted, TOOL_COLLAPSED_LINES, expanded, 'head')
    if (output.hidden > 0) {
      output.lines.push(theme.fg('dim', `… ${output.hidden} more lines · ⟨Ctrl+O: Expand⟩`))
    }
    const state = block.status === 'running' ? 'running' : block.status === 'ok' ? 'ok' : 'error'
    return renderFramedBlock({ header, state, sections: [{ lines: output.lines }], width }, theme)
  }
  const summary = presentation.summary === undefined || presentation.summary === ''
    ? ''
    : theme.fg('dim', ' ' + presentation.summary)
  const header = icon + ' ' + theme.bold(presentation.title ?? block.name) + summary
  const input = toolPreview(presentation.input, width, TOOL_INPUT_COLLAPSED_LINES, expanded, 'head')
  const output = toolPreview(presentation.output, width, TOOL_COLLAPSED_LINES, expanded, presentation.outputPreview)
  const hasOutput = presentation.output.length > 0
  const inputLines = input.lines.map(line => (
    block.presentation?.call?.card === 'diff' ? paintPrefixedDiffLine(line, theme) : theme.fg('toolOutput', line)
  ))
  if (input.hidden > 0) {
    const hint = hasOutput && output.hidden > 0 ? '' : ' · ⟨Ctrl+O: Expand⟩'
    inputLines.push(theme.fg('dim', `… ${input.hidden} more input lines${hint}`))
  }
  const outputLines = output.lines.map(line => (
    block.presentation?.result?.card === 'diff' ? paintPrefixedDiffLine(line, theme) : theme.fg('toolOutput', line)
  ))
  if (output.hidden > 0) {
    const position = presentation.outputPreview === 'tail' ? 'earlier' : 'more'
    const hint = theme.fg('dim', `… ${output.hidden} ${position} lines · ⟨Ctrl+O: Expand⟩`)
    if (presentation.outputPreview === 'tail') outputLines.unshift(hint)
    else outputLines.push(hint)
  }
  const sections = [
    ...(inputLines.length === 0 ? [] : [{ lines: inputLines }]),
    ...(outputLines.length === 0 ? [] : [{
      ...(inputLines.length === 0 ? {} : { label: theme.fg('toolTitle', 'Output') }),
      lines: outputLines,
    }]),
  ]
  const state = block.status === 'running' ? 'running' : block.status === 'ok' ? 'ok' : 'error'
  return renderFramedBlock({ header, state, sections, width }, theme)
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
): string[] {
  if (block.kind === 'user') return userBubble(block.text, theme, width)
  if (block.kind === 'assistant') {
    const lines: string[] = []
    if (block.reasoning !== '') {
      lines.push(...assistantMarkdown(block.reasoning, theme, width, { color: 'thinkingText', italic: true }))
      if (block.text !== '') lines.push('')
    }
    if (block.text === '' && block.streaming) {
      const paddingX = width > ASSISTANT_PADDING_X * 2 ? ASSISTANT_PADDING_X : 0
      lines.push(...assistantContentLines([theme.fg('dim', '…')], width, paddingX))
    } else if (block.text !== '') {
      lines.push(...assistantMarkdown(block.text, theme, width, hasExplicitTextColor(theme) ? { color: 'text' } : undefined))
    }
    return lines
  }
  if (block.kind === 'tool') return toolBlockLines(block, theme, width, spinnerFrame, toolsExpanded)
  if (block.kind === 'toolCatalog') return renderToolsPanel(block.tools, theme, width, toolsExpanded)
  if (block.kind === 'commandOutput') return renderCommandOutput(block.command, block.text, theme, width)
  if (block.framed !== true) {
    const prefix = '  '
    const continuation = ' '.repeat(visibleWidth(prefix))
    const tone = block.level === 'error' ? 'error' : 'dim'
    return wrapText(block.text, Math.max(1, width - visibleWidth(prefix))).map((line, index) =>
      truncateToWidth((index === 0 ? prefix : continuation) + theme.fg(tone, line), width))
  }
  const state = block.level === 'error' ? 'error' : 'info'
  const paint = (text: string): string => (block.level === 'error' ? theme.fg('error', text) : theme.fg('dim', text))
  const wrapped = wrapText(block.text, Math.max(1, width - 4))
  const title = paint(wrapped[0] ?? '')
  return renderFramedBlock({
    header: title,
    state,
    width,
    lines: wrapped.slice(1).map(paint),
    applyBg: false,
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
  lines: readonly string[]
  blockStarts: readonly number[]
}

/**
 * Scroll, activity, inbox, and composer changes do not alter transcript blocks.
 * Cache the expensive Markdown/tool fold by immutable block-array identity so
 * those frames slice already-rendered rows instead of formatting the complete
 * session again. Spinner frames matter only while a visible tool block runs.
 */
const transcriptBodyCache = new WeakMap<readonly Block[], TranscriptBodyCache>()

interface BlockLinesCache {
  width: number
  colors: boolean
  trueColor: boolean
  themeName: ThemeName
  spinnerFrame: number
  expanded: boolean
  lines: readonly string[]
}

/** Settled immutable blocks keep their expensive Markdown/tool layout. */
const blockLinesCache = new WeakMap<Block, BlockLinesCache>()

function cachedBlockLines(
  block: Block,
  options: ViewOptions,
  theme: Theme,
  themeName: ThemeName,
  trueColor: boolean,
  spinnerFrame: number,
  expanded: boolean,
): readonly string[] {
  const animatedSpinnerFrame = block.kind === 'tool' && block.status === 'running' ? spinnerFrame : -1
  const cached = blockLinesCache.get(block)
  if (cached !== undefined
    && cached.width === options.width
    && cached.colors === options.colors
    && cached.trueColor === trueColor
    && cached.themeName === themeName
    && cached.spinnerFrame === animatedSpinnerFrame
    && cached.expanded === expanded) return cached.lines
  const lines = blockLines(block, theme, options.width, spinnerFrame, expanded)
  blockLinesCache.set(block, {
    width: options.width,
    colors: options.colors,
    trueColor,
    themeName,
    spinnerFrame: animatedSpinnerFrame,
    expanded,
    lines,
  })
  return lines
}

function renderTranscriptBody(
  state: TranscriptState,
  options: ViewOptions,
  theme: Theme,
  spinnerFrame: number,
): { lines: readonly string[]; blockStarts: readonly number[] } {
  const toolsExpanded = options.toolsExpanded === true
  const expandedTools = [...(options.expandedTools ?? [])].sort().join('\0')
  const themeName = options.themeName ?? 'dark'
  const trueColor = options.trueColor === true
  const animatedSpinnerFrame = state.blocks.some(block => block.kind === 'tool' && block.status === 'running')
    ? spinnerFrame
    : -1
  const cached = transcriptBodyCache.get(state.blocks)
  if (cached !== undefined
    && cached.width === options.width
    && cached.colors === options.colors
    && cached.trueColor === trueColor
    && cached.themeName === themeName
    && cached.spinnerFrame === animatedSpinnerFrame
    && cached.toolsExpanded === toolsExpanded
    && cached.expandedTools === expandedTools) {
    return { lines: cached.lines, blockStarts: cached.blockStarts }
  }

  const lines: string[] = []
  const blockStarts: number[] = []
  let previous: Block | undefined
  for (const block of state.blocks) {
    if (lines.length > 0) {
      const previousCommand = commandSurfaceName(previous)
      const currentCommand = commandSurfaceName(block)
      if (previousCommand !== undefined && currentCommand !== undefined && previousCommand !== currentCommand) {
        lines.push('', renderCommandSeparator(theme, options.width), '')
      } else {
        lines.push('')
      }
    }
    blockStarts.push(lines.length)
    const expanded = toolsExpanded || (block.kind === 'tool' && options.expandedTools?.has(block.callId) === true)
    lines.push(...cachedBlockLines(block, options, theme, themeName, trueColor, spinnerFrame, expanded))
    previous = block
  }
  transcriptBodyCache.set(state.blocks, {
    width: options.width,
    colors: options.colors,
    trueColor,
    themeName,
    spinnerFrame: animatedSpinnerFrame,
    toolsExpanded,
    expandedTools,
    lines,
    blockStarts,
  })
  return { lines, blockStarts }
}

function commandSurfaceName(block: Block | undefined): string | undefined {
  if (block?.kind === 'toolCatalog') return 'tools'
  if (block?.kind === 'commandOutput') return block.command
  return undefined
}

/** Rows moved per Shift+Arrow (OMP ScrollView `fastScrollLines`). */
export const TRANSCRIPT_FAST_SCROLL = 5

/** Rows moved per mouse-wheel notch. */
export const TRANSCRIPT_WHEEL_SCROLL = 3

function earlierLabel(count: number): string {
  return '… ↑ ' + count + ' earlier line' + (count === 1 ? '' : 's') + ' ⟨Pg↑⟩'
}

function laterLabel(count: number): string {
  return '… ↓ ' + count + ' later line' + (count === 1 ? '' : 's') + ' ⟨Pg↓⟩'
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
        : '… ↑ ' + s + ' · ↓ ' + (len - s) + ' ⟨Pg↑/Pg↓⟩'
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

const IMAGE_MARKER = /\[Image #\d+(?:, \d+x\d+)?\]/gu

function paintImageMarkerSlice(fullText: string, slice: string, sourceStart: number, theme: Theme): string {
  const sourceEnd = sourceStart + slice.length
  let output = ''
  let cursor = sourceStart
  for (const match of fullText.matchAll(IMAGE_MARKER)) {
    const markerStart = match.index
    const markerEnd = markerStart + match[0].length
    if (markerEnd <= sourceStart || markerStart >= sourceEnd) continue
    const overlapStart = Math.max(sourceStart, markerStart)
    const overlapEnd = Math.min(sourceEnd, markerEnd)
    output += fullText.slice(cursor, overlapStart)
    output += theme.underline(theme.bold(theme.fg('accent', fullText.slice(overlapStart, overlapEnd))))
    cursor = overlapEnd
  }
  output += fullText.slice(cursor, sourceEnd)
  return output
}

/** Maximum number of queued composer submissions kept visible above the editor. */
export const QUEUED_SUBMISSION_PREVIEW = 3

/** Maximum number of Todo items kept visible above the composer. */
export const TODO_PREVIEW = 5

/** Maximum number of descendant subagents kept visible above the composer. */
export const SUBAGENT_PREVIEW = 5

function todoPreviewStart(todos: readonly TodoItem[]): number {
  if (todos.length <= TODO_PREVIEW) return 0
  const active = todos.findIndex(todo => todo.status === 'in_progress')
  if (active >= 0) return active
  const pending = todos.findIndex(todo => todo.status === 'pending')
  return pending >= 0 ? pending : Math.max(0, todos.length - TODO_PREVIEW)
}

/** Compact, unframed Todo tree placed above queued messages. */
export function renderTodos(todos: readonly TodoItem[], theme: Theme, width: number): string[] {
  if (todos.length === 0 || width <= 0) return []
  const completed = todos.filter(todo => todo.status === 'completed').length
  const header = '  ' + theme.bold(theme.fg('accent', 'Todos'))
    + theme.fg('dim', ` · ${completed}/${todos.length}`)
  const start = todoPreviewStart(todos)
  const end = Math.min(todos.length, start + TODO_PREVIEW)
  const rows: Array<TodoItem | string> = [
    ...(start === 0 ? [] : [`… ${start} earlier`]),
    ...todos.slice(start, end),
    ...(end === todos.length ? [] : [`… ${todos.length - end} more`]),
  ]
  const lines = [header, ...rows.map((row, index) => {
    const branch = '  ' + theme.fg('dim', index === rows.length - 1 ? '└─' : '├─') + ' '
    if (typeof row === 'string') return branch + theme.fg('dim', row)
    const todo = row
    if (todo.status === 'completed') {
      return branch + theme.fg('success', SYMBOL.success + ' ' + theme.strikethrough(todo.content))
    }
    if (todo.status === 'in_progress') {
      return branch + theme.fg('accent', SYMBOL.pending + ' ' + todo.content)
    }
    return branch + theme.fg('dim', SYMBOL.pending + ' ' + todo.content)
  })]
  return lines.map(line => truncateToWidth(line, width))
}

function subagentPreviewStart(agents: readonly TuiSubagentView[]): number {
  if (agents.length <= SUBAGENT_PREVIEW) return 0
  const active = agents.findIndex(agent => agent.phase === 'running' || agent.phase === 'starting')
  if (active >= 0) return Math.max(0, Math.min(active, agents.length - SUBAGENT_PREVIEW))
  const waiting = agents.findIndex(agent => agent.phase === 'waiting')
  return waiting >= 0
    ? Math.max(0, Math.min(waiting, agents.length - SUBAGENT_PREVIEW))
    : Math.max(0, agents.length - SUBAGENT_PREVIEW)
}

function subagentPhaseGlyph(phase: TuiSubagentPhase, theme: Theme, spinnerFrame: number): string {
  if (phase === 'running' || phase === 'starting') {
    return theme.fg('accent', SPINNER[spinnerFrame % SPINNER.length] ?? SYMBOL.running)
  }
  if (phase === 'error') return theme.fg('error', SYMBOL.error)
  return theme.fg('success', SYMBOL.success)
}

function subagentRowText(agent: TuiSubagentView): string {
  const current = agent.activity.at(-1)
  const detail = current === undefined || current.status === 'ok' || current.text === agent.label
    ? ''
    : current.text
  const indent = agent.depth > 1 ? `${'  '.repeat(agent.depth - 1)}` : ''
  return detail === '' ? indent + agent.label : `${indent}${agent.label} · ${detail}`
}

/** Painted roster plus click targets relative to the first roster row. */
export interface SubagentRosterPaint {
  lines: string[]
  items: readonly { id: string; row: number }[]
}

/** Compact, unframed descendant-subagent tree placed above Todos. */
export function renderSubagents(
  roster: TuiSubagentRoster | undefined,
  theme: Theme,
  width: number,
  spinnerFrame = 0,
  inspectedId?: string,
): SubagentRosterPaint {
  const agents = roster?.agents ?? []
  if (agents.length === 0 || width <= 0) return { lines: [], items: [] }
  const running = agents.filter(agent => agent.phase === 'running' || agent.phase === 'starting').length
  const failed = agents.filter(agent => agent.phase === 'error').length
  const done = agents.filter(agent => agent.phase === 'completed' || agent.phase === 'waiting').length
  const counts = [
    running === 0 ? undefined : `${running} running`,
    done === 0 ? undefined : `${done} done`,
    failed === 0 ? undefined : `${failed} failed`,
  ].filter((part): part is string => part !== undefined)
  const header = '  ' + theme.bold(theme.fg('accent', 'Agents'))
    + (counts.length === 0 ? '' : theme.fg('dim', ` · ${counts.join(' · ')}`))
  const start = subagentPreviewStart(agents)
  const end = Math.min(agents.length, start + SUBAGENT_PREVIEW)
  const rows: Array<TuiSubagentView | string> = [
    ...(start === 0 ? [] : [`… ${start} earlier`]),
    ...agents.slice(start, end),
    ...(end === agents.length ? [] : [`… ${agents.length - end} more`]),
  ]
  const items: { id: string; row: number }[] = []
  const lines = [header, ...rows.map((row, index) => {
    const branch = '  ' + theme.fg('dim', index === rows.length - 1 ? '└─' : '├─') + ' '
    if (typeof row === 'string') return branch + theme.fg('dim', row)
    items.push({ id: row.id, row: index + 1 })
    const selected = inspectedId === row.id
    const paint = row.phase === 'completed'
      ? (text: string) => theme.fg('dim', theme.strikethrough(text))
      : row.phase === 'error'
        ? (text: string) => theme.fg('error', text)
        : row.phase === 'waiting'
          ? (text: string) => theme.fg('dim', text)
          : (text: string) => text
    const marker = selected ? theme.fg('accent', SYMBOL.cursor) + ' ' : ''
    const body = marker + subagentPhaseGlyph(row.phase, theme, spinnerFrame) + ' ' + paint(subagentRowText(row))
    return branch + (selected ? theme.bold(body) : body)
  })]
  return {
    lines: lines.map(line => truncateToWidth(line, width)),
    items,
  }
}

/** Persistent inspect chrome: stays visible while the child transcript scrolls. */
export function renderInspectBanner(
  inspected: TuiInspectedSubagent | undefined,
  theme: Theme,
  width: number,
  spinnerFrame = 0,
): string[] {
  if (inspected === undefined || width <= 0) return []
  const guidance = inspected.writable ? 'Enter to steer · Esc to return' : 'read-only · Esc to return'
  const line = '  ' + theme.fg('accent', '←') + ' ' + subagentPhaseGlyph(inspected.phase, theme, spinnerFrame)
    + ' ' + theme.bold(inspected.label)
    + theme.fg('dim', ` · ${guidance}`)
  return [truncateToWidth(line, width)]
}

/** Hit a painted roster row, or `undefined` when the click is on overflow chrome. */
export function hitTestSubagentRoster(
  items: readonly { id: string; row: number }[],
  localRow: number,
): string | undefined {
  return items.find(item => item.row === localRow)?.id
}

function queuedSubmissionLabel(submission: TuiSubmission): string {
  const text = submission.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    .replaceAll('\n', ' ↵ ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (text !== '') return text
  const count = submission.images.length
  return count === 0 ? '(empty message)' : `${count} image${count === 1 ? '' : 's'}`
}

function queuedMessageLabel(message: UserMessage): string {
  const text = contentToText(message.content).replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    .replaceAll('\n', ' ↵ ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (text !== '') return text
  const count = message.content.filter(block => block.type === 'image').length
  return count === 0 ? '(empty message)' : `${count} image${count === 1 ? '' : 's'}`
}

/** Compact, unframed pending-message view placed immediately above the composer. */
export function renderQueuedSubmissions(
  submissions: readonly TuiSubmission[],
  theme: Theme,
  width: number,
  inbox: readonly UserMessage[] = [],
): string[] {
  const labels = [
    ...inbox.filter(message => message.source.kind === 'user').map(queuedMessageLabel),
    ...submissions.map(queuedSubmissionLabel),
  ]
  if (labels.length === 0 || width <= 0) return []
  const start = Math.max(0, labels.length - QUEUED_SUBMISSION_PREVIEW)
  const hidden = start
  const queueLabel = theme.bold(theme.fg('accent', 'Queued'))
  const rail = '  ' + theme.fg('border', '│') + ' '
  const alignAction = (left: string, action: string, preserveAction = true): string => {
    const leftWidth = visibleWidth(left)
    const actionWidth = visibleWidth(action)
    if (leftWidth + actionWidth + 2 <= width) {
      return left + ' '.repeat(width - leftWidth - actionWidth) + action
    }
    if (!preserveAction || actionWidth + 4 >= width) return truncateToWidth(left, width)
    const paintedLeft = truncateToWidth(left, width - actionWidth - 2)
    return paintedLeft + '  ' + action
  }
  if (labels.length === 1) {
    return [alignAction(
      rail + queueLabel + theme.fg('dim', ' · ') + theme.fg('text', labels[0] ?? ''),
      theme.fg('dim', '↑ edit'),
    )]
  }
  const summary = ` · ${labels.length}${hidden === 0 ? '' : ` · ${hidden} earlier`}`
  const visibleLabels = labels.slice(start)
  const lines = [
    alignAction(rail + queueLabel + theme.fg('dim', summary), theme.fg('dim', '↑ edit latest'), false),
    ...visibleLabels.map((label, index) =>
      rail + theme.fg(index === visibleLabels.length - 1 ? 'accent' : 'dim', String(start + index + 1))
        + '  ' + theme.fg('text', label)),
  ]
  return lines.map(line => truncateToWidth(line, width))
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
  if (options.settings !== undefined && options.promptSelector === undefined) {
    const settings = renderSettings(options.settings, theme, width, height)
    return {
      lines: fitFrame(settings.lines, width),
      cursor: settings.cursor,
      cursorVisible: false,
      overlay: { kind: 'settings', start: 0, itemRows: settings.itemRows },
    }
  }
  if (options.promptSelector?.request.presentation === 'fullscreen-list') {
    const selector = renderPromptSelectorPage(
      options.promptSelector,
      theme,
      width,
      height,
      options.input,
      options.inputCursor,
      appName,
    )
    return {
      lines: fitFrame(selector.lines, width),
      cursor: selector.cursor,
      cursorVisible: true,
      ...(selector.editor === undefined ? {} : { editor: selector.editor }),
      overlay: {
        kind: 'prompt',
        start: 0,
        ...(selector.itemRows === undefined ? {} : { itemRows: selector.itemRows }),
      },
    }
  }
  if (options.promptSelector?.request.presentation === 'plan-review') {
    const review = renderPlanReviewPage(
      options.promptSelector,
      theme,
      width,
      height,
      options.input,
      options.inputCursor,
      appName,
    )
    return {
      lines: fitFrame(review.lines, width),
      cursor: review.cursor,
      cursorVisible: review.cursorVisible === true,
      ...(review.editor === undefined ? {} : { editor: review.editor }),
      overlay: {
        kind: 'prompt',
        start: 0,
        ...(review.document === undefined ? {} : { document: review.document }),
      },
    }
  }
  const welcome = renderWelcome({
    width,
    model: options.model,
    ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
    version,
    appName,
    ...(options.recentSessions === undefined ? {} : { recentSessions: options.recentSessions }),
    ...(options.welcomeTips === undefined ? {} : { tips: options.welcomeTips }),
  }, theme)

  const transcript = renderTranscriptBody(state, options, theme, spinnerFrame)
  const body: string[] = [...welcome]
  let transcriptStart = body.length
  if (transcript.lines.length > 0) {
    if (body.length > 0) body.push('')
    transcriptStart = body.length
    body.push(...transcript.lines)
  }

  const working = state.status === 'running'
    ? renderWorking(theme, spinnerFrame, undefined, width)
    : state.status === 'compacting'
      ? renderWorking(theme, spinnerFrame, 'Compacting', width)
      : []
  const statusBar = resolveStatusBarConfig(options.statusBar, options.statusPreset)
  const inlineHint = options.inspected === undefined
    ? slashInlineHint(options.input, options.inputCursor, options.commands)
    : options.inspected.writable
      ? slashInlineHint(options.input, options.inputCursor, options.commands) ?? 'Enter to steer · Esc to return'
      : 'Read-only · Esc to return'
  const statusFooter = renderStatusFooter({
    model: options.model,
    ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
    ...(options.sessionControls === undefined ? {} : { controls: options.sessionControls }),
    ...(options.loopStatus === undefined ? {} : { loop: options.loopStatus }),
    ...(pwd === '' ? {} : { pwd }),
    ...(options.branch === undefined || options.branch === '' ? {} : { branch: options.branch }),
    ...(options.sessionStats === undefined ? {} : { stats: options.sessionStats }),
    config: statusBar,
    width,
  }, theme)
  const permissionBadge = renderPermissionBadge(options.sessionControls?.permission, theme)
  const editorOpts: Parameters<typeof renderEditor>[0] = {
    width,
    input: options.input,
    inputCursor: options.inputCursor,
    status: ' ' + theme.fg('accent', '🐳') + ' ',
    ...(permissionBadge === '' ? {} : { statusRight: ' ' + permissionBadge + ' ' }),
    border: options.inspected !== undefined && options.inspected.writable !== true
      || state.status === 'idle'
      ? 'border'
      : 'accent',
    ...(options.inputImages === undefined || options.inputImages === 0
      ? {}
      : { paintInput: (text: string, start: number) => paintImageMarkerSlice(options.input, text, start, theme) }),
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
  const queuedSubmissions = editor === undefined || options.inspected !== undefined
    ? []
    : renderQueuedSubmissions(options.queuedSubmissions ?? [], theme, width, state.nextTurnInbox)
  const todos = editor === undefined || options.inspected !== undefined ? [] : renderTodos(state.todos, theme, width)
  const inspect = editor === undefined ? [] : renderInspectBanner(options.inspected, theme, width, spinnerFrame)
  const roster = editor === undefined
    ? { lines: [] as string[], items: [] as readonly { id: string; row: number }[] }
    : renderSubagents(options.subagents, theme, width, spinnerFrame, options.inspected?.id)
  const subagents = roster.lines
  const autocomplete = promptSelector !== undefined || settings !== undefined || copySelector !== undefined || search !== undefined
    || options.autocomplete === undefined
    ? []
    : renderAutocomplete(options.autocomplete.items, options.autocomplete.selected, theme, width)
  const inputLines = promptSelector?.lines ?? settings?.lines ?? copySelector?.lines ?? search?.lines
    ?? (editor === undefined ? [] : editor.lines)
  const spacer = 1
  const reserved = inputLines.length + working.length + inspect.length + subagents.length + todos.length + queuedSubmissions.length + spacer + autocomplete.length + statusFooter.length
  const budget = Math.max(0, height - reserved)
  const focusStart = options.focusBlock === undefined
    ? undefined
    : transcript.blockStarts[Math.max(0, Math.min(options.focusBlock, transcript.blockStarts.length - 1))]
  const requestedStart = focusStart === undefined
    ? (options.scrollStart ?? Number.POSITIVE_INFINITY)
    : transcriptStart + focusStart
  const windowed = windowTranscript(body, budget, requestedStart, theme)
  const visible = windowed.lines

  const lines: string[] = [...visible]
  if (visible.length > 0) lines.push('')
  const bottomRows = working.length + inspect.length + subagents.length + todos.length + queuedSubmissions.length + inputLines.length + autocomplete.length + statusFooter.length
  const fill = Math.max(0, height - lines.length - bottomRows)
  lines.push(...Array.from({ length: fill }, () => ''))
  lines.push(...working)
  const inspectStart = lines.length
  lines.push(...inspect)
  const subagentStart = lines.length
  lines.push(...subagents)
  lines.push(...todos)
  lines.push(...queuedSubmissions)
  const editorStart = lines.length
  lines.push(...inputLines)
  lines.push(...autocomplete)
  lines.push(...statusFooter)
  const trimmed = fitFrame(lines, width)
  const caret = promptSelector?.cursor ?? settings?.cursor ?? copySelector?.cursor ?? search?.cursor ?? editor?.cursor ?? { row: 0, column: 0 }
  return {
    lines: trimmed,
    cursor: {
      row: editorStart + caret.row,
      column: Math.min(caret.column, width),
    },
    cursorVisible: state.status === 'compacting'
      || (options.inspected !== undefined && options.inspected.writable !== true)
      ? false
      : promptSelector?.cursorVisible ?? (settings === undefined && copySelector === undefined),
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
    ...(inspect.length === 0 && subagents.length === 0
      ? {}
      : {
        chrome: {
          ...(inspect.length === 0 ? {} : { inspect: { start: inspectStart, rows: inspect.length } }),
          ...(subagents.length === 0
            ? {}
            : { subagents: { start: subagentStart, headerRows: 1, rows: subagents.length, items: roster.items } }),
        },
      }),
  }
}
