/**
 * TUI capability seam — local terminal provider.

 * Owns the tty: raw-mode key input (editing, history, slash/tab
 * autocomplete, /settings overlay, /copy picker, Ctrl-R history search, PgUp/PgDn
 * and Shift+Up/Down transcript scroll, Ctrl-O tool
 * expand, bracketed paste, double-Escape conversation rewind, double Ctrl-C exit, Ctrl-D quit),
 * SIGWINCH reflow, and the differential renderer. In non-tty mode
 * (pipes, CI) it degrades to line-based input with plain append-only
 * printing of settled blocks.
 * @module @agi-fans/dsh-tui
 */

import {
  TerminalNotificationController,
  TerminalNotificationQueue,
  terminalNotificationSequence,
} from './terminal-notifications.ts'
import { PROGRAM_STATUS_QUERY, programStatusSequence, terminalTitle, type TerminalTitleMode, type TerminalStateMode } from './terminal-state.ts'
import { TerminalSession } from './terminal-session.ts'
import {
  BRACKETED_PASTE, FOCUS_REPORTING, MOUSE_TRACKING,
} from './terminal-modes.ts'
import type { TerminalColors } from '../chrome/terminal-colors.ts'
import { IDLE_WHEEL, terminalAcceleratesWheel, wheelStep, type WheelGesture } from '../input/wheel-scroll.ts'
import { HerdrAgentReporter } from './herdr-agent.ts'
import { imageProtocol, type ImageProtocol } from '../chrome/terminal-images.ts'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { previewImages } from './image-preview.ts'
import { rmSync } from 'node:fs'
import { ComposerImages } from './composer-images.ts'
import { ComposerDraftStore, type ComposerDraft } from '../session/composer-drafts.ts'
import { mergeJobSettlement } from '../session/job-notice.ts'
import { PlainTui, type PendingRead } from './plain-tui.ts'
import { documentDestination, documentLayout, documentLineRow, documentMatches, documentModel, documentPosition, documentStart } from '../views/document-reader.ts'
import type { TuiDocumentPosition } from '../definition.ts'

import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-credentials'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkspaceChangesSummary } from '@deepseek-ai/dsh-workspace-changes'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { ComposerFiles } from '../input/composer-files.ts'
import {
  defaultFeatureStates,
  featurePatchPath,
  featureStatesFromPatch,
  renderFeatureBlock,
  replaceFeatureBlock,
  type FeatureStates,
} from '../session/feature-toggles.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  TUI_SERVICE,
  type TuiAgentBehaviorSettings,
  type TuiAgentBehaviorSettingsBinding,
  type TuiCommand,
  type TuiOutputOptions,
  type TuiShellRequest,
  type TuiShellResult,
  type TuiPrompt,
  type TuiNoticeOptions,
  type TuiRecentSession,
  type TuiService,
  type TuiSessionControls,
  type TuiSessionStats,
  type TuiStatus,
  type TuiTranscriptReplacement,
  type TuiInputImage,
  type TuiInspectedSubagent,
  type TuiLoopStatus,
  type TuiSubagentRoster,
  type TuiSubmission,
  type TuiPendingInputs,
} from '../definition.ts'
import {
  applySlashCompletion,
  formatHelpText,
  parseSlashInput,
  resolveSlashCommand,
  slashSuggestions,
  type AutocompleteItem,
  type SlashCommand,
  BUILTIN_SLASH_COMMANDS,
} from '../views/autocomplete.ts'
import {
  applyPathCompletion,
  defaultPathSource,
  editorLineAt,
  findPathToken,
  parsePathPrefix,
  pathSuggestions,
  searchPathSuggestions,
  type DirReader,
  type PathSearcher,
} from '../views/path-complete.ts'
import { activeAtToken } from '@deepseek-ai/dsh-file-reference/grammar'
import {
  matchesAtShortcutQuery,
  nextSelectableAutocompleteIndex,
  searchAtSuggestions,
  type FileSearcher,
  type SessionSearcher,
} from '../views/at-complete.ts'
import { readTmuxMouseEnabled } from '../input/mouse-policy.ts'
import { TextSelection } from '../input/text-selection.ts'
import { copyToClipboard, readFromClipboard, type ClipboardReader, type ClipboardWriter } from '../input/clipboard.ts'
import {
  applyCopySelectorEvent,
  createCopySelector,
  type CopySelectorState,
} from '../views/copy-selector.ts'
import { buildCopyTargets } from '../views/copy-targets.ts'
import {
  applyHistorySearchEvent,
  createHistorySearch,
  type HistorySearchState,
} from '../views/history-search.ts'
import { type EditorCommand, InputEditor, lineEnd, lineStart } from '../input/editor.ts'
import {
  applySettingsEvent,
  createSettings,
  refreshSettings,
  type SettingsState,
  type PluginSettingsEntry,
  tuiSettingItems,
  type TuiPrefs,
  type SettingItem,
} from '../views/settings-list.ts'
import { editSettingsEntry, pluginSettingsEntries, resetSettingsControl, setSettingsEntry, showSettingsError } from './plugin-settings.ts'
import { preferenceChanges } from './settings-preferences.ts'
import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager'
import {
  appendTrajectoryEvent,
  applyTrajectoryEvent,
  createTrajectory,
  trajectoryDetailMetrics,
  trajectoryListMetrics,
  type TrajectoryState,
} from '../views/trajectory.ts'
import {
  applyAgentHubEvent,
  createAgentHub,
  updateAgentHub,
  type AgentHubState,
} from '../views/agent-hub.ts'
import {
  applyEvent,
  applyStreamChunk,
  renderedBlocks,
  type AsidePanel,
  initialTranscript,
  replayEvents,
  renderView,
  turnGroups,
  type ProcessGroup,
  transcriptSeam,
  TRANSCRIPT_FAST_SCROLL,
  withWorkspaceSummary,
  type Block,
  type StreamDelta,
  type TranscriptState,
} from '../views/event-views.ts'
import {
  applyTranscriptSearchEvent,
  createTranscriptSearch,
  searchMatches,
  type TranscriptSearchMatch,
  type TranscriptSearchState,
} from '../views/transcript-search.ts'
import {
  nextRevealStep,
  revealStreamingAssistant,
  streamingAssistantKey,
  streamingAssistantUnits,
} from '../views/streaming-reveal.ts'
import { flushPending, parseKeys, type KeyEvent } from '../input/keys.ts'
import { sanitizeDisplayLine, type Frame, type FoldMark, type RenderSink } from '../chrome/renderer.ts'
import { blockFileAction, type FileAction } from '../views/file-actions.ts'
import { fileDocument, reviewFiles } from './file-review.ts'
import { stripAnsi } from '../chrome/width.ts'
import { MainScreenRenderer } from '../chrome/main-screen-renderer.ts'
import { colorDisabledByEnv, createTheme, detectColorDepth, type ColorDepth, type ThemeName } from '../chrome/theme.ts'
import { formatToolsText, type ToolInfo } from '../chrome/tools-list.ts'
import { renderTool, type TuiToolPresentation } from '../chrome/tool-renderers.ts'
import {
  NOTIFICATION_THRESHOLD_MS,
  resolveNotificationMode,
  TUI_SETTINGS_ENTRY,
  TUI_SETTINGS_FIELDS,
  type MotionMode,
  type NotificationMode,
  type TuiSettings,
} from '../session/tui-settings.ts'
import { DEFAULT_STATUS_DENSITY, resolveStatusBarConfig, type ResolvedStatusBarConfig } from '../chrome/status-config.ts'
import { HistoryStore } from '../session/history-store.ts'
import { PasteBurst, type PasteEmission } from '../input/paste-burst.ts'
import { DEFAULT_KEYBINDINGS, loadKeybindings, saveKeybindings, TUI_ACTION_LABELS, TUI_ACTIONS, type TuiAction } from '../input/keybindings-config.ts'
import { discoverEditors, type EditorId } from '../input/editor-discovery.ts'
import { editExternally, editFileExternally } from '../input/external-editor.ts'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import {
  movePromptSelection,
  movePromptTree,
  searchPromptSelection,
  filteredPromptOptions,
  refreshPromptOptions,
  promptTreePageSize,
  selectedPromptAnswer,
  selectedFilteredPromptAnswer,
  togglePromptSelection,
  documentRows,
  findInRows,
  type PromptSelectorState,
} from '../views/prompt-selector.ts'
import { edgeIndex, listNavigation, navigateIndex } from '../views/list-navigation.ts'
import { refreshProjectContext, resolveGitStatusFiles, resolveProjectContext } from '../session/project-context.ts'

import { modelRouteReady } from '../session/model-readiness.ts'
import { formatEssentialHotkeysText, formatHotkeysText, hotkeyCount, keysForAction } from '../views/hotkeys.ts'
import {
  imagePathCandidates,
  splitComposerImageMarkers,
  stripComposerImageMarkers,
  readImageFile,
  readImageFromClipboard,
  readMacClipboardFiles,
  type ClipboardFileReader,
  type ClipboardImageReader,
  type ImagePathReader,
} from '../input/image-paste.ts'
import { APP_DISPLAY_NAME, APP_NAME, APP_VERSION } from '../session/package-metadata.ts'
import type { StartupChangelogMode } from '../session/release-notes.ts'

const DOUBLE_CTRL_C_MS = 500
/**
 * Whether an open completion menu still speaks for the `@` token being typed.
 *
 * A `@` menu is built for a prefix, and the reader extends that prefix one
 * keystroke at a time while the search for the new one is still running. The
 * rows on screen describe a token this one extends, so they stay. Anything else
 * — a new `@`, a different path, a token that was never recorded — describes
 * nothing on screen and must not be reused.
 */
export function completionDescribes(described: string | undefined, current: string): boolean {
  if (described === undefined) return false
  return current.startsWith(described) || described.startsWith(current)
}

/** How long a confirmation stays on the composer's border before it fades. */
const TRANSIENT_STATUS_MS = 3_000
/** Shortest interval between repaints while a Shell command writes. */
const SHELL_PAINT_INTERVAL_MS = 80
const DOUBLE_ESCAPE_MS = 500
const STREAMING_REVEAL_MS = 1000 / 30

/**
 * Durable settlement events that arrive in bursts while a turn runs. Renders
 * for these are coalesced through the stream-render timer; rarer control
 * events (command lifecycle, inbox splices, titles, notices) render at once.
 */
const BURST_EVENT_TYPES = new Set([
  'step/start',
  'step/end',
  'tool/call',
  'tool/result',
  'assistant/message',
  'assistant/attempt',
  'llm/retry',
])

function shortenPath(cwd: string): string {
  const home = homedir()
  if (cwd === home) return '~'
  // Windows separates with `\`, so the home prefix check follows the host.
  if (cwd.startsWith(home + sep)) return '~' + cwd.slice(home.length)
  return cwd
}

export const name = 'omdsh-tui'

/** Plugin config: the model label, event paths, and the live TUI preferences. */
export interface Config extends TuiSettings {
  /** Model name for the status line. */
  model: string
  /** Optional JSONL prompt-history path. */
  historyPath?: string
  /** Optional `{ key-id: action }` JSON file. */
  keybindingsPath?: string
  /**
   * Profile home. Feature toggles are edited in the Profile patch under it,
   * which is why this row needs the path the composition already resolved.
   */
  dshHome?: string
}

/**
 * Row schema. The durable preferences ride as volatile fields, so a settings
 * form edit commits into their references and reaches this fiber through
 * `loader/volatile-update` without remounting the terminal provider.
 */
export const Config = z.object({
  model: z.string().default(''),
  historyPath: z.string(),
  keybindingsPath: z.string(),
  dshHome: z.string(),
  ...TUI_SETTINGS_FIELDS,
})

/** The minimal terminal surface a LocalTui drives (process streams satisfy it). */
export interface TerminalLike {
  output: RenderSink & { isTTY?: boolean }
  input: NodeJS.ReadableStream & {
    isTTY?: boolean
    setRawMode?(on: boolean): void
    destroy?(): void
  }
  /** Current width in columns. */
  width(): number
  /** Current height in rows. */
  height(): number
  /** Optional resize subscription; returns a disposer. */
  onResize?(listener: () => void): () => void
}

type PendingPrompt = PromptSelectorState & {
  resolve: (answer: string | null) => void
  offAbort?: () => void
  offTick?: () => void
  savedInput: ReturnType<InputEditor['snapshot']>
}

interface PluginSettingsBinding {
  entries(): readonly PluginSettingsEntry[]
  edit(id: string, signal: AbortSignal): Promise<void>
  set?(entry: PluginSettingsEntry, value: string, signal: AbortSignal): Promise<void>
  reset?(id: string, entry: PluginSettingsEntry | undefined, signal: AbortSignal, label: string): Promise<void>
  refresh?(): Promise<readonly PluginSettingsEntry[]>
}

/** One overlay surface displaced by an in-flight human prompt. */
type DisplacedSurface =
  | { kind: 'trajectory'; state: TrajectoryState }
  | { kind: 'agentHub'; state: AgentHubState }
  | { kind: 'settings'; state: SettingsState }
  | { kind: 'copySelector'; state: CopySelectorState }
  | { kind: 'search'; state: HistorySearchState }
/**
 * Local terminal presentation service.
 */
function detectTerminalProfile(): 'direct' | 'multiplexer' | 'conpty' {
  if (process.env.TMUX !== undefined || process.env.STY !== undefined || process.env.ZELLIJ !== undefined) {
    return 'multiplexer'
  }
  return process.platform === 'win32' ? 'conpty' : 'direct'
}

/**
 * Decide whether SGR is emitted. An explicit preference — plugin config or a
 * value the user picked in `/settings` — always wins, so a non-empty `NO_COLOR`
 * can never block someone who asked for color. Without a preference, a
 * non-empty `NO_COLOR` or `FORCE_COLOR=0` suppresses color and the output
 * stream's tty-ness decides.
 */
function resolveColors(preference: boolean | undefined, isTty: boolean): boolean {
  if (preference !== undefined) return preference
  return isTty && !colorDisabledByEnv()
}

/**
 * The first body row whose shape changed between two frames: the earliest
 * surface that opened, closed, or changed how it is open. Rows above it are
 * the same in both frames, which is what lets the renderer keep history that
 * is still true and repair only what moved.
 */
function firstReshapedRow(before: readonly FoldMark[], after: readonly FoldMark[]): number {
  const keys = (marks: readonly FoldMark[]): Set<string> => new Set(marks.map(mark => mark.key))
  const was = keys(before)
  const now = keys(after)
  let row = Number.POSITIVE_INFINITY
  for (const mark of before) if (!now.has(mark.key)) row = Math.min(row, mark.row)
  for (const mark of after) if (!was.has(mark.key)) row = Math.min(row, mark.row)
  return Number.isFinite(row) ? row : 0
}

