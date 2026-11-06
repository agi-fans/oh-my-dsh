import { describe, expect, it, vi } from 'vitest'
import type { TuiPrompt } from '../definition.ts'
import { readReference, referenceFields, referenceSections } from './reference-reader.ts'

const content = '# Release\n\n## Added\n\n- Search\n\n```md\n## Example\n```\n\n## Fixed\n\n- Padding'

describe('reference reader', () => {
  it('navigates real headings while retaining fenced examples in their section', () => {
    const sections = referenceSections(content)
    expect(sections.map(item => item.title)).toEqual(['Added', 'Fixed'])
    expect(sections[0]?.text).toContain('## Example')
    expect(sections[0]?.text).not.toContain('Padding')
    expect(referenceSections('## Same\n\na\n\n## Same\n\nb')).toHaveLength(2)
  })

  it('distinguishes repeated section names by their content', async () => {
    const requests: TuiPrompt[] = []
    const answers = ['sections', null, null]
    await readReference({ prompt: async request => { requests.push(request); return answers.shift() ?? null } },
      'Changelog', '## Removed\n\n- Old command\n\n## Removed\n\n- Old option')
    expect(requests[1]?.options?.slice(1).map(option => option.description)).toEqual(['Old command', 'Old option'])
  })

  it('copies diagnostic values without Markdown delimiters', () => {
    expect(referenceFields('| Field | Value |\n|---|---|\n| Session | `s-123` |\n| Path | `/tmp/中文 a.ts` |'))
      .toEqual([{ label: 'Session', value: 's-123' }, { label: 'Path', value: '/tmp/中文 a.ts' }])
  })

  it('restores each page position after selecting a section or copying', async () => {
    const requests: TuiPrompt[] = []
    const answers = ['sections', '1', 'copy', 'sections', '0', null]
    const copyText = vi.fn(async () => {})
    const prompt = vi.fn(async (request: TuiPrompt) => {
      requests.push(request)
      if (requests.length === 1) request.onDocumentPosition?.({ row: 8, wrap: 0, query: 'Search' })
      return answers.shift() ?? null
    })
    await readReference({ prompt, copyText }, 'Changelog', content)
    expect(requests[2]?.detail).toBe(referenceSections(content)[0]?.text)
    expect(copyText).toHaveBeenCalledWith(referenceSections(content)[0]?.text, 'This page')
    expect(requests[5]?.documentPosition).toEqual({ row: 8, wrap: 0, query: 'Search' })
  })

  it('copies the chosen field and returns to its page', async () => {
    const answers = ['copy', '1', null]
    const prompt = vi.fn(async () => answers.shift() ?? null)
    const copyText = vi.fn(async () => {})
    await readReference({ prompt, copyText }, 'Session', '| Session | `s-123` |')
    expect(copyText).toHaveBeenCalledWith('s-123', 'Session')
    expect(prompt).toHaveBeenCalledTimes(3)
  })

  it('yields to an attention prompt without reopening or copying', async () => {
    const copyText = vi.fn(async () => {})
    const prompt = vi.fn(async (request: TuiPrompt) => { request.onSuperseded?.(''); return 'copy' })
    await readReference({ prompt, copyText }, 'Details', content)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(copyText).not.toHaveBeenCalled()
  })
})
