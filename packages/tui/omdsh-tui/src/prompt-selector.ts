/** Interactive terminal selector used by resume, approval, and user questions. */

import type { TuiPrompt } from './definition.ts'
import { renderEditor, renderFramedBlock } from './box.ts'
import { SYMBOL, type Theme } from './theme.ts'
import { truncateToWidth } from './width.ts'

/** Presentation state owned by the terminal while a human prompt is active. */
export interface PromptSelectorState {
  request: TuiPrompt
  selected: number
  checked: ReadonlySet<number>
}

export interface PromptSelectorFrame {
  lines: string[]
  cursor: { row: number; column: number }
  editor?: { start: number; rows: number }
}

/** Maximum option rows retained in the prompt overlay before it windows. */
export const PROMPT_SELECTOR_MAX_VISIBLE = 10

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
  option: NonNullable<TuiPrompt['options']>[number],
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
  const submit = state.request.submitLabel?.trim() || (state.request.multiSelect === true ? 'confirm' : 'select')
  const navigation = options.length === 0
    ? 'enter answer · esc cancel'
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
    }
  }
  const editor = renderEditor({
    width,
    input,
    inputCursor,
    status: theme.fg('muted', input === '' ? 'answer' : 'custom answer'),
    border: 'accent',
  }, theme)
  const editorStart = card.length + 1
  return {
    lines: [...card, '', ...editor.lines],
    cursor: { row: editorStart + editor.cursor.row, column: editor.cursor.column },
    editor: { start: editorStart, rows: editor.lines.length },
  }
}

/** Keep a selected option index within the available prompt options. */
export function movePromptSelection(state: PromptSelectorState, next: number): PromptSelectorState {
  const count = state.request.options?.length ?? 0
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
  if (state.request.multiSelect !== true) return options[state.selected]?.label ?? null
  const labels = options.flatMap((option, index) => state.checked.has(index) ? [option.label] : [])
  return labels.length === 0 ? null : labels.join(', ')
}
