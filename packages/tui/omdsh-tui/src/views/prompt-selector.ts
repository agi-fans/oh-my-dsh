/** Interactive terminal selector used by resume, approval, and user questions. */

import { imageSize, type ImageProtocol } from '../chrome/terminal-images.ts'
import type { TuiDocumentPosition, TuiPrompt } from '../definition.ts'
import { documentLayout, documentMatches, documentModel, documentPosition, documentStart } from './document-reader.ts'
import { promptTreeRows } from './prompt-tree.ts'
import { rankSearchResults } from '../input/fuzzy-search.ts'
import { renderEditor, renderFramedBlock } from '../chrome/box.ts'
import { renderMarkdown } from '../chrome/markdown.ts'
import { BOX, SYMBOL, type Theme } from '../chrome/theme.ts'
import { padToWidth, sliceCells, stripAnsi, truncateToWidth, visibleWidth, wrapTextStable } from '../chrome/width.ts'
import { formatHotkeyKeys, formatOverlayHint, type HotkeyRow } from './hotkey-format.ts'
import { renderListRow, type ListRow } from './list-view.ts'

/** Presentation state owned by the terminal while a human prompt is active. */
export interface PromptSelectorState {
  request: TuiPrompt
  selected: number
  checked: ReadonlySet<number>
  /** Requested first document row for full-screen review surfaces. */
  documentScroll?: number
  documentAnchor?: TuiDocumentPosition | undefined
  documentWordWrap?: boolean
  documentColumn?: number
  documentQuery?: string
  documentInput?: 'search' | 'line' | undefined
  documentError?: string | undefined
  documentOrigin?: TuiDocumentPosition
  documentOriginalQuery?: string
  documentTarget?: number | undefined
  collapsed?: ReadonlySet<string>
  previewScroll?: number
  /** Whether a rejected plan is collecting optional revision feedback. */
  feedback?: boolean
  /** Editing or Take time paused this local countdown. */
  waitHeld?: boolean
  /** Timestamp before which keyboard confirmation is ignored. */
  armedUntil?: number
}

export interface PromptSelectorFrame {
  image?: import('../chrome/terminal-images.ts').ImagePlacement
  lines: string[]
  cursor: { row: number; column: number }
  document?: { start: number; maxStart: number; pageSize: number; position?: TuiDocumentPosition }
  cursorVisible?: boolean
}

/** Maximum option rows retained in the prompt overlay before it windows. */
export const PROMPT_SELECTOR_MAX_VISIBLE = 10

// Every key the prompt handlers accept, covering the inline card, the full-screen
// list, and plan review. Rows whose first word is the footer label are also
// printed by the matching bottom hint.
const HOTKEY_TEXT: HotkeyRow = { keys: 'Text', action: 'Filter — narrow the option list while typing' }
const HOTKEY_NAVIGATE: HotkeyRow = { keys: '↑↓', action: 'Navigate options' }
const HOTKEY_NAVIGATE_TAB: HotkeyRow = { keys: 'Tab / Shift+Tab', action: 'Navigate options, like ↑↓' }
const HOTKEY_CHOOSE: HotkeyRow = { keys: '←→', action: 'Choose — move between the plan options' }
const HOTKEY_PAGE: HotkeyRow = { keys: 'PgUp / PgDn', action: 'Scroll — page the options or the plan' }
const HOTKEY_EDGE: HotkeyRow = { keys: 'Home / End', action: 'Jump to the first or last option, or the plan edges' }
const HOTKEY_TOGGLE: HotkeyRow = { keys: 'Space', action: 'Toggle — check or clear a multi-select option' }
const HOTKEY_SELECT: HotkeyRow = { keys: 'Enter', action: 'Select the highlighted option' }
const HOTKEY_SUBMIT: HotkeyRow = { keys: 'Enter', action: 'Submit — send revision feedback, or keep planning when empty' }
const HOTKEY_SUBMIT_NEWLINE: HotkeyRow = { keys: 'Ctrl+J', action: 'Submit — send revision feedback like Enter' }
const HOTKEY_BACK: HotkeyRow = { keys: 'Esc', action: 'Back — leave revision feedback' }
const HOTKEY_CANCEL: HotkeyRow = { keys: 'Esc', action: 'Cancel — dismiss the prompt' }
const HOTKEY_CANCEL_CTRL: HotkeyRow = { keys: 'Ctrl+C', action: 'Cancel — dismiss the prompt at any step' }
const HOTKEY_TAKE_TIME: HotkeyRow = { keys: 'Ctrl+T', action: 'Take time — pause the question countdown' }
const HOTKEY_SKIP: HotkeyRow = { keys: 'Ctrl+S', action: 'Skip this question explicitly' }

/** Keys the prompt selector accepts; `/help` and its bottom hints read this list. */
export const PROMPT_SELECTOR_HOTKEYS: readonly HotkeyRow[] = [
  HOTKEY_TEXT,
  HOTKEY_NAVIGATE,
  HOTKEY_NAVIGATE_TAB,
  HOTKEY_CHOOSE,
  HOTKEY_PAGE,
  HOTKEY_EDGE,
  HOTKEY_TOGGLE,
  HOTKEY_SELECT,
  HOTKEY_SUBMIT,
  HOTKEY_SUBMIT_NEWLINE,
  HOTKEY_BACK,
  HOTKEY_CANCEL,
  HOTKEY_CANCEL_CTRL,
  HOTKEY_TAKE_TIME,
  HOTKEY_SKIP,
]

