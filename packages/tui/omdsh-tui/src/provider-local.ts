/**
 * TUI capability seam — local terminal provider.

 * Owns the tty: raw-mode key input (editing, history, slash/tab
 * autocomplete, /settings overlay, /copy picker, Ctrl-R history search, PgUp/PgDn
 * and mouse-wheel transcript scroll, click-to-caret, Ctrl-O tool
 * expand, bracketed paste, double Ctrl-C exit, Ctrl-D quit),
 * SIGWINCH reflow, and the differential renderer. In non-tty mode
 * (pipes, CI) it degrades to line-based input with plain append-only
 * printing of settled blocks.
 * @module @omdsh/tui
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  TUI_SERVICE,
  type TuiCommand,
  type TuiPrompt,
  type TuiRecentSession,
  type TuiService,
  type TuiSessionStats,
  type TuiStatus,
} from './definition.ts'
import {
  applySlashCompletion,
  formatHelpText,
  hitTestAutocomplete,
  parseSlashInput,
  resolveSlashCommand,
  slashSuggestions,
  type AutocompleteItem,
  type SlashCommand,
  BUILTIN_SLASH_COMMANDS,
} from './autocomplete.ts'
import {
  applyPathCompletion,
  defaultPathSource,
  pathSuggestions,
  type DirReader,
} from './path-complete.ts'
import { copyToClipboard, readFromClipboard, type ClipboardReader, type ClipboardWriter } from './clipboard.ts'
import {
  applyCopySelectorEvent,
  createCopySelector,
  hitTestCopySelector,
  selectCopyTarget,
  type CopySelectorState,
} from './copy-selector.ts'
import { buildCopyTargets, extractCopyTarget, parseCopyKind } from './copy-targets.ts'
import {
  applyHistorySearchEvent,
  createHistorySearch,
  hitTestHistorySearch,
  type HistorySearchState,
} from './history-search.ts'
import { type EditorCommand, InputEditor, lineEnd, lineStart } from './editor.ts'
import {
  applySettingsEvent,
  createSettings,
  hitTestSettings,
  selectSetting,
  tuiSettingItems,
  type SettingsState,
  type TuiPrefs,
} from './settings-list.ts'
import {
  applyEvent,
  blockLines,
  initialTranscript,
  renderView,
  TRANSCRIPT_FAST_SCROLL,
  TRANSCRIPT_WHEEL_SCROLL,
  type TranscriptState,
} from './event-views.ts'
import { flushPending, MOUSE_TRACKING_OFF, MOUSE_TRACKING_ON, parseKeys, type KeyEvent } from './keys.ts'
import { LineRenderer, type RenderSink } from './renderer.ts'
import { hitTestEditor } from './box.ts'
import { createTheme, detectTrueColor, parseThemeName, type ThemeName } from './theme.ts'
import { formatWorkspaceText } from './pwd.ts'
import type { ToolInfo } from './tools-list.ts'
import type { TuiToolPresentation } from './tool-renderers.ts'
import { TUI_SETTINGS_NAMESPACE, TuiSettingsSchema } from './tui-settings.ts'
import { defaultStatusBarConfig, resolveStatusBarConfig, type StatusBarConfig } from './status-config.ts'
import { HistoryStore } from './history-store.ts'
import { loadKeybindings, type TuiAction } from './keybindings-config.ts'
import { editExternally } from './external-editor.ts'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import {
  movePromptSelection,
  filteredPromptOptions,
  selectedPromptAnswer,
  selectedFilteredPromptAnswer,
  togglePromptSelection,
  type PromptSelectorState,
} from './prompt-selector.ts'
import { resolveProjectContext } from './project-context.ts'
import { pickWelcomeTips, type WelcomeTip } from './welcome-tips.ts'

const APP_NAME = 'omdsh'
const APP_VERSION = '0.1.0'
const DOUBLE_CTRL_C_MS = 500

function shortenPath(cwd: string): string {
  const home = homedir()
  if (cwd === home) return '~'
  if (cwd.startsWith(home + '/')) return '~' + cwd.slice(home.length)
  return cwd
}

export const name = 'omdsh-tui'

/** Plugin config: the model label shown on the status line. */
export interface Config {
  /** Model name for the status line. */
  model: string
  /** Emit SGR color sequences; defaults to the output stream's tty-ness. */
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

type PendingRead = { resolve: (line: string | null) => void }
type PendingPrompt = PromptSelectorState & {
  resolve: (answer: string | null) => void
  offAbort?: () => void
}

/**
 * Local terminal presentation service.
 */
export class LocalTui implements TuiService {
  readonly #term: TerminalLike
  #model: string
  #reasoningEffort: string | undefined
  #colors: boolean
  #themeName: ThemeName
  readonly #tty: boolean
  readonly #renderer: LineRenderer
  #state: TranscriptState = initialTranscript()
  readonly #editor = new InputEditor()
  #history: string[] = []
  #historyIndex = 0
  #draft = ''
  #ac: { items: AutocompleteItem[]; selected: number } | null = null
  #search: HistorySearchState | null = null
  #settings: SettingsState | null = null
  #copySelector: CopySelectorState | null = null
  #pending: PendingRead | null = null
  #queue: string[] = []
  #quitRequested = false
  #resumeHintRequested = false
  #lastSigintTime = 0
  #interrupts = new Set<() => void>()
  #disposed = false
  #pendingKeys = ''
  #escapeTimer: ReturnType<typeof setTimeout> | null = null
  #scrollRender: ReturnType<typeof setImmediate> | null = null
  #paste = false
  #pasteBuf = ''
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
  #scrollStart = 0
  #maxStart = 0
  #scrollBudget = 0
  #follow = true
  #expandTools = false
  #statusBar: StatusBarConfig = defaultStatusBarConfig()
  #toolsExpanded = false
  #expandedToolCalls = new Set<string>()
  #tools: ToolInfo[] = []
  #runtimeCommands: TuiCommand[] = []
  #prompt: PendingPrompt | null = null
  #recentSessions: TuiRecentSession[] = []
  readonly #welcomeTips: readonly WelcomeTip[]
  #sessionId: string | undefined
  #sessionStats: TuiSessionStats | undefined
  #editorHit: { start: number; rows: number } | null = null
  #overlayHit: {
    kind: 'autocomplete' | 'settings' | 'search' | 'copy' | 'prompt'
    start: number
    resultsRow?: number
    itemRows?: readonly (number | undefined)[]
  } | null = null
  readonly #trueColor: boolean
  readonly #copy: ClipboardWriter
  readonly #readClipboard: ClipboardReader
  readonly #historyStore: HistoryStore | undefined
  readonly #keybindings: Record<string, TuiAction>
  readonly #cwd: string
  readonly #home: string
  readonly #listDir: DirReader
  #persistPrefs: ((prefs: TuiPrefs) => void) | null = null

