/** The fixed startup hint line that sits under the header. */

/** One key/action pair: the key, then what it opens. */
export interface WelcomeHint {
  key: string
  text: string
}

/**
 * What the header teaches, in the order a new reader needs it.
 *
 * Four entries, and each one has to earn its place on two counts: it must be
 * impossible to guess, and it must change what the reader can do. That is why
 * `Ctrl+R` is not here — history search is a shortcut you go looking for once
 * you already have a history, not an affordance that changes the first session.
 * `!` is the opposite: no reader guesses that a bang runs a Shell line outside
 * the model's context, and once they know, they use it every day.
 *
 * The line carries no universal key either. `Esc` cancels and `Enter` sends;
 * a reminder of either is a permanent row about something learned in a minute.
 * The last entry is the exit hatch — `/help` holds the rest of the catalog.
 */
export const WELCOME_HINTS: readonly WelcomeHint[] = [
  { key: '/', text: 'commands' },
  { key: '@', text: 'files' },
  { key: '!', text: 'shell' },
  { key: '/help', text: 'all shortcuts' },
]

/** The label that marks the line as advice rather than as chrome. */
export const HINT_LABEL = 'Tips:'
