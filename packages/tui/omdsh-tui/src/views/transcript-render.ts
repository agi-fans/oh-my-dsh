/**
 * Transcript rendering: Block -> lines. Every function here is pure; the two
 * WeakMap caches key formatted rows on the immutable block objects the fold
 * half produces, so scrolling never reformats settled content.
 * @module @agi-fans/dsh-tui
 */

import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { FileDiff } from '@deepseek-ai/dsh-tools'
import type { AutocompleteItem, SlashCommand } from './autocomplete.ts'
import { leadingSlashCommandNameRange, renderAutocomplete, slashInlineHint } from './autocomplete.ts'
import { HISTORY_SEARCH_MAX_VISIBLE, type HistorySearchState, renderHistorySearch } from './history-search.ts'
import { DEEP_DRIVING_LABEL, renderEditor, renderFramedBlock, renderWelcome } from '../chrome/box.ts'
import { renderMarkdown, type MarkdownStyle } from '../chrome/markdown.ts'
import type { DocumentRows, FoldMark, Frame, TranscriptScroll } from '../chrome/renderer.ts'
import { renderCopySelector, type CopySelectorState } from './copy-selector.ts'
import { renderSettings, type SettingsState } from './settings-list.ts'
import { renderTrajectory, type TrajectoryState } from './trajectory.ts'
import { renderAgentHub, type AgentHubState } from './agent-hub.ts'
import {
  renderImagePreviewPage,
  renderPlanReviewPage,
  renderPromptSelector,
  renderPromptSelectorPage,
  renderPromptTreePage,
  type PromptSelectorState,
} from './prompt-selector.ts'
import { resolveStatusBarConfig, type ResolvedStatusBarConfig, type StatusBarConfig, type StatusPreset } from '../chrome/status-config.ts'
import { renderPermissionBadge, renderStatusFooter } from '../chrome/status-line.ts'
import { createTheme, paintSurface, SPINNER, SYMBOL, BOX, type Theme, type ThemeColor, type ThemeName } from '../chrome/theme.ts'
import { highlightToolText, toolPayloadLanguage } from '../chrome/code-highlight.ts'
import { renderGoalBar } from '../chrome/goal-bar.ts'
import { padToWidth, sliceCells, stripAnsi, truncateToWidth, visibleWidth, wrapTextStable } from '../chrome/width.ts'
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
  wrapPaintedDiffRows,
} from '../chrome/diff-render.ts'
import { workspaceBlockLines, WORKSPACE_COLLAPSED_LINES } from './workspace-changes.ts'
import { blockFileAction } from './file-actions.ts'
import type { TranscriptFileRegion } from '../chrome/renderer.ts'
import { renderTool, toolArgSubject, type TuiToolPresentation } from '../chrome/tool-renderers.ts'
import { toolArgsObject } from '../chrome/tool-args.ts'
import { renderToolsPanel } from '../chrome/tools-list.ts'
import { renderCommandOutput, renderCommandSeparator, renderShell } from '../chrome/command-output.ts'
import { terminalColorsKey, type TerminalColors } from '../chrome/terminal-colors.ts'
import type { ColorDepth } from '../chrome/theme.ts'
import { renderPathMentionRows } from '../chrome/path-mentions.ts'
import { formatElapsed } from '../chrome/relative-time.ts'
import {
  blockMatchesQuery, matchedRows, searchMatches, transcriptSearchHint,
  type SearchableBlock, type TranscriptSearchMatch,
} from './transcript-search.ts'
export { formatElapsed }
import type { MotionMode } from '../session/tui-settings.ts'
import {
  contentToText,
  prettyArgs,
  reasoningKey,
  type Block,
  type TodoItem,
  type ToolBlockStatus,
  type TranscriptState,
  type WorkspaceBlock,
} from './transcript-types.ts'

function isBlockPending(block: Block): boolean {
  return (block.kind === 'assistant' && block.streaming) || (block.kind === 'tool' && block.status === 'running')
}

export interface ViewOptions {
  /** Effective key for active-turn guidance, when the provider has an admission handler. */
  steerKey?: string
  /** Terminal width in columns. */
  width: number
  /** Terminal height in rows; the view keeps the frame inside it. */
  height: number
  /** Model name for the fixed footer. */
  model: string
  /** Effective reasoning effort for the selected model, including adapter defaults. */
  reasoningEffort?: string
  /** Folded session title; rendered only when the footer's `session` item is enabled. */
  sessionTitle?: string
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
  /** Product name painted on overlay titles; keep this the command a reader can type. */
  appName?: string
  /**
   * Product name painted on the startup header. Only the header uses the long
   * name; overlay titles keep {@link appName} so they still name the command.
   */
  displayName?: string
  /** Spinner phase while a turn or tool is running. */
  spinnerFrame?: number
  /** Animation policy for streaming, activity marks, and the working label. */
  motion?: MotionMode
  mathMode?: import('../chrome/math.ts').MathMode
  mermaidMode?: import('../chrome/mermaid.ts').MermaidMode
  /** Color depth; defaults to 16 colors so tests stay deterministic. */
  colorDepth?: ColorDepth
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
  /** `/trajectory` full-screen event ledger. */
  trajectory?: TrajectoryState
  /** Keyboard-first full-screen descendant roster and inspector. */
  agentHub?: AgentHubState
  /** Terminal-owned graphics capability and measured cell geometry. */
  imageProtocol?: import('../chrome/terminal-images.ts').ImageProtocol
  imageCellSize?: { width: number; height: number }
  /** Human-interaction selector; replaces the normal editor while active. */
  promptSelector?: PromptSelectorState
  /** Effective local + agent-scoped slash command catalog. */
  commands?: readonly SlashCommand[]
  /** Durable rows shown in the welcome card. */
  recentSessions?: readonly TuiRecentSession[]
  /** Startup-stable sample of hints shown in the welcome card. */
  /** False when no model route is visibly configured; the composer then points at /login. */
  modelReady?: boolean
  /** Whole-session figures rendered in the footer's telemetry row. */
  sessionStats?: TuiSessionStats
  /** Harness-owned collaboration and permission state. Permission paints on the composer cap. */
  sessionControls?: TuiSessionControls
  /** Process-local repeated-prompt state rendered beside model controls. */
  loopStatus?: TuiLoopStatus
  /** Live descendant-subagent roster rendered above the composer. */
  subagents?: TuiSubagentRoster
  /** Composer-boundary launcher focus entered with Down on an empty draft. */
  subagentLauncherFocused?: boolean
  /** Descendant whose transcript is currently filling the viewport. */
  inspected?: TuiInspectedSubagent
  /** Visible groups, order, and label style for the status line. */
  statusBar?: ResolvedStatusBarConfig | StatusBarConfig
  /** Legacy status preset accepted while direct render callers migrate. */
  statusPreset?: StatusPreset
  /**
   * First transcript row to show (0 = top). Omit or pass +Infinity to pin
   * the window to the latest lines — the OMP follow-tail default.
   */
  scrollStart?: number
  /** Focus one transcript block instead of following the tail. */
  focusBlock?: number
  /** Which edge of the focused block to show; searches default to its start. */
  focusBlockEdge?: 'start' | 'end'
  /**
   * Active transcript search. Matching block rows containing the query paint
   * inverse; `matches` are block indexes in render order and `focus` selects
   * the one the caller has scrolled to.
   */
  /**
   * Search intent only.
   *
   * Occurrences are not passed in: they are derived here, from the same rows the
   * reader sees, so the painted span and the reported count cannot disagree.
   */
  transcriptSearch?: { query: string; focus: number; editing: boolean }
  /** Legacy full-output override for direct callers and the tool catalog. */
  toolsExpanded?: boolean
  /** Tool calls whose complete inputs and results are visible. */
  expandedTools?: ReadonlySet<string>
  /** Effective application binding used in preview hints. */
  toolDetailsKey?: string
  /** Effective application binding used in completed-turn expansion hints. */
  turnDetailsKey?: string
  /** Legacy reasoning anchors retained for search and scroll mapping. */
  expandedReasoning?: ReadonlySet<string>
  /**
   * Collapse every thought to one line.
   *
   * A collapsed thought is still a fold a reader can open, so the identity of
   * what is open stays in `expandedReasoning`; this flag only decides the
   * default. Keeping the two apart is what lets Ctrl+T flip the whole
   * transcript without inventing a second notion of "open".
   */
  hideThinking?: boolean
  /** Process groups the reader opened, keyed by {@link ProcessGroup.key}. */
  openedGroups?: ReadonlySet<string>
  /** Transient activity label that replaces the default working text. */
  workingLabel?: string
  /**
   * A confirmation or reading of the last action, drawn once and replaced.
   *
   * It sits on the composer's bottom border so it costs no transcript row: a
   * status that says what a key just did is not part of the conversation, and
   * appending it to history would make the immutable scrollback carry chatter.
   */
  transientStatus?: string
  /**
   * What the terminal reported about itself. A `system` theme and 16-color
   * quantization both read it, so it also keys every formatted-row cache.
   */
  terminal?: TerminalColors
}

/** The depth a frame encodes with. */
function colorDepthOf(options: ViewOptions): ColorDepth {
  return options.colorDepth ?? 'ansi16'
}

/** Cache key for everything the color depth and the reported terminal colors can change. */
function terminalKey(options: ViewOptions): string {
  return `${colorDepthOf(options)}|${terminalColorsKey(options.terminal)}`
}

function exclusiveDiffs(presentation: TuiToolPresentation | undefined): readonly FileDiff[] | undefined {
  if (presentation?.result?.card === 'diff') return presentation.result.diffs
  if (presentation?.result !== undefined) return undefined
  if (presentation?.call?.card === 'diff') return presentation.call.diffs
  return undefined
}

/**
 * The transcript's one content column.
 *
 * Every block starts its words in the same column: a reply, a prompt after its
 * `›`, a run's header after its `▸`, a notice. The marks own the two cells to
 * the left of it. A reply used to sit one cell in while the marked rows put
 * their words at three, so a screen had four left edges and read as clutter
 * however tidy each block was on its own.
 */
const ASSISTANT_PADDING_X = 2

/** Process summaries keep a readable measure even on wide terminals. */
const PROCESS_WIDTH = 80

function processRoom(width: number, head: string): number {
  return Math.max(1, Math.min(PROCESS_WIDTH, width - 2) - visibleWidth(head))
}

/** Shorten directories before sacrificing the filename. Both separators occur in replayed sessions. */
function shortPath(path: string, width: number): string {
  if (visibleWidth(path) <= width) return path
  const parts = path.split(/[/\\]/u)
  if (parts.length < 2) return truncateToWidth(path, width)
  const separator = path.includes('\\') ? '\\' : '/'
  const file = parts.pop()!
  const tail = '…' + separator + file
  if (visibleWidth(tail) >= width) return truncateToWidth(file, width)
  let prefix = ''
  for (const part of parts) {
    const next = prefix + part + separator
    if (visibleWidth(next + tail) > width) break
    prefix = next
  }
  return prefix + tail
}

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

/**
 * What the reader typed.
 *
 * No mark in front of it. The prompt is the one block whose author is already
 * known — the reader typed it, and it is the row that opens a turn — so it
 * carries its own tint as a slab and reads as a prompt without a glyph
 * claiming what the tint already says. Its words sit on the same column as
 * everything else, so nothing on the screen is held off by a gutter.
 */
function userBubble(text: string, theme: Theme, width: number): string[] {
  const gutter = '  '
  const wrapped = renderPathMentionRows(text, Math.max(1, width - gutter.length), theme)
  const rows = ['', ...wrapped, '']
  // The padding rows share the prompt's tint, so the prompt is one slab that
  // opens the turn. Unpainted, they were two blank rows of their own on top of
  // the gap between blocks, and the prompt floated in twice the space of
  // anything else on the screen.
  return rows.map((row, index) => {
    if (row === '') return paintSurface(theme, 'userMessageBg', 'userMessageText', padToWidth('', width))
    const promptMark = index === 1 && theme.colors ? '\x1b]133;A\x07' : ''
    const content = padToWidth((index === 1 ? promptMark + gutter : '') + row, width)
    return paintSurface(theme, 'userMessageBg', 'userMessageText', content)
  })
}

function toolIcon(status: ToolBlockStatus, theme: Theme, spinnerFrame: number): string {
  if (status === 'running') {
    if (spinnerFrame < 0) return theme.fg('accent', SYMBOL.running)
    return theme.fg('accent', SPINNER[spinnerFrame % SPINNER.length] ?? SYMBOL.running)
  }
  if (status === 'ok') return theme.fg('success', SYMBOL.success)
  return theme.fg('error', SYMBOL.error)
}

/**
 * The gutter mark for a call, or nothing at all.
 *
 * A settled successful call used to carry a checkmark, and a run of five calls
 * put five identical checkmarks in a column — a signal that says only "the row
 * above exists", which it always did. The gutter is for states a reader has to
 * act on: in flight, or wrong. A run of successes is legible by its shape, and
 * the marks that remain mean something.
 */
function toolStatusMark(status: ToolBlockStatus, theme: Theme, spinnerFrame: number): string {
  if (status === 'ok') return ''
  return toolIcon(status, theme, spinnerFrame)
}