type PromptOption = NonNullable<TuiPrompt['options']>[number]

/** Preserve editor indices and line breaks while hiding every entered cell. */
export function maskPromptSecret(input: string): string {
  return input.replace(/[^\r\n]/g, '•')
}

/** Options matching the current full-screen selector query. */
export function filteredPromptOptions(request: TuiPrompt, query: string, collapsed?: ReadonlySet<string>): readonly PromptOption[] {
  if (request.presentation === 'fullscreen-tree') return promptTreeRows(request, collapsed, query).map(row => row.option)
  const options = request.options ?? []
  if (request.filterable !== true) return options
  return rankSearchResults(options, query, option =>
    [option.label, option.value, option.preview, option.description, option.badge?.label]
      .filter((value): value is string => value !== undefined))
}

/** Keep the same live choice selected as entries arrive, move, or disappear. */
export function refreshPromptOptions<T extends PromptSelectorState>(state: T, options: NonNullable<TuiPrompt['options']>, query: string): T {
  const previous = filteredPromptOptions(state.request, query, state.collapsed)[state.selected]
  const request = { ...state.request, options }
  const filtered = filteredPromptOptions(request, query, state.collapsed)
  const found = filtered.findIndex(option => (option.value ?? option.label) === (previous?.value ?? previous?.label))
  const selected = found < 0 ? Math.max(0, Math.min(state.selected, filtered.length - 1)) : found
  const checkedValues = new Set((state.request.options ?? []).filter((_, at) => state.checked.has(at)).map(option => option.value ?? option.label))
  return { ...state, request, selected, checked: new Set(options.flatMap((option, at) => checkedValues.has(option.value ?? option.label) ? [at] : [])),
    ...((filtered[selected]?.value ?? filtered[selected]?.label) === (previous?.value ?? previous?.label) ? {} : { previewScroll: 0 }) }
}

const previewCache = new WeakMap<PromptOption, Map<string, string[]>>()

