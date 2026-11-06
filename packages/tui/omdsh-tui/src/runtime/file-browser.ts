/** Owns one review's loading, navigation, and cancellation; never owns the terminal. */
import type { TuiDocumentPosition, TuiFileReview } from '../definition.ts'
import type { KeyEvent } from '../input/keys.ts'
import { InputEditor } from '../input/editor.ts'
import type { Theme } from '../chrome/theme.ts'
import { browserActions, browserFiles, browserHelp, fileBrowserDocument, fileBrowserGeometry, type FileBrowserState } from '../views/file-browser.ts'
import { documentDestination, documentLineRow, documentMatches, documentModel, documentPosition } from '../views/document-reader.ts'

export class FileBrowser {
  state: FileBrowserState
  readonly done: Promise<void>
  #resolve!: () => void
  #closed = false
  #generation = 0
  #readAbort: AbortController | undefined
  #offAbort: () => void
  #positions = new Map<string, TuiDocumentPosition>()
  #modes = new Map<number, 'diff' | 'source'>()
  #limits = new Map<number, number>()
  #editor = new InputEditor()
  #origin: { position: TuiDocumentPosition; filter: string; selected: number } | undefined

  constructor(readonly request: TuiFileReview, readonly changed: () => void, readonly closed: () => void) {
    this.done = new Promise(resolve => { this.#resolve = resolve })
    this.state = { title: request.title, files: request.files, selected: request.initial ?? 0,
      focus: request.initial === undefined ? 'files' : 'document', filter: '', input: '', inputCursor: 0, mode: 'diff', markdown: false,
      position: { row: 0, wrap: 0, query: '' }, message: '', loading: true, help: false, helpScroll: 0, menu: undefined, notice: '',
      canEdit: request.canEdit, canQuote: request.canQuote, truncated: false, limit: 128 * 1024 }
    const abort = () => this.close()
    request.signal.addEventListener('abort', abort, { once: true })
    this.#offAbort = () => request.signal.removeEventListener('abort', abort)
  }

  start(): void { if (this.request.signal.aborted) this.close(); else void this.#load() }
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#generation++
    this.#readAbort?.abort()
    this.#offAbort()
    this.#resolve()
    this.closed()
  }
  #key(): string { return `${this.state.selected}:${this.state.mode}:${this.state.markdown}` }
  #save(): void { this.#positions.set(this.#key(), this.state.position); this.#modes.set(this.state.selected, this.state.mode) }
  #restore(): void { this.state.position = this.#positions.get(this.#key()) ?? { row: 0, wrap: 0, query: '' } }
  async #load(): Promise<void> {
    this.#readAbort?.abort()
    const abort = this.#readAbort = new AbortController()
    const generation = ++this.#generation
    this.state = { ...this.state, source: undefined, loading: true, message: '', notice: '', truncated: false,
      limit: this.#limits.get(this.state.selected) ?? 128 * 1024 }
    this.changed()
    try {
      const result = await this.request.read(this.state.selected, this.state.mode, this.state.limit, abort.signal)
      if (this.#closed || generation !== this.#generation) return
      this.state = { ...this.state, source: result.source, message: result.message ?? '', truncated: result.truncated === true, loading: false }
    } catch (error) {
      if (this.#closed || generation !== this.#generation) return
      this.state = { ...this.state, loading: false, message: error instanceof Error ? error.message : String(error) }
    }
    this.changed()
  }
  select(index: number): void {
    if (index === this.state.selected || this.state.files[index] === undefined) return
    this.#save()
    this.state = { ...this.state, selected: index, mode: this.#modes.get(index) ?? 'diff', markdown: false }
    this.#restore()
    void this.#load()
  }
  click(row: number, column: number, width: number, height: number): void {
    if (this.state.editing !== undefined) return
    const geometry = fileBrowserGeometry(this.state, width, height)
    if (row < 4 || row >= 4 + geometry.page) return
    if (this.state.menu !== undefined && (!geometry.split || column > geometry.left)) {
      const action = browserActions(this.state)[Math.max(0, this.state.menu - geometry.page + 1) + row - 4]
      if (action !== undefined) { this.state.menu = undefined; this.#action(action.key) }
    } else if (!this.state.help && geometry.showFiles && (!geometry.split || column < geometry.left)) {
      const index = geometry.files[geometry.start + row - 4]
      if (index !== undefined) { this.select(index); this.state.focus = geometry.split ? 'files' : 'document' }
    } else this.state.focus = 'document'
    this.changed()
  }
  input(event: KeyEvent, theme: Theme, width: number, height: number): void {
    if (this.#closed) return
    const s = this.state
    const key = event.type === 'key' ? event.id : event.type === 'text' ? event.value.toLowerCase() : ''
    const doc = fileBrowserDocument(s, theme, width, height)
    const jump = (row: number | undefined) => { if (row !== undefined) s.position = { ...s.position, row, wrap: 0 } }
    if (s.editing !== undefined) {
      if (key === 'escape' || key === 'ctrl+c') {
        if (this.#origin !== undefined) {
          s.position = this.#origin.position; s.filter = this.#origin.filter
          this.select(this.#origin.selected)
        }
        this.state.editing = undefined
      } else if (key === 'enter') {
        if (s.editing === 'line') {
          const row = s.source === undefined || !/^[1-9]\d*$/u.test(s.input.trim()) ? undefined : documentLineRow(s.source, Number(s.input))
          if (row === undefined) { s.notice = 'Enter a new-file line visible in this view.'; this.changed(); return }
          jump(row)
        }
        s.editing = undefined; s.notice = ''
      } else {
        this.#editor.handle(event)
        s.input = this.#editor.text.replace(/[\r\n]/gu, ' ')
        s.inputCursor = this.#editor.cursor
        if (s.editing === 'filter') {
          s.filter = s.input
          const files = browserFiles(s)
          if (!files.includes(s.selected) && files[0] !== undefined) this.select(files[0])
        } else if (s.editing === 'search') {
          s.position = { ...s.position, query: s.input }
          if (s.source !== undefined) jump(documentMatches(s.source, s.input)[0])
        }
      }
      this.changed(); return
    }
    if (key === 'ctrl+c') { this.close(); return }
    if (s.help) {
      if (['escape', '?', 'enter'].includes(key)) s.help = false
      else if (key === 'up' || key === 'pageUp') s.helpScroll = Math.max(0, s.helpScroll - (key === 'up' ? 1 : doc.page))
      else if (key === 'down' || key === 'pageDown') s.helpScroll = Math.min(Math.max(0, browserHelp(doc.documentWidth).length - doc.page), s.helpScroll + (key === 'down' ? 1 : doc.page))
      this.changed(); return
    }
    if (s.menu !== undefined) {
      const actions = browserActions(s)
      if (key === 'escape' || key === 'a') s.menu = undefined
      else if (key === 'down') s.menu = (s.menu + 1) % actions.length
      else if (key === 'up') s.menu = (s.menu + actions.length - 1) % actions.length
      else if (key === 'enter') { const action = actions[s.menu]; s.menu = undefined; if (action) this.#action(action.key) }
      this.changed(); return
    }
    if (key === 'escape') {
      if (!doc.split && s.focus === 'document') s.focus = 'files'
      else { this.close(); return }
    } else if (key === 'tab' || key === 'shift+tab') s.focus = s.focus === 'files' ? 'document' : 'files'
    else if (key === 'enter') s.focus = 'document'
    else if (key === '/' || key === 'ctrl+f' || key === 'g' || key === 'ctrl+g') {
      if (s.markdown && s.focus === 'document') { this.#save(); s.markdown = false; this.#restore() }
      s.editing = key === 'g' || key === 'ctrl+g' ? 'line' : s.focus === 'files' ? 'filter' : 'search'
      this.#origin = { position: { ...s.position }, filter: s.filter, selected: s.selected }
      s.input = s.editing === 'filter' ? s.filter : s.editing === 'search' ? s.position.query : ''
      this.#editor.setText(s.input)
      s.inputCursor = this.#editor.cursor
    } else if (key === 'v') {
      this.#save(); s.mode = s.mode === 'diff' ? 'source' : 'diff'; s.markdown = false; this.#restore(); void this.#load()
    } else if (key === 'n' || key === 'p') {
      const files = browserFiles(s), at = Math.max(0, files.indexOf(s.selected))
      const index = files[(at + files.length + (key === 'n' ? 1 : -1)) % files.length]
      if (index !== undefined) this.select(index)
    } else if (key === 'a') s.menu = 0
    else if (key === 'w') s.position = { ...s.position, wordWrap: s.position.wordWrap === false, wrap: 0 }
    else if (key === 'alt+left' || key === 'alt+right') s.position = { ...s.position, wordWrap: false, wrap: 0, column: Math.max(0, Math.min(doc.layout?.maxColumn ?? 0, (s.position.column ?? 0) + (key === 'alt+right' ? 8 : -8))) }
    else if (s.source !== undefined && !s.markdown && ['ctrl+n', 'ctrl+p', '[', ']'].includes(key)) {
      jump(documentDestination(key === '[' || key === ']' ? documentModel(s.source).hunks : documentMatches(s.source, s.position.query), s.position.row, key === ']' || key === 'ctrl+n' ? 1 : -1))
    } else if (event.type === 'wheel' || ['up', 'down', 'pageUp', 'pageDown', 'home', 'end'].includes(key)) {
      const filesFocus = event.type === 'wheel' && event.column !== undefined
        ? doc.split ? event.column < doc.left : s.focus === 'files' : s.focus === 'files'
      const delta = event.type === 'wheel' ? event.direction === 'up' ? -3 : 3 : (key === 'up' || key === 'pageUp' ? -1 : 1) * (key.startsWith('page') ? doc.page : 1)
      if (filesFocus) {
        const at = Math.max(0, doc.files.indexOf(s.selected))
        const index = doc.files[key === 'home' ? 0 : key === 'end' ? doc.files.length - 1 : Math.max(0, Math.min(doc.files.length - 1, at + delta))]
        if (index !== undefined) this.select(index)
      } else {
        const at = Math.max(0, Math.min(doc.max, key === 'home' ? 0 : key === 'end' ? doc.max : doc.documentStart + delta))
        s.position = doc.layout === undefined ? { ...s.position, row: at } : documentPosition(doc.layout, at, s.position.query)
      }
    } else this.#action(key)
    this.changed()
  }
  #action(key: string): void {
    const s = this.state
    if (key === '?') { s.help = true; s.helpScroll = 0; return }
    if (key === 'r') { void this.#load(); return }
    if (key === 'l' && s.truncated && s.limit < 4 * 1024 * 1024) { this.#limits.set(s.selected, s.limit * 2); void this.#load(); return }
    if (key === 'm' && s.mode === 'source' && /\.md$/iu.test(s.files[s.selected]?.path ?? '')) { this.#save(); s.markdown = !s.markdown; this.#restore(); return }
    const action = key === 'o' ? 'open' : key === 'e' && s.canEdit ? 'editor' : key === 'q' && s.canQuote ? 'quote' : key === 'i' && s.mode === 'source' && /\.(png|jpe?g|webp|gif)$/iu.test(s.files[s.selected]?.path ?? '') ? 'image' : undefined
    if (action === undefined || s.loading) return
    const index = s.selected
    void Promise.resolve().then(() => {
      if (!this.#closed) return this.request.action(action, index, s.markdown ? undefined : s.source, s.position)
    }).then(() => {
      if (this.#closed) return
      if (action === 'quote') this.close()
      else { this.state.notice = action === 'image' ? '' : 'Opened original file.'; this.changed() }
    }, error => { if (!this.#closed) { this.state.notice = error instanceof Error ? error.message : String(error); this.changed() } })
  }
}
