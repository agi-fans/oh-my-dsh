/** Root activity projected once for Herdr and the foreground terminal. */
import { basename, sep } from 'node:path'
import { hostname } from 'node:os'
import { pathToFileURL } from 'node:url'

export type AgentActivityState = 'idle' | 'working' | 'blocked'
export type TerminalAttentionKind = 'permission' | 'question' | 'auth'
export interface AgentActivityStatus { readonly state: AgentActivityState; readonly message?: string; readonly kind?: TerminalAttentionKind }
export type TerminalProgramState = AgentActivityState | 'done' | 'error'
export interface TerminalProgramStatus { readonly state: TerminalProgramState; readonly message?: string; readonly kind?: TerminalAttentionKind }
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
  const kind = status.state === 'blocked' && status.kind !== undefined ? `:kind=${status.kind}` : ''
  return `\x1b]7501;state=${status.state}:app=omdsh${kind}${message === undefined ? '' : `:msg=${Buffer.from(message).toString('base64')}`}\x1b\\`
}

export function workingDirectorySequence(cwd: string): string {
  // A directory separator also preserves trailing control bytes in Node's URL conversion.
  const url = pathToFileURL(cwd.endsWith(sep) ? cwd : cwd + sep)
  if (url.hostname === '') url.hostname = hostname()
  return `\x1b]7;${url.href}\x1b\\`
}

/** Progress has no measured percentage. Waiting and failure retain distinct states. */
export function terminalProgressSequence(state: TerminalProgramState | 'clear'): string {
  const codes: Record<TerminalProgramState | 'clear', string> = {
    idle: '0', working: '3', blocked: '4;0', done: '0', error: '2;0', clear: '0',
  }
  return `\x1b]9;4;${codes[state]}\x07`
}

/** These lifecycle reports can themselves create a terminal notification. */
export function programStatusNeedsAttention(state: TerminalProgramState): boolean {
  return state === 'blocked' || state === 'done' || state === 'error'
}

export function settledProgramState(reason = 'completed'): 'idle' | 'done' | 'error' {
  if (reason === 'complete' || reason === 'completed') return 'done'
  if (reason === 'aborted' || reason === 'interrupted') return 'idle'
  return 'error'
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
  #prompts: { message?: string; kind: TerminalAttentionKind }[] = []
  #last: string | undefined
  #result: 'idle' | 'done' | 'error' = 'idle'

  get current(): AgentActivityStatus {
    const prompt = this.#prompts.at(-1)
    return prompt === undefined ? { state: this.#running ? 'working' : 'idle' } : { state: 'blocked', ...prompt }
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
  settled(reason: string): void { this.#result = settledProgramState(reason) }
  resetResult(): void { this.#result = 'idle' }
  prompt(message?: string, kind: TerminalAttentionKind = 'question'): AgentActivityStatus | undefined {
    const text = clean(message, 240)
    this.#prompts.push({ kind, ...(text === undefined ? {} : { message: text }) })
    return this.#publish()
  }
  promptResolved(): AgentActivityStatus | undefined { if (this.#prompts.length === 0) return undefined; this.#prompts.pop(); return this.#publish() }
  #publish(force = false): AgentActivityStatus | undefined {
    const next = this.current
    const signature = `${next.state}\0${next.kind ?? ''}\0${next.message ?? ''}`
    if (!force && signature === this.#last) return undefined
    this.#last = signature
    return next
  }
}
