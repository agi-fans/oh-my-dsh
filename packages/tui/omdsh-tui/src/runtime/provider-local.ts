import { renderContextOverview } from '../views/context-overview.ts'
import { contextOverviewDetails } from '../session/context-diagnostics.ts'
import { browseTools } from './tool-reader.ts'
import { promptBrowserState, type PromptBrowserState } from './prompt-browser.ts'
import { browseHelp } from './help-reader.ts'
import { readReference } from './reference-reader.ts'
import { FileBrowser } from './file-browser.ts'
import type { TuiFileReview } from '../definition.ts'
import { reasoningKey } from '../views/transcript-types.ts'
/**
 * TUI capability seam — local terminal provider.

 * Owns the tty: raw-mode key input (editing, history, slash/tab
 * autocomplete, /settings overlay, Ctrl-R history search, PgUp/PgDn
 * and Shift+Up/Down transcript scroll, Ctrl-O tool
 * expand, bracketed paste, double-Escape conversation rewind, double Ctrl-C exit, Ctrl-D quit),
 * SIGWINCH reflow, and the differential renderer. In non-tty mode
 * (pipes, CI) it degrades to line-based input with plain append-only
 * printing of settled blocks.
 * @module @agi-fans/dsh-tui
 */

import { rosterItems } from '../views/workflow.ts'
import { localizePrompt } from '../locale/prompt.ts'
import { resolveUiLanguage, uiText, type UiLanguagePreference } from '../locale/index.ts'
import { formatAgentPreset } from '../session/session-configuration.ts'
import {
  TerminalNotificationController,
  TerminalNotificationQueue,
  terminalNotificationSequence,
} from './terminal-notifications.ts'
import {
  PROGRAM_STATUS_QUERY, programStatusNeedsAttention, programStatusSequence,
  terminalProgressSequence, terminalTitle, workingDirectorySequence,
  type TerminalProgramState, type TerminalTitleMode, type TerminalStateMode,
} from './terminal-state.ts'
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
import { PendingInputs } from '../session/pending-inputs.ts'
import { ComposerDraftStore, type ComposerDraft } from '../session/composer-drafts.ts'
import { mergeJobSettlement } from '../session/job-notice.ts'
import { PlainTui, type PendingRead } from './plain-tui.ts'
import { documentDestination, documentLayout, documentLineRow, documentMatches, documentModel, documentPosition, documentStart } from '../views/document-reader.ts'
import type { TuiDocumentPosition, TuiSubagentView } from '../definition.ts'

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
  type TuiQueueEditRequest,
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
import { toolActionContext, toolSource, sourceQuote } from '../views/tool-actions.ts'
import { keyTestDescription } from '../input/key-test.ts'
import { buildCopyTargets, toolCommand } from '../views/copy-targets.ts'
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
  trajectoryDetailScrollLimit,
  trajectoryClick,
  trajectoryListMetrics,
  type TrajectoryState,
} from '../views/trajectory.ts'
import {
  applyEvent,
  applyStreamChunk,
  renderedBlocks,
  type AsidePanel,
  formatAgentElapsed,
  rosterPreviewStart,
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
import { sanitizeDisplayLine, type Frame, type FoldMark, type TranscriptDisclosure, type RenderSink } from '../chrome/renderer.ts'
import { blockFileAction, type FileAction } from '../views/file-actions.ts'
import { fileDocument, reviewFiles } from './file-review.ts'
import { stripAnsi } from '../chrome/width.ts'
import { MainScreenRenderer } from '../chrome/main-screen-renderer.ts'
import { supportsHyperlinks } from './terminal-probe.ts'
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
import { DEFAULT_STATUS_DENSITY, resolveStatusBarConfig, statusBarDocument, type ResolvedStatusBarConfig } from '../chrome/status-config.ts'
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
  structuredPromptAnswer,
  selectedFilteredPromptAnswer,
  togglePromptSelection,
  documentRows,
  findInRows,
  type PromptSelectorState,
} from '../views/prompt-selector.ts'
import { edgeIndex, listNavigation, navigateIndex } from '../views/list-navigation.ts'
import { refreshProjectContext, resolveGitStatusFiles, resolveProjectContext } from '../session/project-context.ts'

