/** File comparison layout; terminal ownership and asynchronous reads stay in the controller. */
import type { TuiDocumentPosition, TuiDocumentSource, TuiReviewFile } from '../definition.ts'
import { paintSurface, type Theme } from '../chrome/theme.ts'
import { padToWidth, stripAnsi, truncateToWidth, wrapText } from '../chrome/width.ts'
import { documentLayout, documentMarkdown, documentMatches, documentPosition, documentStart } from './document-reader.ts'

export interface FileBrowserState {
  title: string
  files: readonly TuiReviewFile[]
  selected: number
  focus: 'files' | 'document'
  filter: string
  editing?: 'filter' | 'search' | 'line' | undefined
  input: string
  inputCursor: number
  mode: 'diff' | 'source'
  markdown: boolean
  position: TuiDocumentPosition
  source?: TuiDocumentSource | undefined
  message: string
  loading: boolean
  help: boolean
  helpScroll: number
  menu: number | undefined
  notice: string
  canEdit: boolean
  canQuote: boolean
  truncated: boolean
  limit: number
}

export function browserFiles(state: FileBrowserState): number[] {
  const words = state.filter.toLowerCase().split(/\s+/u).filter(Boolean)
  return state.files.flatMap((file, index) => words.every(word => `${file.path} ${file.previousPath ?? ''} ${file.status ?? ''}`.toLowerCase().includes(word)) ? [index] : [])
}

export function browserActions(state: FileBrowserState): { label: string; key: string }[] {
  return [
    { label: 'Open original', key: 'o' },
    ...(state.canEdit ? [{ label: 'Open in editor', key: 'e' }] : []),
    ...(state.canQuote ? [{ label: 'Quote in composer', key: 'q' }] : []),
    ...(state.mode === 'source' && /\.md$/iu.test(state.files[state.selected]?.path ?? '') ? [{ label: state.markdown ? 'Show source' : 'Render Markdown', key: 'm' }] : []),
    ...(state.mode === 'source' && /\.(png|jpe?g|webp|gif)$/iu.test(state.files[state.selected]?.path ?? '') ? [{ label: 'Preview image', key: 'i' }] : []),
    ...(state.truncated && state.limit < 4 * 1024 * 1024 ? [{ label: 'Load more', key: 'l' }] : []),
    { label: 'Refresh current file', key: 'r' },
    { label: 'Keyboard help', key: '?' },
  ]
}

function clean(text: string): string { return stripAnsi(text).replace(/[\x00-\x1f\x7f]/gu, ' ') }

export function fileBrowserGeometry(state: FileBrowserState, width: number, height: number) {
  const split = width >= 100
  const left = split ? Math.min(42, Math.floor(width * 0.3)) : 0
  const documentWidth = Math.max(1, width - (split ? left + 1 : 0) - 4)
  const page = Math.max(1, height - 6)
  const files = browserFiles(state)
  const selected = Math.max(0, files.indexOf(state.selected))
  const start = Math.max(0, Math.min(selected - Math.floor(page / 2), files.length - page))
  return { split, left, documentWidth, page, files, start, showFiles: split || state.focus === 'files' }
}

export function fileBrowserDocument(state: FileBrowserState, theme: Theme, width: number, height: number) {
  const geometry = fileBrowserGeometry(state, width, height)
  const layout = state.source === undefined || state.markdown ? undefined : documentLayout(state.source, theme, geometry.documentWidth, state.position)
  const rows = geometry.files.length === 0 ? ['No matching files.'] : state.loading ? ['Loading…'] : layout?.rows ?? (state.markdown && state.source !== undefined
    ? documentMarkdown(state.source, theme, geometry.documentWidth)
    : wrapText(state.message || 'No content.', geometry.documentWidth))
  const max = Math.max(0, rows.length - geometry.page)
  const start = Math.max(0, Math.min(max, layout === undefined ? state.position.row : documentStart(layout, state.position)))
  return { ...geometry, layout, rows, max, documentStart: start,
    position: layout === undefined ? { ...state.position, row: start } : documentPosition(layout, start, state.position.query) }
}

export const FILE_BROWSER_HOTKEYS = [
  { keys: 'Tab / Enter / Esc', action: 'Switch pane / read file / close' },
  { keys: '/', action: 'Filter files or find in content' },
  { keys: 'Ctrl+N / Ctrl+P', action: 'Next / previous match' },
  { keys: 'N / P', action: 'Next / previous file' },
  { keys: 'V', action: 'Comparison / current file' },
  { keys: '↑↓ / PgUp / PgDn / Home / End', action: 'Scroll / page / edges' },
  { keys: 'G / [ / ]', action: 'Jump to new-file line / previous / next hunk' },
  { keys: 'W / Alt+← / Alt+→', action: 'Wrap / horizontal scroll' },
  { keys: 'O / E / Q / M / I', action: 'Open / editor / quote / Markdown / image' },
  { keys: 'Alt+Y / Q with a selection', action: 'Quote selected text and return to composer' },
  { keys: 'L / R / A / ?', action: 'Load more / refresh / actions / help' },
  { keys: 'Click / Drag / Right-click', action: 'Select file / select text / copy' },
] as const

export function browserHelp(width: number): string[] {
  return FILE_BROWSER_HOTKEYS.flatMap(row => wrapText(`${row.keys}  ${row.action}`, Math.max(1, width)))
}

