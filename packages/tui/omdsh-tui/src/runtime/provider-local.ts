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
  terminalNotificationSequence,
  terminalProgressSequence,
} from './terminal-notifications.ts'

import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { StringDecoder } from 'node:string_decoder'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  TUI_SERVICE,
  type TuiAgentBehaviorSettings,
  type TuiAgentBehaviorSettingsBinding,
  type TuiCommand,
  type TuiPrompt,
  type TuiNoticeOptions,
  type TuiRecentSession,
  type TuiService,
  type TuiSessionControls,
  type TuiSessionStats,
  type TuiStatus,
  type TuiInputImage,
  type TuiInspectedSubagent,
  type TuiLoopStatus,
  type TuiSubagentRoster,
  type TuiSubmission,
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
  nextSelectableAutocompleteIndex,
  searchAtSuggestions,
  type FileSearcher,
  type SessionSearcher,
} from '../views/at-complete.ts'
import { copyToClipboard, readFromClipboard, type ClipboardReader, type ClipboardWriter } from '../input/clipboard.ts'
import {
  applyCopySelectorEvent,
  createCopySelector,
  type CopySelectorState,
} from '../views/copy-selector.ts'
import { buildCopyTargets, extractCopyTarget, parseCopyKind } from '../views/copy-targets.ts'
import {
  applyHistorySearchEvent,
  createHistorySearch,
  type HistorySearchState,
} from '../views/history-search.ts'
import { type EditorCommand, InputEditor, lineEnd, lineStart } from '../input/editor.ts'
import {
  applySettingsEvent,
  createSettings,
  type SettingsState,
  type TuiPrefs,
} from '../views/settings-list.ts'
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
  blockLines,
  blockSearchText,
  initialTranscript,
  replayEvents,
  renderView,
  TRANSCRIPT_FAST_SCROLL,
  type Block,
  type StreamDelta,
  type TranscriptState,
} from '../views/event-views.ts'
import {
  applyTranscriptSearchEvent,
  createTranscriptSearch,
  searchBlockIndexes,
  type TranscriptSearchState,
} from '../views/transcript-search.ts'
import {
  nextRevealStep,
  revealStreamingAssistant,
  streamingAssistantKey,
  streamingAssistantUnits,
} from '../views/streaming-reveal.ts'
import { flushPending, parseKeys, type KeyEvent } from '../input/keys.ts'
import { type RenderSink } from '../chrome/renderer.ts'
import { MainScreenRenderer } from '../chrome/main-screen-renderer.ts'
import { colorDisabledByEnv, createTheme, detectTrueColor, parseThemeName, type ThemeName } from '../chrome/theme.ts'
import type { ToolInfo } from '../chrome/tools-list.ts'
import { renderTool, type TuiToolPresentation } from '../chrome/tool-renderers.ts'
import { TUI_SETTINGS_NAMESPACE, TuiSettingsSchema, type MotionMode } from '../session/tui-settings.ts'
import { defaultStatusBarConfig, resolveStatusBarConfig, type StatusBarConfig } from '../chrome/status-config.ts'
import { HistoryStore } from '../views/history-store.ts'
import { loadKeybindings, type TuiAction } from '../input/keybindings-config.ts'
import { editExternally } from '../input/external-editor.ts'
import type {} from '@deepseek-ai/dsh-settings'
import {
  movePromptSelection,
  filteredPromptOptions,
  selectedPromptAnswer,
  selectedFilteredPromptAnswer,
  togglePromptSelection,
  type PromptSelectorState,
} from '../views/prompt-selector.ts'
import { refreshProjectContext, resolveProjectContext } from '../session/project-context.ts'
import { pickWelcomeTips, type WelcomeTip } from '../chrome/welcome-tips.ts'
import { formatEssentialHotkeysText, formatHotkeysText, hotkeyCount } from '../views/hotkeys.ts'
import {
  imageMarker,
  imagePathCandidates,
  probeImageDimensions,
  stripComposerImageMarkers,
  readImageFile,
  readImageFromClipboard,
  readMacClipboardFiles,
  type ClipboardFileReader,
  type ClipboardImageReader,
  type ImagePathReader,
} from '../input/image-paste.ts'
import { APP_NAME, APP_VERSION } from '../session/package-metadata.ts'
import type { StartupChangelogMode } from '../session/release-notes.ts'

const DOUBLE_CTRL_C_MS = 500
const DOUBLE_ESCAPE_MS = 500
const STREAMING_REVEAL_MS = 1000 / 30
const TERMINAL_PROGRESS_KEEPALIVE_MS = 1_000

function shortenPath(cwd: string): string {
  const home = homedir()
  if (cwd === home) return '~'
  // Windows separates with `\`, so the home prefix check follows the host.
  if (cwd.startsWith(home + sep)) return '~' + cwd.slice(home.length)
  return cwd
}

/** Maximum code points written into the OSC 2 window title. */
const WINDOW_TITLE_MAX = 120

/**
 * Make a session title safe for an OSC 2 write: control characters are
 * replaced so a title cannot terminate or inject the escape sequence, and the
 * payload is bounded without splitting a surrogate pair.
 */
function windowTitleText(title: string | undefined): string {
  if (title === undefined) return ''
  const cleaned = title.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim()
  return [...cleaned].slice(0, WINDOW_TITLE_MAX).join('')
}

export const name = 'omdsh-tui'

/** Plugin config: the model label shown on the status line. */
export interface Config {
  /** Model name for the status line. */
  model: string
  /** Emit SGR color sequences; defaults to the output stream's tty-ness, minus `NO_COLOR` / `FORCE_COLOR=0`. */
  colors?: boolean
  /** Shipped palette; defaults to dark. */
  theme?: string
  /** Optional JSONL prompt-history path. */
  historyPath?: string
  /** Optional `{ key-id: action }` JSON file. */
  keybindingsPath?: string
}

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

