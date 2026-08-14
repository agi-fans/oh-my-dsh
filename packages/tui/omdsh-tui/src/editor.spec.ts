import { describe, expect, it } from 'vitest'
import { InputEditor, lineEnd, lineStart, moveWordLeft, moveWordRight } from './editor.ts'
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
