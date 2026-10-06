/**
 * Input-editor state machine: OMP readline/emacs bindings over a single
 * buffer that may contain newlines. Pure — the provider owns history,
 * interrupt, and process lifetime.
 * @module @agi-fans/dsh-tui
 */

import { diffChars } from 'diff'
import type { KeyEvent } from './keys.ts'
import { moveGraphemeLeft, moveGraphemeRight, snapToGraphemeBoundary } from '../chrome/grapheme.ts'

// Re-exported for existing importers; the implementation moved to
// chrome/grapheme.ts so view-layer query editors share the same geometry.
export { moveGraphemeLeft, moveGraphemeRight, snapToGraphemeBoundary }

const MAX_UNDO = 80
const MAX_KILLS = 60

/** What the provider should do after a key is applied. */
export type EditorCommand =
  | { kind: 'changed'; edited?: boolean }
  | { kind: 'submit'; text: string }
  | { kind: 'historyPrev' }
  | { kind: 'historyNext' }
  | { kind: 'interrupt' }
  | { kind: 'clear' }
  | { kind: 'quit' }
  | { kind: 'suspend' }
  | { kind: 'resetDisplay' }
  | { kind: 'ignored' }

interface PasteAtom { start: number; end: number; content: string }

interface Snapshot {
  text: string
  cursor: number
  pastes: PasteAtom[]
}

export type EditorSnapshot = Snapshot

/** Emacs-style kill ring (consecutive kills accumulate). */
export class KillRing {
  #entries: string[] = []

  push(text: string, opts: { prepend: boolean; accumulate: boolean }): void {
    if (text === '') return
    if (opts.accumulate && this.#entries.length > 0) {
      const last = this.#entries.pop() ?? ''
      this.#entries.push(opts.prepend ? text + last : last + text)
    } else {
      this.#entries.push(text)
      if (this.#entries.length > MAX_KILLS) this.#entries.shift()
    }
  }

  peek(): string | undefined {
    return this.#entries[this.#entries.length - 1]
  }

  rotate(): void {
    if (this.#entries.length > 1) {
      const last = this.#entries.pop()
      if (last !== undefined) this.#entries.unshift(last)
    }
  }

  get length(): number {
    return this.#entries.length
  }
}

/** Start index of the line containing `cursor`. */
export function lineStart(text: string, cursor: number): number {
  const at = text.lastIndexOf('\n', cursor - 1)
  return at < 0 ? 0 : at + 1
}

/** End index (before newline, or length) of the line containing `cursor`. */
export function lineEnd(text: string, cursor: number): number {
  const at = text.indexOf('\n', cursor)
  return at < 0 ? text.length : at
}







/** Word-left: skip trailing whitespace, then the previous word. */
export function moveWordLeft(text: string, cursor: number): number {
  let i = cursor
  while (i > 0 && /\s/.test(text[i - 1] ?? '')) i -= 1
  while (i > 0 && !/\s/.test(text[i - 1] ?? '')) i -= 1
  return i
}

/** Word-right: skip the current word, then following whitespace. */
export function moveWordRight(text: string, cursor: number): number {
  let i = cursor
  while (i < text.length && !/\s/.test(text[i] ?? '')) i += 1
  while (i < text.length && /\s/.test(text[i] ?? '')) i += 1
  return i
}

function moveLine(text: string, cursor: number, dir: -1 | 1): number | undefined {
  const start = lineStart(text, cursor)
  const col = cursor - start
  if (dir < 0) {
    if (start === 0) return undefined
    const prevEnd = start - 1
    const prevStart = lineStart(text, prevEnd)
    return prevStart + Math.min(col, prevEnd - prevStart)
  }
  const end = lineEnd(text, cursor)
  if (end >= text.length) return undefined
  const nextStart = end + 1
  const nextEnd = lineEnd(text, nextStart)
  return nextStart + Math.min(col, nextEnd - nextStart)
}

/**
 * Multiline input buffer with OMP editor bindings.
 */
export class InputEditor {
  #pastes: PasteAtom[] = []
  #pasteId = 0
  #text = ''
  #revision = 0
  #cursor = 0
  #undo: Snapshot[] = []
  #last: 'none' | 'kill' | 'yank' | 'insert' = 'none'
  readonly #kills = new KillRing()
  #yankLen = 0
  #jump: 'forward' | 'backward' | null = null

  get text(): string {
    return this.#text
  }

