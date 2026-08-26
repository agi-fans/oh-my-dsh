/** Opt-in terminal notifications kept outside the transcript renderer. */

export type TerminalNotificationPolicy = 'off' | 'long-running' | 'always'

export interface TerminalNotificationOptions {
  readonly policy: TerminalNotificationPolicy
  readonly thresholdMs: number
}

export interface TerminalNotification {
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

function eventTime(event: NotificationEvent, fallback: number): number {
  return typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : fallback
}

function notificationBody(reason: string | undefined, elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1_000))
  if (reason && reason !== 'complete' && reason !== 'completed') return `Turn ${reason} after ${seconds}s`
  return `Turn completed in ${seconds}s`
}

export class TerminalNotificationController {
  #options = DEFAULT_OPTIONS
  #turnStartedAt: number | undefined

  configure(options: TerminalNotificationOptions): void {
    this.#options = {
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
    if (this.#options.policy === 'long-running' && elapsedMs < this.#options.thresholdMs) return undefined
    return {
      title: event.reason && event.reason !== 'complete' && event.reason !== 'completed' ? 'omdsh needs attention' : 'omdsh finished',
      body: notificationBody(event.reason, elapsedMs),
    }
  }

  humanPrompt(label = 'Input required'): TerminalNotification | undefined {
    if (this.#options.policy === 'off') return undefined
    return { title: 'omdsh needs attention', body: label }
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
