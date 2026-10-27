import { describe, expect, it } from 'vitest'
import {
  TerminalNotificationController,
  terminalNotificationSequence,
} from './terminal-notifications.ts'

describe('TerminalNotificationController', () => {
  it('is disabled by default', () => {
    const notifications = new TerminalNotificationController()
    notifications.event({ type: 'turn/start', time: 1_000 })
    expect(notifications.event({ type: 'turn/end', time: 61_000, reason: 'complete' })).toBeUndefined()
    expect(notifications.humanPrompt()).toBeUndefined()
  })

  it('notifies only after the fixed long turn threshold', () => {
    const notifications = new TerminalNotificationController()
    notifications.configure({ policy: 'unfocused', thresholdMs: 30_000 })
    notifications.event({ type: 'turn/start', time: 1_000 })
    expect(notifications.event({ type: 'turn/end', time: 30_999 })).toBeUndefined()
    notifications.event({ type: 'turn/start', time: 40_000 })
    expect(notifications.event({ type: 'turn/end', time: 70_000, reason: 'complete' })).toEqual({
      title: 'omdsh finished',
      body: 'Turn completed in 30s',
    })
  })

  it('reports every finished turn in always mode', () => {
    const notifications = new TerminalNotificationController()
    notifications.configure({ policy: 'always', thresholdMs: 30_000 })
    notifications.event({ type: 'turn/start', time: 1_000 })
    expect(notifications.event({ type: 'turn/end', time: 1_500, reason: 'complete' })).toEqual({
      title: 'omdsh finished',
      body: 'Turn completed in 1s',
    })
  })

  it.each([
    ['max-tokens', 'Output token limit reached after 1s'],
    ['blocked', 'Turn was blocked after 1s'],
    ['interrupted', 'Session was interrupted after 1s'],
    ['aborted', 'Turn was interrupted after 1s'],
    ['error', 'Turn failed after 1s'],
  ])('describes the %s ending reason in plain language', (reason, body) => {
    const notifications = new TerminalNotificationController()
    notifications.configure({ policy: 'always', thresholdMs: 30_000 })
    notifications.event({ type: 'turn/start', time: 1_000 })
    expect(notifications.event({ type: 'turn/end', time: 2_000, reason })).toEqual({
      title: 'omdsh needs attention',
      body,
    })
  })

  it('always reports human prompts when enabled', () => {
    const notifications = new TerminalNotificationController()
    notifications.configure({ policy: 'always', thresholdMs: 30_000 })
    expect(notifications.humanPrompt('Approve tool execution')).toEqual({
      title: 'omdsh needs attention',
      body: 'Approve tool execution',
    })
  })
})

describe('terminalNotificationSequence', () => {
  it('sanitizes terminal control characters and emits no printable frame rows', () => {
    expect(terminalNotificationSequence({ title: 'omdsh\nfinished', body: 'done\x1b]2;bad\x07' })).toBe(
      '\x1b]9;omdsh finished: done ]2;bad\x07',
    )
  })
})

describe('notification queue', () => {
  it('retains an attention request over later completion, then drains only once', async () => {
    const { TerminalNotificationQueue } = await import('./terminal-notifications.ts')
    const queue = new TerminalNotificationQueue()
    const question = { title: 'omdsh needs attention', body: 'Approve execution' }
    queue.offer({ title: 'omdsh finished', body: 'Done' })
    queue.offer(question)
    queue.offer({ title: 'omdsh finished', body: 'Another done' })
    // The queue coalesces; delivery is the caller's policy decision.
    expect(queue.take()).toEqual(question)
    expect(queue.take()).toBeUndefined()
  })

  it('drains once and can clear a pending event', async () => {
    const { TerminalNotificationQueue } = await import('./terminal-notifications.ts')
    const queue = new TerminalNotificationQueue(), note = { title: 'omdsh finished', body: 'Done' }
    queue.offer(note)
    expect(queue.take()).toEqual(note)
    expect(queue.take()).toBeUndefined()
    queue.offer(note)
    queue.clear()
    expect(queue.take()).toBeUndefined()
  })
})
