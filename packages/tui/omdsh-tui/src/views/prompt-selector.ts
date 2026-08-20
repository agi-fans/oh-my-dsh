/** Interactive terminal selector used by resume, approval, and user questions. */

import type { TuiPrompt } from '../definition.ts'
import { renderEditor, renderFramedBlock } from '../chrome/box.ts'
import { renderMarkdown } from '../chrome/markdown.ts'
import { BOX, SYMBOL, type Theme } from '../chrome/theme.ts'
import { padToWidth, truncateToWidth, visibleWidth } from '../chrome/width.ts'

/** Presentation state owned by the terminal while a human prompt is active. */
export interface PromptSelectorState {
  request: TuiPrompt
  selected: number
  checked: ReadonlySet<number>
  /** Requested first document row for full-screen review surfaces. */
  documentScroll?: number
  /** Whether a rejected plan is collecting optional revision feedback. */
  feedback?: boolean
}

export interface PromptSelectorFrame {
  lines: string[]
  cursor: { row: number; column: number }
  document?: { start: number; maxStart: number; pageSize: number }
  cursorVisible?: boolean
}

/** Maximum option rows retained in the prompt overlay before it windows. */
export const PROMPT_SELECTOR_MAX_VISIBLE = 10

type PromptOption = NonNullable<TuiPrompt['options']>[number]

/** Preserve editor indices and line breaks while hiding every entered cell. */
export function maskPromptSecret(input: string): string {
  return input.replace(/[^\r\n]/g, '•')
}

/** Options matching the current full-screen selector query. */
export function filteredPromptOptions(request: TuiPrompt, query: string): readonly PromptOption[] {
  const options = request.options ?? []
  const needle = query.trim().toLocaleLowerCase()
  if (request.filterable !== true || needle === '') return options
  return options.filter((option) => [option.label, option.value, option.preview, option.description, option.badge?.label]
    .some(value => value?.toLocaleLowerCase().includes(needle) === true))
}