export function renderFileBrowser(state: FileBrowserState, theme: Theme, width: number, height: number) {
  const doc = fileBrowserDocument(state, theme, width, height)
  const file = state.files[state.selected]
  const fit = (text: string, cells: number) => padToWidth(truncateToWidth(text, Math.max(0, cells)), Math.max(0, cells))
  const lines = [fit(' ' + theme.bold(clean(state.title)) + theme.fg('dim', ` · ${state.files.length} files`), width),
    fit(' ' + theme.fg('dim', clean(file?.previousPath ? `${file.previousPath} → ${file.path}` : file?.path ?? 'No files') + (file?.description ? ` · ${clean(file.description)}` : '')), width),
    theme.fg('border', '─'.repeat(Math.max(0, width)))]
  const currentMode = state.mode === 'diff' ? 'Comparison' : state.markdown ? 'Current file · Markdown' : 'Current file'
  const listHeader = ` ${state.focus === 'files' ? '›' : ' '} Files${state.filter ? ` · ${clean(state.filter)}` : ''} · ${doc.files.length}`
  const detailHeader = ` ${state.focus === 'document' ? '›' : ' '} ${currentMode}`
  lines.push(doc.split ? fit(theme.fg('accent', listHeader), doc.left) + theme.fg('border', '│') + fit(theme.fg('accent', detailHeader), width - doc.left - 1)
    : fit(theme.fg('accent', doc.showFiles ? listHeader : detailHeader), width))
  const matches = state.source === undefined ? [] : documentMatches(state.source, state.position.query)
  const actions = browserActions(state)

  for (let row = 0; row < doc.page; row++) {
    const at = doc.files[doc.start + row]
    const item = at === undefined ? undefined : state.files[at]
    const listWidth = doc.split ? doc.left : width
    let left = ''
    if (item !== undefined) {
      const path = clean(item.label)
      const slash = path.lastIndexOf('/')
      // Keep the filename visible; repeated directory prefixes yield before the name.
      const name = slash < 0 ? path : path.slice(slash + 1)
      const directory = slash < 0 ? '' : path.slice(0, slash)
      const summary = item.description?.split(' · ')[0] ?? ''
      const delta = /^(?:\+|binary)/u.test(summary) ? ' ' + clean(summary) : ''
      const prefix = `${at === state.selected ? '›' : ' '} ${item.status ?? '·'} `
      const room = Math.max(1, listWidth - prefix.length - delta.length - 2)
      const label = truncateToWidth(name, room) + (directory === '' ? '' : theme.fg('dim', `  ${directory}`))
      left = fit(prefix + truncateToWidth(label, room), Math.max(0, listWidth - delta.length - 1)) + theme.fg('dim', delta) + ' '
      left = fit(left, listWidth)
      if (at === state.selected) left = paintSurface(theme, 'userMessageBg', 'userMessageText', left)
    } else if (row === 0 && doc.files.length === 0) left = theme.fg('dim', ' No matching files.')
    const text = doc.rows.at(doc.documentStart + row) ?? ''
    let right = text
    if (doc.layout !== undefined && matches.includes(doc.layout.sourceRows[doc.documentStart + row] ?? -1)) right = paintSurface(theme, 'userMessageBg', 'userMessageText', right)
    if (state.help) right = theme.fg('dim', browserHelp(doc.documentWidth)[state.helpScroll + row] ?? '')
    else if (state.menu !== undefined) {
      const action = actions[Math.max(0, (state.menu ?? 0) - doc.page + 1) + row]
      right = action === undefined ? '' : `${row + Math.max(0, (state.menu ?? 0) - doc.page + 1) === state.menu ? '›' : ' '} ${action.key.toUpperCase()}  ${action.label}`
      if (row + Math.max(0, (state.menu ?? 0) - doc.page + 1) === state.menu) right = paintSurface(theme, 'userMessageBg', 'userMessageText', right)
    }
    const rightWidth = width - (doc.split ? doc.left + 1 : 0)
    right = '  ' + fit(right, Math.max(0, rightWidth - 4)) + '  '
    lines.push(doc.split ? fit(left, doc.left) + theme.fg('border', '│') + fit(right, rightWidth) : fit(doc.showFiles && !state.help && state.menu === undefined ? left : right, width))
  }
  const queryStatus = state.position.query ? ` · ${matches.length} matches` : ''
  const status = state.notice || state.source?.status || (state.mode === 'source' ? 'Current workspace file' : 'Comparison · V views current file')
  lines.push(fit(' ' + theme.fg('dim', clean(status) + queryStatus), width))
  const hint = state.editing !== undefined ? `${state.editing === 'filter' ? 'Filter files' : state.editing === 'search' ? 'Find' : 'New-file line'}: ${clean(state.input.slice(0, state.inputCursor))}▏${clean(state.input.slice(state.inputCursor))}  Enter apply · Esc cancel`
    : state.help ? '↑↓ / PgUp/PgDn scroll · ? / Esc back' : state.menu !== undefined ? '↑↓ choose · Enter apply · Esc back'
      : 'Tab pane · / find · V view · N/P file · A actions · ? help · Esc close'
  lines.push(fit(' ' + theme.fg('dim', hint), width))
  return { lines: lines.slice(0, Math.max(1, height)), cursor: { row: Math.max(0, height - 1), column: 0 }, cursorVisible: false }
}