export class LocalTui implements TuiService {
  get interactive(): boolean { return this.#tty }

  openFileInEditor(path: string): void {
    if (!this.#tty) throw new Error('Opening an editor requires an interactive terminal.')
    try {
      this.#handTerminal(() => { editFileExternally(path, this.#externalEditor) })
    } finally {
      if (!this.#disposed) this.#render()
    }
  }
  #deferInitialRender = false
  readonly #imageProtocol: ImageProtocol | undefined
  #imageCellSize = { width: 9, height: 18 }
  #imagePreviewAbort: AbortController | undefined
  #fileReviewAbort: AbortController | undefined
  #fileActionFrame: Frame | undefined
  #imageTemporary = new Set<string>()
  readonly #terminalProfile: 'direct' | 'multiplexer' | 'conpty'
  readonly #resizeDebounceMs: number
  #resizeTimer: ReturnType<typeof setTimeout> | null = null
  readonly #streamRenderMs: number
  #streamRenderTimer: ReturnType<typeof setTimeout> | null = null
  readonly #term: TerminalLike
  #model: string
  /** Optimistic until the credential seams answer; false points at /login. */
  #modelReady = true
  #reasoningEffort: string | undefined
  #colors: boolean
  #themeName: ThemeName
  readonly #tty: boolean
  readonly #renderer: MainScreenRenderer
  #state: TranscriptState = initialTranscript()
  readonly #editor = new InputEditor()
  readonly #files = new ComposerFiles({ text: () => this.#editor.text,
    append: marker => { this.#editor.setCursor(this.#editor.text.length); this.#editor.handle({ type: 'text', value: (this.#editor.text === '' ? '' : ' ') + marker }) } })

  insertText(text: string): void {
    if (text === '') return
    const before = this.#editor.text.slice(0, this.#editor.cursor)
    const after = this.#editor.text.slice(this.#editor.cursor)
    const prefix = before !== '' && !/\s$/u.test(before) ? ' ' : ''
    const suffix = (after !== '' && !/^\s/u.test(after)) || (text.startsWith('@') && after === '') ? ' ' : ''
    this.#editor.handle({ type: 'text', value: prefix + text + suffix })
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  async copyText(text: string, label = 'text'): Promise<void> {
    await this.#copyPicked(text, label)
  }

  stageFileAttachment(file: FileAttachmentRef): void {
    this.#files.add(file)
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }
  #history: string[] = []
  #historyIndex = 0
  #literalInput = false
  #draft = ''
  #historyDraft: ComposerDraft | undefined
  #clearedDraft: { draft: ComposerDraft; revision: number } | undefined
  readonly #stashedDrafts = new Map<string, ComposerDraft>()
  readonly #draftStore: ComposerDraftStore | undefined
  #draftScope: string | undefined
  #draftFingerprint = ''
  #draftDirty = false
  #draftTimer: ReturnType<typeof setTimeout> | undefined
  readonly #unsavedDrafts = new Map<string, ComposerDraft>()
  #draftError = false
  /**
   * The open completion menu. `query` is the `@` prefix the rows were built for,
   * so the next keystroke can tell "that token, extended" from "a different one".
   */
  #ac: { items: AutocompleteItem[]; selected: number; query?: string } | null = null
  #search: HistorySearchState | null = null
  #transcriptSearch: TranscriptSearchState | null = null
  #settings: SettingsState | null = null
  /** Optional-feature state read from the Profile patch this process booted with. */
  #features: FeatureStates | undefined
  /** Profile patch the Tools feature controls write; absent hides those controls. */
  #featurePatch: string | undefined
  #copySelector: CopySelectorState | null = null
  #trajectory: TrajectoryState | null = null
  #agentHub: AgentHubState | null = null
  #pending: PendingRead | null = null
  #queuedSubmissions: TuiSubmission[] = []
  /** Newer queue entries temporarily detached while Up browses backward. */
  #queueEditNewer: TuiSubmission[] | null = null
  #queueEditPending = false
  #quitRequested = false
  #resumeHintRequested = false
  #lastSigintTime = 0
  #lastEscapeTime = 0
  #inspectEscapeFenceUntil = 0
  #interrupts = new Set<() => void>()
  #queueEdits = new Set<() => void>()
  #queueHandler: ((signal: AbortSignal) => Promise<void>) | undefined
  #queueHotkeyAbort: AbortController | undefined
  readonly #queuedInputIds = new WeakMap<TuiSubmission, string>()
  #queuedInputSerial = 0
  #steerHandler: ((text: string) => void) | undefined
  #rewinds = new Set<() => void>()
  #inspects = new Set<(id: string) => void>()
  #inspectCloses = new Set<() => void>()
  #inspectSubmits = new Set<(submission: TuiSubmission) => void>()
  #disposed = false
  #pendingKeys = ''
  #escapeTimer: ReturnType<typeof setTimeout> | null = null
  #autocompleteTimer: ReturnType<typeof setTimeout> | null = null
  #autocompleteAbort: AbortController | null = null
  #autocompleteRequestId = 0
  #pasteBurst = new PasteBurst()
  #pasteBurstTimer: ReturnType<typeof setTimeout> | undefined
  #pasteProtection = true
  #paste = false
  #pasteBuf = ''
  #pasteInFlight = 0
  #deferredPasteEvents: KeyEvent[] = []
  readonly #images = new ComposerImages({
    editor: this.#editor,
    notice: text => { this.notice(text, { level: 'error' }) },
  })
  readonly #plain: PlainTui
  #offData: (() => void) | null = null
  #offResume: (() => void) | undefined
  #offResize: (() => void) | null = null
  #pwd: string
  #branch: string | undefined
  #spinner = 0
  #tick: ReturnType<typeof setInterval> | null = null
  #revealTick: ReturnType<typeof setInterval> | null = null
  #reveal: { key: string; revealed: number } | undefined
  #loopTick: ReturnType<typeof setInterval> | null = null
  #scrollStart = 0
  #maxStart = 0
  #scrollBudget = 0
  #blockStarts: readonly number[] = []
  /** Last frame's {@link TranscriptScroll.foldShape}, to notice a fold change. */
  #foldShape: string | undefined
  /** Last frame's open surfaces, to find where a fold change starts. */
  #foldMarks: readonly FoldMark[] | undefined
  #follow = true
  #focusBlock: number | undefined
  #focusBlockEdge: 'start' | 'end' | undefined
  #motion: MotionMode = 'full'
  #externalEditor: EditorId = 'auto'
  #terminalTitle: TerminalTitleMode = 'status'
  #terminalState: TerminalStateMode = 'auto'
  #programSupported = false
  #programQuerySent = false
  /** What the terminal reported about its own colors; empty until (and unless) it answers. */
  get #terminalColors(): TerminalColors { return this.#session.colors }
  /** Capability probe, reported colors, keyboard protocol, and every terminal mode this session turned on. */
  readonly #session = new TerminalSession({
    write: bytes => { this.#term.output.write(bytes) },
    alternateActive: () => this.#renderer?.alternateActive ?? false,
    setAlternateScreenModes: modes => { this.#renderer?.setAlternateScreenModes(modes) },
    deferUntilMainScreen: bytes => { this.#renderer?.deferUntilMainScreen(bytes) },
    colorsChanged: () => { this.#render() },
    probeSettled: () => {
      this.#probeGate = false
      if (!this.#disposed && !this.#deferInitialRender) this.#render()
    },
  })
  #offExit: (() => void) | undefined
  /** Accumulated wheel gesture, so fast spins move further than one notch. */
  #wheelGesture: WheelGesture = IDLE_WHEEL
  readonly #wheelAccelerates: boolean
  /** When the pending provider retry fires, so the working row can count down. */
  #retryDeadline: number | undefined
  /** When the running compaction started. */
  #compactionStartedAt: number | undefined
  readonly #readImageInput: ((ref: ImageAttachmentRef, signal: AbortSignal) => Promise<TuiInputImage | undefined>) | undefined
  #writtenProgramState: string | undefined
  #checkUpdates = true
  #startupChangelog: StartupChangelogMode = 'summary'
  #notifications = new TerminalNotificationController()
  #notificationQueue = new TerminalNotificationQueue()
  #notificationTimer: ReturnType<typeof setTimeout> | undefined
  #terminalFocused: boolean | undefined
  /**
   * Herdr lifecycle authority for this pane. The plugin entry injects the
   * environment-aware reporter; a directly constructed instance is inert so
   * tests running inside a Herdr pane cannot report against the live server.
   */
  readonly #herdr: HerdrAgentReporter
  #notificationPolicy: NotificationMode = 'off'
  #statusBar: ResolvedStatusBarConfig = resolveStatusBarConfig({ density: DEFAULT_STATUS_DENSITY, hidden: [] })
  #toolsExpanded = false
  /** Command outputs the reader opened; the rest fold after their preview. */
  #expandedOutputs = new Set<Block>()
  /**
   * The reader opened something with Ctrl+O or Alt+O and is reading it.
   *
   * Openings are shown in a browsing frame, never in the flow that follows the
   * tail: every opening starts an inspection, and returning to the tail ends it
   * and closes them all. The flow's rows cross into the terminal's history, which can only be
   * appended to: opening a run in place pushed rows that closing it could not
   * take back, so the screen either went blank where they had been or painted
   * rows history already held, and the transcript read twice. A browsing frame
   * repaints the screen and nothing above it, so reading an opened run leaves
   * the flow — and the history — exactly as it was.
   */
  #inspecting = false
  #mouseTracking = false
  readonly #selection = new TextSelection()
  #copyOnSelect = true
  #mathMode: import('../chrome/math.ts').MathMode = 'auto'
  #mermaidMode: import('../chrome/mermaid.ts').MermaidMode = 'auto'
  /** Transcript collapses every thought to one line; Ctrl+T flips it. */
  #hideThinking = false
  #mouseInteraction: 'auto' | 'tui' | 'native' = 'auto'
  #tmuxMouseEnabled: boolean | undefined
  #jumpPress: { row: number; column: number; width: number } | undefined
  #jumpToLatest: { row: number; column: number; width: number } | undefined
  #openedGroups = new Set<string>()
  /** Side-conversation pane; owned here so Esc can close it from any state. */
  #aside: AsidePanel | undefined
  /** Set while the pane is open, so closing it stops the work it was showing. */
  #asideAbort: AbortController | undefined
  /** Thoughts a reader opened individually, addressed by reasoning identity. */
  #expandedReasoning = new Set<string>()
  /**
   * The last action's confirmation, drawn on the composer's bottom border.
   *
   * A status that reports what a key just did is not part of the conversation,
   * so it never enters the block list: it replaces itself, and it is dropped by
   * the next keystroke. Writing it into the transcript would put chatter into
   * native scrollback, which cannot be taken back.
   */
  #transientStatus: string | undefined
  #transientTimer: ReturnType<typeof setTimeout> | null = null
  /** Aborts the live Shell card, so Ctrl+C interrupts the command it belongs to. */
  #shellAbort: (() => void) | undefined
  /** Turn scopes whose tools stay detailed as new calls arrive during inspection. */
  #detailedTurns = new Set<string>()
  #tools: ToolInfo[] = []
  #runtimeCommands: TuiCommand[] = []
  #prompt: PendingPrompt | null = null
  #pluginSettings: PluginSettingsBinding | undefined
  #pluginSettingsAbort: AbortController | undefined
  #pluginSettingsTask: Promise<void> | undefined
  /**
   * The overlay surface displaced by an in-flight prompt: while a human
   * prompt owns the keyboard, its screen must not compete with a stale
   * trajectory/hub surface that accepts invisible confirmations. Restored
   * when the prompt settles.
   */
  #promptDisplaced: DisplacedSurface | null = null
  #recentSessions: TuiRecentSession[] = []
  #sessionId: string | undefined
  #sessionTitle: string | undefined
  #writtenWindowTitle: string | undefined
  #sessionStats: TuiSessionStats | undefined
  #sessionControls: TuiSessionControls | undefined
  #loopStatus: TuiLoopStatus | undefined
  #subagents: TuiSubagentRoster | undefined
  #subagentLauncherFocused = false
  #inspected: TuiInspectedSubagent | undefined
  #promptDocument: { start: number; maxStart: number; pageSize: number; position?: TuiDocumentPosition } | undefined
  /**
   * 24-bit switch for the current color preference, re-derived whenever that
   * preference changes so a session that starts colorless can still enable
   * hexadecimal palettes without a restart.
   */
  #colorDepth: ColorDepth = 'ansi16'
  /** Hold the first frame until the capability probe settles; scrollback rows are immutable, so the first real paint must use the reported colors. */
  #probeGate = false
  readonly #copy: ClipboardWriter
  #copyTask: Promise<unknown> = Promise.resolve()
  readonly #readClipboard: ClipboardReader
  readonly #readClipboardImage: ClipboardImageReader
  readonly #readClipboardFiles: ClipboardFileReader
  readonly #readImagePath: ImagePathReader
  readonly #historyStore: HistoryStore | undefined
  readonly #keybindingsPath: string | undefined
  #keybindings: Record<string, TuiAction>
  #cwd: string
  #projectRoot: string
  readonly #home: string
  readonly #listDir: DirReader
  readonly #searchFiles: PathSearcher
  #searchFileMentions: FileSearcher | undefined
  #searchSessions: SessionSearcher | undefined
  readonly #autocompleteDebounceMs: number
  #persistPrefs: ((prefs: TuiPrefs, changes: readonly SettingsPathOp[]) => void | Promise<void>) | null = null
  #catalogVersion = 0
  #prefsSaveTask: Promise<void> | undefined
  #disposeTask: Promise<void> | undefined
  #prefsVersion = 0
  #agentBehavior: TuiAgentBehaviorSettings | undefined
  #updateAgentBehavior: ((next: TuiAgentBehaviorSettings) => Promise<void>) | undefined
  #offAgentBehaviorWatch: (() => void) | undefined
  #agentBehaviorPending = false

  /**
   * @param term - terminal surface (injectable for tests).
   * @param model - model label for the status line.
   * @param colors - SGR styling switch; `undefined` derives one from the
   * output stream's tty-ness and the environment.
   * @param themeName - shipped palette.
   * @param copy - clipboard writer (defaults to the platform tool).
   * @param paths - cwd/home/listing used by `@` and path autocomplete.
   */
  constructor(
    term: TerminalLike,
    model: string,
    colors: boolean | undefined,
    themeName: ThemeName = 'dark',
    copy: ClipboardWriter = copyToClipboard,
    paths: {
      cwd?: string
      projectRoot?: string
      home?: string
      listDir?: DirReader
      searchFiles?: PathSearcher
      searchFileMentions?: FileSearcher
      searchSessions?: SessionSearcher
      autocompleteDebounceMs?: number
      historyPath?: string
      draftsPath?: string
      keybindingsPath?: string
      /**
       * Profile patch the Tools feature controls edit. Absent leaves the controls
       * out entirely rather than presenting toggles that cannot be written.
       */
      featurePatch?: string
      readClipboard?: ClipboardReader
      readClipboardImage?: ClipboardImageReader
      readClipboardFiles?: ClipboardFileReader
      readImagePath?: ImagePathReader
      deferInitialRender?: boolean
      imageProtocol?: ImageProtocol | 'none'
  /** Read one stored image back as the composer's own image input. */
  readImageInput?: (ref: ImageAttachmentRef, signal: AbortSignal) => Promise<TuiInputImage | undefined>
      terminalProfile?: 'direct' | 'multiplexer' | 'conpty'
      alternateScreenOverlays?: boolean
      resizeDebounceMs?: number
      streamRenderMs?: number
      /** True accelerates wheel input; defaults to false on local macOS terminals, which the OS already accelerates. */
      wheelAcceleration?: boolean
      /** Herdr lifecycle reporter; production injects an environment-aware one. */
      herdrReporter?: HerdrAgentReporter
    } = {},
  ) {
    this.#term = term
    this.#model = model
    this.#colors = resolveColors(colors, term.output.isTTY === true)
    this.#themeName = themeName
    this.#copy = copy
    this.#readClipboard = paths.readClipboard ?? readFromClipboard
    this.#readClipboardImage = paths.readClipboardImage ?? readImageFromClipboard
    this.#readClipboardFiles = paths.readClipboardFiles ?? readMacClipboardFiles
    this.#historyStore = paths.historyPath === undefined ? undefined : new HistoryStore(paths.historyPath)
    this.#history = this.#historyStore?.load() ?? []
    this.#keybindingsPath = paths.keybindingsPath
    this.#keybindings = loadKeybindings(paths.keybindingsPath)
    this.#featurePatch = paths.featurePatch
    if (paths.featurePatch !== undefined) {
      try {
        this.#features = featureStatesFromPatch(readFileSync(paths.featurePatch, 'utf8'))
      } catch {
        // A patch that cannot be read still leaves the shipped defaults; the
        // write path below reports the failure when the user toggles.
        this.#features = defaultFeatureStates()
      }
    }
    const fallback = defaultPathSource()
    this.#cwd = paths.cwd ?? fallback.cwd
    this.#readImagePath = paths.readImagePath ?? (path => readImageFile(path, this.#cwd))
    const project = resolveProjectContext(this.#cwd)
    this.#projectRoot = paths.projectRoot ?? project.root
    this.#home = paths.home ?? fallback.home
    this.#listDir = paths.listDir ?? fallback.listDir
    this.#searchFiles = paths.searchFiles ?? fallback.searchFiles
    this.#searchFileMentions = paths.searchFileMentions
    this.#searchSessions = paths.searchSessions
    this.#autocompleteDebounceMs = Math.max(0, paths.autocompleteDebounceMs ?? 100)
    this.#deferInitialRender = paths.deferInitialRender === true
    this.#terminalProfile = paths.terminalProfile ?? detectTerminalProfile()
    this.#imageProtocol = this.#terminalProfile !== 'direct' || paths.imageProtocol === 'none' ? undefined : paths.imageProtocol ?? imageProtocol(process.env)
    this.#readImageInput = paths.readImageInput
    this.#resizeDebounceMs = Math.max(0, paths.resizeDebounceMs ?? 120)
    this.#streamRenderMs = Math.max(0, paths.streamRenderMs ?? 8)
    this.#wheelAccelerates = paths.wheelAcceleration ?? !terminalAcceleratesWheel()
    this.#herdr = paths.herdrReporter ?? new HerdrAgentReporter({ env: {} })
    this.#syncColorDepth()
    this.#tty = term.input.isTTY === true && term.output.isTTY === true
    this.#draftStore = this.#tty && paths.draftsPath !== undefined ? new ComposerDraftStore(paths.draftsPath) : undefined
    this.#plain = new PlainTui({
      term,
      blocks: () => this.#state.blocks,
      mathMode: () => this.#mathMode,
      mermaidMode: () => this.#mermaidMode,
      hideThinking: () => this.#hideThinking,
      promptRequest: () => this.#prompt?.request,
      finishPrompt: answer => { this.#finishPrompt(answer) },
    })
    this.#pwd = shortenPath(this.#cwd)
    this.#branch = project.gitLabel
    this.#renderer = new MainScreenRenderer(
      { write: (chunk) => { this.#term.output.write(chunk) } },
      {
        width: this.#term.width(),
        height: this.#term.height(),
        synchronized: this.#tty,
        alternateScreenOverlays: paths.alternateScreenOverlays === true,
      },
    )
    if (this.#tty) {
      this.#renderer.startEpoch()
      term.input.setRawMode?.(true)
      const listener = (chunk: Buffer): void => { this.#onData(chunk) }
      term.input.on('data', listener)
      this.#offData = () => { term.input.off('data', listener) }
      this.#offResize = term.onResize?.(() => {
        // A terminal resize changes the committed/live seam; re-anchor the
        // live window so it stays anchored at the bottom.
        this.#selection.clear()
        this.#jumpPress = undefined
        const repaint = (): void => {
          this.#resizeTimer = null
          this.#renderer.resize(this.#term.width(), this.#term.height())
          this.#render()
        }
        if (this.#terminalProfile === 'multiplexer') {
          if (this.#resizeTimer !== null) clearTimeout(this.#resizeTimer)
          this.#resizeTimer = setTimeout(repaint, this.#resizeDebounceMs)
        } else {
          repaint()
        }
      }) ?? null
      if (process.platform !== 'win32') {
        const resume = (): void => {
          if (this.#disposed) return
          this.#terminalFocused = undefined
          this.#writtenWindowTitle = undefined
          this.#writtenProgramState = undefined
          this.#programQuerySent = false
          this.#programSupported = false
          this.#syncWindowTitle()
          this.#session.takeBack()
          this.#renderer.reset()
          this.#render()
        }
        process.on('SIGCONT', resume)
        this.#offResume = () => { process.off('SIGCONT', resume) }
      }
      this.#session.setMode('paste', BRACKETED_PASTE, true)
      this.#session.setMode('focus', FOCUS_REPORTING, true)
      this.#probeGate = this.#deferInitialRender
      // A crash or `process.exit` skips dispose; the shell must still get its
      // terminal back rather than a stuck alternate screen or key encoding.
      const onExit = (): void => { this.#restoreTerminalOnExit() }
      process.once('exit', onExit)
      this.#offExit = () => { process.off('exit', onExit) }
      this.#session.start()
    }
    this.#render()
    this.#herdr.start()
    if (paths.deferInitialRender !== true) this.#syncWindowTitle()
  }

  /** Follow the viewed Session without replacing its transcript or native history. */
  setWorkingDirectory(cwd: string): void {
    if (cwd === this.#cwd && cwd === this.#projectRoot) return
    this.#cwd = cwd
    const project = resolveProjectContext(cwd)
    this.#projectRoot = cwd
    this.#pwd = shortenPath(cwd)
    this.#branch = project.gitLabel
    this.#refreshAutocomplete()
    this.#syncWindowTitle()
    if (this.#tty) this.#render()
  }

  /** Refresh Git metadata without changing the Session's effective directory. */
  #refreshProjectContext(): void {
    const branch = refreshProjectContext(this.#cwd).gitLabel
    if (branch === this.#branch) return
    this.#branch = branch
    this.#syncWindowTitle()
    if (this.#tty) this.#render()
  }

  event(event: SessionEvent, presentation?: TuiToolPresentation, workspace?: WorkspaceChangesSummary): void {
    // Paint any coalesced results and remaining streamed text before the turn's
    // end changes the live work into its folded summary.
    if (event.type === 'turn/end' && this.#tty && this.#state.status !== 'idle'
      && turnGroups(this.#state).some(group => group.live)) {
      this.#syncStreamingReveal(undefined)
      this.#render()
    }
    if (event.type === 'llm/retry') this.#retryDeadline = Date.now() + event.data.delayMs
    if (event.type === 'llm/retry-started' || event.type === 'turn/end') this.#retryDeadline = undefined
    this.#state = applyEvent(this.#state, event, presentation, workspace)
    const compacting = this.#state.status === 'compacting'
    if (compacting && this.#compactionStartedAt === undefined) this.#compactionStartedAt = Date.now()
    else if (!compacting) this.#compactionStartedAt = undefined
    if (event.type === 'turn/end' && this.#inspected === undefined) { this.#herdr.settled(event.data.reason.kind); this.#syncWindowTitle() }
    this.#emitNotification(this.#notifications.event({
      type: event.type,
      time: event.time,
      ...(event.type === 'turn/end' ? { reason: event.data.reason.kind } : {}),
    }))
    if (this.#trajectory !== null) this.#trajectory = appendTrajectoryEvent(this.#trajectory, event)
    if (event.type === 'turn/end') this.#refreshProjectContext()
    this.#syncStreamingReveal(undefined)
    this.#syncTick()
    if (this.#tty) {
      // Settlement events arrive in bursts (parallel tool calls, in-process
      // subagent settlements); coalesce them like setSession. Control events
      // (user echo, command lifecycle, inbox splices) stay immediate.
      if (this.#streamRenderMs > 0 && this.#busy() && BURST_EVENT_TYPES.has(event.type)) {
        this.#scheduleStreamRender()
      } else {
        this.#render()
      }
    } else if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result' || event.type === 'turn/end') {
      this.#plain.print()
    }
  }

  setWorkspaceSummary(turn: number, summary: WorkspaceChangesSummary): void {
    const next = withWorkspaceSummary(this.#state, turn, summary)
    if (next === this.#state) return
    this.#state = next
    if (this.#tty) this.#render()
    else this.#plain.print()
  }

  /**
   * Fold one live `agent/assistant-stream` chunk into the transcript and
   * schedule the streaming reveal. Durable settlement follows on the session
   * log as `assistant/message` or `assistant/attempt`.
   */
  streamDelta(delta: StreamDelta): void {
    this.#state = applyStreamChunk(this.#state, delta)
    const smoothStream = this.#syncStreamingReveal(delta)
    this.#syncTick()
    if (this.#tty) {
      if (smoothStream) {
        // The 30 fps reveal clock owns presentation for textual deltas.
      } else if (this.#streamRenderMs > 0) {
        this.#scheduleStreamRender()
      } else {
        this.#render()
      }
    }
  }

  setStatus(status: TuiStatus, options: { root?: boolean; outcome?: string } = {}): void {
    // Parent lifecycle remains authoritative while the child owns the visible view.
    if (options.root === true || this.#inspected === undefined) {
      this.#herdr.setRunning(status === 'running')
      if (options.outcome !== undefined) this.#herdr.settled(options.outcome)
      this.#syncWindowTitle()
    }
    if (options.root === true && this.#inspected !== undefined) return
    if (this.#state.status === 'compacting') return
    this.#state = { ...this.#state, status }
    this.#syncTick()
    if (this.#tty) this.#render()
  }

  /** Update first-run model readiness without touching the model label. */
  setModelReady(ready: boolean): void {
    if (this.#modelReady === ready) return
    this.#modelReady = ready
    if (this.#tty) this.#render()
  }

  setModel(model: string, reasoningEffort?: string): void {
    this.#model = model
    this.#reasoningEffort = reasoningEffort
    this.#syncSettingsActions()
    this.#refreshSettingsCatalog()
    if (this.#tty) this.#render()
  }

  setLoopStatus(status: TuiLoopStatus | undefined): void {
    this.#loopStatus = status === undefined ? undefined : { ...status }
    this.#syncLoopTick()
    if (this.#tty) this.#render()
  }

  setSubagents(roster: TuiSubagentRoster | undefined): void {
    const previous = this.#subagents?.agents ?? []
    const incoming = roster?.agents ?? []
    const statusChanged = previous.length !== incoming.length || incoming.some((agent, index) => {
      const before = previous[index]
      return before === undefined || before.id !== agent.id || before.label !== agent.label
        || before.phase !== agent.phase || before.depth !== agent.depth || before.mode !== agent.mode
    })
    this.#subagents = roster === undefined
      ? undefined
      : { agents: roster.agents.map(agent => ({ ...agent, activity: [...agent.activity] })) }
    if ((this.#subagents?.agents.length ?? 0) === 0) this.#subagentLauncherFocused = false
    if (this.#agentHub !== null) {
      if (this.#subagents === undefined) this.#agentHub = null
      else this.#agentHub = updateAgentHub(this.#agentHub, this.#subagents)
    }
    const inspected = this.#inspected
    if (inspected !== undefined) {
      const current = this.#subagents?.agents.find(agent => agent.id === inspected.id)
      if (current !== undefined) {
        this.#inspected = {
          id: current.id,
          label: current.label,
          phase: current.phase,
          ...(current.mode === undefined ? {} : { mode: current.mode }),
          writable: current.mode === 'continuable',
        }
      }
    }
    if (!statusChanged && this.#agentHub === null) return
    this.#syncTick()
    if (this.#tty) this.#scheduleStreamRender()
  }

  setInspectedSubagent(inspected: TuiInspectedSubagent | undefined): void {
    if (this.#inspected?.id === inspected?.id && this.#inspected?.label === inspected?.label
      && this.#inspected?.phase === inspected?.phase && this.#inspected?.mode === inspected?.mode
      && this.#inspected?.writable === inspected?.writable) return
    this.#switchDraft(inspected?.id ?? this.#sessionId)
    this.#inspected = inspected === undefined ? undefined : { ...inspected }
    if (inspected !== undefined) {
      this.#inspectEscapeFenceUntil = 0
      this.#subagentLauncherFocused = false
    }
    this.#syncTick()
    if (this.#tty) this.#render()
  }

  setTools(tools: readonly ToolInfo[]): void {
    this.#tools = tools.map((tool) => ({ name: tool.name, description: tool.description }))
  }

  setCommands(commands: readonly TuiCommand[]): void {
    this.#runtimeCommands = commands.map((command) => ({
      name: command.name,
      description: command.description,
      ...(command.inputHint === undefined ? {} : { inputHint: command.inputHint }),
    }))
    this.#syncSettingsActions()
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  openTrajectory(events: readonly SessionEvent[]): boolean {
    if (!this.#tty) return false
    this.#finishPrompt(null)
    this.#trajectory = createTrajectory(events)
    this.#agentHub = null
    this.#settings = null
    this.#copySelector = null
    this.#search = null
    this.#ac = null
    this.#render()
    return true
  }

  setSessionSearch(search?: SessionSearcher): void {
    this.#searchSessions = search
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  setFileSearch(search?: FileSearcher): void {
    this.#searchFileMentions = search
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  setImageValidator(validate?: (image: TuiInputImage) => Promise<void>): void {
    this.#images.setValidator(validate)
  }

  toolCallContext(callId: string): string | undefined {
    const block = this.#state.blocks.findLast(
      candidate => candidate.kind === 'tool' && String(candidate.callId) === callId,
    )
    if (block?.kind !== 'tool') return undefined
    // Keep the provider-owned presentation and input intact in the approval reader.
    const view = renderTool({
      name: block.name,
      arguments: block.args,
      output: block.output,
      status: block.status,
      expanded: false,
      ...(block.presentation === undefined ? {} : { presentation: block.presentation }),
    })
    return [view.title, view.summary, ...view.input]
      .filter((part): part is string => part !== undefined && part !== '')
      .join('\n')
  }

  notice(text: string, options: TuiNoticeOptions = {}): void {
    const merged = options.job === undefined ? undefined : mergeJobSettlement(this.#state, options.job)
    if (merged !== undefined && this.#tty) {
      const origin = merged.blocks.find((block, index) => block !== this.#state.blocks[index])
      this.#state = merged
      // A previous turn may already be in native history. Keep its new outcome
      // visible at the tail as well as updating the live transcript's tool.
      if (origin?.kind === 'tool' && (origin.turn === undefined || origin.turn === this.#state.turn)) {
        if (options.focus === true) this.#followTail()
        this.#render()
        return
      }
    }
    const running = options.process === true && this.#state.status !== 'idle' && this.#state.turn > 0
    const block: Block = {
      kind: 'notice',
      level: options.level ?? 'info',
      text,
      ...(options.framed === true ? { framed: true } : {}),
      ...(running
        ? { process: { turn: this.#state.turn, ...(options.processSource === undefined ? {} : { source: options.processSource }) } }
        : {}),
    }
    this.#state = { ...this.#state, blocks: [...this.#state.blocks, block] }
    if (options.focus === true) this.#followTail()
    if (this.#tty) this.#render()
    else this.#plain.print()
  }

  commandOutput(command: string, text: string, options: TuiOutputOptions = {}): void {
    this.#state = { ...this.#state, blocks: [...this.#state.blocks, { kind: 'commandOutput', command, text }] }
    if (options.focus === true) this.#followTail()
    if (this.#tty) this.#render()
    else this.#plain.print()
  }

  /**
   * Run a Shell line as a live card that streams in place.
   *
   * The card is appended before the command starts and updated as it writes, so
   * the reader watches their own command rather than switching to another
   * surface and coming back. It never waits for an exit gesture: when the
   * command finishes the card is finished too, exactly like a tool call.
   */
  async shellCommand(request: TuiShellRequest): Promise<TuiShellResult> {
    const block = { kind: 'shell' as const, command: request.command, output: '', status: 'running' as const }
    this.#insertShellBlock(block)
    // Ctrl+C belongs to the running command while its card is alive, the same
    // way it belongs to an active turn. The caller decides what to do with the
    // abort; the provider only routes the key.
    this.#shellAbort = request.abort
    let lastPaint = 0
    let pending = ''
    let pendingPaint: ReturnType<typeof setTimeout> | undefined
    const cancelPending = (): void => { if (pendingPaint !== undefined) { clearTimeout(pendingPaint); pendingPaint = undefined } }
    const paint = (): void => { if (this.#tty && !this.#disposed) this.#render() }
    // Output can arrive faster than a frame is worth; coalescing keeps a chatty
    // command from spending the whole turn in the renderer.
    const append = (output: string): void => {
      pending = output
      const now = Date.now()
      if (now - lastPaint < SHELL_PAINT_INTERVAL_MS) {
        cancelPending()
        pendingPaint = setTimeout(paint, SHELL_PAINT_INTERVAL_MS - (now - lastPaint))
        return
      }
      lastPaint = now
      this.#updateShellBlock(request.command, current => ({ ...current, output: pending }))
      paint()
    }
    let result: TuiShellResult
    try {
      result = await request.run(append, request.signal)
    } catch (error: unknown) {
      this.#updateShellBlock(request.command, current => ({ ...current, status: 'error' }))
      paint()
      throw error
    } finally {
      cancelPending()
      if (this.#shellAbort === request.abort) this.#shellAbort = undefined
    }
    const failed = result.interrupted === true || (result.code !== undefined && result.code !== 0)
    this.#updateShellBlock(request.command, current => ({
      ...current,
      output: result.output === '' ? current.output : result.output,
      status: failed ? 'error' : 'ok',
      ...(result.code === undefined ? {} : { code: result.code }),
      ...(request.share === true ? { shared: true } : {}),
    }))
    paint()
    return result
  }

  /**
   * A side question, streamed into its own transcript block.
   *
   * Modelled on `shellCommand` rather than on `commandOutput`: the answer arrives
   * over time, and the reader should watch it arrive where it will stay. Coalesced
   * the same way, because a chatty stream would otherwise spend the turn in the
   * renderer.
   */
  /** Navigation belongs to the pane only when nothing else is claiming it. */
  #asideOwnsKeys(): boolean {
    return this.#editor.text === '' && this.#ac === null && this.#prompt === null
  }

  /**
   * Leaving the pane stops the consultation.
   *
   * Without this the request kept running invisibly and its answer was dropped,
   * so the reader could neither read it nor stop paying for it.
   */
  #closeAside(): void {
    this.#asideAbort?.abort()
    this.#asideAbort = undefined
    this.#aside = undefined
    this.#render()
  }

  /**
   * A side question, streamed into its own pane above the composer.
   *
   * Not a transcript block: the exchange belongs to a conversation that is not
   * this one, so it gets its own pane rather than a row in the conversation the
   * reader is working in. The pane is docked, `Esc` closes it, and the session
   * looks exactly as it did. Coalesced the same way a Shell card is, because a
   * chatty stream would otherwise spend the turn in the renderer.
   */
  async asideQuestion(request: {
    question: string
    run: (onUpdate: (text: string) => void, signal: AbortSignal) => Promise<{ text: string; detail?: string; failed?: boolean }>
    signal: AbortSignal
  }): Promise<void> {
    this.#asideAbort?.abort()
    const abort = new AbortController()
    this.#asideAbort = abort
    // Leaving the pane and losing the session both stop the consultation.
    if (request.signal.aborted) abort.abort()
    else request.signal.addEventListener('abort', () => abort.abort(), { once: true })
    this.#aside = { question: request.question, text: '', status: 'running', scroll: 0 }
    this.#render()
    let lastPaint = 0
    let pending = ''
    let pendingPaint: ReturnType<typeof setTimeout> | undefined
    const paint = (): void => { if (this.#tty && !this.#disposed) this.#render() }
    const show = (change: Partial<AsidePanel>): void => {
      if (this.#aside !== undefined) this.#aside = { ...this.#aside, ...change }
    }
    /**
     * The pending text is applied by the paint, not merely followed by one: a
     * chunk that arrives inside the throttle window used to schedule a repaint of
     * the *old* text, so the last words before a pause never appeared.
     */
    const flush = (): void => {
      if (pendingPaint !== undefined) { clearTimeout(pendingPaint); pendingPaint = undefined }
      lastPaint = Date.now()
      show({ text: pending })
      paint()
    }
    const stream = (text: string): void => {
      pending = text
      const wait = SHELL_PAINT_INTERVAL_MS - (Date.now() - lastPaint)
      if (wait <= 0) { flush(); return }
      if (pendingPaint !== undefined) clearTimeout(pendingPaint)
      pendingPaint = setTimeout(flush, wait)
    }
    try {
      const result = await request.run(stream, abort.signal)
      show({
        text: result.text,
        status: result.failed === true ? 'error' : 'done',
        ...(result.detail === undefined ? {} : { detail: result.detail }),
      })
    } catch (error) {
      if (!abort.signal.aborted) show({ status: 'error', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      if (pendingPaint !== undefined) clearTimeout(pendingPaint)
      if (this.#asideAbort === abort) this.#asideAbort = undefined
      paint()
    }
  }

  /** Append a Shell card and follow it, so the reader sees it start. */
  #insertShellBlock(block: Extract<Block, { kind: 'shell' }>): void {
    this.#state = { ...this.#state, blocks: [...this.#state.blocks, block] }
    this.#followTail()
    if (this.#tty) this.#render()
    else this.#plain.print()
  }

  /** Replace the newest Shell card for `command`; a card is identified by its position. */
  #updateShellBlock(command: string, update: (block: Extract<Block, { kind: 'shell' }>) => Extract<Block, { kind: 'shell' }>): void {
    const at = this.#state.blocks.findLastIndex(block => block.kind === 'shell' && block.command === command)
    if (at < 0) return
    const next = this.#state.blocks.slice()
    next[at] = update(next[at] as Extract<Block, { kind: 'shell' }>)
    this.#state = { ...this.#state, blocks: next }
  }

  prompt(request: TuiPrompt): Promise<string | null> {
    // Background approvals take the terminal from a user-opened file reader.
    if (this.#fileReviewAbort !== undefined && request.signal !== this.#fileReviewAbort.signal) this.#fileReviewAbort.abort()
    if (this.#disposed || request.signal?.aborted === true) return Promise.resolve(null)
    if (this.#prompt !== null) {
      const superseded = this.#prompt.request.onSuperseded
      if (superseded === undefined || request.notify === false) return Promise.reject(new Error('omdsh-tui: prompt already in flight'))
      const input = this.#editor.expandedText
      this.#finishPrompt(null)
      try { superseded(input) } catch (error) { this.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
    }
    this.#flushPasteBurst(true)
    this.#pasteBurst.clear()
    if (request.notify !== false) {
      this.#emitNotification(this.#notifications.humanPrompt())
      this.#herdr.prompt(request.title)
      this.#syncWindowTitle()
    }
    if (this.#tty && request.documentImage !== undefined && this.#imageProtocol !== undefined) this.#term.output.write('\x1b[16t')
    const savedInput = this.#editor.snapshot()
    this.#editor.setText(request.allowCustom === false || request.filterable === true || (request.options?.length && request.initialInput === undefined) ? '' : request.initialInput ?? '')
    this.#ac = null
    const displaced = this.#displaceSurface()
    return new Promise((resolve) => {
      const selected = Math.max(0, filteredPromptOptions(request, '').findIndex(option =>
        (option.value ?? option.label) === request.initialValue) ?? 0)
      const pending: PendingPrompt = { request, selected, checked: new Set((request.options ?? []).flatMap((option, index) => request.initialValues?.includes(option.value ?? option.label) ? [index] : [])), resolve, savedInput,
        ...(request.armMs !== undefined && request.armMs > 0 ? { armedUntil: Date.now() + request.armMs } : {}),
        ...(request.documentPosition === undefined ? {} : { documentAnchor: request.documentPosition, documentQuery: request.documentPosition.query,
          documentWordWrap: request.documentPosition.wordWrap, documentColumn: request.documentPosition.column }),
        ...(request.documentTail === true && request.documentPosition?.following !== false ? { documentScroll: Number.POSITIVE_INFINITY } : {}) }
      if (request.signal !== undefined) {
        const onAbort = (): void => {
          this.#finishPrompt(null)
          if (this.#tty && !this.#disposed) this.#render()
        }
        request.signal.addEventListener('abort', onAbort, { once: true })
        pending.offAbort = () => { request.signal?.removeEventListener('abort', onAbort) }
      }
      this.#prompt = pending
      this.#promptDisplaced = displaced
      if (this.#tty && request.wait !== undefined && request.refreshDocument === undefined && request.refreshDocumentSource === undefined && request.refreshOptions === undefined) {
        const tick = setInterval(() => { if (!this.#disposed) this.#render() }, 1_000)
        pending.offTick = () => { clearInterval(tick) }
      }
      if (this.#tty && (request.refreshDocument !== undefined || request.refreshDocumentSource !== undefined || request.refreshOptions !== undefined)) {
        const tick = setInterval(() => {
          if (this.#disposed || this.#prompt === null) return
          try {
            const detail = request.refreshDocument?.()
            const source = request.refreshDocumentSource?.(this.#prompt.documentScroll === Number.POSITIVE_INFINITY)
            const options = request.refreshOptions?.()
            let changed = false
            if (source !== undefined && source !== this.#prompt.request.documentSource) {
              const shift = (this.#prompt.request.documentSource?.firstLine ?? 1) - (source.firstLine ?? 1)
              const anchor = this.#prompt.documentAnchor
              this.#prompt = { ...this.#prompt, request: { ...this.#prompt.request, documentSource: source },
                ...(anchor === undefined ? {} : { documentAnchor: { ...anchor, row: Math.max(0, anchor.row + shift) } }) }
              changed = true
            }
            if (options !== undefined && options !== this.#prompt.request.options) {
              this.#prompt = refreshPromptOptions(this.#prompt, options, this.#editor.text)
              changed = true
            }
            if (detail !== undefined && detail !== this.#prompt.request.detail) {
              this.#prompt = { ...this.#prompt, request: { ...this.#prompt.request, detail } }
              changed = true
            }
            if (changed) this.#render()
          } catch (error) {
            this.#finishPrompt(null)
            this.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
          }
        }, 250)
        pending.offTick = () => { clearInterval(tick) }
      }
      if (this.#tty) {
        this.#render()
      } else {
        const lines = [request.question]
        if (request.documentSource !== undefined) lines.push('', request.documentSource.text)
        if (request.detail !== undefined && request.detail !== '') lines.push('', request.detail)
        if (request.options !== undefined && request.options.length > 0) {
          lines.push('', ...request.options.map((option, index) =>
            `${index + 1}. ${option.label}${option.description === undefined ? '' : ' — ' + option.description}`))
          lines.push('', request.allowCustom === false
            ? 'Choose a label or number.'
            : request.multiSelect === true
              ? 'Choose labels/numbers separated by commas, or type a custom answer.'
              : 'Choose a label/number, or type a custom answer.')
        }
        if (request.skippable === true) lines.push('', 'A blank line skips this question.')
        this.notice(`${request.title}\n${lines.join('\n')}`)
      }
    })
  }

  replaceSession(
    events: readonly SessionEvent[],
    presentations?: ReadonlyMap<number, TuiToolPresentation>,
    status: TuiStatus = 'idle',
    reason: TuiTranscriptReplacement = 'open',
  ): void {
    if (reason !== 'refresh') this.#fileReviewAbort?.abort()
    this.#trajectory = null
    const state = replayEvents(events, presentations)
    // A notice does not turn a blank session into a document that /new needs
    // to separate. Refreshes are the same document.
    const boundary = reason === 'open' || (reason === 'new' && this.#state.blocks.some(block =>
      block.kind !== 'notice'))
    const blocks = boundary ? [transcriptSeam('session-opened'), ...state.blocks] : state.blocks
    this.#state = { ...state, status, compactCommandId: undefined, blocks }
    this.#plain.resetPrinted()
    this.#followTail()
    this.#deferInitialRender = false
    this.#renderer.startEpoch({ replay: reason === 'refresh' ? 'viewport' : status === 'idle' ? 'full' : 'pinned' })
    if (this.#tty) this.#render()
    else this.#plain.print()
  }

  setSession(info: {
    id: string
    title?: string
    recent: readonly TuiRecentSession[]
    stats?: TuiSessionStats
    controls?: TuiSessionControls
  }): void {
    if (info.id !== this.#sessionId) this.#fileReviewAbort?.abort()
    this.#switchDraft(this.#inspected?.id ?? info.id)
    this.#sessionId = info.id
    this.#herdr.setSession(info.id)
    const title = info.title?.trim()
    this.#sessionTitle = title === undefined || title === '' ? undefined : title
    this.#recentSessions = info.recent.map((session) => ({ ...session }))
    this.#sessionStats = info.stats === undefined ? undefined : { ...info.stats }
    this.#sessionControls = info.controls === undefined
      ? undefined
      : {
          ...info.controls,
          ...(info.controls.plan === undefined ? {} : { plan: { ...info.controls.plan } }),
        }
    this.#syncSettingsActions()
    if (!this.#tty) return
    this.#syncWindowTitle()
    if (this.#reveal !== undefined && this.#motion !== 'off') return
    if (this.#streamRenderMs > 0 && this.#busy()) this.#scheduleStreamRender()
    else this.#render()
  }

  /** Only the foreground terminal owner emits title and program-state sequences. */
  #syncWindowTitle(): void {
    if (!this.#tty || this.#disposed) return
    const status = this.#herdr.programStatus
    const title = terminalTitle(this.#terminalTitle, status, this.#sessionTitle, this.#cwd, this.#branch)
    if (title !== this.#writtenWindowTitle && !(this.#terminalTitle === 'off' && this.#writtenWindowTitle === undefined)) {
      this.#writtenWindowTitle = title
      this.#term.output.write(`\x1b]2;${title}\x07`)
    }
    if (this.#terminalState === 'auto' && !this.#programQuerySent) {
      this.#programQuerySent = true
      this.#term.output.write(PROGRAM_STATUS_QUERY)
    }
    const enabled = this.#terminalState === 'on' || this.#terminalState === 'auto' && this.#programSupported
    if (!enabled) {
      if (this.#writtenProgramState !== undefined) this.#term.output.write(programStatusSequence('clear'))
      this.#writtenProgramState = undefined
      return
    }
    // Only the session name is exported as metadata; prompt bodies and errors stay in the TUI.
    const sequence = programStatusSequence({ state: status.state, ...(this.#sessionTitle === undefined ? {} : { message: this.#sessionTitle }) })
    if (sequence === this.#writtenProgramState) return
    this.#writtenProgramState = sequence
    this.#term.output.write(sequence)
  }

  /**
   * Re-derive the color depth from the active color preference. Every path
   * that changes `#colors` calls this so `/settings` takes effect immediately.
   */
  #syncColorDepth(): void {
    this.#colorDepth = this.#colors ? detectColorDepth() : 'ansi16'
  }

  /** Apply prefs loaded from this entry's config (does not persist). */
  applyStoredPrefs(prefs: TuiPrefs): void {
    if (this.#disposed) return
    this.#prefsVersion++
    this.#applyPrefs(prefs, { persist: false, forceToolsSync: true })
    if (this.#settings !== null) this.#settings = { ...this.#settings, prefs }
    this.#refreshSettingsCatalog()
    if (this.#tty) this.#render()
  }

  /** Currently applied preferences; sibling rows read these instead of the config references. */
  prefs(): TuiPrefs {
    return {
      theme: this.#themeName,
      colors: this.#colors,
      motion: this.#motion,
      mathMode: this.#mathMode,
      mermaidMode: this.#mermaidMode,
      hideThinking: this.#hideThinking,
      editor: this.#externalEditor,
      terminalTitle: this.#terminalTitle,
      terminalState: this.#terminalState,
      copyOnSelect: this.#copyOnSelect,
      mouseInteraction: this.#mouseInteraction,
      pasteProtection: this.#pasteProtection,
      checkUpdates: this.#checkUpdates,
      startupChangelog: this.#startupChangelog,
      notifications: this.#notificationPolicy,
      statusBar: { density: this.#statusBar.density, hidden: [] },
    }
  }

  /** Called after a live `/settings` change. */
  setPrefsPersist(persist: (prefs: TuiPrefs, changes?: readonly SettingsPathOp[]) => void): void {
    this.#persistPrefs = persist
  }

  /** Bind product configuration and Advanced forms; unbinding cancels and drains its active form. */
  bindPluginSettings(binding: PluginSettingsBinding): () => Promise<void> {
    if (this.#pluginSettings !== undefined) throw new Error('omdsh-tui: Plugin settings are already bound')
    this.#pluginSettings = binding
    return async () => {
      if (this.#pluginSettings !== binding) return
      this.#pluginSettings = undefined
      this.#pluginSettingsAbort?.abort()
      await this.#pluginSettingsTask
      this.#rebuildSettings([])
      if (this.#tty && !this.#disposed) this.#render()
    }
  }

  bindAgentBehaviorSettings(binding: TuiAgentBehaviorSettingsBinding): () => void {
    if (this.#updateAgentBehavior !== undefined) {
      throw new Error('omdsh-tui: Agent behavior settings are already bound')
    }
    let active = true
    this.#updateAgentBehavior = next => binding.update(next)
    this.#applyStoredAgentBehavior(binding.get())
    this.#offAgentBehaviorWatch = binding.watch(next => { this.#applyStoredAgentBehavior(next) })
    return () => {
      if (!active) return
      active = false
      this.#offAgentBehaviorWatch?.()
      this.#offAgentBehaviorWatch = undefined
      this.#updateAgentBehavior = undefined
      this.#agentBehavior = undefined
      this.#agentBehaviorPending = false
      this.#rebuildSettings(this.#pluginSettings?.entries() ?? [])
      if (this.#tty && !this.#disposed) this.#render()
    }
  }

  readInput(signal?: AbortSignal): Promise<TuiSubmission | null> {
    if (this.#pending !== null) return Promise.reject(new Error('omdsh-tui: input read already in flight'))
    if (this.#disposed || signal?.aborted === true) return Promise.resolve(null)
    // A Ctrl-D pressed while the previous turn was still settling lands here
    // (no pending readline existed to resolve); honor it now.
    if (this.#quitRequested) {
      this.#quitRequested = false
      return Promise.resolve(null)
    }
    if (!this.#tty) return this.#plain.readline(signal)
    // Lines submitted while a turn was still running were queued instead of
    // dropped; serve the oldest before waiting for fresh input.
    const queued = this.#queuedSubmissions.shift()
    if (queued !== undefined) {
      this.#render()
      return Promise.resolve(queued)
    }
    return new Promise((resolve) => {
      const pending: PendingRead = { resolve, signal: signal ?? null }
      this.#pending = pending
      if (signal !== undefined) {
        const onAbort = (): void => {
          if (this.#pending !== pending) return
          this.#pending = null
          resolve(null)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        pending.offAbort = () => { signal.removeEventListener('abort', onAbort) }
      }
    })
  }

  /** Compatibility helper for provider-level text editing tests and embedders. */
  async readline(): Promise<string | null> {
    return (await this.readInput())?.text ?? null
  }

  restoreInput(submission: TuiSubmission): void {
    this.#literalInput ||= submission.literal === true
    this.#images.restore(submission)
    for (const file of submission.files ?? []) this.#files.add(file)
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  resolveQueueEdit(submission: TuiSubmission | null): void {
    if (!this.#queueEditPending) return
    this.#queueEditPending = false
    if (submission === null) {
      if (this.#editor.text === '' && this.#images.count === 0 && this.#queueEditNewer?.length === 0) {
        this.#queueEditNewer = null
      }
      return
    }
    if (this.#queueEditNewer === null) this.#queueEditNewer = []
    if (this.#editor.text !== '' || this.#images.count > 0) {
      this.#queueEditNewer.unshift(this.#currentSubmission())
    }
    this.#replaceInput(submission)
  }

  #currentSubmission(): TuiSubmission {
    const files = this.#files.copies()
    return {
      text: this.#files.text(this.#editor.expandedText),
      ...(this.#literalInput || this.#editor.startsWithPaste ? { literal: true } : {}),
      images: this.#images.copies(),
      ...(files.length === 0 ? {} : { files }),
    }
  }

  #replaceInput(submission: TuiSubmission): void {
    this.#literalInput = submission.literal === true
    this.#images.replace(submission)
    this.#files.restore(submission.files)
    this.#historyIndex = 0
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  onInterrupt(listener: () => void): () => void {
    this.#interrupts.add(listener)
    return () => { this.#interrupts.delete(listener) }
  }

  readonly pendingInputs: TuiPendingInputs = {
    list: () => {
      if (this.#disposed) return []
      if (this.#queueEditNewer !== null || this.#queueEditPending) throw new Error('Finish editing the queued follow-up with Enter before opening Queue.')
      return this.#queuedSubmissions.map(submission => {
        let id = this.#queuedInputIds.get(submission)
        if (id === undefined) { id = `local-${++this.#queuedInputSerial}`; this.#queuedInputIds.set(submission, id) }
        return { id, submission }
      })
    },
    update: (id, change) => {
      if (this.#disposed) return false
      const index = this.#queuedSubmissions.findIndex(item => this.#queuedInputIds.get(item) === id)
      if (index < 0) return false
      if (change.kind === 'remove') this.#queuedSubmissions.splice(index, 1)
      else if (change.kind === 'replace') {
        this.#queuedInputIds.set(change.submission, id)
        this.#queuedSubmissions[index] = change.submission
      } else {
        const destination = index + change.direction
        if (destination < 0 || destination >= this.#queuedSubmissions.length) return false
        const other = this.#queuedSubmissions[destination]!
        this.#queuedSubmissions[destination] = this.#queuedSubmissions[index]!
        this.#queuedSubmissions[index] = other
      }
      if (this.#tty && !this.#disposed) this.#render()
      return true
    },
  }

  setQueueHandler(handler: (signal: AbortSignal) => Promise<void>): () => void {
    this.#queueHandler = handler
    return () => { if (this.#queueHandler === handler) { this.#queueHotkeyAbort?.abort(); this.#queueHandler = undefined } }
  }

  onQueueEdit(listener: () => void): () => void {
    this.#queueEdits.add(listener)
    return () => { this.#queueEdits.delete(listener) }
  }

  onRewind(listener: () => void): () => void {
    this.#rewinds.add(listener)
    return () => { this.#rewinds.delete(listener) }
  }

  onInspectSubagent(listener: (id: string) => void): () => void {
    this.#inspects.add(listener)
    return () => { this.#inspects.delete(listener) }
  }

  onInspectClose(listener: () => void): () => void {
    this.#inspectCloses.add(listener)
    return () => { this.#inspectCloses.delete(listener) }
  }

  onInspectSubmit(listener: (submission: TuiSubmission) => void): () => void {
    this.#inspectSubmits.add(listener)
    return () => { this.#inspectSubmits.delete(listener) }
  }

  setSteerHandler(handler: (text: string) => void): () => void {
    this.#steerHandler = handler
    return () => { if (this.#steerHandler === handler) this.#steerHandler = undefined }
  }

  /**
   * Last-resort restore for a process that exits without disposing: leave the
   * alternate screen, give every mode back and show the cursor. Writes to a TTY
   * are synchronous, so this completes before the process ends.
   */
  #restoreTerminalOnExit(): void {
    if (this.#disposed || !this.#tty) return
    try { this.#renderer.finish() } catch { /* best effort while exiting */ }
    this.#session.release()
    this.#term.output.write('\x1b[?25h')
  }

  dispose(): Promise<void> {
    if (this.#disposed) return this.#disposeTask ?? this.#herdr.release()
    this.#flushPasteBurst(true)
    this.#flushDraft()
    this.#disposed = true
    this.#steerHandler = undefined
    this.#imagePreviewAbort?.abort()
    this.#fileReviewAbort?.abort()
    this.#asideAbort?.abort()
    for (const directory of this.#imageTemporary) { try { rmSync(directory, { recursive: true, force: true }) } catch { /* OS may still hold the opened file. */ } }
    this.#imageTemporary.clear()
    this.#queueHotkeyAbort?.abort()
    this.#queueHandler = undefined
    if (this.#notificationTimer !== undefined) clearTimeout(this.#notificationTimer)
    this.#notificationQueue.clear()
    if (this.#pasteBurstTimer !== undefined) clearTimeout(this.#pasteBurstTimer)
    this.#pasteBurst.clear()
    this.#pluginSettingsAbort?.abort()
    if (this.#resizeTimer !== null) {
      clearTimeout(this.#resizeTimer)
      this.#resizeTimer = null
    }
    if (this.#streamRenderTimer !== null) {
      clearTimeout(this.#streamRenderTimer)
      this.#streamRenderTimer = null
    }
    if (this.#tick !== null) {
      clearInterval(this.#tick)
      this.#tick = null
    }
    this.#stopRevealTick()
    if (this.#loopTick !== null) {
      clearInterval(this.#loopTick)
      this.#loopTick = null
    }
    if (this.#tty) {
      this.#offData?.()
      this.#offResize?.()
      this.#offResume?.()
      this.#setMouseTracking(false)
      this.#term.input.setRawMode?.(false)
      // Leave the cursor on a fresh line below the last frame so the shell
      // prompt does not overwrite the transcript. Disable bracketed paste
      // and restore the cursor.
      this.#renderer.finish()
      // Clear the session title we owned so the shell's own title returns.
      if (this.#writtenWindowTitle !== undefined && this.#writtenWindowTitle !== '') {
        this.#term.output.write('\x1b]2;\x07')
        this.#writtenWindowTitle = undefined
      }
      if (this.#writtenProgramState !== undefined) this.#term.output.write(programStatusSequence('clear'))
      this.#writtenProgramState = undefined
      this.#offExit?.()
      this.#offExit = undefined
      this.#session.dispose()
      this.#term.output.write('\x1b[?25h\r\n')
      if (this.#resumeHintRequested && this.#sessionId !== undefined) {
        this.#term.output.write(`\r\nResume this session with ${APP_NAME} --resume ${this.#sessionId}\r\n`)
      }
      // A tty stdin keeps the event loop alive after the tree disposes;
      // release the descriptor so natural completion can exit the process.
      this.#term.input.destroy?.()
    }
    if (this.#escapeTimer !== null) clearTimeout(this.#escapeTimer)
    if (this.#transientTimer !== null) { clearTimeout(this.#transientTimer); this.#transientTimer = null }
    if (this.#autocompleteTimer !== null) clearTimeout(this.#autocompleteTimer)
    this.#autocompleteAbort?.abort()
    this.#autocompleteTimer = null
    this.#autocompleteAbort = null
    this.#plain.dispose()
    this.#offAgentBehaviorWatch?.()
    this.#offAgentBehaviorWatch = undefined
    this.#settlePending(null)
    this.#finishPrompt(null)
    this.#disposeTask = Promise.all([this.#herdr.release(), this.#prefsSaveTask]).then(() => {})
    return this.#disposeTask
  }

  /** Settle one pending read, detaching its abort listener. */
  #settlePending(submission: TuiSubmission | null): void {
    const pending = this.#pending
    if (pending === null) return
    pending.offAbort?.()
    this.#pending = null
    pending.resolve(submission)
  }

  /** Re-render the current frame (resize reflow). */
  refresh(): void {
    this.#render()
  }

  #busy(): boolean {
    if (this.#state.status !== 'idle') return true
    if (this.#state.blocks.some((block) => block.kind === 'tool' && block.status === 'running')) return true
    return this.#subagents?.agents.some(agent => agent.phase === 'running' || agent.phase === 'starting') === true
  }

  /** Countdown shown on the working row while a retry or a compaction is pending. */
  #workingLabel(): string | undefined {
    if (this.#retryDeadline !== undefined) {
      return `Retrying in ${Math.max(0, Math.ceil((this.#retryDeadline - Date.now()) / 1000))}s`
    }
    if (this.#state.status === 'compacting' && this.#compactionStartedAt !== undefined) {
      return `Compacting ${Math.max(0, Math.floor((Date.now() - this.#compactionStartedAt) / 1000))}s`
    }
    return undefined
  }

  /** The newest image the transcript carries, whichever side produced it. */
  #latestImageRef(): ImageAttachmentRef | undefined {
    for (let index = this.#state.blocks.length - 1; index >= 0; index -= 1) {
      const block = this.#state.blocks[index]!
      const image = block.kind === 'tool' || block.kind === 'user' ? block.image : undefined
      if (image !== undefined) return image
    }
    return undefined
  }

  #syncTick(): void {
    if (!this.#tty) return
    const busy = this.#busy()
    if (busy && this.#motion !== 'off') {
      if (this.#tick === null) {
        this.#tick = setInterval(() => {
          this.#spinner += 1
          this.#render()
        }, 80)
      }
    } else if (this.#tick !== null) {
      clearInterval(this.#tick)
      this.#tick = null
    }
  }

  #syncStreamingReveal(delta: StreamDelta | undefined): boolean {
    const textualDelta = delta !== undefined
      && (delta.chunk.type === 'text-delta' || delta.chunk.type === 'reasoning-delta')
    const key = streamingAssistantKey(this.#state)
    if (!textualDelta || this.#motion === 'off' || key === undefined) {
      this.#stopRevealTick()
      this.#reveal = undefined
      return false
    }
    if (this.#reveal?.key !== key) this.#reveal = { key, revealed: 0 }
    this.#startRevealTick()
    return true
  }

  #startRevealTick(): void {
    if (!this.#tty || this.#revealTick !== null) return
    this.#revealTick = setInterval(() => {
      const reveal = this.#reveal
      if (reveal === undefined || streamingAssistantKey(this.#state) !== reveal.key) {
        this.#stopRevealTick()
        this.#reveal = undefined
        return
      }
      const total = streamingAssistantUnits(this.#state)
      const backlog = Math.max(0, total - reveal.revealed)
      if (backlog === 0) {
        this.#stopRevealTick()
        return
      }
      reveal.revealed = Math.min(total, reveal.revealed + nextRevealStep(backlog))
      this.#render()
      if (reveal.revealed >= total) this.#stopRevealTick()
    }, STREAMING_REVEAL_MS)
    this.#revealTick.unref?.()
  }

  #stopRevealTick(): void {
    if (this.#revealTick === null) return
    clearInterval(this.#revealTick)
    this.#revealTick = null
  }

  #syncLoopTick(): void {
    if (!this.#tty) return
    const countdown = this.#loopStatus?.phase === 'running' && this.#loopStatus.deadline !== undefined
    if (countdown && this.#loopTick === null) {
      this.#loopTick = setInterval(() => { this.#render() }, 1_000)
      this.#loopTick.unref?.()
    } else if (!countdown && this.#loopTick !== null) {
      clearInterval(this.#loopTick)
      this.#loopTick = null
    }
  }

  #captureDraft(): ComposerDraft {
    if (this.#historyIndex > 0 && this.#historyDraft !== undefined) return this.#historyDraft
    const editor = this.#prompt?.savedInput ?? this.#editor.snapshot()
    return { editor, images: this.#images.copies(), files: this.#files.snapshot(editor.text), literal: this.#literalInput }
  }

  #restoreDraft(draft: ComposerDraft): void {
    this.#images.replace({ text: draft.editor.text, images: draft.images })
    this.#editor.restore(draft.editor)
    this.#files.restoreSnapshot(draft.files)
    this.#literalInput = draft.literal
  }

  #draftKey(): string {
    return [this.#editor.revision, this.#editor.cursor, this.#images.revision, this.#files.revision, this.#literalInput].join(':')
  }

  #watchDraft(): void {
    if (this.#disposed || this.#draftStore === undefined || this.#draftScope === undefined || this.#prompt !== null || this.#historyIndex > 0) return
    const key = this.#draftKey()
    if (key === this.#draftFingerprint) return
    this.#draftFingerprint = key
    this.#draftDirty = true
    if (this.#draftTimer !== undefined) clearTimeout(this.#draftTimer)
    this.#draftTimer = setTimeout(() => { this.#draftTimer = undefined; this.#flushDraft() }, 500)
    this.#draftTimer.unref?.()
  }

  #flushDraft(): void {
    this.#watchDraft()
    if (this.#draftTimer !== undefined) clearTimeout(this.#draftTimer)
    this.#draftTimer = undefined
    const id = this.#draftScope
    if (id === undefined || this.#draftStore === undefined || !this.#draftDirty && !this.#unsavedDrafts.has(id)) return
    const draft = this.#captureDraft()
    this.#draftDirty = false
    try {
      this.#draftStore.save(id, draft)
      this.#unsavedDrafts.delete(id)
      this.#draftError = false
    } catch (error) {
      this.#unsavedDrafts.set(id, draft)
      this.#reportDraftError('save', error)
    }
  }

  #reportDraftError(action: 'save' | 'restore', error: unknown): void {
    if (this.#draftError) return
    this.#draftError = true
    this.notice(`Could not ${action} composer draft: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' })
  }

  #clearDraft(): void {
    this.#historyDraft = undefined
    if (this.#draftStore === undefined || this.#draftScope === undefined) return
    // A sent or explicitly discarded input must not return after a quick exit.
    this.#draftFingerprint = this.#draftKey()
    this.#draftDirty = true
    this.#flushDraft()
  }

  #switchDraft(id: string | undefined): void {
    if (this.#draftStore === undefined || id === this.#draftScope) return
    this.#flushPasteBurst(true)
    this.#finishPrompt(null)
    this.#flushDraft()
    const initialInput = this.#draftScope === undefined && this.#editor.text !== '' ? this.#captureDraft() : undefined
    this.#draftScope = id
    this.#historyIndex = 0
    this.#historyDraft = undefined
    this.#draft = ''
    this.#draftDirty = false
    this.#draftError = false
    this.#search = null
    this.#ac = null
    this.#restoreDraft({ editor: { text: '', cursor: 0, pastes: [] }, images: [], files: { entries: [], next: 0 }, literal: false })
    let restoreError: unknown
    if (id !== undefined) {
      try {
        const draft = this.#unsavedDrafts.get(id) ?? this.#draftStore.load(id)
        if (draft !== undefined) this.#restoreDraft(draft)
      } catch (error) { restoreError = error }
    }
    if (initialInput !== undefined) this.#restoreDraft(initialInput)
    this.#draftFingerprint = initialInput === undefined ? this.#draftKey() : ''
    this.#refreshAutocomplete()
    if (restoreError !== undefined) this.#reportDraftError('restore', restoreError)
  }

  #render(): void {
    this.#watchDraft()
    if (this.#streamRenderTimer !== null) {
      clearTimeout(this.#streamRenderTimer)
      this.#streamRenderTimer = null
    }
    if (this.#deferInitialRender) return
    // Rows committed to scrollback are immutable; the first real paint waits for the probe so it already uses the reported colors.
    if (this.#probeGate) return
    const width = this.#term.width()
    const renderState = this.#reveal === undefined
      ? this.#state
      : revealStreamingAssistant(this.#state, this.#reveal.revealed)
    const workingLabel = this.#workingLabel()
    const frame = this.#tty
      ? renderView(renderState, {
        width,
        ...(this.#imageProtocol === undefined ? {} : { imageProtocol: this.#imageProtocol }),
        imageCellSize: this.#imageCellSize,
        mathMode: this.#mathMode,
        mermaidMode: this.#mermaidMode,
        hideThinking: this.#hideThinking,
        height: this.#term.height(),
        model: this.#model,
        ...(this.#reasoningEffort === undefined ? {} : { reasoningEffort: this.#reasoningEffort }),
        input: this.#editor.text,
        inputCursor: this.#editor.cursor,
        inputImages: this.#images.count,
        queuedSubmissions: this.#queueEditNewer === null
          ? this.#queuedSubmissions
          : [...this.#queuedSubmissions, ...this.#queueEditNewer],
        colors: this.#colors,
        pwd: this.#pwd,
        ...(this.#branch !== undefined ? { branch: this.#branch } : {}),
        ...(this.#sessionTitle === undefined ? {} : { sessionTitle: this.#sessionTitle }),
        version: APP_VERSION,
        appName: APP_NAME,
        displayName: APP_DISPLAY_NAME,
        spinnerFrame: this.#spinner,
        motion: this.#motion,
        colorDepth: this.#colorDepth,
        themeName: this.#themeName,
        terminal: this.#terminalColors,
        ...(workingLabel === undefined ? {} : { workingLabel }),
        ...(this.#transientStatus === undefined ? {} : { transientStatus: this.#transientStatus }),
        scrollStart: this.#follow ? Number.POSITIVE_INFINITY : this.#scrollStart,
        ...(this.#focusBlock === undefined ? {} : { focusBlock: this.#focusBlock, focusBlockEdge: this.#focusBlockEdge ?? 'start' }),
        ...(this.#transcriptSearch === null ? {} : {
          transcriptSearch: {
            query: this.#transcriptSearch.query,
            focus: this.#transcriptSearch.focus,
            editing: this.#transcriptSearch.editing,
          },
        }),
        toolsExpanded: this.#toolsExpanded,
        expandedOutputs: this.#expandedOutputs,
        expandedTools: this.#detailedToolIds(),
        toolDetailsKey: keysForAction(this.#keybindings, 'toggle-tool-details'),
        turnDetailsKey: keysForAction(this.#keybindings, 'toggle-tools'),
        ...(this.#steerHandler === undefined ? {} : { steerKey: keysForAction(this.#keybindings, 'steer-turn') }),
        openedGroups: this.#openedGroups,
        commands: this.#commands(),
        recentSessions: this.#recentSessions,
        modelReady: this.#modelReady,
        ...(this.#sessionStats === undefined ? {} : { sessionStats: this.#sessionStats }),
        ...(this.#sessionControls === undefined ? {} : { sessionControls: this.#sessionControls }),
        ...(this.#loopStatus === undefined ? {} : { loopStatus: this.#loopStatus }),
        ...(this.#subagents === undefined ? {} : { subagents: this.#subagents }),
        subagentLauncherFocused: this.#subagentLauncherFocused,
        ...(this.#inspected === undefined ? {} : { inspected: this.#inspected }),
        ...(this.#trajectory === null ? {} : { trajectory: this.#trajectory }),
        ...(this.#aside === undefined ? {} : { aside: this.#aside }),
        ...(this.#agentHub === null ? {} : { agentHub: this.#agentHub }),
        statusBar: this.#statusBar,
        ...(this.#prompt === null ? {} : { promptSelector: this.#prompt }),
        ...(this.#settings !== null
          ? { settings: this.#settings }
          : this.#copySelector !== null
            ? { copySelector: this.#copySelector }
            : this.#search !== null
              ? { historySearch: this.#search }
              : this.#ac !== null ? { autocomplete: this.#ac } : {}),
      })
      : { lines: [] }
    this.#focusBlock = undefined
    this.#focusBlockEdge = undefined
    this.#promptDocument = frame.promptDocument
    if (this.#prompt !== null && this.#prompt.documentScroll !== Number.POSITIVE_INFINITY && frame.promptDocument?.position !== undefined) {
      this.#prompt = { ...this.#prompt, documentAnchor: frame.promptDocument.position }
    }
    this.#syncScroll(frame.transcript)
    this.#jumpToLatest = frame.jumpToLatest
    this.#fileActionFrame = frame.transcript === undefined || frame.transientSurface === 'overlay' ? undefined : frame
    this.#setMouseTracking(frame.transcript !== undefined && frame.transientSurface !== 'overlay'
      && (this.#inspecting || this.#maxStart > 0 || (frame.transcript.fileRegions?.length ?? 0) > 0))
    // A run opening or folding reshapes rows above the screen in place; the
    // renderer's frozen boundary is a row index and has to be told, or a fold
    // blanks the screen and a large one replays the transcript into history.
    const scroll = frame.transcript
    if (scroll?.foldShape !== undefined && scroll.foldMarks !== undefined) {
      if (this.#foldMarks !== undefined && scroll.foldShape !== this.#foldShape) {
        this.#renderer.reflow((scroll.bodyRow ?? 0) + firstReshapedRow(this.#foldMarks, scroll.foldMarks))
      }
      this.#foldShape = scroll.foldShape
      this.#foldMarks = scroll.foldMarks
    }
    this.#renderer.render(frame, rows => this.#selection.paint(rows))
  }

  #scheduleStreamRender(): void {
    if (this.#streamRenderTimer !== null) return
    this.#streamRenderTimer = setTimeout(() => {
      this.#streamRenderTimer = null
      if (!this.#disposed) this.#render()
    }, this.#streamRenderMs)
  }

  #syncScroll(scroll: { start: number; maxStart: number; budget: number; blockStarts?: readonly number[]; bodyRow?: number } | undefined): void {
    if (scroll === undefined) {
      // Full-screen surfaces temporarily cover the transcript. They carry no
      // scroll projection and must not replace the reader's return position.
      return
    }
    this.#scrollStart = scroll.start
    this.#maxStart = scroll.maxStart
    this.#scrollBudget = scroll.budget
    this.#blockStarts = scroll.blockStarts?.map(row => row + (scroll.bodyRow ?? 0)) ?? []
    // An inspection stays a browsing frame even when everything fits: resuming
    // the follow would drop the openings the reader just asked for.
    if (!this.#inspecting && (this.#follow || this.#scrollStart >= this.#maxStart)) {
      this.#follow = true
      this.#scrollStart = this.#maxStart
    }
  }

  #pageSize(): number {
    return Math.max(1, this.#scrollBudget > 2 ? this.#scrollBudget - 2 : 1)
  }

  #scrollBy(delta: number): void {
    if (this.#follow && delta > 0) return
    if (delta === 0 && this.#maxStart === 0) return
    if (!this.#inspecting && delta > 0 && this.#scrollStart + delta >= this.#maxStart) {
      this.#followTail()
      this.#render()
      return
    }
    // Scrolling past the end of an inspection is how a reader goes back to
    // the live tail, the same as scrolling to the end of history does.
    if (this.#inspecting && delta > 0 && this.#scrollStart >= this.#maxStart) {
      this.#followTail()
      this.#render()
      return
    }
    this.#follow = false
    this.#scrollStart += delta
    if (this.#scrollStart <= 0) this.#scrollStart = 0
    this.#render()
  }

  #followTail(): void {
    this.#follow = true
    this.#scrollStart = this.#maxStart
    this.#endInspection()
  }

  /** Close every opening the reader made; they belong to one inspection. */
  #endInspection(): void {
    if (!this.#inspecting) return
    this.#inspecting = false
    this.#toolsExpanded = false
    this.#openedGroups.clear()
    this.#detailedTurns.clear()
  }

  /** Capture transcript navigation; overlays and disposal restore terminal ownership. */
  #setMouseTracking(enabled: boolean): void {
    enabled = enabled && this.#mouseInteraction !== 'native'
      && (this.#mouseInteraction === 'tui' || this.#tmuxMouseEnabled !== false)
    if (!enabled) { this.#selection.clear(); this.#jumpPress = undefined }
    if (!this.#tty || enabled === this.#mouseTracking) return
    this.#mouseTracking = enabled
    this.#session.setMode('mouse', MOUSE_TRACKING, enabled)
  }

  /** Give every terminal mode back before the terminal is lent out (Ctrl+Z, external editor). */
  #handOffTerminal(): void {
    this.#setMouseTracking(false)
    this.#session.handOff()
  }

  /** Run `run` with the terminal handed off; take it back and repaint afterwards. */
  #handTerminal<T>(run: () => T): T {
    this.#handOffTerminal()
    this.#term.input.setRawMode?.(false)
    try {
      return run()
    } finally {
      if (!this.#disposed) {
        this.#term.input.setRawMode?.(true)
        this.#session.takeBack()
        this.#renderer.reset()
      }
    }
  }

  /**
   * After a Ctrl+O toggle: read what is open in a browsing frame at `target`,
   * or go back to the live tail once nothing is open any more.
   */
  #inspect(target: number | undefined): void {
    const open = this.#toolsExpanded || this.#openedGroups.size > 0
    if (!open) {
      this.#inspecting = false
      this.#followTail()
      return
    }
    if (this.#inspecting) return
    this.#inspecting = true
    this.#follow = false
    // Opening from the tail with nothing in particular under the viewport
    // keeps the reader at the end of the transcript, now in a browsing frame.
    if (target === undefined) this.#scrollStart = Number.MAX_SAFE_INTEGER
    else {
      this.#focusBlock = target
      this.#focusBlockEdge = 'end'
    }
  }

  readonly #utf8 = new StringDecoder('utf8')
  #onData(chunk: Buffer): void {
    // Decode bytes across the whole stream so a multi-byte UTF-8 character
    // split between data events is never corrupted into replacement chars.
    const text = this.#utf8.write(chunk)
    const { events, rest } = parseKeys(this.#pendingKeys + text)
    this.#pendingKeys = rest
    if (this.#escapeTimer !== null) {
      clearTimeout(this.#escapeTimer)
      this.#escapeTimer = null
    }
    this.#routeInputBatch(events)
    if (rest === '\x1b') {
      this.#escapeTimer = setTimeout(() => {
        this.#pendingKeys = ''
        this.#escapeTimer = null
        for (const event of flushPending(rest)) this.#routeInput(event)
      }, 80)
    } else if (rest.length > 32 && !rest.startsWith('\x1b]')) {
      this.#pendingKeys = ''
    }
  }

  #routeInputBatch(events: readonly KeyEvent[]): void {
    if (this.#pasteProtection && this.#state.status !== 'compacting' && !this.#paste && this.#pasteInFlight === 0
      && this.#prompt === null && this.#settings === null && this.#copySelector === null
      && this.#search === null && this.#trajectory === null && this.#agentHub === null && this.#transcriptSearch === null
      && events.every(event => event.type === 'text' || (event.type === 'key' && ['enter', 'ctrl+j', 'tab'].includes(event.id)))) {
      if (this.#pasteBurstTimer !== undefined) clearTimeout(this.#pasteBurstTimer)
      for (const event of this.#pasteBurst.pushBatch(events, Date.now())) this.#deliverPasteEmission(event)
      this.#armPasteBurst()
    } else for (const event of events) this.#routeInput(event)
  }

  #armPasteBurst(): void {
    this.#pasteBurstTimer = undefined
    if (this.#pasteBurst.pending) {
      this.#pasteBurstTimer = setTimeout(() => { this.#pasteBurstTimer = undefined; this.#flushPasteBurst(true) }, this.#pasteBurst.delay)
    }
  }

  #routeInput(event: KeyEvent): void {
    if (event.type === 'focus' || event.type === 'cell-size') { this.#dispatch(event); return }
    const composer = this.#state.status !== 'compacting' && this.#prompt === null && this.#settings === null && this.#copySelector === null
      && this.#search === null && this.#trajectory === null && this.#agentHub === null && this.#transcriptSearch === null
    if (this.#paste || this.#pasteInFlight > 0 || !this.#pasteProtection || !composer
      || event.type === 'paste-start' || event.type === 'paste-end') {
      this.#flushPasteBurst(true)
      this.#pasteBurst.clear()
      this.#dispatch(event)
      return
    }
    if (this.#pasteBurstTimer !== undefined) clearTimeout(this.#pasteBurstTimer)
    this.#pasteBurstTimer = undefined
    for (const emission of this.#pasteBurst.push(event, Date.now())) this.#deliverPasteEmission(emission)
    this.#armPasteBurst()
  }

  #deliverPasteEmission(event: PasteEmission): void {
    if (event.type === 'paste') {
      this.#literalInput ||= this.#editor.cursor === 0 && event.value.startsWith('!')
      this.#editor.paste(event.value.replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
      this.#refreshAutocomplete()
      this.#render()
    }
    else this.#dispatch(event)
  }

  #flushPasteBurst(force = false): void {
    if (this.#pasteBurstTimer !== undefined) clearTimeout(this.#pasteBurstTimer)
    this.#pasteBurstTimer = undefined
    for (const event of this.#pasteBurst.flush(Date.now(), force)) this.#deliverPasteEmission(event)
  }

  #startAsyncPaste(operation: Promise<void>): void {
    this.#pasteInFlight += 1
    void operation.catch((error: unknown) => {
      this.notice('Paste failed: ' + (error instanceof Error ? error.message : String(error)), { level: 'error' })
    }).finally(() => {
      this.#pasteInFlight = Math.max(0, this.#pasteInFlight - 1)
      if (this.#pasteInFlight !== 0 || this.#deferredPasteEvents.length === 0) return
      const deferred = this.#deferredPasteEvents.splice(0)
      for (let index = 0; index < deferred.length; index += 1) {
        this.#dispatch(deferred[index] as KeyEvent)
        if (this.#pasteInFlight === 0) continue
        this.#deferredPasteEvents.unshift(...deferred.slice(index + 1))
        break
      }
    })
  }

  async #acceptPastedText(text: string): Promise<void> {
    if (this.#prompt !== null) {
      const prompt = this.#prompt
      if (prompt.documentInput !== undefined) {
        this.#handleDocumentReader({ type: 'text', value: text }, prompt)
        return
      }
      if (prompt.request.wait !== undefined && prompt.waitHeld !== true) {
        prompt.request.wait.hold()
        prompt.offTick?.()
        this.#prompt = { ...prompt, waitHeld: true }
      }
      this.#editor.handle({ type: 'text', value: text })
      this.#render()
      return
    }
    if (this.#settings !== null || this.#copySelector !== null) return
    if (this.#search !== null) {
      this.#applySearch({ type: 'text', value: text })
      return
    }
    const paths = imagePathCandidates(text)
    if (paths.length > 0) {
      const images = await Promise.all(paths.map(path => this.#readImagePath(path)))
      if (images.every((image): image is TuiInputImage => image !== null)) {
        let inserted = false
        for (const image of images) {
          if (await this.#images.admit(image)) {
            this.#images.insert(image)
            inserted = true
          }
        }
        if (inserted) {
          this.#refreshAutocomplete()
          this.#render()
        }
        return
      }
      // Screenshot tools sometimes paste a transient cache path and remove
      // it before Node reads it. OMP falls back to the still-live clipboard
      // image instead of leaking that stale path into the prompt.
      const clipboardImage = await this.#readClipboardImage()
      if (clipboardImage !== null) {
        this.#images.insert(clipboardImage)
        this.#refreshAutocomplete()
        this.#render()
        return
      }
    }
    this.#literalInput ||= this.#editor.cursor === 0 && text.startsWith('!')
    this.#editor.paste(text)
    this.#refreshAutocomplete()
    this.#render()
  }

  async #pasteClipboard(): Promise<void> {
    if (this.#search === null && this.#settings === null && this.#copySelector === null) {
      const image = await this.#readClipboardImage()
      if (image !== null) {
        if (await this.#images.admit(image)) {
          this.#images.insert(image)
          this.#refreshAutocomplete()
          this.#render()
        }
        return
      }
      const files = await this.#readClipboardFiles()
      const imagePaths = files.filter(path => imagePathCandidates(path).length === 1)
      if (imagePaths.length > 0) {
        const images = (await Promise.all(imagePaths.map(path => this.#readImagePath(path))))
          .filter((candidate): candidate is TuiInputImage => candidate !== null)
        if (images.length > 0) {
          let inserted = false
          for (const candidate of images) {
            if (await this.#images.admit(candidate)) {
              this.#images.insert(candidate)
              inserted = true
            }
          }
          if (inserted) {
            this.#refreshAutocomplete()
            this.#render()
          }
          return
        }
      }
    }
    const text = await this.#readClipboard()
    if (text !== '') await this.#acceptPastedText(text)
  }

  /** Resolve one bounded tmux probe without overwriting an explicit preference. */
  setTmuxMouseEnabled(enabled: boolean | undefined): void {
    if (this.#disposed) return
    this.#tmuxMouseEnabled = enabled
    if (this.#tty) this.#render()
  }

  #handleMouse(event: Extract<KeyEvent, { type: 'mouse' }>): void {
    if (!this.#mouseTracking || this.#paste || this.#pasteInFlight > 0) return
    const inside = (target: { row: number; column: number; width: number }): boolean =>
      event.row === target.row && event.column >= target.column && event.column < target.column + target.width
    if (event.button === 'right') {
      if (event.action === 'press') {
        if (this.#selection.active) void this.#copySelection()
        else {
          const document = this.#renderer.documentRowAt(event.row)
          const frame = this.#fileActionFrame
          const source = frame?.documentRows
          const region = document === undefined ? undefined : frame?.transcript?.fileRegions?.find(region => document >= region.start && document < region.end)
          const expected = document === undefined || source === undefined || source === null ? undefined
            : frame?.lines[source.frameStart + document - source.documentStart]
          const actual = this.#renderer.viewport()[event.row]
          // Native-history snapshots may differ from the current document. Do
          // not reinterpret their old text as another file after a reflow.
          if (region !== undefined && expected !== undefined && actual !== undefined && stripAnsi(sanitizeDisplayLine(expected)).trimEnd() === stripAnsi(actual).trimEnd()) {
            const block = this.#state.blocks[region.block]
            const action = block === undefined ? undefined : blockFileAction(block)
            if (action !== undefined) this.#openFileAction(action, region.file)
          }
        }
      }
      return
    }
    if (event.action === 'press') {
      const target = this.#jumpToLatest
      this.#jumpPress = target !== undefined && inside(target) ? target : undefined
      if (this.#jumpPress !== undefined) this.#selection.clear()
      else this.#selection.begin(this.#renderer.viewport(), event, Date.now(), event.shift)
    } else if (this.#jumpPress !== undefined) {
      const target = this.#jumpPress
      // A drag that starts on the floating button must not activate it on release.
      if (event.action === 'drag') this.#jumpPress = undefined
      else {
        this.#jumpPress = undefined
        if (inside(target)) this.#followTail()
      }
    } else if (event.action === 'drag') this.#selection.move(event)
    else {
      const text = this.#selection.release(event)
      if (text !== undefined && this.#copyOnSelect) void this.#copySelection()
    }
    this.#render()
  }

  /** Keep older clipboard operations from finishing after a newer user copy. */
  #deliverCopy(text: string): ReturnType<ClipboardWriter> {
    const task = this.#copyTask.then(() => {
      if (this.#disposed) throw new Error('terminal closed')
      return this.#copy(text)
    })
    this.#copyTask = task.catch(() => {})
    return task
  }

  async #copySelection(): Promise<void> {
    if (!this.#selection.valid(this.#renderer.viewport())) { this.#selection.clear(); return }
    const text = this.#selection.text()
    if (text === undefined) return
    try { await this.#deliverCopy(text) }
    catch {
      if (!this.#disposed) this.notice('Could not copy selection to the clipboard.', { level: 'error' })
    }
  }

  #openFileAction(action: FileAction, initial?: number): void {
    if (!this.#tty || this.#disposed || this.#prompt !== null || this.#fileReviewAbort !== undefined) return
    const abort = new AbortController()
    this.#fileReviewAbort = abort
    this.#selection.clear()
    const surface = {
      prompt: (request: TuiPrompt) => this.prompt({ ...request, onSuperseded: () => { abort.abort() } }),
      notice: (text: string, options: TuiNoticeOptions) => { this.notice(text, options) },
      openFileInEditor: (path: string) => { this.openFileInEditor(path) },
      insertText: (text: string) => { this.insertText(text) },
    }
    void reviewFiles(surface, action.title, action.cwd, action.files,
      index => fileDocument(action.files[index]!.path, abort.signal), abort.signal,
      initial ?? (action.files.length === 1 ? 0 : undefined), false)
      .catch(error => { if (!abort.signal.aborted && !this.#disposed) this.notice(`Could not preview file: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' }) })
      .finally(() => { if (this.#fileReviewAbort === abort) this.#fileReviewAbort = undefined })
  }

  #dispatch(event: KeyEvent): void {
    // Any input makes the last confirmation stale; a note that survives typing
    // starts competing with the command the reader is writing.
    if (event.type === 'key' || event.type === 'text') this.#clearTransientStatus()
    if (event.type === 'cell-size') {
      this.#imageCellSize = { width: event.width, height: event.height }
      if (this.#prompt?.request.documentImage !== undefined) this.#render()
      return
    }
    if (event.type === 'program-status-support') { this.#programSupported = true; this.#syncWindowTitle(); return }
    if (this.#session.handle(event)) return
    if (event.type === 'focus') {
      this.#terminalFocused = event.focused
      if (event.focused && this.#notificationPolicy === 'unfocused') this.#notificationQueue.clear()
      return
    }
    if (event.type === 'mouse') {
      this.#handleMouse(event)
      return
    }
    this.#jumpPress = undefined
    if (this.#selection.active) {
      if (event.type === 'key' && (['super+c', 'enter'].includes(event.id) || this.#boundAction(event.id) === 'copy-prompt')) {
        void this.#copySelection()
        return
      }
      this.#selection.clear()
      this.#render()
      if (event.type === 'key' && event.id === 'escape') {
        this.#lastEscapeTime = 0
        return
      }
    }
    if (event.type === 'wheel') {
      this.#jumpPress = undefined
      if (this.#mouseTracking && !this.#paste && this.#pasteInFlight === 0) {
        const step = wheelStep(this.#wheelGesture, Date.now(), event.direction === 'up' ? -1 : 1, !this.#wheelAccelerates)
        this.#wheelGesture = step.gesture
        if (step.lines !== 0) this.#scrollBy(step.lines)
      }
      return
    }
    if (this.#state.status === 'compacting') {
      if (event.type === 'key' && event.id === 'end' && this.#jumpToLatest !== undefined) {
        this.#followTail()
        this.#render()
        return
      }
      if (event.type === 'key' && event.id === 'pageUp') {
        this.#scrollBy(-this.#pageSize())
        return
      }
      if (event.type === 'key' && event.id === 'pageDown') {
        this.#scrollBy(this.#pageSize())
        return
      }
      if (event.type !== 'key' || event.id !== 'ctrl+c') return
    }
    // Clipboard image inspection is asynchronous. Preserve the exact key
    // order so a fast Ctrl+V, Enter submits the finished image draft rather
    // than an empty prompt.
    if (this.#pasteInFlight > 0) {
      this.#deferredPasteEvents.push(event)
      return
    }
    if (this.#paste) {
      if (event.type === 'paste-end') {
        this.#paste = false
        const text = this.#pasteBuf.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
        this.#pasteBuf = ''
        if (text !== '') this.#startAsyncPaste(this.#acceptPastedText(text))
        return
      }
      if (event.type === 'text') this.#pasteBuf += event.value
      else if (event.type === 'key' && event.id === 'enter') this.#pasteBuf += '\r'
      else if (event.type === 'key' && event.id === 'ctrl+j') this.#pasteBuf += '\n'
      else if (event.type === 'key' && event.id === 'tab') this.#pasteBuf += '\t'
      return
    }
    if (event.type === 'paste-start') {
      this.#paste = true
      this.#pasteBuf = ''
      return
    }
    const isEscape = event.type === 'key' && event.id === 'escape'
    if (!isEscape) {
      this.#lastEscapeTime = 0
      this.#inspectEscapeFenceUntil = 0
    } else if (this.#inspected === undefined && Date.now() < this.#inspectEscapeFenceUntil) {
      return
    } else if (this.#inspected === undefined) {
      this.#inspectEscapeFenceUntil = 0
    }
    if (this.#handlePrompt(event)) return
    if (this.#trajectory !== null) {
      const { pageSize } = trajectoryListMetrics(this.#trajectory, this.#term.height())
      const { pageLines } = trajectoryDetailMetrics(this.#trajectory, this.#term.height())
      const command = applyTrajectoryEvent(this.#trajectory, event, { pageSize, detailPageLines: pageLines })
      if ('close' in command) this.#trajectory = null
      else this.#trajectory = command.state
      this.#render()
      return
    }
    if (this.#agentHub !== null) {
      const command = applyAgentHubEvent(this.#agentHub, event)
      if ('close' in command) this.#agentHub = null
      else if ('open' in command) {
        this.#agentHub = null
        this.#openInspect(command.open)
      } else this.#agentHub = command.state
      this.#render()
      return
    }
    if (this.#transcriptSearch !== null) {
      this.#applyTranscriptSearch(event)
      return
    }
    if (event.type === 'key' && event.id === 'end' && this.#jumpToLatest !== undefined
      && this.#settings === null && this.#copySelector === null && this.#search === null) {
      this.#followTail()
      this.#render()
      return
    }
    if (event.type === 'key') {
      const action = this.#boundAction(event.id)
      if (action !== undefined && this.#runAction(action)) return
    }
    if (this.#inspected !== undefined && this.#inspected.writable !== true && event.type === 'text'
      && this.#prompt === null && this.#settings === null && this.#copySelector === null && this.#search === null) {
      return
    }
    if (this.#settings !== null) {
      this.#applySettings(event)
      return
    }
    /**
     * The side pane is a companion, not a mode: it answers where the reader is
     * already working, so it must not take keys the composer is using. It reads
     * navigation only while the composer is empty and nothing else is offering a
     * choice — a draft, an autocomplete list, or historical recall all keep their
     * arrows, and Escape keeps closing whatever is actually on top.
     */
    if (this.#aside !== undefined && this.#asideOwnsKeys() && event.type === 'key'
      && (event.id === 'up' || event.id === 'down' || event.id === 'pageUp' || event.id === 'pageDown')) {
      const step = event.id === 'pageUp' || event.id === 'pageDown' ? 6 : 1
      const delta = event.id === 'up' || event.id === 'pageUp' ? -step : step
      this.#aside = { ...this.#aside, scroll: Math.max(0, this.#aside.scroll + delta) }
      this.#render()
      return
    }
    if (this.#aside !== undefined && event.type === 'key' && event.id === 'escape'
      && this.#editor.text === '' && this.#ac === null) {
      this.#closeAside()
      return
    }

    if (this.#copySelector !== null) {
      this.#applyCopySelector(event)
      return
    }
    if (this.#search !== null) {
      this.#applySearch(event)
      return
    }
    if (this.#handleAutocomplete(event)) {
      if (event.type === 'key' && event.id === 'escape') this.#lastEscapeTime = 0
      return
    }
    if (this.#handleSubagentLauncher(event)) return
    // Escape is the one key that gives back exactly one layer, so it is resolved
    // here — after the overlays and the autocomplete have had their turn — and
    // not with the other actions above.
    if (event.type === 'key' && this.#boundAction(event.id) === 'interrupt' && this.#runInterrupt()) return
    if (event.type === 'key' && (event.id === 'backspace' || event.id === 'delete')
      && this.#images.removeAtCursor(event.id)) {
      this.#refreshAutocomplete()
      this.#render()
      return
    }
    if (event.type === 'key' && (event.id === 'ctrl+-' || event.id === 'ctrl+_')
      && this.#clearedDraft !== undefined && this.#clearedDraft.revision === this.#editor.revision
      && !this.#hasComposerContent()) {
      const cleared = this.#clearedDraft.draft
      this.#clearedDraft = undefined
      this.#restoreDraft(cleared)
      this.#historyIndex = 0
      this.#refreshAutocomplete()
      this.#render()
      return
    }
    this.#applyCommand(this.#editor.handle(event))
  }

  /**
   * Resolve `interrupt` against whatever currently owns the screen.
   *
   * One action, one meaning — cancel what is happening — but the thing that is
   * happening depends on how deep the reader is. The order runs from the most
   * transient surface to the least, so Escape always gives back exactly one
   * layer instead of dropping the reader somewhere unrelated.
   */
  #runInterrupt(): boolean {
    if (this.#prompt !== null) {
      if (this.#prompt.request.presentation === 'progress' || this.#prompt.request.interrupt === undefined) {
        this.#finishPrompt(null)
        return true
      }
      const handled = this.#prompt.request.interrupt()
      this.#finishPrompt(null)
      if (handled !== true && this.#state.status !== 'idle') for (const listener of this.#interrupts) listener()
      return true
    }
    // Escaping a child transcript returns to the parent, and a writable child
    // with a draft clears it first — the same order the reader expects from
    // any other depth.
    if (this.#inspected !== undefined) {
      if (this.#inspected.writable === true && this.#hasComposerContent()) {
        this.#clearComposerWithUndo()
        return true
      }
      this.#closeInspect()
      return true
    }
    if (this.#state.status !== 'idle') {
      // Aborting a turn would strand whatever the user queued behind it. Pi
      // hands those drafts back first, so nothing typed during the turn is lost
      // to the abort that ends it.
      this.#restoreQueuedBeforeAbort()
      for (const listener of this.#interrupts) listener()
      return true
    }
    if (!this.#hasComposerContent()) {
      // Nothing to cancel and nothing typed: the second Escape opens the session
      // tree, which is where a reader goes when they want to leave this point.
      const now = Date.now()
      if (now - this.#lastEscapeTime < DOUBLE_ESCAPE_MS) {
        this.#lastEscapeTime = 0
        for (const listener of this.#rewinds) listener()
      } else {
        this.#lastEscapeTime = now
      }
      return true
    }
    // Something is typed: Escape is not a no-op, but it also has nothing to
    // cancel, so the editor keeps the keystroke.
    return false
  }

  /**
   * Empty the composer, or exit on a second press.
   *
   * Ctrl+C is a composer gesture everywhere else on a terminal; keeping
   * interrupt on Escape leaves this to do exactly one job.
   */
  #runClearComposer(): boolean {
    if (this.#prompt !== null) { this.#finishPrompt(null); this.#editor.setText(''); this.#render(); return true }
    // A running Shell line owns Ctrl+C before the composer does: the reader is
    // watching a command, and the key they press to stop it is the same one.
    if (this.#shellAbort !== undefined && !this.#hasComposerContent()) {
      this.#shellAbort()
      return true
    }
    if (this.#settings !== null) { this.#settings = null; this.#render(); return true }
    if (this.#copySelector !== null) { this.#copySelector = null; this.#render(); return true }
    if (this.#search !== null) { this.#search = null; this.#render(); return true }
    if (this.#transcriptSearch !== null) { this.#transcriptSearch = null; this.#render(); return true }
    const now = Date.now()
    if (now - this.#lastSigintTime < DOUBLE_CTRL_C_MS) {
      this.#lastSigintTime = 0
      this.#quit()
      return true
    }
    this.#lastSigintTime = now
    // A running turn keeps Ctrl+C as the familiar abort while the composer is
    // empty; Escape already covers it, and refusing the reflex would be worse.
    if (this.#state.status !== 'idle' && !this.#hasComposerContent()) {
      this.#restoreQueuedBeforeAbort()
      for (const listener of this.#interrupts) listener()
      return true
    }
    this.#clearComposerWithUndo()
    return true
  }

  /**
   * Hand durable follow-ups back to the composer before a turn is abandoned.
   *
   * The queued messages would otherwise be delivered to a turn that will never
   * produce the step they were aimed at, which silently loses them.
   */
  #restoreQueuedBeforeAbort(): void {
    if (!this.#state.nextTurnInbox.some(message => message.source.kind === 'user')) return
    if (this.#hasComposerContent()) return
    for (const listener of this.#queueEdits) listener()
  }

  #handlePrompt(event: KeyEvent): boolean {
    let prompt = this.#prompt
    if (prompt === null) return false
    const disarmed = prompt.armedUntil !== undefined && Date.now() < prompt.armedUntil
    if (event.type === 'key' && event.id === 'ctrl+c' && prompt.request.interrupt !== undefined) {
      this.#lastSigintTime = Date.now()
      const handled = prompt.request.interrupt()
      this.#finishPrompt(null)
      if (handled !== true && this.#state.status !== 'idle') for (const listener of this.#interrupts) listener()
      this.#render()
      return true
    }
    if (event.type === 'key' && event.id === 'ctrl+s' && prompt.request.skippable === true) {
      this.#editor.setText('')
      this.#finishPrompt('')
      this.#render()
      return true
    }
    if (prompt.request.presentation === 'progress') {
      if (event.type === 'key' && (event.id === 'escape' || event.id === 'ctrl+c')) {
        this.#finishPrompt(null)
        this.#render()
      }
      return true
    }
    const takeTime = event.type === 'key' && event.id === 'ctrl+t'
    const editing = event.type === 'text' || (event.type === 'key'
      && ['backspace', 'delete', 'up', 'down', 'tab', 'shift+tab'].includes(event.id))
    if (prompt.request.wait !== undefined && prompt.waitHeld !== true && (takeTime || editing)) {
      prompt.request.wait.hold()
      prompt.offTick?.()
      prompt = { ...prompt, waitHeld: true }
      this.#prompt = prompt
      this.#render()
    }
    if (takeTime && prompt.request.wait !== undefined) return true
    if (prompt.request.presentation === 'plan-review' || prompt.request.presentation === 'document') return this.#handlePlanReview(event, prompt)
    if (event.type === 'text' && this.#editor.text === '') {
      const action = prompt.request.actions?.find(item => item.key === event.value)
      const selected = filteredPromptOptions(prompt.request, '', prompt.collapsed)[prompt.selected]
      if (action !== undefined && (action.scope === 'list' || selected !== undefined)) {
        if (!disarmed) {
          this.#finishPrompt(action.valuePrefix + (action.scope === 'list' ? '' : selected!.value ?? selected!.label))
          this.#render()
        }
        return true
      }
    }
    if (event.type === 'text' && event.value === ' ' && prompt.request.multiSelect === true) {
      this.#prompt = togglePromptSelection(prompt, this.#editor.text) as PendingPrompt
      this.#render()
      return true
    }
    if (event.type === 'text' && prompt.request.filterable === true) {
      const command = this.#editor.handle(event)
      if (command.kind === 'changed') {
        this.#prompt = searchPromptSelection(prompt, this.#editor.text) as PendingPrompt
        this.#render()
      }
      return true
    }
    if (event.type === 'text' && prompt.request.allowCustom === false) return true
    if (event.type !== 'key') return false
    if (disarmed && (event.id === 'enter' || event.id === 'ctrl+j')) return true
    const filtered = filteredPromptOptions(prompt.request, this.#editor.text, prompt.collapsed)
    const count = filtered.length
    const keyAction = prompt.request.actions?.find(item => item.key.toLowerCase() === event.id.toLowerCase())
    if (keyAction !== undefined && (keyAction.scope === 'list'
      || prompt.request.presentation === 'fullscreen-tree'
      || prompt.request.presentation === 'fullscreen-list')) {
      if (!disarmed) {
        const selected = filtered[prompt.selected]
        if (keyAction.scope === 'list' || selected !== undefined) {
          this.#editor.setText('')
          this.#finishPrompt(keyAction.valuePrefix + (keyAction.scope === 'list' ? '' : selected!.value ?? selected!.label))
          this.#render()
        }
      }
      return true
    }
    if (event.id === 'escape' || event.id === 'ctrl+c') {
      if (event.id === 'escape' && prompt.request.presentation === 'fullscreen-tree' && this.#editor.text !== '') {
        const selected = filtered[prompt.selected]?.value
        this.#editor.setText('')
        this.#prompt = { ...prompt, collapsed: new Set(), selected: Math.max(0, filteredPromptOptions(prompt.request, '').findIndex(option => option.value === selected)), previewScroll: 0 }
        this.#render()
        return true
      }
      this.#finishPrompt(null)
      this.#render()
      return true
    }
    if (prompt.request.presentation === 'fullscreen-tree' && (event.id === 'left' || event.id === 'right')) {
      this.#prompt = movePromptTree(prompt, event.id, this.#editor.text) as PendingPrompt
      this.#render()
      return true
    }
    if (prompt.request.presentation === 'fullscreen-tree' && (event.id === 'ctrl+up' || event.id === 'ctrl+down')) {
      const start = this.#promptDocument?.start ?? prompt.previewScroll ?? 0
      this.#prompt = { ...prompt, previewScroll: Math.max(0, Math.min(start + (event.id === 'ctrl+up' ? -1 : 1), this.#promptDocument?.maxStart ?? 0)) }
      this.#render()
      return true
    }
    if (count === 0) {
      if (prompt.request.filterable !== true) return false
      if (event.id === 'enter') return true
      const command = this.#editor.handle(event)
      if (command.kind === 'changed') {
        this.#prompt = searchPromptSelection(prompt, this.#editor.text) as PendingPrompt
        this.#render()
      }
      return true
    }
    // Movement comes from the shared reading, so this selector cannot drift from
    // the other lists about what `tab` or `pageUp` means. `enter` stays below
    // because what it submits depends on the editor and on multi-select.
    const page = prompt.request.presentation === 'fullscreen-tree'
      ? promptTreePageSize(prompt.request, this.#term.width(), this.#term.height()) : 10
    const navigation = listNavigation(event)
    if (navigation.kind === 'move' || navigation.kind === 'page') {
      // The tree clamps: its rows are a structure, and wrapping past the last
      // branch lands the reader somewhere unrelated to the one they left.
      const wrap = prompt.request.presentation !== 'fullscreen-tree'
      this.#prompt = movePromptSelection(prompt, navigateIndex(navigation, prompt.selected, count, page, { wrap }), count) as PendingPrompt
      this.#render()
      return true
    }
    if (navigation.kind === 'edge') {
      this.#prompt = movePromptSelection(prompt, edgeIndex(navigation, count), count) as PendingPrompt
      this.#render()
      return true
    }
    if (event.id === 'enter' && (this.#editor.text === '' || prompt.request.multiSelect === true)) {
      const answer = selectedPromptAnswer(prompt)
      if (prompt.request.multiSelect === true && answer === null) return true
      this.#finishPrompt(answer)
      this.#render()
      return true
    }
    if (event.id === 'enter' && prompt.request.filterable === true) {
      const answer = selectedFilteredPromptAnswer(prompt, this.#editor.text)
      this.#editor.setText('')
      this.#finishPrompt(answer)
      this.#render()
      return true
    }
    if (prompt.request.filterable === true) {
      const command = this.#editor.handle(event)
      if (command.kind === 'changed') {
        this.#prompt = searchPromptSelection(prompt, this.#editor.text) as PendingPrompt
        this.#render()
      }
      return true
    }
    return false
  }

  #handlePlanReview(event: KeyEvent, prompt: PendingPrompt): boolean {
    const document = prompt.request.presentation === 'document'
    const disarmed = prompt.armedUntil !== undefined && Date.now() < prompt.armedUntil
    if (document && prompt.request.documentSource !== undefined && this.#handleDocumentReader(event, prompt)) return true
    if (document && prompt.request.documentSource === undefined && this.#handleRenderedDocument(event, prompt)) return true
    if (document && event.type === 'text') {
      const action = prompt.request.actions?.find(item => item.key.toLowerCase() === event.value.toLowerCase())
      if (action !== undefined && !disarmed) { this.#finishPrompt(action.valuePrefix); this.#render() }
      return true
    }
    if (!document && event.type === 'key' && (event.id === 'ctrl+x' || this.#boundAction(event.id) === 'external-editor')) {
      this.#openPlanFeedbackEditor(prompt)
      return true
    }
    if (prompt.feedback === true) {
      if (event.type === 'key' && event.id === 'ctrl+c') {
        this.#finishPrompt(null)
        this.#render()
        return true
      }
      if (event.type === 'key' && event.id === 'escape') {
        this.#editor.setText('')
        this.#prompt = { ...prompt, feedback: false }
        this.#render()
        return true
      }
      if (event.type === 'key' && (event.id === 'enter' || event.id === 'ctrl+j')) {
        if (disarmed) return true
        const feedback = this.#editor.text.trim()
        this.#editor.setText('')
        this.#finishPrompt(feedback === '' ? selectedPromptAnswer(prompt) : feedback)
        this.#render()
        return true
      }
      const command = this.#editor.handle(event)
      if (command.kind === 'changed') this.#render()
      return true
    }

    if (event.type === 'text') return true
    if (event.type !== 'key') return false
    const keyAction = prompt.request.actions?.find(item => item.key.toLowerCase() === event.id.toLowerCase() && item.scope === 'list')
    if (keyAction !== undefined) {
      if (!disarmed) {
        this.#editor.setText('')
        this.#finishPrompt(keyAction.valuePrefix)
        this.#render()
      }
      return true
    }
    if (event.id === 'escape' || event.id === 'ctrl+c') {
      this.#finishPrompt(null)
      this.#render()
      return true
    }
    const scroll = this.#promptDocument
    let documentScroll: number | undefined
    if (event.id === 'up') documentScroll = (scroll?.start ?? prompt.documentScroll ?? 0) - 1
    else if (event.id === 'down') documentScroll = (scroll?.start ?? prompt.documentScroll ?? 0) + 1
    else if (event.id === 'pageUp') documentScroll = (scroll?.start ?? 0) - (scroll?.pageSize ?? 8)
    else if (event.id === 'pageDown') documentScroll = (scroll?.start ?? 0) + (scroll?.pageSize ?? 8)
    else if (event.id === 'home') documentScroll = 0
    else if (event.id === 'end') documentScroll = prompt.request.documentTail === true ? Number.POSITIVE_INFINITY : scroll?.maxStart ?? prompt.documentScroll ?? 0
    if (documentScroll !== undefined) {
      this.#prompt = {
        ...prompt,
        documentAnchor: undefined,
        documentTarget: undefined,
        documentScroll: documentScroll === Number.POSITIVE_INFINITY ? documentScroll : Math.max(0, Math.min(documentScroll, scroll?.maxStart ?? Number.POSITIVE_INFINITY)),
      }
      this.#render()
      return true
    }
    if (event.id === 'tab' || event.id === 'right') {
      this.#prompt = movePromptSelection(prompt, prompt.selected + 1) as PendingPrompt
      this.#render()
      return true
    }
    if (event.id === 'shift+tab' || event.id === 'left') {
      this.#prompt = movePromptSelection(prompt, prompt.selected - 1) as PendingPrompt
      this.#render()
      return true
    }
    if (event.id === 'enter') {
      if (disarmed) return true
      const answer = selectedPromptAnswer(prompt)
      if (answer === null) return true
      const approve = prompt.request.approveValue ?? prompt.request.options?.[0]?.value
        ?? prompt.request.options?.[0]?.label
      if (document || answer === approve) {
        this.#finishPrompt(answer)
      } else {
        this.#editor.setText('')
        this.#prompt = { ...prompt, feedback: true }
      }
      this.#render()
      return true
    }
    return true
  }

  /**
   * Find in a rendered document.
   *
   * The source reader searches its model; a rendered page is its rows, so the
   * search runs over exactly what the reader is looking at. Without this, `/help`
   * — sixty rows of grouped commands — was the one surface with no way to look
   * something up in it.
   */
  #handleRenderedDocument(event: KeyEvent, prompt: PendingPrompt): boolean {
    const rows = (): string[] => documentRows(prompt.request, createTheme(this.#colors, this.#colorDepth, this.#themeName, this.#terminalColors), Math.max(1, this.#term.width() - 6))
    // Always build on the newest state: typing updates the query while the find
    // is open, and jumping from a stale copy would drop it again.
    const jumpTo = (row: number): void => {
      this.#prompt = { ...(this.#prompt ?? prompt), documentScroll: Math.max(0, row - 1), documentTarget: row, documentAnchor: undefined }
    }
    if (prompt.documentInput !== undefined) {
      if (event.type === 'key' && (event.id === 'escape' || event.id === 'ctrl+c')) {
        this.#editor.setText('')
        this.#prompt = { ...prompt, documentInput: undefined, documentQuery: prompt.documentOriginalQuery ?? '', documentError: undefined }
        this.#render()
        return true
      }
      if (event.type === 'key' && (event.id === 'enter' || event.id === 'ctrl+j')) {
        const query = this.#editor.text.trim()
        this.#prompt = { ...(this.#prompt ?? prompt), documentInput: undefined, documentQuery: query, documentError: undefined }
        const matches = findInRows(rows(), query)
        if (matches.length > 0) jumpTo(matches[0]!.row)
        else this.#prompt = { ...(this.#prompt ?? prompt), documentTarget: undefined }
        this.#render()
        return true
      }
      // Typing narrows the query as it is entered, so the count is live.
      if (event.type === 'text') {
        this.#editor.handle(event)
        this.#prompt = { ...(this.#prompt ?? prompt), documentQuery: this.#editor.text }
        this.#render()
        return true
      }
      if (event.type === 'key') {
        this.#editor.handle(event)
        this.#prompt = { ...(this.#prompt ?? prompt), documentQuery: this.#editor.text }
        this.#render()
        return true
      }
      return false
    }
    const search = event.type === 'key' && event.id === 'ctrl+f' || event.type === 'text' && event.value === '/'
    if (search) {
      this.#editor.setText(prompt.documentQuery ?? '')
      this.#prompt = { ...prompt, documentInput: 'search', documentOriginalQuery: prompt.documentQuery ?? '', documentError: undefined }
      this.#render()
      return true
    }
    if (event.type === 'key' && (event.id === 'ctrl+n' || event.id === 'ctrl+p')) {
      const matches = findInRows(rows(), prompt.documentQuery ?? '')
      if (matches.length === 0) return true
      const current = prompt.documentTarget ?? prompt.documentScroll ?? 0
      const from = event.id === 'ctrl+n'
        ? (matches.findIndex(match => match.row > current) + matches.length) % matches.length
        : (matches.findLastIndex(match => match.row < current) + matches.length) % matches.length
      jumpTo(matches[from]!.row)
      this.#render()
      return true
    }
    return false
  }

  #handleDocumentReader(event: KeyEvent, prompt: PendingPrompt): boolean {
    const source = prompt.request.documentSource!
    const layout = documentLayout(source, createTheme(this.#colors, this.#colorDepth, this.#themeName, this.#terminalColors), Math.max(1, this.#term.width() - 6), {
      wordWrap: prompt.documentWordWrap ?? true, column: prompt.documentColumn ?? 0,
    })
    const start = this.#promptDocument?.start ?? 0
    const current = prompt.documentTarget ?? layout.sourceRows[start] ?? 0
    const origin = prompt.documentOrigin === undefined ? start : documentStart(layout, prompt.documentOrigin)
    const jump = (row: number | undefined): void => {
      this.#prompt = { ...prompt, documentAnchor: undefined, documentTarget: row, documentScroll: row === undefined ? start : layout.starts[row] ?? start }
    }
    if (prompt.documentInput !== undefined) {
      if (event.type === 'key' && (event.id === 'escape' || event.id === 'ctrl+c')) {
        this.#editor.setText('')
        this.#prompt = { ...prompt, documentInput: undefined, documentQuery: prompt.documentOriginalQuery ?? '',
          documentAnchor: undefined, documentTarget: undefined, documentScroll: origin, documentError: undefined }
      } else if (event.type === 'key' && (event.id === 'enter' || event.id === 'ctrl+j')) {
        const text = this.#editor.text
        const row = prompt.documentInput === 'line' && /^[1-9]\d*$/u.test(text.trim()) ? documentLineRow(source, Number(text)) : undefined
        if (prompt.documentInput === 'line' && row === undefined) {
          this.#prompt = { ...prompt, documentError: source.diff ? 'Enter a new-file line shown in this diff.' : source.firstLine === undefined ? 'Enter a line number in this file.' : 'Enter a retained line number in this snapshot.' }
        } else {
          if (row !== undefined) jump(row)
          this.#prompt = { ...(this.#prompt ?? prompt), documentInput: undefined, documentError: undefined }
          this.#editor.setText('')
        }
      } else {
        const command = this.#editor.handle(event)
        if (command.kind === 'changed') {
          this.#prompt = { ...prompt, documentError: undefined }
          if (prompt.documentInput === 'search') {
            const query = this.#editor.text.replace(/\r?\n/gu, ' ')
            const matches = documentMatches(source, query)
            const row = matches.find(row => row >= (layout.sourceRows[origin] ?? 0)) ?? matches[0]
            this.#prompt = { ...prompt, documentError: undefined, documentQuery: query, documentAnchor: undefined,
              documentTarget: row,
              documentScroll: row === undefined ? origin : layout.starts[row] ?? start }
          }
        }
      }
      this.#render()
      return true
    }
    const toggleWrap = event.type === 'text' && event.value.toLowerCase() === 'w'
    const pan = event.type === 'key' && (event.id === 'alt+left' || event.id === 'alt+right')
    if (toggleWrap || pan) {
      const wordWrap = toggleWrap ? !layout.wordWrap : false
      const column = pan ? Math.max(0, Math.min(layout.maxColumn, layout.column + (event.id === 'alt+right' ? 8 : -8))) : layout.column
      this.#prompt = { ...prompt, documentWordWrap: wordWrap, documentColumn: column,
        documentAnchor: { ...documentPosition(layout, start, prompt.documentQuery ?? ''), wrap: 0, wordWrap, column } }
      this.#render()
      return true
    }
    const search = event.type === 'key' && event.id === 'ctrl+f' || event.type === 'text' && event.value === '/'
    const line = event.type === 'key' && event.id === 'ctrl+g' || event.type === 'text' && event.value.toLowerCase() === 'g'
    if (search || line) {
      this.#editor.setText(search ? prompt.documentQuery ?? '' : '')
      this.#prompt = { ...prompt, documentInput: search ? 'search' : 'line', documentOrigin: documentPosition(layout, start, prompt.documentQuery ?? ''), documentError: undefined,
        documentScroll: start,
        documentOriginalQuery: prompt.documentQuery ?? '',
        documentAnchor: { row: current, wrap: start - (layout.starts[current] ?? 0), query: prompt.documentQuery ?? '' } }
      this.#render()
      return true
    }
    if (event.type === 'key' && (event.id === 'ctrl+n' || event.id === 'ctrl+p')) {
      jump(documentDestination(documentMatches(source, prompt.documentQuery ?? ''), current, event.id === 'ctrl+n' ? 1 : -1))
    } else if (source.diff === true && event.type === 'text' && (event.value === '[' || event.value === ']')) {
      jump(documentDestination(documentModel(source).hunks, current, event.value === ']' ? 1 : -1))
    } else return false
    this.#render()
    return true
  }

  #openInspect(id: string): void {
    for (const listener of this.#inspects) listener(id)
  }

  #handleSubagentLauncher(event: KeyEvent): boolean {
    const hasAgents = (this.#subagents?.agents.length ?? 0) > 0
    if (this.#subagentLauncherFocused) {
      if (!hasAgents) {
        this.#subagentLauncherFocused = false
        return false
      }
      if (event.type === 'key' && event.id === 'enter') {
        this.#subagentLauncherFocused = false
        void this.#pickSubagent()
        return true
      }
      if (event.type === 'key' && (event.id === 'escape' || event.id === 'up')) {
        this.#subagentLauncherFocused = false
        this.#render()
        return true
      }
      if (event.type === 'key' && event.id === 'down') return true
      this.#subagentLauncherFocused = false
      return false
    }
    if (!hasAgents || event.type !== 'key' || event.id !== 'down') return false
    if (this.#editor.text !== '' || this.#images.count > 0 || this.#historyIndex !== 0 || this.#ac !== null) return false
    if (this.#queuedSubmissions.length > 0 || this.#queueEditNewer !== null || this.#queueEditPending) return false
    this.#subagentLauncherFocused = true
    this.#render()
    return true
  }

  #closeInspect(): void {
    if (this.#inspected === undefined) return
    // Keep one exit gesture inside the inspector even when repeated Escape
    // bytes are decoded after the parent view has already been restored.
    this.#inspectEscapeFenceUntil = Date.now() + DOUBLE_ESCAPE_MS
    for (const listener of this.#inspectCloses) listener()
  }

  #pickSubagent(): void {
    this.#subagentLauncherFocused = false
    const agents = this.#subagents?.agents ?? []
    if (agents.length === 0 && !this.#subagents?.workflows?.length) {
      this.notice('No subagents are available in this session.')
      return
    }
    this.#prompt = null
    this.#settings = null
    this.#copySelector = null
    this.#search = null
    this.#trajectory = null
    this.#ac = null
    this.#agentHub = createAgentHub(this.#subagents ?? { agents })
    this.#render()
  }

  #applyPrefs(prefs: TuiPrefs, options: { persist: boolean; forceToolsSync: boolean }): void {
    const previous = options.persist ? this.prefs() : undefined
    const version = this.#prefsVersion
    const previousMotion = this.#motion
    this.#themeName = prefs.theme
    this.#colors = prefs.colors
    this.#syncColorDepth()
    this.#motion = prefs.motion ?? 'full'
    this.#flushPasteBurst(true)
    this.#pasteProtection = prefs.pasteProtection !== false
    this.#externalEditor = prefs.editor ?? 'auto'
    this.#terminalTitle = prefs.terminalTitle ?? 'status'
    this.#terminalState = prefs.terminalState ?? 'auto'
    this.#syncWindowTitle()
    this.#copyOnSelect = prefs.copyOnSelect ?? true
    this.#mathMode = prefs.mathMode ?? 'auto'
    this.#mermaidMode = prefs.mermaidMode ?? 'auto'
    this.#hideThinking = prefs.hideThinking === true
    this.#mouseInteraction = prefs.mouseInteraction ?? 'auto'
    this.#checkUpdates = prefs.checkUpdates ?? true
    this.#startupChangelog = prefs.startupChangelog ?? 'summary'
    this.#notificationPolicy = resolveNotificationMode(prefs.notifications, prefs.notificationFocus)
    if (this.#notificationPolicy === 'off') this.#notificationQueue.clear()
    this.#configureNotifications()
    this.#statusBar = resolveStatusBarConfig(prefs.statusBar, prefs.statusPreset)
    if (options.forceToolsSync) this.#toolsExpanded = false
    if (previousMotion !== this.#motion) {
      this.#stopRevealTick()
      this.#reveal = undefined
    }
    this.#syncTick()
    if (options.persist && this.#persistPrefs !== null) {
      const failed = async (error: unknown): Promise<void> => {
        if (this.#disposed) return
        if (this.#prefsVersion === version && previous !== undefined) this.applyStoredPrefs(previous)
        await this.#settingsError(`Settings were not saved: ${error instanceof Error ? error.message : String(error)}`)
      }
      try {
        const changes = previous === undefined ? [] : preferenceChanges(previous, prefs)
        const result = changes.length === 0 ? undefined : this.#persistPrefs(prefs, changes)
        if (result !== undefined && result !== null && typeof result === 'object' && typeof result.then === 'function') {
          this.#prefsSaveTask = Promise.resolve(result).catch(failed).finally(() => { this.#prefsSaveTask = undefined })
        }
      } catch (error) {
        this.#prefsSaveTask = failed(error).finally(() => { this.#prefsSaveTask = undefined })
      }
    }
  }

  async #settingsError(detail: string): Promise<void> {
    if (this.#disposed) return
    if (this.#settings === null) this.notice(detail, { level: 'error' })
    else await showSettingsError(this, detail)
  }

  #applyStoredAgentBehavior(next: TuiAgentBehaviorSettings): void {
    this.#agentBehavior = { language: next.language }
    if (this.#settings !== null) {
      this.#settings = { ...this.#settings, agent: { ...this.#agentBehavior } }
    }
    if (this.#tty && !this.#disposed) this.#render()
  }

  async #commitAgentBehavior(next: TuiAgentBehaviorSettings): Promise<void> {
    const update = this.#updateAgentBehavior
    if (update === undefined) return
    try {
      await update(next)
      this.#applyStoredAgentBehavior(next)
    } catch (error: unknown) {
      if (this.#settings !== null && this.#agentBehavior !== undefined) {
        this.#settings = { ...this.#settings, agent: { ...this.#agentBehavior } }
      }
      await this.#settingsError(`Could not save Agent language: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.#agentBehaviorPending = false
      if (this.#tty && !this.#disposed) this.#render()
    }
  }

  /**
   * Write the Tools feature controls' state into the Profile patch.
   *
   * `disabled` is a Loader option rather than plugin config, so the settings
   * service cannot express it; the Profile patch is the documented surface
   * that can, and the Harness reads it while composing the tree. Only the
   * managed block is rewritten, so hand-authored rows and comments survive.
   * The displayed feature state changes only after the patch is written.
   */
  #writeFeaturePatch(features: FeatureStates): void {
    const path = this.#featurePatch
    if (path === undefined) return
    let current = ''
    try { current = readFileSync(path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, replaceFeatureBlock(current, renderFeatureBlock(features)), 'utf8')
  }

  #applySettings(event: KeyEvent): void {
    if (this.#settings === null) return
    if (this.#pluginSettingsTask !== undefined) return
    const command = applySettingsEvent(this.#settings, event)
    if (command.kind === 'open-command') {
      if (this.#prefsSaveTask !== undefined) return
      if (command.name === 'keybindings') {
        void this.#editKeybindings()
        return
      }
      this.#runSlash(command.name)
      return
    }
    if (command.kind === 'reset') {
      if (this.#prefsSaveTask !== undefined) return
      if (this.#pluginSettings?.reset === undefined) { void this.#settingsError('Restoring inheritance requires a writable Profile settings service.'); return }
      this.#runPluginSettings((binding, signal) => binding.reset!(command.id, command.entry, signal, command.label))
      return
    }
    if (command.kind === 'open-plugin') {
      if (this.#prefsSaveTask !== undefined) return
      this.#runPluginSettings((binding, signal) => binding.edit(command.id, signal))
      return
    }
    if (command.kind === 'set-plugin') {
      if (this.#prefsSaveTask !== undefined) return
      this.#runPluginSettings(async (binding, signal) => { await binding.set?.(command.entry, command.value, signal) })
      return
    }
    if (command.kind === 'update') {
      this.#settings = command.state
      this.#render()
      return
    }
    if (command.kind === 'apply') {
      if (this.#prefsSaveTask !== undefined) return
      if (command.domain === 'features') {
        if (command.state.features === undefined) return
        try { this.#writeFeaturePatch(command.state.features) } catch (error) {
          void this.#settingsError(`Feature toggles were not saved: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        this.#settings = command.state
        this.#features = command.state.features
        this.#render()
        return
      }
      if (command.domain === 'agent') {
        if (this.#agentBehaviorPending || command.state.agent === undefined) return
        this.#agentBehaviorPending = true
        this.#settings = command.state
        this.#render()
        void this.#commitAgentBehavior(command.state.agent)
        return
      }
      this.#settings = command.state
      this.#applyPrefs(command.state.prefs, { persist: true, forceToolsSync: false })
      this.#render()
      return
    }
    if (command.kind === 'close') {
      this.#settings = null
      this.#render()
    }
  }

  #runPluginSettings(operation: (binding: PluginSettingsBinding, signal: AbortSignal) => Promise<void>): void {
    const binding = this.#pluginSettings
    if (binding === undefined) return
    const closing = new AbortController()
    const selected = this.#settings === null ? undefined : tuiSettingItems(this.#settings.prefs, this.#settings.agent, this.#settings.features, this.#settings.plugins, this.#settings.editors, this.#settings.actions)[this.#settings.selected]?.id
    this.#catalogVersion++
    this.#pluginSettingsAbort = closing
    this.#pluginSettingsTask = Promise.resolve().then(() => operation(binding, closing.signal)).catch(async (error: unknown) => {
      if (closing.signal.aborted || this.#disposed) return
      const detail = error instanceof Error ? error.message : String(error)
      await showSettingsError(this, detail, closing.signal)
    }).finally(async () => {
      const entries = await this.#pluginSettings?.refresh?.().catch(() => this.#pluginSettings?.entries() ?? []) ?? this.#pluginSettings?.entries() ?? []
      this.#pluginSettingsAbort = undefined
      this.#pluginSettingsTask = undefined
      if (!this.#disposed) this.#rebuildSettings(entries, selected)
      if (this.#tty && !this.#disposed) this.#render()
    })
  }

  #applyCopySelector(event: KeyEvent): void {
    if (this.#copySelector === null) return
    const command = applyCopySelectorEvent(this.#copySelector, event)
    if (command.kind === 'update') {
      this.#copySelector = command.state
      this.#render()
      return
    }
    if (command.kind === 'pick') {
      this.#copySelector = null
      void this.#copyPicked(command.item.text, command.item.copyMessage)
      return
    }
    if (command.kind === 'close') {
      this.#copySelector = null
      this.#render()
    }
  }

  async #copyPicked(text: string, label: string): Promise<void> {
    try {
      const delivery = await this.#deliverCopy(text)
      if (this.#disposed) return
      this.#showTransientStatus(delivery === 'requested' ? 'Sent ' + label + ' to the terminal clipboard' : 'Copied ' + label)
    } catch {
      if (this.#disposed) return
      this.#showTransientStatus('Copy failed')
    }
    this.#render()
  }

  #applySearch(event: KeyEvent): void {
    if (this.#search === null) return
    const command = applyHistorySearchEvent(this.#search, event, this.#history)
    if (command.kind === 'update') {
      this.#search = command.state
      this.#render()
      return
    }
    if (command.kind === 'select') {
      this.#search = null
      this.#editor.setText(command.text)
      this.#historyIndex = 0
      this.#refreshAutocomplete()
      this.#render()
      return
    }
    if (command.kind === 'cancel') {
      this.#search = null
      this.#render()
    }
  }

  #handleAutocomplete(event: KeyEvent): boolean {
    if (event.type !== 'key') return false
    if (event.id === 'tab') {
      if (this.#ac !== null) {
        this.#applySelectedCompletion()
      } else {
        this.#refreshAutocomplete(true)
      }
      this.#render()
      return true
    }
    if (this.#ac === null) return false
    if (event.id === 'shift+tab' || event.id === 'up') {
      this.#moveAutocomplete(-1)
      this.#render()
      return true
    }
    if (event.id === 'down') {
      this.#moveAutocomplete(1)
      this.#render()
      return true
    }
    if (event.id === 'escape') {
      this.#ac = null
      this.#render()
      return true
    }
    if (event.id === 'enter') {
      this.#applySelectedCompletion()
      this.#submit(this.#editor.expandedText)
      return true
    }
    return false
  }

  #refreshAutocomplete(forcePath = false): void {
    const requestId = ++this.#autocompleteRequestId
    if (this.#autocompleteTimer !== null) {
      clearTimeout(this.#autocompleteTimer)
      this.#autocompleteTimer = null
    }
    this.#autocompleteAbort?.abort()
    this.#autocompleteAbort = null
    if (this.#prompt !== null) {
      this.#ac = null
      return
    }
    const commands = this.#commands()
    const slashResult = slashSuggestions(this.#editor.text, this.#editor.cursor, commands)
    if (slashResult !== null) {
      this.#setAutocomplete(slashResult)
      return
    }
    const pathOptions = {
      cwd: this.#cwd,
      projectRoot: this.#projectRoot,
      home: this.#home,
      listDir: this.#listDir,
      force: forcePath,
    }
    const token = findPathToken(this.#editor.text, this.#editor.cursor, forcePath)
    const { line, col } = editorLineAt(this.#editor.text, this.#editor.cursor)
    const at = forcePath ? undefined : activeAtToken(line, col)
    const atPrefix = at?.query.replaceAll('\\', '/')
      ?? (token?.kind === 'at' ? parsePathPrefix(token.prefix).raw.replaceAll('\\', '/') : '')
    const fuzzyAt = (at !== undefined || token?.kind === 'at') && atPrefix !== '' && !atPrefix.endsWith('/')
    const shortcutAt = at !== undefined && matchesAtShortcutQuery(at.query, at.quoted)
    const harnessAt = at !== undefined
      && (this.#searchFileMentions !== undefined || this.#searchSessions !== undefined)
    if (fuzzyAt || harnessAt || shortcutAt) {
      // A `@` query is answered by a debounced search, so almost every keystroke
      // lands before an answer exists. Clearing the menu here emptied the screen
      // for the whole debounce-plus-search interval and refilled it afterwards —
      // one flash per character, and the same again on every delete.
      //
      // The rows already on screen still describe the token this keystroke is
      // extending, so they stay until a real result replaces them. A genuinely
      // different token closes the menu, because those rows no longer apply.
      if ((harnessAt || shortcutAt) && !fuzzyAt) {
        const listing = pathSuggestions(this.#editor.text, this.#editor.cursor, pathOptions, commands)
        if (listing !== null) this.#setAutocomplete(listing, atPrefix)
        else if (!this.#acDescribes(atPrefix)) this.#ac = null
      } else if (!this.#acDescribes(atPrefix)) {
        this.#ac = null
      }
      const text = this.#editor.text
      const cursor = this.#editor.cursor
      this.#autocompleteTimer = setTimeout(() => {
        this.#autocompleteTimer = null
        if (this.#disposed || requestId !== this.#autocompleteRequestId) return
        const controller = new AbortController()
        this.#autocompleteAbort = controller
        const search = this.#searchFileMentions === undefined && this.#searchSessions === undefined && !shortcutAt
          ? searchPathSuggestions(text, cursor, {
            ...pathOptions,
            searchFiles: this.#searchFiles,
            signal: controller.signal,
          }, commands)
          : searchAtSuggestions(text, cursor, {
            ...pathOptions,
            searchFiles: this.#searchFiles,
            ...(this.#searchFileMentions === undefined ? {} : { searchFileMentions: this.#searchFileMentions }),
            ...(this.#searchSessions === undefined ? {} : { searchSessions: this.#searchSessions }),
            ...(shortcutAt ? { gitContext: resolveGitStatusFiles(this.#cwd) } : {}),
            signal: controller.signal,
          }, commands)
        void search.then((result) => {
          if (this.#disposed || controller.signal.aborted || requestId !== this.#autocompleteRequestId) return
          this.#autocompleteAbort = null
          // An empty answer for a `@` query means "nothing matched yet", not
          // "close the menu": keeping the live list is what stops the flash when
          // a prefix has no rows of its own.
          if (result !== null) this.#setAutocomplete(result, atPrefix)
          else if (!this.#acDescribes(atPrefix)) this.#setAutocomplete(null)
          this.#render()
        }).catch((error: unknown) => {
          if (controller.signal.aborted || requestId !== this.#autocompleteRequestId) return
          this.#autocompleteAbort = null
          this.#ac = null
          if ((error as { name?: unknown }).name !== 'AbortError') this.#render()
        })
      }, this.#autocompleteDebounceMs)
      return
    }
    const result = pathSuggestions(this.#editor.text, this.#editor.cursor, pathOptions, commands)
    this.#setAutocomplete(result)
  }

  /**
   * Whether the open menu still speaks for the `@` token being typed.
   *
   * A menu with no token recorded belongs to a slash or path completion and is
   * never reused across an `@` keystroke.
   */
  #acDescribes(atPrefix: string): boolean {
    return completionDescribes(this.#ac?.query, atPrefix)
  }

  #setAutocomplete(result: { items: AutocompleteItem[]; prefix: string } | null, query?: string): void {
    if (result === null) {
      this.#ac = null
      return
    }
    const prev = this.#ac?.items[this.#ac.selected]?.value
    let selected = nextSelectableAutocompleteIndex(result.items, 0, 1)
    if (prev !== undefined) {
      const idx = result.items.findIndex((item) => item.value === prev && item.kind !== 'heading')
      if (idx >= 0) selected = idx
    }
    this.#ac = { items: result.items, selected, ...(query === undefined ? {} : { query }) }
  }

  #moveAutocomplete(dir: -1 | 1): void {
    if (this.#ac === null || this.#ac.items.length === 0) return
    this.#ac = {
      ...this.#ac,
      selected: nextSelectableAutocompleteIndex(this.#ac.items, this.#ac.selected + dir, dir),
    }
  }

  #applySelectedCompletion(): void {
    const item = this.#ac?.items[this.#ac.selected]
    if (item === undefined || item.kind === 'heading') return
    const next = item.kind === 'path' || item.kind === 'session'
      ? applyPathCompletion(this.#editor.text, this.#editor.cursor, item)
      : applySlashCompletion(this.#editor.text, this.#editor.cursor, item)
    this.#editor.replaceText(next.text, next.cursor)
    this.#refreshAutocomplete()
  }

  #applyCommand(command: EditorCommand): void {
    if (command.kind === 'changed') {
      this.#images.reconcile()
      if (command.edited === true) this.#historyIndex = 0
      this.#refreshAutocomplete()
      this.#render()
      return
    }
    if (command.kind === 'submit') {
      if (this.#inspected !== undefined) {
        if (this.#inspected.writable === true) this.#submitInspect(command.text)
        return
      }
      this.#submit(command.text)
      return
    }
    if (command.kind === 'historyPrev') {
      if (this.#restoreLatestQueuedSubmission()) return
      this.#historyPrev()
      return
    }
    if (command.kind === 'historyNext') {
      this.#historyNext()
      return
    }
  }

  /**
   * Show a one-line confirmation that goes away on its own.
   *
   * Replaced, never appended: two presses in a row leave one line saying what
   * the second one did, which is what the reader is looking for.
   */
  #showTransientStatus(text: string, ttlMs = TRANSIENT_STATUS_MS): void {
    this.#transientStatus = text
    if (this.#transientTimer !== null) clearTimeout(this.#transientTimer)
    this.#transientTimer = setTimeout(() => {
      this.#transientTimer = null
      if (this.#transientStatus !== text) return
      this.#transientStatus = undefined
      if (!this.#disposed && this.#tty) this.#render()
    }, ttlMs)
    this.#transientTimer.unref?.()
    this.#render()
  }

  /** Any keystroke makes the last confirmation stale. */
  #clearTransientStatus(): void {
    if (this.#transientStatus === undefined) return
    this.#transientStatus = undefined
    if (this.#transientTimer !== null) { clearTimeout(this.#transientTimer); this.#transientTimer = null }
  }

  /**
   * Show or hide thinking across the whole transcript, and remember the choice.
   *
   * A revealed transcript is one where no thought is folded, so the per-thought
   * openings a reader made are dropped at the same time; keeping them would
   * leave a thought open inside a transcript that claims to show everything.
   */
  #toggleThinking(): void {
    const next = !this.#hideThinking
    this.#hideThinking = next
    if (!next) this.#expandedReasoning.clear()
    const persist = this.#persistPrefs
    if (persist !== null) void persist(this.prefs(), [{ op: 'set', path: ['hideThinking'], value: next }])
    this.#showTransientStatus(next ? 'Thinking: hidden' : 'Thinking: shown')
  }

  /** Hand the terminal to the shell and stop until SIGCONT brings it back. */
  #suspend(): void {
    if (process.platform === 'win32') return
    if (this.#inspecting) {
      this.#followTail()
      this.#render()
    }
    // The shell that takes over gets every mode back; SIGCONT takes them again.
    this.#handOffTerminal()
    try { process.kill(process.pid, 'SIGTSTP') } catch { /* no controlling tty */ }
  }

  #historyPrev(): void {
    if (this.#images.count > 0) return
    if (this.#history.length === 0 || this.#historyIndex >= this.#history.length) return
    if (this.#historyIndex === 0) {
      this.#draft = this.#editor.expandedText
      this.#historyDraft = this.#captureDraft()
    }
    this.#historyIndex += 1
    this.#editor.setText(this.#history[this.#history.length - this.#historyIndex] ?? '')
    this.#refreshAutocomplete()
    this.#render()
  }

  #restoreLatestQueuedSubmission(allowNonEmpty = false): boolean {
    if (this.#queueEditPending) return true
    if (this.#queueEditNewer !== null) {
      const previous = this.#queuedSubmissions.pop()
      if (previous !== undefined) {
        this.#queueEditNewer.unshift(this.#currentSubmission())
        this.#replaceInput(previous)
        return true
      }
      const hasDurableFollowup = this.#state.nextTurnInbox.some(message => message.source.kind === 'user')
      if (!hasDurableFollowup || this.#queueEdits.size === 0) return true
      this.#queueEditPending = true
      for (const listener of this.#queueEdits) listener()
      return true
    }
    if (this.#historyIndex !== 0) return false
    const hasDraft = this.#hasComposerContent()
    if (!allowNonEmpty && hasDraft) return false
    const submission = this.#queuedSubmissions.pop()
    if (submission !== undefined) {
      this.#queueEditNewer = hasDraft ? [this.#currentSubmission()] : []
      this.#replaceInput(submission)
      return true
    }
    const hasDurableFollowup = this.#state.nextTurnInbox.some(message => message.source.kind === 'user')
    if (!hasDurableFollowup || this.#queueEdits.size === 0) return false
    this.#queueEditNewer = []
    this.#queueEditPending = true
    for (const listener of this.#queueEdits) listener()
    return true
  }

  #historyNext(): void {
    if (this.#images.count > 0) return
    if (this.#historyIndex === 0) return
    this.#historyIndex -= 1
    if (this.#historyIndex === 0 && this.#historyDraft !== undefined) {
      this.#restoreDraft(this.#historyDraft)
      this.#draftFingerprint = this.#draftKey()
    } else this.#editor.setText(this.#historyIndex === 0 ? this.#draft : (this.#history[this.#history.length - this.#historyIndex] ?? ''))
    this.#refreshAutocomplete()
    this.#render()
  }

  #quit(): void {
    this.#resumeHintRequested = true
    if (this.#pending !== null) {
      const pending = this.#pending
      pending.offAbort?.()
      this.#pending = null
      pending.resolve(null)
    } else {
      this.#quitRequested = true
    }
  }

  /**
   * Turn composer text into a submission, shared by the main and inspected
   * composers.
   *
   * The composer marker is a draft affordance, not something the reader said,
   * so it leaves the text; it still records where the picture sat, so the
   * segments keep that order.
   */
  #buildSubmission(text: string): { submission: TuiSubmission; historyText: string } {
    const images = this.#images.copies()
    const files = this.#files.copies()
    const typedText = this.#files.text(images.length > 0 ? text.trim() : text)
    const segments = images.length === 0 ? [] : splitComposerImageMarkers(typedText, images)
    // Stripping a marker that sat on its own line leaves that line break behind.
    const submittedText = images.length > 0 ? stripComposerImageMarkers(typedText, images).trim() : typedText
    const literal = text === this.#editor.expandedText && (this.#literalInput || this.#editor.startsWithPaste)
    const historyText = submittedText.replace(/[ \t]{2,}/gu, ' ').trim()
    return {
      submission: {
        text: submittedText,
        images,
        ...(segments.length === 0 ? {} : { segments }),
        ...(files.length === 0 ? {} : { files }),
        ...(literal ? { literal: true } : {}),
      },
      historyText,
    }
  }

  #submit(text: string): void {
    if (this.#prompt !== null) {
      if (this.#prompt.request.presentation === 'progress') return
      this.#editor.setText('')
      const answer = this.#prompt.request.preserveWhitespace === true ? text : text.trim()
      this.#finishPrompt(answer.trim() === '' ? null : answer)
      this.#render()
      return
    }
    const { submission, historyText } = this.#buildSubmission(text)
    const { images, files = [], literal = false, text: submittedText } = submission
    const queueEditNewer = this.#queueEditNewer
    if (historyText !== '' && this.#history[this.#history.length - 1] !== historyText) {
      this.#history.push(historyText)
      this.#historyStore?.add(historyText)
    }
    this.#historyIndex = 0
    this.#draft = ''
    this.#literalInput = false
    this.#queueEditNewer = null
    this.#queueEditPending = false
    this.#editor.setText('')
    this.#images.clear()
    this.#files.clear()
    this.#clearDraft()
    this.#ac = null
    this.#search = null
    this.#settings = null
    this.#copySelector = null
    this.#trajectory = null
    this.#agentHub = null
    // Image placeholders are TUI-owned. Mixed image+slash drafts stay a
    // submission so restore can keep the original markers; the runner strips
    // them only to detect and execute Harness commands.
    const slash = !literal && images.length === 0 && files.length === 0 ? parseSlashInput(submittedText) : null
    if (slash !== null) {
      if (queueEditNewer !== null) this.#queuedSubmissions.push(...queueEditNewer)
      this.#runSlash(slash.name, slash.args)
      return
    }
    this.#followTail()
    const pending = this.#pending
    if (pending !== null) {
      pending.offAbort?.()
      this.#pending = null
      pending.resolve(submission)
      if (queueEditNewer !== null) this.#queuedSubmissions.push(...queueEditNewer)
    } else if (submittedText !== '' || images.length > 0 || files.length > 0 || queueEditNewer !== null) {
      if (submittedText !== '' || images.length > 0 || files.length > 0) {
        this.#queuedSubmissions.push(submission)
      }
      if (queueEditNewer !== null) this.#queuedSubmissions.push(...queueEditNewer)
    }
    if (submittedText !== '' || images.length > 0 || files.length > 0) {
      this.#popStashedDraft()
    }
    this.#render()
  }

  #submitInspect(text: string): void {
    const { submission, historyText } = this.#buildSubmission(text)
    const { images, files = [], literal = false, text: submittedText } = submission
    if (historyText !== '' && this.#history[this.#history.length - 1] !== historyText) {
      this.#history.push(historyText)
      this.#historyStore?.add(historyText)
    }
    this.#historyIndex = 0
    this.#draft = ''
    this.#literalInput = false
    this.#editor.setText('')
    this.#images.clear()
    this.#files.clear()
    this.#clearDraft()
    this.#ac = null
    this.#search = null
    const slash = !literal && images.length === 0 && files.length === 0 ? parseSlashInput(submittedText) : null
    if (slash !== null) {
      this.#runSlash(slash.name, slash.args)
      return
    }
    this.#followTail()
    if (submittedText === '' && images.length === 0 && files.length === 0) {
      this.#render()
      return
    }
    const { literal: _literal, ...inspectSubmission } = submission
    for (const listener of this.#inspectSubmits) listener(inspectSubmission)
    this.#popStashedDraft()
    this.#render()
  }

  #runSlash(name: string, args = ''): void {
    if (name === '') {
      this.#render()
      return
    }
    const command = resolveSlashCommand(name, this.#commands())
    if (command === undefined) {
      this.#followTail()
      this.#notice('unknown command: /' + name)
      this.#render()
      return
    }
    // Reading controls cover the current view; submitting a command that
    // opens one must preserve the same return position as a keyboard action.
    if (command.name === 'settings') {
      this.#runSettings(args)
      return
    }
    if (command.name === 'copy') {
      void this.#runCopy(args)
      return
    }
    // A plugin decides whether its command opens a reading surface or changes
    // the document. Forwarding alone must not discard the return position.
    if (!BUILTIN_SLASH_COMMANDS.some((entry) => entry.name === command.name)) {
      if (this.#inspected !== undefined) {
        this.#notice('Return to the parent session to run /' + command.name + '.')
        this.#render()
        return
      }
      const raw = '/' + name + (args === '' ? '' : ' ' + args)
      const pending = this.#pending
      if (pending !== null) {
        pending.offAbort?.()
        this.#pending = null
        pending.resolve({ text: raw, images: [] })
      } else {
        this.#queuedSubmissions.push({ text: raw, images: [] })
      }
      this.#render()
      return
    }
    this.#followTail()
    if (command.name === 'quit') {
      this.#render()
      this.#quit()
      return
    }
    if (command.name === 'clear') {
      // Presentation-only reset: the agent may still own an active turn with
      // live status, todos, and queued inbox state. Clearing those would make
      // the next Ctrl-C (or follow-up) behave as if the session had finished.
      this.#state = { ...this.#state, blocks: [transcriptSeam('cleared')] }
      this.#followTail()
      this.#renderer.startEpoch()
      this.#render()
      return
    }
    if (command.name === 'tools') {
      this.#runTools()
      return
    }
    if (args !== '' && args !== 'full') {
      this.#notice('Usage: /help [full]')
      this.#render()
      return
    }
    this.#runHelp(args === 'full')
  }


  #commands(): readonly SlashCommand[] {
    const localNames = new Set(BUILTIN_SLASH_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]))
    const runtime: SlashCommand[] = this.#runtimeCommands
      .filter((command) => !localNames.has(command.name))
      .map((command) => ({
        name: command.name,
        description: command.description,
        ...(command.inputHint === undefined ? {} : { inputHint: command.inputHint }),
        ...(command.complete === undefined ? {} : { complete: command.complete }),
      }))
    return [...BUILTIN_SLASH_COMMANDS, ...runtime]
  }

  #finishPrompt(answer: string | null): void {
    const pending = this.#prompt
    if (pending === null) return
    this.#prompt = null
    if (pending.request.notify !== false) {
      this.#herdr.promptResolved()
      this.#syncWindowTitle()
    }
    pending.offAbort?.()
    pending.offTick?.()
    const canceledDraft = answer === null && pending.request.onCancelDraft !== undefined
      ? this.#editor.expandedText
      : ''
    this.#editor.restore(pending.savedInput)
    if (canceledDraft.trim() !== '') {
      try { pending.request.onCancelDraft?.(canceledDraft) }
      catch (error) { this.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
    }
    this.#draftFingerprint = this.#draftKey()
    pending.resolve(answer)
    this.#restoreDisplacedSurface()
    if (this.#promptDocument?.position !== undefined) {
      try { pending.request.onDocumentPosition?.(this.#promptDocument.position) }
      catch (error) { this.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
    }
  }

  /** Save and close the visible overlay so a prompt owns both input and screen. */
  #displaceSurface(): DisplacedSurface | null {
    const displaced: DisplacedSurface | null = this.#trajectory !== null
      ? { kind: 'trajectory', state: this.#trajectory }
      : this.#agentHub !== null
        ? { kind: 'agentHub', state: this.#agentHub }
        : this.#settings !== null
          ? { kind: 'settings', state: this.#settings }
          : this.#copySelector !== null
            ? { kind: 'copySelector', state: this.#copySelector }
            : this.#search !== null ? { kind: 'search', state: this.#search } : null
    this.#trajectory = null
    this.#agentHub = null
    this.#settings = null
    this.#copySelector = null
    this.#search = null
    return displaced
  }

  /** Restore the surface displaced by the settled prompt, if one existed. */
  #restoreDisplacedSurface(): void {
    const displaced = this.#promptDisplaced
    this.#promptDisplaced = null
    if (displaced === null) return
    if (displaced.kind === 'trajectory') this.#trajectory = displaced.state
    else if (displaced.kind === 'agentHub') this.#agentHub = displaced.state
    else if (displaced.kind === 'settings') {
      this.#settings = displaced.state
      this.#rebuildSettings(this.#pluginSettings?.entries() ?? [])
      this.#refreshSettingsCatalog()
    } else if (displaced.kind === 'copySelector') this.#copySelector = displaced.state
    else this.#search = displaced.state
  }

  /** The pane's answer, offered to `/copy` while it is on screen and finished. */
  #copyableAside(): { question: string; text: string } | undefined {
    if (this.#aside === undefined || this.#aside.status === 'running' || this.#aside.text.trim() === '') return undefined
    return { question: this.#aside.question, text: this.#aside.text }
  }

  /**
   * Copy something out of the transcript.
   *
   * There used to be four kinds — `text`, `code`, `cmd`, `output` — and each one
   * asked the reader to remember a word to skip a keystroke in the picker. A kind
   * that means "the default" is a no-op, and the other three name a row the picker
   * already shows with its content, its language and its size. One command, one
   * list: the choice is made by looking, not by recalling.
   */
  async #runCopy(args: string): Promise<void> {
    if (args.trim() !== '') {
      this.#notice('Usage: /copy')
      this.#render()
      return
    }
    const items = buildCopyTargets(this.#state.blocks, undefined, this.#copyableAside())
    if (items.length === 0) {
      this.#notice('Nothing to copy.')
      this.#render()
      return
    }
    this.#search = null
    this.#ac = null
    this.#settings = null
    this.#copySelector = createCopySelector(items)
    this.#render()
  }

  #runSettings(args: string): void {
    if (args.trim() !== '') {
      this.#notice('Usage: /settings')
      this.#render()
      return
    }
    this.#search = null
    this.#ac = null
    this.#settings = createSettings(this.prefs(), undefined, this.#agentBehavior, this.#features, this.#pluginSettings?.entries(), discoverEditors(this.#externalEditor), this.#settingsActions())
    this.#refreshSettingsCatalog()
    this.#render()
  }

  #settingsActions(): SettingItem[] {
    const runtimeActions = [
      { id: 'command:model', label: 'Model and reasoning', description: 'Open /model; changes the current selection and saves the default route.', value: [this.#model, this.#reasoningEffort].filter(Boolean).join(' · '), values: [], action: 'model' },
      { id: 'command:permission', label: 'Access', description: 'Open /permission to choose access for this session.', value: this.#sessionControls?.permission ?? 'Choose', values: [], action: 'permission' },
      { id: 'command:agent', label: 'Agent preset', description: 'Open /agent to choose the session Agent preset.', value: this.#sessionControls?.agentPreset ?? 'Choose', values: [], action: 'agent' },
    ].filter(item => this.#runtimeCommands.some(command => command.name === item.action))
    const customBindings = Object.entries(this.#keybindings).filter(([key, action]) => DEFAULT_KEYBINDINGS[key] !== action).length
    return [
      ...runtimeActions,
      ...(this.#keybindingsPath === undefined ? [] : [{
        id: 'action:keybindings',
        label: 'Keybindings',
        description: 'Remap keyboard shortcuts and save to keybindings.json.',
        value: customBindings === 0 ? 'Default' : `${customBindings} custom`,
        values: [],
        action: 'keybindings',
        group: 'Input' as const,
      }]),
    ]
  }

  #refreshSettingsCatalog(): void {
    const binding = this.#pluginSettings
    if (this.#settings === null || binding?.refresh === undefined || this.#disposed) return
    const version = ++this.#catalogVersion
    void binding.refresh().then(entries => {
      if (version !== this.#catalogVersion || binding !== this.#pluginSettings || this.#settings === null || this.#disposed) return
      this.#rebuildSettings(entries)
      this.#render()
    }).catch(() => {})
  }

  #rebuildSettings(entries: readonly PluginSettingsEntry[], focus?: string): void {
    if (this.#settings === null || this.#disposed) return
    this.#settings = refreshSettings(this.#settings, createSettings(this.prefs(), focus, this.#agentBehavior, this.#features,
      entries, discoverEditors(this.#externalEditor), this.#settingsActions()))
  }

  #syncSettingsActions(): void {
    if (this.#disposed) return
    const entries = this.#pluginSettings?.entries() ?? []
    if (this.#settings !== null) this.#rebuildSettings(entries)
    if (this.#promptDisplaced?.kind === 'settings') {
      this.#promptDisplaced = {
        kind: 'settings',
        state: refreshSettings(
          this.#promptDisplaced.state,
          createSettings(this.prefs(), undefined, this.#agentBehavior, this.#features, entries, discoverEditors(this.#externalEditor), this.#settingsActions()),
        ),
      }
    }
  }

  #notice(text: string): void {
    this.#state = {
      ...this.#state,
      blocks: [...this.#state.blocks, { kind: 'notice', level: 'info', text }],
    }
  }

  #configureNotifications(): void {
    this.#notifications.configure({
      policy: this.#notificationPolicy,
      thresholdMs: NOTIFICATION_THRESHOLD_MS,
    })
  }

  #emitNotification(notification: ReturnType<TerminalNotificationController['humanPrompt']>): void {
    if (notification === undefined || !this.#tty || this.#disposed) return
    if (this.#notificationPolicy === 'unfocused' && this.#terminalFocused === true) return
    this.#notificationQueue.offer(notification)
    if (this.#notificationTimer !== undefined) return
    this.#notificationTimer = setTimeout(() => {
      this.#notificationTimer = undefined
      const pending = this.#notificationQueue.take()
      if (pending === undefined || this.#disposed || this.#notificationPolicy === 'off') return
      // Re-read focus at delivery time: the reader may have come back inside the
      // coalescing window, and a turn finishing while they watch is not news.
      if (this.#notificationPolicy === 'unfocused' && this.#terminalFocused === true) return
      const sequence = terminalNotificationSequence(pending)
      if (sequence !== '') this.#term.output.write(sequence)
    }, 25)
  }

  /**
   * Help is reference, not conversation: 60 rows of it pushed into immutable
   * scrollback and vanished on resume, so the reader paid for it twice. It opens
   * in the reading surface instead, where it can be searched and left with Esc.
   */
  #runHelp(full: boolean): void {
    const text = [
      formatHelpText(this.#commands()),
      '',
      full
        ? `**Keyboard Shortcuts · ${hotkeyCount(this.#keybindings)} shortcuts**`
        : '**Essential Shortcuts**',
      '',
      full ? formatHotkeysText(this.#keybindings) : formatEssentialHotkeysText(this.#keybindings),
      ...(full ? [] : ['', 'Use `/help full` to view every keyboard shortcut.']),
    ].join('\n')
    this.commandOutput('help', text, { focus: true })
  }

  /**
   * Tools are reference, like the command list: a table of names and
   * descriptions the reader consults and dismisses, not a step of the work.
   */
  #runTools(): void {
    // The first row of a command result is its heading, so a table needs one.
    const heading = `Tools · ${this.#tools.length} active`
    this.commandOutput('tools', `${heading}\n\n${formatToolsText(this.#tools)}`, { focus: true })
  }

  /** Resolve a configured action for one key id, tolerating camelCase ids. */
  #boundAction(id: string): TuiAction | undefined {
    return this.#keybindings[id] ?? this.#keybindings[id.toLowerCase()]
  }

  /** Run one configured action; returns true when the event was consumed. */
  #runAction(action: TuiAction): boolean {
    // `interrupt` is resolved further down, after every surface that wants to
    // interpret Escape itself — a settings search clears before the overlay
    // closes. Claiming it here would skip that layering.
    if (action === 'interrupt') return false
    if (action === 'clear-composer') return this.#runClearComposer()
    if (action === 'quit') {
      if (this.#hasComposerContent() || this.#editor.text !== '') return false
      this.#quit()
      return true
    }
    if (action === 'suspend') {
      this.#suspend()
      return true
    }
    if (action === 'reset-display') {
      this.#renderer.reset()
      this.#render()
      return true
    }
    if (this.#prompt !== null || this.#settings !== null || this.#copySelector !== null) return false
    if (action === 'select-model') { this.#submit('/model'); return true }
    if (action === 'cycle-thinking') { this.#submit('/model reasoning'); return true }
    if (action === 'toggle-thinking') {
      this.#toggleThinking()
      return true
    }
    if (action === 'dequeue') return this.#restoreLatestQueuedSubmission(true)
    if (action === 'stash-draft') {
      if (this.#search !== null) return false
      this.#stashOrRestoreDraft()
      return true
    }
    if (action === 'preview-images') {
      if (this.#search !== null || this.#inspected !== undefined) return false
      if (this.#images.count === 0) {
        // No draft image: preview the newest image the conversation carries,
        // which is the only way a settled card can still show its picture.
        const ref = this.#latestImageRef()
        if (ref === undefined) this.notice('Paste an image before opening its preview.')
        else if (this.#readImageInput === undefined) this.notice('This deployment cannot reopen that image.')
        else if (this.#imagePreviewAbort === undefined) {
          const abort = new AbortController()
          this.#imagePreviewAbort = abort
          void this.#readImageInput(ref, abort.signal)
            .then(image => image === undefined
              ? this.notice('That image could not be read back for a preview.', { level: 'error' })
              : previewImages(this, [image], abort.signal))
            .catch((error: unknown) => { if (!abort.signal.aborted && !this.#disposed) this.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) })
            .finally(() => { if (this.#imagePreviewAbort === abort) this.#imagePreviewAbort = undefined })
        }
        return true
      }
      else if (this.#imagePreviewAbort === undefined) {
        const abort = new AbortController()
        const revision = this.#images.revision
        const session = this.#sessionId
        this.#imagePreviewAbort = abort
        void previewImages(this, this.#images.copies(), abort.signal, undefined, directory => {
          if (this.#disposed) rmSync(directory, { recursive: true, force: true })
          else this.#imageTemporary.add(directory)
        }, () => !this.#disposed && session === this.#sessionId && revision === this.#images.revision && this.#prompt === null && this.#settings === null)
          .catch((error: unknown) => { if (!abort.signal.aborted && !this.#disposed) this.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) })
          .finally(() => { if (this.#imagePreviewAbort === abort) this.#imagePreviewAbort = undefined })
      }
      return true
    }
    if (action === 'expand-paste') {
      if (this.#search !== null) return false
      this.#literalInput ||= this.#editor.startsWithPaste
      this.#editor.expandPaste()
      this.#refreshAutocomplete()
      this.#render()
      return true
    }
    if (action === 'manage-queue') {
      if (this.#inspected !== undefined) this.notice('Return to the parent session to manage queued messages.')
      else if (this.#queueHandler === undefined) this.notice('Queue management is unavailable in this profile.')
      else if (this.#queueHotkeyAbort === undefined) {
        const abort = new AbortController()
        this.#queueHotkeyAbort = abort
        void this.#queueHandler(abort.signal).catch((error: unknown) => {
          if (!abort.signal.aborted && !this.#disposed) this.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
        }).finally(() => { if (this.#queueHotkeyAbort === abort) this.#queueHotkeyAbort = undefined })
      }
      return true
    }
    if (action === 'steer-turn') {
      if (this.#search !== null) return false
      if (this.#inspected !== undefined || this.#state.status !== 'running') {
        this.notice('Steering needs an active parent turn. Use Enter to send the next message.')
      } else if (this.#images.count > 0 || this.#files.copies().length > 0) {
        this.notice('Use Enter to queue attachments; steering accepts text only.')
      } else if (this.#queueEditNewer !== null || this.#queueEditPending) {
        this.notice('Finish editing the queued follow-up with Enter before steering.')
      } else if (this.#editor.expandedText.trim() !== '') {
        try {
          if (this.#steerHandler === undefined) throw new Error('Steering is unavailable in this profile.')
          this.#steerHandler(this.#editor.expandedText)
          this.#editor.setText('')
          this.#literalInput = false
          this.#historyIndex = 0
          this.#clearDraft()
          this.#ac = null
          this.#render()
        } catch (error) {
          this.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
        }
      }
      return true
    }
    if (action === 'review-changes') {
      // The keyboard twin of right-clicking a tool's path: open the files the
      // tool under the viewport declared. It shares the mouse path's region
      // lookup, so the two can never disagree about which call is under the
      // reader's eye.
      //
      // This used to also derive the turn under the viewport and forward
      // `/diff turn N` when no tool was there — twenty lines of anchor
      // backtracking to reach what `/diff` already asks for on its own. A
      // reader who wants this turn's changes types `/diff`.
      const rows = this.#renderer.viewport().map((_, row) => this.#renderer.documentRowAt(row)).filter((row): row is number => row !== undefined)
      const top = this.#follow ? undefined : rows[0]
      const regions = this.#fileActionFrame?.transcript?.fileRegions ?? []
      const region = (top === undefined ? undefined : regions.find(region => top >= region.start && top < region.end))
        ?? (this.#inspecting ? regions.find(region => this.#state.blocks[region.block]?.kind === 'tool' && rows.some(row => row >= region.start && row < region.end)) : undefined)
      const block = this.#state.blocks[region?.block ?? (this.#viewportBlock() ?? this.#state.blocks.length - 1)]
      const files = block?.kind === 'tool' ? blockFileAction(block) : undefined
      if (files === undefined) {
        this.#showTransientStatus('No tool files here · use /diff', 4_000)
        return true
      }
      this.#openFileAction(files)
      return true
    }
    if (action === 'scroll-page-up') {
      if (this.#search !== null) return false
      this.#scrollBy(-this.#pageSize())
      return true
    }
    if (action === 'scroll-page-down') {
      if (this.#search !== null) return false
      this.#scrollBy(this.#pageSize())
      return true
    }
    if (action === 'scroll-fast-up') {
      if (this.#search !== null) return false
      this.#scrollBy(-TRANSCRIPT_FAST_SCROLL)
      return true
    }
    if (action === 'scroll-fast-down') {
      if (this.#search !== null) return false
      this.#scrollBy(TRANSCRIPT_FAST_SCROLL)
      return true
    }
    if (action === 'toggle-tools') {
      if (this.#search !== null) return false
      this.#toggleFoldTarget()
      return true
    }
    if (action === 'toggle-tool-details') {
      if (this.#search !== null) return false
      this.#toggleToolDetails()
      return true
    }
    if (action === 'search-history') {
      if (this.#images.count > 0) return false
      this.#search = createHistorySearch(this.#history)
      this.#ac = null
      this.#render()
      return true
    }
    if (action === 'search-transcript') {
      // An empty composer has no forward-char target, so Ctrl+F searches the
      // transcript there; a non-empty draft keeps the editor's own binding.
      if (this.#search !== null) return false
      if (this.#editor.text !== '' || this.#images.count > 0) return false
      this.#transcriptSearch = createTranscriptSearch()
      this.#ac = null
      this.#render()
      return true
    }
    if (action === 'inspect-subagent') {
      void this.#pickSubagent()
      return true
    }
    if (action === 'retry') {
      this.#submit('/retry')
      return true
    }
    if (action === 'cycle-model-forward') {
      this.#submit('/model next')
      return true
    }
    if (action === 'cycle-model-backward') {
      this.#submit('/model previous')
      return true
    }
    if (action === 'copy-prompt') {
      void this.#copyPicked(this.#editor.expandedText, 'current prompt')
      return true
    }
    if (action === 'copy-line') {
      const text = this.#editor.textRange(
        lineStart(this.#editor.text, this.#editor.cursor),
        lineEnd(this.#editor.text, this.#editor.cursor),
      )
      void this.#copyPicked(text, 'current line')
      return true
    }
    if (action === 'paste-clipboard') {
      this.#startAsyncPaste(this.#pasteClipboard())
      return true
    }
    // A queued follow-up is the one action that must still work while the turn
    // it belongs to is running; Enter is which-turn, this is after-this-turn.
    if (action === 'follow-up') {
      if (this.#editor.expandedText.trim() === '') return false
      this.#submit(this.#editor.expandedText)
      return true
    }
    if (action !== 'external-editor') return false
    try {
      this.#handTerminal(() => {
        this.#literalInput ||= this.#editor.startsWithPaste
        const text = editExternally(this.#editor.expandedText, this.#externalEditor)
        this.#editor.setText(text)
        this.#images.reconcile()
      })
    } catch (error: unknown) {
      this.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
    } finally {
      if (!this.#disposed) {
        this.#refreshAutocomplete()
        this.#render()
      }
    }
    return true
  }

  #openPlanFeedbackEditor(prompt: PendingPrompt): void {
    try {
      this.#handTerminal(() => {
        const initial = prompt.feedback === true ? this.#editor.expandedText : ''
        const text = editExternally(initial, this.#externalEditor)
        this.#editor.setText(text)
        this.#prompt = { ...prompt, feedback: true }
      })
    } catch (error: unknown) {
      this.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
    } finally {
      if (!this.#disposed) this.#render()
    }
  }

  #hasComposerContent(): boolean {
    return this.#editor.text !== '' || this.#images.count > 0 || this.#files.copies().length > 0
  }

  #stashScope(): string {
    return this.#inspected?.id ?? this.#sessionId ?? '__default__'
  }

  #clearComposerWithUndo(options: { clearQueueEdit?: boolean; closeSearch?: boolean } = {}): void {
    const hadContent = this.#hasComposerContent()
    const snapshot = hadContent ? this.#captureDraft() : undefined
    this.#literalInput = false
    this.#editor.clear()
    this.#images.clear()
    this.#files.clear()
    if (options.clearQueueEdit) {
      this.#queueEditNewer = null
      this.#queueEditPending = false
    }
    if (options.closeSearch) this.#search = null
    this.#historyIndex = 0
    this.#clearDraft()
    this.#ac = null
    if (snapshot !== undefined) {
      this.#clearedDraft = { draft: snapshot, revision: this.#editor.revision }
    }
    this.#render()
  }

  #stashOrRestoreDraft(): void {
    const scope = this.#stashScope()
    const stashed = this.#stashedDrafts.get(scope)
    if (this.#hasComposerContent()) {
      const current = this.#captureDraft()
      this.#stashedDrafts.set(scope, current)
      if (stashed !== undefined) {
        this.#restoreDraft(stashed)
        this.notice('Swapped composer draft with stashed draft.')
      } else {
        this.#literalInput = false
        this.#editor.setText('')
        this.#images.clear()
        this.#files.clear()
        this.#clearDraft()
        this.notice('Stashed composer draft. Send a message or press Ctrl+S again to restore.')
      }
      this.#historyIndex = 0
      this.#ac = null
      this.#render()
      return
    }
    if (stashed !== undefined) {
      this.#stashedDrafts.delete(scope)
      this.#restoreDraft(stashed)
      this.#historyIndex = 0
      this.#refreshAutocomplete()
      this.notice('Restored stashed draft.')
      this.#render()
      return
    }
    this.notice('Nothing to stash.')
  }

  #popStashedDraft(): void {
    if (this.#hasComposerContent()) return
    const scope = this.#stashScope()
    const stashed = this.#stashedDrafts.get(scope)
    if (stashed === undefined) return
    this.#stashedDrafts.delete(scope)
    this.#restoreDraft(stashed)
    this.#historyIndex = 0
    this.#refreshAutocomplete()
  }

  async #editKeybindings(): Promise<void> {
    if (this.#keybindingsPath === undefined) return
    while (!this.#disposed) {
      const options = [
        ...TUI_ACTIONS.map(action => {
          const keys = keysForAction(this.#keybindings, action)
          const defaultKeys = keysForAction(DEFAULT_KEYBINDINGS, action)
          return {
            label: `${TUI_ACTION_LABELS[action]} · ${keys}`,
            value: action,
            description: keys === defaultKeys ? `Action: ${action}` : `Action: ${action} (default: ${defaultKeys})`,
          }
        }),
        {
          label: 'Reset all keybindings to defaults',
          value: '__reset_all__',
          description: 'Restore default shortcuts in keybindings.json',
        },
      ]
      const choice = await this.prompt({
        title: 'Keybindings',
        question: 'Choose an action to remap, or Esc to return to /settings.',
        options,
        filterable: true,
        allowCustom: false,
        notify: false,
      })
      if (choice === null || this.#disposed) break
      if (choice === '__reset_all__') {
        try {
          saveKeybindings(this.#keybindingsPath, DEFAULT_KEYBINDINGS)
          this.#keybindings = loadKeybindings(this.#keybindingsPath)
          if (this.#settings !== null) this.#rebuildSettings(this.#pluginSettings?.entries() ?? [], 'action:keybindings')
          this.notice('Reset keybindings to defaults.')
        } catch (error) {
          this.notice(`Could not save keybindings: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' })
        }
        continue
      }
      const action = choice as TuiAction
      if (!TUI_ACTIONS.includes(action)) continue
      const currentRawKeys = Object.entries(this.#keybindings).filter(([, bound]) => bound === action).map(([key]) => key)
      const defaultKeys = keysForAction(DEFAULT_KEYBINDINGS, action)
      const entered = await this.prompt({
        title: `Remap ${TUI_ACTION_LABELS[action]}`,
        question: `Enter key chord (e.g. ctrl+s, alt+k), "default" (${defaultKeys}), or "none" to unbind.`,
        initialInput: currentRawKeys[0] ?? '',
        allowCustom: true,
        notify: false,
      })
      if (entered === null || this.#disposed) continue
      const normalized = entered.trim().toLowerCase()
      if (normalized === '') continue
      const next: Record<string, TuiAction> = { ...this.#keybindings }
      for (const [key, bound] of Object.entries(next)) {
        if (bound === action) delete next[key]
      }
      if (normalized === 'default') {
        for (const [key, bound] of Object.entries(DEFAULT_KEYBINDINGS)) {
          if (bound === action) next[key] = action
        }
      } else if (normalized !== 'none' && normalized !== 'unbind') {
        next[normalized] = action
      }
      try {
        saveKeybindings(this.#keybindingsPath, next)
        this.#keybindings = loadKeybindings(this.#keybindingsPath)
        if (this.#settings !== null) this.#rebuildSettings(this.#pluginSettings?.entries() ?? [], 'action:keybindings')
      } catch (error) {
        this.notice(`Could not save keybindings: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' })
      }
    }
    if (this.#tty && !this.#disposed) this.#render()
  }

  /**
   * Block index the reader is looking at: the first one that starts at or below
   * the top of the transcript window. A collapsed row has to stay reachable
   * after the reader scrolls away from the tail, so the toggle aims here rather
   * than at the newest call.
   */
  #viewportBlock(): number | undefined {
    const starts = this.#blockStarts
    if (starts.length === 0) return undefined
    const at = this.#follow ? Number.POSITIVE_INFINITY : this.#scrollStart
    let index = starts.findIndex(row => row >= at)
    if (index < 0) index = starts.length - 1
    return index
  }

  /** Restore the completed turn under the viewport, or close its inspection. */
  #toggleFoldTarget(): void {
    // Flush coalesced events so hit testing uses the blocks that are on screen.
    if (this.#streamRenderTimer !== null) this.#render()
    // Inside an inspection the key is the way back out: it closes what was
    // opened and returns to the live tail, wherever the reader has scrolled.
    if (this.#inspecting) {
      this.#followTail()
      this.#render()
      return
    }
    const anchor = this.#viewportBlock()
    /**
     * A long command result folds like a tool card, and this is the key that
     * opens it. It is answered before the run lookup because a command's output
     * is not a run: the reader aimed at those rows, not at the run above them.
     */
    const anchored = anchor === undefined ? undefined : this.#state.blocks[anchor]
    if (anchor !== undefined && anchored?.kind === 'commandOutput') {
      if (this.#expandedOutputs.has(anchored)) this.#expandedOutputs.delete(anchored)
      else this.#expandedOutputs.add(anchored)
      this.#inspect(anchor)
      this.#render()
      return
    }
    const groups = turnGroups(this.#state).filter(item => !item.live)
    // The answer, changed-file record, and following notices still address
    // their turn when the reader is following the tail.
    const reach = (group: ProcessGroup): number => {
      let at = group.until
      const blocks = this.#state.blocks
      while (at < blocks.length) {
        const block = blocks[at]
        if (block?.kind === 'workspace' || (block?.kind === 'notice' && block.boundary !== true)) {
          at += 1
          continue
        }
        break
      }
      return at - 1
    }
    const group = anchor === undefined
      ? undefined
      : groups.findLast(item => {
        const first = this.#state.blocks[item.start - 1]?.kind === 'user' ? item.start - 1 : item.start
        return anchor >= first && anchor <= reach(item)
      })
    if (group !== undefined) {
      this.#toggleSet(this.#openedGroups, group.key)
      this.#inspect((group.answer ?? group.until) - 1)
      this.#render()
      return
    }
    // A live turn already has the process presentation; Alt+O owns tool details.
  }

  #detailScope(group: ProcessGroup): string {
    return group.turn === undefined ? group.key : `turn:${group.turn}`
  }

  #detailedToolIds(): ReadonlySet<string> {
    const calls = new Set<string>()
    if (this.#detailedTurns.size === 0) return calls
    for (const group of turnGroups(this.#state)) {
      if (!this.#detailedTurns.has(this.#detailScope(group))) continue
      for (let at = group.start; at < group.until; at++) {
        const block = this.#state.blocks[at]
        if (block?.kind === 'tool') calls.add(block.callId)
      }
    }
    return calls
  }

  #toggleToolDetails(): void {
    if (this.#streamRenderTimer !== null) this.#render()
    // A long tool can fill the viewport. Target the block containing its top,
    // rather than the next block starting below it (possibly another turn).
    const anchor = this.#follow ? this.#state.blocks.length - 1
      : Math.max(0, this.#blockStarts.findLastIndex(row => row <= this.#scrollStart))
    const groups = turnGroups(this.#state)
    const group = groups.findLast(item => {
      const first = this.#state.blocks[item.start - 1]?.kind === 'user' ? item.start - 1 : item.start
      let end = item.until
      while (end < this.#state.blocks.length) {
        const block = this.#state.blocks[end]
        if (block?.kind !== 'workspace' && !(block?.kind === 'notice' && block.boundary !== true)) break
        end++
      }
      return anchor >= first && anchor < end
    })
    if (group === undefined) return
    const scope = this.#detailScope(group)
    const members = groups.filter(item => this.#detailScope(item) === scope)
    if (members.every(member => member.calls === 0)) return
    this.#toggleSet(this.#detailedTurns, scope)
    for (const member of members) this.#openedGroups.add(member.key)
    const tools = members.flatMap(member => this.#state.blocks.slice(member.start, member.until)
      .flatMap((block, offset) => block.kind === 'tool' ? [member.start + offset] : []))
    const target = tools.includes(anchor) ? anchor : tools[0]
    this.#inspect(target)
    this.#focusBlock = target
    this.#focusBlockEdge = 'start'
    this.#render()
  }

  #toggleSet(set: Set<string>, key: string): void {
    if (set.has(key)) set.delete(key)
    else set.add(key)
  }

  /**
   * Every occurrence of the active query, in reading order.
   *
   * Stepping needs the same list the painter uses, so it asks the renderer rather
   * than scanning source text: a hit inside a folded row or a wrapped Markdown
   * table exists only in the rendered rows.
   */
  #searchOccurrences(): readonly TranscriptSearchMatch[] {
    const search = this.#transcriptSearch
    if (search === null || search.query.trim() === '') return []
    const options = {
      width: this.#term.width(),
      colors: this.#colors,
      themeName: this.#themeName,
      ...(this.#colorDepth === undefined ? {} : { colorDepth: this.#colorDepth }),
      mathMode: this.#mathMode,
      toolsExpanded: this.#toolsExpanded,
      expandedOutputs: this.#expandedOutputs,
      hideThinking: this.#hideThinking,
      expandedTools: this.#detailedToolIds(),
      ...(this.#openedGroups === undefined ? {} : { openedGroups: this.#openedGroups }),
    }
    return searchMatches(renderedBlocks(this.#state, options as never), search.query)
  }

  /** Fold one event into the active transcript search. */
  #applyTranscriptSearch(event: KeyEvent): void {
    const state = this.#transcriptSearch
    if (state === null) return
    const command = applyTranscriptSearchEvent(state, event, this.#searchOccurrences())
    if (command.kind === 'close') {
      this.#transcriptSearch = null
      this.#render()
      return
    }
    this.#transcriptSearch = command.state
    if (command.kind === 'focus') {
      this.#focusBlock = command.match.block
      this.#focusBlockEdge = 'start'
    }
    this.#render()
  }
}

/**
 * Mount the local terminal provider as the tui service.
 * @param ctx - plugin context.
 * @param config - model label and color switch.
 */
export function apply(ctx: Context, config: Config): void {
  const dshHome = process.env.OMDSH_HOME ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const terminalProfile = detectTerminalProfile()
  const term: TerminalLike = {
    output: process.stdout,
    input: process.stdin,
    width: () => process.stdout.columns ?? 80,
    height: () => process.stdout.rows ?? 24,
    onResize: (listener) => {
      process.stdout.on('resize', listener)
      return () => { process.stdout.removeListener('resize', listener) }
    },
  }
  const tui = new LocalTui(
    term,
    config.model,
    config.colors.get(),
    config.theme.get(),
    copyToClipboard,
    {
      deferInitialRender: true,
      readImageInput: async (ref, signal) => {
        const attachments = ctx.get('attachments')
        if (attachments === undefined) return undefined
        const stored = await attachments.readImage(ref, signal)
        if (stored === undefined) return undefined
        return {
          data: stored.data,
          mediaType: stored.ref.mediaType,
          ...(stored.ref.name === undefined ? {} : { name: stored.ref.name }),
          width: stored.ref.width,
          height: stored.ref.height,
        }
      },
      terminalProfile,
      alternateScreenOverlays: terminalProfile === 'direct',
      herdrReporter: new HerdrAgentReporter({ interactive: term.input.isTTY === true && term.output.isTTY === true }),
      historyPath: config.historyPath ?? join(dshHome, 'omdsh', 'history.jsonl'),
      draftsPath: join(config.dshHome ?? dshHome, 'omdsh', 'drafts'),
      keybindingsPath: config.keybindingsPath ?? join(dshHome, 'omdsh', 'keybindings.json'),
      ...(() => {
        const path = featurePatchPath(config.dshHome ?? dshHome)
        return existsSync(path) ? { featurePatch: path } : {}
      })(),
    },
  )
  ctx.provide(TUI_SERVICE, tui)
  ctx.effect(() => () => tui.dispose())
  // A missing route must be visible without turning the welcome card into a
  // credential check: the seams answer optimistically when they cannot tell.
  ctx.inject(['settings', 'credentials'], readyCtx => {
    const refreshModelReady = (): void => {
      void modelRouteReady(readyCtx).then(ready => tui.setModelReady(ready)).catch(() => {})
    }
    refreshModelReady()
    readyCtx.effect(() => {
      const disposers = [
        readyCtx.on('credentials/reference-updated', refreshModelReady),
        readyCtx.on('credentials/record-updated', refreshModelReady),
        readyCtx.on('authorization/settled', refreshModelReady),
      ]
      // The account service and the credential backend may activate just after
      // this injection; re-read once the composition has settled so an existing
      // grant is reflected in the live placeholder without a credential event.
      const timers = [setTimeout(refreshModelReady, 250), setTimeout(refreshModelReady, 1_500)]
      return () => {
        for (const dispose of disposers) dispose()
        for (const timer of timers) clearTimeout(timer)
      }
    }, 'omdsh model readiness')
  })
  // Preferences are this entry's own volatile config: the initial read applies
  // them without persisting, a committed form edit dispatches a volatile update
  // to this fiber only, and an in-app `/settings` change writes back through the
  // settings service, which persists the edit into the active profile patch.
  const storedPrefs = (): TuiPrefs => {
    const prefs: TuiPrefs = {
      theme: config.theme.get(),
      colors: resolveColors(config.colors.get(), term.output.isTTY === true),
      motion: config.motion.get(),
      mathMode: config.mathMode.get(),
      mermaidMode: config.mermaidMode.get(),
      editor: config.editor.get(),
      terminalTitle: config.terminalTitle.get(),
      terminalState: config.terminalState.get(),
      copyOnSelect: config.copyOnSelect.get(),
      mouseInteraction: config.mouseInteraction.get(),
      pasteProtection: config.pasteProtection.get(),
      checkUpdates: config.checkUpdates.get(),
      startupChangelog: config.startupChangelog.get(),
      notifications: config.notifications.get(),
      notificationFocus: config.notificationFocus.get(),
    }
    const statusBar = config.statusBar.get()
    // The reference holds a frozen snapshot; the provider keeps a mutable copy.
    if (statusBar !== undefined) prefs.statusBar = structuredClone(statusBar)
    const statusPreset = config.statusPreset.get()
    if (statusPreset !== undefined) prefs.statusPreset = statusPreset
    return prefs
  }
  tui.applyStoredPrefs(storedPrefs())
  void readTmuxMouseEnabled().then(enabled => tui.setTmuxMouseEnabled(enabled))
  ctx.on('loader/volatile-update', () => { tui.applyStoredPrefs(storedPrefs()) })
  // Persistence needs the settings service; without one the provider still runs
  // and an in-app change stays session-local, as it did before.
  ctx.inject(['settings'], (settingsCtx) => {
    tui.setPrefsPersist((_prefs, changes) => {
      return settingsCtx.settings.mutate(TUI_SETTINGS_ENTRY, [...changes ?? []])
        .catch((error: unknown) => { tui.applyStoredPrefs(storedPrefs()); throw error })
    })
  })
  ctx.inject(['settings', 'credentials'], (settingsCtx) => {
    settingsCtx.effect(() => {
      let bundles: readonly BundleInfo[] | undefined
      let inventoryVersion = 0
      return tui.bindPluginSettings({
        entries: () => pluginSettingsEntries(settingsCtx, bundles),
        refresh: async () => {
          const version = ++inventoryVersion
          const fresh = await settingsCtx.get('pluginManager')?.listBundles()
          if (version === inventoryVersion) bundles = fresh
          return pluginSettingsEntries(settingsCtx, fresh)
        },
        edit: (id, signal) => editSettingsEntry(settingsCtx, id, signal),
        set: (entry, value, signal) => setSettingsEntry(settingsCtx, entry, value, signal),
        reset: async (id, entry, signal, label) => {
          await resetSettingsControl(settingsCtx, id, entry, signal, label)
          tui.applyStoredPrefs(storedPrefs())
        },
      })
    })
  })
}
