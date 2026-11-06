import type { TuiPrompt, TuiService } from '../definition.ts'

/** List state lives for one browsing operation and is written by the terminal. */
export interface PromptBrowserState {
  query: string
  selected?: string | undefined
}

// Prompt adapters spread requests to add cancellation and localization.
const BROWSER_STATE = Symbol('prompt-browser-state')

export function promptBrowserState(request: TuiPrompt): PromptBrowserState | undefined {
  return (request as TuiPrompt & { [BROWSER_STATE]?: PromptBrowserState })[BROWSER_STATE]
}

/** Reopen related lists without losing their filter or focused row. */
export function createPromptBrowser(prompt: TuiService['prompt']): (request: TuiPrompt, key?: string) => Promise<string | null> {
  const lists = new Map<string, PromptBrowserState>()
  return (request, key = request.title) => {
    let state = lists.get(key)
    if (state === undefined) {
      state = { query: '' }
      lists.set(key, state)
    }
    const browsingRequest = { ...request, [BROWSER_STATE]: state }
    return prompt(browsingRequest)
  }
}
