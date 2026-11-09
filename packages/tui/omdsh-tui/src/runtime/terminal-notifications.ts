import { uiText, type UiLanguage } from '../locale/index.ts'
import { settledProgramState, type TerminalProgramState } from './terminal-state.ts'
/** Opt-in terminal notifications kept outside the transcript renderer. */

export type TerminalNotificationPolicy = 'off' | 'unfocused' | 'always'

export interface TerminalNotificationOptions {
  readonly language?: UiLanguage
  readonly policy: TerminalNotificationPolicy
  readonly thresholdMs: number
}

export interface TerminalNotification {
  readonly programState?: TerminalProgramState
  readonly attention?: boolean
  readonly title: string
  readonly body: string
}

export interface NotificationEvent {
  readonly type: string
  readonly time?: number
  readonly reason?: string
}

const DEFAULT_OPTIONS: TerminalNotificationOptions = {
  policy: 'off',
  thresholdMs: 30_000,
}
const END_REASON_COPY: Readonly<Record<string, string>> = {
  'max-tokens': 'Output token limit reached',
  blocked: 'Turn was blocked',
  interrupted: 'Session was interrupted',
  aborted: 'Turn was interrupted',
  error: 'Turn failed',
}

function eventTime(event: NotificationEvent, fallback: number): number {
  return typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : fallback
}

function notificationBody(reason: string | undefined, elapsedMs: number, language: UiLanguage): string {
  const t = (source: string, values?: Record<string, string | number>) => uiText(language, source, values)
  const seconds = Math.max(0, Math.round(elapsedMs / 1_000))
  if (reason && reason !== 'complete' && reason !== 'completed') {
    return t('{reason} after {seconds}s', { reason: END_REASON_COPY[reason] === undefined ? t('Turn ended ({reason})', { reason }) : t(END_REASON_COPY[reason]!), seconds })
  }
  return t('Turn completed in {seconds}s', { seconds })
}

export class TerminalNotificationController {
  #options = DEFAULT_OPTIONS
  #turnStartedAt: number | undefined

  configure(options: TerminalNotificationOptions): void {
    this.#options = {
      language: options.language ?? 'en',
      policy: options.policy,
      thresholdMs: Math.max(0, options.thresholdMs),
    }
  }

  reset(): void {
    this.#turnStartedAt = undefined
  }

  event(event: NotificationEvent, now = Date.now()): TerminalNotification | undefined {
    if (event.type === 'turn/start') {
      this.#turnStartedAt = eventTime(event, now)
      return undefined
    }
    if (event.type !== 'turn/end') return undefined

    const endedAt = eventTime(event, now)
    const startedAt = this.#turnStartedAt
    this.#turnStartedAt = undefined
    if (startedAt === undefined || this.#options.policy === 'off') return undefined

    const elapsedMs = Math.max(0, endedAt - startedAt)
    if (this.#options.policy === 'unfocused' && elapsedMs < this.#options.thresholdMs) return undefined
    const language = this.#options.language ?? 'en'
    const attention = !!event.reason && !['complete', 'completed'].includes(event.reason)
    return {
      programState: settledProgramState(event.reason),
      attention,
      title: uiText(language, event.reason && event.reason !== 'complete' && event.reason !== 'completed' ? 'omdsh needs attention' : 'omdsh finished'),
      body: notificationBody(event.reason, elapsedMs, language),
    }
  }

  humanPrompt(label = 'Input required'): TerminalNotification | undefined {
    if (this.#options.policy === 'off') return undefined
    return { programState: 'blocked', attention: true, title: uiText(this.#options.language ?? 'en', 'omdsh needs attention'), body: uiText(this.#options.language ?? 'en', label) }
  }
}

/** Keep one notification per event burst, with input requests and failures first. */
export class TerminalNotificationQueue {
  #pending: TerminalNotification | undefined

  offer(notification: TerminalNotification): void {
    if ((this.#pending?.attention ?? (this.#pending?.title === 'omdsh needs attention')) && !(notification.attention ?? (notification.title === 'omdsh needs attention'))) return
    this.#pending = notification
  }

  clear(state?: TerminalProgramState): void {
    if (state === undefined || this.#pending?.programState === state) this.#pending = undefined
  }

  /** Drain the coalesced event. Whether it should be delivered is the caller's policy. */
  take(): TerminalNotification | undefined {
    const pending = this.#pending
    this.clear()
    return pending
  }
}

function cleanNotificationText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
}

/** OSC 9 is supported by common terminal emulators and never enters screen text. */
export function terminalNotificationSequence(notification: TerminalNotification): string {
  const message = cleanNotificationText(`${notification.title}: ${notification.body}`)
  return message ? `\x1b]9;${message}\x07` : ''
}
