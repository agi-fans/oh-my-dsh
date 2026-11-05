/** Scoped, short-lived file receipts for the published command admission path. */
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandSubmitAttachment } from '@deepseek-ai/dsh-commands'
import type { SubmissionSegment, TuiInputImage, TuiSubmission } from '../definition.ts'

/** Preserve visible order and retain unmarked attachments from older drafts. */
export function orderedAttachments<T, U>(images: readonly T[], files: readonly U[], segments?: readonly SubmissionSegment[]): (T | U)[] {
  const result: (T | U)[] = [], placedImages = new Set<number>(), placedFiles = new Set<number>()
  for (const segment of segments ?? []) {
    if (segment.kind === 'text') continue
    const items = segment.kind === 'image' ? images : files
    const placed = segment.kind === 'image' ? placedImages : placedFiles
    const item = items[segment.index]
    if (item !== undefined && !placed.has(segment.index)) { result.push(item); placed.add(segment.index) }
  }
  images.forEach((item, index) => { if (!placedImages.has(index)) result.push(item) })
  files.forEach((item, index) => { if (!placedFiles.has(index)) result.push(item) })
  return result
}

export function encodeCommandAttachments(images: readonly TuiInputImage[]): CommandSubmitAttachment[] {
  return images.map(image => ({ type: 'image', mediaType: image.mediaType, data: Buffer.from(image.data).toString('base64'),
    ...(image.name === undefined ? {} : { name: image.name }) }))
}

/** One authority per local session runtime; receipts cannot cross Agent identities or survive dispatch. */
export class CommandAttachments {
  readonly #receipts = new Map<string, { agent: Agent; file: FileAttachmentRef }>()
  readonly #unregister: () => void
  constructor(commands: Pick<CommandRuntime, 'registerFileReceiptResolver'>) {
    this.#unregister = commands.registerFileReceiptResolver((agent, receiptId) => {
      const receipt = this.#receipts.get(receiptId)
      return receipt?.agent === agent ? receipt.file : undefined
    })
  }
  stage(agent: Agent, submission: TuiSubmission): { attachments: CommandSubmitAttachment[]; dispose(): void } {
    const images = encodeCommandAttachments(submission.images)
    const receipts = (submission.files ?? []).map(file => {
      const receiptId = randomUUID()
      this.#receipts.set(receiptId, { agent, file: { ...file } })
      return { type: 'file' as const, receiptId }
    })
    return { attachments: orderedAttachments(images, receipts, submission.segments),
      dispose: () => { for (const receipt of receipts) this.#receipts.delete(receipt.receiptId) } }
  }
  dispose(): void { this.#receipts.clear(); this.#unregister() }
}
