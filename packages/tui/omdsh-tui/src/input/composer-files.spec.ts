import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { ComposerFiles, fileMarker } from './composer-files.ts'

const first = { attachmentId: AttachmentId('abcdefghijkl-one'), name: 'report.txt', bytes: 5 }
const second = { ...first, attachmentId: AttachmentId('abcdefghijkl-two') }

describe('file drafts', () => {
  it('retains distinct opaque ids, removes deleted markers and strips references from model text', () => {
    let text = 'Review these '
    const files = new ComposerFiles({ text: () => text, append: value => { text += value + ' ' } })
    files.add(first); files.add(first); files.add(second)
    expect(files.copies()).toEqual([first, second])
    expect(files.text(text)).toBe('Review these')
    text = text.replace(fileMarker(first, 1), '')
    expect(files.copies()).toEqual([second])
    files.clear()
    text = 'Restored '
    files.restore([first])
    expect(files.copies()).toEqual([first])
    expect(files.text(text)).toBe('Restored')
  })
})
