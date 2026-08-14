/**
 * TUI capability seam — local terminal provider.

 * Owns the tty: raw-mode key input (editing, history, slash/tab
 * autocomplete, /settings overlay, Ctrl-R history search, PgUp/PgDn
 * and mouse-wheel transcript scroll, Ctrl-O tool expand, bracketed
 * paste, Ctrl-C interrupt, Ctrl-D quit),
 * SIGWINCH reflow, and the differential renderer. In non-tty mode
 * (pipes, CI) it degrades to line-based input with plain append-only
 * printing of settled blocks.
 * @module @omdsh/tui
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TUI_SERVICE, type TuiService, type TuiStatus } from './definition.ts'
import {
  applySlashCompletion,
  formatHelpText,
  parseSlashInput,
  resolveSlashCommand,
  slashSuggestions,
  type AutocompleteItem,
} from './autocomplete.ts'
import { applyHistorySearchEvent, createHistorySearch, type HistorySearchState } from './history-search.ts'
import { type EditorCommand, InputEditor } from './editor.ts'
import {
  applySettingsEvent,
  createSettings,
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
import { createTheme, detectTrueColor, parseThemeName, type ThemeName } from './theme.ts'

const APP_NAME = 'omdsh'
const APP_VERSION = '0.1.0'

function settingsFocus(name: 'settings' | 'theme', token: string): string | undefined {
  if (name === 'theme' || token === 'theme') return 'theme'
  if (token === 'color' || token === 'colors') return 'colors'
  return undefined
}

function shortenPath(cwd: string): string {
  const home = homedir()
  if (cwd === home) return '~'
  if (cwd.startsWith(home + '/')) return '~' + cwd.slice(home.length)
  return cwd
}

function readGitBranch(cwd: string): string | undefined {
  try {
    const head = readFileSync(join(cwd, '.git/HEAD'), 'utf8').trim()
    if (head.startsWith('ref: refs/heads/')) return head.slice('ref: refs/heads/'.length)
    if (head.startsWith('ref: ')) {
      const name = head.slice(5)
      return name.split('/').pop() ?? name
    }
    return 'detached'
  } catch {
    return undefined
  }
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

/**
 * Local terminal presentation service.
 */
export class LocalTui implements TuiService {
  readonly #term: TerminalLike
  #model: string
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
  #pending: PendingRead | null = null
  #queue: string[] = []
  #quitRequested = false
  #interrupts = new Set<() => void>()
  #disposed = false
  #pendingKeys = ''
  #escapeTimer: ReturnType<typeof setTimeout> | null = null
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
  #toolsExpanded = false
  readonly #trueColor: boolean

