/** File draft markers retain durable references without retaining file bytes. */

import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'

export function fileMarker(file: FileAttachmentRef, ordinal: number): string {
  return `[File:${ordinal} ${JSON.stringify(file.name)}]`
}

export class ComposerFiles {
  #files: { file: FileAttachmentRef; marker: string }[] = []
  #next = 0
  #revision = 0
  get revision(): number { return this.#revision }
  constructor(private readonly input: { text(): string; append(text: string): void }) {}
  add(file: FileAttachmentRef): void {
    this.reconcile()
    if (this.#files.some(item => item.file.attachmentId === file.attachmentId && item.file.name === file.name)) return
    const marker = fileMarker(file, ++this.#next)
    this.#files.push({ file, marker })
    this.#revision++
    this.input.append(marker)
  }
  reconcile(): void {
    const files = this.#files.filter(item => this.input.text().includes(item.marker))
    if (files.length !== this.#files.length) this.#revision++
    this.#files = files
  }
  copies(): FileAttachmentRef[] { this.reconcile(); return this.#files.map(item => item.file) }
  clear(): void { this.#files = []; this.#next = 0; this.#revision++ }
  snapshot(text: string): { entries: { file: FileAttachmentRef; marker: string }[]; next: number } {
    return { entries: this.#files.filter(item => text.includes(item.marker)).map(item => ({ file: { ...item.file }, marker: item.marker })), next: this.#next }
  }
  restoreSnapshot(snapshot: ReturnType<ComposerFiles['snapshot']>): void {
    this.#files = snapshot.entries.map(item => ({ file: { ...item.file }, marker: item.marker }))
    this.#next = snapshot.next
    this.#revision++
  }
  text(text: string): string {
    this.reconcile()
    if (this.#files.length === 0) return text
    for (const item of this.#files) text = text.replaceAll(item.marker, '')
    return text.trim()
  }
  restore(files: readonly FileAttachmentRef[] = []): void { this.clear(); for (const file of files) this.add(file) }
}
