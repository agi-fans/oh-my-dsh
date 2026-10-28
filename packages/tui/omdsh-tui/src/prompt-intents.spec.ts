import { describe, expect, it, vi } from 'vitest'
import { askPrompt, choosePrompt, confirmPrompt, readPrompt } from './prompt-intents.ts'

describe('prompt intents', () => {
  /**
   * The intents exist to stop callers from assembling `TuiPrompt` by hand. Each
   * one therefore has to produce exactly the shape the hand-written call sites
   * produced, or a migration would change behaviour instead of naming it.
   */
  it('ask states the free-text shape without an options array', () => {
    const request = askPrompt({ title: 'Branch', question: 'New branch name' })
    expect(request).toEqual({
      title: 'Branch',
      question: 'New branch name',
      allowCustom: true,
      notify: false,
    })
    // No `options` and no `presentation`: those are what an input does not have,
    // and asking a caller to omit them was the interface leaking its history.
    expect(request.options).toBeUndefined()
    expect(request.presentation).toBeUndefined()
  })

  it('ask carries the input-specific fields and drops the rest', () => {
    const request = askPrompt({
      title: 'Token',
      question: 'Paste the key',
      detail: 'Stored locally',
      initialInput: 'sk-',
      secret: true,
      preserveWhitespace: true,
      onCancelDraft: () => {},
      notify: true,
    })
    expect(request).toMatchObject({
      detail: 'Stored locally',
      initialInput: 'sk-',
      secret: true,
      preserveWhitespace: true,
      notify: true,
    })
    expect(request.options).toBeUndefined()
  })

  it('choose states the list shape and refuses free text', () => {
    const request = choosePrompt({
      title: 'Provider',
      question: 'Choose one',
      options: [{ label: 'DeepSeek', value: 'deepseek' }],
      initialValue: 'deepseek',
    })
    expect(request).toMatchObject({
      options: [{ label: 'DeepSeek', value: 'deepseek' }],
      initialValue: 'deepseek',
      // A list that also accepts typed text is a different intent; the flag is
      // not something a caller should have to remember to set.
      allowCustom: false,
      notify: false,
    })
  })

  it('choose maps the two layout words onto the presentation fields', () => {
    const fullscreen = choosePrompt({ title: 't', question: 'q', options: [], fullscreen: true, filterable: true })
    expect(fullscreen).toMatchObject({ presentation: 'fullscreen-list', optionLayout: 'compact', filterable: true })
    const spacious = choosePrompt({ title: 't', question: 'q', options: [], spacious: true })
    expect(spacious).toMatchObject({ optionLayout: 'spacious' })
    // A spacious inline list must not claim a full-screen page.
    expect(spacious.presentation).toBeUndefined()
  })

  it('confirm returns a boolean, so dismissal is not consent', async () => {
    const prompt = vi.fn().mockResolvedValueOnce('accept')
    await expect(confirmPrompt(prompt, { title: 'Delete', question: 'Remove it?' })).resolves.toBe(true)
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      options: [{ label: 'Continue', value: 'accept' }, { label: 'Cancel', value: 'cancel' }],
      // The safe answer is preselected.
      initialValue: 'cancel',
      allowCustom: false,
    }))

    const declining = vi.fn().mockResolvedValueOnce('cancel')
    await expect(confirmPrompt(declining, { title: 't', question: 'q', acceptLabel: 'Delete' })).resolves.toBe(false)

    // Escape is a no, not a third state the caller has to handle.
    const dismissed = vi.fn().mockResolvedValueOnce(null)
    await expect(confirmPrompt(dismissed, { title: 't', question: 'q' })).resolves.toBe(false)
  })

  it('read opens a document with a source the reader can search', () => {
    const request = readPrompt({ title: 'Diff', question: 'src/a.ts', text: 'one\ntwo' })
    expect(request).toMatchObject({
      presentation: 'document',
      allowCustom: false,
      notify: false,
      documentSource: { text: 'one\ntwo' },
      options: [{ label: 'Cancel', value: 'cancel' }],
    })
  })

  it('read prefers an explicit source over the plain text', () => {
    const source = { text: 'from source', language: 'ts', firstLine: 10 }
    const request = readPrompt({ title: 't', question: 'q', text: 'ignored', source, tail: true, position: { line: 3, column: 0 } })
    expect(request.documentSource).toBe(source)
    expect(request.documentTail).toBe(true)
    expect(request.documentPosition).toEqual({ line: 3, column: 0 })
  })

  it('read forwards the lifecycle hooks a streaming surface needs', () => {
    const interrupt = () => true
    const onSuperseded = () => {}
    const refresh = () => 'live'
    const request = readPrompt({
      title: 'Answer', question: 'q', text: 'x', interrupt, onSuperseded, refresh,
    })
    expect(request.interrupt).toBe(interrupt)
    expect(request.onSuperseded).toBe(onSuperseded)
    expect(request.refreshDocument).toBe(refresh)
  })
})
