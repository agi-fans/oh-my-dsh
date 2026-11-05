/** Session-scoped input recovery. Harness owns messages after admission. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { TuiSubmission } from '../definition.ts'
import { readJsonFile, writeJsonAtomic } from './json-file.ts'

interface Receipt {
  id: string
  sessionId: string
  messageId?: string
  recovered?: boolean
}
interface PendingSession {
  queued: TuiSubmission[]
  newer: TuiSubmission[] | null
  sending: Set<TuiSubmission>
  fingerprint?: string
  damaged?: boolean
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const ordinal = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function decode(value: unknown): TuiSubmission {
  if (!object(value) || typeof value.text !== 'string' || !Array.isArray(value.images)
    || value.literal !== undefined && typeof value.literal !== 'boolean'
    || value.delivery !== undefined && value.delivery !== 'queue' && value.delivery !== 'steer') throw new Error('Saved pending input is invalid.')
  const images = value.images.map(image => {
    if (!object(image) || typeof image.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(image.data)
      || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(String(image.mediaType))
      || image.name !== undefined && typeof image.name !== 'string'
      || image.width !== undefined && (!ordinal(image.width) || image.width === 0)
      || image.height !== undefined && (!ordinal(image.height) || image.height === 0)) throw new Error('Saved pending image is invalid.')
    const data = new Uint8Array(Buffer.from(image.data, 'base64'))
    if (typeof image.sha256 !== 'string' || digest(data) !== image.sha256) throw new Error('Saved pending image is incomplete.')
    const { sha256: _hash, ...metadata } = image
    return { ...metadata, data } as TuiSubmission['images'][number]
  })
  if (value.files !== undefined && (!Array.isArray(value.files) || value.files.some(file => !object(file)
    || typeof file.attachmentId !== 'string' || typeof file.name !== 'string' || !ordinal(file.bytes)))) throw new Error('Saved pending file is invalid.')
  const files = value.files as TuiSubmission['files']
  if (value.segments !== undefined && (!Array.isArray(value.segments) || value.segments.some(segment => !object(segment)
    || (segment.kind === 'text' ? typeof segment.text !== 'string' : segment.kind === 'image' || segment.kind === 'file'
      ? !ordinal(segment.index) || segment.index >= (segment.kind === 'image' ? images.length : files?.length ?? 0) : true)))) throw new Error('Saved pending attachment order is invalid.')
  return { text: value.text, images, ...(files === undefined ? {} : { files }),
    ...(value.literal === undefined ? {} : { literal: value.literal as boolean }),
    ...(value.delivery === undefined ? {} : { delivery: value.delivery as 'queue' | 'steer' }),
    ...(value.segments === undefined ? {} : { segments: value.segments as NonNullable<TuiSubmission['segments']> }) }
}

export class PendingInputs {
  readonly #sessions = new Map<string, PendingSession>()
  readonly #receipts = new WeakMap<TuiSubmission, Receipt>()
  readonly #imageData = new WeakMap<Uint8Array, { data: string; sha256: string }>()
  readonly #versions = new WeakMap<TuiSubmission, number>()
  #serial = 0
  #saveError = false
  constructor(private readonly root: string | undefined, private readonly report: (action: 'save' | 'restore', error: unknown) => void) {}

  #path(id: string): string | undefined {
    return this.root === undefined ? undefined : join(this.root, createHash('sha256').update(id).digest('hex') + '.json')
  }

  session(id: string): PendingSession {
    const existing = this.#sessions.get(id)
    if (existing !== undefined) return existing
    const state: PendingSession = { queued: [], newer: null, sending: new Set() }
    this.#sessions.set(id, state)
    const path = this.#path(id)
    if (path !== undefined && existsSync(path)) {
      try {
        const raw = readJsonFile(path)
        if (!object(raw) || raw.version !== 1 || raw.session !== id || !Array.isArray(raw.entries)) throw new Error('Saved pending inputs are invalid.')
        const identities = new Set<string>()
        const entries = raw.entries.map(entry => {
          if (!object(entry) || typeof entry.id !== 'string' || entry.messageId !== undefined && typeof entry.messageId !== 'string') throw new Error('Saved pending receipt is invalid.')
          if (identities.has(entry.id)) throw new Error('Saved pending receipt is duplicated.')
          identities.add(entry.id)
          const submission = decode(entry.submission)
          this.#receipts.set(submission, { id: entry.id, sessionId: id, recovered: true,
            ...(entry.messageId === undefined ? {} : { messageId: entry.messageId as string }) })
          return submission
        })
        state.queued.push(...entries)
      } catch (error) { state.damaged = true; this.report('restore', error) }
    }
    return state
  }

  bindInitial(sessionId: string): void {
    const initial = this.#sessions.get('__default__')
    if (initial === undefined) return
    const target = this.session(sessionId)
    target.queued.unshift(...initial.queued)
    for (const submission of initial.queued) this.identify(submission, '__default__').sessionId = sessionId
    initial.queued = []
    this.flush(sessionId)
    this.flush('__default__')
  }

  receipt(submission: TuiSubmission): Receipt | undefined { return this.#receipts.get(submission) }

  identify(submission: TuiSubmission, sessionId: string): Receipt {
    let receipt = this.receipt(submission)
    if (receipt === undefined) {
      receipt = { id: randomUUID(), sessionId }
      this.#receipts.set(submission, receipt)
    }
    return receipt
  }

  take(submission: TuiSubmission, sessionId: string): void {
    this.identify(submission, sessionId)
    this.session(sessionId).sending.add(submission)
    this.flush(sessionId)
  }

  prepare(submission: TuiSubmission, messageId: string): void {
    const receipt = this.receipt(submission)
    if (receipt === undefined) return
    receipt.messageId = messageId
    this.flush(receipt.sessionId)
  }

  finish(submission: TuiSubmission): void {
    const receipt = this.receipt(submission)
    if (receipt === undefined) return
    this.session(receipt.sessionId).sending.delete(submission)
    this.flush(receipt.sessionId)
  }

  reconcile(sessionId: string, accepted: ReadonlySet<string>): void {
    const state = this.session(sessionId)
    state.queued = state.queued.filter(submission => {
      const receipt = this.receipt(submission)
      return receipt?.messageId === undefined || !accepted.has(receipt.messageId)
    })
    this.flush(sessionId)
  }

  flush(sessionId: string): void {
    const state = this.session(sessionId)
    const entries = [...state.sending, ...state.queued, ...(state.newer ?? [])].map(submission => {
      const receipt = this.identify(submission, sessionId)
      let version = this.#versions.get(submission)
      if (version === undefined) { version = ++this.#serial; this.#versions.set(submission, version) }
      return { submission, receipt, version }
    })
    const fingerprint = entries.map(({ receipt, version }) => `${version}:${receipt.messageId ?? ''}`).join(',')
    if (state.fingerprint === fingerprint || state.damaged && entries.length === 0) return
    const path = this.#path(sessionId)
    if (path === undefined) { state.fingerprint = fingerprint; return }
    try {
      if (entries.length === 0) rmSync(path, { force: true })
      else writeJsonAtomic(path, { version: 1, session: sessionId, entries: entries.map(({ submission, receipt }) => ({
        id: receipt.id, ...(receipt.messageId === undefined ? {} : { messageId: receipt.messageId }),
        submission: { ...submission, images: submission.images.map(({ data, ...image }) => {
          let encoded = this.#imageData.get(data)
          if (encoded === undefined) { encoded = { data: Buffer.from(data).toString('base64'), sha256: digest(data) }; this.#imageData.set(data, encoded) }
          return { ...image, ...encoded }
        }) },
      })) })
      state.fingerprint = fingerprint
      state.damaged = false
      this.#saveError = false
    } catch (error) {
      if (!this.#saveError) { this.#saveError = true; this.report('save', error) }
    }
  }
}
