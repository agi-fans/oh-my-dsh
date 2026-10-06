import sharp from 'sharp'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openSystemFile } from './file-open.ts'
import { imageFile, MAX_IMAGE_BYTES, prepareImage, previewImages } from './image-preview.ts'
import type { TuiInputImage, TuiService } from '../definition.ts'

vi.mock('./file-open.ts', () => ({ openSystemFile: vi.fn().mockResolvedValue(undefined) }))

const signal = () => new AbortController().signal
async function sample(format: 'png' | 'jpeg' | 'webp' | 'gif' = 'png', width = 20, height = 10): Promise<TuiInputImage> {
  const data = await sharp({ create: { width, height, channels: 3, background: '#1569a5' } }).toFormat(format).toBuffer()
  return { data, mediaType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`, name: `中文🐳.${format}` }
}

describe('image previews', () => {
  it.each(['png', 'jpeg', 'webp', 'gif'] as const)('decodes %s without altering the original and generates a PNG', async format => {
    const image = await sample(format), original = Buffer.from(image.data)
    const preview = await prepareImage(image, signal())
    expect(preview).toMatchObject({ width: 20, height: 10 })
    expect(await sharp(preview.data).metadata()).toMatchObject({ format: 'png', width: 20, height: 10 })
    expect(Buffer.from(image.data)).toEqual(original)
    expect(preview.description).toContain('20 × 10 px')
  })

  it('bounds dimensions, rejects corrupt and oversized inputs, and respects cancellation', async () => {
    expect(await prepareImage(await sample('jpeg', 4096, 2048), signal())).toMatchObject({ width: 2048, height: 1024 })
    await expect(prepareImage({ data: new Uint8Array(MAX_IMAGE_BYTES + 1), mediaType: 'image/png' }, signal())).rejects.toThrow('32 MiB')
    await expect(prepareImage({ data: new Uint8Array([1, 2]), mediaType: 'image/png' }, signal())).rejects.toThrow()
    const abort = new AbortController(); abort.abort()
    await expect(prepareImage(await sample(), abort.signal)).rejects.toThrow()
  })

  it('reads selected image files while leaving ordinary file readers unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omdsh-image-test-'))
    try {
      const image = await sample('webp')
      await writeFile(join(root, '测试.WEBP'), image.data)
      expect(await imageFile(join(root, '测试.WEBP'), signal())).toMatchObject({ width: 20, height: 10 })
      expect(await imageFile(join(root, 'missing.txt'), signal())).toBeUndefined()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('keeps original bytes and navigation available without a host path or image protocol', async () => {
    const images = [await sample(), await sample('jpeg')]
    const answers = ['next', 'open', 'previous', null]
    const prompt = vi.fn<TuiService['prompt']>().mockImplementation(async () => answers.shift() ?? null)
    const open = vi.fn().mockResolvedValue(undefined)
    await previewImages({ prompt } as unknown as TuiService, images, signal(), open)
    expect(prompt.mock.calls.map(([request]) => request.question)).toEqual([images[0]!.name, images[1]!.name, images[1]!.name, images[0]!.name])
    expect(prompt.mock.calls[0]?.[0]).toMatchObject({ presentation: 'document', notify: false, documentImage: { width: 20 }, onSuperseded: expect.any(Function) })
    expect(open).toHaveBeenCalledWith(1)
    expect(prompt.mock.calls[2]?.[0].detail).toContain('Opened')
  })

  it('keeps Close available when decoding fails, and does not open a stale draft', async () => {
    const prompt = vi.fn<TuiService['prompt']>().mockResolvedValue(null)
    await previewImages({ prompt } as unknown as TuiService, [{ data: new Uint8Array([0]), mediaType: 'image/png' }], signal())
    expect(prompt.mock.calls[0]?.[0].documentImage).toBeUndefined()
    expect(prompt.mock.calls[0]?.[0].detail).not.toBe('')
    prompt.mockClear()
    await previewImages({ prompt } as unknown as TuiService, [await sample()], signal(), undefined, undefined, () => false)
    expect(prompt).not.toHaveBeenCalled()
  })
})


it('opens original draft bytes through a private temporary file retained until terminal disposal', async () => {
  const image = await sample('jpeg'), retained: string[] = []
  const answers = ['open', null]
  const prompt = vi.fn<TuiService['prompt']>().mockImplementation(async () => answers.shift() ?? null)
  try {
    await previewImages({ prompt } as unknown as TuiService, [image], signal(), undefined, directory => { retained.push(directory) })
    expect(retained).toHaveLength(1)
    expect(openSystemFile).toHaveBeenLastCalledWith(join(retained[0]!, 'original.jpg'))
    expect(await readFile(join(retained[0]!, 'original.jpg'))).toEqual(Buffer.from(image.data))
  } finally { for (const directory of retained) await rm(directory, { recursive: true, force: true }) }
})