  get revision(): number { return this.#revision }

  /** Original pasted content, for submission, clipboard, and external editing. */
  get startsWithPaste(): boolean {
    return this.#pastes.some(atom => atom.start === this.#text.length - this.#text.trimStart().length)
  }

  get expandedText(): string {
    return this.textRange(0, this.#text.length)
  }

  /** Expand owned paste atoms in a visible-text range; literal lookalikes stay literal. */
  textRange(start: number, end: number): string {
    let result = ''
    let cursor = start
    for (const atom of this.#pastes) {
      if (atom.start < start || atom.end > end) continue
      result += this.#text.slice(cursor, atom.start) + atom.content
      cursor = atom.end
    }
    return result + this.#text.slice(cursor, end)
  }

  #replaceRange(start: number, end: number, text: string): void {
    this.#revision++
    const delta = text.length - (end - start)
    this.#pastes = this.#pastes.flatMap(atom => {
      if (atom.end <= start) return [atom]
      if (atom.start >= end) return [{ ...atom, start: atom.start + delta, end: atom.end + delta }]
      return []
    })
    this.#text = this.#text.slice(0, start) + text + this.#text.slice(end)
  }

  /** Admit one paste as a single undoable edit, compacting large payloads. */
  paste(text: string): void {
    const lines = text.split('\n').length
    const chars = [...text].length
    if (lines <= 10 && chars <= 1000) { this.#insert(text); return }
    this.#pushUndo()
    const marker = `[Pasted #${++this.#pasteId}: ${lines > 10 ? `${lines} lines` : `${chars} chars`}]`
    const start = this.#cursor
    this.#replaceRange(start, start, marker)
    this.#pastes.push({ start, end: start + marker.length, content: text })
    this.#pastes.sort((a, b) => a.start - b.start)
    this.#cursor += marker.length
    this.#last = 'none'
  }

  /** Expand the paste at the caret, or the nearest preceding paste, for editing. */
  expandPaste(): boolean {
    const ranges = this.#pastes
    const range = ranges.find(item => item.start <= this.#cursor && item.end >= this.#cursor)
      ?? ranges.findLast(item => item.end <= this.#cursor) ?? ranges[0]
    if (range === undefined) return false
    this.#pushUndo()
    const text = range.content
    this.#replaceRange(range.start, range.end, text)
    this.#cursor = range.start + text.length
    this.#last = 'none'
    return true
  }

  get cursor(): number {
    return this.#cursor
  }

  snapshot(): Snapshot {
    return { text: this.#text, cursor: this.#cursor, pastes: this.#pastes.map(atom => ({ ...atom })) }
  }

  restore(snapshot: Snapshot): void {
    this.setText(snapshot.text, snapshot.cursor)
    this.#pastes = snapshot.pastes.map(atom => ({ ...atom }))
    for (const atom of this.#pastes) this.#pasteId = Math.max(this.#pasteId,
      Number(/\[Pasted #(\d+):/u.exec(snapshot.text.slice(atom.start, atom.end))?.[1] ?? 0))
  }

  /** Replace visible text during completion or attachment edits, retaining live pastes. */
  replaceText(text: string, cursor = text.length): void {
    if (this.#pastes.length === 0) { this.setText(text, cursor); return }
    const pastes: PasteAtom[] = []
    let oldAt = 0
    let newAt = 0
    // Completion and image renumbering can alter several disjoint spans.
    for (const change of diffChars(this.#text, text)) {
      if (!change.added && !change.removed) {
        for (const atom of this.#pastes) {
          if (atom.start >= oldAt && atom.end <= oldAt + change.value.length) {
            pastes.push({ ...atom, start: newAt + atom.start - oldAt, end: newAt + atom.end - oldAt })
          }
        }
      }
      if (!change.added) oldAt += change.value.length
      if (!change.removed) newAt += change.value.length
    }
    this.setText(text, cursor)
    this.#pastes = pastes
    this.#cursor = this.#snapCursor(this.#cursor)
  }

  /** Replace the buffer (history recall). Clears undo and paste ownership. */
  setText(text: string, cursor = text.length): void {
    this.#revision++
    this.#pastes = []
    this.#text = text
    this.#cursor = this.#snapCursor(Math.max(0, Math.min(cursor, text.length)))
    this.#undo = []
    this.#last = 'none'
    this.#yankLen = 0
    this.#jump = null
  }

  /** Move the caret without changing text or undo. */
  setCursor(cursor: number): void {
    this.#cursor = this.#snapCursor(Math.max(0, Math.min(cursor, this.#text.length)))
    this.#last = 'none'
  }

  /** Empty the buffer, keeping undo of the previous contents. */
  clear(): void {
    if (this.#text === '') return
    this.#revision++
    this.#pushUndo()
    this.#text = ''
    this.#pastes = []
    this.#cursor = 0
    this.#last = 'none'
  }

  /** Apply one decoded event. */
  handle(event: KeyEvent): EditorCommand {
    if (this.#jump !== null) {
      if (event.type === 'key' && (event.id === 'ctrl+]' || event.id === 'ctrl+alt+]')) {
        this.#jump = null
        return { kind: 'changed' }
      }
      if (event.type === 'text' && event.value !== '') {
        const dir = this.#jump
        this.#jump = null
        this.#jumpToChar(event.value[0] ?? '', dir)
        return { kind: 'changed' }
      }
      this.#jump = null
    }
    if (event.type === 'text') {
      this.#insert(event.value)
      return { kind: 'changed', edited: true }
    }
    if (event.type !== 'key') return { kind: 'ignored' }
    return this.#handleKey(event.id)
  }

  #handleKey(id: string): EditorCommand {
    switch (id) {
      case 'enter':
        return { kind: 'submit', text: this.expandedText }
      case 'ctrl+j':
      case 'shift+enter':
      case 'alt+enter':
      case 'ctrl+enter':
        this.#insert('\n')
        return { kind: 'changed', edited: true }
      case 'ctrl+c':
        return { kind: 'clear' }
      case 'escape':
        return { kind: 'interrupt' }
      case 'ctrl+d':
        if (this.#text === '') return { kind: 'quit' }
        this.#deleteForward()
        return { kind: 'changed', edited: true }
      case 'ctrl+z':
        return { kind: 'suspend' }
      case 'alt+l':
        return { kind: 'resetDisplay' }
      case 'up':
        return this.#vertical(-1)
      case 'down':
        return this.#vertical(1)
      case 'left':
      case 'ctrl+b':
        return this.#moveTo(moveGraphemeLeft(this.#text, this.#cursor))
      case 'right':
      case 'ctrl+f':
        return this.#moveTo(moveGraphemeRight(this.#text, this.#cursor))
      case 'home':
      case 'ctrl+a':
        return this.#moveTo(lineStart(this.#text, this.#cursor))
      case 'end':
      case 'ctrl+e':
        return this.#moveTo(lineEnd(this.#text, this.#cursor))
      case 'alt+left':
      case 'ctrl+left':
      case 'alt+b':
        return this.#moveTo(moveWordLeft(this.#text, this.#cursor))
      case 'alt+right':
      case 'ctrl+right':
      case 'alt+f':
        return this.#moveTo(moveWordRight(this.#text, this.#cursor))
      case 'backspace':
        this.#deleteBackward()
        return { kind: 'changed', edited: true }
      case 'delete':
        this.#deleteForward()
        return { kind: 'changed', edited: true }
      case 'ctrl+w':
      case 'alt+backspace':
      case 'ctrl+backspace':
        this.#deleteWordBackward()
        return { kind: 'changed', edited: true }
      case 'alt+d':
      case 'alt+delete':
        this.#deleteWordForward()
        return { kind: 'changed', edited: true }
      case 'ctrl+u':
        this.#deleteToLineStart()
        return { kind: 'changed', edited: true }
      case 'ctrl+k':
        this.#deleteToLineEnd()
        return { kind: 'changed', edited: true }
      case 'ctrl+y':
        this.#yank()
        return { kind: 'changed', edited: true }
      case 'alt+y':
        this.#yankPop()
        return { kind: 'changed', edited: true }
      case 'ctrl+-':
      case 'ctrl+_':
        this.#applyUndo()
        return { kind: 'changed', edited: true }
      case 'ctrl+]':
        this.#jump = 'forward'
        return { kind: 'changed' }
      case 'ctrl+alt+]':
        this.#jump = 'backward'
        return { kind: 'changed' }
      default:
        return { kind: 'ignored' }
    }
  }

  #vertical(dir: -1 | 1): EditorCommand {
    const next = moveLine(this.#text, this.#cursor, dir)
    if (next === undefined) return dir < 0 ? { kind: 'historyPrev' } : { kind: 'historyNext' }
    return this.#moveTo(next)
  }

  #moveTo(cursor: number): EditorCommand {
    const next = this.#snapCursor(Math.max(0, Math.min(this.#text.length, cursor)), cursor < this.#cursor)
    if (next === this.#cursor) return { kind: 'changed' }
    this.#cursor = next
    this.#last = 'none'
    return { kind: 'changed' }
  }

  /** Snap a UTF-16 offset to the grapheme boundary it belongs to (forward). */
  #snapCursor(cursor: number, backward = false): number {
    const range = this.#pastes.find(item => item.start < cursor && item.end > cursor)
    if (range !== undefined) return backward ? range.start : range.end
    return snapToGraphemeBoundary(this.#text, cursor)
  }

  #pushUndo(): void {
    this.#undo.push({ text: this.#text, cursor: this.#cursor, pastes: this.#pastes.map(atom => ({ ...atom })) })
    if (this.#undo.length > MAX_UNDO) this.#undo.shift()
  }

  #insert(value: string): void {
    if (value === '') return
    const coalesce = this.#last === 'insert' && value.length === 1 && value !== '\n'
    if (!coalesce) this.#pushUndo()
    this.#replaceRange(this.#cursor, this.#cursor, value)
    this.#cursor += value.length
    this.#last = 'insert'
    this.#yankLen = 0
  }

  #deleteRange(start: number, end: number, direction: 'forward' | 'backward'): void {
    start = this.#snapCursor(start, true)
    end = this.#snapCursor(end)
    if (start >= end) return
    this.#pushUndo()
    const killed = this.textRange(start, end)
    this.#replaceRange(start, end, '')
    this.#cursor = start
    this.#kills.push(killed, { prepend: direction === 'backward', accumulate: this.#last === 'kill' })
    this.#last = 'kill'
    this.#yankLen = 0
  }

  #deleteBackward(): void {
    const start = moveGraphemeLeft(this.#text, this.#cursor)
    if (start === this.#cursor) return
    this.#deleteRange(start, this.#cursor, 'backward')
  }

  #deleteForward(): void {
    const end = moveGraphemeRight(this.#text, this.#cursor)
    if (end === this.#cursor) return
    this.#deleteRange(this.#cursor, end, 'forward')
  }

  #deleteWordBackward(): void {
    if (this.#cursor === 0) return
    this.#deleteRange(moveWordLeft(this.#text, this.#cursor), this.#cursor, 'backward')
  }

  #deleteWordForward(): void {
    if (this.#cursor >= this.#text.length) return
    this.#deleteRange(this.#cursor, moveWordRight(this.#text, this.#cursor), 'forward')
  }

  #deleteToLineStart(): void {
    const start = lineStart(this.#text, this.#cursor)
    if (this.#cursor > start) {
      this.#deleteRange(start, this.#cursor, 'backward')
      return
    }
    if (start > 0) this.#deleteRange(start - 1, start, 'backward')
  }

  #deleteToLineEnd(): void {
    const end = lineEnd(this.#text, this.#cursor)
    if (this.#cursor < end) {
      this.#deleteRange(this.#cursor, end, 'forward')
      return
    }
    if (end < this.#text.length) this.#deleteRange(end, end + 1, 'forward')
  }

  #yank(): void {
    const text = this.#kills.peek()
    if (text === undefined) return
    this.#insert(text)
    this.#last = 'yank'
    this.#yankLen = text.length
  }

  #yankPop(): void {
    if (this.#last !== 'yank' || this.#kills.length <= 1 || this.#yankLen === 0) return
    const start = this.#cursor - this.#yankLen
    if (start < 0) return
    this.#replaceRange(start, this.#cursor, '')
    this.#cursor = start
    this.#kills.rotate()
    const next = this.#kills.peek()
    if (next === undefined) return
    this.#replaceRange(this.#cursor, this.#cursor, next)
    this.#cursor += next.length
    this.#yankLen = next.length
    this.#last = 'yank'
  }

  #jumpToChar(char: string, dir: 'forward' | 'backward'): void {
    if (char === '') return
    this.#last = 'none'
    if (dir === 'forward') {
      const at = this.#text.indexOf(char, this.#cursor + 1)
      if (at >= 0) this.#cursor = this.#snapCursor(at)
      return
    }
    if (this.#cursor === 0) return
    const at = this.#text.lastIndexOf(char, this.#cursor - 1)
    if (at >= 0) this.#cursor = this.#snapCursor(at, dir === 'backward')
  }

  #applyUndo(): void {
    const snap = this.#undo.pop()
    if (snap === undefined) return
    this.#pastes = snap.pastes.map(atom => ({ ...atom }))
    this.#revision++
    this.#text = snap.text
    this.#cursor = snap.cursor
    this.#last = 'none'
    this.#yankLen = 0
  }
}