function treePreview(option: PromptOption | undefined, theme: Theme, width: number): string[] {
  if (option === undefined) return ['No matching conversation turns.']
  let cache = previewCache.get(option)
  if (cache === undefined) { cache = new Map(); previewCache.set(option, cache) }
  const key = `${width}:${theme.key}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const lines = renderMarkdown(option.preview ?? option.label, theme, width)
  if (cache.size >= 4) cache.clear()
  cache.set(key, lines)
  return lines
}

function treePageLayout(request: TuiPrompt, width: number, height: number) {
  const actions = (request.actions ?? []).map(item => `${item.key} ${item.label}`).join(' · ')
  const hint = `↑↓ · ←→ fold${width >= 90 ? ' · type search' : ''}${actions === '' ? '' : ` · ${actions}`}${width >= 90 ? ' · Ctrl+↑↓ preview' : ''}`
  const hints = wrapTextStable(hint, width - 4).slice(0, Math.max(1, Math.floor((height - 6) / 2)))
  const middle = height - 6 - hints.length
  const listHeight = width >= 90 ? middle : Math.max(1, Math.floor((middle - 1) / 2))
  const previewHeight = width >= 90 ? middle : middle - listHeight - 1
  return { hints, middle, listHeight, previewHeight }
}

/** Page movement follows the list space remaining after wrapped action hints. */
export function promptTreePageSize(request: TuiPrompt, width: number, height: number): number {
  return height < 10 || width < 20 ? Math.max(1, height - 8) : treePageLayout(request, width, height).listHeight
}

/** A hierarchical choice with an independently scrollable content preview. */
export function renderPromptTreePage(
  state: PromptSelectorState, theme: Theme, width: number, height: number,
  input: string, inputCursor: number, appName: string,
): PromptSelectorFrame {
  if (height < 10 || width < 20) return renderPromptSelector(state, theme, width, input, inputCursor, Math.max(1, height - 8))
  const rows = promptTreeRows(state.request, state.collapsed, input)
  const selected = Math.max(0, Math.min(state.selected, rows.length - 1))
  const option = rows[selected]?.option
  const split = width >= 90
  const inner = width - 4
  const { hints, middle, listHeight, previewHeight } = treePageLayout(state.request, width, height)
  const listWidth = split ? Math.floor((inner - 3) * 0.45) : inner
  const previewWidth = split ? inner - listWidth - 3 : inner
  const range = promptSelectorVisibleRange(rows.length, selected, listHeight)
  const list: string[] = []
  for (let at = range.start; at < range.end; at++) {
    const row = rows[at]!
    const marker = at === selected ? theme.fg('accent', SYMBOL.cursor + ' ') : '  '
    const fold = row.expandable ? state.collapsed?.has(row.option.value ?? row.option.label) && input === '' ? '▸ ' : '▾ ' : '  '
    const badge = row.option.badge?.label === undefined ? '' : `[${row.option.badge.label}] `
    const text = badge + row.option.label
    const prefixLimit = Math.max(1, Math.floor(listWidth / 3))
    const prefix = row.prefix.length <= prefixLimit ? row.prefix : '…' + row.prefix.slice(-(prefixLimit - 1))
    list.push(fit(marker + theme.fg('dim', prefix + fold) + (at === selected ? theme.fg('accent', text) : text), listWidth))
  }
  if (rows.length === 0) list.push(fit(theme.fg('dim', state.request.emptyText ?? 'No matching conversation turns.'), listWidth))
  const preview = treePreview(option, theme, Math.max(1, previewWidth))
  const maxScroll = Math.max(0, preview.length - previewHeight)
  const scroll = Math.max(0, Math.min(state.previewScroll ?? 0, maxScroll))
  const lines = [pageTop(theme, width, appName), pageRow(theme, theme.bold(state.request.title), width),
    pageRow(theme, theme.fg('dim', '> ') + input, width), pageDivider(theme, width)]
  if (split) {
    for (let at = 0; at < middle; at++) lines.push(pageRow(theme,
      fit(list[at] ?? '', listWidth) + theme.fg('border', ' │ ') + fit(preview[scroll + at] ?? '', previewWidth), width))
  } else {
    for (let at = 0; at < listHeight; at++) lines.push(pageRow(theme, list[at] ?? '', width))
    lines.push(pageDivider(theme, width))
    for (let at = 0; at < previewHeight; at++) lines.push(pageRow(theme, preview[scroll + at] ?? '', width))
  }
  const action = option?.submitLabel ?? state.request.submitLabel ?? 'select'
  lines.push(pageRow(theme, theme.fg('dim', `Enter ${action} · Esc back`), width),
    ...hints.map(hint => pageRow(theme, theme.fg('dim', hint), width)), pageBottom(theme, width))
  return { lines, cursor: { row: 2, column: Math.min(width - 3, 4 + visibleWidth(input.slice(0, inputCursor))) },
    document: { start: scroll, maxStart: maxScroll, pageSize: previewHeight }, cursorVisible: true }
}

/** Fold/unfold a subtree or move to its parent, preserving selection by value. */
export function movePromptTree(state: PromptSelectorState, direction: 'left' | 'right', query: string): PromptSelectorState {
  const rows = promptTreeRows(state.request, state.collapsed, query)
  const row = rows[state.selected]
  if (row === undefined) return state
  const value = row.option.value ?? row.option.label
  const collapsed = new Set(state.collapsed)
  if (direction === 'left' && row.expandable && !collapsed.has(value) && query === '') collapsed.add(value)
  else if (direction === 'right' && collapsed.has(value)) collapsed.delete(value)
  else if (direction === 'left') {
    const parent = rows.findIndex(item => (item.option.value ?? item.option.label) === row.option.parentValue)
    return parent < 0 ? state : { ...state, selected: parent, previewScroll: 0 }
  } else {
    const child = rows.findIndex(item => item.option.parentValue === value)
    return child < 0 ? state : { ...state, selected: child, previewScroll: 0 }
  }
  const next = promptTreeRows(state.request, collapsed, query).findIndex(item => (item.option.value ?? item.option.label) === value)
  return { ...state, collapsed, selected: Math.max(0, next), previewScroll: 0 }
}

/** Start on a matching node instead of a context-only ancestor. */
export function searchPromptSelection(state: PromptSelectorState, query: string): PromptSelectorState {
  const selected = state.request.presentation === 'fullscreen-tree'
    ? Math.max(0, promptTreeRows(state.request, state.collapsed, query).findIndex(row => row.matched)) : 0
  return { ...state, selected, previewScroll: 0 }
}


export function promptSelectorVisibleRange(
  count: number,
  selected: number,
  maxVisible: number = PROMPT_SELECTOR_MAX_VISIBLE,
): { start: number; end: number } {
  const max = Math.max(1, maxVisible)
  const index = Math.max(0, Math.min(selected, Math.max(0, count - 1)))
  const start = Math.max(0, Math.min(index - Math.floor(max / 2), Math.max(0, count - max)))
  return { start, end: Math.min(count, start + max) }
}

function optionRow(
  option: PromptOption,
  index: number,
  state: PromptSelectorState,
  theme: Theme,
  width: number,
  /**
   * The option's index in the request, when the visible row is a filtered one.
   *
   * Checked state is keyed by the request's order, not the filtered list's: a
   * query that hides the row above must not move every checkbox below it.
   */
  identity: number = index,
): string {
  // The multi-select marker is part of the label so the shared row keeps one
  // cursor cell and one description gap for every prompt, checked or not.
  const checked = state.checked.has(identity)
  const marker = state.request.multiSelect === true
    ? theme.fg(checked ? 'success' : 'dim', checked ? '[x] ' : '[ ] ')
    : ''
  const row: ListRow = {
    label: marker + option.label,
    ...(option.description === undefined ? {} : { description: option.description }),
    // A badge is part of what the row says — a session's status, a command's
    // kind. The paged list drew it, so the card must draw it too.
    ...(option.badge?.label === undefined ? {} : { value: theme.fg(option.badge.tone ?? 'muted', option.badge.label) }),
  }
  return renderListRow(row, theme, Math.max(1, width), { selected: index === state.selected })
}

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return padToWidth(truncateToWidth(text, width), width)
}

function pageBorder(theme: Theme, text: string): string {
  return theme.fg('border', text)
}

function pageRow(theme: Theme, content: string, width: number): string {
  const inner = Math.max(0, width - 4)
  return pageBorder(theme, BOX.vertical) + ' ' + fit(content, inner) + ' ' + pageBorder(theme, BOX.vertical)
}

function pageTop(theme: Theme, width: number, appName: string): string {
  const inner = Math.max(0, width - 2)
  const title = truncateToWidth(` ${appName} `, Math.max(0, inner - 1))
  const fill = Math.max(0, inner - 1 - visibleWidth(title))
  return pageBorder(theme, BOX.topLeft + BOX.horizontal)
    + theme.fg('muted', title)
    + pageBorder(theme, BOX.horizontal.repeat(fill) + BOX.topRight)
}

function pageDivider(theme: Theme, width: number): string {
  return pageBorder(theme, BOX.teeRight + BOX.horizontal.repeat(Math.max(0, width - 2)) + BOX.teeLeft)
}

function pageBottom(theme: Theme, width: number): string {
  return pageBorder(theme, BOX.bottomLeft + BOX.horizontal.repeat(Math.max(0, width - 2)) + BOX.bottomRight)
}

const documentCache = new WeakMap<TuiPrompt, Map<string, string[]>>()

/**
 * Case-insensitive find over rows the reader can already see.
 *
 * A rendered page has no source model to search, so the rows are the document.
 * Offsets are display cells, not string indexes, so CJK and emoji highlights land
 * on the glyphs the reader pointed at rather than shearing them.
 */
export function findInRows(rows: readonly string[], query: string): TextMatch[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const matches: TextMatch[] = []
  for (const [row, line] of rows.entries()) {
    const plain = stripAnsi(line).toLowerCase()
    for (let at = plain.indexOf(needle); at >= 0; at = plain.indexOf(needle, at + needle.length)) {
      matches.push({ row, start: visibleWidth(stripAnsi(line).slice(0, at)), width: visibleWidth(query.trim()) })
    }
  }
  return matches
}

/** One occurrence of a find query in a rendered document row. */
export interface TextMatch {
  row: number
  /** First cell of the hit, and how many cells it covers. */
  start: number
  width: number
}

/** Invert the matched cells of one styled row. */
export function highlightMatches(line: string, spans: readonly { start: number; width: number }[], theme: Theme): string {
  if (spans.length === 0) return line
  const plain = stripAnsi(line)
  const total = visibleWidth(plain)
  const ordered = [...spans].sort((left, right) => left.start - right.start)
  let out = ''
  let at = 0
  for (const span of ordered) {
    const start = Math.max(at, Math.min(span.start, total))
    const end = Math.min(total, Math.max(start, span.start + span.width))
    if (start > at) out += sliceCells(line, at, start - at)
    if (end > start) out += theme.inverse(sliceCells(line, start, end - start))
    at = end
  }
  if (at < total) out += sliceCells(line, at, total - at)
  return out
}

/** The rows a rendered document shows, shared with the find that searches them. */
export function documentRows(request: TuiPrompt, theme: Theme, width: number): string[] {
  let cache = documentCache.get(request)
  if (cache === undefined) { cache = new Map(); documentCache.set(request, cache) }
  const key = `${width}:${theme.name}:${theme.getFgAnsi('accent')}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const lines = renderMarkdown(request.detail ?? '', theme, width)
  if (cache.size >= 4) cache.clear()
  cache.set(key, lines)
  return lines
}

