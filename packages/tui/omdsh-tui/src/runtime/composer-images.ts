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
import type { EditorSnapshot, InputEditor } from '../input/editor.ts'
import { imageMarker, probeImageDimensions, submissionDraft, type ComposerAttachmentRange } from '../input/image-paste.ts'

export interface ComposerImagesDeps {
  readonly editor: InputEditor
  /** Report a refused draft's reason. */
  notice(text: string): void
}

export class ComposerImages {
  readonly #deps: ComposerImagesDeps
  #images = new Map<string, TuiInputImage>()
  #next = 0
  #revision = 0
  #validate: ((image: TuiInputImage) => Promise<void>) | undefined

  constructor(deps: ComposerImagesDeps) {
    this.#deps = deps
  }

  get count(): number {
    return this.#active().length
  }

  get revision(): number { return this.#revision }

  /** Fresh copies for a submission snapshot. */
  copies(snapshot?: EditorSnapshot): TuiInputImage[] {
    if (snapshot === undefined) this.reconcile()
    return this.#active(snapshot).map(marker => ({ ...this.#images.get(marker.id)! }))
  }

  setValidator(validate: ((image: TuiInputImage) => Promise<void>) | undefined): void {
    this.#validate = validate
  }

  /**
   * Run the Harness image-admission check for one paste candidate. A refusal
   * becomes an error notice and skips the draft, instead of failing the whole
   * submission after the user has typed a prompt around it.
   */
  async admit(image: TuiInputImage, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted === true) return false
    if (this.#validate === undefined) return true
    try {
      await this.#validate(image)
      return !signal?.aborted
    } catch (error: unknown) {
      if (!signal?.aborted) this.#deps.notice(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  #active(snapshot?: EditorSnapshot) {
    return (snapshot === undefined ? this.#deps.editor.markers() : snapshot.markers ?? []).filter(marker => this.#images.has(marker.id))
  }

  /** Expanded-text positions of the owned image markers, including their separators. */
  ranges(): ComposerAttachmentRange[] {
    const editor = this.#deps.editor
    return this.#active().map((marker, index) => ({ kind: 'image', index,
      start: editor.textRange(0, marker.start).length, end: editor.textRange(0, marker.end).length }))
  }

  /** Insert an image as one undoable owned marker. */
  insert(input: TuiInputImage): void {
    const size = input.width === undefined || input.height === undefined ? probeImageDimensions(input.data, input.mediaType) : undefined
    const image: TuiInputImage = { ...input,
      ...(input.width === undefined && size !== undefined ? { width: size.width } : {}),
      ...(input.height === undefined && size !== undefined ? { height: size.height } : {}) }
    const editor = this.#deps.editor
    const start = editor.cursor
    const before = start > 0 && !/\s/u.test(editor.text[start - 1] ?? '') ? ' ' : ''
    const after = start >= editor.text.length || !/\s/u.test(editor.text[start] ?? '') ? ' ' : ''
    const text = before + imageMarker(this.count, image) + after
    editor.splice(start, start, text)
    const id = `image:${++this.#next}`
    editor.mark(id, start, start + text.length)
    this.#images.set(id, image)
    this.#revision++
    this.reconcile()
  }

  removeAtCursor(key: 'backspace' | 'delete'): boolean {
    const editor = this.#deps.editor
    const marker = this.#active().find(marker => key === 'backspace'
      ? editor.cursor > marker.start && editor.cursor <= marker.end
      : editor.cursor >= marker.start && editor.cursor < marker.end)
    if (marker === undefined) return false
    editor.splice(marker.start, marker.end, '')
    this.reconcile()
    return true
  }

  /** Keep payloads referenced by current text or undo history, and relabel active images. */
  reconcile(): void {
    const editor = this.#deps.editor
    const retained = editor.retainedMarkerIds()
    for (const id of this.#images.keys()) {
      if (!retained.has(id)) { this.#images.delete(id); this.#revision++ }
    }
    for (const [index, { id }] of this.#active().entries()) {
      const marker = editor.markers().find(marker => marker.id === id)!
      const current = editor.text.slice(marker.start, marker.end)
      const text = (current.match(/^\s*/u)?.[0] ?? '') + imageMarker(index, this.#images.get(marker.id)!) + (current.match(/\s*$/u)?.[0] ?? '')
      if (text !== current) editor.rewriteMarker(marker.id, text)
    }
  }

  /** Bind persisted payloads to the editor's saved marker identities. */
  restoreSnapshot(images: readonly TuiInputImage[]): void {
    this.#images.clear()
    const editor = this.#deps.editor
    let markers = editor.markers().filter(marker => marker.id.startsWith('image:'))
    if (markers.length === 0) {
      // Drafts saved before marker ranges were recorded retain their old labels.
      let cursor = 0
      for (const [index, image] of images.entries()) {
        const label = imageMarker(index, image)
        const start = editor.text.indexOf(label, cursor)
        if (start < 0) continue
        cursor = start + label.length
        editor.mark(`image:${++this.#next}`, start, cursor)
      }
      markers = editor.markers().filter(marker => marker.id.startsWith('image:'))
    }
    for (const [index, marker] of markers.entries()) {
      this.#next = Math.max(this.#next, Number(marker.id.slice('image:'.length)) || 0)
      if (images[index] !== undefined) this.#images.set(marker.id, { ...images[index]! })
    }
    this.#revision++
  }

  /** Prepend restored input with an exact edit so repeated paste labels keep their payloads. */
  restore(submission: TuiSubmission, fileMarkers?: string[]): void {
    const editor = this.#deps.editor
    const draft = submissionDraft(submission, fileMarkers)
    const separator = draft.text !== '' && editor.text !== '' ? '\n' : ''
    editor.splice(0, 0, draft.text + separator, draft.text.length + separator.length + editor.text.length)
    const last = draft.ranges.at(-1)
    if (submission.text === '' && last?.kind === 'image' && last.end === draft.text.length) last.end += separator.length
    for (const range of draft.ranges) {
      if (range.kind !== 'image') continue
      const id = `image:${++this.#next}`
      editor.mark(id, range.start, range.end)
      this.#images.set(id, { ...submission.images[range.index]! })
    }
    this.#revision++
    this.reconcile()
  }

  replace(submission: TuiSubmission, fileMarkers?: string[]): void {
    const draft = submissionDraft(submission, fileMarkers)
    this.#deps.editor.setText(draft.text)
    for (const range of draft.ranges) {
      if (range.kind === 'image') this.#deps.editor.mark(`image:${++this.#next}`, range.start, range.end)
    }
    this.restoreSnapshot(submission.images)
  }

  clear(): void {
    this.#revision++
    this.#images.clear()
  }
}
