/** Decode previews locally; original images sent to Harness are never rewritten. */
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { TuiInputImage, TuiService } from '../definition.ts'
import type { PreviewImage } from '../chrome/terminal-images.ts'
import { openSystemFile } from './file-open.ts'

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const IMAGE_TYPES: Record<string, TuiInputImage['mediaType']> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
export function imageMediaType(path: string): TuiInputImage['mediaType'] | undefined { return IMAGE_TYPES[extname(path).toLowerCase()] }

export async function prepareImage(image: TuiInputImage, signal: AbortSignal): Promise<PreviewImage> {
  signal.throwIfAborted()
  if (image.data.length > MAX_IMAGE_BYTES) throw new Error('Image preview limit is 32 MiB. Use Open to view the original.')
  const { default: sharp } = await import('sharp')
  signal.throwIfAborted()
  const decoder = sharp(image.data, { limitInputPixels: 40_000_000, animated: false })
  const metadata = await decoder.metadata()
  if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format ?? '')) throw new Error('Preview supports PNG, JPEG, WebP and GIF images.')
  const { data, info } = await decoder.autoOrient().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
  signal.throwIfAborted()
  return { data, width: info.width, height: info.height,
    description: `${image.mediaType} · ${metadata.width} × ${metadata.height} px · ${image.data.length.toLocaleString()} bytes${(metadata.pages ?? 1) > 1 ? ' · First frame' : ''}` }
}

export async function imageFile(path: string, signal: AbortSignal): Promise<PreviewImage | undefined> {
  const mediaType = imageMediaType(path)
  if (mediaType === undefined) return undefined
  signal.throwIfAborted()
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Select a regular file to preview.')
    if (info.size > MAX_IMAGE_BYTES) throw new Error('Image preview limit is 32 MiB. Use Open to view the original.')
    const data = Buffer.alloc(info.size + 1)
    let count = 0
    while (count < data.length) {
      signal.throwIfAborted()
      const result = await handle.read(data, count, data.length - count, count)
      if (result.bytesRead === 0) break
      count += result.bytesRead
    }
    if (count > info.size) throw new Error('Image changed while reading; reopen its preview.')
    return await prepareImage({ data: data.subarray(0, count), mediaType }, signal)
  } finally { await handle.close() }
}

/** Shared image reader for draft and durable attachments, yielding to human questions. */
export async function previewImages(tui: TuiService, images: readonly TuiInputImage[], signal: AbortSignal,
  openOriginal?: (index: number) => Promise<void>, retainTemporary?: (directory: string) => void,
  current: () => boolean = () => true): Promise<void> {
  let index = 0
  let feedback = ''
  const cache = new Map<number, PreviewImage>()
  while (!signal.aborted && current()) {
    const image = images[index]
    if (image === undefined) return
    let preview: PreviewImage | undefined
    try {
      preview = cache.get(index) ?? await prepareImage(image, signal)
      cache.clear()
      cache.set(index, preview)
    } catch (error) {
      if (signal.aborted) return
      feedback = error instanceof Error ? error.message : String(error)
    }
    if (signal.aborted || !current()) return
    const multiple = images.length > 1
    const canOpen = openOriginal !== undefined || retainTemporary !== undefined
    const action = await tui.prompt({ title: `Image preview · ${index + 1}/${images.length}`, question: image.name ?? `Image #${index + 1}`,
      detail: feedback, ...(preview === undefined ? {} : { documentImage: preview }), presentation: 'document', notify: false,
      allowCustom: false, signal, onSuperseded: () => { /* The attention-requesting question takes ownership. */ },
      options: [...(multiple ? [{ label: 'Previous', value: 'previous' }, { label: 'Next', value: 'next' }] : []),
        ...(canOpen ? [{ label: 'Open', value: 'open' }] : []), { label: 'Close', value: 'close' }],
      actions: [...(multiple ? [{ key: 'p', label: 'previous', valuePrefix: 'previous' }, { key: 'n', label: 'next', valuePrefix: 'next' }] : []),
        ...(canOpen ? [{ key: 'o', label: 'open', valuePrefix: 'open' }] : [])] })
    if (action === null || action === 'close') return
    if (action === 'next' || action === 'previous') { index = (index + images.length + (action === 'next' ? 1 : -1)) % images.length; feedback = ''; continue }
    if (action === 'open') {
      try {
        if (openOriginal !== undefined) await openOriginal(index)
        else if (retainTemporary !== undefined) {
          const directory = await mkdtemp(join(tmpdir(), 'omdsh-image-'))
          try {
            const path = join(directory, 'original' + ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[image.mediaType]))
            await writeFile(path, image.data, { signal, mode: 0o600 })
            signal.throwIfAborted()
            retainTemporary(directory)
            await openSystemFile(path)
          } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
        }
        feedback = 'Opened in the default application.'
      } catch (error) { if (signal.aborted) return; feedback = error instanceof Error ? error.message : String(error) }
    }
  }
}