/**
 * How many rows the composer card can hold before a list is worth the screen.
 *
 * The card already windows ten rows; below this a list reads better beside the
 * conversation than instead of it. Two commands had grown their own copy of this
 * number while seventeen call sites ignored it entirely.
 */
export const INLINE_LIST_LIMIT = 8

/**
 * Does this list need the whole screen?
 *
 * The composer card and the paged list share their navigation, so this is only a
 * question of fit. A tree has depth to show; a list longer than the card's window
 * cannot be read in place; and a list whose rows carry a preview is being browsed
 * for that preview, which the card does not draw. Everything else — most lists,
 * most of the time — stays beside the conversation it interrupted.
 */
export function promptNeedsPage(request: TuiPrompt): boolean {
  // A list is a choice, and a choice belongs beside the conversation whatever its
  // length: the card windows its rows, filters by typing, and shows the selected
  // row's preview. Counting rows was the wrong variable — a long list is still a
  // list. Only a tree has structure the card cannot show.
  return request.presentation === 'fullscreen-tree'
}

/** Render a bounded, scrollable Markdown document with fixed actions. */
function documentActionRows(state: PromptSelectorState, theme: Theme, width: number, pageHeight: number): string[] {
  const actionRows: string[] = []
  let actionRow = ''
  const actionWidth = Math.max(1, width - 5)
  for (const [index, option] of (state.request.options ?? []).entries()) {
    const label = truncateToWidth(`${index === state.selected ? '› ' : '  '}[ ${option.label} ]`, actionWidth)
    if (actionRow !== '' && visibleWidth(actionRow) + 3 + visibleWidth(label) > actionWidth) {
      actionRows.push(actionRow)
      actionRow = ''
    }
    const painted = index === state.selected ? theme.bold(theme.fg('accent', label)) : theme.fg('muted', label)
    actionRow += (actionRow === '' ? '' : theme.fg('dim', '   ')) + painted
  }
  actionRows.push(actionRow)
  if (actionRows.length > Math.max(1, pageHeight - 9)) {
    const selected = state.request.options?.[state.selected]
    actionRows.splice(0, actionRows.length, selected === undefined ? ''
      : theme.bold(theme.fg('accent', truncateToWidth(`› [ ${selected.label} ]`, actionWidth))))
  }
  return actionRows
}