import { modelRouteReady } from '../session/model-readiness.ts'
import { formatEssentialHotkeysText, formatHotkeysText, keysForAction } from '../views/hotkeys.ts'
import {
  imagePathCandidates,
  splitComposerAttachmentMarkers,
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
  sourceRequest: TuiPrompt
  browserState?: PromptBrowserState
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
  | { kind: 'fileBrowser'; browser: FileBrowser }
  | { kind: 'trajectory'; state: TrajectoryState }
  | { kind: 'settings'; state: SettingsState }
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

interface MouseActionTarget { row: number; column: number; width: number; key: string; action: 'tool' | 'copy' | 'quote'; block?: number }

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
  #keyTest: { signal: AbortSignal; observe: (event: KeyEvent) => void } | undefined
  #mouseActionPress: MouseActionTarget | undefined
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
  #fileBrowser: FileBrowser | null = null
  #trajectory: TrajectoryState | null = null
  #trajectoryPress: { row: number; column: number; text: string; dragged: boolean } | undefined
  #pending: PendingRead | null = null
  readonly #pendingInputs: PendingInputs
  #pendingScope(): string { return this.#draftScope ?? '__default__' }
  get #queuedSubmissions(): TuiSubmission[] { return this.#pendingInputs.session(this.#pendingScope()).queued }
  /** Newer queue entries temporarily detached while Up browses backward. */
  get #queueEditNewer(): TuiSubmission[] | null { return this.#pendingInputs.session(this.#pendingScope()).newer }
  set #queueEditNewer(value: TuiSubmission[] | null) { this.#pendingInputs.session(this.#pendingScope()).newer = value }
  #queueEditPending = false
  #queueRecall: { request: TuiQueueEditRequest; abort: AbortController } | undefined
  #quitRequested = false
  #resumeHintRequested = false
  #lastSigintTime = 0
  #lastEscapeTime = 0
  #inspectEscapeFenceUntil = 0
  #interrupts = new Set<() => void>()
  #queueEdits = new Set<(request?: TuiQueueEditRequest) => void>()
  #continueHandler: ((request: { sessionId: string; failureSeq: number }) => Promise<void>) | undefined
  #continuing = false
  #goalHandler: ((signal: AbortSignal) => Promise<void>) | undefined
  #goalAbort: AbortController | undefined
  #queueHandler: ((signal: AbortSignal) => Promise<void>) | undefined
  #queueHotkeyAbort: AbortController | undefined
  #rewinds = new Set<() => void>()
  #inspects = new Set<(id: string) => void>()
  #workflowInspects = new Set<(id: string) => void>()
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
  #busyEnter: 'queue' | 'steer' = 'queue'
  #pasteProtection = true
  #paste = false
  #pasteBuf = ''
  #pasteInFlight = 0
  #pasteAbort: AbortController | undefined
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
  #focusBlockOffset: number | undefined
  /** Reading positions last only for this inspection and this detail layout. */
  #toolReadingPositions = new Map<string, { offset: number; width: number; raw: boolean }>()
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
  #writtenDirectory: string | undefined
  readonly #launchDirectory = process.cwd()
  #writtenProgress: string | undefined
  #progressTimer: ReturnType<typeof setInterval> | undefined
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
  #hideThinking = true
  #showFileChanges = true
  #workspaceReview: Parameters<NonNullable<TuiService['setWorkspaceReviewHandler']>>[0] | undefined
  #workspacePress: { row: number; column: number; block: number; source: Block; file?: number } | undefined
  #mouseInteraction: 'auto' | 'tui' | 'native' = 'auto'
  #tmuxMouseEnabled: boolean | undefined
  #disclosurePress: { target: TranscriptDisclosure; row: number; column: number } | undefined
  #jumpPress: { row: number; column: number; width: number } | undefined
  #jumpToLatest: { row: number; column: number; width: number } | undefined
  #openedGroups = new Set<string>()
  /** Side-conversation pane; owned here so Esc can close it from any state. */
  #aside: AsidePanel | undefined
  /** Set while the pane is open, so closing it stops the work it was showing. */
  #asideAbort: AbortController | undefined
  /** Thoughts a reader opened individually, addressed by reasoning identity. */
  #expandedReasoning = new Set<string>()
  #expandedToolRows = new Set<string>()
  #processSelection: number | undefined
  #closedReasoning = new Set<string>()
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
  /** Idle submissions also pass through the inbox, but are not queue gestures. */
  #directInputIds = new Set<string>()
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
  #sessionId: string | undefined
  #sessionTitle: string | undefined
  #writtenWindowTitle: string | undefined
  #sessionStats: TuiSessionStats | undefined
  #sessionControls: TuiSessionControls | undefined
  #loopStatus: TuiLoopStatus | undefined
  #subagents: TuiSubagentRoster | undefined
  /**
   * The roster row the reader is pointing at, or `undefined` when the composer
   * owns the keyboard. `↓` on an empty composer enters the bar; `Enter` opens the
   * child. The bar is the roster now — the full-screen hub it used to open was a
   * second stop on the way to the same transcript.
   */
  #subagentSelection: number | undefined
  #inspected: TuiInspectedSubagent | undefined
  #promptActions: NonNullable<Frame['promptActions']> = []
  #promptActionPress: (NonNullable<Frame['promptActions']>[number] & { selectedValue: string | undefined }) | undefined
  #promptChoices: NonNullable<Frame['promptChoices']> = []
  #promptChoicePress: { value: string; row: number; dragged: boolean } | undefined
  #promptDocument: { start: number; maxStart: number; pageSize: number; position?: TuiDocumentPosition } | undefined
  /**
   * 24-bit switch for the current color preference, re-derived whenever that
   * preference changes so a session that starts colorless can still enable
   * hexadecimal palettes without a restart.
   */
  #colorDepth: ColorDepth = 'ansi16'
  readonly #compactLinks = supportsHyperlinks(process.env)
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
  #uiLanguage: UiLanguagePreference = 'auto'
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
    this.#pendingInputs = new PendingInputs(this.#tty && paths.draftsPath !== undefined ? join(paths.draftsPath, 'pending') : undefined,
      (action, error) => this.notice(`Could not ${action} pending input: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' }))
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
        this.#mouseActionPress = undefined
        this.#workspacePress = undefined
        this.#jumpPress = undefined
        this.#disclosurePress = undefined
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
          this.#takeBackTerminal()
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
    let claimedHumanInput = false
    if (event.type === 'agent/inbox/spliced') {
      const inbox = event.data.target === 'next-step' ? this.#state.nextStepInbox : this.#state.nextTurnInbox
      const removed = inbox.slice(event.data.start, event.data.start + (event.data.removedCount ?? 0))
      claimedHumanInput = event.data.outcome !== 'canceled' && event.data.inserted.length === 0
        && removed.some(message => message.source.kind === 'user' && !this.#directInputIds.has(message.id))
      for (const message of removed) this.#directInputIds.delete(message.id)
      if (event.data.target === 'next-turn' && this.#state.status === 'idle'
        && !inbox.some(message => message.source.kind === 'user')) {
        const first = event.data.inserted.find(message => message.source.kind === 'user')
        if (first !== undefined) this.#directInputIds.add(first.id)
      }
    } else if (event.type === 'session/end-seed') this.#directInputIds.clear()
    this.#state = applyEvent(this.#state, event, presentation, workspace)
    if (event.type === 'turn/start' && this.#herdr.programStatus.state !== 'blocked') this.#notificationQueue.clear()
    if (claimedHumanInput && this.#tty && event.type === 'agent/inbox/spliced') {
      this.#showTransientStatus(event.data.target === 'next-step' ? 'Steer taken for the next step' : 'Queue taken for the next turn')
    }
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
        || before.phase !== agent.phase || before.needsApproval !== agent.needsApproval || before.depth !== agent.depth || before.mode !== agent.mode
    })
    const previousItems = rosterItems(this.#subagents)
    const incomingItems = rosterItems(roster)
    const workflowsChanged = (this.#subagents?.workflows?.length ?? 0) !== (roster?.workflows?.length ?? 0)
      || (roster?.workflows ?? []).some((run, index) => {
        const before = this.#subagents?.workflows?.[index]
        return before?.id !== run.id || before.name !== run.name || before.status !== run.status || before.phase !== run.phase || before.members !== run.members
      })
    const selectedId = this.#subagentSelection === undefined ? undefined : previousItems[this.#subagentSelection]?.key
    this.#subagents = roster === undefined
      ? undefined
      : { agents: roster.agents.map(agent => ({ ...agent, activity: [...agent.activity] })), ...(roster.workflows === undefined ? {} : { workflows: [...roster.workflows] }) }
    if (selectedId !== undefined) {
      const index = incomingItems.findIndex(item => item.key === selectedId)
      this.#subagentSelection = index < 0 ? undefined : index
    }
    if (incomingItems.length === 0) this.#subagentSelection = undefined
    const inspected = this.#inspected
    if (inspected !== undefined) {
      const current = this.#subagents?.agents.find(agent => agent.id === inspected.id)
      if (current !== undefined) {
        this.#inspected = {
          id: current.id,
          label: current.label,
          phase: current.phase,
          needsApproval: current.needsApproval === true,
          ...(current.mode === undefined ? {} : { mode: current.mode }),
          writable: current.mode === 'continuable',
        }
      }
    }
    if (!statusChanged && !workflowsChanged) return
    this.#syncTick()
    if (this.#tty) this.#scheduleStreamRender()
  }

  setInspectedSubagent(inspected: TuiInspectedSubagent | undefined): void {
    if (this.#inspected?.id === inspected?.id && this.#inspected?.label === inspected?.label
      && this.#inspected?.phase === inspected?.phase && this.#inspected?.needsApproval === inspected?.needsApproval && this.#inspected?.mode === inspected?.mode
      && this.#inspected?.writable === inspected?.writable) return
    if (this.#inspected?.id !== inspected?.id) { this.#workspacePress = undefined; this.#fileReviewAbort?.abort(); this.#closeFileBrowser() }
    this.#switchDraft(inspected?.id ?? this.#sessionId)
    this.#inspected = inspected === undefined ? undefined : { ...inspected }
    this.#drainPendingInput()
    if (inspected !== undefined) {
      this.#inspectEscapeFenceUntil = 0
      this.#subagentSelection = undefined
    }
    this.#syncTick()
    if (this.#tty) this.#render()
  }

  setTools(tools: readonly ToolInfo[]): void {
    this.#tools = tools.map((tool) => ({ name: tool.name, description: tool.description }))
  }

  setCommands(commands: readonly TuiCommand[]): void {
    this.#runtimeCommands = commands.map(command => ({ ...command }))
    this.#syncSettingsActions()
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  async reviewFiles(request: TuiFileReview): Promise<void> {
    this.#cancelPaste()
    if (!this.#tty || this.#disposed || request.signal.aborted) return
    this.#workspacePress = undefined
    this.#flushPasteBurst(true)
    this.#pasteBurst.clear()
    this.#finishPrompt(null)
    this.#closeFileBrowser()
    this.#selection.clear()
    this.#trajectory = null
    this.#settings = null
    this.#search = null
    this.#ac = null
    const browser = new FileBrowser(request, () => { if (!this.#disposed) this.#render() }, () => {
      if (this.#fileBrowser === browser) this.#fileBrowser = null
      if (this.#promptDisplaced?.kind === 'fileBrowser' && this.#promptDisplaced.browser === browser) this.#promptDisplaced = null
      this.#selection.clear()
      this.#trajectoryPress = undefined
      if (!this.#disposed) this.#render()
    })
    this.#fileBrowser = browser
    browser.start()
    await browser.done
  }

  #closeFileBrowser(): void {
    this.#fileBrowser?.close()
    if (this.#promptDisplaced?.kind === 'fileBrowser') this.#promptDisplaced.browser.close()
  }

  #applyFileBrowserInput(event: KeyEvent): void {
    this.#fileBrowser?.input(event,
      createTheme(this.#colors, this.#colorDepth, this.#themeName, this.#terminalColors, resolveUiLanguage(this.#uiLanguage), this.#compactLinks),
      this.#term.width(), this.#term.height())
  }

  openTrajectory(events: readonly SessionEvent[]): boolean {
    if (!this.#tty) return false
    this.#finishPrompt(null)
    this.#selection.clear()
    this.#trajectoryPress = undefined
    this.#closeFileBrowser()
    this.#trajectory = createTrajectory(events)
    this.#settings = null
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
    if (options.transient) {
      if (this.#tty && !this.#disposed) this.#showTransientStatus(text)
      return
    }
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
    const aside = this.#aside
    this.#asideAbort?.abort()
    this.#asideAbort = undefined
    this.#aside = undefined
    /**
     * A finished answer collapses into one line rather than disappearing.
     *
     * The pane is above the composer, so closing it was the only way to get the
     * screen height back — and that cost the text. Keeping the exchange as a
     * folded block means the reader can always close the pane. A consultation
     * still running records nothing: the reader left before there was an answer.
     */
    if (aside !== undefined && aside.status !== 'running' && aside.text.trim() !== '') {
      this.#state = { ...this.#state, blocks: [...this.#state.blocks, { kind: 'aside', question: aside.question, text: aside.text }] }
      this.#followTail()
    }
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

  openContext(request: Parameters<NonNullable<TuiService['openContext']>>[0]): Promise<string | null> {
    let snapshot = request.read()
    return this.#promptWithDocument({
      localize: ['title', 'options'], title: 'Context', question: '',
      detail: contextOverviewDetails(snapshot), presentation: 'document', allowCustom: false, notify: false,
      options: [{ label: 'Details', value: 'details' }, { label: 'Copy session ID', value: 'copy' },
        ...(request.canCompact ? [{ label: 'Compact', value: 'compact' }] : [])],
      refreshDocument: () => { snapshot = request.read(); return contextOverviewDetails(snapshot) },
      signal: request.signal, onSuperseded: request.onSuperseded,
    }, (theme, width) => renderContextOverview(snapshot, theme, width))
  }

  prompt(request: TuiPrompt): Promise<string | null> {
    return this.#promptWithDocument(request)
  }

  #promptWithDocument(request: TuiPrompt, renderDocument?: PromptSelectorState['renderDocument']): Promise<string | null> {
    const sourceRequest = request
    const browserState = promptBrowserState(request)
    request = localizePrompt(request, resolveUiLanguage(this.#uiLanguage))
    // Background approvals take the terminal from a user-opened file reader.
    if (this.#fileReviewAbort !== undefined && request.signal !== this.#fileReviewAbort.signal
      && request.signal !== this.#fileBrowser?.request.signal) this.#fileReviewAbort.abort()
    if (this.#disposed || request.signal?.aborted === true) return Promise.resolve(null)
    if (this.#prompt !== null) {
      const superseded = this.#prompt.request.onSuperseded
      if (superseded === undefined || request.notify === false) return Promise.reject(new Error('omdsh-tui: prompt already in flight'))
      const input = this.#editor.expandedText
      this.#finishPrompt(null)
      try { superseded(input) } catch (error) { this.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
    }
    this.#cancelPaste()
    this.#flushPasteBurst(true)
    this.#pasteBurst.clear()
    if (request.notify !== false) {
      this.#emitNotification(this.#notifications.humanPrompt())
      this.#herdr.prompt(request.title, request.attentionKind)
      this.#syncWindowTitle()
    }
    if (this.#tty && request.documentImage !== undefined && this.#imageProtocol !== undefined) this.#term.output.write('\x1b[16t')
    this.#selection.clear()
    this.#promptActionPress = undefined
    this.#promptChoicePress = undefined
    this.#disclosurePress = undefined
    this.#mouseActionPress = undefined
    this.#workspacePress = undefined
    this.#jumpPress = undefined
    this.#wheelGesture = IDLE_WHEEL
    const savedInput = this.#editor.snapshot()
    this.#editor.setText(request.filterable === true ? browserState?.query ?? ''
      : request.allowCustom === false || (request.options?.length && request.initialInput === undefined) ? '' : request.initialInput ?? '')
    this.#ac = null
    const displaced = this.#displaceSurface()
    return new Promise((resolve) => {
      const selected = Math.max(0, filteredPromptOptions(request, this.#editor.text).findIndex(option =>
        (option.value ?? option.label) === (browserState?.selected ?? request.initialValue)))
      const pending: PendingPrompt = { sourceRequest, request, ...(renderDocument === undefined ? {} : { renderDocument }), selected, checked: new Set((request.options ?? []).flatMap((option, index) => request.initialValues?.includes(option.value ?? option.label) ? [index] : [])), resolve, savedInput,
        ...(browserState === undefined ? {} : { browserState }),
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
          if (this.#disposed || this.#prompt === null || this.#selection.active) return
          try {
            const detail = request.refreshDocument?.()
            const source = request.refreshDocumentSource?.(this.#prompt.documentScroll === Number.POSITIVE_INFINITY)
            const options = request.refreshOptions?.()
            let changed = false
            if (source !== undefined && source !== this.#prompt.request.documentSource) {
              const shift = (this.#prompt.request.documentSource?.firstLine ?? 1) - (source.firstLine ?? 1)
              const anchor = this.#prompt.documentAnchor
              this.#prompt = { ...this.#prompt, sourceRequest: { ...this.#prompt.sourceRequest, documentSource: source }, request: { ...this.#prompt.request, documentSource: source },
                ...(anchor === undefined ? {} : { documentAnchor: { ...anchor, row: Math.max(0, anchor.row + shift) } }) }
              changed = true
            }
            if (options !== undefined && options !== this.#prompt.sourceRequest.options) {
              this.#prompt.sourceRequest = { ...this.#prompt.sourceRequest, options }
              this.#prompt = refreshPromptOptions(this.#prompt, localizePrompt(this.#prompt.sourceRequest, resolveUiLanguage(this.#uiLanguage)).options!, this.#editor.text)
              changed = true
            }
            if (detail !== undefined && detail !== this.#prompt.request.detail) {
              this.#prompt = { ...this.#prompt, sourceRequest: { ...this.#prompt.sourceRequest, detail }, request: { ...this.#prompt.request, detail } }
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
    this.#workspacePress = undefined
    if (reason !== 'refresh') {
      this.#fileReviewAbort?.abort()
      this.#closeFileBrowser()
      this.#clearTransientStatus()
    }
    this.#trajectory = null
    const state = replayEvents(events, presentations)
    if (reason === 'refresh') {
      const pendingIds = new Set<string>(state.nextTurnInbox.map(message => message.id))
      for (const id of this.#directInputIds) if (!pendingIds.has(id)) this.#directInputIds.delete(id)
    } else this.#directInputIds.clear()
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
    if (info.id !== this.#sessionId) {
      this.#workspacePress = undefined
      this.#fileReviewAbort?.abort()
      this.#closeFileBrowser()
      this.#notificationQueue.clear()
      this.#notifications.reset()
    }
    this.#switchDraft(this.#inspected?.id ?? info.id)
    this.#sessionId = info.id
    this.#drainPendingInput()
    this.#herdr.setSession(info.id)
    const title = info.title?.trim()
    this.#sessionTitle = title === undefined || title === '' ? undefined : title
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
  #syncWindowTitle(notify = false): void {
    if (!this.#tty || this.#disposed || this.#session.handedOff) return
    const status = this.#herdr.programStatus
    this.#writeWorkingDirectory(this.#cwd)
    this.#syncProgress(status.state)
    const title = terminalTitle(this.#terminalTitle, status, this.#sessionTitle, this.#cwd, this.#branch)
    if (title !== this.#writtenWindowTitle && !(this.#terminalTitle === 'off' && this.#writtenWindowTitle === undefined)) {
      this.#writtenWindowTitle = title
      this.#term.output.write(`\x1b]2;${title}\x07`)
    }
    if (this.#terminalState === 'auto' && !this.#programQuerySent) {
      this.#programQuerySent = true
      this.#term.output.write(PROGRAM_STATUS_QUERY)
    }
    if (!this.#reportsProgramState) {
      if (this.#writtenProgramState !== undefined) this.#term.output.write(programStatusSequence('clear'))
      this.#writtenProgramState = undefined
      return
    }
    // Only the session name is exported as metadata; prompt bodies and errors stay in the TUI.
    const sequence = programStatusSequence({ state: status.state,
      ...(status.kind === undefined ? {} : { kind: status.kind }),
      ...(this.#sessionTitle === undefined ? {} : { message: this.#sessionTitle }),
    })
    // Supporting terminals can turn these states into desktop notifications.
    // New attention reports use the same coalescing and focus gate as OSC 9.
    if (programStatusNeedsAttention(status.state)
      && (this.#notificationPolicy === 'off' || !notify && sequence !== this.#writtenProgramState)) {
      if (this.#writtenProgramState !== undefined) this.#term.output.write(programStatusSequence('clear'))
      this.#writtenProgramState = undefined
      return
    }
    if (sequence === this.#writtenProgramState) return
    this.#writtenProgramState = sequence
    this.#term.output.write(sequence)
  }

  get #reportsProgramState(): boolean {
    return this.#terminalState === 'on' || this.#terminalState === 'auto' && this.#programSupported
  }

  #writeWorkingDirectory(cwd: string): void {
    const sequence = workingDirectorySequence(cwd)
    if (sequence === this.#writtenDirectory) return
    this.#term.output.write(sequence)
    this.#writtenDirectory = sequence
  }

  #syncProgress(state: TerminalProgramState): void {
    const sequence = this.#terminalState === 'off' ? terminalProgressSequence('clear') : terminalProgressSequence(state)
    const active = sequence !== terminalProgressSequence('clear')
    if (sequence !== this.#writtenProgress && (active || this.#writtenProgress !== undefined)) this.#term.output.write(sequence)
    this.#writtenProgress = active ? sequence : undefined
    if (this.#progressTimer !== undefined && (state !== 'working' || this.#terminalState === 'off')) {
      clearInterval(this.#progressTimer)
      this.#progressTimer = undefined
    }
    // Some terminals expire indeterminate progress without a heartbeat.
    if (state === 'working' && this.#terminalState !== 'off' && this.#progressTimer === undefined) {
      this.#progressTimer = setInterval(() => {
        if (!this.#disposed && !this.#session.handedOff && this.#writtenProgress !== undefined) this.#term.output.write(this.#writtenProgress)
      }, 1000)
      this.#progressTimer.unref?.()
    }
  }

  /** Give shell/editor ownership back without retaining omdsh metadata. */
  #releaseTerminalMetadata(): void {
    if (this.#progressTimer !== undefined) clearInterval(this.#progressTimer)
    this.#progressTimer = undefined
    if (this.#writtenProgress !== undefined) this.#term.output.write(terminalProgressSequence('clear'))
    this.#writtenProgress = undefined
    if (this.#writtenProgramState !== undefined) this.#term.output.write(programStatusSequence('clear'))
    this.#writtenProgramState = undefined
    if (this.#writtenWindowTitle !== undefined && this.#writtenWindowTitle !== '') this.#term.output.write('\x1b]2;\x07')
    this.#writtenWindowTitle = undefined
    if (this.#writtenDirectory !== undefined) this.#writeWorkingDirectory(this.#launchDirectory)
    this.#writtenDirectory = undefined
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
      uiLanguage: this.#uiLanguage,
      theme: this.#themeName,
      colors: this.#colors,
      motion: this.#motion,
      mathMode: this.#mathMode,
      mermaidMode: this.#mermaidMode,
      hideThinking: this.#hideThinking,
      showFileChanges: this.#showFileChanges,
      editor: this.#externalEditor,
      terminalTitle: this.#terminalTitle,
      terminalState: this.#terminalState,
      copyOnSelect: this.#copyOnSelect,
      mouseInteraction: this.#mouseInteraction,
      busyEnter: this.#busyEnter,
      pasteProtection: this.#pasteProtection,
      checkUpdates: this.#checkUpdates,
      startupChangelog: this.#startupChangelog,
      notifications: this.#notificationPolicy,
      // The whole document, not the density alone: a projection that dropped the
      // narrowing made every later re-read of the preferences show the parts the
      // reader had just hidden.
      statusBar: statusBarDocument(this.#statusBar),
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

  #takeQueuedInput(): TuiSubmission | undefined {
    const scope = this.#sessionId ?? '__default__'
    const inputs = this.#pendingInputs.session(scope).queued
    const index = inputs.findIndex(item => !this.#pendingInputs.receipt(item)?.recovered)
    const queued = index < 0 ? undefined : inputs.splice(index, 1)[0]
    if (queued !== undefined) this.#pendingInputs.take(queued, scope)
    return queued
  }

  #drainPendingInput(): void {
    if (this.#pending === null || this.#disposed) return
    const queued = this.#takeQueuedInput()
    if (queued === undefined) return
    const pending = this.#pending
    this.#pending = null
    pending.offAbort?.()
    pending.resolve(queued)
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
    const queued = this.#takeQueuedInput()
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
    const submission = await this.readInput()
    if (submission !== null) this.#pendingInputs.finish(submission)
    return submission?.text ?? null
  }

  restoreInput(submission: TuiSubmission, sessionId?: string): void {
    const origin = this.#pendingInputs.receipt(submission)?.sessionId
    if (origin !== '__default__') sessionId ??= origin
    if (sessionId !== undefined && sessionId !== this.#draftScope || this.#prompt !== null || this.#disposed) {
      const target = sessionId ?? this.#draftScope
      const current = target === this.#draftScope
      const editor = new InputEditor()
      const images = new ComposerImages({ editor, notice: text => this.notice(text) })
      const files = new ComposerFiles({ text: () => editor.text,
        append: marker => { editor.setCursor(editor.text.length); editor.handle({ type: 'text', value: (editor.text === '' ? '' : ' ') + marker }) } })
      let existing = current ? this.#captureDraft() : target === undefined ? undefined : this.#unsavedDrafts.get(target)
      try { if (target !== undefined) existing ??= this.#draftStore?.load(target) } catch (error) { this.#reportDraftError('restore', error) }
      if (existing !== undefined) {
        editor.restore(existing.editor)
        images.restoreSnapshot(existing.images)
        files.restoreSnapshot(existing.files)
      }
      images.restore(submission, files.adopt(submission.files ?? []))
      const draft = { editor: editor.snapshot(), images: images.copies(), files: files.snapshot(editor.text), literal: existing?.literal === true || submission.literal === true }
      if (current && this.#prompt !== null) {
        const answer = this.#editor.snapshot()
        this.#restoreDraft(draft)
        this.#prompt.savedInput = draft.editor
        this.#editor.restore(answer)
        this.#draftDirty = true
        this.#flushDraft()
        if (this.#draftStore === undefined || !this.#unsavedDrafts.has(this.#pendingScope())) this.#pendingInputs.finish(submission)
        return
      }
      if (target === undefined) return
      this.#unsavedDrafts.set(target, draft)
      try {
        if (this.#draftStore !== undefined) { this.#draftStore.save(target, draft); this.#unsavedDrafts.delete(target) }
      } catch (error) { this.#reportDraftError('save', error); return }
      this.#pendingInputs.finish(submission)
      return
    }
    this.#literalInput ||= submission.literal === true
    this.#images.restore(submission, this.#files.adopt(submission.files ?? []))
    this.#draftDirty = true
    this.#flushDraft()
    if (this.#draftStore === undefined || !this.#unsavedDrafts.has(this.#pendingScope())) this.#pendingInputs.finish(submission)
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  resolveQueueEdit(submission: TuiSubmission | null, request?: TuiQueueEditRequest): void {
    if (request !== undefined && (request !== this.#queueRecall?.request || request.signal.aborted)) {
      if (submission !== null) this.restoreInput(submission, request.sessionId)
      return
    }
    if (!this.#queueEditPending) return
    this.#queueRecall = undefined
    this.#queueEditPending = false
    if (submission === null) {
      if (this.#editor.text === '' && this.#images.count === 0 && this.#queueEditNewer?.length === 0) {
        this.#queueEditNewer = null
      }
      return
    }
    if (this.#queueEditNewer === null) this.#queueEditNewer = []
    if (this.#hasComposerContent()) {
      this.#queueEditNewer.unshift(this.#currentSubmission())
    }
    this.#replaceInput(submission)
  }

  #currentSubmission(): TuiSubmission {
    return this.#buildSubmission(this.#editor.expandedText).submission
  }

  #replaceInput(submission: TuiSubmission): void {
    this.#literalInput = submission.literal === true
    this.#files.clear()
    this.#images.replace(submission, this.#files.adopt(submission.files ?? []))
    this.#historyIndex = 0
    this.#draftDirty = true
    this.#flushDraft()
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  onInterrupt(listener: () => void): () => void {
    this.#interrupts.add(listener)
    return () => { this.#interrupts.delete(listener) }
  }

  readonly pendingInputs: TuiPendingInputs = {
    receipt: submission => this.#pendingInputs.receipt(submission),
    prepare: (submission, messageId) => this.#pendingInputs.prepare(submission, messageId),
    acknowledge: submission => { this.#pendingInputs.finish(submission); if (this.#tty && !this.#disposed) this.#render() },
    reconcile: (sessionId, accepted) => this.#pendingInputs.reconcile(sessionId, accepted),
    list: () => {
      if (this.#disposed) return []
      if (this.#queueEditNewer !== null || this.#queueEditPending) throw new Error('Finish editing the queued follow-up with Enter before opening Queue.')
      return this.#queuedSubmissions.map(submission => {
        const receipt = this.#pendingInputs.identify(submission, this.#pendingScope())
        return { id: receipt.id, submission, ...(receipt.recovered ? { recovered: true } : {}) }
      })
    },
    update: (id, change) => {
      if (this.#disposed) return false
      const index = this.#queuedSubmissions.findIndex(item => this.#pendingInputs.receipt(item)?.id === id)
      if (index < 0) return false
      if (change.kind === 'release') {
        const submission = this.#queuedSubmissions[index]!
        this.#queuedSubmissions.splice(index, 1)
        this.#dispatchInput(submission)
      } else if (change.kind === 'remove') this.#queuedSubmissions.splice(index, 1)
      else if (change.kind === 'replace') {
        const old = this.#pendingInputs.receipt(this.#queuedSubmissions[index]!)!
        const receipt = this.#pendingInputs.identify(change.submission, this.#pendingScope())
        receipt.id = id
        receipt.recovered = old.recovered ?? false
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

  setContinueHandler(handler: (request: { sessionId: string; failureSeq: number }) => Promise<void>): () => void {
    this.#continueHandler = handler
    return () => { if (this.#continueHandler === handler) this.#continueHandler = undefined }
  }

  #canContinue(): boolean {
    if (this.#continueHandler === undefined || this.#continuing || this.#disposed || this.#sessionId === undefined
      || this.#sessionControls?.continuation === undefined || this.#inspected !== undefined || this.#state.status !== 'idle'
      || this.#prompt !== null || this.#hasComposerContent() || this.#pasteInFlight > 0 || this.#queueEditNewer !== null || this.#queueEditPending) return false
    const pending = this.#pendingInputs.session(this.#sessionId)
    return pending.queued.length === 0 && pending.sending.size === 0
      && this.#state.nextTurnInbox.length === 0 && !this.#state.nextStepInbox.some(message => message.source.kind === 'user')
  }

  setWorkspaceReviewHandler(handler: Parameters<NonNullable<TuiService['setWorkspaceReviewHandler']>>[0]): () => void {
    this.#workspaceReview = handler
    return () => {
      if (this.#workspaceReview === handler) {
        this.#workspaceReview = undefined
        this.#workspacePress = undefined
      }
    }
  }

  setGoalHandler(handler: (signal: AbortSignal) => Promise<void>): () => void {
    this.#goalHandler = handler
    this.#syncSettingsActions()
    return () => { if (this.#goalHandler === handler) { this.#goalAbort?.abort(); this.#goalHandler = undefined; this.#syncSettingsActions() } }
  }

  #openGoal(): void {
    if (this.#inspected !== undefined) return
    if (this.#goalHandler === undefined) { this.notice('Goal controls are unavailable in this profile.'); return }
    if (this.#goalAbort !== undefined) return
    const abort = new AbortController()
    this.#goalAbort = abort
    void this.#goalHandler(abort.signal).catch(error => {
      if (!abort.signal.aborted && !this.#disposed) this.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
    }).finally(() => { if (this.#goalAbort === abort) this.#goalAbort = undefined })
  }

  setQueueHandler(handler: (signal: AbortSignal) => Promise<void>): () => void {
    this.#queueHandler = handler
    return () => { if (this.#queueHandler === handler) { this.#queueHotkeyAbort?.abort(); this.#queueHandler = undefined } }
  }

  onQueueEdit(listener: (request?: TuiQueueEditRequest) => void): () => void {
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

  onInspectWorkflow(listener: (id: string) => void): () => void {
    this.#workflowInspects.add(listener)
    return () => { this.#workflowInspects.delete(listener) }
  }

  onInspectClose(listener: () => void): () => void {
    this.#inspectCloses.add(listener)
    return () => { this.#inspectCloses.delete(listener) }
  }

  onInspectSubmit(listener: (submission: TuiSubmission) => void): () => void {
    this.#inspectSubmits.add(listener)
    return () => { this.#inspectSubmits.delete(listener) }
  }

  /**
   * Last-resort restore for a process that exits without disposing: leave the
   * alternate screen, give every mode back and show the cursor. Writes to a TTY
   * are synchronous, so this completes before the process ends.
   */
  #restoreTerminalOnExit(): void {
    if (this.#disposed || !this.#tty) return
    try { this.#renderer.finish() } catch { /* best effort while exiting */ }
    this.#releaseTerminalMetadata()
    this.#session.release()
    this.#term.input.setRawMode?.(false)
    this.#term.output.write('\x1b[?25h')
  }

  dispose(): Promise<void> {
    if (this.#disposed) return this.#disposeTask ?? this.#herdr.release()
    this.#flushPasteBurst(true)
    this.#flushDraft()
    this.#pendingInputs.flush(this.#pendingScope())
    this.#disposed = true
    this.#cancelPaste()
    this.#imagePreviewAbort?.abort()
    this.#fileReviewAbort?.abort()
    this.#closeFileBrowser()
    this.#asideAbort?.abort()
    for (const directory of this.#imageTemporary) { try { rmSync(directory, { recursive: true, force: true }) } catch { /* OS may still hold the opened file. */ } }
    this.#imageTemporary.clear()
    this.#goalAbort?.abort()
    this.#goalAbort = undefined
    this.#goalHandler = undefined
    this.#queueHotkeyAbort?.abort()
    this.#queueHandler = undefined
    this.#continueHandler = undefined
    this.#cancelQueueRecall()
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
      this.#releaseTerminalMetadata()
      this.#offExit?.()
      this.#offExit = undefined
      this.#session.dispose()
      this.#term.output.write('\x1b[?25h\r\n')
      if (this.#resumeHintRequested && this.#sessionId !== undefined) {
        this.#term.output.write(`\r\n${uiText(resolveUiLanguage(this.#uiLanguage), 'Resume this session with {command}', { command: `${APP_NAME} --resume ${this.#sessionId}` })}\r\n`)
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
      return uiText(resolveUiLanguage(this.#uiLanguage), 'Retrying in {seconds}s', { seconds: Math.max(0, Math.ceil((this.#retryDeadline - Date.now()) / 1000)) })
    }
    if (this.#state.status === 'compacting' && this.#compactionStartedAt !== undefined) {
      return uiText(resolveUiLanguage(this.#uiLanguage), 'Compacting {seconds}s', { seconds: Math.max(0, Math.floor((Date.now() - this.#compactionStartedAt) / 1000)) })
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
    return { editor, images: this.#images.copies(editor), files: this.#files.snapshot(editor.text), literal: this.#literalInput }
  }

  #restoreDraft(draft: ComposerDraft): void {
    this.#editor.restore(draft.editor)
    this.#images.restoreSnapshot(draft.images)
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
    if (id === undefined) return
    if (this.#draftStore === undefined) { this.#unsavedDrafts.set(id, this.#captureDraft()); return }
    if (!this.#draftDirty && !this.#unsavedDrafts.has(id)) return
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
    if (this.#draftScope === undefined) return
    // A sent or explicitly discarded input must not return after a quick exit.
    this.#draftFingerprint = this.#draftKey()
    this.#draftDirty = true
    this.#flushDraft()
  }

  #switchDraft(id: string | undefined): void {
    if (id === this.#draftScope) return
    this.#cancelPaste()
    this.#goalAbort?.abort()
    this.#goalAbort = undefined
    this.#queueHotkeyAbort?.abort()
    this.#queueHotkeyAbort = undefined
    this.#cancelQueueRecall()
    this.#flushPasteBurst(true)
    this.#finishPrompt(null)
    this.#flushDraft()
    this.#pendingInputs.flush(this.#pendingScope())
    const initialInput = this.#draftScope === undefined && this.#editor.text !== '' ? this.#captureDraft() : undefined
    if (this.#draftScope === undefined && id !== undefined) this.#pendingInputs.bindInitial(id)
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
        const draft = this.#unsavedDrafts.get(id) ?? this.#draftStore?.load(id)
        if (draft !== undefined) this.#restoreDraft(draft)
      } catch (error) { restoreError = error }
    }
    if (initialInput !== undefined) this.#restoreDraft(initialInput)
    this.#draftFingerprint = initialInput === undefined ? this.#draftKey() : ''
    this.#refreshAutocomplete()
    if (restoreError !== undefined) this.#reportDraftError('restore', restoreError)
  }

  #render(): void {
    this.#pendingInputs.flush(this.#pendingScope())
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
        hideThinking: true,
        showFileChanges: this.#showFileChanges,
        height: this.#term.height(),
        model: this.#model,
        ...(this.#reasoningEffort === undefined ? {} : { reasoningEffort: this.#reasoningEffort }),
        input: this.#editor.text,
        inputCursor: this.#editor.cursor,
        inputImages: this.#images.count,
        canContinue: this.#canContinue(),
        queuedSubmissionScope: this.#pendingScope(),
        queuedSubmissions: [...this.#queuedSubmissions, ...(this.#queueEditNewer ?? [])].map(submission =>
          this.#pendingInputs.receipt(submission)?.recovered ? { ...submission, recovered: true } : submission),
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
        compactLinks: this.#compactLinks,
        language: resolveUiLanguage(this.#uiLanguage),
        themeName: this.#themeName,
        terminal: this.#terminalColors,
        ...(workingLabel === undefined ? {} : { workingLabel }),
        ...(this.#selection.active ? { selectionActions: this.#canQuoteSelection() ? 'copy-quote' as const : 'copy' as const } : {}),
        ...(this.#transientStatus !== undefined ? { transientStatus: uiText(resolveUiLanguage(this.#uiLanguage), this.#transientStatus) }
          : !this.#selection.active && this.#processSelection !== undefined ? { transientStatus: uiText(resolveUiLanguage(this.#uiLanguage), 'Process · ↑↓ select · Enter toggle · {key} actions · Home title · Esc return', { key: keysForAction(this.#keybindings, 'tool-actions') }) } : {}),
        scrollStart: this.#follow ? Number.POSITIVE_INFINITY : this.#scrollStart,
        ...(this.#focusBlock === undefined ? {} : { focusBlock: this.#focusBlock, focusBlockEdge: this.#focusBlockEdge ?? 'start', ...(this.#focusBlockOffset === undefined ? {} : { focusBlockOffset: this.#focusBlockOffset }) }),
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
        rawTools: this.#detailedToolIds(false),
        expandedReasoning: this.#visibleReasoning(),
        ...(this.#processSelection === undefined ? {} : { selectedProcess: this.#processSelection }),
        toolDetailsKey: keysForAction(this.#keybindings, 'toggle-tool-details'),
        turnDetailsKey: keysForAction(this.#keybindings, 'toggle-tools'),
        busyEnter: this.#queueEditNewer !== null || this.#queueEditPending ? 'queue' : this.#busyEnter,
        steerKey: keysForAction(this.#keybindings, 'steer-turn'),
        queueKey: keysForAction(this.#keybindings, 'follow-up'),
        openedGroups: this.#openedGroups,
        commands: this.#commands(),
        modelReady: this.#modelReady,
        ...(this.#sessionStats === undefined ? {} : { sessionStats: this.#sessionStats }),
        ...(this.#sessionControls === undefined ? {} : { sessionControls: this.#sessionControls }),
        ...(this.#loopStatus === undefined ? {} : { loopStatus: this.#loopStatus }),
        ...(this.#subagents === undefined ? {} : { subagents: this.#subagents }),
        ...(this.#subagentSelection === undefined ? {} : { subagentSelection: this.#subagentSelection }),
        ...(this.#inspected === undefined ? {} : { inspected: this.#inspected }),
        ...(this.#trajectory === null ? {} : { trajectory: this.#trajectory }),
        ...(this.#fileBrowser === null ? {} : { fileBrowser: this.#fileBrowser.state }),
        ...(this.#aside === undefined ? {} : { aside: this.#aside }),
        statusBar: this.#statusBar,
        ...(this.#prompt === null ? {} : { promptSelector: this.#prompt }),
        ...(this.#settings !== null
          ? { settings: this.#settings }
          : this.#search !== null
            ? { historySearch: this.#search }
            : this.#ac !== null ? { autocomplete: this.#ac } : {}),
      })
      : { lines: [] }
    this.#focusBlock = undefined
    this.#focusBlockEdge = undefined
    this.#focusBlockOffset = undefined
    this.#promptActions = frame.promptActions ?? []
    this.#promptChoices = frame.promptChoices ?? []
    this.#promptDocument = frame.promptDocument
    if (this.#prompt !== null && this.#prompt.documentScroll !== Number.POSITIVE_INFINITY && frame.promptDocument?.position !== undefined) {
      this.#prompt = { ...this.#prompt, documentAnchor: frame.promptDocument.position }
    }
    this.#syncScroll(frame.transcript)
    this.#jumpToLatest = frame.jumpToLatest
    this.#fileActionFrame = frame.transcript === undefined || frame.transientSurface === 'overlay' ? undefined : frame
    this.#setMouseTracking(this.#fileBrowser !== null || this.#trajectory !== null || this.#documentMouseEnabled() || this.#promptChoices.length > 0 || this.#promptActions.length > 0 || (frame.transcript !== undefined && frame.transientSurface !== 'overlay'
      && (this.#inspecting || this.#maxStart > 0 || (frame.transcript.fileRegions?.length ?? 0) > 0 || (frame.transcript.disclosures?.length ?? 0) > 0)))
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
    this.#workspacePress = undefined
    if (this.#follow && (delta > 0 || this.#maxStart === 0)) return
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
    this.#expandedOutputs.clear()
    this.#expandedToolRows.clear()
    this.#toolReadingPositions.clear()
    this.#expandedReasoning.clear()
    this.#closedReasoning.clear()
    this.#processSelection = undefined
  }

  #documentMouseEnabled(): boolean {
    const prompt = this.#prompt
    return prompt !== null && prompt.feedback !== true && this.#promptDocument !== undefined
      && (prompt.request.presentation === 'document' || prompt.request.presentation === 'plan-review')
  }

  #scrollPromptDocument(row: number): void {
    if (this.#prompt === null) return
    this.#prompt = {
      ...this.#prompt,
      documentAnchor: undefined,
      documentTarget: undefined,
      documentScroll: row === Number.POSITIVE_INFINITY ? row : Math.max(0, Math.min(row, this.#promptDocument?.maxStart ?? 0)),
    }
    this.#render()
  }

  /** Capture transcript navigation; overlays and disposal restore terminal ownership. */
  #setMouseTracking(enabled: boolean): void {
    enabled = enabled && this.#mouseInteraction !== 'native'
      && (this.#mouseInteraction === 'tui' || this.#tmuxMouseEnabled !== false)
    if (!enabled) { this.#workspacePress = undefined; this.#mouseActionPress = undefined; this.#selection.clear(); this.#jumpPress = undefined; this.#disclosurePress = undefined }
    if (!this.#tty || enabled === this.#mouseTracking) return
    this.#mouseTracking = enabled
    this.#session.setMode('mouse', MOUSE_TRACKING, enabled)
  }

  /** Give every terminal mode back before the terminal is lent out (Ctrl+Z, external editor). */
  #handOffTerminal(): void {
    this.#setMouseTracking(false)
    this.#releaseTerminalMetadata()
    this.#session.handOff()
    this.#term.input.setRawMode?.(false)
  }

  #takeBackTerminal(): void {
    this.#session.takeBack()
    this.#term.input.setRawMode?.(true)
    this.#terminalFocused = undefined
    this.#writtenWindowTitle = undefined
    this.#writtenProgramState = undefined
    this.#writtenDirectory = undefined
    this.#programQuerySent = false
    this.#programSupported = false
    this.#syncWindowTitle()
    this.#renderer.reset()
  }

  /** Run `run` with the terminal handed off; take it back and repaint afterwards. */
  #handTerminal<T>(run: () => T): T {
    this.#handOffTerminal()
    try {
      return run()
    } finally {
      if (!this.#disposed) {
        this.#takeBackTerminal()
      }
    }
  }

  /**
   * After a Ctrl+O toggle: read what is open in a browsing frame at `target`,
   * or go back to the live tail once nothing is open any more.
   */
  #inspect(target: number | undefined): void {
    const open = this.#toolsExpanded || this.#openedGroups.size > 0 || this.#expandedOutputs.size > 0
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
    if (this.#pasteProtection && !this.#paste && this.#pasteInFlight === 0
      && this.#prompt === null && this.#settings === null
      && this.#search === null && this.#trajectory === null && this.#fileBrowser === null && this.#transcriptSearch === null
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
    const composer = this.#prompt === null && this.#settings === null
      && this.#search === null && this.#trajectory === null && this.#fileBrowser === null && this.#transcriptSearch === null
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

  #cancelPaste(): void {
    this.#pasteAbort?.abort()
    this.#pasteAbort = undefined
    this.#pasteInFlight = 0
    this.#deferredPasteEvents = []
    this.#paste = false
    this.#pasteBuf = ''
  }

  #startAsyncPaste(operation: (signal: AbortSignal) => Promise<void>): void {
    const abort = new AbortController()
    this.#pasteAbort = abort
    this.#pasteInFlight = 1
    void operation(abort.signal).catch((error: unknown) => {
      if (!abort.signal.aborted) this.notice('Paste failed: ' + (error instanceof Error ? error.message : String(error)), { level: 'error' })
    }).finally(() => {
      if (this.#pasteAbort !== abort) return
      this.#pasteAbort = undefined
      this.#pasteInFlight = 0
      const deferred = this.#deferredPasteEvents.splice(0)
      for (let index = 0; index < deferred.length; index += 1) {
        this.#dispatch(deferred[index] as KeyEvent)
        if (this.#pasteInFlight === 0) continue
        this.#deferredPasteEvents.unshift(...deferred.slice(index + 1))
        break
      }
    })
  }

  async #acceptPastedText(text: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    if (this.#fileBrowser !== null) { this.#applyFileBrowserInput({ type: 'text', value: text }); return }
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
    if (this.#settings !== null) return
    if (this.#search !== null) {
      this.#applySearch({ type: 'text', value: text })
      return
    }
    const paths = imagePathCandidates(text)
    if (paths.length > 0) {
      const images = await Promise.all(paths.map(async path => {
        try { return await this.#readImagePath(path) }
        catch { return null }
      }))
      if (signal.aborted) return
      let inserted = false
      for (const [index, image] of images.entries()) {
        if (image === null) {
          this.notice(uiText(resolveUiLanguage(this.#uiLanguage), 'Could not read image {path}', { path: paths[index]! }), { level: 'error' })
          continue
        }
        const admitted = await this.#images.admit(image, signal)
        if (signal.aborted) return
        if (admitted) {
          this.#images.insert(image)
          inserted = true
        }
      }
      if (inserted) this.#refreshAutocomplete()
      this.#render()
      return
    }
    this.#literalInput ||= this.#editor.cursor === 0 && text.startsWith('!')
    this.#editor.paste(text)
    this.#refreshAutocomplete()
    this.#render()
  }

  async #pasteClipboard(signal: AbortSignal): Promise<void> {
    if (this.#prompt === null && this.#search === null && this.#settings === null) {
      const image = await this.#readClipboardImage()
      if (signal.aborted) return
      if (image !== null) {
        const admitted = await this.#images.admit(image, signal)
        if (signal.aborted) return
        if (admitted) {
          this.#images.insert(image)
          this.#refreshAutocomplete()
          this.#render()
        }
        return
      }
      const files = await this.#readClipboardFiles()
      if (signal.aborted) return
      const imagePaths = files.filter(path => imagePathCandidates(path).length === 1)
      if (imagePaths.length > 0) {
        await this.#acceptPastedText(imagePaths.join('\n'), signal)
        return
      }
    }
    const text = await this.#readClipboard()
    if (text !== '' && !signal.aborted) await this.#acceptPastedText(text, signal)
  }

  /** Resolve one bounded tmux probe without overwriting an explicit preference. */
  setTmuxMouseEnabled(enabled: boolean | undefined): void {
    if (this.#disposed) return
    this.#tmuxMouseEnabled = enabled
    if (this.#tty) this.#render()
  }

  /** Resolve only current painted rows, never reinterpret a frozen native-history snapshot. */
  #disclosureAt(row: number, column: number, action = false): TranscriptDisclosure | undefined {
    const frame = this.#fileActionFrame
    const document = this.#renderer.documentRowAt(row)
    const source = frame?.documentRows
    if (document === undefined || source == null || document < source.documentStart || document >= source.documentEnd) return
    const target = frame?.transcript?.disclosures?.find(item => item.row === document && (action
      ? item.actionColumn !== undefined && column >= item.actionColumn && column < item.actionColumn + (item.key.startsWith('output:') ? 6 : 5)
      : column >= item.column && column < item.column + item.width))
    const expected = frame?.lines[source.frameStart + document - source.documentStart]
    const actual = this.#renderer.viewport()[row]
    if (target === undefined || expected === undefined || actual === undefined
      || stripAnsi(sanitizeDisplayLine(expected)).trimEnd() !== stripAnsi(actual).trimEnd()) return
    return target
  }

  /** Preview text and spinner frames may change while a click stays on the same item. */
  #pressedDisclosureAt(row: number, column: number): TranscriptDisclosure | undefined {
    const pressed = this.#disclosurePress
    if (pressed === undefined || pressed.row !== row) return
    if (pressed.target.key.startsWith('output:') && Math.abs(pressed.column - column) > 1) return
    const target = this.#disclosureAt(row, column)
    if (target?.key === pressed.target.key && target.row === pressed.target.row
      && target.column === pressed.target.column && target.width === pressed.target.width) return target
  }

  #activateDisclosure(target: TranscriptDisclosure): void {
    const output = this.#state.blocks[target.block]
    if (output?.kind === 'commandOutput' && target.key === `output:${target.block}`) {
      if (this.#expandedOutputs.has(output)) this.#expandedOutputs.delete(output)
      else this.#expandedOutputs.add(output)
      this.#inspect(target.block)
      this.#focusBlock = target.block
      this.#focusBlockEdge = 'start'
      this.#render()
      return
    }
    const groups = turnGroups(this.#state)
    const group = groups.find(item => target.group === undefined
      ? target.block >= item.start && target.block < item.until : item.key === target.group)
    if (group === undefined) return
    const block = this.#state.blocks[target.block]
    if (target.group === undefined && target.key !== (block?.kind === 'tool' ? `call:${block.callId}`
      : block?.kind === 'assistant' ? `thought:${reasoningKey(block)}` : undefined)) return
    const scope = this.#detailScope(group)
    for (const member of groups) if (this.#detailScope(member) === scope) this.#openedGroups.add(member.key)
    this.#processSelection = this.#processRows().includes(target.block) ? target.block : this.#processRows()[0]
    this.#ac = null
    this.#inspect(target.block)
    if (target.group === undefined) this.#toggleProcessItem(target.block, 'enter')
    else { this.#focusBlock = target.block; this.#focusBlockEdge = 'start'; this.#render() }
  }

  #mouseActionAt(row: number, column: number): MouseActionTarget | undefined {
    const frame = this.#fileActionFrame
    const viewport = this.#renderer.viewport()
    for (const target of frame?.selectionActions ?? []) {
      const physical = viewport.length - (frame!.lines.length - target.row)
      if (row === physical && column >= target.column && column < target.column + target.width
        && this.#selection.active && this.#selection.valid(viewport)
        && stripAnsi(viewport[row] ?? '').trimEnd() === stripAnsi(frame!.lines[target.row] ?? '').trimEnd()) {
        return { ...target, row: physical, key: target.action }
      }
    }
    const tool = this.#disclosureAt(row, column, true)
    if (tool?.actionColumn !== undefined) return { row, column: tool.actionColumn, width: tool.key.startsWith('output:') ? 6 : 5, key: tool.key, action: 'tool', block: tool.block }
    return undefined
  }

  #fileRegionAt(row: number): { block: number; file?: number } | undefined {
    const document = this.#renderer.documentRowAt(row)
    const frame = this.#fileActionFrame
    const source = frame?.documentRows
    const region = document === undefined ? undefined : frame?.transcript?.fileRegions?.find(region => document >= region.start && document < region.end)
    const expected = document === undefined || source === undefined || source === null ? undefined
      : frame?.lines[source.frameStart + document - source.documentStart]
    const actual = this.#renderer.viewport()[row]
    // Committed native history can differ from the live document after a reflow.
    return expected !== undefined && actual !== undefined
      && stripAnsi(sanitizeDisplayLine(expected)).trimEnd() === stripAnsi(actual).trimEnd() ? region : undefined
  }

  #handleMouse(event: Extract<KeyEvent, { type: 'mouse' }>): void {
    if (!this.#mouseTracking || this.#paste || this.#pasteInFlight > 0) return
    if (this.#trajectory !== null || this.#fileBrowser !== null) { this.#handleTrajectoryMouse(event); return }
    const promptAction = this.#promptActions.find(action => event.row === action.row && event.column >= action.column && event.column < action.column + action.width)
    if (this.#promptActionPress !== undefined) {
      const pressed = this.#promptActionPress
      if (event.action === 'release') {
        this.#promptActionPress = undefined
        this.#promptChoicePress = undefined
        if (event.button === 'left' && !event.shift && promptAction?.index === pressed.index && promptAction.key === pressed.key
          && promptAction.row === pressed.row && promptAction.column === pressed.column && this.#prompt !== null) {
          if (pressed.key === undefined) {
            this.#prompt = { ...this.#prompt, selected: pressed.index, documentInput: undefined }
            this.#handlePlanReview({ type: 'key', id: 'enter' }, this.#prompt)
          } else if (pressed.selectedValue === (filteredPromptOptions(this.#prompt.request, this.#editor.text, this.#prompt.collapsed)[this.#prompt.selected]?.value
            ?? filteredPromptOptions(this.#prompt.request, this.#editor.text, this.#prompt.collapsed)[this.#prompt.selected]?.label)) {
            this.#handlePrompt({ type: 'key', id: pressed.key })
          }
        }
      } else if (event.action === 'drag' && (promptAction?.index !== pressed.index || promptAction.key !== pressed.key
        || promptAction.row !== pressed.row || promptAction.column !== pressed.column || event.shift)) {
        this.#promptActionPress = { ...pressed, index: -2 }
      }
      return
    }
    if (event.button === 'left' && event.action === 'press' && !event.shift && promptAction !== undefined) {
      this.#selection.clear()
      const selected = this.#prompt === null ? undefined : filteredPromptOptions(this.#prompt.request, this.#editor.text, this.#prompt.collapsed)[this.#prompt.selected]
      this.#promptActionPress = { ...promptAction, selectedValue: selected?.value ?? selected?.label }
      return
    }
    if (this.#promptChoices.length > 0 && event.button === 'left') {
      const choice = this.#promptChoices.find(item => item.row === event.row && event.column >= item.column && event.column < item.column + item.width)
      if (event.action === 'press') {
        const prompt = this.#prompt
        if (prompt?.request.wait !== undefined && prompt.waitHeld !== true) {
          prompt.request.wait.hold()
          prompt.offTick?.()
          this.#prompt = { ...prompt, waitHeld: true }
        }
        this.#promptChoicePress = choice === undefined ? undefined : { value: choice.value, row: choice.row, dragged: event.shift }
        this.#selection.begin(this.#renderer.viewport(), event, Date.now(), event.shift)
      } else if (event.action === 'drag') {
        if (this.#promptChoicePress !== undefined) this.#promptChoicePress.dragged = true
        this.#selection.move(event)
      } else {
        const pressed = this.#promptChoicePress
        this.#promptChoicePress = undefined
        const text = this.#selection.release(event)
        if (text !== undefined) { if (this.#copyOnSelect) void this.#copySelection() }
        else if (pressed !== undefined && !pressed.dragged && !event.shift && choice?.value === pressed.value && choice.row === pressed.row && this.#prompt !== null) {
          this.#prompt = { ...this.#prompt, selected: choice.index, previewScroll: 0 }
          if (this.#prompt.request.multiSelect === true && filteredPromptOptions(this.#prompt.request, this.#editor.text)[choice.index]?.disabled !== true) this.#prompt = togglePromptSelection(this.#prompt, this.#editor.text) as PendingPrompt
        }
      }
      this.#render()
      return
    }
    const pressedAction = this.#mouseActionPress
    if (pressedAction !== undefined) {
      const target = this.#mouseActionAt(event.row, event.column)
      if (event.action === 'release') {
        this.#mouseActionPress = undefined
        this.#workspacePress = undefined
        if (event.button === 'left' && !event.shift && target?.key === pressedAction.key && target.row === pressedAction.row && target.column === pressedAction.column) {
          if (target.action === 'copy') void this.#copySelection()
          else if (target.action === 'quote') this.#quoteSelection()
          else {
            const block = this.#state.blocks[target.block!]
            if (block?.kind === 'tool') void this.#openToolActions(block)
            else if (block?.kind === 'commandOutput') void this.#readCommandOutput(block)
          }
        }
      } else if (event.action === 'drag' && (target?.key !== pressedAction.key || event.shift)) {
        // Keep consuming the gesture, but never activate after leaving the button.
        this.#mouseActionPress = { ...pressedAction, key: '' }
      }
      return
    }
    if (event.button === 'left' && event.action === 'press' && !event.shift) {
      const target = this.#mouseActionAt(event.row, event.column)
      if (target !== undefined) { this.#mouseActionPress = target; this.#disclosurePress = undefined; return }
    }
    const inside = (target: { row: number; column: number; width: number }): boolean =>
      event.row === target.row && event.column >= target.column && event.column < target.column + target.width
    if (event.button === 'right') {
      this.#workspacePress = undefined
      this.#disclosurePress = undefined
      if (event.action === 'press') {
        if (this.#selection.active) void this.#copySelection()
        else {
          const region = this.#fileRegionAt(event.row)
          if (region !== undefined) {
            const block = this.#state.blocks[region.block]
            const action = block === undefined ? undefined : blockFileAction(block)
            if (action !== undefined) this.#openFileAction(action, region.file)
          }
        }
      }
      return
    }
    if (event.action === 'press') {
      const region = !event.shift && this.#workspaceReview !== undefined ? this.#fileRegionAt(event.row) : undefined
      const source = region === undefined ? undefined : this.#state.blocks[region.block]
      this.#workspacePress = source?.kind === 'workspace' && region !== undefined
        ? { row: event.row, column: event.column, block: region.block, source, ...(region.file === undefined ? {} : { file: region.file }) } : undefined
      const disclosure = event.shift ? undefined : this.#disclosureAt(event.row, event.column)
      this.#disclosurePress = disclosure === undefined ? undefined : { target: disclosure, row: event.row, column: event.column }
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
    } else if (event.action === 'drag') {
      const pressed = this.#workspacePress
      if (pressed !== undefined && (event.shift || event.row !== pressed.row || Math.abs(event.column - pressed.column) > 1)) this.#workspacePress = undefined
      // Motion confined to the empty gutter is click jitter. Once it leaves,
      // selection owns the gesture even if the pointer returns to the arrow.
      if (event.shift || this.#pressedDisclosureAt(event.row, event.column) === undefined) {
        this.#disclosurePress = undefined
        this.#selection.move(event)
      }
    } else {
      const pressed = this.#workspacePress
      this.#workspacePress = undefined
      const region = pressed === undefined ? undefined : this.#fileRegionAt(event.row)
      if (!event.shift && pressed !== undefined && event.row === pressed.row && Math.abs(event.column - pressed.column) <= 1
        && region?.block === pressed.block && region.file === pressed.file && this.#state.blocks[pressed.block] === pressed.source) {
        this.#selection.clear()
        this.#openWorkspaceReview(pressed.source, pressed.file)
        return
      }
      const target = this.#pressedDisclosureAt(event.row, event.column)
      this.#disclosurePress = undefined
      if (!event.shift && target !== undefined) {
        this.#selection.clear()
        this.#activateDisclosure(target)
        return
      }
      const text = this.#selection.release(event)
      if (text !== undefined && this.#copyOnSelect) void this.#copySelection()
    }
    this.#render()
  }

  #handleTrajectoryMouse(event: Extract<KeyEvent, { type: 'mouse' }>): void {
    if (event.button === 'right') {
      if (event.action === 'press' && this.#selection.active) void this.#copySelection()
      return
    }
    if (event.action === 'press') {
      this.#trajectoryPress = { row: event.row, column: event.column,
        text: stripAnsi(this.#renderer.viewport()[event.row] ?? ''), dragged: event.shift }
      this.#selection.begin(this.#renderer.viewport(), event, Date.now(), event.shift)
    } else if (event.action === 'drag') {
      if (this.#trajectoryPress !== undefined) this.#trajectoryPress.dragged = true
      this.#selection.move(event)
    } else {
      const press = this.#trajectoryPress
      this.#trajectoryPress = undefined
      const text = this.#selection.release(event)
      if (text !== undefined) {
        if (this.#copyOnSelect) void this.#copySelection()
      } else if (press !== undefined && !press.dragged && !event.shift && press.row === event.row
        && Math.abs(press.column - event.column) <= 1
        && stripAnsi(this.#renderer.viewport()[event.row] ?? '') === press.text) {
        if (this.#fileBrowser !== null) this.#fileBrowser.click(event.row, event.column, this.#term.width(), this.#term.height())
        else if (this.#trajectory !== null) this.#trajectory = trajectoryClick(this.#trajectory, this.#term.width(), this.#term.height(), event.row, event.column)
      }
    }
    this.#render()
  }

  #applyTrajectoryInput(event: KeyEvent): void {
    const state = this.#trajectory
    if (state === null) return
    const { pageSize } = trajectoryListMetrics(state, this.#term.height(), this.#term.width())
    const { pageLines } = trajectoryDetailMetrics(state, this.#term.height())
    const theme = createTheme(this.#colors, this.#colorDepth, this.#themeName, this.#terminalColors, resolveUiLanguage(this.#uiLanguage), this.#compactLinks)
    const maxDetailScroll = trajectoryDetailScrollLimit(state, theme, this.#term.width(), this.#term.height())
    const command = applyTrajectoryEvent(state, event, { pageSize, detailPageLines: pageLines, width: this.#term.width(), maxDetailScroll })
    if ('close' in command) { this.#trajectory = null; this.#trajectoryPress = undefined }
    else if ('copy' in command) {
      void this.#deliverCopy(command.copy).then(delivery => {
        if (this.#trajectory === state) { this.#trajectory = { ...state, notice: delivery === 'requested' ? 'Sent to terminal clipboard' : `Copied ${command.label}` }; this.#render() }
      }, () => {
        if (this.#trajectory === state) { this.#trajectory = { ...state, notice: 'Copy failed' }; this.#render() }
      })
    } else this.#trajectory = command.state
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
    try {
      const delivery = await this.#deliverCopy(text)
      if (!this.#disposed && this.#selection.text() === text) {
        this.#showTransientStatus(delivery === 'requested' ? 'Selection sent to terminal clipboard' : 'Copied selection')
      }
    }
    catch {
      if (!this.#disposed && this.#selection.text() === text) this.#showTransientStatus('Copy failed')
    }
  }

  #canQuoteSelection(): boolean {
    return this.#prompt === null && this.#settings === null && this.#trajectory === null && this.#fileBrowser === null && this.#search === null
      && this.#transcriptSearch === null && (this.#inspected === undefined || this.#inspected.writable === true)
  }

  #quoteSelection(): void {
    if (!this.#canQuoteSelection()) return
    const text = this.#selection.valid(this.#renderer.viewport()) ? this.#selection.text() : undefined
    this.#selection.clear()
    if (text !== undefined) {
      this.#appendQuote(text.split('\n').map(line => '> ' + line).join('\n'))
    }
    this.#render()
  }

  #appendQuote(text: string): void {
    this.#editor.setCursor(this.#editor.text.length)
    this.#editor.paste((this.#editor.text === '' ? '' : '\n\n') + text + '\n\n')
    this.#processSelection = undefined
    this.#refreshAutocomplete()
    this.#showTransientStatus('Quoted in composer')
    this.#render()
  }

  /** Explicit process selection wins; scrolling through an open detail follows that tool. */
  #currentTool(): Extract<Block, { kind: 'tool' }> | undefined {
    const detail = this.#fileActionFrame?.transcript?.disclosures?.findLast(target =>
      target.detailEnd !== undefined && this.#scrollStart > target.row && this.#scrollStart < target.detailEnd)
    const selected = this.#processSelection
    const row = selected === undefined ? undefined : this.#blockStarts[selected]
    const selectedVisible = row !== undefined && row >= this.#scrollStart && row < this.#scrollStart + this.#scrollBudget - 1
    const index = selectedVisible ? selected : detail?.block ?? selected ?? this.#viewportBlock()
    const block = index === undefined ? undefined : this.#state.blocks[index]
    return block?.kind === 'tool' ? block : undefined
  }

  async #openToolActions(block = this.#currentTool()): Promise<void> {
    if (this.#fileReviewAbort !== undefined || this.#search !== null || this.#prompt !== null || this.#settings !== null) return
    if (block === undefined) { this.#showTransientStatus(uiText(resolveUiLanguage(this.#uiLanguage), 'No tool selected · use {key}', { key: keysForAction(this.#keybindings, 'toggle-tools') }), 4_000); return }
    const command = toolCommand(block)
    const files = blockFileAction(block)
    const source = toolSource(block)
    const options = [
      ...(command === undefined ? [] : [{ label: 'Copy command', value: 'command', description: command.split('\n')[0] ?? '' }]),
      ...(block.output.trim() === '' ? [] : [{ label: 'Copy result', value: 'result' }]),
      ...(files === undefined ? [] : [{ label: 'View file', value: 'files' }]),
      ...(source === undefined ? [] : [{ label: 'Copy source', value: 'source-copy', description: source.label },
        ...(this.#canQuoteSelection() ? [{ label: 'Quote source', value: 'source-quote', description: source.label }] : [])]),
    ]
    if (options.length === 0) { this.#showTransientStatus('No content available for this tool.', 4_000); return }
    const abort = new AbortController()
    this.#fileReviewAbort = abort
    try {
      const answer = await this.prompt({ localize: ['title'], title: 'Tool actions', question: toolActionContext(block),
        options: options.map(option => ({ ...option, label: uiText(resolveUiLanguage(this.#uiLanguage), option.label) })), allowCustom: false, notify: false, signal: abort.signal, onSuperseded: () => { abort.abort() } })
      if (abort.signal.aborted || this.#disposed) return
      if (answer === 'command' && command !== undefined) await this.#copyPicked(command, 'command')
      else if (answer === 'result') await this.#copyPicked(block.output, 'tool result')
      else if (answer === 'source-copy' && source !== undefined) await this.#copyPicked(source.text, 'source')
      else if (answer === 'source-quote' && source !== undefined && this.#canQuoteSelection()) this.#appendQuote(sourceQuote(source))
      else if (answer === 'files' && files !== undefined) {
        this.#fileReviewAbort = undefined
        this.#openFileAction(files)
      }
    } catch (error) {
      if (!abort.signal.aborted && !this.#disposed) this.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
    } finally { if (this.#fileReviewAbort === abort) this.#fileReviewAbort = undefined }
  }

  #openWorkspaceReview(block: Block, file?: number): void {
    const handler = this.#workspaceReview
    const sessionId = this.#inspected?.id ?? this.#sessionId
    if (handler === undefined || sessionId === undefined || block.kind !== 'workspace' || !this.#tty || this.#disposed
      || this.#prompt !== null || this.#fileReviewAbort !== undefined) return
    const abort = new AbortController()
    this.#fileReviewAbort = abort
    void handler({ sessionId, turn: block.turn, ...(file === undefined ? {} : { file }), signal: abort.signal })
      .catch(error => { if (!abort.signal.aborted && !this.#disposed) this.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) })
      .finally(() => { if (this.#fileReviewAbort === abort) this.#fileReviewAbort = undefined })
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
    this.#promptActionPress = undefined
    this.#promptChoicePress = undefined
    this.#jumpPress = undefined
    this.#disclosurePress = undefined
    this.#mouseActionPress = undefined
    this.#workspacePress = undefined
    if (this.#keyTest !== undefined && this.#prompt?.request.signal === this.#keyTest.signal
      && (event.type === 'text' || event.type === 'paste-start' || event.type === 'paste-end' || event.type === 'key' && !['escape', 'ctrl+c'].includes(event.id))) {
      this.#keyTest.observe(event)
      return
    }
    if (this.#selection.active) {
      if (event.type === 'key' && this.#boundAction(event.id) === 'quote-selection') { this.#quoteSelection(); return }
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
      if (this.#fileBrowser !== null) { this.#applyFileBrowserInput(event); return }
      if (this.#trajectory !== null) { this.#applyTrajectoryInput(event); return }
      this.#jumpPress = undefined
      if (this.#mouseTracking && !this.#paste && this.#pasteInFlight === 0) {
        const step = wheelStep(this.#wheelGesture, Date.now(), event.direction === 'up' ? -1 : 1, !this.#wheelAccelerates)
        this.#wheelGesture = step.gesture
        if (step.lines !== 0) {
          if (this.#prompt !== null && this.#prompt.request.presentation !== 'document' && this.#prompt.request.presentation !== 'plan-review') {
            if (this.#prompt.request.wait !== undefined && this.#prompt.waitHeld !== true) {
              this.#prompt.request.wait.hold()
              this.#prompt.offTick?.()
              this.#prompt = { ...this.#prompt, waitHeld: true }
            }
            const count = filteredPromptOptions(this.#prompt.request, this.#editor.text, this.#prompt.collapsed).length
            this.#prompt = movePromptSelection(this.#prompt, Math.max(0, Math.min(count - 1, this.#prompt.selected + step.lines)), count) as PendingPrompt
            this.#render()
          } else if (this.#documentMouseEnabled()) this.#scrollPromptDocument(this.#promptDocument!.start + step.lines)
          else this.#scrollBy(step.lines)
        }
      }
      return
    }
    // Clipboard image inspection is asynchronous. Preserve the exact key
    // order so a fast Ctrl+V, Enter submits the finished image draft rather
    // than an empty prompt.
    if (this.#pasteInFlight > 0 && event.type === 'key' && (event.id === 'ctrl+c' || event.id === 'escape')) this.#cancelPaste()
    if (this.#pasteInFlight > 0) {
      this.#deferredPasteEvents.push(event)
      return
    }
    if (this.#paste) {
      if (event.type === 'paste-end') {
        this.#paste = false
        const text = this.#pasteBuf.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
        this.#pasteBuf = ''
        if (text !== '') this.#startAsyncPaste(signal => this.#acceptPastedText(text, signal))
        return
      }
      if (event.type === 'text') this.#pasteBuf += event.value
      else if (event.type === 'key' && event.id === 'enter') this.#pasteBuf += '\r'
      else if (event.type === 'key' && event.id === 'ctrl+j') this.#pasteBuf += '\n'
      else if (event.type === 'key' && event.id === 'tab') this.#pasteBuf += '\t'
      return
    }
    if (event.type === 'paste-start') {
      if (this.#prompt === null && this.#settings === null && this.#trajectory === null && this.#fileBrowser === null) this.#processSelection = undefined
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
    if (this.#fileBrowser !== null) { this.#applyFileBrowserInput(event); return }
    if (this.#trajectory !== null) {
      this.#applyTrajectoryInput(event)
      return
    }
    if (this.#transcriptSearch !== null) {
      this.#applyTranscriptSearch(event)
      return
    }
    if (event.type === 'key' && event.id === 'end' && this.#jumpToLatest !== undefined
      && this.#settings === null && this.#search === null) {
      this.#followTail()
      this.#render()
      return
    }
    if (event.type === 'key') {
      const action = this.#boundAction(event.id)
      if (action !== undefined && this.#runAction(action)) return
    }
    if (this.#inspected !== undefined && this.#inspected.writable !== true && event.type === 'text'
      && this.#prompt === null && this.#settings === null && this.#search === null) {
      return
    }
    if (this.#settings !== null) {
      this.#applySettings(event)
      return
    }
    if (this.#search === null && this.#handleProcessNavigation(event)) return
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
      // Harness retains accepted input; stopping a turn does not withdraw messages.
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
    if (this.#inspected === undefined && this.#shellAbort !== undefined && !this.#hasComposerContent()) {
      this.#shellAbort()
      return true
    }
    if (this.#settings !== null) { this.#settings = null; this.#render(); return true }
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
      for (const listener of this.#interrupts) listener()
      return true
    }
    this.#clearComposerWithUndo()
    return true
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
          this.#finishPrompt(action.valuePrefix + (action.scope === 'list' ? '' : selected!.value ?? selected!.label), 'action')
          this.#render()
        }
        return true
      }
    }
    const toggleAnswer = prompt.request.answerFormat === 'json' && event.type === 'key' && event.id === 'ctrl+g'
    const toggleSpace = event.type === 'text' && event.value === ' ' && (prompt.request.answerFormat !== 'json' || this.#editor.text === '')
    if (prompt.request.multiSelect === true && (toggleAnswer || toggleSpace)) {
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
    if (keyAction !== undefined && (keyAction.scope === 'list' || filtered[prompt.selected] !== undefined)) {
      if (!disarmed) {
        const selected = filtered[prompt.selected]
        if (keyAction.scope === 'list' || selected !== undefined) {
          this.#finishPrompt(keyAction.valuePrefix + (keyAction.scope === 'list' ? '' : selected!.value ?? selected!.label), 'action')
          this.#render()
        }
      }
      return true
    }
    if (event.id === 'escape' || event.id === 'ctrl+c') {
      /**
       * Escape gives back one layer: an active filter clears before the card
       * closes.
       *
       * Only the tree used to do this, so a filtered `/model` or `/copy` closed
       * outright and a reader who wanted their list back had to reopen it.
       */
      if (event.id === 'escape' && prompt.request.filterable === true && this.#editor.text !== '') {
        const selected = filtered[prompt.selected]?.value ?? filtered[prompt.selected]?.label
        this.#editor.setText('')
        const restored = filteredPromptOptions(prompt.request, '', prompt.collapsed)
        const at = restored.findIndex(option => (option.value ?? option.label) === selected)
        this.#prompt = {
          ...prompt,
          ...(prompt.request.presentation === 'tree' ? { collapsed: new Set() } : {}),
          selected: Math.max(0, at),
          previewScroll: 0,
        }
        this.#render()
        return true
      }
      this.#finishPrompt(null)
      this.#render()
      return true
    }
    if (prompt.request.presentation === 'tree' && (event.id === 'left' || event.id === 'right')) {
      this.#prompt = movePromptTree(prompt, event.id, this.#editor.text) as PendingPrompt
      this.#render()
      return true
    }
    if (prompt.request.presentation === 'tree' && (event.id === 'ctrl+up' || event.id === 'ctrl+down')) {
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
    const page = prompt.request.presentation === 'tree'
      ? promptTreePageSize(prompt.request, this.#term.width(), this.#term.height(), resolveUiLanguage(this.#uiLanguage)) : 10
    const navigation = listNavigation(event)
    if (navigation.kind === 'move' || navigation.kind === 'page') {
      // The tree clamps: its rows are a structure, and wrapping past the last
      // branch lands the reader somewhere unrelated to the one they left.
      const wrap = prompt.request.presentation !== 'tree'
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
      // Supplementary text can answer a question even with no checked options.
      if (answer === null && !(prompt.request.answerFormat === 'json' && this.#editor.expandedText.trim())) return true
      this.#finishPrompt(answer ?? '', 'selection')
      this.#render()
      return true
    }
    if (event.id === 'enter' && prompt.request.filterable === true) {
      const answer = selectedFilteredPromptAnswer(prompt, this.#editor.text)
      // A heading under a filter is still a heading: clearing the query and
      // closing on it would lose both the list and the filter.
      if (answer === null) return true
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
    if (!document && prompt.request.allowCustom !== false && event.type === 'key' && (event.id === 'ctrl+x' || this.#boundAction(event.id) === 'external-editor')) {
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
      this.#scrollPromptDocument(documentScroll)
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
      if (document || answer === approve || prompt.request.allowCustom === false) {
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
    const rows = (): string[] => {
      const theme = createTheme(this.#colors, this.#colorDepth, this.#themeName, this.#terminalColors, resolveUiLanguage(this.#uiLanguage), this.#compactLinks)
      const width = Math.max(1, this.#term.width() - 6)
      return prompt.renderDocument?.(theme, width) ?? documentRows(prompt.request, theme, width)
    }
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
    const layout = documentLayout(source, createTheme(this.#colors, this.#colorDepth, this.#themeName, this.#terminalColors, resolveUiLanguage(this.#uiLanguage), this.#compactLinks), Math.max(1, this.#term.width() - 6), {
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
    const agents = rosterItems(this.#subagents)
    if (this.#subagentSelection !== undefined) {
      if (agents.length === 0) { this.#subagentSelection = undefined; return false }
      const at = Math.min(this.#subagentSelection, agents.length - 1)
      if (event.type === 'key' && event.id === 'enter') {
        this.#subagentSelection = undefined
        const item = agents[at]!
        if (item.kind === 'agent') this.#openSelectedSubagent(item.agent)
        else for (const listener of this.#workflowInspects) listener(item.run.id)
        return true
      }
      if (event.type === 'key' && event.id === 'escape') {
        this.#subagentSelection = undefined
        this.#render()
        return true
      }
      if (event.type === 'key' && (event.id === 'up' || event.id === 'down')) {
        const delta = event.id === 'up' ? -1 : 1
        // `up` from the first row leaves the bar; `down` stops at the last one.
        if (at + delta < 0) this.#subagentSelection = undefined
        else this.#subagentSelection = Math.min(agents.length - 1, at + delta)
        this.#render()
        return true
      }
      return true
    }
    if (agents.length === 0 || event.type !== 'key' || event.id !== 'down') return false
    if (this.#editor.text !== '' || this.#images.count > 0 || this.#historyIndex !== 0 || this.#ac !== null) return false
    if (this.#queuedSubmissions.length > 0 || this.#queueEditNewer !== null || this.#queueEditPending) return false
    this.#subagentSelection = Math.min(agents.length - 1, Math.max(0, rosterPreviewStart(this.#subagents)))
    this.#render()
    return true
  }

  /**
   * Open what the selected row has.
   *
   * A local child has a transcript to read, so `Enter` swaps the view. An external
   * child has none by construction — its results land in the parent session — so
   * `Enter` prints its status and recent activity as a fold-able transcript
   * result instead of opening a surface for it.
   */
  #openSelectedSubagent(agent: TuiSubagentView): void {
    if (agent.mode === 'external') {
      this.commandOutput(`Agent · ${agent.label}`, [
        `${agent.phase === 'completed' ? 'Completed' : agent.phase === 'error' ? 'Failed' : 'Running'} · ${formatAgentElapsed(agent)}`,
        '',
        `Mode: ${agent.mode}`,
        `Session: ${agent.id}`,
        `Parent: ${agent.parentId ?? 'root session'}`,
        `Depth: ${agent.depth}`,
        ...(agent.workflow === undefined ? [] : [`Workflow: ${agent.workflow.name}`, `Phase: ${agent.workflow.phase ?? '—'}`]),
        ...(agent.activity.length === 0 ? [] : ['', 'Recent activity', ...agent.activity.map(item => `${item.status.padEnd(8)} ${item.text}`)]),
        '',
        'An external agent keeps no local transcript; its results arrive in this session.',
      ].join('\n'))
      return
    }
    this.#openInspect(agent.id)
    this.#render()
  }

  #closeInspect(): void {
    if (this.#inspected === undefined) return
    // Keep one exit gesture inside the inspector even when repeated Escape
    // bytes are decoded after the parent view has already been restored.
    this.#inspectEscapeFenceUntil = Date.now() + DOUBLE_ESCAPE_MS
    for (const listener of this.#inspectCloses) listener()
  }


  #applyPrefs(prefs: TuiPrefs, options: { persist: boolean; forceToolsSync: boolean }): void {
    const previous = options.persist ? this.prefs() : undefined
    const version = this.#prefsVersion
    const previousMotion = this.#motion
    this.#workspacePress = undefined
    this.#uiLanguage = prefs.uiLanguage ?? 'auto'
    if (this.#prompt !== null) this.#prompt = { ...this.#prompt, request: localizePrompt(this.#prompt.sourceRequest, resolveUiLanguage(this.#uiLanguage)) }
    this.#themeName = prefs.theme
    this.#colors = prefs.colors
    this.#syncColorDepth()
    this.#motion = prefs.motion ?? 'full'
    this.#flushPasteBurst(true)
    this.#busyEnter = prefs.busyEnter ?? 'queue'
    this.#pasteProtection = prefs.pasteProtection !== false
    this.#externalEditor = prefs.editor ?? 'auto'
    this.#terminalTitle = prefs.terminalTitle ?? 'status'
    this.#terminalState = prefs.terminalState ?? 'auto'
    this.#copyOnSelect = prefs.copyOnSelect ?? true
    this.#mathMode = prefs.mathMode ?? 'auto'
    this.#mermaidMode = prefs.mermaidMode ?? 'auto'
    this.#hideThinking = prefs.hideThinking !== false
    this.#showFileChanges = prefs.showFileChanges !== false
    this.#mouseInteraction = prefs.mouseInteraction ?? 'auto'
    this.#checkUpdates = prefs.checkUpdates ?? true
    this.#startupChangelog = prefs.startupChangelog ?? 'summary'
    this.#notificationPolicy = resolveNotificationMode(prefs.notifications, prefs.notificationFocus)
    if (this.#notificationPolicy === 'off') this.#notificationQueue.clear()
    this.#configureNotifications()
    this.#syncWindowTitle()
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
      if (command.name === 'manage-goal') { this.#openGoal(); return }
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
    const slashResult = slashSuggestions(this.#editor.text, this.#editor.cursor, commands, resolveUiLanguage(this.#uiLanguage))
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
    this.#expandedReasoning.clear()
    this.#closedReasoning.clear()
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
    try { process.kill(process.pid, 'SIGTSTP') } catch {
      this.#takeBackTerminal()
      this.#render()
    }
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

  #cancelQueueRecall(): void {
    this.#queueRecall?.abort.abort()
    this.#queueRecall = undefined
    this.#queueEditPending = false
  }

  #requestQueueRecall(): void {
    const abort = new AbortController()
    const request: TuiQueueEditRequest = { signal: abort.signal, ...(this.#draftScope === undefined ? {} : { sessionId: this.#draftScope }) }
    this.#queueRecall = { abort, request }
    this.#queueEditPending = true
    for (const listener of this.#queueEdits) listener(request)
  }

  #restoreLatestQueuedSubmission(allowNonEmpty = false): boolean {
    if (this.#inspected !== undefined && !this.#inspected.writable) return false
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
      this.#requestQueueRecall()
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
    this.#requestQueueRecall()
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
    const markers = this.#files.snapshot(this.#editor.text).entries.map(item => item.marker)
    const ranges = this.#images.ranges()
    for (const [index, marker] of markers.entries()) {
      const start = text.indexOf(marker)
      if (start < 0) continue
      const end = start + marker.length
      ranges.push({ kind: 'file', index, start: start > 0 && text[start - 1] === ' ' ? start - 1 : start,
        end: text[end] === ' ' ? end + 1 : end })
    }
    const segments = images.length === 0 && files.length === 0 ? []
      : splitComposerAttachmentMarkers(text, images, markers, images.length > 0 && text === this.#editor.expandedText ? ranges : undefined)
    const submittedText = images.length === 0 ? this.#files.text(text)
      : segments.flatMap(segment => segment.kind === 'text' ? [segment.text] : []).join('')
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

  #dispatchInput(submission: TuiSubmission): void {
    const receipt = this.#pendingInputs.identify(submission, this.#pendingScope())
    receipt.recovered = false
    if (this.#inspected !== undefined) {
      this.#pendingInputs.take(submission, this.#pendingScope())
      for (const listener of this.#inspectSubmits) listener(submission)
    } else if (this.#pending !== null) {
      const pending = this.#pending
      this.#pending = null
      pending.offAbort?.()
      this.#pendingInputs.take(submission, this.#pendingScope())
      pending.resolve(submission)
    } else this.#queuedSubmissions.push(submission)
    this.#pendingInputs.flush(this.#pendingScope())
  }

  #submit(text: string, delivery?: 'queue' | 'steer'): void {
    if (this.#prompt !== null) {
      if (this.#prompt.request.presentation === 'progress') return
      const answer = this.#prompt.request.preserveWhitespace === true ? text : text.trim()
      this.#finishPrompt(answer.trim() === '' ? null : answer)
      this.#render()
      return
    }
    if (this.#inspected !== undefined) {
      this.#submitInspect(text, delivery)
      return
    }
    const { submission, historyText } = this.#buildSubmission(text)
    const { images, files = [], text: submittedText } = submission
    const queueEditNewer = this.#queueEditNewer
    // Commands keep their own routing; recalled follow-ups remain next-turn messages.
    if (delivery === 'steer') submission.literal = true
    const command = !submission.literal && (submittedText.trimStart().startsWith('/') || (images.length === 0 && files.length === 0 && submittedText.startsWith('!')))
    if (!command && this.#state.status === 'running') {
      submission.delivery = queueEditNewer !== null || this.#queueEditPending ? 'queue' : delivery ?? this.#busyEnter
    }
    if (historyText !== '' && this.#history[this.#history.length - 1] !== historyText) {
      this.#history.push(historyText)
      this.#historyStore?.add(historyText)
    }
    this.#historyIndex = 0
    this.#draft = ''
    this.#literalInput = false
    this.#queueEditNewer = null
    this.#cancelQueueRecall()
    this.#editor.setText('')
    this.#images.clear()
    this.#files.clear()
    this.#ac = null
    this.#search = null
    this.#settings = null
    this.#trajectory = null
    // Image placeholders are TUI-owned. Mixed image+slash drafts stay a
    // submission so restore can keep the original markers; the runner strips
    // them only to detect and execute Harness commands.
    const slash = !submission.literal && images.length === 0 && files.length === 0 ? parseSlashInput(submittedText) : null
    if (slash !== null) {
      if (queueEditNewer !== null) this.#queuedSubmissions.push(...queueEditNewer)
      this.#runSlash(slash.name, slash.args)
      this.#clearDraft()
      return
    }
    this.#followTail()
    if (submittedText !== '' || images.length > 0 || files.length > 0 || this.#pending !== null) this.#dispatchInput(submission)
    if (queueEditNewer !== null) this.#queuedSubmissions.push(...queueEditNewer)
    if (submittedText !== '' || images.length > 0 || files.length > 0) {
      this.#popStashedDraft()
    }
    this.#pendingInputs.flush(this.#pendingScope())
    this.#clearDraft()
    this.#render()
  }

  #submitInspect(text: string, delivery?: 'queue' | 'steer'): void {
    if (this.#inspected?.writable !== true) return
    const { submission, historyText } = this.#buildSubmission(text)
    const newer = this.#queueEditNewer
    if (delivery === 'steer') submission.literal = true
    submission.delivery = newer !== null || this.#queueEditPending ? 'queue' : this.#state.status === 'running' ? delivery ?? this.#busyEnter : 'queue'
    const { images, files = [], literal = false, text: submittedText } = submission
    if (historyText !== '' && this.#history[this.#history.length - 1] !== historyText) {
      this.#history.push(historyText)
      this.#historyStore?.add(historyText)
    }
    this.#queueEditNewer = null
    this.#cancelQueueRecall()
    this.#historyIndex = 0
    this.#draft = ''
    this.#literalInput = false
    this.#editor.setText('')
    this.#images.clear()
    this.#files.clear()
    this.#ac = null
    this.#search = null
    const slash = !literal && images.length === 0 && files.length === 0 ? parseSlashInput(submittedText) : null
    if (slash !== null) {
      this.#queueEditNewer = newer
      this.#runSlash(slash.name, slash.args)
      return
    }
    this.#followTail()
    if (submittedText === '' && images.length === 0 && files.length === 0 && !newer?.length) {
      this.#render()
      return
    }
    const { literal: _literal, ...inspectSubmission } = submission
    if (submittedText !== '' || images.length > 0 || files.length > 0) {
      this.#dispatchInput(inspectSubmission)
    }
    for (const draft of newer ?? []) {
      this.#dispatchInput({ ...draft, delivery: 'queue' })
    }
    this.#pendingInputs.flush(this.#pendingScope())
    this.#clearDraft()
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
    if (command.name === 'queue' && this.#inspected !== undefined) {
      this.#runAction('manage-queue')
      return
    }
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
      this.#dispatchInput({ text: raw, images: [] })
      this.#render()
      return
    }
    if (command.name === 'help') {
      if (args !== '' && args !== 'full') this.notice('Usage: /help [full]')
      else this.#runHelp(args === 'full')
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
    this.#render()
  }


  #commands(): readonly SlashCommand[] {
    const localNames = new Set(BUILTIN_SLASH_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]))
    const runtime: SlashCommand[] = this.#runtimeCommands
      .filter((command) => !localNames.has(command.name))
    return [...BUILTIN_SLASH_COMMANDS, ...runtime]
  }

  #finishPrompt(answer: string | null, kind: 'text' | 'selection' | 'action' = 'text'): void {
    const pending = this.#prompt
    if (pending === null) return
    this.#cancelPaste()
    const draft = structuredPromptAnswer(pending, this.#editor.expandedText)
    try { pending.request.onAnswerDraft?.(draft) }
    catch (error) { this.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
    if (answer !== null && pending.request.answerFormat === 'json' && kind !== 'action' && this.#tty) {
      answer = JSON.stringify(kind === 'selection' ? draft : { selected: [], ...(answer === '' ? {} : { custom: answer }) })
    }
    if (pending.browserState !== undefined) {
      const selected = filteredPromptOptions(pending.request, this.#editor.text, pending.collapsed)[pending.selected]
      pending.browserState.query = this.#editor.text
      if (selected !== undefined) pending.browserState.selected = selected.value ?? selected.label
    }
    this.#prompt = null
    this.#promptActionPress = undefined
    this.#promptChoicePress = undefined
    this.#selection.clear()
    this.#wheelGesture = IDLE_WHEEL
    if (pending.request.notify !== false) {
      this.#herdr.promptResolved()
      if (this.#herdr.programStatus.state !== 'blocked') this.#notificationQueue.clear('blocked')
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
    const displaced: DisplacedSurface | null = this.#fileBrowser !== null
      ? { kind: 'fileBrowser', browser: this.#fileBrowser }
      : this.#trajectory !== null
      ? { kind: 'trajectory', state: this.#trajectory }
      : this.#settings !== null
        ? { kind: 'settings', state: this.#settings }
        : this.#search !== null ? { kind: 'search', state: this.#search } : null
    this.#fileBrowser = null
    this.#trajectory = null
    this.#settings = null
    this.#search = null
    return displaced
  }

  /** Restore the surface displaced by the settled prompt, if one existed. */
  #restoreDisplacedSurface(): void {
    const displaced = this.#promptDisplaced
    this.#promptDisplaced = null
    if (displaced === null) return
    if (displaced.kind === 'fileBrowser') this.#fileBrowser = displaced.browser
    else if (displaced.kind === 'trajectory') this.#trajectory = displaced.state
    else if (displaced.kind === 'settings') {
      this.#settings = displaced.state
      this.#rebuildSettings(this.#pluginSettings?.entries() ?? [])
      this.#refreshSettingsCatalog()
    } else this.#search = displaced.state
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
    /**
     * The same card as every other list.
     *
     * This used to be a bespoke overlay with its own key model: a filter that
     * stayed inactive until `/` — so typing a letter did nothing and Space
     * copied — and a nine-row hotkey table of its own. It was the last surface
     * that did not answer to the shared list vocabulary, which is exactly the
     * inconsistency the reader noticed.
     */
    const answer = await this.prompt({ localize: true,
      title: 'Copy',
      question: items.length === 1 ? 'One thing to copy' : 'Choose what to copy',
      filterable: true,
      allowCustom: false,
      notify: false,
      options: items.map(item => ({
        label: item.label,
        value: item.id,
        ...(item.hint === '' ? {} : { description: item.hint }),
        // The preview is the payload: choosing blind is what the row labels
        // cannot prevent when two replies open with the same words.
        preview: item.text,
      })),
    })
    if (answer === null) return
    const picked = items.find(item => item.id === answer)
    if (picked === undefined) return
    void this.#copyPicked(picked.text, picked.copyMessage)
  }

  #runSettings(args: string): void {
    if (args.trim() !== '') {
      this.#notice('Usage: /settings')
      this.#render()
      return
    }
    this.#search = null
    this.#ac = null
    this.#cancelPaste()
    this.#settings = createSettings(this.prefs(), undefined, this.#agentBehavior, this.#features, this.#pluginSettings?.entries(), discoverEditors(this.#externalEditor), this.#settingsActions())
    this.#refreshSettingsCatalog()
    this.#render()
  }

  #settingsActions(): SettingItem[] {
    const runtimeActions = [
      { id: 'command:model', behavior: 'Session + Profile · Choose scope in Model', group: 'Models', subgroup: 'Model selection', label: 'Model and reasoning', description: 'Choose the current model and reasoning effort. Save as the default or use for this session.', value: [this.#model, this.#reasoningEffort].filter(Boolean).join(' · '), values: [], action: 'model' },
      { id: 'command:permission', behavior: 'Current session · Applies now', group: 'General', subgroup: 'Session controls', label: 'Current session access', description: 'Changes only this session. Default access controls future sessions.', value: this.#sessionControls?.permission ?? 'Choose', values: [], action: 'permission' },
      { id: 'command:agent', behavior: 'Current session · Before the first prompt', group: 'Agent presets', subgroup: 'Current session', label: 'Current session preset', description: 'Choose before the first prompt; does not change the new-session default.', value: this.#sessionControls?.agentPreset === undefined ? 'Choose' : formatAgentPreset(this.#sessionControls.agentPreset), values: [], action: 'agent' },
      { id: 'command:login', behavior: 'Accounts and API keys', group: 'Models', subgroup: 'Accounts and API keys', label: 'Sign in / add API key', description: 'Sign in to a provider account or save an API key.', keywords: ['Provider credentials', 'login', 'API key', 'OAuth'], value: 'Choose provider', values: [], action: 'login' },
      { id: 'command:logout', behavior: 'Accounts and API keys', group: 'Models', subgroup: 'Accounts and API keys', label: 'Sign out / remove key', description: 'Choose a provider or account to sign out or remove locally saved credentials.', keywords: ['logout', 'credentials'], value: 'Choose provider', values: [], action: 'logout' },
      { id: 'command:plugins', group: 'Plugins', subgroup: 'Plugin management', label: 'Manage plugins', description: 'Inspect installed entries, enable bundles, discover plugins or start Creator.', value: 'Open', values: [], action: 'plugins' },
    ].filter(item => this.#runtimeCommands.some(command => command.name === item.action))
    const customBindings = Object.entries(this.#keybindings).filter(([key, action]) => DEFAULT_KEYBINDINGS[key] !== action).length
    return [
      ...runtimeActions,
      ...(this.#goalHandler === undefined ? [] : [{ id: 'action:goal', behavior: 'Current session · Applies now', group: 'General' as const, subgroup: 'Session controls', label: 'Current goal', description: 'Edit, pause, resume or clear this session’s goal.', value: 'Open', values: [], action: 'manage-goal' }]),
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
      language: resolveUiLanguage(this.#uiLanguage),
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
      if (this.#session.handedOff) return
      // Re-read focus at delivery time: the reader may have come back inside the
      // coalescing window, and a turn finishing while they watch is not news.
      if (this.#notificationPolicy === 'unfocused' && this.#terminalFocused === true) return
      if (pending.programState !== undefined && pending.programState !== this.#herdr.programStatus.state) return
      if (this.#reportsProgramState && programStatusNeedsAttention(this.#herdr.programStatus.state)) {
        this.#syncWindowTitle(true)
        return
      }
      const sequence = terminalNotificationSequence(pending)
      if (sequence !== '') this.#term.output.write(sequence)
    }, 25)
  }

  #runHelp(full: boolean): void {
    if (!this.#tty) {
      this.commandOutput('help', ['Help', '', '## Essential Shortcuts', '', formatEssentialHotkeysText(this.#keybindings),
        '', formatHelpText(this.#commands(), resolveUiLanguage(this.#uiLanguage)),
        ...(full ? ['', formatHotkeysText(this.#keybindings)] : ['', 'Use `/help full` to view every keyboard shortcut.'])].join('\n'))
      return
    }
    if (this.#fileReviewAbort !== undefined || this.#prompt !== null) return
    const abort = new AbortController()
    this.#fileReviewAbort = abort
    const surface = {
      prompt: (request: TuiPrompt) => this.prompt({ ...request, signal: abort.signal, onSuperseded: () => { abort.abort() } }),
      copyText: (text: string, label?: string) => this.copyText(text, label),
      insertText: (text: string) => this.insertText(text),
    }
    void browseHelp(surface, this.#commands(), this.#keybindings, resolveUiLanguage(this.#uiLanguage), full, abort.signal)
      .catch(error => { if (!abort.signal.aborted && !this.#disposed) this.notice(String(error), { level: 'error' }) })
      .finally(() => { if (this.#fileReviewAbort === abort) this.#fileReviewAbort = undefined })
  }

  async #readCommandOutput(block: Extract<Block, { kind: 'commandOutput' }>): Promise<void> {
    if (this.#fileReviewAbort !== undefined || this.#prompt !== null || this.#disposed) return
    const abort = new AbortController()
    this.#fileReviewAbort = abort
    try {
      await readReference({
        prompt: request => this.prompt({ ...request, signal: abort.signal, onSuperseded: () => { abort.abort() } }),
        copyText: (text, label) => this.copyText(text, label),
      }, `/${block.command}`, block.text, abort.signal)
    } catch (error) {
      if (!abort.signal.aborted && !this.#disposed) this.notice(String(error), { level: 'error' })
    } finally { if (this.#fileReviewAbort === abort) this.#fileReviewAbort = undefined }
  }

  /** Open the searchable catalog, retaining plain output for line mode. */
  #runTools(): void {
    if (!this.#tty) {
      this.commandOutput('tools', `Tools · ${this.#tools.length} active\n\n${formatToolsText(this.#tools)}`)
      return
    }
    if (this.#fileReviewAbort !== undefined || this.#prompt !== null) return
    const abort = new AbortController()
    this.#fileReviewAbort = abort
    void browseTools({
      prompt: request => this.prompt({ ...request, signal: abort.signal, onSuperseded: () => { abort.abort() } }),
      copyText: (text, label) => this.copyText(text, label),
    }, this.#tools, resolveUiLanguage(this.#uiLanguage), abort.signal)
      .catch(error => { if (!abort.signal.aborted && !this.#disposed) this.notice(String(error), { level: 'error' }) })
      .finally(() => { if (this.#fileReviewAbort === abort) this.#fileReviewAbort = undefined })
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
    if (this.#prompt !== null || this.#settings !== null) return false
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
    if (action === 'manage-goal') { this.#openGoal(); return true }
    if (action === 'manage-queue') {
      if (this.#queueHandler === undefined) this.notice('Queue management is unavailable in this profile.')
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
      if (this.#inspected !== undefined && !this.#inspected.writable) return true
      if (this.#state.status !== 'running') {
        this.notice('Steering needs an active turn. Use Enter to send the next message.')
      } else if (this.#queueEditNewer !== null || this.#queueEditPending) {
        this.notice('Finish editing the queued follow-up with Enter before steering.')
      } else if (this.#editor.expandedText.trim() !== '' || this.#images.count > 0 || this.#files.copies().length > 0) {
        this.#submit(this.#editor.expandedText, 'steer')
      }
      return true
    }
    if (action === 'quote-selection') return true
    if (action === 'tool-actions') {
      const anchor = this.#viewportBlock()
      const block = anchor === undefined ? undefined : this.#state.blocks[anchor]
      if (block?.kind === 'commandOutput') void this.#readCommandOutput(block)
      else void this.#openToolActions()
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
      const block = this.#currentTool() ?? this.#state.blocks[region?.block ?? (this.#viewportBlock() ?? this.#state.blocks.length - 1)]
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
    if (action === 'retry') {
      if (!this.#canContinue()) return true
      const request = { sessionId: this.#sessionId!, failureSeq: this.#sessionControls!.continuation! }
      this.#continuing = true
      void this.#continueHandler!(request).catch(error => {
        if (!this.#disposed && this.#sessionId === request.sessionId) this.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
      }).finally(() => { this.#continuing = false; if (!this.#disposed) this.#render() })
      this.#render()
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
      this.#startAsyncPaste(signal => this.#pasteClipboard(signal))
      return true
    }
    // Explicit queue delivery is independent of the busy-Enter preference.
    if (action === 'follow-up') {
      if (this.#editor.expandedText.trim() === '' && this.#images.count === 0 && this.#files.copies().length === 0) return false
      this.#submit(this.#editor.expandedText, 'queue')
      return true
    }
    if (action !== 'external-editor') return false
    try {
      this.#handTerminal(() => {
        this.#literalInput ||= this.#editor.startsWithPaste
        const text = editExternally(this.#editor.expandedText, this.#externalEditor)
        while (this.#editor.expandPaste()) { /* Keep marker positions aligned with expanded source. */ }
        this.#editor.replaceText(text)
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
      if (this.#queueEditNewer !== null) this.#queuedSubmissions.push(...this.#queueEditNewer)
      this.#queueEditNewer = null
      this.#cancelQueueRecall()
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

  async #testKeys(): Promise<boolean> {
    const abort = new AbortController()
    // Reuse browsing cancellation: approvals and session switches own the terminal.
    this.#fileReviewAbort = abort
    this.#keyTest = { signal: abort.signal, observe: event => {
      const pending = this.#prompt
      const detail = keyTestDescription(event, this.#keybindings, resolveUiLanguage(this.#uiLanguage))
      if (pending?.request.signal !== abort.signal || detail === undefined) return
      pending.sourceRequest = { ...pending.sourceRequest, detail }
      pending.request = localizePrompt(pending.sourceRequest, resolveUiLanguage(this.#uiLanguage))
      this.#render()
    } }
    try {
      await this.prompt({ localize: true, title: 'Key test', presentation: 'progress',
        question: 'Press a key. Esc or Ctrl+C returns without changing bindings.',
        detail: uiText(resolveUiLanguage(this.#uiLanguage), 'If nothing appears, the terminal or operating system may have intercepted the key.'),
        allowCustom: false, notify: false, signal: abort.signal, onSuperseded: () => { abort.abort() } })
    } finally {
      if (this.#keyTest?.signal === abort.signal) this.#keyTest = undefined
      if (this.#fileReviewAbort === abort) this.#fileReviewAbort = undefined
    }
    return !abort.signal.aborted
  }

  async #editKeybindings(): Promise<void> {
    if (this.#keybindingsPath === undefined) return
    while (!this.#disposed) {
      const options = [
        { label: 'Test keys', value: '__test_keys__', description: 'See what the terminal sends without running an action.' },
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
      const choice = await this.prompt({ localize: true,
        title: 'Keybindings',
        question: 'Choose an action to remap, or Esc to return to /settings.',
        options,
        filterable: true,
        allowCustom: false,
        notify: false,
      })
      if (choice === null || this.#disposed) break
      if (choice === '__test_keys__') { if (!await this.#testKeys()) break; continue }
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
      const entered = await this.prompt({ localize: true,
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
     * A long command result and a collapsed side answer fold the same way, and
     * this is the key that opens either. It is answered before the run lookup
     * because neither is a run: the reader aimed at those rows, not at the run
     * above them.
     */
    const anchored = anchor === undefined ? undefined : this.#state.blocks[anchor]
    if (anchor !== undefined && (anchored?.kind === 'commandOutput' || anchored?.kind === 'aside' || (anchored?.kind === 'notice' && anchored.detail !== undefined))) {
      if (this.#expandedOutputs.has(anchored)) this.#expandedOutputs.delete(anchored)
      else this.#expandedOutputs.add(anchored)
      this.#inspect(anchor)
      this.#focusBlock = anchor
      this.#focusBlockEdge = 'start'
      this.#render()
      return
    }
    const groups = turnGroups(this.#state)
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
      const scope = this.#detailScope(group)
      for (const member of groups) if (this.#detailScope(member) === scope) this.#openedGroups.add(member.key)
      const rows = this.#processRows()
      this.#processSelection = rows.includes(anchor!) ? anchor : rows[0]
      this.#ac = null
      this.#inspect(this.#processSelection ?? group.start)
      this.#focusBlock = this.#processSelection ?? group.start
      this.#focusBlockEdge = 'start'
      this.#render()
      return
    }

  }

  /** The process list follows durable block order and grows without moving selection. */
  #processRows(): number[] {
    return turnGroups(this.#state).filter(group => this.#openedGroups.has(group.key)).flatMap(group =>
      this.#state.blocks.slice(group.start, group.until).flatMap((block, offset) =>
        block.kind === 'tool' || block.kind === 'assistant' && block.reasoning.trim() !== ''
          ? [group.start + offset] : []))
  }

  #handleProcessNavigation(event: KeyEvent): boolean {
    const selected = this.#processSelection
    if (selected === undefined) return false
    if (event.type === 'text' || event.type === 'paste-start') {
      this.#processSelection = undefined
      return false
    }
    if (event.type !== 'key') return false
    if (event.id === 'escape' || event.id === 'end') {
      this.#followTail()
      this.#render()
      return true
    }
    if (event.id === 'home') {
      const current = this.#fileActionFrame?.transcript?.disclosures?.findLast(target =>
        target.detailEnd !== undefined && this.#scrollStart > target.row && this.#scrollStart < target.detailEnd)
      this.#processSelection = current?.block ?? selected
      this.#focusBlock = this.#processSelection
      this.#focusBlockEdge = 'start'
      this.#render()
      return true
    }
    if (event.id === 'up' || event.id === 'down') {
      const rows = this.#processRows()
      const at = Math.max(0, rows.indexOf(selected))
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (event.id === 'up' ? -1 : 1)))]
      if (next !== undefined) {
        this.#processSelection = next
        const row = this.#blockStarts[next]
        if (row === undefined || row < this.#scrollStart || row >= this.#scrollStart + this.#scrollBudget - 1) {
          this.#focusBlock = next
          this.#focusBlockEdge = 'start'
        }
      }
      this.#render()
      return true
    }
    if (!['enter', 'left', 'right'].includes(event.id)) return false
    this.#toggleProcessItem(selected, event.id)
    return true
  }

  #toggleProcessItem(selected: number, direction: string): void {
    const block = this.#state.blocks[selected]
    if (block?.kind === 'tool') {
      const visible = this.#detailedToolIds()
      const wasOpen = visible.has(block.callId)
      const open = direction === 'right' || direction !== 'left' && !wasOpen
      const raw = this.#detailedToolIds(false).has(block.callId)
      if (wasOpen && !open) {
        const target = this.#fileActionFrame?.transcript?.disclosures?.find(item => item.block === selected)
        const offset = target?.detailEnd !== undefined && this.#scrollStart >= target.row && this.#scrollStart < target.detailEnd
          ? this.#scrollStart - target.row : 0
        this.#toolReadingPositions.set(block.callId, { offset, width: this.#term.width(), raw })
      }
      if (open !== wasOpen) {
        const saved = open ? this.#toolReadingPositions.get(block.callId) : undefined
        this.#focusBlock = selected
        this.#focusBlockEdge = 'start'
        // Width changes and raw/readable switches change the row layout.
        this.#focusBlockOffset = saved?.width === this.#term.width() && saved.raw === raw ? saved.offset : 0
      }
      // Once a reader edits one disclosure, preserve the other visible calls as
      // individual choices instead of letting the turn-wide override reopen it.
      this.#expandedToolRows = new Set(visible)
      this.#detailedTurns.clear()
      if (open) this.#expandedToolRows.add(block.callId)
      else this.#expandedToolRows.delete(block.callId)
    } else if (block?.kind === 'assistant') {
      const key = reasoningKey(block)
      const open = direction === 'right' || direction !== 'left' && !this.#visibleReasoning().has(key)
      if (open) { this.#expandedReasoning.add(key); this.#closedReasoning.delete(key) }
      else { this.#expandedReasoning.delete(key); this.#closedReasoning.add(key) }
    }
    const row = this.#blockStarts[selected]
    if (row === undefined || row < this.#scrollStart || row > this.#scrollStart + Math.floor(this.#scrollBudget / 2)) {
      this.#focusBlock = selected
      this.#focusBlockEdge = 'start'
    }
    this.#render()
  }

  #visibleReasoning(): ReadonlySet<string> {
    const open = new Set(this.#expandedReasoning)
    if (!this.#hideThinking) for (const block of this.#state.blocks) {
      if (block.kind === 'assistant') open.add(reasoningKey(block))
    }
    for (const key of this.#closedReasoning) open.delete(key)
    return open
  }

  #detailScope(group: ProcessGroup): string {
    return group.turn === undefined ? group.key : `turn:${group.turn}`
  }

  #detailedToolIds(includeReadable = true): ReadonlySet<string> {
    const calls = new Set<string>(includeReadable ? this.#expandedToolRows : [])
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
    for (const at of tools) {
      const block = this.#state.blocks[at]
      if (block?.kind === 'tool') this.#expandedToolRows.delete(block.callId)
    }
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
      language: resolveUiLanguage(this.#uiLanguage),
      colors: this.#colors,
      themeName: this.#themeName,
      terminal: this.#terminalColors,
      compactLinks: this.#compactLinks,
      ...(this.#colorDepth === undefined ? {} : { colorDepth: this.#colorDepth }),
      mathMode: this.#mathMode,
      mermaidMode: this.#mermaidMode,
      toolsExpanded: this.#toolsExpanded,
      expandedOutputs: this.#expandedOutputs,
      hideThinking: true,
      showFileChanges: this.#showFileChanges,
      expandedTools: this.#detailedToolIds(),
      expandedReasoning: this.#visibleReasoning(),
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
  // A missing route must be visible without turning the startup header into a
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
      uiLanguage: config.uiLanguage.get(),
      theme: config.theme.get(),
      colors: resolveColors(config.colors.get(), term.output.isTTY === true),
      motion: config.motion.get(),
      mathMode: config.mathMode.get(),
      mermaidMode: config.mermaidMode.get(),
      showFileChanges: config.showFileChanges.get(),
      editor: config.editor.get(),
      terminalTitle: config.terminalTitle.get(),
      terminalState: config.terminalState.get(),
      copyOnSelect: config.copyOnSelect.get(),
      mouseInteraction: config.mouseInteraction.get(),
      busyEnter: config.busyEnter.get(),
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