  /**
   * @param term - terminal surface (injectable for tests).
   * @param model - model label for the status line.
   * @param colors - SGR styling switch.
   * @param themeName - shipped palette.
   * @param copy - clipboard writer (defaults to the platform tool).
   * @param paths - cwd/home/listing used by `@` and path autocomplete.
   */
  constructor(
    term: TerminalLike,
    model: string,
    colors: boolean,
    themeName: ThemeName = 'dark',
    copy: ClipboardWriter = copyToClipboard,
    paths: {
      cwd?: string
      home?: string
      listDir?: DirReader
      historyPath?: string
      keybindingsPath?: string
      readClipboard?: ClipboardReader
    } = {},
  ) {
    this.#term = term
    this.#model = model
    this.#colors = colors
    this.#themeName = themeName
    this.#copy = copy
    this.#readClipboard = paths.readClipboard ?? readFromClipboard
    this.#historyStore = paths.historyPath === undefined ? undefined : new HistoryStore(paths.historyPath)
    this.#history = this.#historyStore?.load() ?? []
    this.#keybindings = loadKeybindings(paths.keybindingsPath)
    const fallback = defaultPathSource()
    this.#cwd = paths.cwd ?? fallback.cwd
    this.#home = paths.home ?? fallback.home
    this.#listDir = paths.listDir ?? fallback.listDir
    this.#welcomeTips = pickWelcomeTips()
    this.#trueColor = colors && detectTrueColor()
    this.#tty = term.input.isTTY === true
    const project = resolveProjectContext(this.#cwd)
    this.#pwd = shortenPath(project.root)
    this.#branch = project.gitLabel
    this.#renderer = new LineRenderer(
      { write: (chunk) => { this.#term.output.write(chunk) } },
      { synchronized: this.#tty },
    )
    if (this.#tty) {
      term.input.setRawMode?.(true)
      const listener = (chunk: Buffer): void => { this.#onData(chunk) }
      term.input.on('data', listener)
      this.#offData = () => { term.input.off('data', listener) }
      this.#offResize = term.onResize?.(() => { this.#render() }) ?? null
      // Boot output above us (package-manager warnings, loader logs) has
      // already scrolled the cursor off row 0; the renderer's screen-relative
      // frames require a clean origin. Clear the screen and home the cursor
      // before the first frame. Enable bracketed paste and SGR mouse
      // tracking (wheel drives the virtual transcript; native scrollback
      // is already unusable under full-screen diffs).
      term.output.write('\x1b[2J\x1b[H\x1b[?2004h' + MOUSE_TRACKING_ON)
    }
    this.#render()
  }

  event(event: SessionEvent, presentation?: TuiToolPresentation): void {
    this.#state = applyEvent(this.#state, event, presentation)
    this.#syncTick()
    if (this.#tty) {
      this.#render()
    } else if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result' || event.type === 'turn/end') {
      this.#printPlain()
    }
  }

  setStatus(status: TuiStatus): void {
    this.#state = { ...this.#state, status }
    this.#syncTick()
    if (this.#tty) this.#render()
  }

  setModel(model: string, reasoningEffort?: string): void {
    this.#model = model
    this.#reasoningEffort = reasoningEffort
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

  notice(text: string, level: 'info' | 'error' = 'info'): void {
    this.#state = { ...this.#state, blocks: [...this.#state.blocks, { kind: 'notice', level, text }] }
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
    this.#editor.setText('')
    this.#ac = null
    return new Promise((resolve) => {
      const pending: PendingPrompt = { request, selected: 0, checked: new Set(), resolve }
      if (request.signal !== undefined) {
        const onAbort = (): void => { this.#finishPrompt(null) }
        request.signal.addEventListener('abort', onAbort, { once: true })
        pending.offAbort = () => { request.signal?.removeEventListener('abort', onAbort) }
      }
      this.#prompt = pending
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

  replaceSession(events: readonly SessionEvent[], presentations?: ReadonlyMap<number, TuiToolPresentation>): void {
    let state = initialTranscript()
    for (const event of events) state = applyEvent(state, event, presentations?.get(event.seq))
    this.#state = { ...state, status: 'idle' }
    this.#plainPrinted = 0
    this.#followTail()
    if (this.#tty) this.#render()
    else this.#printPlain()
  }

  setSession(info: { id: string; recent: readonly TuiRecentSession[]; stats?: TuiSessionStats }): void {
    this.#sessionId = info.id
    this.#recentSessions = info.recent.map((session) => ({ ...session }))
    this.#sessionStats = info.stats === undefined ? undefined : { ...info.stats }
    if (this.#tty) this.#render()
  }

  /** Apply prefs loaded from the settings document (does not persist). */
  applyStoredPrefs(prefs: TuiPrefs): void {
    this.#themeName = prefs.theme
    this.#colors = prefs.colors
    this.#expandTools = prefs.expandTools
    this.#statusBar = resolveStatusBarConfig(prefs.statusBar, prefs.statusPreset)
    this.#toolsExpanded = prefs.expandTools
    if (this.#settings !== null) this.#settings = { ...this.#settings, prefs }
    if (this.#tty) this.#render()
  }

  /** Called after a live `/settings` change. */
  setPrefsPersist(persist: (prefs: TuiPrefs) => void): void {
    this.#persistPrefs = persist
  }

  readline(): Promise<string | null> {
    if (this.#pending !== null) return Promise.reject(new Error('omdsh-tui: readline already in flight'))
    if (this.#disposed) return Promise.resolve(null)
    // A Ctrl-D pressed while the previous turn was still settling lands here
    // (no pending readline existed to resolve); honor it now.
    if (this.#quitRequested) {
      this.#quitRequested = false
      return Promise.resolve(null)
    }
    if (!this.#tty) return this.#readlinePlain()
    // Lines submitted while a turn was still running were queued instead of
    // dropped; serve the oldest before waiting for fresh input.
    const queued = this.#queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve) => {
      this.#pending = { resolve }
    })
  }

  onInterrupt(listener: () => void): () => void {
    this.#interrupts.add(listener)
    return () => { this.#interrupts.delete(listener) }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#tick !== null) {
      clearInterval(this.#tick)
      this.#tick = null
    }
    if (this.#scrollRender !== null) {
      clearImmediate(this.#scrollRender)
      this.#scrollRender = null
    }
    if (this.#tty) {
      this.#offData?.()
      this.#offResize?.()
      this.#term.input.setRawMode?.(false)
      // Leave the cursor on a fresh line below the last frame so the shell
      // prompt does not overwrite the transcript. Disable mouse tracking
      // and bracketed paste.
      this.#term.output.write(MOUSE_TRACKING_OFF + '\x1b[?2004l\x1b[?25h\r\n')
      if (this.#resumeHintRequested && this.#sessionId !== undefined) {
        this.#term.output.write(`\r\nResume this session with ${APP_NAME} --resume ${this.#sessionId}\r\n`)
      }
      // A tty stdin keeps the event loop alive after the tree disposes;
      // release the descriptor so natural completion can exit the process.
      this.#term.input.destroy?.()
    }
    if (this.#escapeTimer !== null) clearTimeout(this.#escapeTimer)
    this.#lineReader?.close()
    this.#pending?.resolve(null)
    this.#pending = null
    this.#finishPrompt(null)
  }

  /** Re-render the current frame (resize reflow). */
  refresh(): void {
    this.#render()
  }

  #readlinePlain(): Promise<string | null> {
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
      if (this.#plainClosed) {
        resolve(null)
        return
      }
      this.#plainPending = { resolve }
    })
  }

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
    const pending = this.#plainPending
    this.#plainPending = null
    pending?.resolve(line)
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
    if (this.#state.status === 'running') return true
    return this.#state.blocks.some((block) => block.kind === 'tool' && block.status === 'running')
  }

  #syncTick(): void {
    if (!this.#tty) return
    if (this.#busy()) {
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

  #render(): void {
    if (this.#scrollRender !== null) {
      clearImmediate(this.#scrollRender)
      this.#scrollRender = null
    }
    const width = this.#term.width()
    const frame = this.#tty
      ? renderView(this.#state, {
        width,
        height: this.#term.height(),
        model: this.#model,
        ...(this.#reasoningEffort === undefined ? {} : { reasoningEffort: this.#reasoningEffort }),
        input: this.#editor.text,
        inputCursor: this.#editor.cursor,
        colors: this.#colors,
        pwd: this.#pwd,
        ...(this.#branch !== undefined ? { branch: this.#branch } : {}),
        version: APP_VERSION,
        appName: APP_NAME,
        spinnerFrame: this.#spinner,
        trueColor: this.#trueColor,
        themeName: this.#themeName,
        scrollStart: this.#follow ? Number.POSITIVE_INFINITY : this.#scrollStart,
        toolsExpanded: this.#toolsExpanded,
        expandedTools: this.#expandedToolCalls,
        commands: this.#commands(),
        recentSessions: this.#recentSessions,
        welcomeTips: this.#welcomeTips,
        ...(this.#sessionStats === undefined ? {} : { sessionStats: this.#sessionStats }),
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
    this.#editorHit = frame.editor ?? null
    this.#overlayHit = frame.overlay ?? null
    this.#syncScroll(frame.transcript)
    this.#renderer.render(frame)
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

  #scrollBy(delta: number, coalesce = false): void {
    if (delta === 0 && this.#maxStart === 0) return
    this.#follow = false
    this.#scrollStart += delta
    if (this.#scrollStart <= 0) this.#scrollStart = 0
    if (!coalesce) {
      this.#render()
      return
    }
    if (this.#scrollRender !== null) return
    this.#scrollRender = setImmediate(() => {
      this.#scrollRender = null
      if (!this.#disposed) this.#render()
    })
  }

  #followTail(): void {
    this.#follow = true
    this.#scrollStart = this.#maxStart
  }

  #onData(chunk: Buffer): void {
    const { events, rest } = parseKeys(this.#pendingKeys + chunk.toString('utf8'))
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

  #dispatch(event: KeyEvent): void {
    if (this.#paste) {
      if (event.type === 'paste-end') {
        this.#paste = false
        const text = this.#pasteBuf.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
        this.#pasteBuf = ''
        if (text !== '') {
          if (this.#search !== null) {
            this.#applySearch({ type: 'text', value: text })
          } else {
            this.#editor.handle({ type: 'text', value: text })
            this.#refreshAutocomplete()
            this.#render()
          }
        }
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
    if (event.type === 'mouse') {
      this.#handleMouse(event)
      return
    }
    if (this.#handlePrompt(event)) return
    if (event.type === 'key') {
      const action = this.#keybindings[event.id]
      if (action !== undefined) {
        this.#runAction(action)
        return
      }
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
      if (this.#state.status === 'running') {
        for (const listener of this.#interrupts) listener()
      } else {
        this.#editor.clear()
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
    if (event.type === 'key' && event.id === 'ctrl+r') {
      this.#search = createHistorySearch(this.#history)
      this.#ac = null
      this.#render()
      return
    }
    if (this.#search !== null) {
      this.#applySearch(event)
      return
    }
    if (this.#handleAutocomplete(event)) return
    if (event.type === 'key') {
      if (event.id === 'pageUp') {
        this.#scrollBy(-this.#pageSize())
        return
      }
      if (event.id === 'pageDown') {
        this.#scrollBy(this.#pageSize())
        return
      }
      if (event.id === 'shift+up') {
        this.#scrollBy(-TRANSCRIPT_FAST_SCROLL)
        return
      }
      if (event.id === 'shift+down') {
        this.#scrollBy(TRANSCRIPT_FAST_SCROLL)
        return
      }
      if (event.id === 'ctrl+o') {
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
        return
      }
    }
    this.#applyCommand(this.#editor.handle(event))
  }

  #handlePrompt(event: KeyEvent): boolean {
    const prompt = this.#prompt
    if (prompt === null) return false
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

  #handleMouse(event: Extract<KeyEvent, { type: 'mouse' }>): void {
    if (event.leftClick) {
      if (this.#clickOverlay(event.row)) return
      this.#clickEditor(event.row, event.col)
      return
    }
    if (event.wheel === null) return
    const dir = event.wheel
    if (this.#prompt !== null) {
      this.#handlePrompt({ type: 'key', id: dir < 0 ? 'up' : 'down' })
      return
    }
    if (this.#settings !== null) {
      this.#applySettings({ type: 'key', id: dir < 0 ? 'up' : 'down' })
      return
    }
    if (this.#copySelector !== null) {
      this.#applyCopySelector({ type: 'key', id: dir < 0 ? 'up' : 'down' })
      return
    }
    if (this.#search !== null) {
      this.#applySearch({ type: 'key', id: dir < 0 ? 'up' : 'down' })
      return
    }
    if (this.#ac !== null) {
      this.#moveAutocomplete(dir)
      this.#render()
      return
    }
    this.#scrollBy(dir < 0 ? -TRANSCRIPT_WHEEL_SCROLL : TRANSCRIPT_WHEEL_SCROLL, true)
  }

  #clickOverlay(row: number): boolean {
    const hit = this.#overlayHit
    if (hit === null) return false
    const localRow = row - hit.start
    if (hit.kind === 'settings' && this.#settings !== null) {
      const index = hitTestSettings(hit.itemRows ?? tuiSettingItems(this.#settings.prefs).length, localRow)
      if (index === undefined) return true
      if (index === this.#settings.selected) {
        this.#applySettings({ type: 'key', id: 'enter' })
      } else {
        this.#settings = selectSetting(this.#settings, index)
        this.#render()
      }
      return true
    }
    if (hit.kind === 'copy' && this.#copySelector !== null) {
      const index = hitTestCopySelector(this.#copySelector.items.length, this.#copySelector.selected, localRow)
      if (index === undefined) return true
      if (index === this.#copySelector.selected) {
        this.#applyCopySelector({ type: 'key', id: 'enter' })
      } else {
        this.#copySelector = selectCopyTarget(this.#copySelector, index)
        this.#render()
      }
      return true
    }
    if (hit.kind === 'autocomplete' && this.#ac !== null) {
      const index = hitTestAutocomplete(this.#ac.items.length, this.#ac.selected, localRow)
      if (index === undefined) return true
      this.#ac = { ...this.#ac, selected: index }
      this.#applySelectedCompletion()
      this.#render()
      return true
    }
    if (hit.kind === 'search' && this.#search !== null) {
      const index = hitTestHistorySearch(
        this.#search.results.length,
        this.#search.selected,
        localRow,
        hit.resultsRow ?? 0,
      )
      if (index === undefined) return true
      this.#search = { ...this.#search, selected: index }
      this.#applySearch({ type: 'key', id: 'enter' })
      return true
    }
    if (hit.kind === 'prompt' && this.#prompt !== null) {
      const index = hit.itemRows?.[localRow]
      if (index === undefined) return true
      if (index === this.#prompt.selected) {
        this.#finishPrompt(selectedFilteredPromptAnswer(this.#prompt, this.#editor.text))
        this.#editor.setText('')
      } else {
        this.#prompt = { ...this.#prompt, selected: index }
      }
      this.#render()
      return true
    }
    return false
  }

  #clickEditor(row: number, col: number): void {
    if (this.#settings !== null || this.#copySelector !== null || this.#search !== null) return
    const hit = this.#editorHit
    if (hit === null) return
    const localRow = row - hit.start
    if (localRow < 0 || localRow >= hit.rows) return
    const index = hitTestEditor(this.#editor.text, this.#term.width(), localRow, col)
    if (index === undefined) return
    this.#editor.setCursor(index)
    this.#refreshAutocomplete()
    this.#render()
  }

  #prefs(): TuiPrefs {
    return {
      theme: this.#themeName,
      colors: this.#colors,
      expandTools: this.#expandTools,
      statusBar: {
        ...this.#statusBar,
        groups: [...this.#statusBar.groups],
        ...(this.#statusBar.order === undefined ? {} : { order: [...this.#statusBar.order] }),
      },
    }
  }

  #applyPrefs(prefs: TuiPrefs): void {
    const expandChanged = prefs.expandTools !== this.#expandTools
    this.#themeName = prefs.theme
    this.#colors = prefs.colors
    this.#expandTools = prefs.expandTools
    this.#statusBar = resolveStatusBarConfig(prefs.statusBar, prefs.statusPreset)
    if (expandChanged) this.#toolsExpanded = prefs.expandTools
    this.#persistPrefs?.(prefs)
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
    if (this.#prompt !== null) {
      this.#ac = null
      return
    }
    const result = slashSuggestions(this.#editor.text, this.#editor.cursor, this.#commands())
      ?? pathSuggestions(this.#editor.text, this.#editor.cursor, {
        cwd: this.#cwd,
        home: this.#home,
        listDir: this.#listDir,
        force: forcePath,
      })
    if (result === null) {
      this.#ac = null
      return
    }
    const prev = this.#ac?.items[this.#ac.selected]?.value
    let selected = 0
    if (prev !== undefined) {
      const idx = result.items.findIndex((item) => item.value === prev)
      if (idx >= 0) selected = idx
    }
    this.#ac = { items: result.items, selected }
  }

  #moveAutocomplete(dir: -1 | 1): void {
    if (this.#ac === null || this.#ac.items.length === 0) return
    const n = this.#ac.items.length
    this.#ac = { ...this.#ac, selected: (this.#ac.selected + dir + n) % n }
  }

  #applySelectedCompletion(): void {
    const item = this.#ac?.items[this.#ac.selected]
    if (item === undefined) return
    const next = item.kind === 'path'
      ? applyPathCompletion(this.#editor.text, this.#editor.cursor, item)
      : applySlashCompletion(this.#editor.text, this.#editor.cursor, item)
    this.#editor.setText(next.text, next.cursor)
    this.#refreshAutocomplete()
  }

  #applyCommand(command: EditorCommand): void {
    if (command.kind === 'changed') {
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
      this.#term.output.write('\x1b[2J\x1b[H')
      this.#render()
    }
  }

  #historyPrev(): void {
    if (this.#history.length === 0 || this.#historyIndex >= this.#history.length) return
    if (this.#historyIndex === 0) this.#draft = this.#editor.text
    this.#historyIndex += 1
    this.#editor.setText(this.#history[this.#history.length - this.#historyIndex] ?? '')
    this.#refreshAutocomplete()
    this.#render()
  }

  #historyNext(): void {
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
    if (text !== '' && this.#history[this.#history.length - 1] !== text) {
      this.#history.push(text)
      this.#historyStore?.add(text)
    }
    this.#historyIndex = 0
    this.#draft = ''
    this.#editor.setText('')
    this.#ac = null
    this.#search = null
    this.#settings = null
    this.#copySelector = null
    this.#followTail()
    const slash = parseSlashInput(text)
    if (slash !== null) {
      this.#runSlash(slash.name, slash.args)
      return
    }
    this.#render()
    const pending = this.#pending
    if (pending !== null) {
      this.#pending = null
      pending.resolve(text)
    } else if (text !== '') {
      this.#queue.push(text)
    }
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
      this.#state = initialTranscript()
      this.#followTail()
      this.#render()
      return
    }
    if (command.name === 'settings') {
      this.#runSettings(args)
      return
    }
    if (command.name === 'hotkeys') {
      this.#hotkeyCatalog()
      this.#render()
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
    if (command.name === 'pwd') {
      this.#notice(formatWorkspaceText({
        cwd: process.cwd(),
        model: this.#model,
        ...(this.#branch !== undefined ? { branch: this.#branch } : {}),
      }))
      this.#render()
      return
    }
    if (!BUILTIN_SLASH_COMMANDS.some((entry) => entry.name === command.name)) {
      this.#render()
      const raw = '/' + name + (args === '' ? '' : ' ' + args)
      const pending = this.#pending
      if (pending !== null) {
        this.#pending = null
        pending.resolve(raw)
      } else {
        this.#queue.push(raw)
      }
      return
    }
    this.commandOutput('help', formatHelpText(this.#commands()))
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
    this.#settings = createSettings(this.#prefs())
    this.#render()
  }

  #notice(text: string): void {
    this.#state = {
      ...this.#state,
      blocks: [...this.#state.blocks, { kind: 'notice', level: 'info', text }],
    }
  }

  #toolCatalog(): void {
    this.#state = {
      ...this.#state,
      blocks: [...this.#state.blocks, { kind: 'toolCatalog', tools: this.#tools }],
    }
  }

  #hotkeyCatalog(): void {
    this.#state = {
      ...this.#state,
      blocks: [...this.#state.blocks, { kind: 'hotkeyCatalog', bindings: this.#keybindings }],
    }
  }

  #runAction(action: TuiAction): void {
    if (this.#prompt !== null) return
    if (action === 'retry') {
      this.#submit('/retry')
      return
    }
    if (action === 'copy-prompt') {
      void this.#copyPicked(this.#editor.text, 'current prompt')
      return
    }
    if (action === 'copy-line') {
      const text = this.#editor.text.slice(
        lineStart(this.#editor.text, this.#editor.cursor),
        lineEnd(this.#editor.text, this.#editor.cursor),
      )
      void this.#copyPicked(text, 'current line')
      return
    }
    if (action === 'paste-clipboard') {
      void this.#readClipboard().then((text) => {
        if (text !== '') this.#editor.handle({ type: 'text', value: text })
        this.#refreshAutocomplete()
        this.#render()
      }, () => { this.notice('Clipboard read failed.', 'error') })
      return
    }
    try {
      this.#term.input.setRawMode?.(false)
      const text = editExternally(this.#editor.text)
      this.#editor.setText(text)
    } catch (error: unknown) {
      this.notice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      this.#term.input.setRawMode?.(true)
      this.#renderer.reset()
      this.#term.output.write('\x1b[2J\x1b[H')
      this.#refreshAutocomplete()
      this.#render()
    }
  }
}

/**
 * Mount the local terminal provider as the tui service.
 * @param ctx - plugin context.
 * @param config - model label and color switch.
 */
export function apply(ctx: Context, config: Config): void {
  const dshHome = process.env.OMDSH_HOME ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
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
    config.colors ?? term.output.isTTY === true,
    parseThemeName(config.theme),
    copyToClipboard,
    {
      historyPath: config.historyPath ?? join(dshHome, 'omdsh', 'history.jsonl'),
      keybindingsPath: config.keybindingsPath ?? join(dshHome, 'omdsh', 'keybindings.json'),
    },
  )
  ctx.provide(TUI_SERVICE, tui)
  ctx.effect(() => () => { tui.dispose() })
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(
      settingsNamespace(TUI_SETTINGS_NAMESPACE),
      TuiSettingsSchema,
      { base: { theme: parseThemeName(config.theme), colors: config.colors ?? term.output.isTTY === true, expandTools: false } },
    )
    tui.applyStoredPrefs(scope.get())
    tui.setPrefsPersist((prefs) => { void scope.update(prefs) })
    scope.watch((next) => { tui.applyStoredPrefs(next) })
  })
}
