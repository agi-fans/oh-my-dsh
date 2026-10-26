/** The fixed startup hint line that sits under the header. */

/** One key/action pair: the key, then what it opens. */
export interface WelcomeHint {
  key: string
  text: string
}

/**
 * What the header teaches, in the order a new reader needs it.
 *
 * This is a fixed line rather than a sampled rotation: a hint that changes every
 * launch cannot be learned, and the four entries that matter — how to find
 * commands, files, history, and a finished turn — are the same four every time.
 * It deliberately carries no universal key. `Esc` cancels, `Enter` sends, and a
 * reminder of either would be a permanent line about something the reader learns
 * once; discovery affordances are what a header is for.
 */
export const WELCOME_HINTS: readonly WelcomeHint[] = [
  { key: '/', text: 'commands' },
  { key: '@', text: 'files' },
  { key: 'Ctrl+R', text: 'history' },
  { key: 'Ctrl+O', text: 'details' },
]