  /**
   * @param term - terminal surface (injectable for tests).
   * @param model - model label for the status line.
   * @param colors - SGR styling switch.
   * @param themeName - shipped palette.
   */
  constructor(term: TerminalLike, model: string, colors: boolean, themeName: ThemeName = 'dark') {
    this.#term = term
    this.#model = model
    this.#colors = colors
    this.#themeName = themeName
    this.#trueColor = colors && detectTrueColor()
    this.#tty = term.input.isTTY === true
    this.#pwd = shortenPath(process.cwd())
    this.#branch = readGitBranch(process.cwd())
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

  event(event: SessionEvent): void {
    this.#state = applyEvent(this.#state, event)
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

  setModel(model: string): void {
    this.#model = model
    if (this.#tty) this.#render()
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
    if (this.#tty) {
      this.#offData?.()
      this.#offResize?.()
      this.#term.input.setRawMode?.(false)
      // Leave the cursor on a fresh line below the last frame so the shell
      // prompt does not overwrite the transcript. Disable mouse tracking
      // and bracketed paste.
      this.#term.output.write(MOUSE_TRACKING_OFF + '\x1b[?2004l\r\n')
      // A tty stdin keeps the event loop alive after the tree disposes;
      // release the descriptor so natural completion can exit the process.
      this.#term.input.destroy?.()
    }
    if (this.#escapeTimer !== null) clearTimeout(this.#escapeTimer)
    this.#lineReader?.close()
    this.#pending?.resolve(null)
    this.#pending = null
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
    const width = this.#term.width()
    const frame = this.#tty
      ? renderView(this.#state, {
        width,
        height: this.#term.height(),
        model: this.#model,
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
        ...(this.#settings !== null
          ? { settings: this.#settings }
          : this.#search !== null
            ? { historySearch: this.#search }
            : this.#ac !== null ? { autocomplete: this.#ac } : {}),
      })
      : { lines: [] }
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
    if (event.type === 'key' && event.id === 'ctrl+c') {
      if (this.#settings !== null) {
        this.#settings = null
        this.#render()
        return
      }
      if (this.#search !== null) {
        this.#search = null
        this.#render()
        return
      }
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
        this.#toolsExpanded = !this.#toolsExpanded
        this.#render()
        return
      }
    }
    this.#applyCommand(this.#editor.handle(event))
  }

  #handleMouse(event: Extract<KeyEvent, { type: 'mouse' }>): void {
    if (event.wheel === null) return
    const dir = event.wheel
    if (this.#settings !== null) {
      this.#applySettings({ type: 'key', id: dir < 0 ? 'up' : 'down' })
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
    this.#scrollBy(dir < 0 ? -TRANSCRIPT_WHEEL_SCROLL : TRANSCRIPT_WHEEL_SCROLL)
  }

  #prefs(): TuiPrefs {
    return { theme: this.#themeName, colors: this.#colors }
  }

  #applyPrefs(prefs: TuiPrefs): void {
    this.#themeName = prefs.theme
    this.#colors = prefs.colors
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
      this.#refreshAutocomplete()
      if (this.#ac !== null) this.#applySelectedCompletion()
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

  #refreshAutocomplete(): void {
    const result = slashSuggestions(this.#editor.text, this.#editor.cursor)
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
    const next = applySlashCompletion(this.#editor.text, this.#editor.cursor, item)
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
    if (this.#pending !== null) {
      const pending = this.#pending
      this.#pending = null
      pending.resolve(null)
    } else {
      this.#quitRequested = true
    }
  }

  #submit(text: string): void {
    if (text !== '' && this.#history[this.#history.length - 1] !== text) this.#history.push(text)
    this.#historyIndex = 0
    this.#draft = ''
    this.#editor.setText('')
    this.#ac = null
    this.#search = null
    this.#settings = null
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
    const command = resolveSlashCommand(name)
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
    if (command.name === 'settings' || command.name === 'theme') {
      this.#runThemeSettings(command.name, args)
      return
    }
    this.#notice(formatHelpText())
    this.#render()
  }

  #runThemeSettings(name: 'settings' | 'theme', args: string): void {
    const token = args.trim().toLowerCase()
    if (name === 'theme' && token !== '') {
      const themeName = parseThemeName(token)
      if (themeName !== token) {
        this.#notice('Usage: /theme [dark|light]')
        this.#render()
        return
      }
      this.#themeName = themeName
      this.#notice('Theme: ' + themeName)
      this.#render()
      return
    }
    this.#search = null
    this.#ac = null
    this.#settings = createSettings(this.#prefs(), settingsFocus(name, token))
    this.#render()
  }

  #notice(text: string): void {
    this.#state = {
      ...this.#state,
      blocks: [...this.#state.blocks, { kind: 'notice', level: 'info', text }],
    }
  }
}

/**
 * Mount the local terminal provider as the tui service.
 * @param ctx - plugin context.
 * @param config - model label and color switch.
 */
export function apply(ctx: Context, config: Config): void {
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
  )
  ctx.provide(TUI_SERVICE, tui)
  ctx.effect(() => () => { tui.dispose() })
}