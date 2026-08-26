/** Terminal adapter for Harness authorization notices and prompts. */

import {
  AuthorizationDeclinedError,
  type AuthorizationInteraction,
  type AuthorizationNotice,
  type AuthorizationPrompt,
} from '@deepseek-ai/dsh-authorization'
import type { TuiPrompt, TuiService } from '../definition.ts'

const WITHDRAWN = 'the authorization prompt was withdrawn'

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

/** User-visible notice text. Never includes a secret. */
export function formatAuthorizationNotice(notice: AuthorizationNotice): string {
  const parts = [notice.message]
  if (notice.url !== undefined && notice.url !== '') parts.push(notice.url)
  if (notice.code !== undefined && notice.code !== '') parts.push(`Code: ${notice.code}`)
  return parts.join('\n')
}

/** Map one Harness authorization prompt onto the existing TUI selector. */
export function authorizationPromptRequest(prompt: AuthorizationPrompt, title: string): TuiPrompt {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal }
  if (prompt.kind === 'select') {
    return {
      title,
      question: prompt.message,
      options: prompt.options.map(option => ({
        label: option.label,
        value: option.id,
        ...(option.description === undefined ? {} : { description: option.description }),
      })),
      allowCustom: false,
      ...signal,
    }
  }
  return {
    title,
    question: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { detail: prompt.placeholder }),
    allowCustom: true,
    secret: prompt.kind === 'secret',
    ...signal,
  }
}

/**
 * Surface-owned authorization interaction: notices and prompts only.
 * Provider plugins own protocols and credential record formats.
 */
export function createAuthorizationInteraction(
  tui: Pick<TuiService, 'notice' | 'prompt'>,
  title: string,
): AuthorizationInteraction {
  return {
    notify(notice) {
      tui.notice(formatAuthorizationNotice(notice))
    },
    async prompt(prompt) {
      if (isAborted(prompt.signal)) throw new Error(WITHDRAWN)
      let answer: string | null
      try {
        answer = await tui.prompt(authorizationPromptRequest(prompt, title))
      } catch (error: unknown) {
        if (isAborted(prompt.signal)) throw new Error(WITHDRAWN, { cause: error })
        throw error
      }
      if (isAborted(prompt.signal)) throw new Error(WITHDRAWN)
      if (answer === null) throw new AuthorizationDeclinedError()
      return answer
    },
  }
}
