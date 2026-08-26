import { describe, expect, it } from 'vitest'
import { TerminalNotificationController, terminalNotificationSequence } from './terminal-notifications.ts'

describe('TerminalNotificationController', () => {
  it('is disabled by default', () => {
    const notifications = new TerminalNotificationController()
    notifications.event({ type: 'turn/start', time: 1_000 })
    expect(notifications.event({ type: 'turn/end', time: 61_000, reason: 'complete' })).toBeUndefined()
    expect(notifications.humanPrompt()).toBeUndefined()
  })

  it('notifies only after the configured long-running threshold', () => {
    const notifications = new TerminalNotificationController()
    notifications.configure({ policy: 'long-running', thresholdMs: 30_000 })
    notifications.event({ type: 'turn/start', time: 1_000 })
    expect(notifications.event({ type: 'turn/end', time: 30_999 })).toBeUndefined()
    notifications.event({ type: 'turn/start', time: 40_000 })
    expect(notifications.event({ type: 'turn/end', time: 70_000, reason: 'complete' })).toEqual({
      title: 'omdsh finished',
      body: 'Turn completed in 30s',
    })
  })

  it('always reports failures and human prompts when enabled', () => {
    const notifications = new TerminalNotificationController()
    notifications.configure({ policy: 'always', thresholdMs: 30_000 })
    notifications.event({ type: 'turn/start', time: 1_000 })
    expect(notifications.event({ type: 'turn/end', time: 2_000, reason: 'error' })).toEqual({
      title: 'omdsh needs attention',
      body: 'Turn error after 1s',
    })
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