/**
 * One-line fact for a failed call.
 *
 * The row has to answer "what failed" on its own, because that is the whole
 * reason the reader is looking at this line. A terminal echoing the command it
 * just ran is not the answer, so it is skipped along with blank lines; whatever
 * comes back is the first thing the tool itself complained about. Falls back to
 * the call's own summary when the output says nothing.
 */
function toolFailureFact(output: string, command: string | undefined, fact: string): string {
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (command !== undefined
      && (trimmed === command || trimmed === `> ${command}` || trimmed === `$ ${command}`)) continue
    return trimmed
  }
  return fact
}

/**
 * A folded call shows its description once, or a kind and subject as fallback.
 * Errors reserve space for their reason; full commands and output stay in the
 * expanded block. Process rows share an 80-cell measure and right padding.
 */
function toolRowLine(
  block: Extract<Block, { kind: 'tool' }>,
  theme: Theme,
  width: number,
  spinnerFrame: number,
): string[] {
  const presentation = renderTool({
    name: block.name,
    arguments: prettyArgs(block.args),
    output: block.output,
    status: block.status,
    expanded: false,
    ...(block.partial === true ? { partial: true } : {}),
    ...(block.presentation === undefined ? {} : { presentation: block.presentation }),
  })
  // A PTC sub-call ran inside a program, not because the model asked for it
  // directly. Indenting says that without a second visual vocabulary, and the
  // width budget shrinks to match so the row still ends at the same column.
  const nest = block.parentCallId === undefined ? '' : '  '
  // No gutter column. A settled successful call carries no mark at all — a
  // column of identical bullets says only that the row above exists — and the
  // two that remain are the states a reader has to act on: motion while the
  // call is in flight, and the error mark.
  const mark = block.status === 'ok' ? '' : toolStatusMark(block.status, theme, spinnerFrame) + ' '
  const head = nest + mark
  const room = processRoom(width, head)
  const label = processLabel(block.name)
  const subject = toolRowSubject(block, presentation, label)
  const args = toolArgsObject(block.args)
  const call = block.presentation?.call
  const description = args?.['description'] ?? (call?.card === 'terminal' ? call.description : undefined)
  const descriptionLed = (COMMAND_TOOL.test(block.name) || call?.card === 'terminal')
    && typeof description === 'string' && description.trim() !== ''
  // The echo a failure skips is the command line, which a description-led row
  // no longer carries as its subject.
  const argCommand = args?.['command']
  const command = typeof argCommand === 'string'
    ? argCommand
    : block.presentation?.call?.card === 'terminal' ? presentation.input[0] ?? subject : subject
  const fact = block.status === 'error'
    ? firstLineOf(block.job !== undefined && block.job.status !== 'completed'
      ? block.job.detail ?? block.job.status
      : toolFailureFact(block.output, command, presentation.summary ?? '')).replace(/^error:\s*/iu, '')
    : exclusiveDiffs(block.presentation) === undefined ? '' : presentation.summary ?? ''
  // The fact continues the sentence the row already is — `Read file · a.ts ·
  // no such file` — rather than sitting against the right edge, where it read
  // as a separate column that belonged to no row in particular. It is reserved
  // first so a long subject cannot push it off; a failure gets the larger
  // share, because its fact is the reason the reader stopped.
  const factShare = block.status === 'error' ? 0.5 : 1 / 3
  const factRoom = Math.min(visibleWidth(fact), Math.floor(Math.max(1, room) * factShare))
  const afterFact = Math.max(1, room - (factRoom === 0 ? 0 : factRoom + ROW_JOIN.length))
  const labelRoom = descriptionLed ? 0 : Math.min(visibleWidth(label), afterFact)
  const detailRoom = descriptionLed ? afterFact : afterFact - labelRoom - ROW_JOIN.length
  const labelText = descriptionLed ? '' : truncateToWidth(label, Math.max(1, labelRoom))
  const pathSubject = ['read', 'write', 'edit'].includes(block.name)
  const detailText = subject === '' || detailRoom < (descriptionLed ? 1 : 8) ? ''
    : pathSubject ? shortPath(subject, detailRoom) : truncateToWidth(subject, detailRoom)
  const tailText = fact === '' || factRoom === 0 ? '' : truncateToWidth(fact, factRoom)
  const text = labelText + (detailText === '' ? '' : (descriptionLed ? '' : ROW_JOIN) + detailText) + (tailText === '' ? '' : ROW_JOIN)
  // A failure is the one line in a run that has to stay findable while scrolling
  // past, so its fact carries the error colour rather than the row's dim.
  const tail = tailText === '' ? '' : block.status === 'error' ? theme.fg('error', tailText) : theme.dim(tailText)
  return [padToWidth(truncateToWidth(head + theme.fg('muted', text) + tail, Math.max(1, width - 2)), width)]
}

/** Separator between a process subject and its outcome. */
const ROW_JOIN = ' · '

/** Tools whose `description` argument says what a command was for. */
const COMMAND_TOOL = /^(bash|shell|pwsh|exec)$/

/**
 * What a call acted on, as one line.
 *
 * A shell call carries a `description` written for exactly this purpose, and it
 * reads as intent where the command reads as plumbing: `Show recent commits and
 * status` rather than `cd /long/path && git log --oneline -15 && echo ---`. The
 * command stays reachable by opening the row. Everything else reads its
 * argument fields in the shared order, then any string argument at all — a
 * skill call's only argument is `name` — and finally the card's own title when
 * it says something the label does not.
 */
function toolRowSubject(
  block: Extract<Block, { kind: 'tool' }>,
  presentation: { title?: string; input: readonly string[] },
  label: string,
): string {
  const args = toolArgsObject(block.args)
  const call = block.presentation?.call
  if (COMMAND_TOOL.test(block.name) || call?.card === 'terminal') {
    const description = args?.['description'] ?? (call?.card === 'terminal' ? call.description : undefined)
    if (typeof description === 'string' && description.trim() !== '') return firstLineOf(description)
  }
  const fromFields = toolArgSubject(block.args, block.partial === true)
  if (fromFields !== '') return firstLineOf(fromFields)
  if (args !== undefined) {
    for (const value of Object.values(args)) {
      if (typeof value === 'string' && value.trim() !== '') return firstLineOf(value)
    }
  }
  // A card's first input line is the tool's own idea of what the call was — a
  // terminal card puts the command there and its title is only the tool name.
  const fromCard = call === undefined ? '' : firstLineOf(presentation.input[0] ?? '')
  if (fromCard !== '') return fromCard
  const title = presentation.title
  if (title === undefined || title === block.name) return ''
  // `Read src/x.ts` under a `Read file` label would say the verb twice.
  const verb = label.split(' ')[0] ?? ''
  return firstLineOf(verb !== '' && title.startsWith(verb + ' ') ? title.slice(verb.length + 1) : title)
}

/** Tool content shared by a running turn and a completed turn opened for reading. */
function toolBlockLines(
  block: Extract<Block, { kind: 'tool' }>,
  theme: Theme,
  width: number,
  mode: 'preview' | 'full' | 'details' = 'preview',
  detailsKey = 'Alt+O',
  surface: 'toolSuccessBg' | 'toolAltBg' = 'toolSuccessBg',
): string[] {
  const full = mode !== 'preview'
  const presentation = renderTool({
    name: block.name, arguments: prettyArgs(block.args), output: block.output,
    status: block.status, expanded: full,
    ...(block.partial === true ? { partial: true } : {}),
    ...(block.presentation === undefined ? {} : { presentation: block.presentation }),
  })
  const args = toolArgsObject(block.args)
  const call = block.presentation?.call
  const result = block.presentation?.result
  const shell = COMMAND_TOOL.test(block.name) || call?.card === 'terminal'
  const read = block.name === 'read' || result?.card === 'read'
  const diffs = exclusiveDiffs(block.presentation)
  const padding = width > 4 ? 2 : 0
  const nest = block.parentCallId === undefined || width < 10 ? 0 : 2
  const room = Math.max(1, width - padding * 2 - nest)
  const subject = toolArgSubject(block.args, block.partial === true)
    || (result?.card === 'read' ? result.path : '')
    || (args === undefined ? '' : Object.values(args).find(value => typeof value === 'string') as string | undefined) || ''
  const command = call?.card === 'terminal' ? call.title
    : typeof args?.['command'] === 'string' ? args['command'] : subject
  const title = shell ? `$ ${command}`
    : call?.card === 'generic' || call?.card === 'diff' ? call.title
    : !read && presentation.title !== undefined && presentation.title !== block.name ? presentation.title
    : `${block.name}${subject === '' ? '' : ` ${subject}`}`
  // The command line is one ink, not a highlighted program.
  //
  // A command is the reader's own intent, and it has to be recognisable at a
  // glance; syntax colouring it competes with the output below, which is the
  // part that actually has to be read. Pi splits the two the same way: a flat
  // bold `toolTitle` line for the call, and language highlighting for whatever
  // the call returned.
  const titleInk = block.status === 'error' ? 'error' : 'toolTitle'
  const rows = wrapTextStable(theme.bold(theme.fg(titleInk, title)), room)
  let body: string[] = []
  if (mode === 'details') {
    let input = block.args
    try { input = JSON.stringify(JSON.parse(input), undefined, 2) } catch { /* Partial arguments retain their received text. */ }
    const output = presentation.output.length > 0 ? presentation.output : block.output.split('\n')
    const detailLanguage = shell ? 'bash' : toolPayloadLanguage(block.name, subject)
    const outputRows = diffs !== undefined
      ? wrapPaintedDiffRows(alignFileDiffs(diffs), theme, room)
      : (detailLanguage === undefined
        ? output.map(line => theme.fg(block.status === 'error' ? 'error' : 'toolOutput', line))
        : highlightedLines(output, detailLanguage, theme, block.status === 'error' ? 'error' : undefined))
        .flatMap(line => wrapTextStable(line, room))
    body = [
      ...wrapTextStable(theme.fg('dim', 'Input'), room),
      // The arguments are JSON here (they were re-serialized above), so they are
      // highlighted as JSON whatever the tool itself reads.
      ...highlightedLines(input.split('\n'), 'json', theme, undefined, room),
      '', ...wrapTextStable(theme.fg('dim', 'Output'), room),
      ...outputRows,
    ]
    // Keep the tool's rich presentation, but expose received text it replaced.
    if (block.output !== '' && (diffs !== undefined || block.output !== output.join('\n'))) {
      body.push('', ...wrapTextStable(theme.fg('dim', 'Raw result'), room))
      for (const line of block.output.split('\n')) {
        body.push(...wrapTextStable(theme.fg(block.status === 'error' ? 'error' : 'toolOutput', line), room))
      }
    }
  } else if (diffs !== undefined) {
    body = wrapPaintedDiffRows(alignFileDiffs(diffs), theme, room)
  } else if (full || !read || block.status === 'error') {
    // One highlight pass over the whole payload. Painting line by line handed
    // the tokenizer a fragment with no opening construct, so a second and third
    // command row came back bare — the "only the first line is highlighted"
    // report. A file payload uses the subject's own language.
    const language = shell ? 'bash' : toolPayloadLanguage(block.name, subject)
    const output = language === undefined
      ? presentation.output.map(line => theme.fg(block.status === 'error' ? 'error' : 'toolOutput', line))
      : highlightedLines(presentation.output, language, theme, block.status === 'error' ? 'error' : undefined)
    const input = !shell && !read && (call?.card === 'generic' || (call === undefined && presentation.title !== block.name))
      ? highlightedLines(presentation.input, language ?? 'text', theme, undefined, room)
      : []
    body = [...input, ...output.flatMap(line => wrapTextStable(line, room))]
    // Writes carry their content in arguments before the result arrives.
    if (body.length === 0 && block.name === 'write' && typeof args?.['content'] === 'string') {
      body = highlightedLines(args['content'].split('\n'), toolPayloadLanguage('write', subject) ?? 'text', theme, undefined, room)
    }
  }
  while (body.length > 0 && stripAnsi(body[body.length - 1]!).trim() === '') body.pop()
  const limit = full || diffs !== undefined ? body.length : shell ? 5
    : /^(grep|search)$/.test(block.name) ? 15 : /^(glob|find|ls)$/.test(block.name) ? 20 : 10
  const omitted = Math.max(0, body.length - limit)
  if (omitted > 0) {
    body = shell ? body.slice(-limit) : body.slice(0, limit)
    const shortcut = detailsKey === 'Disabled' ? '' : ` · ${detailsKey}: Expand`
    const hint = theme.fg('dim', `… ${omitted} ${shell ? 'earlier' : 'more'} lines${shortcut}`)
    if (shell) body.unshift(...wrapTextStable(hint, room))
    else body.push(...wrapTextStable(hint, room))
  }
  if (!full && read && block.status !== 'error' && block.output !== '' && detailsKey !== 'Disabled') {
    body.push(...wrapTextStable(theme.fg('dim', `${detailsKey}: Expand result`), room))
  }
  if (full && block.status === 'error' && call?.card === 'diff') rows.push('', ...wrapPaintedDiffRows(alignFileDiffs(call.diffs), theme, room))
  if (body.length > 0) {
    rows.push('')
    for (const row of body) rows.push(row)
  }
  if (block.status === 'error') rows.push(...wrapTextStable(theme.fg('error', 'Tool failed'), room))
  if (block.job !== undefined) {
    // The settlement line belongs to the call, not to its output: without a gap
    // it reads as one more line of whatever the command printed.
    if (rows.length > 0) rows.push('')
    rows.push(...wrapTextStable(theme.fg(
      block.status === 'error' ? 'error' : 'muted',
      `Job ${block.job.id} · ${block.job.detail ?? block.job.status}`,
    ), room))
  }
  const bg = block.status === 'running' ? 'toolPendingBg' : block.status === 'error' ? 'toolErrorBg' : surface
  return ['', ...rows, ''].map(row => paintSurface(theme, bg, 'toolOutput', padToWidth(' '.repeat(padding + nest) + row, width)))
}