/** Reserve a bordered, padded rectangle; graphics never become display-row content. */
export function renderImagePreviewPage(state: PromptSelectorState, theme: Theme, width: number, height: number,
  appName: string, protocol?: ImageProtocol, cell?: { width: number; height: number }): PromptSelectorFrame {
  const image = state.request.documentImage!
  if (width < 16 || height < 10) return renderPromptSelector({ ...state, request: { ...state.request,
    detail: image.description + '\nEnlarge the terminal or use Open to view the image.' } }, theme, width, '', 0, Math.max(1, height - 8))
  const actions = documentActionRows(state, theme, width, height)
  const hints = 'Tab/←→ actions · Enter activate · Esc back'
  const bodyRows = Math.max(1, height - 8 - actions.length)
  const lines = [pageTop(theme, width, appName + ' · ' + state.request.title), pageRow(theme, state.request.question, width),
    pageRow(theme, theme.fg('muted', image.description), width), pageDivider(theme, width)]
  const top = lines.length
  const canOpen = state.request.options?.some(option => option.value === 'open') === true
  const fallback = protocol === undefined ? wrapTextStable('Inline images are unavailable in this terminal. '
    + (canOpen ? 'Use Open to view the original.' : 'This attachment has no local original to open.'), width - 8) : []
  for (let at = 0; at < bodyRows; at++) lines.push(pageRow(theme, '  ' + (fallback[at] ?? ''), width))
  lines.push(pageDivider(theme, width), pageRow(theme, theme.fg('muted', (state.request.detail ?? '').replace(/[\r\n]+/gu, ' ')), width),
    ...actions.map(row => pageRow(theme, ' ' + row, width)), pageRow(theme, theme.fg('dim', hints), width), pageBottom(theme, width))
  const size = imageSize(image, width - 8, bodyRows, cell)
  return { lines, cursor: { row: height - 1, column: 0 }, cursorVisible: false,
    ...(protocol === undefined ? {} : { image: { image, protocol, row: top + Math.floor((bodyRows - size.rows) / 2),
      column: 4 + Math.floor((width - 8 - size.columns) / 2), ...size } }) }
}

