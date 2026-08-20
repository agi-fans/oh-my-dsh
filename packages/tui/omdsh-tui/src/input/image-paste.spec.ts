import { describe, expect, it } from 'vitest'
import {
  imageMarker,
  imagePathCandidates,
  looksLikeSlashCommand,
  probeImageDimensions,
  stripComposerImageMarkers,
} from './image-paste.ts'

const PNG_1X1 = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zk5sAAAAASUVORK5CYII=',
  'base64',
))

describe('image paste', () => {
  it('recognizes quoted, escaped, and file-url image paths without treating prose as a path', () => {
    expect(imagePathCandidates('"/tmp/screenshot.png"')).toEqual(['/tmp/screenshot.png'])
    expect(imagePathCandidates('/tmp/a\\ b.webp')).toEqual(['/tmp/a b.webp'])
    expect(imagePathCandidates('/tmp/Screenshot 2026-08-15 at 19.00.00.png'))
      .toEqual(['/tmp/Screenshot 2026-08-15 at 19.00.00.png'])
    expect(imagePathCandidates('file:///tmp/a%20b.jpg')).toEqual(['/tmp/a b.jpg'])
    expect(imagePathCandidates('/tmp/a.png\n/tmp/b.gif')).toEqual(['/tmp/a.png', '/tmp/b.gif'])
    expect(imagePathCandidates('/tmp/a.png /tmp/b.gif')).toEqual([])
    expect(imagePathCandidates('please inspect /tmp/a.png')).toEqual([])
    expect(imagePathCandidates('/tmp/readme.md')).toEqual([])
  })

  it('probes dimensions and formats the same compact marker used by the composer', () => {
    expect(probeImageDimensions(PNG_1X1, 'image/png')).toEqual({ width: 1, height: 1 })
    expect(imageMarker(0, { data: PNG_1X1, mediaType: 'image/png', width: 1, height: 1 }))
      .toBe('[Image #1, 1x1]')
  })

  it('leaves handwritten image placeholders and slash spacing unchanged without attachments', () => {
    expect(stripComposerImageMarkers('[Image #1] /goal literal', [])).toBe('[Image #1] /goal literal')
    expect(stripComposerImageMarkers('/goal   keep   spacing', [])).toBe('/goal   keep   spacing')
    expect(looksLikeSlashCommand('[Image #1] /goal literal', [])).toBe(false)
    expect(looksLikeSlashCommand('/goal   keep   spacing', [])).toBe(true)
  })

  it('strips only attached imageMarker values and TUI separator spaces', () => {
    const image = { data: PNG_1X1, mediaType: 'image/png' as const, width: 1, height: 1 }
    const images = [image]
    expect(imageMarker(0, image)).toBe('[Image #1, 1x1]')
    expect(stripComposerImageMarkers('[Image #1, 1x1] /goal implement auth', images))
      .toBe('/goal implement auth')
    expect(stripComposerImageMarkers('/plan the migration [Image #1, 1x1]', images))
      .toBe('/plan the migration')
    expect(stripComposerImageMarkers('/goal [Image #1, 1x1] implement auth', images))
      .toBe('/goal implement auth')
    expect(stripComposerImageMarkers('/goal   keep   spacing [Image #1, 1x1]', images))
      .toBe('/goal   keep   spacing')
    expect(stripComposerImageMarkers('[Image #1, 1x1] see [Image #2] notes', images))
      .toBe('see [Image #2] notes')
    expect(stripComposerImageMarkers('[Image #1] /goal literal', images)).toBe('[Image #1] /goal literal')
    expect(stripComposerImageMarkers('[Image #1, 1x1] and [Image #1, 1x1] /goal', images))
      .toBe('and [Image #1, 1x1] /goal')
    expect(looksLikeSlashCommand('[Image #1, 1x1] /goal implement auth', images)).toBe(true)
    expect(looksLikeSlashCommand('/plan the migration [Image #1, 1x1]', images)).toBe(true)
    expect(looksLikeSlashCommand('/goal [Image #1, 1x1] implement auth', images)).toBe(true)
    expect(looksLikeSlashCommand('[Image #1, 1x1] describe this', images)).toBe(false)
    expect(looksLikeSlashCommand('[Image #1] /goal literal', images)).toBe(false)
  })
})