function firstLineOf(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}

/**
 * One row standing in for a thought the reader has not opened.
 *
 * The first line is kept so a collapsed thought still says what it was about —
 * a labelled placeholder would make every thought look the same.
 */
function reasoningSummaryRow(reasoning: string, theme: Theme, width: number): string {
  const paddingX = width > ASSISTANT_PADDING_X * 2 ? ASSISTANT_PADDING_X : 0
  const label = `Thinking: ${firstLineOf(reasoning)}`
  return assistantContentLines([theme.fg('dim', truncateToWidth(label, Math.max(1, width - paddingX * 2)))], width, paddingX)[0]
    ?? ''
}

/** Thinking uses the same quiet Markdown style throughout the turn. */
function openReasoningLines(block: Extract<Block, { kind: 'assistant' }>, theme: Theme, width: number, mathMode: import('../chrome/math.ts').MathMode = 'auto'): string[] {
  return assistantMarkdown(block.reasoning, theme, width, { color: 'thinkingText', italic: true, mathMode })
}

interface GroupRenderContext {
  blocks: readonly Block[]
  options: ViewOptions
  theme: Theme
  themeName: ThemeName
  depth: ColorDepth
  width: number
  matches: ReadonlySet<number>
  /** Every query occurrence, in reading order, for the painter. */
  occurrences: readonly TranscriptSearchMatch[]
  /** Thoughts the reader has opened past the transcript's folded default. */
  openedThoughts: ReadonlySet<string>
  /**
   * Tool cards painted so far in this transcript pass. Alternation follows the
   * cards actually drawn, so neither a run boundary nor a block that paints
   * nothing can hand two consecutive cards the same surface.
   */
  toolCards: { count: number }
}

/** The block indexes a run shows as rows, in order: its members, then the thought it took from its answer. */
function groupMembers(group: ProcessGroup): number[] {
  const members: number[] = []
  for (let at = group.start; at < (group.answer ?? group.until); at += 1) members.push(at)
  if (group.tookThought && group.answer !== undefined) members.push(group.answer)
  return members
}

/**
 * One member of a run, as a row or opened in place.
 *
 * `thoughtOnly` is the step that answered: the run took its thought as the
 * last row and its words are the answer painted below the run, so the run
 * paints the thought and nothing else.
 */
function groupMemberLines(
  index: number,
  context: GroupRenderContext,
  thoughtOnly = false,
  toolOrdinal = 0,
  /** The reader opened this run, so its thoughts are laid out in full. */
  openRun = false,
): string[] {
  const { blocks, options, theme, width } = context
  const block = blocks[index]!
  // Search must reveal a match even when it falls outside a tool's normal preview.
  const full = block.kind === 'tool' && (context.matches.has(index) || options.expandedTools?.has(block.callId) === true)
  const surface = toolOrdinal % 2 === 0 ? 'toolSuccessBg' : 'toolAltBg'
  const thinkingOpen = openRun
    || (block.kind === 'assistant' && context.openedThoughts.has(reasoningKey(block)))
  const signature = [width, options.colors, context.depth, context.themeName, terminalKey(options), options.mathMode, options.mermaidMode, thoughtOnly, full, options.toolDetailsKey, surface, thinkingOpen].join('\0')
  const cached = groupMemberCache.get(block)
  let lines: readonly string[]
  if (cached?.signature === signature) lines = cached.lines
  else {
    lines = block.kind === 'tool' ? toolBlockLines(block, theme, width, full ? 'details' : 'preview', options.toolDetailsKey, surface)
      : block.kind === 'assistant' ? thoughtOnly
        ? (options.hideThinking !== true || thinkingOpen
          ? openReasoningLines(block, theme, width, options.mathMode)
          : [reasoningSummaryRow(block.reasoning, theme, width)])
        : blockLines(block, theme, width, {
          mathMode: options.mathMode ?? 'auto',
          mermaidMode: options.mermaidMode ?? 'auto',
          hideThinking: options.hideThinking === true,
          thinkingOpen,
        })
      : block.kind === 'notice' ? blockLines(block, theme, width) : []
    groupMemberCache.set(block, { signature, lines })
  }
  return [...paintSearch(lines, index, context.occurrences, theme)]
}

/**
 * Paint the query occurrences of one block onto its rows.
 *
 * One painter for both the run path and the block path: painting the row instead
 * of the occurrence was the original defect, and having two copies of the fix
 * would let one of them regress back to it.
 */
function paintSearch(
  lines: readonly string[],
  block: number,
  occurrences: readonly TranscriptSearchMatch[],
  theme: Theme,
): readonly string[] {
  const spansByRow = matchedRows(occurrences, block)
  if (spansByRow.size === 0) return lines
  return lines.map((line, row) => {
    const spans = spansByRow.get(row)
    return spans === undefined ? line : inverseSpans(line, spans, theme)
  })
}

/**
 * Invert the given display-cell spans of one rendered row.
 *
 * `sliceCells` is what makes this safe for CJK, emoji, and combining marks: the
 * spans are in display cells, which is the only measure the reader's eye agrees
 * with. Offsets computed from string indexes land mid-glyph and shear the row.
 */
function inverseSpans(line: string, spans: readonly { start: number; width: number }[], theme: Theme): string {
  const plain = stripAnsi(line)
  const total = visibleWidth(plain)
  // Merge overlapping spans, then walk them left to right so no cell is painted
  // twice and the untouched gaps keep their original styling.
  const ordered = [...spans].sort((left, right) => left.start - right.start)
  const merged: { start: number; width: number }[] = []
  for (const span of ordered) {
    const last = merged.at(-1)
    const end = span.start + span.width
    if (last !== undefined && span.start <= last.start + last.width) {
      last.width = Math.max(last.width, end - last.start)
    } else merged.push({ start: span.start, width: span.width })
  }
  let out = ''
  let at = 0
  for (const span of merged) {
    const start = Math.max(at, Math.min(span.start, total))
    const end = Math.min(total, Math.max(start, span.start + span.width))
    if (start > at) out += sliceCells(line, at, start - at)
    if (end > start) out += theme.inverse(sliceCells(line, start, end - start))
    at = end
  }
  if (at < total) out += sliceCells(line, at, total - at)
  return out
}

/**
 * Highlight a payload once, then wrap it.
 *
 * Every caller goes through this so no tool view can quietly fall back to
 * per-line painting — the shape that produced a single highlighted row above a
 * block of plain ones.
 */
function highlightedLines(
  lines: readonly string[],
  language: string,
  theme: Theme,
  errorInk: ThemeColor | undefined,
  width?: number,
): string[] {
  const highlighted = highlightToolText(lines.join('\n'), language, theme)
  const rows = highlighted.map(line => errorInk === undefined ? line : theme.fg(errorInk, line))
  return width === undefined ? rows : rows.flatMap(line => wrapTextStable(line, width))
}

/** A notice that reports on the run's work, as one of its rows. */
function processNoticeLine(block: Extract<Block, { kind: 'notice' }>, theme: Theme, width: number, indent: string): string {
  const color = block.level === 'error' ? 'error' : 'muted'
  const head = indent + (block.level === 'error' ? theme.fg(color, SYMBOL.error) + ' ' : '')
  const room = processRoom(width, head)
  return padToWidth(truncateToWidth(head + theme.fg(color, truncateToWidth(block.text.split('\n')[0] ?? '', room)), width), width)
}

/**
 * Rows of a run live across frames, so they are kept per block the same way a
 * top-level block's rows are: a streamed token re-lays the frame without
 * re-laying every call the run already made.
 */
const groupMemberCache = new WeakMap<Block, { signature: string; lines: readonly string[] }>()

/** Flat chronological content, shared by live and opened turns. */
function processGroupBody(group: ProcessGroup, context: GroupRenderContext): { lines: string[]; offsets: Map<number, number>; spans: { index: number; start: number; end: number }[] } {
  const lines: string[] = []
  const offsets = new Map<number, number>()
  const spans: { index: number; start: number; end: number }[] = []
  for (const index of groupMembers(group)) {
    const isTool = context.blocks[index]?.kind === 'tool'
    const rows = groupMemberLines(index, context, index === group.answer && group.tookThought, context.toolCards.count, true)
    if (isTool && rows.length > 0) context.toolCards.count += 1
    if (rows.length > 0 && lines.length > 0) lines.push('')
    offsets.set(index, lines.length)
    if (context.blocks[index]?.kind === 'tool') spans.push({ index, start: lines.length, end: lines.length + rows.length })
    for (const row of rows) lines.push(row)
  }
  return { lines, offsets, spans }
}

/** A settled turn's length, the way a person would say it. */
/** A completed turn's duration and any failures remain visible when folded. */
function processGroupHeader(group: ProcessGroup, theme: Theme, width: number, elapsed?: string, expandKey = 'Ctrl+O'): string[] {
  const label = elapsed === undefined ? 'Worked' : `Worked for ${elapsed}`
  const failure = group.failures === 0 ? '' : theme.fg('error', ` · ${group.failures} failed`)
  const labelRoom = Math.max(1, width - 4 - visibleWidth(failure))
  const summary = `${SYMBOL.folded} ${theme.fg('dim', truncateToWidth(label, labelRoom))}${failure}`
  const hint = ` · ${expandKey} to expand`
  const suffix = expandKey !== 'Disabled' && visibleWidth(summary) + visibleWidth(hint) <= width - 2
    ? theme.fg('dim', hint) : ''
  return [padToWidth(truncateToWidth(summary + suffix, Math.max(1, width - 2)), width)]
}

/**
 * Render a block for the transcript or plain printer. Full output is available
 * to direct callers; turn inspection uses previews. omitReasoning excludes
 * thinking already drawn by a run.
 */
export function blockLines(
  block: Block,
  theme: Theme,
  width: number,
  { toolsExpanded = false, omitReasoning = false, toolDetailsKey = 'Alt+O', mathMode = 'auto', mermaidMode = 'auto',
    hideThinking = false, thinkingOpen = false }: {
    toolsExpanded?: boolean
    omitReasoning?: boolean
    toolDetailsKey?: string
    mathMode?: import('../chrome/math.ts').MathMode
    mermaidMode?: import('../chrome/mermaid.ts').MermaidMode
    hideThinking?: boolean
    thinkingOpen?: boolean
  } = {},
): string[] {
  if (block.kind === 'user') return userBubble(block.text, theme, width)
  if (block.kind === 'assistant') {
    const lines: string[] = []
    if (block.reasoning !== '' && !omitReasoning) {
      const collapsed = hideThinking && !thinkingOpen
      lines.push(...(collapsed
        ? [reasoningSummaryRow(block.reasoning, theme, width)]
        : openReasoningLines(block, theme, width, mathMode)))
      if (block.text !== '') lines.push('')
    }
    if (block.text === '' && block.reasoning === '' && block.streaming) {
      const paddingX = width > ASSISTANT_PADDING_X * 2 ? ASSISTANT_PADDING_X : 0
      lines.push(...assistantContentLines([theme.fg('dim', '…')], width, paddingX))
    } else if (block.text !== '') {
      lines.push(...assistantMarkdown(block.text, theme, width, { ...(hasExplicitTextColor(theme) ? { color: 'text' as const } : {}), mathMode, mermaidMode }))
    }
    if (block.interrupted === true) {
      const paddingX = width > ASSISTANT_PADDING_X * 2 ? ASSISTANT_PADDING_X : 0
      lines.push(...assistantContentLines([theme.fg('dim', '· interrupted')], width, paddingX))
    }
    return lines
  }
  if (block.kind === 'tool') {
    return toolBlockLines(block, theme, width, toolsExpanded ? 'full' : 'preview', toolDetailsKey)
  }
  if (block.kind === 'toolCatalog') return renderToolsPanel(block.tools, theme, width, toolsExpanded)
  if (block.kind === 'workspace') return workspaceBlockLines(block, theme, width, toolsExpanded)
  if (block.kind === 'commandOutput') return renderCommandOutput(block.command, block.text, theme, width)
  if (block.kind === 'shell') return renderShell(block, theme, width)
  if (block.boundary === true) return [renderTranscriptBoundary(block.text, theme, width)]
  if (block.process !== undefined && block.framed !== true) return [processNoticeLine(block, theme, width, '')]
  if (block.framed !== true) {
    const prefix = '  '
    const continuation = ' '.repeat(visibleWidth(prefix))
    const tone = block.level === 'error' ? 'error' : block.level === 'warning' ? 'warning' : 'dim'
    return wrapTextStable(block.text, Math.max(1, width - visibleWidth(prefix))).map((line, index) =>
      truncateToWidth((index === 0 ? prefix : continuation) + theme.fg(tone, line), width))
  }
  const state = block.level === 'error' ? 'error' : block.level === 'warning' ? 'warning' : 'info'
  const paint = (text: string): string => theme.fg(
    block.level === 'error' ? 'error' : block.level === 'warning' ? 'warning' : 'dim',
    text,
  )
  const wrapped = wrapTextStable(block.text, Math.max(1, width - 4))
  const title = paint(wrapped[0] ?? '')
  return renderFramedBlock({
    header: title,
    state,
    width,
    lines: wrapped.slice(1).map(paint),
    applyBg: false,
  }, theme)
}