export function renderPlanReviewPage(
  state: PromptSelectorState,
  theme: Theme,
  width: number,
  height: number,
  input: string,
  inputCursor: number,
  appName: string,
): PromptSelectorFrame {
  const pageHeight = Math.max(1, height)
  const source = state.request.documentSource
  if ((source === undefined && (pageHeight < 10 || width < 24)) || pageHeight < 7 || width < 12) {
    return renderPromptSelector(source === undefined ? state : { ...state, request: { ...state.request, detail: source.text } }, theme, width, input, inputCursor, Math.max(1, pageHeight - 8))
  }
  const feedback = state.feedback === true
  const actionRows = documentActionRows(state, theme, width, pageHeight)
  const readerInput = state.documentInput !== undefined
  const customHints = (state.request.actions ?? []).map(action => `${action.key.toUpperCase()} ${action.label}`)
  let readerHints = source === undefined ? [] : wrapTextStable(readerInput ? 'Enter apply · Esc cancel'
    : (state.request.interrupt === undefined ? '' : 'Ctrl+C interrupt · ') + 'W wrap · Alt+←→ pan · ↑↓/PgUp/PgDn scroll · ' + (state.request.documentTail === true ? 'Home start · End follow' : 'Home/End edges') + ' · / find · Ctrl+N/P match · G line' + (source.diff ? ' · [/] hunk' : '')
      + ' · ' + ['Tab/←→ actions', 'Enter activate', ...customHints, 'Esc back'].join(' · '), width - 4)
  const maxHints = Math.max(1, Math.min(4, pageHeight - 8 - actionRows.length))
  if (readerHints.length > maxHints) readerHints = [...readerHints.slice(0, maxHints - 1), 'Tab actions · Enter · Esc back']
  const compactReader = source !== undefined && pageHeight < 10
  if (compactReader) readerHints = []
  const footerRows = feedback ? 5 : actionRows.length + 3 + (source === undefined ? 0 : readerHints.length)
  const bodyRows = Math.max(1, pageHeight - (source === undefined ? 5 : compactReader ? 2 : 3) - footerRows)
  const markdownWidth = Math.max(1, width - 6)
  const layout = source === undefined ? undefined : documentLayout(source, theme, markdownWidth, {
    wordWrap: state.documentWordWrap ?? state.request.documentPosition?.wordWrap ?? true,
    column: state.documentColumn ?? state.request.documentPosition?.column ?? 0,
  })
  const document = layout?.rows ?? documentRows(state.request, theme, markdownWidth)
  const maxStart = Math.max(0, document.length - bodyRows)
  const start = Math.max(0, Math.min(state.documentScroll === Number.POSITIVE_INFINITY ? maxStart : layout !== undefined && state.documentAnchor !== undefined
    ? documentStart(layout, state.documentAnchor) : state.documentScroll ?? state.request.documentPosition?.row ?? 0, maxStart))
  const visible = document.slice(start, start + bodyRows)
  const query = state.documentQuery ?? ''
  const matches = source === undefined ? [] : documentMatches(source, query)
  const textMatches = source === undefined ? findInRows(document, query) : []
  const matching = new Set(matches)
  if (layout !== undefined) for (let at = 0; at < visible.length; at++) {
    if (matching.has(layout.sourceRows[start + at] ?? -1)) {
      const row = visible[at] ?? ''
      visible[at] = theme.inverse(layout.gutterWidth === 0 ? row : '›' + row.slice(1))
    }
  }
  if (textMatches.length > 0) {
    // Paint the hits themselves, so the reader sees the word, not just the row.
    for (const match of textMatches) {
      const at = match.row - start
      if (at < 0 || at >= visible.length) continue
      visible[at] = highlightMatches(visible[at] ?? '', [match], theme)
    }
  }
  while (visible.length < bodyRows) visible.push('')
  const subject = state.request.presentation === 'document' ? 'document' : 'plan'
  if (source === undefined && start > 0) visible[0] = theme.fg('dim', `… ↑ ${start} earlier ${subject} lines`)
  if (source === undefined && start + bodyRows < document.length) {
    visible[Math.max(0, visible.length - 1)] = theme.fg('dim', `… ↓ ${document.length - start - bodyRows} later ${subject} lines`)
  }

  const lines = [
    pageTop(theme, width, `${appName} · ${compactReader ? state.request.question : state.request.title}`),
    ...(source === undefined ? [pageRow(theme, '', width)] : []),
    ...(compactReader ? [] : [pageRow(theme, ' ' + theme.bold(state.request.question), width)]),
    ...(source === undefined ? [pageRow(theme, '', width)] : []),
    pageDivider(theme, width),
    ...visible.map(line => pageRow(theme, '  ' + line, width)),
    pageDivider(theme, width),
  ]

  let cursor = { row: Math.max(0, lines.length - 1), column: 1 }
  if (feedback) {
    lines.push(pageRow(theme, ' ' + theme.bold('Revision feedback') + theme.fg('dim', ' · optional'), width))
    const prefix = theme.fg('accent', '> ')
    const available = Math.max(1, width - 8)
    const displayInput = input.replace(/\r?\n/gu, ' ↵ ')
    const displayBeforeCursor = input.slice(0, inputCursor).replace(/\r?\n/gu, ' ↵ ')
    const value = truncateToWidth(displayInput, available)
    const inputRow = lines.length
    lines.push(pageRow(theme, ' ' + prefix + value, width))
    // "empty Enter keeps planning" is prose, but it names the key through the catalog.
    lines.push(pageRow(theme, theme.fg('dim', `[${formatOverlayHint([HOTKEY_SUBMIT, HOTKEY_BACK, HOTKEY_CANCEL_CTRL])} · Ctrl+X editor · empty ${formatHotkeyKeys(HOTKEY_SUBMIT)} keeps planning]`), width))
    lines.push(pageBottom(theme, width))
    cursor = {
      row: inputRow,
      column: Math.min(Math.max(1, width - 3), 5 + visibleWidth(displayBeforeCursor)),
    }
  } else {
    if (source === undefined && (readerInput || query !== '')) {
      // A rendered page has no line numbers to cite, so the status is the find
      // itself: the query, how many hits it has, and where the reader is in them.
      const index = textMatches.findIndex(match => match.row === state.documentTarget)
      const hits = textMatches.length === 0
        ? 'No match'
        : `${index < 0 ? 1 : index + 1}/${textMatches.length} matching rows`
      const label = state.documentInput === 'search' ? 'Find: ' : ''
      const value = input.replace(/\r?\n/gu, ' ')
      const status = readerInput ? label + value : `${hits} · “${query}”`
      cursor = { row: lines.length, column: Math.min(width - 3, 2 + visibleWidth(label + value.slice(0, inputCursor))) }
      lines.push(pageRow(theme, theme.fg('muted', status), width))
    }
    if (source !== undefined) {
      const row = layout?.sourceRows[start] ?? 0
      const model = documentModel(source)
      const line = model.numbers[row]?.next ?? model.numbers[row]?.old
      const position = source.diff ? `Diff row ${row + 1}/${model.lines.length}` : `Line ${line ?? 1}/${(source.firstLine ?? 1) + model.lines.length - 1}`
      const following = state.request.documentTail !== true ? '' : state.documentScroll === Number.POSITIVE_INFINITY ? ' · Following' : ' · Paused'
      const horizontal = layout?.wordWrap === false ? ` · No wrap · Col ${layout.column + 1}` : ''
      const match = matches.indexOf(state.documentTarget ?? row)
      const search = query === '' ? '' : ` · ${match < 0 ? matches.length : `${match + 1}/${matches.length}`} matching lines · “${query}”`
      const label = state.documentInput === 'search' ? 'Find: ' : 'Line: '
      const value = input.replace(/\r?\n/gu, ' ')
      const status = (readerInput ? label + value + (state.documentError === undefined ? '' : ` · ${state.documentError}`)
        : position + horizontal + following + (source.status === undefined ? '' : ` · ${source.status}`) + search + (state.documentError === undefined ? '' : ` · ${state.documentError}`)
      ).replace(/[\r\n]+/gu, ' ')
      cursor = { row: lines.length, column: Math.min(width - 3, 2 + visibleWidth(label + value.slice(0, inputCursor))) }
      lines.push(pageRow(theme, theme.fg('muted', status), width))
    }
    lines.push(...actionRows.map(row => pageRow(theme, ' ' + row, width)))
    const shortcuts = state.request.presentation === 'document' && state.request.actions?.length
      ? 'Tab/←→ select · Enter activate · ' + state.request.actions.map(action => `${action.key.toUpperCase()} ${action.label}`).join(' · ') + ' · Esc back'
      : formatOverlayHint([HOTKEY_PAGE, HOTKEY_NAVIGATE_TAB, HOTKEY_SELECT, HOTKEY_CANCEL])
        + (state.request.presentation === 'plan-review' ? ' · Ctrl+X editor' : '')
    // A page long enough to need scrolling is a page someone will want to search.
    const pageHint = source === undefined && state.request.presentation === 'document'
      ? `[${shortcuts} · / find · Ctrl+N/P match]`
      : `[${shortcuts}]`
    lines.push(...(source === undefined ? [pageHint] : readerHints).map(hint => pageRow(theme, theme.fg('dim', hint), width)))
    lines.push(pageBottom(theme, width))
  }

  return {
    lines,
    cursor,
    document: { start, maxStart, pageSize: Math.max(1, bodyRows - 1),
      ...(layout === undefined ? state.request.presentation === 'document' ? { position: { row: start, wrap: 0, query: '' } } : {} : { position: { ...documentPosition(layout, start, query),
        ...(state.request.documentTail === true ? { following: state.documentScroll === Number.POSITIVE_INFINITY } : {}) } }) },
    cursorVisible: feedback || readerInput,
  }
}

