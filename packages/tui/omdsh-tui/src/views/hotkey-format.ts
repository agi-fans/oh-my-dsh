/**
 * Shortcut row shapes and the one-line hint spelling shared by overlay views.
 *
 * This module deliberately has no imports of its own. Every overlay reads it to
 * build its bottom hint, and `views/hotkeys.ts` reads both it and the overlay
 * catalogs, so keeping the shared vocabulary here leaves that graph acyclic:
 * overlays never reach back into the help catalog that renders them.
 * @module @agi-fans/dsh-tui/hotkey-format
 */

/**
 * One shortcut row: the keys as printed, plus what they do. An overlay view
 * exports a catalog of these, so its bottom hint and the `/help` Overlays table
 * are two renderings of one list instead of two copies of the same keys.
 */
export interface HotkeyRow {
  keys: string
  action: string
}

/** One overlay key catalog plus the label `/help` prints for it. */
export interface OverlayCatalog {
  label: string
  rows: readonly HotkeyRow[]
}

/**
 * Capitalized key words the compact footer lowercases (`Enter` -> `enter`). Names
 * with an interior capital (`PgUp`) or a slash (`PgUp/PgDn`, `n/N`) keep their
 * spelling, because their lowercased form reads as a different key.
 */
const FOOTER_KEY_WORD = /^[A-Z][a-z]*(?:\+[A-Za-z]+)*$/u

function footerKeyToken(token: string): string {
  return FOOTER_KEY_WORD.test(token) ? token.toLowerCase() : token
}

/**
 * Footer spelling of one catalog row's keys, for hints that supply their own verb.
 * @param row - catalog row to spell.
 * @returns the keys as the compact one-line footer prints them.
 */
export function formatHotkeyKeys(row: HotkeyRow): string {
  return row.keys.split(' ').map(footerKeyToken).join(' ')
}

/**
 * One-line overlay hint built from catalog rows: `keys label · keys label`. The
 * label is the first word of the row action, so a row reads as a sentence in
 * `/help` and stays short in a footer or toolbar.
 * @param rows - catalog rows to print, in display order.
 * @param keyCase - `lowercase` follows the footer sentence style (`enter copy`);
 *   `catalog` keeps each key as `/help` prints it (`Enter transcript`).
 * @returns the hint text without any surrounding padding.
 */
export function formatOverlayHint(
  rows: readonly HotkeyRow[],
  keyCase: 'lowercase' | 'catalog' = 'lowercase',
): string {
  return rows.map((row) => {
    const keys = keyCase === 'catalog' ? row.keys : formatHotkeyKeys(row)
    return `${keys} ${row.action.split(' ')[0]?.toLowerCase() ?? ''}`.trimEnd()
  }).join(' · ')
}