/** Why the transcript was replaced. */
export type TranscriptSeam = 'session-opened' | 'cleared'

/**
 * Seam labels live in one table with the row that draws them, so a later
 * language layer moves the strings in one edit rather than chasing them through
 * the runtime. English until that layer exists.
 */
const SEAM_LABELS: Record<TranscriptSeam, string> = {
  'session-opened': 'session opened · earlier output retained',
  cleared: 'transcript cleared · earlier output retained',
}

/** The row that separates two documents in the terminal's history. */
export function transcriptSeam(reason: TranscriptSeam): Block {
  return { kind: 'notice', level: 'info', text: SEAM_LABELS[reason], boundary: true }
}

/**
 * The seam where the transcript was replaced.
 *
 * This row exists because the earlier output is still in the terminal's own
 * scrollback and stays there. Without it, scrolling up walks into rows that
 * describe a document the live view no longer holds and nothing says why. The
 * label names the cause; the rules are chrome, not a message about anything.
 */
function renderTranscriptBoundary(label: string, theme: Theme, width: number): string {
  if (width <= 0) return ''
  const labelText = theme.fg('dim', label)
  const rule = theme.fg('border', BOX.horizontal)
  // A terminal too narrow for a rule on either side still gets the label, since
  // the label is the part that carries the fact.
  const room = width - visibleWidth(label) - 2
  if (room < 2) return truncateToWidth(labelText, Math.max(1, width))
  const left = Math.floor(room / 2)
  return rule.repeat(left) + ' ' + labelText + ' ' + rule.repeat(room - left)
}

/**
 * Rendered rows of every block, as the search index sees them.
 *
 * The searchable text used to be the block's source (`blockSearchText`), which is
 * not what the reader is looking at: Markdown source carries `**` and backticks,
 * a table is one source line but several rendered rows, and a folded run hides
 * rows that the source still contains. Matching rendered rows is the only way the
 * reported hit and the painted span agree.
 *
 * Plain text only — the caller strips SGR — and cached on the block array, which
 * is replaced rather than mutated whenever the transcript changes.
 */
const renderedBlockCache = new WeakMap<readonly Block[], ReadonlyMap<string, readonly SearchableBlock[]>>()

export function renderedBlocks(state: TranscriptState, options: {
  width: number
  colors?: boolean
  themeName?: ThemeName
  terminal?: TerminalColors
  colorDepth?: ColorDepth
  mathMode?: import('../chrome/math.ts').MathMode
  toolsExpanded?: boolean
  hideThinking?: boolean
  expandedTools?: ReadonlySet<string>
  expandedReasoning?: ReadonlySet<string>
  openedGroups?: ReadonlySet<string>
}): readonly SearchableBlock[] {
  const theme = createTheme(
    options.colors === true,
    options.colorDepth ?? 'truecolor',
    options.themeName ?? 'dark',
    options.terminal,
  )
  const key = [
    options.width,
    options.toolsExpanded === true,
    options.hideThinking === true,
    [...(options.expandedTools ?? [])].sort().join(','),
    [...(options.expandedReasoning ?? [])].sort().join(','),
    [...(options.openedGroups ?? [])].sort().join(','),
  ].join('\u0000')
  const cached = renderedBlockCache.get(state.blocks)?.get(key)
  if (cached !== undefined) return cached
  const blocks: SearchableBlock[] = state.blocks.map((block, index) => ({
    block: index,
    // The source text is the fallback for a block kind the painter does not lay
    // out as rows of its own; matching something is better than matching nothing.
    lines: renderedRows(block, theme, options).map(stripAnsi),
  }))
  const byKey = new Map(renderedBlockCache.get(state.blocks) ?? [])
  byKey.set(key, blocks)
  renderedBlockCache.set(state.blocks, byKey)
  return blocks
}

/** Plain rows one block contributes, without the search highlighting applied. */
function renderedRows(block: Block, theme: Theme, options: { width: number; mathMode?: import('../chrome/math.ts').MathMode; hideThinking?: boolean; expandedReasoning?: ReadonlySet<string> }): string[] {
  if (block.kind === 'assistant') {
    const thinkingOpen = options.hideThinking !== true || options.expandedReasoning?.has(reasoningKey(block)) === true
    return thinkingOpen && block.reasoning !== ''
      ? openReasoningLines(block, theme, options.width, options.mathMode)
      : assistantMarkdown(block.text, theme, options.width, {
        ...(options.mathMode === undefined ? {} : { mathMode: options.mathMode }),
      })
  }
  return blockSearchText(block).split('\n')
}

/** Plain text of one block, used by transcript search and match painting. */
export function blockSearchText(block: Block): string {
  if (block.kind === 'assistant') {
    return block.reasoning === '' ? block.text : `${block.reasoning}\n${block.text}`
  }
  if (block.kind === 'tool') return `${block.args}\n${block.output}${block.job === undefined ? '' : `\n${block.job.id} ${block.job.status} ${block.job.detail ?? ''}`}`
  if (block.kind === 'toolCatalog') {
    return block.tools.map(tool => `${tool.name} ${tool.description}`).join('\n')
  }
  if (block.kind === 'workspace') {
    // Only the served file paths are searchable; a turn whose summary the
    // host no longer holds contributes no path text.
    return block.summary?.files.map(file => file.display).join('\n') ?? `turn ${block.turn}`
  }
  if (block.kind === 'shell') return `${block.command}\n${block.output}`
  return block.text
}

function fitFrame(lines: string[], width: number, stablePrefix = 0): string[] {
  let fitted: string[] | undefined
  const start = Math.max(0, Math.min(lines.length, stablePrefix))
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!
    if (visibleWidth(line) <= width) continue
    fitted ??= lines.slice()
    fitted[index] = truncateToWidth(line, width)
  }
  return fitted ?? lines
}

interface TranscriptBodyCache {
  fileRegions: readonly TranscriptFileRegion[]
  mathMode: import('../chrome/math.ts').MathMode | undefined
  mermaidMode: import('../chrome/mermaid.ts').MermaidMode | undefined
  toolDetailsKey: string | undefined
  turnDetailsKey: string | undefined
  width: number
  colors: boolean
  depth: ColorDepth
  themeName: ThemeName
  terminalKey: string
  spinnerFrame: number
  toolsExpanded: boolean
  expandedTools: string
  expandedReasoning: string
  hideThinking: boolean
  openedGroups: string
  /** Query/focus/match signature; search painting must invalidate the cache. */
  searchKey: string
  /** A settled turn's length lands on its run's header without touching a block. */
  turnSpans: TranscriptState['turnSpans']
  /**
   * Whether a turn is running. The run a running turn is still adding to is
   * rendered flat and ungrouped, and it becomes a group when the turn ends, so
   * this is part of the shape. `setStatus` changes only this field, leaving the
   * block array's identity untouched — without it in the key, the second of
   * two status changes reused the first one's rows, and a live turn came back
   * folded, or a finished one came back flat.
   */
  status: TranscriptState['status']
  /**
   * The block the reader is being moved to, which forces its run open and
   * positions the viewport. It lives outside the block array too.
   */
  focusBlock: number | undefined
  /** Open/closed signature of every foldable surface; see {@link TranscriptScroll.foldShape}. */
  foldShape: string
  foldMarks: readonly FoldMark[]
  liveFrom: number | undefined
  lines: readonly string[]
  blockStarts: readonly number[]
  blockDrawStarts: readonly number[]
}

/**
 * Scroll, activity, inbox, and composer changes do not alter transcript blocks.
 * Cache the expensive Markdown/tool fold by immutable block-array identity so
 * those frames slice already-rendered rows instead of formatting the complete
 * session again. Spinner frames matter only while a visible tool block runs.
 */
const transcriptBodyCache = new WeakMap<readonly Block[], TranscriptBodyCache>()

interface BlockLinesCache {
  mathMode: import('../chrome/math.ts').MathMode | undefined
  mermaidMode: import('../chrome/mermaid.ts').MermaidMode | undefined
  toolDetailsKey: string | undefined
  toolDetails: boolean
  width: number
  colors: boolean
  depth: ColorDepth
  themeName: ThemeName
  terminalKey: string
  expanded: boolean
  /** The block's thought is painted by the run above it. */
  omitReasoning: boolean
  hideThinking: boolean
  thinkingOpen: boolean
  lines: readonly string[]
}

/** Settled immutable blocks keep their expensive Markdown/tool layout. */
const blockLinesCache = new WeakMap<Block, BlockLinesCache>()

function cachedBlockLines(
  block: Block,
  options: ViewOptions,
  theme: Theme,
  themeName: ThemeName,
  depth: ColorDepth,
  expanded: boolean,
  omitReasoning = false,
): readonly string[] {
  const cached = blockLinesCache.get(block)
  if (cached !== undefined
    && cached.width === options.width
    && cached.colors === options.colors
    && cached.depth === depth
    && cached.themeName === themeName
    && cached.terminalKey === terminalKey(options)
    && cached.expanded === expanded
    && cached.omitReasoning === omitReasoning
    && cached.hideThinking === (options.hideThinking === true)
    && cached.thinkingOpen === (block.kind === 'assistant' && options.expandedReasoning?.has(reasoningKey(block)) === true)
    && cached.mathMode === options.mathMode
    && cached.mermaidMode === options.mermaidMode
    && cached.toolDetailsKey === options.toolDetailsKey
    && cached.toolDetails === (block.kind === 'tool' && options.expandedTools?.has(block.callId) === true)) return cached.lines
  const toolDetails = block.kind === 'tool' && options.expandedTools?.has(block.callId) === true
  const lines = block.kind === 'tool' && toolDetails
    ? toolBlockLines(block, theme, options.width, 'details', options.toolDetailsKey)
    : blockLines(
      block, theme, options.width, {
        toolsExpanded: expanded,
        omitReasoning,
        toolDetailsKey: options.toolDetailsKey ?? 'Alt+O',
        mathMode: options.mathMode ?? 'auto',
        mermaidMode: options.mermaidMode ?? 'auto',
        hideThinking: options.hideThinking === true,
        thinkingOpen: block.kind === 'assistant' && options.expandedReasoning?.has(reasoningKey(block)) === true,
      },
    )
  blockLinesCache.set(block, {
    mathMode: options.mathMode,
    mermaidMode: options.mermaidMode,
    toolDetailsKey: options.toolDetailsKey,
    toolDetails,
    width: options.width,
    colors: options.colors,
    depth,
    themeName,
    terminalKey: terminalKey(options),
    expanded,
    omitReasoning,
    hideThinking: options.hideThinking === true,
    thinkingOpen: block.kind === 'assistant' && options.expandedReasoning?.has(reasoningKey(block)) === true,
    lines,
  })
  return lines
}

/**
 * What a stretch of the transcript was doing, as a short English label.
 *
 * Status strings are English until a language layer exists, so every label a
 * reader can see is resolved from this one table rather than spelled into the
 * rendering code. A tool with no family is reported by its own name, which is
 * still more informative than dropping it.
 */
const PROCESS_LABELS: readonly { match: RegExp; label: string }[] = [
  { match: /^read$/, label: 'Read file' },
  { match: /^(read_image|readImage)$/, label: 'View image' },
  { match: /^(write|notebook_edit|apply_patch)$/, label: 'Write file' },
  { match: /^(edit|multi_edit|str_replace_editor)$/, label: 'Edit file' },
  { match: /^(grep|glob|list_dir|search)$/, label: 'Search code' },
  { match: /^(bash|shell|pwsh|exec|write_stdin)$/, label: 'Run command' },
  { match: /^(run_code)$/, label: 'Run code' },
  { match: /^(web_search)$/, label: 'Search web' },
  { match: /^(web_fetch)$/, label: 'Fetch page' },
  {
    match: /^(subagent|subagent_fork|subagent_isolated|subagent_codex|subagent_claude_code|agent|ralph|workflow_run)$/, label: 'Run subagent',
  },
  { match: /^consult_advisor$/, label: 'Consult advisor' },
  {
    match: /^(session_search|session_trace|session_event_read|session_event_search|session_event_trace)$/,
    label: 'Search sessions',
  },
  {
    match: /^(todo_write|update_goal|create_goal|get_goal)$/, label: 'Update plan',
  },
  {
    match: /^(ask_user_question|ask_user|user_question)$/, label: 'Ask question',
  },
  { match: /^skill$/, label: 'Load skill' },
]

/**
 * The phrase for one tool, or the tool's own name when it belongs to no
 * category. An unknown tool still says what it is, which is honest; inventing a
 * category for it would not be.
 */
function processLabel(name: string): string {
  for (const category of PROCESS_LABELS) {
    if (category.match.test(name)) return category.label
  }
  return name
}