type PendingRead = {
  resolve: (submission: TuiSubmission | null) => void
  signal?: AbortSignal | null
  /** Detaches this read's abort listener once the read settles. */
  offAbort?: () => void
}
type PendingPrompt = PromptSelectorState & {
  resolve: (answer: string | null) => void
  offAbort?: () => void
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

export class LocalTui implements TuiService {
  #deferInitialRender = false
  readonly #terminalProfile: 'direct' | 'multiplexer' | 'conpty'
  readonly #resizeDebounceMs: number
  #resizeTimer: ReturnType<typeof setTimeout> | null = null
  readonly #streamRenderMs: number
  #streamRenderTimer: ReturnType<typeof setTimeout> | null = null
  readonly #term: TerminalLike
  #model: string
  #reasoningEffort: string | undefined
  #colors: boolean
  #themeName: ThemeName
  readonly #tty: boolean
  readonly #renderer: MainScreenRenderer
  #state: TranscriptState = initialTranscript()
  readonly #editor = new InputEditor()
  #history: string[] = []
  #historyIndex = 0
  #draft = ''
  #ac: { items: AutocompleteItem[]; selected: number } | null = null
  #search: HistorySearchState | null = null
  #transcriptSearch: TranscriptSearchState | null = null
  #settings: SettingsState | null = null
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
  #paste = false
  #pasteBuf = ''
  #pasteInFlight = 0
  #deferredPasteEvents: KeyEvent[] = []
  #images: TuiInputImage[] = []
  #lineReader: Interface | null = null
  #plainPending: PendingRead | null = null
  #plainClosed = false
  #plainPrinted = 0
  #offData: (() => void) | null = null
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
  #follow = true
  #focusBlock: number | undefined
  #expandTools = false
  #motion: MotionMode = 'full'
  #terminalProgress = false
  #terminalProgressActive = false
  #terminalProgressTick: ReturnType<typeof setInterval> | null = null
  #checkUpdates = true
  #startupChangelog: StartupChangelogMode = 'summary'
  #notifications = new TerminalNotificationController()
  #notificationPolicy: 'off' | 'long-running' | 'always' = 'off'
  #notificationThreshold: '15s' | '30s' | '1m' | '2m' = '30s'
  #statusBar: StatusBarConfig = defaultStatusBarConfig()
  #toolsExpanded = false
  #expandedToolCalls = new Set<string>()
  #tools: ToolInfo[] = []
  #runtimeCommands: TuiCommand[] = []
  #prompt: PendingPrompt | null = null
  /**
   * The overlay surface displaced by an in-flight prompt: while a human
   * prompt owns the keyboard, its screen must not compete with a stale
   * trajectory/hub surface that accepts invisible confirmations. Restored
   * when the prompt settles.
   */
  #promptDisplaced: DisplacedSurface | null = null
  #recentSessions: TuiRecentSession[] = []
  readonly #welcomeTips: readonly WelcomeTip[]
  #sessionId: string | undefined
  #sessionTitle: string | undefined
  #writtenWindowTitle: string | undefined
  #sessionStats: TuiSessionStats | undefined
  #sessionControls: TuiSessionControls | undefined
  #loopStatus: TuiLoopStatus | undefined
  #subagents: TuiSubagentRoster | undefined
  #subagentLauncherFocused = false
  #inspected: TuiInspectedSubagent | undefined
  #promptDocument: { start: number; maxStart: number; pageSize: number } | undefined
  /**
   * 24-bit switch for the current color preference, re-derived whenever that
   * preference changes so a session that starts colorless can still enable
   * hexadecimal palettes without a restart.
   */
  #trueColor = false
  readonly #copy: ClipboardWriter
  readonly #readClipboard: ClipboardReader
  readonly #readClipboardImage: ClipboardImageReader
  readonly #readClipboardFiles: ClipboardFileReader
  readonly #readImagePath: ImagePathReader
  readonly #historyStore: HistoryStore | undefined
  readonly #keybindings: Record<string, TuiAction>
  readonly #cwd: string
  readonly #projectRoot: string
  readonly #home: string
  readonly #listDir: DirReader
  readonly #searchFiles: PathSearcher
  #searchFileMentions: FileSearcher | undefined
  #searchSessions: SessionSearcher | undefined
  #validateImageDraft: ((image: TuiInputImage) => Promise<void>) | undefined
  readonly #autocompleteDebounceMs: number
  #persistPrefs: ((prefs: TuiPrefs) => void) | null = null
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
      keybindingsPath?: string
      readClipboard?: ClipboardReader
      readClipboardImage?: ClipboardImageReader
      readClipboardFiles?: ClipboardFileReader
      readImagePath?: ImagePathReader
      deferInitialRender?: boolean
      terminalProfile?: 'direct' | 'multiplexer' | 'conpty'
      alternateScreenOverlays?: boolean
      resizeDebounceMs?: number
      streamRenderMs?: number
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
    this.#keybindings = loadKeybindings(paths.keybindingsPath)
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
    this.#welcomeTips = pickWelcomeTips()
    this.#deferInitialRender = paths.deferInitialRender === true
    this.#terminalProfile = paths.terminalProfile ?? detectTerminalProfile()
    this.#resizeDebounceMs = Math.max(0, paths.resizeDebounceMs ?? 120)
    this.#streamRenderMs = Math.max(0, paths.streamRenderMs ?? 8)
    this.#syncTrueColor()
    this.#tty = term.input.isTTY === true
    this.#pwd = shortenPath(project.root)
    this.#branch = project.gitLabel
    this.#renderer = new MainScreenRenderer(
      { write: (chunk) => { this.#term.output.write(chunk) } },
      {
        width: this.#term.width(),
        height: this.#term.height(),
        synchronized: this.#tty,
        clearScrollback: this.#terminalProfile === 'direct',
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
      term.output.write('\x1b[?2004h')
    }
    this.#render()
  }

  /** Refresh Git workspace metadata after a turn; the footer shows realtime branch/dirty state. */
  #refreshProjectContext(): void {
    const branch = refreshProjectContext(this.#cwd).gitLabel
    if (branch === this.#branch) return
    this.#branch = branch
    if (this.#tty) this.#render()
  }

  event(event: SessionEvent, presentation?: TuiToolPresentation): void {
    this.#state = applyEvent(this.#state, event, presentation)
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
      this.#render()
    } else if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result' || event.type === 'turn/end') {
      this.#printPlain()
    }
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

  setStatus(status: TuiStatus): void {
    if (this.#state.status === 'compacting') return
    this.#state = { ...this.#state, status }
    this.#syncTick()
    if (this.#tty) this.#render()
  }

  setModel(model: string, reasoningEffort?: string): void {
    this.#model = model
    this.#reasoningEffort = reasoningEffort
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
    this.#validateImageDraft = validate
  }

  toolCallContext(callId: string): string | undefined {
    const block = this.#state.blocks.findLast(
      candidate => candidate.kind === 'tool' && String(candidate.callId) === callId,
    )
    if (block?.kind !== 'tool') return undefined
    // Reuse the card renderer so a decision explains the call the same way the
    // transcript already does. The approval prompt renders its detail on one
    // line, so the parts are joined here rather than handed over as rows.
    const view = renderTool({
      name: block.name,
      arguments: block.args,
      output: block.output,
      status: block.status,
      expanded: false,
      ...(block.presentation === undefined ? {} : { presentation: block.presentation }),
    })
    const detail = view.summary === undefined || view.summary === ''
      ? view.input.join(' ').replace(/\s+/gu, ' ').trim()
      : ''
    // A card with a summary already says what the call is. Without one the raw
    // argument text is all there is, and its pretty-printed form would reduce to
    // a lone brace on a single row, so the whole body is folded into one line.
    return [view.title, view.summary, detail === '' ? undefined : detail]
      .filter((part): part is string => part !== undefined && part !== '')
      .join(' · ')
  }

  notice(text: string, options: TuiNoticeOptions = {}): void {
    const block: Block = {
      kind: 'notice',
      level: options.level ?? 'info',
      text,
      ...(options.framed === true ? { framed: true } : {}),
    }
    this.#state = { ...this.#state, blocks: [...this.#state.blocks, block] }
    if (this.#tty) this.#render()
    else this.#printPlain()
  }

  commandOutput(command: string, text: string): void {
    this.#state = { ...this.#state, blocks: [...this.#state.blocks, { kind: 'commandOutput', command, text }] }
    if (this.#tty) this.#render()
    else this.#printPlain()
  }

  prompt(request: TuiPrompt): Promise<string | null> {
    if (this.#prompt !== null) return Promise.reject(new Error('omdsh-tui: prompt already in flight'))
    if (this.#disposed || request.signal?.aborted === true) return Promise.resolve(null)
    this.#emitNotification(this.#notifications.humanPrompt())
    this.#editor.setText('')
    this.#ac = null
    const displaced = this.#displaceSurface()
    return new Promise((resolve) => {
      const selected = Math.max(0, request.options?.findIndex(option =>
        (option.value ?? option.label) === request.initialValue) ?? 0)
      const pending: PendingPrompt = { request, selected, checked: new Set(), resolve }
      if (request.signal !== undefined) {
        const onAbort = (): void => { this.#finishPrompt(null) }
        request.signal.addEventListener('abort', onAbort, { once: true })
        pending.offAbort = () => { request.signal?.removeEventListener('abort', onAbort) }
      }
      this.#prompt = pending
      this.#promptDisplaced = displaced
      if (this.#tty) {
        this.#render()
      } else {
        const lines = [request.question]
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
        this.notice(`${request.title}\n${lines.join('\n')}`)
      }
    })
  }

  replaceSession(
    events: readonly SessionEvent[],
    presentations?: ReadonlyMap<number, TuiToolPresentation>,
    status: TuiStatus = 'idle',
  ): void {
    this.#trajectory = null
    const state = replayEvents(events, presentations)
    this.#state = { ...state, status, compactCommandId: undefined }
    this.#plainPrinted = 0
    this.#followTail()
    this.#deferInitialRender = false
    this.#renderer.startEpoch({ replay: status === 'idle' ? 'full' : 'pinned' })
    if (this.#tty) this.#render()
    else this.#printPlain()
  }

  setSession(info: {
    id: string
    title?: string
    recent: readonly TuiRecentSession[]
    stats?: TuiSessionStats
    controls?: TuiSessionControls
  }): void {
    this.#sessionId = info.id
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
    if (!this.#tty) return
    this.#syncWindowTitle()
    if (this.#reveal !== undefined && this.#motion !== 'off') return
    if (this.#streamRenderMs > 0 && this.#busy()) this.#scheduleStreamRender()
    else this.#render()
  }

  /**
   * Mirror the folded session title into the terminal's own window/tab title.
   * Control characters are stripped so a title can never inject an escape
   * sequence, and the payload is bounded to keep tab strips readable.
   */
  #syncWindowTitle(): void {
    const title = windowTitleText(this.#sessionTitle)
    if (title === this.#writtenWindowTitle) return
    this.#writtenWindowTitle = title
    this.#term.output.write(`\x1b]2;${title}\x07`)
  }

  /**
   * Re-derive the 24-bit switch from the active color preference. Every path
   * that changes `#colors` calls this so `/settings` takes effect immediately.
   */
  #syncTrueColor(): void {
    this.#trueColor = this.#colors && detectTrueColor()
  }

  /** Apply prefs loaded from the settings document (does not persist). */
  applyStoredPrefs(prefs: TuiPrefs): void {
    const previousMotion = this.#motion
    this.#themeName = prefs.theme
    this.#colors = prefs.colors
    this.#syncTrueColor()
    this.#motion = prefs.motion ?? 'full'
    this.#terminalProgress = prefs.terminalProgress ?? false
    this.#expandTools = prefs.expandTools
    this.#checkUpdates = prefs.checkUpdates ?? true
    this.#startupChangelog = prefs.startupChangelog ?? 'summary'
    this.#notificationPolicy = prefs.notifications ?? 'off'
    this.#notificationThreshold = prefs.notificationThreshold ?? '30s'
    this.#configureNotifications()
    this.#statusBar = resolveStatusBarConfig(prefs.statusBar, prefs.statusPreset)
    this.#toolsExpanded = prefs.expandTools
    if (previousMotion !== this.#motion) {
      this.#stopRevealTick()
      this.#reveal = undefined
    }
    this.#syncTick()
    if (this.#settings !== null) this.#settings = { ...this.#settings, prefs }
    if (this.#tty) this.#render()
  }

  /** Called after a live `/settings` change. */
  setPrefsPersist(persist: (prefs: TuiPrefs) => void): void {
    this.#persistPrefs = persist
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
      if (this.#settings !== null) this.#settings = createSettings(this.#prefs())
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
    if (!this.#tty) return this.#readlinePlain(signal)
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
    const currentText = this.#editor.text
    const currentImages = this.#images
    let rebasedCurrent = currentText
    for (let index = currentImages.length - 1; index >= 0; index -= 1) {
      const image = currentImages[index] as TuiInputImage
      rebasedCurrent = rebasedCurrent.replaceAll(
        imageMarker(index, image),
        imageMarker(index + submission.images.length, image),
      )
    }
    const separator = submission.text !== '' && rebasedCurrent !== '' ? '\n' : ''
    this.#images = [...submission.images.map(image => ({ ...image })), ...currentImages]
    this.#editor.setText(submission.text + separator + rebasedCurrent)
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  resolveQueueEdit(submission: TuiSubmission | null): void {
    if (!this.#queueEditPending) return
    this.#queueEditPending = false
    if (submission === null) {
      if (this.#editor.text === '' && this.#images.length === 0 && this.#queueEditNewer?.length === 0) {
        this.#queueEditNewer = null
      }
      return
    }
    if (this.#queueEditNewer === null) this.#queueEditNewer = []
    if (this.#editor.text !== '' || this.#images.length > 0) {
      this.#queueEditNewer.unshift(this.#currentSubmission())
    }
    this.#replaceInput(submission)
  }

  #currentSubmission(): TuiSubmission {
    return {
      text: this.#editor.text,
      images: this.#images.map(image => ({ ...image })),
    }
  }

  #replaceInput(submission: TuiSubmission): void {
    this.#images = submission.images.map(image => ({ ...image }))
    this.#editor.setText(submission.text)
    this.#historyIndex = 0
    this.#refreshAutocomplete()
    if (this.#tty) this.#render()
  }

  onInterrupt(listener: () => void): () => void {
    this.#interrupts.add(listener)
    return () => { this.#interrupts.delete(listener) }
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

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
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
    this.#setTerminalProgress(false)
    if (this.#loopTick !== null) {
      clearInterval(this.#loopTick)
      this.#loopTick = null
    }
    if (this.#tty) {
      this.#offData?.()
      this.#offResize?.()
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
      this.#term.output.write('\x1b[?2004l\x1b[?25h\r\n')
      if (this.#resumeHintRequested && this.#sessionId !== undefined) {
        this.#term.output.write(`\r\nResume this session with ${APP_NAME} --resume ${this.#sessionId}\r\n`)
      }
      // A tty stdin keeps the event loop alive after the tree disposes;
      // release the descriptor so natural completion can exit the process.
      this.#term.input.destroy?.()
    }
    if (this.#escapeTimer !== null) clearTimeout(this.#escapeTimer)
    if (this.#autocompleteTimer !== null) clearTimeout(this.#autocompleteTimer)
    this.#autocompleteAbort?.abort()
    this.#autocompleteTimer = null
    this.#autocompleteAbort = null
    this.#lineReader?.close()
    this.#offAgentBehaviorWatch?.()
    this.#offAgentBehaviorWatch = undefined
    this.#settlePending(null)
    this.#finishPrompt(null)
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

  #readlinePlain(signal?: AbortSignal): Promise<TuiSubmission | null> {
    return new Promise((resolve) => {
      if (this.#lineReader === null) {
        this.#lineReader = createInterface({ input: this.#term.input })
        // Permanent listeners: once() handlers would auto-pause the input
        // stream after one line and miss the EOF close.
        this.#lineReader.on('line', (line: string) => { this.#plainResolve(line) })
        this.#lineReader.on('close', () => {
          this.#plainClosed = true
          this.#plainResolve(null)
        })
      }
      const pending: PendingRead = { resolve, signal: signal ?? null }
      this.#plainPending = pending
      if (signal !== undefined) {
        const onAbort = (): void => {
          if (this.#plainPending !== pending) return
          this.#plainPending = null
          resolve(null)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        pending.offAbort = () => { signal.removeEventListener('abort', onAbort) }
      }
      this.#pumpPlain()
    })
  }

  /**
   * Queue one readline delivery, then drain. A single stream chunk can carry
   * several lines; every line is buffered until the runner asks for the next
   * read, and EOF waits for the queue before closing the reader.
   */
  #plainResolve(line: string | null): void {
    if (this.#prompt !== null && line !== null) {
      const value = line.trim()
      if (value === '') {
        this.#finishPrompt(null)
      } else if (this.#prompt.request.allowCustom === false) {
        const options = this.#prompt.request.options ?? []
        const numeric = /^\d+$/u.test(value) ? Number(value) - 1 : -1
        const option = numeric >= 0
          ? options[numeric]
          : options.find(item => item.label.toLowerCase() === value.toLowerCase())
        this.#finishPrompt(option?.value ?? option?.label ?? null)
      } else {
        this.#finishPrompt(value)
      }
      return
    }
    if (this.#prompt !== null) this.#finishPrompt(null)
    if (line !== null) this.#plainQueue.push(line)
    this.#pumpPlain()
  }

  /** Resolve the pending plain read from the queue, or close it after EOF drained. */
  #pumpPlain(): void {
    const pending = this.#plainPending
    if (pending === null) return
    const line = this.#plainQueue.shift()
    if (line !== undefined) {
      pending.offAbort?.()
      this.#plainPending = null
      pending.resolve({ text: line, images: [] })
      return
    }
    if (this.#plainClosed) {
      pending.offAbort?.()
      this.#plainPending = null
      pending.resolve(null)
    }
  }

  /** Print plain-mode blocks that settled since the last flush. */
  #printPlain(): void {
    const theme = createTheme(false, false)
    const width = this.#term.width()
    const fresh = this.#state.blocks.slice(this.#plainPrinted)
    let out = ''
    for (const block of fresh) {
      // Pipe / CI output is not a viewport: print the full tool body.
      for (const line of blockLines(block, theme, width, 0, true)) out += line + '\n'
    }
    this.#plainPrinted = this.#state.blocks.length
    if (out !== '') this.#term.output.write(out)
  }

  #busy(): boolean {
    if (this.#state.status !== 'idle') return true
    if (this.#state.blocks.some((block) => block.kind === 'tool' && block.status === 'running')) return true
    return this.#subagents?.agents.some(agent => agent.phase === 'running' || agent.phase === 'starting') === true
  }

  #syncTick(): void {
    if (!this.#tty) return
    const busy = this.#busy()
    this.#setTerminalProgress(this.#terminalProgress && busy)
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

  #setTerminalProgress(active: boolean): void {
    if (!this.#tty) return
    if (active) {
      if (this.#terminalProgressActive) return
      this.#terminalProgressActive = true
      this.#term.output.write(terminalProgressSequence(true))
      this.#terminalProgressTick = setInterval(() => {
        if (!this.#disposed && this.#terminalProgressActive) {
          this.#term.output.write(terminalProgressSequence(true))
        }
      }, TERMINAL_PROGRESS_KEEPALIVE_MS)
      this.#terminalProgressTick.unref?.()
      return
    }
    if (this.#terminalProgressTick !== null) {
      clearInterval(this.#terminalProgressTick)
      this.#terminalProgressTick = null
    }
    if (!this.#terminalProgressActive) return
    this.#terminalProgressActive = false
    this.#term.output.write(terminalProgressSequence(false))
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

  #render(): void {
    if (this.#streamRenderTimer !== null) {
      clearTimeout(this.#streamRenderTimer)
      this.#streamRenderTimer = null
    }
    if (this.#deferInitialRender) return
    const width = this.#term.width()
    const renderState = this.#reveal === undefined
      ? this.#state
      : revealStreamingAssistant(this.#state, this.#reveal.revealed)
    const frame = this.#tty
      ? renderView(renderState, {
        width,
        height: this.#term.height(),
        model: this.#model,
        ...(this.#reasoningEffort === undefined ? {} : { reasoningEffort: this.#reasoningEffort }),
        input: this.#editor.text,
        inputCursor: this.#editor.cursor,
        inputImages: this.#images.length,
        queuedSubmissions: this.#queueEditNewer === null
          ? this.#queuedSubmissions
          : [...this.#queuedSubmissions, ...this.#queueEditNewer],
        colors: this.#colors,
        pwd: this.#pwd,
        ...(this.#branch !== undefined ? { branch: this.#branch } : {}),
        ...(this.#sessionTitle === undefined ? {} : { sessionTitle: this.#sessionTitle }),
        version: APP_VERSION,
        appName: APP_NAME,
        spinnerFrame: this.#spinner,
        motion: this.#motion,
        trueColor: this.#trueColor,
        themeName: this.#themeName,
        scrollStart: this.#follow ? Number.POSITIVE_INFINITY : this.#scrollStart,
        ...(this.#focusBlock === undefined ? {} : { focusBlock: this.#focusBlock }),
        ...(this.#transcriptSearch === null ? {} : {
          transcriptSearch: {
            query: this.#transcriptSearch.query,
            matches: searchBlockIndexes(this.#state.blocks.map(blockSearchText), this.#transcriptSearch.query),
            focus: this.#transcriptSearch.focus,
            editing: this.#transcriptSearch.editing,
          },
        }),
        toolsExpanded: this.#toolsExpanded,
        expandedTools: this.#expandedToolCalls,
        commands: this.#commands(),
        recentSessions: this.#recentSessions,
        welcomeTips: this.#welcomeTips,
        ...(this.#sessionStats === undefined ? {} : { sessionStats: this.#sessionStats }),
        ...(this.#sessionControls === undefined ? {} : { sessionControls: this.#sessionControls }),
        ...(this.#loopStatus === undefined ? {} : { loopStatus: this.#loopStatus }),
        ...(this.#subagents === undefined ? {} : { subagents: this.#subagents }),
        subagentLauncherFocused: this.#subagentLauncherFocused,
        ...(this.#inspected === undefined ? {} : { inspected: this.#inspected }),
        ...(this.#trajectory === null ? {} : { trajectory: this.#trajectory }),
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
    this.#promptDocument = frame.promptDocument
    this.#syncScroll(frame.transcript)
    this.#renderer.render(frame)
  }

  #scheduleStreamRender(): void {
    if (this.#streamRenderTimer !== null) return
    this.#streamRenderTimer = setTimeout(() => {
      this.#streamRenderTimer = null
      if (!this.#disposed) this.#render()
    }, this.#streamRenderMs)
  }

  #syncScroll(scroll: { start: number; maxStart: number; budget: number } | undefined): void {
    if (scroll === undefined) {
      this.#scrollStart = 0
      this.#maxStart = 0
      this.#scrollBudget = 0
      this.#follow = true
      return
    }
    this.#scrollStart = scroll.start
    this.#maxStart = scroll.maxStart
    this.#scrollBudget = scroll.budget
    if (this.#follow || this.#scrollStart >= this.#maxStart) {
      this.#follow = true
      this.#scrollStart = this.#maxStart
    }
  }

  #pageSize(): number {
    return Math.max(1, this.#scrollBudget > 2 ? this.#scrollBudget - 2 : 1)
  }

  #scrollBy(delta: number): void {
    if (delta === 0 && this.#maxStart === 0) return
    this.#follow = false
    this.#scrollStart += delta
    if (this.#scrollStart <= 0) this.#scrollStart = 0
    this.#render()
  }

  #followTail(): void {
    this.#follow = true
    this.#scrollStart = this.#maxStart
  }

  readonly #utf8 = new StringDecoder('utf8')
  readonly #plainQueue: string[] = []
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
    for (const event of events) this.#dispatch(event)
    if (rest === '\x1b') {
      this.#escapeTimer = setTimeout(() => {
        this.#pendingKeys = ''
        this.#escapeTimer = null
        for (const event of flushPending(rest)) this.#dispatch(event)
      }, 80)
    } else if (rest.length > 32) {
      this.#pendingKeys = ''
    }
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
          if (await this.#admitImage(image)) {
            this.#insertImageDraft(image)
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
        this.#insertImageDraft(clipboardImage)
        this.#refreshAutocomplete()
        this.#render()
        return
      }
    }
    this.#editor.handle({ type: 'text', value: text })
    this.#refreshAutocomplete()
    this.#render()
  }

  async #pasteClipboard(): Promise<void> {
    if (this.#search === null && this.#settings === null && this.#copySelector === null) {
      const image = await this.#readClipboardImage()
      if (image !== null) {
        if (await this.#admitImage(image)) {
          this.#insertImageDraft(image)
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
            if (await this.#admitImage(candidate)) {
              this.#insertImageDraft(candidate)
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

  /**
   * Run the Harness image-admission check for one paste candidate. A refusal
   * becomes an error notice and skips the draft, instead of failing the whole
   * submission after the user has typed a prompt around it.
   */
  async #admitImage(image: TuiInputImage): Promise<boolean> {
    if (this.#validateImageDraft === undefined) return true
    try {
      await this.#validateImageDraft(image)
      return true
    } catch (error: unknown) {
      this.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
      return false
    }
  }

  #insertImageDraft(input: TuiInputImage): void {
    const size = input.width === undefined || input.height === undefined
      ? probeImageDimensions(input.data, input.mediaType)
      : undefined
    const image: TuiInputImage = {
      ...input,
      ...(input.width === undefined && size !== undefined ? { width: size.width } : {}),
      ...(input.height === undefined && size !== undefined ? { height: size.height } : {}),
    }
    const marker = imageMarker(this.#images.length, image)
    const before = this.#editor.cursor > 0 && !/\s/u.test(this.#editor.text[this.#editor.cursor - 1] ?? '') ? ' ' : ''
    const after = this.#editor.cursor >= this.#editor.text.length || !/\s/u.test(this.#editor.text[this.#editor.cursor] ?? '')
      ? ' '
      : ''
    this.#images.push(image)
    this.#editor.handle({ type: 'text', value: before + marker + after })
  }

  #removeImageAtCursor(key: 'backspace' | 'delete'): boolean {
    const cursor = this.#editor.cursor
    for (let index = 0; index < this.#images.length; index += 1) {
      const image = this.#images[index] as TuiInputImage
      const marker = imageMarker(index, image)
      const start = this.#editor.text.indexOf(marker)
      if (start < 0) continue
      let from = start
      let to = start + marker.length
      const touches = key === 'backspace'
        ? cursor > start && cursor <= to
        : cursor >= start && cursor < to
      if (!touches) continue
      if (this.#editor.text[to] === ' ') to += 1
      else if (from > 0 && this.#editor.text[from - 1] === ' ') from -= 1
      const oldImages = this.#images
      let text = this.#editor.text.slice(0, from) + this.#editor.text.slice(to)
      const nextImages = oldImages.filter((_, oldIndex) => oldIndex !== index)
      let nextIndex = 0
      for (let oldIndex = 0; oldIndex < oldImages.length; oldIndex += 1) {
        if (oldIndex === index) continue
        const remaining = oldImages[oldIndex] as TuiInputImage
        text = text.replaceAll(imageMarker(oldIndex, remaining), imageMarker(nextIndex, remaining))
        nextIndex += 1
      }
      this.#images = nextImages
      this.#editor.setText(text, Math.min(from, text.length))
      this.#refreshAutocomplete()
      this.#render()
      return true
    }
    return false
  }

  #reconcileImageDrafts(): void {
    if (this.#images.length === 0) return
    const oldImages = this.#images
    const retained = oldImages.filter((image, index) => this.#editor.text.includes(imageMarker(index, image)))
    if (retained.length === oldImages.length) return
    let text = this.#editor.text
    let nextIndex = 0
    for (let oldIndex = 0; oldIndex < oldImages.length; oldIndex += 1) {
      const image = oldImages[oldIndex] as TuiInputImage
      const oldMarker = imageMarker(oldIndex, image)
      if (!text.includes(oldMarker)) continue
      text = text.replaceAll(oldMarker, imageMarker(nextIndex, image))
      nextIndex += 1
    }
    this.#images = retained
    this.#editor.setText(text, Math.min(this.#editor.cursor, text.length))
  }

  #dispatch(event: KeyEvent): void {
    if (this.#state.status === 'compacting') {
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
      else if (event.type === 'key' && (event.id === 'enter' || event.id === 'ctrl+j')) this.#pasteBuf += '\n'
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
    if (event.type === 'key') {
      const action = this.#boundAction(event.id)
      if (action !== undefined && this.#runAction(action)) return
    }
    if (this.#inspected !== undefined && this.#inspected.writable !== true && event.type === 'text'
      && this.#prompt === null && this.#settings === null && this.#copySelector === null && this.#search === null) {
      return
    }
    if (event.type === 'key' && event.id === 'ctrl+c') {
      if (this.#prompt !== null) {
        this.#finishPrompt(null)
        this.#editor.setText('')
        this.#render()
        return
      }
      if (this.#settings !== null) {
        this.#settings = null
        this.#render()
        return
      }
      if (this.#copySelector !== null) {
        this.#copySelector = null
        this.#render()
        return
      }
      if (this.#search !== null) {
        this.#search = null
        this.#render()
        return
      }
      const now = Date.now()
      if (now - this.#lastSigintTime < DOUBLE_CTRL_C_MS) {
        this.#lastSigintTime = 0
        this.#quit()
        return
      }
      this.#lastSigintTime = now
      if (this.#state.status !== 'idle') {
        for (const listener of this.#interrupts) listener()
      } else {
        this.#editor.clear()
        this.#images = []
        this.#historyIndex = 0
        this.#ac = null
        this.#render()
      }
      return
    }
    if (this.#settings !== null) {
      this.#applySettings(event)
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
    if (event.type === 'key' && event.id === 'escape') {
      if (this.#inspected !== undefined) {
        if (this.#inspected.writable === true && (this.#editor.text !== '' || this.#images.length > 0)) {
          this.#editor.clear()
          this.#images = []
          this.#ac = null
          this.#render()
          return
        }
        this.#closeInspect()
        return
      }
      if (this.#state.status !== 'idle' || this.#pending === null
        || this.#editor.text !== '' || this.#images.length > 0) {
        this.#lastEscapeTime = 0
      } else {
        const now = Date.now()
        if (now - this.#lastEscapeTime < DOUBLE_ESCAPE_MS) {
          this.#lastEscapeTime = 0
          for (const listener of this.#rewinds) listener()
        } else {
          this.#lastEscapeTime = now
        }
        return
      }
    }
    if (event.type === 'key' && (event.id === 'backspace' || event.id === 'delete')
      && this.#removeImageAtCursor(event.id)) return
    this.#applyCommand(this.#editor.handle(event))
  }

  #handlePrompt(event: KeyEvent): boolean {
    const prompt = this.#prompt
    if (prompt === null) return false
    if (prompt.request.presentation === 'plan-review') return this.#handlePlanReview(event, prompt)
    if (event.type === 'text' && this.#editor.text === '') {
      const action = prompt.request.actions?.find(item => item.key === event.value)
      const selected = filteredPromptOptions(prompt.request, '')[prompt.selected]
      if (action !== undefined && selected !== undefined) {
        this.#finishPrompt(action.valuePrefix + (selected.value ?? selected.label))
        this.#render()
        return true
      }
    }
    if (event.type === 'text' && event.value === ' ' && prompt.request.multiSelect === true && this.#editor.text === '') {
      this.#prompt = togglePromptSelection(prompt) as PendingPrompt
      this.#render()
      return true
    }
    if (event.type === 'text' && prompt.request.filterable === true) {
      const command = this.#editor.handle(event)
      if (command.kind === 'changed') {
        this.#prompt = { ...prompt, selected: 0 }
        this.#render()
      }
      return true
    }
    if (event.type === 'text' && prompt.request.allowCustom === false) return true
    if (event.type !== 'key') return false
    const filtered = filteredPromptOptions(prompt.request, this.#editor.text)
    const count = filtered.length
    if (event.id === 'escape' || event.id === 'ctrl+c') {
      this.#editor.setText('')
      this.#finishPrompt(null)
      this.#render()
      return true
    }
    if (count === 0) {
      if (prompt.request.filterable !== true) return false
      if (event.id === 'enter') return true
      const command = this.#editor.handle(event)
      if (command.kind === 'changed') {
        this.#prompt = { ...prompt, selected: 0 }
        this.#render()
      }
      return true
    }
    let next: number | undefined
    if (event.id === 'up' || event.id === 'shift+tab') next = prompt.selected - 1
    else if (event.id === 'down' || event.id === 'tab') next = prompt.selected + 1
    else if (event.id === 'pageUp') next = prompt.selected - 10
    else if (event.id === 'pageDown') next = prompt.selected + 10
    else if (event.id === 'home') next = 0
    else if (event.id === 'end') next = count - 1
    if (next !== undefined) {
      this.#prompt = movePromptSelection(prompt, next, count) as PendingPrompt
      this.#render()
      return true
    }
    if (event.id === 'enter' && this.#editor.text === '') {
      const answer = selectedPromptAnswer(prompt)
      if (prompt.request.multiSelect === true && answer === null) return true
      this.#finishPrompt(answer)
      this.#render()
      return true
    }
    if (event.id === 'enter' && prompt.request.filterable === true) {
      this.#finishPrompt(selectedFilteredPromptAnswer(prompt, this.#editor.text))
      this.#editor.setText('')
      this.#render()
      return true
    }
    if (prompt.request.filterable === true) {
      const command = this.#editor.handle(event)
      if (command.kind === 'changed') {
        this.#prompt = { ...prompt, selected: 0 }
        this.#render()
      }
      return true
    }
    return false
  }

  #handlePlanReview(event: KeyEvent, prompt: PendingPrompt): boolean {
    if (prompt.feedback === true) {
      if (event.type === 'key' && event.id === 'ctrl+c') {
        this.#editor.setText('')
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
    if (event.id === 'escape' || event.id === 'ctrl+c') {
      this.#editor.setText('')
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
    else if (event.id === 'end') documentScroll = scroll?.maxStart ?? prompt.documentScroll ?? 0
    if (documentScroll !== undefined) {
      this.#prompt = {
        ...prompt,
        documentScroll: Math.max(0, Math.min(documentScroll, scroll?.maxStart ?? Number.POSITIVE_INFINITY)),
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
      const answer = selectedPromptAnswer(prompt)
      if (answer === null) return true
      const approve = prompt.request.approveValue ?? prompt.request.options?.[0]?.value
        ?? prompt.request.options?.[0]?.label
      if (answer === approve) {
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
    if (this.#editor.text !== '' || this.#images.length > 0 || this.#historyIndex !== 0 || this.#ac !== null) return false
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
    if (agents.length === 0) {
      this.notice('No subagents are available in this session.')
      return
    }
    this.#prompt = null
    this.#settings = null
    this.#copySelector = null
    this.#search = null
    this.#trajectory = null
    this.#ac = null
    this.#agentHub = createAgentHub({ agents })
    this.#render()
  }

  #prefs(): TuiPrefs {
    return {
      theme: this.#themeName,
      colors: this.#colors,
      motion: this.#motion,
      terminalProgress: this.#terminalProgress,
      expandTools: this.#expandTools,
      checkUpdates: this.#checkUpdates,
      startupChangelog: this.#startupChangelog,
      notifications: this.#notificationPolicy,
      notificationThreshold: this.#notificationThreshold,
      statusBar: {
        ...this.#statusBar,
        groups: [...this.#statusBar.groups],
        ...(this.#statusBar.order === undefined ? {} : { order: [...this.#statusBar.order] }),
        ...(this.#statusBar.meta === undefined ? {} : { meta: [...this.#statusBar.meta] }),
        ...(this.#statusBar.metaOrder === undefined ? {} : { metaOrder: [...this.#statusBar.metaOrder] }),
        ...(this.#statusBar.colors === undefined ? {} : { colors: { ...this.#statusBar.colors } }),
        ...(this.#statusBar.sides === undefined ? {} : { sides: { ...this.#statusBar.sides } }),
      },
    }
  }

  #applyPrefs(prefs: TuiPrefs): void {
    const expandChanged = prefs.expandTools !== this.#expandTools
    this.#themeName = prefs.theme
    this.#colors = prefs.colors
    this.#syncTrueColor()
    const previousMotion = this.#motion
    this.#motion = prefs.motion ?? 'full'
    this.#terminalProgress = prefs.terminalProgress ?? false
    this.#expandTools = prefs.expandTools
    this.#checkUpdates = prefs.checkUpdates ?? true
    this.#startupChangelog = prefs.startupChangelog ?? 'summary'
    this.#notificationPolicy = prefs.notifications ?? 'off'
    this.#notificationThreshold = prefs.notificationThreshold ?? '30s'
    this.#configureNotifications()
    this.#statusBar = resolveStatusBarConfig(prefs.statusBar, prefs.statusPreset)
    if (expandChanged) this.#toolsExpanded = prefs.expandTools
    if (previousMotion !== this.#motion) {
      this.#stopRevealTick()
      this.#reveal = undefined
    }
    this.#syncTick()
    this.#persistPrefs?.(prefs)
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
      this.notice(
        `Could not save Agent language: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'error' },
      )
    } finally {
      this.#agentBehaviorPending = false
      if (this.#tty && !this.#disposed) this.#render()
    }
  }

  #applySettings(event: KeyEvent): void {
    if (this.#settings === null) return
    const command = applySettingsEvent(this.#settings, event)
    if (command.kind === 'update') {
      this.#settings = command.state
      this.#render()
      return
    }
    if (command.kind === 'apply') {
      if (command.domain === 'agent') {
        if (this.#agentBehaviorPending || command.state.agent === undefined) return
        this.#agentBehaviorPending = true
        this.#settings = command.state
        this.#render()
        void this.#commitAgentBehavior(command.state.agent)
        return
      }
      this.#settings = command.state
      this.#applyPrefs(command.state.prefs)
      this.#render()
      return
    }
    if (command.kind === 'close') {
      this.#settings = null
      this.#render()
    }
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
      await this.#copy(text)
      this.#notice('Copied ' + label)
    } catch {
      this.#notice('Copy failed')
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
      this.#submit(this.#editor.text)
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
    const harnessAt = at !== undefined
      && (this.#searchFileMentions !== undefined || this.#searchSessions !== undefined)
    if (fuzzyAt || harnessAt) {
      if (harnessAt && !fuzzyAt) {
        this.#setAutocomplete(pathSuggestions(this.#editor.text, this.#editor.cursor, pathOptions, commands))
      } else {
        this.#ac = null
      }
      const text = this.#editor.text
      const cursor = this.#editor.cursor
      this.#autocompleteTimer = setTimeout(() => {
        this.#autocompleteTimer = null
        if (this.#disposed || requestId !== this.#autocompleteRequestId) return
        const controller = new AbortController()
        this.#autocompleteAbort = controller
        const search = this.#searchFileMentions === undefined && this.#searchSessions === undefined
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
            signal: controller.signal,
          }, commands)
        void search.then((result) => {
          if (this.#disposed || controller.signal.aborted || requestId !== this.#autocompleteRequestId) return
          this.#autocompleteAbort = null
          this.#setAutocomplete(result)
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

  #setAutocomplete(result: { items: AutocompleteItem[]; prefix: string } | null): void {
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
    this.#ac = { items: result.items, selected }
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
    this.#editor.setText(next.text, next.cursor)
    this.#refreshAutocomplete()
  }

  #applyCommand(command: EditorCommand): void {
    if (command.kind === 'changed') {
      this.#reconcileImageDrafts()
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
    if (command.kind === 'interrupt') {
      if (this.#state.status === 'running') {
        for (const listener of this.#interrupts) listener()
      }
      return
    }
    if (command.kind === 'clear') {
      this.#editor.clear()
      this.#images = []
      this.#queueEditNewer = null
      this.#queueEditPending = false
      this.#historyIndex = 0
      this.#ac = null
      this.#search = null
      this.#render()
      return
    }
    if (command.kind === 'quit') {
      this.#quit()
      return
    }
    if (command.kind === 'suspend') {
      if (process.platform !== 'win32') {
        try { process.kill(process.pid, 'SIGTSTP') } catch { /* no controlling tty */ }
      }
      return
    }
    if (command.kind === 'resetDisplay') {
      this.#renderer.reset()
      this.#render()
    }
  }

  #historyPrev(): void {
    if (this.#images.length > 0) return
    if (this.#history.length === 0 || this.#historyIndex >= this.#history.length) return
    if (this.#historyIndex === 0) this.#draft = this.#editor.text
    this.#historyIndex += 1
    this.#editor.setText(this.#history[this.#history.length - this.#historyIndex] ?? '')
    this.#refreshAutocomplete()
    this.#render()
  }

  #restoreLatestQueuedSubmission(): boolean {
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
    if (this.#editor.text !== '' || this.#images.length > 0 || this.#historyIndex !== 0) return false
    const submission = this.#queuedSubmissions.pop()
    if (submission !== undefined) {
      this.#queueEditNewer = []
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
    if (this.#images.length > 0) return
    if (this.#historyIndex === 0) return
    this.#historyIndex -= 1
    this.#editor.setText(
      this.#historyIndex === 0 ? this.#draft : (this.#history[this.#history.length - this.#historyIndex] ?? ''),
    )
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

  #submit(text: string): void {
    if (this.#prompt !== null) {
      this.#editor.setText('')
      this.#finishPrompt(text.trim() === '' ? null : text.trim())
      this.#render()
      return
    }
    const images = this.#images.map(image => ({ ...image }))
    const submittedText = images.length > 0 ? text.trim() : text
    const queueEditNewer = this.#queueEditNewer
    const historyText = stripComposerImageMarkers(submittedText, images)
      .replace(/[ \t]{2,}/gu, ' ')
      .trim()
    if (historyText !== '' && this.#history[this.#history.length - 1] !== historyText) {
      this.#history.push(historyText)
      this.#historyStore?.add(historyText)
    }
    this.#historyIndex = 0
    this.#draft = ''
    this.#queueEditNewer = null
    this.#queueEditPending = false
    this.#editor.setText('')
    this.#images = []
    this.#ac = null
    this.#search = null
    this.#settings = null
    this.#copySelector = null
    this.#trajectory = null
    this.#agentHub = null
    this.#followTail()
    // Image placeholders are TUI-owned. Mixed image+slash drafts stay a
    // submission so restore can keep the original markers; the runner strips
    // them only to detect and execute Harness commands.
    const slash = images.length === 0 ? parseSlashInput(submittedText) : null
    if (slash !== null) {
      if (queueEditNewer !== null) this.#queuedSubmissions.push(...queueEditNewer)
      this.#runSlash(slash.name, slash.args)
      return
    }
    const pending = this.#pending
    if (pending !== null) {
      pending.offAbort?.()
      this.#pending = null
      pending.resolve({ text: submittedText, images })
      if (queueEditNewer !== null) this.#queuedSubmissions.push(...queueEditNewer)
    } else if (submittedText !== '' || images.length > 0 || queueEditNewer !== null) {
      if (submittedText !== '' || images.length > 0) {
        this.#queuedSubmissions.push({ text: submittedText, images })
      }
      if (queueEditNewer !== null) this.#queuedSubmissions.push(...queueEditNewer)
    }
    this.#render()
  }

  #submitInspect(text: string): void {
    const images = this.#images.map(image => ({ ...image }))
    const submittedText = images.length > 0 ? text.trim() : text
    const historyText = stripComposerImageMarkers(submittedText, images)
      .replace(/[ \t]{2,}/gu, ' ')
      .trim()
    if (historyText !== '' && this.#history[this.#history.length - 1] !== historyText) {
      this.#history.push(historyText)
      this.#historyStore?.add(historyText)
    }
    this.#historyIndex = 0
    this.#draft = ''
    this.#editor.setText('')
    this.#images = []
    this.#ac = null
    this.#search = null
    this.#followTail()
    const slash = images.length === 0 ? parseSlashInput(submittedText) : null
    if (slash !== null) {
      this.#runSlash(slash.name, slash.args)
      return
    }
    if (submittedText === '' && images.length === 0) {
      this.#render()
      return
    }
    for (const listener of this.#inspectSubmits) listener({ text: submittedText, images })
    this.#render()
  }

  #runSlash(name: string, args = ''): void {
    if (name === '') {
      this.#render()
      return
    }
    const command = resolveSlashCommand(name, this.#commands())
    if (command === undefined) {
      this.#notice('unknown command: /' + name)
      this.#render()
      return
    }
    if (command.name === 'quit') {
      this.#render()
      this.#quit()
      return
    }
    if (command.name === 'clear') {
      // Presentation-only reset: the agent may still own an active turn with
      // live status, todos, and queued inbox state. Clearing those would make
      // the next Ctrl-C (or follow-up) behave as if the session had finished.
      this.#state = { ...this.#state, blocks: [] }
      this.#followTail()
      this.#renderer.startEpoch()
      this.#render()
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
    if (command.name === 'tools') {
      this.#toolCatalog()
      this.#render()
      return
    }
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
    if (args !== '' && args !== 'full') {
      this.#notice('Usage: /help [full]')
      this.#render()
      return
    }
    const full = args === 'full'
    this.#state = {
      ...this.#state,
      blocks: [...this.#state.blocks, {
        kind: 'commandOutput',
        command: 'help',
        text: [
          formatHelpText(this.#commands()),
          '',
          full
            ? `**Keyboard Shortcuts · ${hotkeyCount(this.#keybindings)} shortcuts**`
            : '**Essential Shortcuts**',
          '',
          full
            ? formatHotkeysText(this.#keybindings)
            : formatEssentialHotkeysText(this.#keybindings),
          ...(full ? [] : ['', 'Use `/help full` to view every keyboard shortcut.']),
        ].join('\n'),
      }],
    }
    this.#focusLatestBlock()
    this.#render()
  }

  #commands(): readonly SlashCommand[] {
    const localNames = new Set(BUILTIN_SLASH_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]))
    const runtime: SlashCommand[] = this.#runtimeCommands
      .filter((command) => !localNames.has(command.name))
      .map((command) => ({
        name: command.name,
        description: command.description,
        ...(command.inputHint === undefined ? {} : { inputHint: command.inputHint }),
      }))
    return [...BUILTIN_SLASH_COMMANDS, ...runtime]
  }

  #finishPrompt(answer: string | null): void {
    const pending = this.#prompt
    if (pending === null) return
    this.#prompt = null
    pending.offAbort?.()
    pending.resolve(answer)
    this.#restoreDisplacedSurface()
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
    else if (displaced.kind === 'settings') this.#settings = displaced.state
    else if (displaced.kind === 'copySelector') this.#copySelector = displaced.state
    else this.#search = displaced.state
  }

  async #runCopy(args: string): Promise<void> {
    if (args.trim() === '') {
      const items = buildCopyTargets(this.#state.blocks)
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
      return
    }
    const kind = parseCopyKind(args)
    if (kind === undefined) {
      this.#notice('Usage: /copy [code|cmd]')
      this.#render()
      return
    }
    const target = extractCopyTarget(this.#state.blocks, kind)
    if (target === undefined) {
      this.#notice(kind === 'code' ? 'No code block to copy.' : kind === 'cmd' ? 'No command to copy.' : 'Nothing to copy.')
      this.#render()
      return
    }
    await this.#copyPicked(target.text, target.label)
  }

  #runSettings(args: string): void {
    if (args.trim() !== '') {
      this.#notice('Usage: /settings')
      this.#render()
      return
    }
    this.#search = null
    this.#ac = null
    this.#settings = createSettings(this.#prefs(), undefined, this.#agentBehavior)
    this.#render()
  }

  #notice(text: string): void {
    this.#state = {
      ...this.#state,
      blocks: [...this.#state.blocks, { kind: 'notice', level: 'info', text }],
    }
  }

  #configureNotifications(): void {
    const thresholds = { '15s': 15_000, '30s': 30_000, '1m': 60_000, '2m': 120_000 } as const
    this.#notifications.configure({
      policy: this.#notificationPolicy,
      thresholdMs: thresholds[this.#notificationThreshold],
    })
  }

  #emitNotification(notification: ReturnType<TerminalNotificationController['humanPrompt']>): void {
    if (notification === undefined || !this.#tty) return
    const sequence = terminalNotificationSequence(notification)
    if (sequence !== '') this.#term.output.write(sequence)
  }

  #toolCatalog(): void {
    this.#state = {
      ...this.#state,
      blocks: [...this.#state.blocks, { kind: 'toolCatalog', tools: this.#tools }],
    }
    this.#focusLatestBlock()
  }

  #focusLatestBlock(): void {
    this.#follow = false
    this.#focusBlock = Math.max(0, this.#state.blocks.length - 1)
  }

  /** Resolve a configured action for one key id, tolerating camelCase ids. */
  #boundAction(id: string): TuiAction | undefined {
    return this.#keybindings[id] ?? this.#keybindings[id.toLowerCase()]
  }

  /** Run one configured action; returns true when the event was consumed. */
  #runAction(action: TuiAction): boolean {
    if (this.#prompt !== null || this.#settings !== null || this.#copySelector !== null) return false
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
      this.#toggleToolExpansion()
      return true
    }
    if (action === 'search-history') {
      if (this.#images.length > 0) return false
      this.#search = createHistorySearch(this.#history)
      this.#ac = null
      this.#render()
      return true
    }
    if (action === 'search-transcript') {
      // An empty composer has no forward-char target, so Ctrl+F searches the
      // transcript there; a non-empty draft keeps the editor's own binding.
      if (this.#search !== null) return false
      if (this.#editor.text !== '' || this.#images.length > 0) return false
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
    if (action === 'cycle-reasoning') {
      this.#submit('/model reasoning')
      return true
    }
    if (action === 'copy-prompt') {
      void this.#copyPicked(this.#editor.text, 'current prompt')
      return true
    }
    if (action === 'copy-line') {
      const text = this.#editor.text.slice(
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
    try {
      this.#term.input.setRawMode?.(false)
      const text = editExternally(this.#editor.text)
      this.#editor.setText(text)
      this.#reconcileImageDrafts()
    } catch (error: unknown) {
      this.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
    } finally {
      this.#term.input.setRawMode?.(true)
      this.#renderer.reset()
      this.#refreshAutocomplete()
      this.#render()
    }
    return true
  }

  /** Expand or collapse the newest tool card, or the whole tool catalog. */
  #toggleToolExpansion(): void {
    const last = this.#state.blocks.at(-1)
    const tool = last?.kind === 'toolCatalog'
      ? undefined
      : this.#state.blocks.findLast(block => block.kind === 'tool')
    if (last?.kind === 'toolCatalog') {
      this.#toolsExpanded = !this.#toolsExpanded
    } else if (tool?.kind === 'tool') {
      if (this.#expandedToolCalls.has(tool.callId)) this.#expandedToolCalls.delete(tool.callId)
      else this.#expandedToolCalls.add(tool.callId)
    } else {
      this.#toolsExpanded = !this.#toolsExpanded
    }
    this.#render()
  }

  /** Fold one event into the active transcript search. */
  #applyTranscriptSearch(event: KeyEvent): void {
    const state = this.#transcriptSearch
    if (state === null) return
    const command = applyTranscriptSearchEvent(state, event, this.#state.blocks.map(blockSearchText))
    if (command.kind === 'close') {
      this.#transcriptSearch = null
      this.#render()
      return
    }
    this.#transcriptSearch = command.state
    if (command.kind === 'focus') this.#focusBlock = command.block
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
    config.colors,
    parseThemeName(config.theme),
    copyToClipboard,
    {
      deferInitialRender: true,
      terminalProfile,
      alternateScreenOverlays: terminalProfile === 'direct',
      historyPath: config.historyPath ?? join(dshHome, 'omdsh', 'history.jsonl'),
      keybindingsPath: config.keybindingsPath ?? join(dshHome, 'omdsh', 'keybindings.json'),
    },
  )
  ctx.provide(TUI_SERVICE, tui)
  ctx.effect(() => () => { tui.dispose() })
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(
      TUI_SETTINGS_NAMESPACE,
      TuiSettingsSchema,
      { base: { theme: parseThemeName(config.theme), colors: resolveColors(config.colors, term.output.isTTY === true), expandTools: false } },
    )
    tui.applyStoredPrefs(scope.get())
    tui.setPrefsPersist((prefs) => { void scope.update(prefs) })
    scope.watch((next) => { tui.applyStoredPrefs(next) })
  })
}
