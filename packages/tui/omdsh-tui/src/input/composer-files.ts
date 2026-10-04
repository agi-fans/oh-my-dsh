/** File draft markers retain durable references without retaining file bytes. */

import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'

export function fileMarker(file: FileAttachmentRef, ordinal: number): string {
  return `[File:${ordinal} ${JSON.stringify(file.name)}]`
}

export class ComposerFiles {
  #files: { file: FileAttachmentRef; marker: string }[] = []
  #next = 0
  constructor(private readonly input: { text(): string; append(text: string): void }) {}
  add(file: FileAttachmentRef): void {
    this.reconcile()
    if (this.#files.some(item => item.file.attachmentId === file.attachmentId && item.file.name === file.name)) return
    const marker = fileMarker(file, ++this.#next)
    this.#files.push({ file, marker })
    this.input.append(marker)
  }
  reconcile(): void { this.#files = this.#files.filter(item => this.input.text().includes(item.marker)) }
  copies(): FileAttachmentRef[] { this.reconcile(); return this.#files.map(item => item.file) }
  clear(): void { this.#files = []; this.#next = 0 }
  text(text: string): string {
    this.reconcile()
    if (this.#files.length === 0) return text
    for (const item of this.#files) text = text.replaceAll(item.marker, '')
    return text.trim()
  }
  restore(files: readonly FileAttachmentRef[] = []): void { this.clear(); for (const file of files) this.add(file) }
}