/** One collapsible stretch of process: the calls and thoughts between two answers. */
export interface ProcessGroup {
  /** Index of the first block in the group. */
  start: number
  /**
   * Exclusive end of the whole stretch, including the answer and any process
   * work that settled behind it. Those are the run's work too, so the header
   * counts them; they render as the run's rows around the answer, which keeps
   * the rows in the order the events arrived.
   *
   * The run's own members end at its {@link ProcessGroup.answer} when it had
   * one — that is where a reply enters — and at this boundary otherwise, so
   * there is no separate member end to keep in step.
   */
  until: number
  /**
   * The reply that closed the run, when the stretch had one.
   *
   * It is the turn's answer, not part of the run: the run's work sits above and
   * around it, and its words render as a row of their own. Naming it keeps the
   * run's members, the answer and the work behind it from overlapping, which is
   * how a run ended up painting its own header twice, or folding the reply it
   * was supposed to leave visible.
   */
  answer?: number
  /**
   * The run took the answer's step's thought as its last row, so those words
   * are painted without it. The step is always {@link ProcessGroup.answer}, so
   * this is a flag rather than a second index into the same block.
   */
  tookThought: boolean
  /** How many tool calls the run made. */
  calls: number
  /** Failed calls and independent process notices in this run. */
  failures: number
  /** True while the group still holds a call in flight or a thought still arriving. */
  live: boolean
  /** The turn the run belongs to, when any of its steps says. */
  turn?: number
  /**
   * Identity derived from the group's first block, so a group that grows as the
   * agent keeps working is still the same group to the reader who opened it.
   */
  key: string
}

/** A group has to stand for repetition; one row is not repetition. */
const MIN_GROUP_BLOCKS = 2

function blockIdentity(block: Block, index: number): string {
  if (block.kind === 'tool') return `tool:${block.callId}`
  if (block.kind === 'assistant') return `assistant:${reasoningKey(block)}`
  // A run is keyed by its first block, and a run may begin with a process
  // notice. Keying that by kind alone gave every such run in the document the
  // same key, so opening one opened all of them and the reader's opened-run
  // state bled across turns. The notice's durable source tells them apart; the
  // index is the last resort for one that carries none, which still cannot
  // collide with another notice's keyed run.
  if (block.kind === 'notice' && block.process?.source !== undefined) {
    return `notice:${block.process.source}`
  }
  return `${block.kind}@${index}`
}

/**
 * Does this block belong to a turn's run, or stand on its own?
 *
 * Everything a turn does between the prompt and its answer is the run: every
 * thought, every call, every reply the model wrote on the way, and the notices
 * that report on that work — a retry, a background job settling. A thought used
 * to close the run before it, which split a fifty-step turn into fifty runs;
 * then a reply written mid-turn did the same, and a job notice split it again.
 * The reference client folds the whole turn behind one line and leaves only the
 * answer outside, and that is the shape a reader scrolling back wants: one row
 * per turn, then what it concluded.
 *
 * An interrupted step is not work: it carries the notice that it stopped.
 */
function isProcessBlock(block: Block): boolean {
  if (block.kind === 'tool') return true
  if (block.kind === 'notice') return block.process !== undefined
  return block.kind === 'assistant' && block.interrupted !== true
}

function blockTurn(block: Block): number | undefined {
  if (block.kind === 'tool' || block.kind === 'assistant') return block.turn
  if (block.kind === 'notice') return block.process?.turn
  return undefined
}

function isLiveBlock(block: Block): boolean {
  return (block.kind === 'tool' && block.status === 'running')
    || (block.kind === 'assistant' && block.streaming && block.text === '')
}

/**
 * Project the transcript's turns into runs without touching the block list.
 *
 * A stretch of process blocks from one turn is one run. If the stretch ends on
 * a reply, that reply is the turn's answer and stays outside; any reply before
 * it was written on the way and is part of the run. A prompt, the per-turn
 * changed-file record, or any notice that speaks to the reader ends the stretch,
 * and so does a block from another turn — two turns with no prompt between
 * them, such as a goal continuing itself, still read as two runs.
 *
 * The block list is deliberately left alone: a group is a rendering decision, so
 * search, focus, and the row offsets keep addressing real blocks, and a group
 * that is still growing cannot invalidate anything a reader already saw.
 */
export function processGroups(blocks: readonly Block[]): ProcessGroup[] {
  const groups: ProcessGroup[] = []
  let start = -1
  let segmentTurn: number | undefined
  const flush = (end: number): void => {
    if (start < 0) return
    // The turn's answer is the stretch's last reply, and process work can
    // settle after it: a background job finishes, a retry is reported, both
    // reported as process blocks precisely so they join the run instead of
    // splitting it. Those trailing blocks are the run's work but not its
    // conclusion, so the run ends at the answer and they follow it as rows of
    // their own. Reading only the stretch's last block mistook them for the
    // answer's absence and folded the answer itself into the run, where a
    // folded standard transcript hid the whole reply.
    //
    // The last reply wins, not the first one met going back: a turn's earlier
    // replies were written on the way and belong to the run, so scanning back
    // from the end and taking the first reply would fold the one reply the
    // model wrote mid-turn and leave the real answer outside it.
    let answer: number | undefined
    for (let at = start; at < end; at += 1) {
      const block = blocks[at]
      if (block?.kind === 'assistant' && block.text !== '') answer = at
      else if (block !== undefined && !isProcessBlock(block)) break
    }
    const memberEnd = answer ?? end
    const last = blocks[answer ?? end - 1]
    const absorbs = answer !== undefined && last?.kind === 'assistant' && last.reasoning !== '' ? answer : undefined
    const size = memberEnd - start + (absorbs === undefined ? 0 : 1)
    const answerIndex = answer
    if (size >= MIN_GROUP_BLOCKS || (size > 0 && segmentTurn !== undefined)) {
      let calls = 0
      let failures = 0
      let live = false
      // The whole stretch counts, not just the part before the answer: a
      // background job that settles behind the reply is still work this run
      // did, and a failed call among them is still a failure. Stopping at the
      // answer left the header saying fewer calls than the reader could see,
      // and said nothing about a call that failed after it.
      for (let at = start; at < end; at += 1) {
        const block = blocks[at]!
        if (isLiveBlock(block)) live = true
        if (block.kind === 'notice' && block.level === 'error') failures += 1
        if (block.kind !== 'tool') continue
        calls += 1
        if (block.status === 'error') failures += 1
      }
      const turn = segmentTurn ?? (blocks[end]?.kind === 'workspace' ? (blocks[end] as WorkspaceBlock).turn : undefined)
      groups.push({
        start,
        until: end,
        ...(answerIndex === undefined ? {} : { answer: answerIndex }),
        // The run took this step's thought as its last row, so its words are
        // painted without it. A separate flag rather than a second index: the
        // block is always the answer.
        tookThought: absorbs !== undefined,
        calls,
        failures,
        live,
        ...(turn === undefined ? {} : { turn }),
        key: blockIdentity(blocks[start]!, start),
      })
    }
    start = -1
    segmentTurn = undefined
  }
  blocks.forEach((block, index) => {
    if (!isProcessBlock(block)) {
      flush(index)
      return
    }
    const turn = blockTurn(block)
    if (start >= 0 && turn !== undefined && segmentTurn !== undefined && turn !== segmentTurn) flush(index)
    if (start < 0) start = index
    segmentTurn ??= turn
  })
  flush(blocks.length)
  return groups
}

/** A rendered transcript body and what the host needs to aim at and freeze it. */
interface TranscriptBody {
  fileRegions: readonly TranscriptFileRegion[]
  lines: readonly string[]
  blockStarts: readonly number[]
  /** See {@link TranscriptScroll.blockDrawStarts}. */
  blockDrawStarts: readonly number[]
  /** See {@link TranscriptScroll.foldShape}. */
  foldShape: string
  /** Every open surface and the body row it starts on; see {@link TranscriptScroll.foldMarks}. */
  foldMarks: readonly FoldMark[]
  /** Body row of the first run still at work, which must not freeze yet. */
  liveFrom: number | undefined
  /** Every query occurrence in this layout, for the composer hint's count. */
  occurrences: readonly TranscriptSearchMatch[]
}

/**
 * The runs as the reader sees them now: {@link processGroups}, with the run a
 * running turn is still adding to marked live.
 *
 * That run is live even between two events, when nothing is in flight — the
 * model is choosing what to do next — and while the answer streams below it,
 * so it becomes a group once, when the turn ends, rather than folding and
 * unfolding at every pause. The host aims Ctrl+O with the same projection the
 * renderer paints, so the two cannot disagree about what is folded.
 */
export function turnGroups(state: TranscriptState): ProcessGroup[] {
  const groups = processGroups(state.blocks)
  if (state.status === 'idle') return groups
  const last = state.blocks.length
  return groups.map(group => {
    // `until` is the stretch's true end, including work that settled after the
    // answer; comparing `end` would call a run with trailing work settled
    // before the transcript's tail, and it would fold while the turn ran.
    const trailing = group.until === last
      || (group.until === last - 1 && state.blocks[group.until]?.kind === 'assistant')
    const current = (group.turn === state.turn || (state.turn === 0 && trailing))
      && state.turnSpans?.[state.turn]?.end === undefined
    return (current || (group.turn === undefined && trailing)) && !group.live ? { ...group, live: true } : group
  })
}

