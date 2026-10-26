/**
 * One place that decides what a navigation key means.
 *
 * Eight overlays each carried their own `switch` over `up`, `down`, `tab`,
 * `home`, `end`, `pageUp`, `pageDown`, `enter`, and `escape`. They agreed about
 * the common keys and disagreed silently about the rest — `tab` moved a list in
 * five of them and switched a panel in another, `pageUp` paged a list in four and
 * scrolled a detail pane in one — and nothing in the code said which was
 * intended. A reader learns one overlay's keys and is surprised by the next.
 *
 * This module reads the key and reports the intent. A surface still decides what
 * the intent does, and a surface that means something else by a key handles it
 * first: the sharing removes the duplication, not the deliberate difference.
 *
 * Pure: no state, no terminal.
 * @module @agi-fans/dsh-tui
 */

import type { KeyEvent } from '../input/keys.ts'

/** What a navigation key asks for, independent of the surface that acts on it. */
export type ListNavigation =
  | { kind: 'move'; delta: -1 | 1 }
  | { kind: 'edge'; edge: 'first' | 'last' }
  | { kind: 'page'; direction: -1 | 1 }
  | { kind: 'confirm' }
  | { kind: 'close' }
  /** Not a navigation key; the surface decides whether it means anything. */
  | { kind: 'none' }

/**
 * Read one event as navigation.
 *
 * `tab` and `shift+tab` are movement because that is what they do in every list
 * that has no panels to switch — the tab-cycled panel is the exception, and it
 * handles `tab` before asking here. `escape` and `ctrl+c` both close: a reader
 * should not have to know which one this overlay prefers.
 */
export function listNavigation(event: KeyEvent): ListNavigation {
  if (event.type !== 'key') return { kind: 'none' }
  switch (event.id) {
    case 'up':
    case 'shift+tab':
      return { kind: 'move', delta: -1 }
    case 'down':
    case 'tab':
      return { kind: 'move', delta: 1 }
    case 'home':
      return { kind: 'edge', edge: 'first' }
    case 'end':
      return { kind: 'edge', edge: 'last' }
    case 'pageUp':
      return { kind: 'page', direction: -1 }
    case 'pageDown':
      return { kind: 'page', direction: 1 }
    case 'enter':
      return { kind: 'confirm' }
    case 'escape':
    case 'ctrl+c':
      return { kind: 'close' }
    default:
      return { kind: 'none' }
  }
}

/**
 * The next selection for one navigation intent, wrapping at both ends.
 *
 * Wrapping is the shared behaviour because that is what the plain lists do: a
 * filtered list that stops dead at its last row reads as a lost selection. A
 * surface that must clamp passes `{ wrap: false }` and keeps its own bounds.
 */
export function navigateIndex(navigation: Extract<ListNavigation, { kind: 'move' | 'page' }>, selected: number, count: number, pageSize: number, options: { wrap?: boolean } = {}): number {
  if (count <= 0) return selected
  const step = navigation.kind === 'move' ? navigation.delta : navigation.direction * Math.max(1, pageSize)
  const next = selected + step
  if (options.wrap === false) return Math.max(0, Math.min(next, count - 1))
  return (next % count + count) % count
}

/** The first or last index for an edge intent. */
export function edgeIndex(navigation: Extract<ListNavigation, { kind: 'edge' }>, count: number): number {
  return navigation.edge === 'first' ? 0 : Math.max(0, count - 1)
}
