import { describe, expect, it, vi } from 'vitest'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import {
  authorizationPromptRequest,
  createAuthorizationInteraction,
  formatAuthorizationNotice,
} from './authorization-interaction.ts'

describe('formatAuthorizationNotice', () => {
  it('renders the message and optional page details without inventing a secret', () => {
    expect(formatAuthorizationNotice({ message: 'Continue in the browser' }))
      .toBe('Continue in the browser')
    expect(formatAuthorizationNotice({
      message: 'Enter this code',
      url: 'https://example.test/device',
      code: 'ABCD-1234',
    })).toBe('Enter this code\nhttps://example.test/device\nCode: ABCD-1234')
  })
})

describe('authorizationPromptRequest', () => {
  it('maps text, secret, and select prompts onto keyboard-selectable TUI prompts', () => {
    expect(authorizationPromptRequest({ kind: 'text', message: 'Paste the code', placeholder: 'code' }, 'Login'))
      .toEqual({
        title: 'Login',
        question: 'Paste the code',
        detail: 'code',
        allowCustom: true,
        secret: false,
      })
    expect(authorizationPromptRequest({ kind: 'secret', message: 'API key' }, 'Login'))
      .toEqual({
        title: 'Login',
        question: 'API key',
        allowCustom: true,
        secret: true,
      })
    expect(authorizationPromptRequest({
      kind: 'select',
      message: 'Choose a method',
      options: [
        { id: 'oauth', label: 'Browser', description: 'Open a page' },
        { id: 'api-key', label: 'API key' },
      ],
    }, 'Login')).toEqual({
      title: 'Login',
      question: 'Choose a method',
      options: [
        { label: 'Browser', value: 'oauth', description: 'Open a page' },
        { label: 'API key', value: 'api-key' },
      ],
      allowCustom: false,
    })
  })
})

describe('createAuthorizationInteraction', () => {
  it('forwards notices and returns typed and selected answers', async () => {
    const notice = vi.fn()
    const prompt = vi.fn()
      .mockResolvedValueOnce('typed-code')
      .mockResolvedValueOnce('oauth')
    const interaction = createAuthorizationInteraction({ notice, prompt }, 'Login to Codex')

    interaction.notify({ message: 'Open this page', url: 'https://example.test' })
    expect(notice).toHaveBeenCalledWith('Open this page\nhttps://example.test')

    await expect(interaction.prompt({ kind: 'text', message: 'Code' })).resolves.toBe('typed-code')
    await expect(interaction.prompt({
      kind: 'select',
      message: 'Method',
      options: [{ id: 'oauth', label: 'Browser' }],
    })).resolves.toBe('oauth')
    expect(prompt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      allowCustom: false,
      options: [{ label: 'Browser', value: 'oauth' }],
    }))
  })

  it('treats a dismissed prompt as a human decline, not a surface failure', async () => {
    const interaction = createAuthorizationInteraction({
      notice: vi.fn(),
      prompt: vi.fn().mockResolvedValue(null),
    }, 'Login')
    await expect(interaction.prompt({ kind: 'secret', message: 'Key' }))
      .rejects.toBeInstanceOf(AuthorizationDeclinedError)
  })

  it('does not report a withdrawn prompt as a human decline', async () => {
    const controller = new AbortController()
    controller.abort()
    const interaction = createAuthorizationInteraction({
      notice: vi.fn(),
      prompt: vi.fn().mockRejectedValue(new Error('cancelled')),
    }, 'Login')
    await expect(interaction.prompt({ kind: 'text', message: 'Code', signal: controller.signal }))
      .rejects.toThrow(/withdrawn/u)
    await expect(interaction.prompt({ kind: 'text', message: 'Code', signal: controller.signal }))
      .rejects.not.toBeInstanceOf(AuthorizationDeclinedError)
  })

  it('propagates a broken prompt surface as a failure rather than a decline', async () => {
    const interaction = createAuthorizationInteraction({
      notice: vi.fn(),
      prompt: vi.fn().mockRejectedValue(new Error('selector crashed')),
    }, 'Login')
    await expect(interaction.prompt({ kind: 'text', message: 'Code' }))
      .rejects.toThrow('selector crashed')
    await expect(interaction.prompt({ kind: 'text', message: 'Code' }))
      .rejects.not.toBeInstanceOf(AuthorizationDeclinedError)
  })
})