function renderTranscriptBody(
  state: TranscriptState,
  options: ViewOptions,
  theme: Theme,
  spinnerFrame: number,
): TranscriptBody {
  const toolsExpanded = options.toolsExpanded === true
  const expandedTools = [...(options.expandedTools ?? [])].sort().join('\0')
  const expandedReasoning = [...(options.expandedReasoning ?? [])].sort().join('\0')
  const hideThinking = options.hideThinking === true
  const openedGroups = [...(options.openedGroups ?? [])].sort().join('\0')
  const themeName = options.themeName ?? 'dark'
  const depth = colorDepthOf(options)
  const animatedSpinnerFrame = state.blocks.some(block => block.kind === 'tool' && block.status === 'running')
    ? spinnerFrame
    : -1
  const search = options.transcriptSearch
  const searchKey = search === undefined ? '' : `${search.query}\u0000${search.focus}`
  /*
   * The fold logic asks "does this range contain a hit", which is a question about
   * blocks; the painter asks "which cells on this row". Both are answered from one
   * occurrence list, computed from the rendered rows so a hit cannot exist in the
   * count and be missing from the paint.
   *
   * It is computed before the cache check because the composer hint reports its
   * length: a cache hit still has to say how many matches there are.
   */
  const occurrences = search === undefined || search.query.trim() === ''
    ? []
    : searchMatches(renderedBlocks(state, options), search.query)
  const cached = transcriptBodyCache.get(state.blocks)
  if (cached !== undefined
    && cached.width === options.width
    && cached.colors === options.colors
    && cached.depth === depth
    && cached.themeName === themeName
    && cached.terminalKey === terminalKey(options)
    && cached.spinnerFrame === animatedSpinnerFrame
    && cached.mathMode === options.mathMode
    && cached.mermaidMode === options.mermaidMode
    && cached.toolsExpanded === toolsExpanded
    && cached.expandedTools === expandedTools
    && cached.expandedReasoning === expandedReasoning
    && cached.hideThinking === hideThinking
    && cached.openedGroups === openedGroups
    && cached.toolDetailsKey === options.toolDetailsKey
    && cached.turnSpans === state.turnSpans
    && cached.turnDetailsKey === options.turnDetailsKey
    && cached.searchKey === searchKey
    && cached.status === state.status
    && cached.focusBlock === options.focusBlock) {
    return {
      lines: cached.lines,
      fileRegions: cached.fileRegions,
      blockStarts: cached.blockStarts,
      blockDrawStarts: cached.blockDrawStarts,
      foldShape: cached.foldShape,
      foldMarks: cached.foldMarks,
      liveFrom: cached.liveFrom,
      // Recomputed on a cache hit from the same input, so the hint's count is
      // never a stale number left over from an earlier query.
      occurrences,
    }
  }

  const matches = new Set(occurrences.map(match => match.block))
  const lines: string[] = []
  const fileRegions: TranscriptFileRegion[] = []
  const filesAt = (index: number, start: number, length: number, expanded = false): void => {
    const block = state.blocks[index]!
    if (length === 0 || blockFileAction(block) === undefined) return
    if (block.kind === 'workspace') {
      fileRegions.push({ block: index, start, end: start + 1 })
      const visible = Math.min(block.summary!.files.length, expanded ? length - 1 : WORKSPACE_COLLAPSED_LINES)
      for (let file = 0; file < visible; file += 1) fileRegions.push({ block: index, start: start + file + 1, end: start + file + 2, file })
    } else fileRegions.push({ block: index, start, end: start + length })
  }
  const blockStarts: number[] = []
  // Where each block is drawn, apart from the offsets above: a search can aim a
  // block's offset at the thought it also carries, but its drawn span does not
  // move, and the boundary mapper needs the drawn one.
  const blockDrawStarts: number[] = []
  let previous: Block | undefined
  // A group is a rendering decision, so a block keeps its own identity and row
  // offset whether or not the group around it is open. A collapsed group
  // therefore owns the rows of its first block and nothing after it, which is
  // why anything a reader can address — a search match, the focused block — has
  // to force its own group open.
  const groups = turnGroups(state)
  const groupOf = new Int32Array(state.blocks.length).fill(-1)
  const openGroups = new Set<number>()
  const absorbed = new Set<number>()
  // Thoughts a search hit has to show in full, beyond what the reader opened.
  const openedThoughts = new Set<string>(options.expandedReasoning ?? [])
  // Where each answer's thought is actually drawn, for its fold mark. The
  // navigation offset below may point elsewhere; the mark must not follow it.
  const drawnThoughts = new Map<number, number | undefined>()
  const lastOfTurn = new Map<number, number>()
  groups.forEach((group, index) => {
    for (let at = group.start; at < group.until; at += 1) groupOf[at] = index
    // The turn's answer is painted below the run, not inside it. Leaving it
    // claimed here would route the reply through the run's body and drop it
    // from a folded transcript, which is what a reader most needs to see.
    if (group.answer !== undefined && group.answer !== group.start) groupOf[group.answer] = -1
    if (group.tookThought && group.answer !== undefined) absorbed.add(group.answer)
    if (group.turn !== undefined) lastOfTurn.set(group.turn, index)
    const reasoningHit = group.tookThought && group.answer !== undefined
      && search !== undefined && matches.has(group.answer)
      && blockMatchesQuery((state.blocks[group.answer] as Extract<Block, { kind: 'assistant' }>).reasoning, search.query)
    // A hit inside the thought the run took needs that thought laid out in
    // full. Opening only the run shows a one-line preview, so the matched text
    // stays out of sight while the transcript reports the hit. This is a render
    // decision, not the reader's own state, so it goes in a local set rather
    // than into the options the host owns.
    if (reasoningHit && group.answer !== undefined) {
      openedThoughts.add(reasoningKey(state.blocks[group.answer] as Extract<Block, { kind: 'assistant' }>))
    }
    const asked = toolsExpanded
      || options.openedGroups?.has(group.key) === true
      || state.blocks.slice(group.start, group.until).some(block => block.kind === 'tool' && options.expandedTools?.has(block.callId))
      || reasoningHit
      || [...matches].some(index => index >= group.start && index < group.until)
      || options.focusBlock !== undefined
        && options.focusBlock >= group.start && options.focusBlock < group.until
    if (asked) openGroups.add(index)
  })
  // Every surface that is open, keyed and placed, so the host can tell where a
  // change of shape starts. Global switches reshape from the top.
  const foldMarks: FoldMark[] = []
  if (toolsExpanded) foldMarks.push({ key: 'all', row: 0 })
  // Collapsing or revealing every thought reshapes from the top, like the
  // global tool switch above, so it reports the same kind of mark.
  if (hideThinking) foldMarks.push({ key: 'thinking', row: 0 })
  let liveFrom: number | undefined
  const context: GroupRenderContext = {
    blocks: state.blocks, theme, themeName, depth, width: options.width,
    matches, occurrences, options: { ...options, expandedReasoning: openedThoughts },
    openedThoughts,
    toolCards: { count: 0 },
  }
  const compactProcessRow = (block: Block | undefined): boolean => {
    if (block?.kind === 'notice') return block.process !== undefined && block.framed !== true
    return block?.kind === 'tool' && !toolsExpanded && !options.expandedTools?.has(block.callId)
  }
  // Only a turn's last run is summarized by how long the turn took; an earlier
  // run in the same turn did not take all of it.
  const elapsedOf = (index: number): string | undefined => {
    const group = groups[index]!
    if (group.live || group.turn === undefined || lastOfTurn.get(group.turn) !== index) return undefined
    const span = state.turnSpans?.[group.turn]
    return span?.end === undefined ? undefined : formatElapsed(span.end - span.start)
  }
  for (let index = 0; index < state.blocks.length; index += 1) {
    const block = state.blocks[index]!
    const groupIndex = groupOf[index] ?? -1
    if (groupIndex >= 0) {
      // A run is painted whole by its first block: the header, then its rows
      // when open. A collapsed run still shows the rows that failed, because a
      // header saying only "something failed" would hide the row that says
      // what — and forcing the whole run open for one failed grep would undo
      // the fold for the most common failure there is.
      const group = groups[groupIndex]!
      if (lines.length > 0) lines.push('')
      const headerRow = lines.length
      const opened = openGroups.has(groupIndex)
      const shape = group.live ? 'live' : opened ? 'open' : 'folded'
      foldMarks.push({ key: `run:${group.key}:${shape}`, row: headerRow })
      if (group.live) liveFrom ??= headerRow
      // A live run has no header: it becomes a group when its turn ends.
      if (!group.live && !opened) {
        lines.push(...processGroupHeader(group, theme, options.width, elapsedOf(groupIndex), options.turnDetailsKey))
      }
      const bodyRow = lines.length
      let offsets = new Map<number, number>()
      if (group.live || opened) {
        const body = processGroupBody(group, context)
        for (const line of body.lines) lines.push(line)
        offsets = body.offsets
        for (const span of body.spans) filesAt(span.index, bodyRow + span.start, span.end - span.start)
      } else {
        for (let at = group.start; at < (group.answer ?? group.until); at += 1) {
          const member = state.blocks[at]!
          if (!(member.kind === 'tool' && member.status === 'error')
            && !(member.kind === 'notice' && member.level === 'error')) continue
          offsets.set(at, lines.length - bodyRow)
          const rows = member.kind === 'tool' ? toolRowLine(member, theme, options.width, spinnerFrame) : groupMemberLines(at, context)
          filesAt(at, lines.length, rows.length)
          lines.push(...rows)
        }
      }
      // The turn's answer, painted as a row of its own between the run's work
      // and the work that settled behind it, in the order the events arrived.
      // Painting it last would read as though the run concluded after the
      // notice, and — worse — would give the answer and the notice each other's
      // row, so a reader aiming at one landed on the other.
      if (group.answer !== undefined) {
        if (lines.length > 0) lines.push('')
        // The run painted this step's thought above; keep its row. The thought's
        // row is where it is *drawn*, which is not the same as where a search
        // should put the reader: a query in the reply aims at the reply, a query
        // in the thought at the thought. The draw position is what a fold mark
        // has to report, so it is kept apart from the navigation offset below
        // rather than being overwritten by it.
        const thoughtHit = group.tookThought
          && search !== undefined && matches.has(group.answer)
          && !blockMatchesQuery((state.blocks[group.answer]! as Extract<Block, { kind: 'assistant' }>).text, search.query)
        const thoughtRow = offsets.get(group.answer)
        drawnThoughts.set(group.answer, thoughtRow)
        // The answer's own drawn start is its words, never the thought above
        // them — a search aims `offsets` at the thought so the reader lands on
        // the match, and the boundary mapper must not mistake that for the
        // answer starting earlier.
        blockDrawStarts[group.answer] = lines.length
        offsets.set(group.answer, lines.length - bodyRow)
        const answer = state.blocks[group.answer]!
        const rendered = cachedBlockLines(
          answer, options, theme, themeName, depth, toolsExpanded,
          absorbed.has(group.answer),
        )
        for (const line of paintSearch(rendered, group.answer, occurrences, theme)) lines.push(line)
        if (thoughtHit && thoughtRow !== undefined) blockStarts[group.answer] = bodyRow + thoughtRow
        if (thoughtHit && thoughtRow !== undefined) offsets.set(group.answer, thoughtRow)
        // One block, two rows: the run painted its thought above, this painted
        // its words below. A search hit can be in either, and the offset has to
        // lead to the one that matched — aiming at the reply left a long
        // thought's match above the viewport, found and not readable.

      }
      // Work that settled after the answer still belongs to the run, so it is
      // painted as the run's rows directly beneath the reply rather than as
      // loose paragraphs at the page's left margin.
      for (let at = group.answer === undefined ? group.until : group.answer + 1; at < group.until; at += 1) {
        // Appended one at a time: a long run's member can be a very large
        // array, and spreading it into a call overflows the argument limit.
        const trailing = state.blocks[at]
        const failed = (trailing?.kind === 'notice' && trailing.level === 'error')
          || (trailing?.kind === 'tool' && trailing.status === 'error')
        if (group.live || opened || failed) {
          if (lines.length > 0 && !(trailing?.kind === 'notice' && state.blocks[at - 1]?.kind === 'notice')) lines.push('')
          offsets.set(at, lines.length - bodyRow)
          const rows = !group.live && !opened && trailing?.kind === 'tool'
            ? toolRowLine(trailing, theme, options.width, spinnerFrame)
            : groupMemberLines(at, context, false, 0, group.live || opened)
          filesAt(at, lines.length, rows.length)
          for (const line of rows) lines.push(line)
        }
      }
      // A member the body did not paint answers to the header, which is the row
      // a reader aiming at it would land on anyway. Offsets are assigned by
      // block index, never by the order the rows were painted: the two differ
      // once a run carries an answer with work behind it, and a shifted offset
      // aims a search hit or a Ctrl+O at the wrong row.
      for (let at = group.start; at < group.until; at += 1) {
        const offset = offsets.get(at)
        const row = offset === undefined ? headerRow : bodyRow + offset
        blockStarts[at] = row
        const member = state.blocks[at]!
        // Not `offsets`: a search may have aimed that at the thought, and this
        // array is the blocks' own drawn positions.
        if (blockDrawStarts[at] === undefined) {
          const drawn = offsets.get(at)
          blockDrawStarts[at] = drawn === undefined ? headerRow : bodyRow + drawn
        }
        if (member.kind === 'tool' && options.expandedTools?.has(member.callId) === true) {
          foldMarks.push({ key: `call:${member.callId}`, row })
        }
        // The effective set, not the host's: a search can open a thought the
        // reader never asked for, and the rows that adds still reshaped. The
        // key is the same one the host already uses for a thought it opened, so
        // the two causes share one identity and neither is encoded in it.
        if (member.kind === 'assistant' && openedThoughts.has(reasoningKey(member))) {
          const drawn = drawnThoughts.get(at)
          foldMarks.push({ key: `thought:${reasoningKey(member)}`, row: drawn === undefined ? row : bodyRow + drawn })
        }
      }
      // Everything this run owned is painted, so the walk resumes past it.
      index = group.until - 1
      continue
    } else if (lines.length > 0) {
      const previousCommand = commandSurfaceName(previous)
      const currentCommand = commandSurfaceName(block)
      if (previousCommand !== undefined && currentCommand !== undefined && previousCommand !== currentCommand) {
        lines.push('', renderCommandSeparator(theme, options.width), '')
      } else if (!compactProcessRow(block) || !compactProcessRow(state.blocks[index - 1])) {
        lines.push('')
      }
    }
    blockStarts[index] = lines.length
    if (block.kind === 'tool' && options.expandedTools?.has(block.callId) === true) {
      foldMarks.push({ key: `call:${block.callId}`, row: lines.length })
    }
    if (block.kind === 'assistant' && options.expandedReasoning?.has(reasoningKey(block)) === true) {
      foldMarks.push({ key: `thought:${reasoningKey(block)}`, row: lines.length })
    }
    const liveBlock = state.status !== 'idle' && isProcessBlock(block)
      && (block.kind !== 'assistant' || block.reasoning !== '')
      && (blockTurn(block) === undefined || blockTurn(block) === state.turn)
    if (liveBlock) liveFrom ??= lines.length
    const expanded = (block.kind === 'workspace' && groups.some((group, at) => group.turn === block.turn && openGroups.has(at))) || matches.has(index) || toolsExpanded
      || (block.kind === 'tool' && options.expandedTools?.has(block.callId) === true)
    const rendered = cachedBlockLines(
      block, options, theme, themeName, depth, expanded,
      absorbed.has(index),
    )
    filesAt(index, lines.length, rendered.length, expanded)
    lines.push(...paintSearch(rendered, index, occurrences, theme))
    blockDrawStarts[index] = blockStarts[index]!
    previous = block
  }
  // Streaming text and a call settling change rows in place without changing
  // this; opening, folding, or a run settling at turn end do.
  const foldShape = foldMarks.map(mark => mark.key).join('\u0001')
  transcriptBodyCache.set(state.blocks, {
    fileRegions,
    mathMode: options.mathMode,
    mermaidMode: options.mermaidMode,
    toolDetailsKey: options.toolDetailsKey,
    turnDetailsKey: options.turnDetailsKey,
    blockDrawStarts,
    width: options.width,
    colors: options.colors,
    depth,
    themeName,
    terminalKey: terminalKey(options),
    spinnerFrame: animatedSpinnerFrame,
    toolsExpanded,
    expandedTools,
    expandedReasoning,
    hideThinking,
    openedGroups,
    searchKey,
    turnSpans: state.turnSpans,
    status: state.status,
    focusBlock: options.focusBlock,
    foldShape,
    foldMarks,
    liveFrom,
    lines,
    blockStarts,
  })
  return { lines, blockStarts, blockDrawStarts, fileRegions, foldShape, foldMarks, liveFrom, occurrences }
}

function commandSurfaceName(block: Block | undefined): string | undefined {
  if (block?.kind === 'toolCatalog') return 'tools'
  if (block?.kind === 'commandOutput') return block.command
  return undefined
}

