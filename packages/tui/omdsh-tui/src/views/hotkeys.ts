/**
 * Keyboard-shortcut catalog embedded in `/help`.
 * @module @agi-fans/dsh-tui
 */

import { DEFAULT_KEYBINDINGS, type TuiAction } from '../input/keybindings-config.ts'

/** Effective application bindings shown alongside built-in editor bindings. */
export type HotkeyBindings = Readonly<Record<string, TuiAction>>

interface HotkeyRow {
  keys: string
  action: string
}

interface HotkeySection {
  title: string
  rows: readonly HotkeyRow[]
}

function displayKey(key: string): string {
  return key.split('+').map((part) => {
    const normalized = part.toLowerCase()
    if (normalized === 'ctrl') return 'Ctrl'
    if (normalized === 'alt') return 'Alt'
    if (normalized === 'shift') return 'Shift'
    if (normalized === 'super') return 'Super'
    if (normalized === 'escape') return 'Esc'
    return part.length === 1 ? part.toUpperCase() : part[0]?.toUpperCase() + part.slice(1)
  }).join('+')
}

function keysForAction(bindings: HotkeyBindings, action: TuiAction): string {
  const keys = Object.entries(bindings)
    .filter(([, value]) => value === action)
    .map(([key]) => displayKey(key))
  return keys.length > 0 ? keys.join(' / ') : 'Disabled'
}

function sections(bindings: HotkeyBindings): readonly HotkeySection[] {
  return [
    {
      title: 'Navigation',
      rows: [
        { keys: 'Arrow keys', action: 'Move the cursor / browse history when the editor is empty' },
        { keys: 'Ctrl+A / Home', action: 'Move to the start of the line' },
        { keys: 'Ctrl+E / End', action: 'Move to the end of the line' },
        { keys: 'Alt+B / Alt+Left', action: 'Move one word left' },
        { keys: 'Alt+F / Alt+Right', action: 'Move one word right' },
        { keys: 'Ctrl+] then character', action: 'Jump forward to a character' },
        { keys: 'Ctrl+Alt+] then character', action: 'Jump backward to a character' },
      ],
    },
    {
      title: 'Editing',
      rows: [
        { keys: 'Enter', action: 'Send the message' },
        { keys: 'Shift+Enter / Alt+Enter / Ctrl+J', action: 'Insert a new line' },
        { keys: 'Ctrl+W / Alt+Backspace', action: 'Delete the previous word' },
        { keys: 'Alt+D', action: 'Delete the next word' },
        { keys: 'Ctrl+U', action: 'Delete to the start of the line' },
        { keys: 'Ctrl+K', action: 'Delete to the end of the line' },
        { keys: 'Ctrl+Y', action: 'Yank deleted text' },
        { keys: 'Alt+Y', action: 'Cycle the yank ring' },
        { keys: 'Ctrl+-', action: 'Undo the last edit' },
        { keys: 'Ctrl+D', action: 'Delete forward / quit when the editor is empty' },
        { keys: keysForAction(bindings, 'paste-clipboard'), action: 'Paste the clipboard verbatim' },
        { keys: keysForAction(bindings, 'copy-prompt'), action: 'Copy the current prompt' },
        { keys: keysForAction(bindings, 'copy-line'), action: 'Copy the current line' },
        { keys: keysForAction(bindings, 'external-editor'), action: 'Edit the prompt in $VISUAL or $EDITOR' },
      ],
    },
    {
      title: 'Transcript',
      rows: [
        { keys: 'PgUp / PgDn', action: 'Scroll one page' },
        { keys: 'Shift+Up / Shift+Down', action: 'Scroll quickly' },
        { keys: 'Ctrl+O', action: 'Expand tool output or catalog descriptions' },
        { keys: keysForAction(bindings, 'inspect-subagent'), action: 'Open a subagent transcript; continuable children can be steered' },
      ],
    },
    {
      title: 'Session',
      rows: [
        { keys: 'Esc twice', action: 'Rewind to an earlier conversation turn' },
        { keys: 'Ctrl+C twice', action: 'Interrupt or clear, then exit' },
        { keys: 'Ctrl+Z', action: 'Suspend to the background' },
        { keys: 'Alt+L', action: 'Reset the terminal display' },
        { keys: 'Ctrl+R', action: 'Search prompt history' },
        { keys: keysForAction(bindings, 'retry'), action: 'Retry the latest human prompt' },
        { keys: '/', action: 'Open slash-command completion' },
        { keys: '@ / ./ / ~/', action: 'Complete file paths' },
        { keys: 'Tab', action: 'Accept command or path completion' },
        { keys: '/copy', action: 'Open the copy picker' },
        { keys: '/help', action: 'Show commands and keyboard shortcuts' },
      ],
    },
  ]
}

function tableCell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim()
}

/** Number of shortcut rows in the catalog. */
export function hotkeyCount(bindings: HotkeyBindings = DEFAULT_KEYBINDINGS): number {
  return sections(bindings).reduce((total, section) => total + section.rows.length, 0)
}

/** Short, high-frequency subset shown by the default `/help` view. */
export function formatEssentialHotkeysText(bindings: HotkeyBindings = DEFAULT_KEYBINDINGS): string {
  const rows: readonly HotkeyRow[] = [
    { keys: 'Enter', action: 'Send the message' },
    { keys: 'Shift+Enter / Alt+Enter / Ctrl+J', action: 'Insert a new line' },
    { keys: 'Ctrl+C twice', action: 'Interrupt or clear, then exit' },
    { keys: 'Esc twice', action: 'Rewind to an earlier conversation turn' },
    { keys: 'Ctrl+R', action: 'Search prompt history' },
    { keys: 'PgUp / PgDn', action: 'Scroll the transcript' },
    { keys: 'Ctrl+O', action: 'Expand tool output or catalog descriptions' },
    { keys: keysForAction(bindings, 'paste-clipboard'), action: 'Paste clipboard text or an image' },
  ]
  return rows.map(row => `- \`${tableCell(row.keys)}\` — ${tableCell(row.action)}`).join('\n')
}

/** Markdown tables embedded in the `/help` transcript panel. */
export function formatHotkeysText(bindings: HotkeyBindings = DEFAULT_KEYBINDINGS): string {
  return sections(bindings).flatMap((section, index) => [
    ...(index === 0 ? [] : ['']),
    `**${section.title}**`,
    '| Shortcut | Action |',
    '|---|---|',
    ...section.rows.map(row => `| \`${tableCell(row.keys)}\` | ${tableCell(row.action)} |`),
  ]).join('\n')
}
