import { describe, expect, it, vi } from 'vitest'
import type { TuiPrompt } from '../definition.ts'
import { filteredPromptOptions } from '../views/prompt-selector.ts'
import { browseHelp, helpOptions } from './help-reader.ts'

const commands = [
  { name: 'extension', aliases: ['ext'], inputHint: '<value>', description: 'Find useful examples' },
  { name: 'diff', description: 'Inspect changes' },
]

describe('help reader', () => {
  it('prioritizes common commands and filters aliases and descriptions', () => {
    const options = helpOptions(commands, 'en')
    expect(options[0]?.value).toBe('/diff')
    const request = { title: 'Help', question: '', options, filterable: true }
    expect(filteredPromptOptions(request, '/ext').map(item => item.value)).toEqual(['/extension'])
    expect(filteredPromptOptions(request, 'examples')[0]?.preview).toContain('/extension <value>')
  })

  it('stages a selected command without arguments or execution', async () => {
    const insertText = vi.fn()
    await browseHelp({ prompt: vi.fn(async () => '/extension'), insertText }, commands, {}, 'en', false, new AbortController().signal)
    expect(insertText).toHaveBeenCalledWith('/extension ')
  })

  it('returns from shortcuts to commands and yields to cancellation', async () => {
    const requests: TuiPrompt[] = []
    const answers = ['shortcuts', null, null]
    await browseHelp({ prompt: async request => { requests.push(request); return answers.shift() ?? null } }, commands, {}, 'en', false, new AbortController().signal)
    expect(requests.map(request => request.title)).toEqual(['Help', 'Help · Shortcuts', 'Help'])
    expect(requests[1]?.detail).toContain('Diff / file browser')
  })
})