/** Rows moved per Shift+Arrow (OMP ScrollView `fastScrollLines`). */
export const TRANSCRIPT_FAST_SCROLL = 5

const promptSummaryCache = new WeakMap<Block, string>()

function promptSummary(block: Extract<Block, { kind: 'user' }>): string {
  const cached = promptSummaryCache.get(block)
  if (cached !== undefined) return cached
  const summary = block.text.replace(/\s+/gu, ' ').trim()
  promptSummaryCache.set(block, summary)
  return summary
}

function earlierLabel(count: number): string {
  return '… ↑ ' + count + ' earlier line' + (count === 1 ? '' : 's') + ' ⟨Pg↑⟩'
}

function laterLabel(count: number): string {
  return '… ↓ ' + count + ' later line' + (count === 1 ? '' : 's') + ' ⟨Pg↓⟩'
}

/**
 * Window `body` into `budget` rows with ↑/↓ overflow markers.
 * `start` is the first body row to keep; non-finite values pin to the tail.
 *
 * `documentRows` says which of `body`'s rows the returned lines are, and where
 * in the returned lines they start. A window that is nothing but an overflow
 * marker carries none: `null`, because the frame drew no body rather than
 * because the caller forgot to say.
 */
export function windowTranscript(
  body: readonly string[],
  budget: number,
  start: number,
  theme: Theme,
): TranscriptScroll & { lines: string[] } {
  const len = body.length
  if (budget <= 0) {
    return { lines: [], start: 0, maxStart: 0, budget, hiddenAbove: len, hiddenBelow: 0, documentRows: null }
  }
  if (len <= budget) {
    return {
      lines: [...body], start: 0, maxStart: 0, budget, hiddenAbove: 0, hiddenBelow: 0,
      documentRows: { documentStart: 0, documentEnd: len, frameStart: 0 },
    }
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
      documentRows: null,
    }
  }

  if (atTail) {
    const take = budget - 1
    const hiddenAbove = len - take
    return {
      lines: [theme.fg('dim', earlierLabel(hiddenAbove)), ...body.slice(hiddenAbove)],
      documentRows: { documentStart: hiddenAbove, documentEnd: len, frameStart: 1 },
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
      documentRows: { documentStart: 0, documentEnd: take, frameStart: 0 },
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
      documentRows: { documentStart: s, documentEnd: s + 1, frameStart: 1 },
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
    documentRows: { documentStart: s, documentEnd: s + take, frameStart: 1 },
    start: s,
    maxStart,
    budget,
    hiddenAbove: s,
    hiddenBelow,
  }
}

const IMAGE_MARKER = /\[Image #\d+(?:, \d+x\d+)?\]/gu

function imageMarkerRanges(text: string): { start: number; end: number }[] {
  return [...text.matchAll(IMAGE_MARKER)].map(match => ({
    start: match.index,
    end: match.index + match[0].length,
  }))
}

function coveringRange(
  ranges: readonly { start: number; end: number }[],
  index: number,
): { start: number; end: number } | undefined {
  return ranges.find(range => range.start <= index && index < range.end)
}

function nextRangeStart(ranges: readonly { start: number; end: number }[], index: number): number {
  let next = Number.POSITIVE_INFINITY
  for (const range of ranges) {
    if (range.start > index && range.start < next) next = range.start
  }
  return next
}

/** Paint a wrapped composer slice: leading `/name` plus image markers. */
function paintComposerInputSlice(fullText: string, slice: string, sourceStart: number, theme: Theme): string {
  const sourceEnd = sourceStart + slice.length
  const slash = leadingSlashCommandNameRange(fullText)
  const slashRanges = slash === null ? [] : [slash]
  const images = imageMarkerRanges(fullText)
  if (slashRanges.length === 0 && images.length === 0) return slice

  let output = ''
  let cursor = sourceStart
  while (cursor < sourceEnd) {
    const image = coveringRange(images, cursor)
    if (image !== undefined) {
      const end = Math.min(image.end, sourceEnd)
      output += theme.underline(theme.bold(theme.fg('accent', fullText.slice(cursor, end))))
      cursor = end
      continue
    }
    const command = coveringRange(slashRanges, cursor)
    if (command !== undefined) {
      const end = Math.min(command.end, sourceEnd, nextRangeStart(images, cursor))
      output += theme.bold(theme.fg('accent', fullText.slice(cursor, end)))
      cursor = end
      continue
    }
    const end = Math.min(sourceEnd, nextRangeStart(images, cursor), nextRangeStart(slashRanges, cursor))
    output += fullText.slice(cursor, end)
    cursor = end
  }
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
    if (spinnerFrame < 0) return theme.fg('accent', SYMBOL.running)
    return theme.fg('accent', SPINNER[spinnerFrame % SPINNER.length] ?? SYMBOL.running)
  }
  if (phase === 'error') return theme.fg('error', SYMBOL.error)
  return theme.fg('success', SYMBOL.success)
}

const SUBAGENT_PHASE_LABELS: Record<TuiSubagentPhase, string> = {
  starting: 'Starting', running: 'Running', waiting: 'Waiting', completed: 'Done', error: 'Failed',
}

function subagentRowText(agent: TuiSubagentView): string {
  const indent = agent.depth > 1 ? '  '.repeat(agent.depth - 1) : ''
  return `${indent}${agent.label} · ${SUBAGENT_PHASE_LABELS[agent.phase]}`
}