/** Visible option window centered around the selected row. */
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
): string {
  const active = index === state.selected
  const cursor = active ? theme.fg('accent', SYMBOL.cursor + ' ') : '  '
  const marker = state.request.multiSelect === true
    ? theme.fg(state.checked.has(index) ? 'success' : 'dim', state.checked.has(index) ? '[x] ' : '[ ] ')
    : ''
  const label = active ? theme.bold(theme.fg('accent', option.label)) : option.label
  const description = option.description === undefined ? '' : theme.fg('dim', ' — ' + option.description)
  return truncateToWidth(cursor + marker + label + description, Math.max(1, width))
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

function optionBadge(option: PromptOption, theme: Theme): string {
  const badge = option.badge
  if (badge === undefined) return ''
  const icon = badge.tone === 'success'
    ? SYMBOL.success
    : badge.tone === 'error'
      ? SYMBOL.error
      : badge.tone === 'warning'
        ? SYMBOL.warning
        : SYMBOL.done
  return theme.fg(badge.tone === 'muted' ? 'dim' : badge.tone, `${icon} ${badge.label}`)
}

/** Render an OMP-style full-height searchable selector with one outer frame. */
export function renderPromptSelectorPage(
  state: PromptSelectorState,
  theme: Theme,
  width: number,
  height: number,
  input: string,
  inputCursor: number,
  appName: string,
): PromptSelectorFrame {
  const pageHeight = Math.max(1, height)
  if (pageHeight < 10 || width < 16) {
    return renderPromptSelector(state, theme, width, input, inputCursor, Math.max(1, pageHeight - 8))
  }
  const options = filteredPromptOptions(state.request, input)
  const selected = Math.max(0, Math.min(state.selected, Math.max(0, options.length - 1)))
  const compact = state.request.optionLayout === 'compact'
  const fixedRows = compact ? 9 : 11
  const visibleCount = compact
    ? Math.max(1, pageHeight - fixedRows)
    : Math.max(1, Math.floor((pageHeight - fixedRows) / 4))
  const { start, end } = promptSelectorVisibleRange(options.length, selected, visibleCount)
  const detail = state.request.detail === undefined || state.request.detail === ''
    ? ''
    : ' ' + theme.fg('muted', `(${state.request.detail})`)
  const heading = theme.bold(state.request.title) + detail
  const lines = compact
    ? [
        pageTop(theme, width, appName),
        pageRow(theme, ' ' + heading, width),
        pageDivider(theme, width),
      ]
    : [
        pageTop(theme, width, appName),
        pageRow(theme, '', width),
        pageRow(theme, ' ' + heading, width),
        pageRow(theme, '', width),
        pageDivider(theme, width),
      ]
  const searchPrefix = theme.fg('dim', '> ')
  const searchText = truncateToWidth(input, Math.max(1, width - 8))
  const searchRow = lines.length
  lines.push(pageRow(theme, searchPrefix + searchText, width), pageRow(theme, '', width))

  if (options.length === 0) {
    const empty = input === '' ? 'No sessions found.' : `No sessions match “${input}”.`
    lines.push(pageRow(theme, '  ' + theme.fg('muted', empty), width))
  } else {
    for (let index = start; index < end; index += 1) {
      const option = options[index]
      if (option === undefined) continue
      if (compact) {
        lines.push(pageRow(theme, optionRow(option, index, { ...state, selected }, theme, Math.max(1, width - 6)), width))
        continue
      }
      const active = index === selected
      const marker = active ? theme.fg('accent', SYMBOL.cursor + ' ') : '  '
      const label = active ? theme.bold(option.label) : option.label
      lines.push(pageRow(theme, marker + label, width))
      lines.push(pageRow(theme, '  ' + theme.fg('dim', option.preview ?? ''), width))
      const badge = optionBadge(option, theme)
      const description = option.description === undefined ? '' : theme.fg('dim', option.description)
      const separator = description !== '' && badge !== '' ? theme.fg('dim', ' · ') : ''
      lines.push(pageRow(theme, '  ' + description + separator + badge, width), pageRow(theme, '', width))
    }
  }

  const footerRows = 4
  const targetBeforeFooter = Math.max(0, pageHeight - footerRows)
  if (lines.length > targetBeforeFooter) lines.length = targetBeforeFooter
  while (lines.length < targetBeforeFooter) lines.push(pageRow(theme, '', width))
  const position = options.length === 0 ? '' : ` · ${selected + 1}/${options.length}`
  const hint = `[type to filter · ↑↓ navigate · Enter select · Esc cancel${position}]`
  lines.push(pageRow(theme, '', width), pageRow(theme, theme.fg('dim', hint), width), pageRow(theme, '', width), pageBottom(theme, width))
  const cursorColumn = Math.min(Math.max(1, width - 3), 4 + visibleWidth(input.slice(0, inputCursor)))
  return {
    lines,
    cursor: { row: searchRow, column: cursorColumn },
  }
}

/** Render a bounded, scrollable Markdown plan with fixed review actions. */
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
  if (pageHeight < 10 || width < 24) {
    return renderPromptSelector(state, theme, width, input, inputCursor, Math.max(1, pageHeight - 8))
  }
  const feedback = state.feedback === true
  const footerRows = feedback ? 5 : 4
  const bodyRows = Math.max(1, pageHeight - 5 - footerRows)
  const markdownWidth = Math.max(1, width - 6)
  const document = renderMarkdown(state.request.detail ?? '', theme, markdownWidth)
  const maxStart = Math.max(0, document.length - bodyRows)
  const start = Math.max(0, Math.min(state.documentScroll ?? 0, maxStart))
  const visible = document.slice(start, start + bodyRows)
  while (visible.length < bodyRows) visible.push('')
  if (start > 0) visible[0] = theme.fg('dim', `… ↑ ${start} earlier plan lines`)
  if (start + bodyRows < document.length) {
    visible[Math.max(0, visible.length - 1)] = theme.fg('dim', `… ↓ ${document.length - start - bodyRows} later plan lines`)
  }

  const lines = [
    pageTop(theme, width, `${appName} · ${state.request.title}`),
    pageRow(theme, '', width),
    pageRow(theme, ' ' + theme.bold(state.request.question), width),
    pageRow(theme, '', width),
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
    lines.push(pageRow(theme, theme.fg('dim', '[Enter send feedback · empty Enter keeps planning · Esc back · Ctrl+C cancel]'), width))
    lines.push(pageBottom(theme, width))
    cursor = {
      row: inputRow,
      column: Math.min(Math.max(1, width - 3), 5 + visibleWidth(displayBeforeCursor)),
    }
  } else {
    const options = state.request.options ?? []
    const actions = options.map((option, index) => {
      const label = `[ ${option.label} ]`
      return index === state.selected
        ? theme.bold(theme.fg('accent', label))
        : theme.fg('muted', label)
    }).join(theme.fg('dim', '   '))
    lines.push(pageRow(theme, ' ' + actions, width))
    lines.push(pageRow(theme, theme.fg('dim', '[PgUp/PgDn scroll · Tab choose · Enter select · Esc cancel]'), width))
    lines.push(pageBottom(theme, width))
  }

  return {
    lines,
    cursor,
    document: { start, maxStart, pageSize: Math.max(1, bodyRows - 1) },
    cursorVisible: feedback,
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
  const options = state.request.options ?? []
  const contentWidth = Math.max(1, width - 4)
  const body = [state.request.question]
  if (state.request.detail !== undefined && state.request.detail !== '') body.push('', state.request.detail)
  if (options.length > 0) {
    const { start, end } = promptSelectorVisibleRange(options.length, state.selected, maxVisible)
    body.push('', ...options.slice(start, end).map((option, offset) =>
      optionRow(option, start + offset, state, theme, contentWidth)))
    if (options.length > maxVisible) {
      body.push(theme.fg('dim', `  ${state.selected + 1}/${options.length} · scroll for more`))
    }
  }
  const submit = state.request.submitLabel?.trim()
    || (options.length === 0 ? 'answer' : state.request.multiSelect === true ? 'confirm' : 'select')
  const navigation = options.length === 0
    ? `enter ${submit} · esc cancel`
    : state.request.multiSelect === true
      ? `↑↓ navigate · space toggle · enter ${submit} · esc cancel`
      : `↑↓ navigate · enter ${submit} · esc cancel`
  body.push('', theme.fg('dim', navigation))

  const card = renderFramedBlock({
    header: state.request.title,
    state: 'warning',
    lines: body,
    width,
    applyBg: false,
  }, theme)
  if (state.request.allowCustom === false) {
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
  return selected === state.selected ? state : { ...state, selected }
}

/** Toggle the active row for a multi-select prompt. */
export function togglePromptSelection(state: PromptSelectorState): PromptSelectorState {
  if (state.request.multiSelect !== true || state.request.options?.[state.selected] === undefined) return state
  const checked = new Set(state.checked)
  if (checked.has(state.selected)) checked.delete(state.selected)
  else checked.add(state.selected)
  return { ...state, checked }
}

/** Resolve the selected labels in stable option order. */
export function selectedPromptAnswer(state: PromptSelectorState): string | null {
  const options = state.request.options ?? []
  if (options.length === 0) return null
  if (state.request.multiSelect !== true) {
    const option = options[state.selected]
    return option?.value ?? option?.label ?? null
  }
  const labels = options.flatMap((option, index) => state.checked.has(index) ? [option.value ?? option.label] : [])
  return labels.length === 0 ? null : labels.join(', ')
}

/** Resolve the selected answer after applying a full-screen selector query. */
export function selectedFilteredPromptAnswer(state: PromptSelectorState, query: string): string | null {
  const option = filteredPromptOptions(state.request, query)[state.selected]
  return option?.value ?? option?.label ?? null
}
