import { describe, expect, it } from 'vitest'
import type { TuiInputImage } from '../definition.ts'
import { InputEditor } from '../input/editor.ts'
import { imageMarker } from '../input/image-paste.ts'
import { ComposerImages } from './composer-images.ts'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function image(name: string, width = 3, height = 2): TuiInputImage {
  return { data: PNG_1X1, mediaType: 'image/png', name, width, height }
}

function make() {
  const editor = new InputEditor()
  const notices: string[] = []
  const images = new ComposerImages({ editor, notice: text => { notices.push(text) } })
  return { editor, images, notices }
}

describe('ComposerImages.insert', () => {
  it('writes a numbered marker at the cursor and tracks the draft', () => {
    const { editor, images } = make()
    editor.setText('describe ')
    images.insert(image('a.png'))
    expect(images.count).toBe(1)
    expect(editor.text).toBe(`describe ${imageMarker(0, image('a.png'))} `)
  })

  it('probes missing dimensions before writing the marker', () => {
    const { editor, images } = make()
    images.insert({ data: PNG_1X1, mediaType: 'image/png', name: 'probe.png' })
    expect(images.count).toBe(1)
    expect(editor.text).toContain('1x1')
  })

  it('pads the marker with spaces between words', () => {
    const { editor, images } = make()
    editor.setText('a b', 1)
    images.insert(image('a.png'))
    expect(editor.text.startsWith('a ')).toBe(true)
    expect(editor.text.endsWith(' b')).toBe(true)
  })
})

describe('ComposerImages.removeAtCursor', () => {
  it('removes the marker touching the cursor and renumbers the rest', () => {
    const { editor, images } = make()
    images.insert(image('a.png'))
    images.insert(image('b.png'))
    expect(images.count).toBe(2)
    const second = imageMarker(1, image('b.png'))
    editor.setText(editor.text, editor.text.indexOf(second))
    expect(images.removeAtCursor('delete')).toBe(true)
    expect(images.count).toBe(1)
    expect(editor.text).not.toContain(second)
  })

  it('returns false when no marker touches the cursor', () => {
    const { editor, images } = make()
    images.insert(image('a.png'))
    editor.setText(editor.text, editor.text.length)
    expect(images.removeAtCursor('delete')).toBe(false)
    expect(images.removeAtCursor('backspace')).toBe(false)
  })
})

describe('ComposerImages.reconcile', () => {
  it('drops drafts whose marker was edited out and renumbers survivors', () => {
    const { editor, images } = make()
    images.insert(image('a.png'))
    images.insert(image('b.png'))
    const first = imageMarker(0, image('a.png'))
    editor.setText(editor.text.replace(first, ''))
    images.reconcile()
    expect(images.count).toBe(1)
    expect(editor.text).toContain(imageMarker(0, image('b.png')))
  })

  it('is a no-op when every marker survives', () => {
    const { editor, images } = make()
    images.insert(image('a.png'))
    const before = editor.text
    images.reconcile()
    expect(editor.text).toBe(before)
    expect(images.count).toBe(1)
  })
})

describe('ComposerImages.admit', () => {
  it('admits every candidate when no validator is set', async () => {
    const { images } = make()
    expect(await images.admit(image('a.png'))).toBe(true)
  })

  it('refuses a rejected candidate with a notice and no draft', async () => {
    const { images, notices } = make()
    images.setValidator(() => Promise.reject(new Error('too large')))
    expect(await images.admit(image('a.png'))).toBe(false)
    expect(notices).toEqual(['too large'])
    expect(images.count).toBe(0)
  })
})

describe('ComposerImages.restore/replace/clear', () => {
  it('prepends a queued submission and rebases existing markers', () => {
    const { editor, images } = make()
    images.insert(image('draft.png'))
    const queued = image('queued.png')
    images.restore({ text: 'earlier', images: [queued] })
    expect(images.count).toBe(2)
    // The queued image travels in the submission, not the text: the draft
    // marker is rebased to index 1 so it keeps pointing at its own entry.
    expect(editor.text).toBe(`earlier\n${imageMarker(1, image('draft.png'))} `)
  })

  it('replace swaps text and drafts wholesale; clear empties both', () => {
    const { editor, images } = make()
    images.insert(image('a.png'))
    images.replace({ text: 'fresh', images: [image('b.png')] })
    expect(editor.text).toBe('fresh')
    expect(images.count).toBe(1)
    images.clear()
    expect(images.count).toBe(0)
  })
})