/** Render the prompt card and its answer editor as one bottom-of-screen overlay. */
export function renderPromptSelector(
  state: PromptSelectorState,
  theme: Theme,
  width: number,
  input: string,
  inputCursor: number,
  maxVisible: number = PROMPT_SELECTOR_MAX_VISIBLE,
): PromptSelectorFrame {
  const options = filteredPromptOptions(state.request, input, state.collapsed)
  const contentWidth = Math.max(1, width - 4)
  const body = [state.request.question]
  if (state.request.wait !== undefined) {
    const remaining = Math.max(0, Math.ceil((state.request.wait.deadline - Date.now()) / 1_000))
    body.push(theme.fg('dim', state.waitHeld === true
      ? 'Take your time · waiting for your answer'
      : `Continues in ${remaining}s · ${formatHotkeyKeys(HOTKEY_TAKE_TIME)} take time`))
  }
  if (state.request.detail !== undefined && state.request.detail !== '') body.push('', state.request.detail)
  if (options.length > 0) {
    const { start, end } = promptSelectorVisibleRange(options.length, state.selected, maxVisible)
    body.push('', ...options.slice(start, end).map((option, offset) =>
      optionRow(option, start + offset, state, theme, contentWidth, (state.request.options ?? []).indexOf(option))))
    if (options.length > maxVisible) {
      body.push(theme.fg('dim', `  ${state.selected + 1}/${options.length} · scroll for more`))
    }
    // The paged list draws the selected row's preview beside the rows; the card
    // gives it three lines underneath, so demoting a previewed list keeps the
    // content it was being browsed for.
    const preview = options[state.selected]?.preview
    if (preview !== undefined && preview !== '') {
      const lines = wrapTextStable(preview, contentWidth).slice(0, 3)
      body.push('', ...lines.map(line => theme.fg('dim', '  ' + line)))
    }
  } else if (state.request.emptyText !== undefined) {
    // The paged list says why it is empty and what to press instead; the card has
    // to say the same thing, or demoting a list loses the sentence that explains it.
    body.push('', theme.fg('dim', `  ${state.request.emptyText}`))
  }
  const submit = state.request.submitLabel?.trim()
    || (options.length === 0 ? 'answer' : state.request.multiSelect === true ? 'confirm' : 'select')
  // The request supplies the submit verb; the key itself comes from the catalog.
  const select = `${formatHotkeyKeys(HOTKEY_SELECT)} ${submit}`
  const navigation = state.request.presentation === 'progress'
    ? formatOverlayHint([HOTKEY_CANCEL, HOTKEY_CANCEL_CTRL], 'catalog')
    : options.length === 0
      ? `${select} · ${formatOverlayHint([HOTKEY_CANCEL])}`
      : state.request.multiSelect === true
        ? `${formatOverlayHint([HOTKEY_NAVIGATE])} · ${formatOverlayHint([HOTKEY_TOGGLE])} · ${select} · ${formatOverlayHint([HOTKEY_CANCEL])}`
        : `${formatOverlayHint([HOTKEY_NAVIGATE])} · ${select} · ${formatOverlayHint([HOTKEY_CANCEL])}`
  const dismiss = state.request.dismissLabel
  const actionHints = (state.request.actions ?? []).map(action => `${action.key} ${action.label}`)
  const hints = [
    dismiss === undefined ? navigation : navigation.replace(formatOverlayHint([HOTKEY_CANCEL]), `${formatHotkeyKeys(HOTKEY_CANCEL)} ${dismiss.toLowerCase()}`),
    ...(state.request.skippable === true ? [formatOverlayHint([HOTKEY_SKIP])] : []),
    ...actionHints,
  ]
  body.push('', theme.fg('dim', hints.join(' · ')))

  const card = renderFramedBlock({
    header: state.request.title,
    state: 'warning',
    lines: body,
    width,
    applyBg: false,
  }, theme)
  if (state.request.allowCustom === false || state.request.presentation === 'progress') {
    return {
      lines: card,
      // Keep the terminal caret on body padding; the visible selector glyph
      // owns focus while no text editor is present.
      cursor: { row: Math.min(1, Math.max(0, card.length - 1)), column: 1 },
      cursorVisible: false,
    }
  }
  const secret = state.request.secret === true
  const displayInput = secret ? maskPromptSecret(input) : input
  /**
   * A question that is only text is the composer, not a card above it.
   *
   * This path used to draw a framed question and then a second framed editor
   * under it: two borders that each looked like the place to type, two hint
   * lines saying what Enter does, and a label reading `answer` that named
   * nothing the reader had not already been told. A modal question is an
   * interaction state the composer can carry itself — label in the top rule,
   * question as the placeholder, keys in the bottom rule — which is also how pi
   * mounts a dialog, in the editor's own slot.
   *
   * A prompt that also offers options keeps the card: a list plus a text field
   * genuinely is two things. So does one that carries supporting copy, and one
   * counting down a deadline — both need rows the bottom rule cannot give them.
   */
  const detail = state.request.detail ?? ''
  if (options.length === 0 && detail === '' && state.request.wait === undefined) {
    const label = secret ? `${state.request.title} · hidden` : state.request.title
    const editor = renderEditor({
      width,
      input: displayInput,
      inputCursor,
      status: ' ' + theme.fg('accent', label) + ' ',
      ...(state.request.question === '' ? {} : { inlineHint: state.request.question }),
      // The keys live on the bottom rule so the frame says how to answer without
      // spending a row on it.
      ...(hints.length === 0 ? {} : { note: hints.join(' · ') }),
      border: 'accent',
    }, theme)
    return { lines: editor.lines, cursor: editor.cursor, cursorVisible: true }
  }
  const editor = renderEditor({
    width,
    input: displayInput,
    inputCursor,
    status: theme.fg('muted', secret ? 'API key · hidden' : input === '' ? 'answer' : 'custom answer'),
    border: 'accent',
  }, theme)
  const editorStart = card.length + 1
  return {
    lines: [...card, '', ...editor.lines],
    cursor: { row: editorStart + editor.cursor.row, column: editor.cursor.column },
    cursorVisible: true,
  }
}

