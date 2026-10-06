import { describe, expect, it } from 'vitest'
import { InputEditor, lineEnd, lineStart, moveGraphemeLeft, moveGraphemeRight, moveWordLeft, moveWordRight } from './editor.ts'
import type { KeyEvent } from './keys.ts'

const key = (id: string): KeyEvent => ({ type: 'key', id })
const text = (value: string): KeyEvent => ({ type: 'text', value })

describe('word and line geometry', () => {
  it('moves across whitespace-delimited words', () => {
    expect(moveWordLeft('hello world', 11)).toBe(6)
    expect(moveWordLeft('hello world', 6)).toBe(0)
    expect(moveWordRight('hello world', 0)).toBe(6)
    expect(moveWordRight('hello world', 6)).toBe(11)
  })

  it('finds the current line span', () => {
    expect(lineStart('ab\ncd', 4)).toBe(3)
    expect(lineEnd('ab\ncd', 0)).toBe(2)
  })

  it('moves and deletes by grapheme, never splitting a surrogate pair', () => {
    const whale = '🐳'
    expect(moveGraphemeLeft('a' + whale, 3)).toBe(1)
    expect(moveGraphemeRight('a' + whale, 1)).toBe(3)
    const editor = new InputEditor()
    editor.handle(text('a' + whale))
    // Backspace at the tail removes the whole whale, not half a surrogate.
    expect(editor.handle(key('backspace'))).toEqual({ kind: 'changed', edited: true })
    expect(editor.text).toBe('a')
    editor.handle(text(whale))
    expect(editor.text).toBe('a' + whale)
  })
})

describe('InputEditor', () => {
  it('applies emacs line motion and word motion', () => {
    const editor = new InputEditor()
    editor.handle(text('hello world'))
    expect(editor.handle(key('ctrl+a'))).toEqual({ kind: 'changed' })
    expect(editor.cursor).toBe(0)
    editor.handle(key('ctrl+e'))
    expect(editor.cursor).toBe(11)
    editor.handle(key('alt+b'))
    expect(editor.cursor).toBe(6)
    editor.handle(key('alt+f'))
    expect(editor.cursor).toBe(11)
    editor.handle(key('ctrl+b'))
    expect(editor.cursor).toBe(10)
    editor.handle(key('ctrl+f'))
    expect(editor.cursor).toBe(11)
    editor.setCursor(3)
    expect(editor.text).toBe('hello world')
    expect(editor.cursor).toBe(3)
    editor.setCursor(0)
    editor.handle(key('ctrl+]'))
    editor.handle(text('o'))
    expect(editor.cursor).toBe(4)
    editor.handle(key('ctrl+e'))
    editor.handle(key('ctrl+alt+]'))
    editor.handle(text('l'))
    expect(editor.cursor).toBe(9)
  })

  it('kills words and lines, then yanks them back', () => {
    const editor = new InputEditor()
    editor.handle(text('hello world'))
    editor.handle(key('ctrl+w'))
    expect(editor.text).toBe('hello ')
    editor.handle(key('ctrl+y'))
    expect(editor.text).toBe('hello world')
    editor.handle(key('ctrl+a'))
    editor.handle(key('ctrl+k'))
    expect(editor.text).toBe('')
    editor.handle(key('ctrl+y'))
    expect(editor.text).toBe('hello world')
  })

  it('deletes to line start with ctrl+u', () => {
    const editor = new InputEditor()
    editor.handle(text('hello world'))
    editor.handle(key('alt+b'))
    editor.handle(key('ctrl+u'))
    expect(editor.text).toBe('world')
    expect(editor.cursor).toBe(0)
  })

  it('inserts a newline on shift+enter / alt+enter / ctrl+j and submits on enter', () => {
    const editor = new InputEditor()
    editor.handle(text('one'))
    expect(editor.handle(key('shift+enter'))).toEqual({ kind: 'changed', edited: true })
    editor.handle(text('two'))
    expect(editor.text).toBe('one\ntwo')
    expect(editor.handle(key('enter'))).toEqual({ kind: 'submit', text: 'one\ntwo' })
    editor.handle(key('alt+enter'))
    expect(editor.text).toContain('\n')
    const fresh = new InputEditor()
    fresh.handle(text('x'))
    expect(fresh.handle(key('ctrl+j'))).toEqual({ kind: 'changed', edited: true })
    expect(fresh.text).toBe('x\n')
  })

  it('moves between lines before falling through to history', () => {
    const editor = new InputEditor()
    editor.handle(text('one'))
    editor.handle(key('ctrl+j'))
    editor.handle(text('two'))
    expect(editor.handle(key('up'))).toEqual({ kind: 'changed' })
    expect(editor.cursor).toBe(3)
    expect(editor.text[editor.cursor]).toBe('\n')
    expect(editor.handle(key('up'))).toEqual({ kind: 'historyPrev' })
    editor.handle(key('down'))
    expect(editor.handle(key('down'))).toEqual({ kind: 'historyNext' })
  })

  it('treats empty ctrl+d as quit and non-empty as delete-forward', () => {
    const editor = new InputEditor()
    expect(editor.handle(key('ctrl+d'))).toEqual({ kind: 'quit' })
    editor.handle(text('ab'))
    editor.handle(key('ctrl+a'))
    editor.handle(key('ctrl+d'))
    expect(editor.text).toBe('b')
  })

  it('undoes the last edit', () => {
    const editor = new InputEditor()
    editor.handle(text('hello'))
    editor.handle(key('ctrl+w'))
    editor.handle(key('ctrl+-'))
    expect(editor.text).toBe('hello')
  })

  it('emits app-level commands for escape, ctrl+z, and alt+l', () => {
    const editor = new InputEditor()
    expect(editor.handle(key('escape'))).toEqual({ kind: 'interrupt' })
    expect(editor.handle(key('ctrl+z'))).toEqual({ kind: 'suspend' })
    expect(editor.handle(key('alt+l'))).toEqual({ kind: 'resetDisplay' })
  })
})

