/** Root activity projected once for Herdr and the foreground terminal. */
import { basename } from 'node:path'

export type AgentActivityState = 'idle' | 'working' | 'blocked'
export interface AgentActivityStatus { readonly state: AgentActivityState; readonly message?: string }
export type TerminalProgramState = AgentActivityState | 'done' | 'error'
export interface TerminalProgramStatus { readonly state: TerminalProgramState; readonly message?: string }
export const TERMINAL_TITLE_MODES = ['status', 'session', 'workspace', 'off'] as const
export type TerminalTitleMode = typeof TERMINAL_TITLE_MODES[number]
export const TERMINAL_STATE_MODES = ['auto', 'on', 'off'] as const
export type TerminalStateMode = typeof TERMINAL_STATE_MODES[number]
export const PROGRAM_STATUS_QUERY = '\x1b]7501;?\x1b\\'

function clean(value: string | undefined, limit: number): string | undefined {
  if (value === undefined) return undefined
  const text = [...value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim()].slice(0, limit).join('')
  return text === '' ? undefined : text
}

/** Status protocol carries titles only, never prompts, tool input or error payloads. */
export function programStatusSequence(status: TerminalProgramStatus | 'clear'): string {
  if (status === 'clear') return '\x1b]7501;state=clear:app=omdsh\x1b\\'
  const message = clean(status.message, 240)
  return `\x1b]7501;state=${status.state}:app=omdsh${message === undefined ? '' : `:msg=${Buffer.from(message).toString('base64')}`}\x1b\\`
}

const STATE_LABELS: Record<TerminalProgramState, string> = { idle: 'Ready', working: 'Working', blocked: 'Needs input', done: 'Done', error: 'Failed' }
export function terminalTitle(mode: TerminalTitleMode, status: TerminalProgramStatus, session: string | undefined, cwd: string, branch?: string): string {
  if (mode === 'off') return ''
  if (mode === 'session') return clean(session, 120) ?? ''
  const subject = mode === 'workspace' ? [basename(cwd), branch].filter(Boolean).join(' · ') : session ?? basename(cwd)
  return clean([STATE_LABELS[status.state], subject, 'omdsh'].filter(Boolean).join(' · '), 120) ?? ''
}

export class AgentActivityController {
  #running = false
  #prompts: (string | undefined)[] = []
  #last: string | undefined
  #result: 'idle' | 'done' | 'error' = 'idle'

  get current(): AgentActivityStatus {
    const message = this.#prompts.at(-1)
    return this.#prompts.length > 0 ? { state: 'blocked', ...(message === undefined ? {} : { message }) } : { state: this.#running ? 'working' : 'idle' }
  }
  get program(): TerminalProgramStatus {
    const current = this.current
    return current.state === 'idle' ? { state: this.#result } : current
  }
  start(): AgentActivityStatus { return this.#publish(true)! }
  setRunning(running: boolean): AgentActivityStatus | undefined {
    if (running && !this.#running) this.#result = 'idle'
    this.#running = running
    return this.#publish()
  }
  settled(reason: string): void { this.#result = ['complete', 'completed'].includes(reason) ? 'done' : ['aborted', 'interrupted'].includes(reason) ? 'idle' : 'error' }
  resetResult(): void { this.#result = 'idle' }
  prompt(message?: string): AgentActivityStatus | undefined { this.#prompts.push(clean(message, 240)); return this.#publish() }
  promptResolved(): AgentActivityStatus | undefined { if (this.#prompts.length === 0) return undefined; this.#prompts.pop(); return this.#publish() }
  #publish(force = false): AgentActivityStatus | undefined {
    const next = this.current
    const signature = `${next.state}\0${next.message ?? ''}`
    if (!force && signature === this.#last) return undefined
    this.#last = signature
    return next
  }
}