/** Keep a selected option index within the available prompt options. */
export function movePromptSelection(
  state: PromptSelectorState,
  next: number,
  count: number = state.request.options?.length ?? 0,
): PromptSelectorState {
  if (count === 0) return state
  const selected = (next % count + count) % count
  return selected === state.selected ? state : { ...state, selected, previewScroll: 0 }
}

/** Toggle the active row for a multi-select prompt. */
export function togglePromptSelection(state: PromptSelectorState, query = ''): PromptSelectorState {
  const option = filteredPromptOptions(state.request, query)[state.selected]
  if (state.request.multiSelect !== true || option === undefined) return state
  const index = state.request.options?.indexOf(option) ?? -1
  if (index < 0) return state
  const checked = new Set(state.checked)
  if (checked.has(index)) checked.delete(index)
  else checked.add(index)
  return { ...state, checked }
}

/** Resolve the selected labels in stable option order. */
export function selectedPromptAnswer(state: PromptSelectorState): string | null {
  const options = state.request.presentation === 'fullscreen-tree'
    ? filteredPromptOptions(state.request, '', state.collapsed) : state.request.options ?? []
  if (options.length === 0) return null
  if (state.request.multiSelect !== true) {
    const option = options[state.selected]
    return option?.value ?? option?.label ?? null
  }
  const labels = options.flatMap((option, index) => state.checked.has(index) ? [option.value ?? option.label] : [])
  return labels.length === 0 ? state.request.allowEmptySelection === true ? '' : null : labels.join(', ')
}

/** Resolve the selected answer after applying a full-screen selector query. */
export function selectedFilteredPromptAnswer(state: PromptSelectorState, query: string): string | null {
  const option = filteredPromptOptions(state.request, query, state.collapsed)[state.selected]
  return option?.value ?? option?.label ?? null
}
