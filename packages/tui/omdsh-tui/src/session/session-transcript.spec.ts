import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { stripAnsi } from '../chrome/width.ts'
import { LocalTui, type TerminalLike } from '../runtime/provider-local.ts'
import { SessionRuntime } from './session-controller.ts'
import * as commandTrajectory from '../commands/trajectory.ts'
import { registerCommands } from '../commands/registration.ts'

class ScrollingTerminal implements TerminalLike {
  captured = ''
  screen: string[]
  history: string[] = []
  #row = 0
  #col = 0
  output = { isTTY: true, write: (chunk: string): void => this.#write(chunk) }
  input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (): void => {}, destroy: (): void => {} })
  constructor(readonly columns: number, readonly rows: number) {
    this.screen = Array.from({ length: rows }, () => '')
  }
  width(): number { return this.columns }
  height(): number { return this.rows }
  visible(): string[] { return this.screen.map(row => stripAnsi(row)) }
  scrollback(): string[] { return this.history.map(row => stripAnsi(row)) }
  #write(chunk: string): void {
    this.captured += chunk
    for (const token of chunk.match(/\x1b\[[?0-9;]*[ -/]*[@-~]|\r\n|\r|\n|[^\r\n\x1b]+/gu) ?? []) {
      if (token === '\r\n' || token === '\n') {
        if (this.#row === this.rows - 1) {
          this.history.push(this.screen.shift() ?? '')
          this.screen.push('')
        } else this.#row += 1
        if (token === '\r\n') this.#col = 0
      } else if (token === '\r') this.#col = 0
      else if (token.startsWith('\x1b[')) {
        const final = token.at(-1)
        const params = token.slice(2, -1).replace(/^\?/u, '').split(';').map(value => Number(value || '1'))
        if (final === 'H') {
          this.#row = Math.min(this.rows - 1, (params[0] ?? 1) - 1)
          this.#col = (params[1] ?? 1) - 1
        } else if (final === 'K') this.screen[this.#row] = (params[0] ?? 0) === 2 ? '' : (this.screen[this.#row] ?? '').slice(0, this.#col)
        else if (final === 'J' && (params[0] === 2 || params[0] === 3)) this.screen = this.screen.map(() => '')
      } else {
        const current = (this.screen[this.#row] ?? '').padEnd(this.#col)
        this.screen[this.#row] = current.slice(0, this.#col) + token + current.slice(this.#col + token.length)
        this.#col += token.length
      }
    }
  }
}

/** Real controller and TUI, with only external agent execution replaced. */
async function fixture(tty = false) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const contexts: Context[] = []
  const presets = {
    defaultId: 'standard',
    resolve: async () => ({ id: 'standard' }),
    mount: async () => ({ id: 'standard' }),
    recompose: async (_ctx: Context, id: string) => ({ id }),
  }
  ctx.provide('agentPresets', presets)
  ctx.provide('tools', { schemas: () => [] })
  const agents = new Map<string, Agent>()
  async function create(options: {
    sessionId?: string
    resumeSessionId?: string
    seed?: readonly SessionEvent[]
    setup?: (context: Context, agent: Agent) => Promise<void>
  }) {
    const agentCtx = new Context()
    contexts.push(agentCtx)
    await agentCtx.plugin(CommandRuntime)
    agentCtx.provide('agentPresets', presets)
    agentCtx.provide('sessionProjections', { stateOf: () => 'standard' })
    agentCtx.provide('tools', { presentAs: () => () => undefined })
    agentCtx.provide('permissionPresets', { names: [], optionOf: () => undefined, current: () => undefined })
    const id = SessionId(options.resumeSessionId ?? options.sessionId!)
    const session = ctx.sessions.get(id) ?? ctx.sessions.create(id, { seed: options.seed })
    const agent = { id, ctx: agentCtx, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent
    agents.set(id, agent)
    await options.setup?.(agentCtx, agent)
    return { agent, dispose: async () => undefined } as unknown as AgentHandle
  }
  ctx.provide('agents', { create, resume: create, get: (id: string) => agents.get(id) })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
  })
  const terminal = tty ? new ScrollingTerminal(80, 20) : undefined
  let output = ''
  const input = terminal?.input ?? Object.assign(new PassThrough(), { isTTY: false })
  const tui = new LocalTui({
    input,
    output: { isTTY: tty, write: (chunk: string) => { output += chunk; terminal?.output.write(chunk) } },
    width: () => 80, height: () => 20,
  }, 'm', false, 'dark', async () => {}, { deferInitialRender: tty })
  const runtime = new SessionRuntime(ctx, tui)
  return {
    ctx, runtime, tui, input, terminal,
    output: () => output,
    resetOutput: () => { output = '' },
    async dispose() {
      await runtime.dispose()
      tui.dispose()
      await ctx.fiber.dispose()
      for (const context of contexts) await context.fiber.dispose()
    },
  }
}

describe('session transcript boundaries', () => {
  it('starts a fresh session without claiming earlier output was retained', async () => {
    const f = await fixture()
    try {
      await f.runtime.start()
      expect(f.runtime.agent).toBeDefined()
      expect(f.output()).not.toContain('session opened')
    } finally { await f.dispose() }
  })

  it('refreshes the tool catalog in the same session without a document boundary', async () => {
    const f = await fixture()
    try {
      await f.runtime.start()
      f.runtime.agent!.session.append('user/message', {
        source: { kind: 'user' }, content: [{ type: 'text', text: 'existing prompt' }],
      }, { surfaceOp: 'append' })
      f.resetOutput()
      f.ctx.emit('tools/change')
      expect(f.output()).toContain('existing prompt')
      expect(f.output()).not.toContain('session opened')
    } finally { await f.dispose() }
  })

  it('does not replay frozen rows when tools or presets refresh a live TTY session', async () => {
    const f = await fixture(true)
    try {
      await f.runtime.start()
      expect(f.output()).toContain('omdsh v')
      const initialHistory = f.terminal!.scrollback()
      await f.runtime.changeAgentPreset(f.runtime.agent!, 'minimal')
      expect(f.terminal!.scrollback()).toEqual(initialHistory)
      f.runtime.agent!.session.append('user/message', {
        source: { kind: 'user' }, content: [{ type: 'text', text: Array.from({ length: 40 }, (_, index) => `catalog prompt ${index}`).join('\n') }],
      }, { surfaceOp: 'append' })
      const history = f.terminal!.scrollback()
      expect(history.join('\n')).toContain('catalog prompt 0')
      f.resetOutput()
      f.ctx.emit('tools/change')
      f.ctx.emit('tools/change')
      expect(f.terminal!.scrollback()).toEqual(history)
      expect(f.output()).not.toContain('catalog prompt 0')
      expect(f.output()).not.toContain('omdsh v')
      expect(f.output()).not.toContain('session opened')
      expect(f.output()).toContain('catalog prompt 39')
    } finally { await f.dispose() }
  })

  it.each([false, true].flatMap(inspection => (['success', 'error'] as const).map(kind => ({ inspection, kind }))))('reveals a plugin text result after scrolling back (inspection=$inspection, kind=$kind)', async ({ inspection, kind }) => {
    const f = await fixture(true)
    try {
      await f.ctx.plugin(CommandRuntime)
      registerCommands(f.ctx, [{
        name: 'probe', description: 'Show a command result',
        handler: () => kind === 'success'
          ? { kind: 'success', text: 'COMMAND_RESULT_VISIBLE\n\nResult complete.' }
          : { kind: 'error', text: 'COMMAND_RESULT_VISIBLE\n\nResult failed.' },
      }], 'command-result fixture')
      await f.runtime.start()
      const session = f.runtime.agent!.session
      session.append('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'explain the files' }] }, { surfaceOp: 'append' })
      session.append('turn/start', { turn: 1 })
      session.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [
        { type: 'reasoning', text: 'First thought.\n\nThought detail.' },
        { type: 'text', text: Array.from({ length: 40 }, (_, index) => `answer line ${index}`).join('\n\n') },
      ] } }, { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      f.tui.setStatus('idle')
      if (inspection) f.input.write('\x0f')
      f.input.write('\x1b[5~\x1b[5~')
      expect(f.terminal!.visible().join('\n')).not.toContain('answer line 39')
      const history = f.terminal!.scrollback()
      const mark = f.output().length
      const input = f.tui.readInput()
      f.input.write('/probe\r')
      const submission = await input
      expect(submission?.text).toBe('/probe')
      expect(await f.runtime.execute(submission!.text, new AbortController().signal)).toBe(true)
      expect(f.terminal!.visible().join('\n')).toContain('COMMAND_RESULT_VISIBLE')
      expect(f.output().slice(mark)).toContain('COMMAND_RESULT_VISIBLE')
      expect(f.terminal!.scrollback().slice(0, history.length)).toEqual(history)
      if (inspection) expect(f.output().slice(mark)).toContain('\x1b[?1000l')
    } finally { await f.dispose() }
  })

  it('restores inspection after /trajectory passes through input, the controller, and the command plugin', async () => {
    const f = await fixture(true)
    try {
      await f.ctx.plugin(CommandRuntime)
      f.ctx.provide('tui', f.tui)
      await f.ctx.plugin(commandTrajectory)
      await f.runtime.start()
      const session = f.runtime.agent!.session
      session.append('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'read the files' }] }, { surfaceOp: 'append' })
      session.append('turn/start', { turn: 1 })
      for (let step = 1; step <= 3; step += 1) {
        session.append('assistant/message', { turn: 1, step, message: { role: 'assistant', content: [{ type: 'reasoning', text: `Inspect step ${step}.` }] } }, { surfaceOp: 'append' })
        session.append('tool/call', { turn: 1, step, callId: `call-${step}`, name: 'read', arguments: `{"path":"src/step-${step}.ts"}` })
        session.append('tool/result', { message: { role: 'tool', toolCallId: `call-${step}`, content: [{ type: 'text', text: 'file content' }] } }, { surfaceOp: 'append' })
      }
      session.append('assistant/message', { turn: 1, step: 4, message: { role: 'assistant', content: [{ type: 'text', text: Array.from({ length: 30 }, (_, index) => `answer line ${index}`).join('\n\n') }] } }, { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      f.tui.setStatus('idle')
      f.input.write('\x0f\x1b[5~')
      const screen = f.terminal!.visible()
      const history = f.terminal!.scrollback()
      expect(screen.join('\n')).not.toContain('answer line 29')
      const mark = f.output().length
      const input = f.tui.readInput()
      f.input.write('/trajectory\r')
      const submission = await input
      expect(submission?.text).toBe('/trajectory')
      expect(await f.runtime.execute(submission!.text, new AbortController().signal)).toBe(true)
      expect(f.terminal!.visible().join('\n')).toContain('Trajectory')
      expect(f.output().slice(mark)).toContain('\x1b[?1000l')
      const restore = f.output().length
      f.input.write('\x1b[27u')
      expect(f.terminal!.visible()).toEqual(screen)
      expect(f.terminal!.scrollback()).toEqual(history)
      expect(f.output().slice(restore)).toContain('\x1b[?1000h')
      f.input.write('\x1b[<64;5;5M')
      expect(f.terminal!.visible()).not.toEqual(screen)
    } finally { await f.dispose() }
  })

  it('starts /new without a boundary when the previous session has no transcript content', async () => {
    const f = await fixture()
    try {
      await f.runtime.start()
      const previous = f.runtime.agent!
      f.tui.notice('Ready.')
      f.resetOutput()
      await f.runtime.newSession(previous)
      expect(f.runtime.agent!.id).not.toBe(previous.id)
      expect(f.output()).not.toContain('session opened')
    } finally { await f.dispose() }
  })

  it('separates /new from the previous session content', async () => {
    const f = await fixture()
    try {
      await f.runtime.start()
      const previous = f.runtime.agent!
      previous.session.append('user/message', {
        source: { kind: 'user' }, content: [{ type: 'text', text: 'earlier prompt' }],
      }, { surfaceOp: 'append' })
      f.resetOutput()
      await f.runtime.newSession(previous)
      expect(f.output()).toContain('session opened · earlier output retained')
    } finally { await f.dispose() }
  })

  it('keeps a boundary when a durable session is resumed', async () => {
    const f = await fixture()
    try {
      await f.runtime.start()
      const durable = f.ctx.sessions.create(SessionId('durable'))
      durable.append('user/message', {
        source: { kind: 'user' }, content: [{ type: 'text', text: 'resumed prompt' }],
      }, { surfaceOp: 'append' })
      f.resetOutput()
      await f.runtime.resumeSession(f.runtime.agent!, durable.id, new AbortController().signal)
      expect(f.output()).toContain('session opened · earlier output retained')
      expect(f.output()).toContain('resumed prompt')
      expect(f.output().indexOf('session opened')).toBeLessThan(f.output().indexOf('resumed prompt'))
    } finally { await f.dispose() }
  })

  it('changes the preset on a blank session without a document boundary', async () => {
    const f = await fixture()
    try {
      await f.runtime.start()
      f.resetOutput()
      expect(await f.runtime.changeAgentPreset(f.runtime.agent!, 'minimal')).toBe('minimal')
      expect(f.runtime.controls().agentPreset).toBe('minimal')
      expect(f.output()).not.toContain('session opened')
    } finally { await f.dispose() }
  })

  it('keeps a boundary when rewinding forks a new session', async () => {
    const f = await fixture()
    try {
      await f.runtime.start()
      const original = f.runtime.agent!
      original.session.append('turn/start', { turn: 1 })
      original.session.append('user/message', {
        source: { kind: 'user' }, content: [{ type: 'text', text: 'fork this request' }],
      }, { surfaceOp: 'append' })
      original.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      void f.tui.readline()
      const pending = f.runtime.rewindToTurn(new AbortController().signal)
      f.resetOutput()
      f.input.write('Turn 1\n')
      await pending
      expect(f.runtime.agent!.id).not.toBe(original.id)
      expect(f.output()).toContain('session opened · earlier output retained')
      expect(f.output()).toContain('The original session remains available in /resume.')
    } finally { await f.dispose() }
  })
})