/** Compact, unframed descendant-subagent tree placed above Todos. */
export function renderSubagents(
  roster: TuiSubagentRoster | undefined,
  theme: Theme,
  width: number,
  spinnerFrame = 0,
  inspectedId?: string,
  launcherFocused = false,
): string[] {
  const agents = roster?.agents ?? []
  if (agents.length === 0 || width <= 0) return []
  const running = agents.filter(agent => agent.phase === 'running' || agent.phase === 'starting').length
  const failed = agents.filter(agent => agent.phase === 'error').length
  const waiting = agents.filter(agent => agent.phase === 'waiting').length
  const done = agents.filter(agent => agent.phase === 'completed').length
  const counts = [
    running === 0 ? undefined : `${running} running`,
    waiting === 0 ? undefined : `${waiting} waiting`,
    done === 0 ? undefined : `${done} done`,
    failed === 0 ? undefined : `${failed} failed`,
  ].filter((part): part is string => part !== undefined)
  const headerBody = theme.bold(theme.fg('accent', 'Agents'))
    + (counts.length === 0 ? '' : theme.fg('dim', ` · ${counts.join(' · ')}`))
    + theme.fg('dim', launcherFocused ? ' · Enter open · Esc return' : ' · ↓ select · Alt+A open')
  const header = '  ' + (launcherFocused ? theme.inverse(headerBody) : headerBody)
  const start = subagentPreviewStart(agents)
  const end = Math.min(agents.length, start + SUBAGENT_PREVIEW)
  const rows: Array<TuiSubagentView | string> = [
    ...(start === 0 ? [] : [`… ${start} earlier`]),
    ...agents.slice(start, end),
    ...(end === agents.length ? [] : [`… ${agents.length - end} more`]),
  ]
  const lines = [header, ...rows.map((row, index) => {
    const branch = '  ' + theme.fg('dim', index === rows.length - 1 ? '└─' : '├─') + ' '
    if (typeof row === 'string') return branch + theme.fg('dim', row)
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
  return lines.map(line => truncateToWidth(line, width))
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

/**
 * One fixed row above the composer for a turn that ended in failure.
 *
 * The transcript keeps its own error notice, but transcript rows scroll into
 * native history while the composer stays put: without this row a turn that
 * failed while the user was reading elsewhere leaves an apparently idle screen.
 * The row is bounded to a single line so it cannot squeeze the transcript.
 */
export function renderTurnError(text: string, theme: Theme, width: number): string[] {
  if (text === '' || width <= 0) return []
  const prefix = SYMBOL.error + ' '
  const hint = ' · Alt+R retry'
  // Drop the retry hint before the message itself when the terminal is narrow.
  const suffix = width - 2 - visibleWidth(prefix) - visibleWidth(hint) >= 8 ? hint : ''
  const budget = Math.max(1, width - 2 - visibleWidth(prefix) - visibleWidth(suffix))
  const line = ' '
    + theme.fg('error', prefix)
    + theme.fg('error', truncateToWidth(text, budget))
    + (suffix === '' ? '' : theme.fg('dim', suffix))
  return [padToWidth(line, width)]
}

/** Human guidance remains visible until the Harness claims it for a model step. */
export function renderSteering(inbox: readonly UserMessage[], theme: Theme, width: number): string[] {
  const messages = inbox.filter(message => message.source.kind === 'user')
  if (messages.length === 0 || width <= 0) return []
  const latest = queuedMessageLabel(messages.at(-1)!)
  const count = messages.length > 1 ? ` · ${messages.length}` : ''
  return [truncateToWidth('  ' + theme.fg('border', '│') + ' '
    + theme.bold(theme.fg('accent', 'Guidance · next step' + count))
    + theme.fg('dim', ' · ') + theme.fg('text', latest), width)]
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
  const editSingleHint = width >= 72 ? '↑/Alt+Up edit · Alt+Q queue' : '↑ edit'
  const editMultiHint = width >= 72 ? '↑/Alt+Up edit latest · Alt+Q queue' : '↑ edit latest'
  if (labels.length === 1) {
    return [alignAction(
      // Pi's vocabulary: what Enter typed was a follow-up, and the row says so
      // in the same word the composer hint uses.
      rail + queueLabel + theme.fg('dim', ' · ') + theme.fg('dim', 'follow-up · ') + theme.fg('text', labels[0] ?? ''),
      theme.fg('dim', editSingleHint),
    )]
  }
  const summary = ` · ${labels.length} · follow-up${hidden === 0 ? '' : ` · ${hidden} earlier`}`
  const visibleLabels = labels.slice(start)
  const lines = [
    alignAction(rail + queueLabel + theme.fg('dim', summary), theme.fg('dim', editMultiHint), false),
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
  const theme = createTheme(
    options.colors === true,
    options.colorDepth ?? 'truecolor',
    options.themeName ?? 'dark',
    options.terminal,
  )
  const width = options.width
  const height = options.height
  const appName = options.appName ?? 'omdsh'
  const version = options.version ?? '0.1.0'
  const pwd = options.pwd ?? ''
  const motion = options.motion ?? 'full'
  const spinnerFrame = motion === 'off' ? -1 : options.spinnerFrame ?? 0
  if (options.agentHub !== undefined) {
    const hub = renderAgentHub(options.agentHub, theme, width, height)
    return {
      lines: fitFrame(hub.lines, width),
      cursor: hub.cursor,
      cursorVisible: hub.cursorVisible,
      // A full-screen surface drew no transcript body.
      documentRows: null,
    }
  }
  if (options.trajectory !== undefined) {
    const trajectory = renderTrajectory(options.trajectory, theme, width, height)
    return {
      lines: fitFrame(trajectory.lines, width),
      cursor: trajectory.cursor,
      cursorVisible: trajectory.cursorVisible,
      // A full-screen surface drew no transcript body.
      documentRows: null,
    }
  }
  if (options.settings !== undefined && options.promptSelector === undefined) {
    const settings = renderSettings(options.settings, theme, width, height)
    return {
      lines: fitFrame(settings.lines, width),
      cursor: settings.cursor,
      cursorVisible: false,
      // A full-screen surface drew no transcript body.
      documentRows: null,
    }
  }
  if (options.promptSelector?.request.presentation === 'fullscreen-list' || options.promptSelector?.request.presentation === 'fullscreen-tree') {
    const selector = (options.promptSelector.request.presentation === 'fullscreen-tree' ? renderPromptTreePage : renderPromptSelectorPage)(
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
      ...(selector.document === undefined ? {} : { promptDocument: selector.document }),
      cursor: selector.cursor,
      cursorVisible: true,
      // A full-screen surface drew no transcript body.
      documentRows: null,
    }
  }
  if (options.promptSelector?.request.presentation === 'plan-review' || options.promptSelector?.request.presentation === 'document') {
    const review = options.promptSelector.request.documentImage === undefined ? renderPlanReviewPage(
      options.promptSelector,
      theme,
      width,
      height,
      options.input,
      options.inputCursor,
      appName,
    ) : renderImagePreviewPage(options.promptSelector, theme, width, height, appName, options.imageProtocol, options.imageCellSize)
    return {
      ...(review.image === undefined ? {} : { image: review.image }),
      lines: fitFrame(review.lines, width),
      cursor: review.cursor,
      cursorVisible: review.cursorVisible === true,
      // A full-screen surface drew no transcript body.
      documentRows: null,
      ...(review.document === undefined ? {} : { promptDocument: review.document }),
    }
  }
  const welcome = renderWelcome({
    width,
    version,
    appName: options.displayName ?? appName,
  }, theme)

  const transcript = renderTranscriptBody(state, options, theme, spinnerFrame)
  const body: string[] = [...welcome]
  let transcriptStart = body.length
  if (transcript.lines.length > 0) {
    if (body.length > 0) body.push('')
    transcriptStart = body.length
    body.push(...transcript.lines)
  }

  // The activity is drawn inside the composer frame rather than as its own row.
  // A separate row cost a line, read as another component, and moved when the
  // composer grew; the frame is where the reader is already looking.
  const activityLabelText = state.status === 'running'
    ? options.workingLabel ?? DEEP_DRIVING_LABEL
    : state.status === 'compacting'
      ? options.workingLabel ?? 'Compacting'
      : undefined
  const working: string[] = []
  const statusBar = resolveStatusBarConfig(options.statusBar, options.statusPreset)
  const placeholder = options.inspected === undefined && state.status === 'idle'
    && options.input === '' && (options.inputImages ?? 0) === 0
    ? options.modelReady === false
      ? 'Run /login to connect a model'
      // `/ commands` and `@ files` are already on the header's hint line, and this
      // one is the copy that costs every frame: the header's scrolls into history
      // once the conversation starts, this one does not. A bare prompt is enough
      // to say the composer is ready for words.
      : 'Ask anything'
    : null
  const inlineHint = options.transcriptSearch !== undefined
    ? transcriptSearchHint({
      query: options.transcriptSearch.query,
      editing: options.transcriptSearch.editing,
      focus: options.transcriptSearch.focus,
    }, transcript.occurrences.length)
    : options.inspected === undefined
      ? slashInlineHint(options.input, options.inputCursor, options.commands)
        ?? placeholder
        ?? (state.status === 'running' && options.steerKey !== undefined
          ? `Enter: follow-up · ${options.steerKey}: next step` : null)
      : options.inspected.writable
        ? slashInlineHint(options.input, options.inputCursor, options.commands) ?? 'Enter to steer · Esc to return'
        : 'Read-only · Esc to return'
  const statusFooter = renderStatusFooter({
    model: options.model,
    ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
    ...(options.sessionTitle === undefined || options.sessionTitle === '' ? {} : { sessionTitle: options.sessionTitle }),
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
    // A composer starting with `!` is not talking to the model, and the border
    // says so the moment the character is typed — before the reader commits to
    // running anything. Green is the one ink that means "this runs on your
    // machine", which is also what a successful tool card uses.
    border: options.input.trimStart().startsWith('!')
      ? 'shellMode'
      : options.inspected !== undefined && options.inspected.writable !== true
        || state.status === 'idle'
        ? 'border'
        : 'accent',
    ...(theme.colors && (
      leadingSlashCommandNameRange(options.input) !== null
      || (options.inputImages !== undefined && options.inputImages !== 0)
    )
      ? { paintInput: (text: string, start: number) => paintComposerInputSlice(options.input, text, start, theme) }
      : {}),
    ...(inlineHint !== null ? { inlineHint } : {}),
    ...(options.transientStatus === undefined ? {} : { note: options.transientStatus }),
    ...(activityLabelText === undefined ? {} : {
      activity: {
        frame: motion === 'off' ? SYMBOL.running : SPINNER[Math.max(0, spinnerFrame) % SPINNER.length] ?? SYMBOL.running,
        label: activityLabelText,
        shimmer: activityLabelText === DEEP_DRIVING_LABEL && motion === 'full',
      },
      spinnerFrame: Math.max(0, spinnerFrame),
    }),
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
    : [
      ...renderSteering(state.nextStepInbox, theme, width),
      ...renderQueuedSubmissions(options.queuedSubmissions ?? [], theme, width, state.nextTurnInbox),
    ]
  // Above the composer and below the queue: the failure explains why the queue
  // is not moving, and the row survives until the next submission.
  const turnError = editor === undefined || options.inspected !== undefined || state.turnError === undefined
    ? []
    : renderTurnError(state.turnError, theme, width)
  const todos = editor === undefined || options.inspected !== undefined ? [] : renderTodos(state.todos, theme, width)
  const goal = editor === undefined || options.inspected !== undefined || options.sessionControls?.goal === undefined
    ? []
    : renderGoalBar(options.sessionControls.goal, theme, width)
  const pendingCount = options.sessionControls?.pendingQuestions ?? 0
  const questions = editor === undefined || options.inspected !== undefined || pendingCount === 0
    ? []
    : [truncateToWidth(theme.fg('warning', ` ${pendingCount} pending ${pendingCount === 1 ? 'question' : 'questions'} · /questions to answer`), width)]
  const inspect = editor === undefined ? [] : renderInspectBanner(options.inspected, theme, width, spinnerFrame)
  const subagents = editor === undefined
    ? []
    : renderSubagents(options.subagents, theme, width, spinnerFrame, options.inspected?.id, options.subagentLauncherFocused)
  const autocomplete = promptSelector !== undefined || settings !== undefined || copySelector !== undefined || search !== undefined
    || options.autocomplete === undefined
    ? []
    : renderAutocomplete(options.autocomplete.items, options.autocomplete.selected, theme, width)
  const inputLines = promptSelector?.lines ?? settings?.lines ?? copySelector?.lines ?? search?.lines
    ?? (editor === undefined ? [] : editor.lines)
  const spacer = 1
  const reserved = inputLines.length + working.length + inspect.length + subagents.length + todos.length + goal.length + questions.length + queuedSubmissions.length + turnError.length + spacer + autocomplete.length + statusFooter.length
  const budget = Math.max(0, height - reserved)
  const focusIndex = options.focusBlock === undefined
    ? undefined
    // Clamp against the blocks, not the offsets: a collapsed run's members
    // share its header's row, so the offset list can be shorter than the block
    // list, and clamping to it would aim the reader at a different block.
    : Math.max(0, Math.min(options.focusBlock, state.blocks.length - 1))
  const focusStart = focusIndex === undefined ? undefined : options.focusBlockEdge === 'end'
    ? Math.max(0, (transcript.blockStarts[focusIndex + 1] ?? transcript.lines.length) - Math.max(1, budget - 2))
    : transcript.blockStarts[focusIndex]
  const requestedStart = focusStart === undefined
    ? (options.scrollStart ?? Number.POSITIVE_INFINITY)
    : transcriptStart + focusStart
  const hasOverlay = promptSelector !== undefined || settings !== undefined || copySelector !== undefined || search !== undefined
  const isFollowing = requestedStart === Number.POSITIVE_INFINITY && !hasOverlay
  // A run still at work reshapes as it goes — its newest rows scroll, it folds
  // when the turn ends — so none of it may freeze into history until it
  // settles, the same way a running call's rows may not.
  const livePinned = transcript.liveFrom !== undefined
    || state.blocks.some(block => block.kind === 'tool' && block.status === 'running')
  const windowed = isFollowing
    ? undefined
    : windowTranscript(body, budget, requestedStart, theme)
  const visible = windowed?.lines ?? body

  const lines: string[] = [...visible]
  const showJump = !hasOverlay && windowed !== undefined && budget >= 3
    && (windowed.hiddenBelow > 0 || (options.openedGroups?.size ?? 0) > 0 || options.toolsExpanded === true)
  const jumpText = truncateToWidth(width >= 38 ? ' ↓ Jump to latest message · End ' : ' ↓ Latest · End ', width)
  const jumpColumn = Math.max(0, Math.floor((width - visibleWidth(jumpText)) / 2))
  const jumpToLatest = showJump ? { row: lines.length, column: jumpColumn, width: visibleWidth(jumpText) } : undefined
  if (visible.length > 0) lines.push(showJump
    ? ' '.repeat(jumpColumn) + theme.inverse(jumpText) : '')
  const bottomRows = working.length + goal.length + questions.length + inspect.length + subagents.length + todos.length + queuedSubmissions.length + turnError.length + inputLines.length + autocomplete.length + statusFooter.length
  const fill = Math.max(0, height - lines.length - bottomRows)
  /**
   * Spare rows sit between the header and the conversation while at the tail.
   *
   * A short transcript used to leave its slack below the last row, so folding a
   * run — which shortens the transcript — widened a gap in the middle of the
   * screen while nothing the reader was looking at moved. Moving the slack to the
   * top of the *frame* fixed that but dragged the header down with it, and a
   * header that drops to the bottom the moment the first message arrives is worse
   * than the gap.
   *
   * Between the header and the transcript, both stay put: the header keeps the
   * row it is read on, the newest rows keep the row they are watched on, and the
   * slack absorbs whatever a fold removes.
   *
   * Not while scrolled: a window is already full, and padding a scrollback view
   * would shift the rows the reader deliberately positioned.
   */
  const topPad = windowed === undefined && transcript.lines.length > 0 ? fill : 0
  if (topPad === 0) lines.push(...Array.from({ length: fill }, () => ''))
  lines.push(...working)
  lines.push(...goal)
  lines.push(...questions)
  lines.push(...inspect)
  lines.push(...subagents)
  lines.push(...todos)
  lines.push(...queuedSubmissions)
  lines.push(...turnError)
  const editorStart = lines.length
  lines.push(...inputLines)
  lines.push(...autocomplete)
  lines.push(...statusFooter)

  let liveStart: number
  if (isFollowing) {
    const firstPending = state.blocks.findIndex(isBlockPending)
    const pendingRow = firstPending >= 0 ? transcript.blockStarts[firstPending]! : undefined
    const liveRow = transcript.liveFrom === undefined
      ? pendingRow
      : Math.min(pendingRow ?? transcript.liveFrom, transcript.liveFrom)
    if (liveRow !== undefined) {
      liveStart = transcriptStart + liveRow + topPad
    } else {
      liveStart = lines.length - bottomRows + topPad
    }
    // liveStart marks the first row that is still live/mutable. Rows above it
    // are committed. Off-screen live rows are bounded by the renderer: it only
    // ever writes the live viewport, so pending rows above the visible window
    // are not pushed into native scrollback until they become committed.
  } else {
    liveStart = 0
  }

  // Padding rows are not document rows: `frameStart` below tells the renderer
  // which frame row the document begins at, so they never map to content.
  const frameLines = topPad === 0
    ? lines
    : [...lines.slice(0, transcriptStart), ...Array.from({ length: topPad }, () => ''), ...lines.slice(transcriptStart)]
  // Every settled block was already rendered against this width. Mirroring
  // OMP's stable-prefix preparation, only validate the mutable suffix instead
  // of measuring the complete native-scrollback history on every frame.
  const trimmed = fitFrame(frameLines, width, isFollowing ? liveStart + topPad : 0)
  const caret = promptSelector?.cursor ?? settings?.cursor ?? copySelector?.cursor ?? search?.cursor ?? editor?.cursor ?? { row: 0, column: 0 }
  // Which document rows this frame's body came from. `body` already includes the
  // header, so a window's own range is already in document coordinates and must
  // not have the header added again. No window means the whole body was drawn —
  // that is a known range, not a frame that failed to report one, and treating
  // it as "no body" would clear the record on every ordinary follow frame.
  const windowRange: DocumentRows | null | undefined = windowed === undefined
    ? (body.length === 0 ? null : { documentStart: 0, documentEnd: body.length + topPad, frameStart: 0 })
    : windowed.documentRows
  const bodySource: DocumentRows | null = windowRange === undefined
    ? null
    : windowRange
  const stickyHeaders: { start: number; end: number; text: string }[] = []
  if (!hasOverlay && budget >= 3) {
    for (let at = 0; at < state.blocks.length; at += 1) {
      const block = state.blocks[at]!
      if (block.kind !== 'user') continue
      const previous = stickyHeaders.at(-1)
      if (previous !== undefined) previous.end = transcriptStart + topPad + transcript.blockStarts[at]!
      const padding = width > 4 ? 2 : 0
      const label = truncateToWidth(promptSummary(block), Math.max(1, width - padding * 2))
      stickyHeaders.push({
        start: transcriptStart + topPad + (transcript.blockStarts[at + 1] ?? transcript.lines.length),
        end: body.length,
        text: paintSurface(theme, 'userMessageBg', 'userMessageText', padToWidth(' '.repeat(padding) + label, width)),
      })
    }
  }
  return {
    lines: trimmed,
    stickyHeaders,
    ...(jumpToLatest === undefined ? {} : { jumpToLatest: { ...jumpToLatest, row: jumpToLatest.row + topPad } }),
    documentRows: bodySource,
    cursor: {
      row: editorStart + caret.row + topPad,
      column: Math.min(caret.column, width),
    },
    cursorVisible: state.status === 'compacting'
      || (options.inspected !== undefined && options.inspected.writable !== true)
      ? false
      : promptSelector?.cursorVisible ?? (settings === undefined && copySelector === undefined),
    liveStart,
    livePinned,
    // A transient frame is either a full-screen surface or the user browsing
    // history; the renderer needs to tell them apart because only the first may
    // borrow the alternate buffer.
    ...(liveStart === 0 ? { transientSurface: hasOverlay ? 'overlay' as const : 'scroll' as const } : {}),
    transcript: {
      ...(windowed ?? {
        start: (body.length > budget ? body.length - Math.max(1, budget - 1) : 0),
        maxStart: (body.length > budget ? body.length - Math.max(1, budget - 1) : 0),
        budget,
        hiddenAbove: (body.length > budget ? body.length - Math.max(1, budget - 1) : 0),
        hiddenBelow: 0,
      }),
      blockStarts: transcript.blockStarts,
      fileRegions: transcript.fileRegions.map(region => ({ ...region, start: transcriptStart + topPad + region.start, end: transcriptStart + topPad + region.end })),
      blockDrawStarts: transcript.blockDrawStarts,
      foldShape: transcript.foldShape,
      foldMarks: transcript.foldMarks,
      bodyRow: transcriptStart + topPad,
    },
  }
}
