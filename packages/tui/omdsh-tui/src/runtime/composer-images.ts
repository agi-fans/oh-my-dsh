/**
 * ComposerImages — owns the image-draft list and its `[Image #n]` markers
 * inside the composer text.
 *
 * Draft ownership only: inserting, removing at the cursor, renumbering after
 * edits, and dropping drafts whose marker disappeared. Paste routing, key
 * decoding, and the prompt/settings/search branches that decide whether a
 * paste is an image at all stay in the provider.
 */

import type { TuiInputImage, TuiSubmission } from '../definition.ts'
import type { InputEditor } from '../input/editor.ts'
import { imageMarker, probeImageDimensions } from '../input/image-paste.ts'

export interface ComposerImagesDeps {
  readonly editor: InputEditor
  /** Report a refused draft's reason. */
  notice(text: string): void
}

export class ComposerImages {
  readonly #deps: ComposerImagesDeps
  #images: TuiInputImage[] = []
  #validate: ((image: TuiInputImage) => Promise<void>) | undefined

  constructor(deps: ComposerImagesDeps) {
    this.#deps = deps
  }

  get count(): number {
    return this.#images.length
  }

  /** Fresh copies for a submission snapshot. */
  copies(): TuiInputImage[] {
    return this.#images.map(image => ({ ...image }))
  }

  setValidator(validate: ((image: TuiInputImage) => Promise<void>) | undefined): void {
    this.#validate = validate
  }

  /**
   * Run the Harness image-admission check for one paste candidate. A refusal
   * becomes an error notice and skips the draft, instead of failing the whole
   * submission after the user has typed a prompt around it.
   */
  async admit(image: TuiInputImage): Promise<boolean> {
    if (this.#validate === undefined) return true
    try {
      await this.#validate(image)
      return true
    } catch (error: unknown) {
      this.#deps.notice(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  /** Insert an `[Image #n]` marker at the cursor, padded with spaces. */
  insert(input: TuiInputImage): void {
    const size = input.width === undefined || input.height === undefined
      ? probeImageDimensions(input.data, input.mediaType)
      : undefined
    const image: TuiInputImage = {
      ...input,
      ...(input.width === undefined && size !== undefined ? { width: size.width } : {}),
      ...(input.height === undefined && size !== undefined ? { height: size.height } : {}),
    }
    const marker = imageMarker(this.#images.length, image)
    const editor = this.#deps.editor
    const before = editor.cursor > 0 && !/\s/u.test(editor.text[editor.cursor - 1] ?? '') ? ' ' : ''
    const after = editor.cursor >= editor.text.length || !/\s/u.test(editor.text[editor.cursor] ?? '')
      ? ' '
      : ''
    this.#images.push(image)
    editor.handle({ type: 'text', value: before + marker + after })
  }

  /**
   * Delete the image whose marker touches the cursor, renumbering the rest.
   * Returns true when a draft was removed; the caller repaints.
   */
  removeAtCursor(key: 'backspace' | 'delete'): boolean {
    const editor = this.#deps.editor
    const cursor = editor.cursor
    for (let index = 0; index < this.#images.length; index += 1) {
      const image = this.#images[index] as TuiInputImage
      const marker = imageMarker(index, image)
      const start = editor.text.indexOf(marker)
      if (start < 0) continue
      let from = start
      let to = start + marker.length
      const touches = key === 'backspace'
        ? cursor > start && cursor <= to
        : cursor >= start && cursor < to
      if (!touches) continue
      if (editor.text[to] === ' ') to += 1
      else if (from > 0 && editor.text[from - 1] === ' ') from -= 1
      const oldImages = this.#images
      let text = editor.text.slice(0, from) + editor.text.slice(to)
      const nextImages = oldImages.filter((_, oldIndex) => oldIndex !== index)
      let nextIndex = 0
      for (let oldIndex = 0; oldIndex < oldImages.length; oldIndex += 1) {
        if (oldIndex === index) continue
        const remaining = oldImages[oldIndex] as TuiInputImage
        text = text.replaceAll(imageMarker(oldIndex, remaining), imageMarker(nextIndex, remaining))
        nextIndex += 1
      }
      this.#images = nextImages
      editor.setText(text, Math.min(from, text.length))
      return true
    }
    return false
  }

  /** Drop drafts whose marker left the text, renumbering the survivors. */
  reconcile(): void {
    if (this.#images.length === 0) return
    const editor = this.#deps.editor
    const oldImages = this.#images
    const retained = oldImages.filter((image, index) => editor.text.includes(imageMarker(index, image)))
    if (retained.length === oldImages.length) return
    let text = editor.text
    let nextIndex = 0
    for (let oldIndex = 0; oldIndex < oldImages.length; oldIndex += 1) {
      const image = oldImages[oldIndex] as TuiInputImage
      const oldMarker = imageMarker(oldIndex, image)
      if (!text.includes(oldMarker)) continue
      text = text.replaceAll(oldMarker, imageMarker(nextIndex, image))
      nextIndex += 1
    }
    this.#images = retained
    editor.setText(text, Math.min(editor.cursor, text.length))
  }

  /** Prepend a queued submission's drafts, rebasing the current markers. */
  restore(submission: TuiSubmission): void {
    const editor = this.#deps.editor
    const currentImages = this.#images
    let rebasedCurrent = editor.text
    for (let index = currentImages.length - 1; index >= 0; index -= 1) {
      const image = currentImages[index] as TuiInputImage
      rebasedCurrent = rebasedCurrent.replaceAll(
        imageMarker(index, image),
        imageMarker(index + submission.images.length, image),
      )
    }
    const separator = submission.text !== '' && rebasedCurrent !== '' ? '\n' : ''
    this.#images = [...submission.images.map(image => ({ ...image })), ...currentImages]
    editor.setText(submission.text + separator + rebasedCurrent)
  }

  /** Replace drafts and text with a queued/edited submission. */
  replace(submission: TuiSubmission): void {
    this.#images = submission.images.map(image => ({ ...image }))
    this.#deps.editor.setText(submission.text)
  }

  clear(): void {
    this.#images = []
  }
}