const longPaste = Array.from({ length: 12 }, (_, i) => `行 ${i} 🐳`).join('\n')
describe('pasted blocks', () => {
  it('compacts multiline and long single-line pastes, submits original text', () => {
    const editor = new InputEditor()
    editor.handle(text('Explain: '))
    editor.paste(longPaste)
    editor.handle(text(' please'))
    expect(editor.text).toBe('Explain: [Pasted #1: 12 lines] please')
    expect(editor.handle(key('enter'))).toEqual({ kind: 'submit', text: 'Explain: ' + longPaste + ' please' })
    editor.paste('🐳'.repeat(1001))
    expect(editor.text).toContain('1001 chars')
  })

  it('keeps short pastes literal, including forged marker labels', () => {
    const editor = new InputEditor()
    editor.handle(text('[Pasted #1: 12 lines] '))
    editor.paste(longPaste)
    expect(editor.expandedText).toBe('[Pasted #1: 12 lines] ' + longPaste)
    editor.setText('[Pasted #1: 12 lines]')
    expect(editor.expandedText).toBe('[Pasted #1: 12 lines]')
  })

  it('moves over and deletes a block as one atom, with undo and yank retaining its content', () => {
    const editor = new InputEditor()
    editor.paste(longPaste)
    const end = editor.cursor
    editor.handle(key('left'))
    expect(editor.cursor).toBe(0)
    editor.handle(key('right'))
    expect(editor.cursor).toBe(end)
    editor.handle(key('backspace'))
    expect(editor.text).toBe('')
    editor.handle(key('ctrl+-'))
    expect(editor.expandedText).toBe(longPaste)
    editor.handle(key('ctrl+a'))
    editor.handle(key('delete'))
    expect(editor.text).toBe('')
    editor.handle(key('ctrl+y'))
    expect(editor.text).toBe(longPaste)
  })

  it('undoes paste insertion and expansion without losing either payload', () => {
    const editor = new InputEditor()
    editor.paste(longPaste)
    editor.handle(text(' '))
    editor.paste('x'.repeat(1001))
    expect(editor.expandPaste()).toBe(true)
    expect(editor.text).toContain('x'.repeat(1001))
    editor.handle(key('ctrl+-'))
    expect(editor.text).toContain('[Pasted #2: 1001 chars]')
    editor.handle(key('ctrl+-'))
    expect(editor.expandedText).toBe(longPaste + ' ')
    editor.handle(key('ctrl+-'))
    editor.handle(key('ctrl+-'))
    expect(editor.text).toBe('')
  })

  it('does not expand literal marker text embedded in an expanded block', () => {
    const editor = new InputEditor()
    editor.paste(longPaste)
    const source = 'source [Pasted #1: 12 lines]\n'.repeat(12)
    editor.paste(source)
    editor.expandPaste()
    expect(editor.expandedText).toBe(longPaste + source)
  })

  it('retains atoms and caret through temporary input and disjoint attachment edits', () => {
    const editor = new InputEditor()
    editor.handle(text('[Image #2] '))
    editor.paste(longPaste)
    editor.handle(text(' [Image #3]'))
    const snapshot = editor.snapshot()
    editor.setText('answer')
    editor.restore(snapshot)
    editor.replaceText(editor.text.replace('#2]', '#1]').replace('#3]', '#2]'))
    expect(editor.expandedText).toBe('[Image #1] ' + longPaste + ' [Image #2]')
  })

  it('supports inserting before a block, line and word deletion, and clearing with undo', () => {
    for (const deleteKey of ['ctrl+w', 'alt+d', 'ctrl+k', 'ctrl+u']) {
      const editor = new InputEditor()
      editor.paste(longPaste)
      if (['alt+d', 'ctrl+k'].includes(deleteKey)) editor.setCursor(0)
      editor.handle(key(deleteKey))
      expect(editor.text).toBe('')
      editor.handle(key('ctrl+-'))
      editor.setCursor(0)
      editor.handle(text('prefix '))
      expect(editor.expandedText).toBe('prefix ' + longPaste)
      editor.clear()
      editor.handle(key('ctrl+-'))
      expect(editor.expandedText).toBe('prefix ' + longPaste)
    }
  })
})
