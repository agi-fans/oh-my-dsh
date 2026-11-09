import { describe, expect, it } from 'vitest'
import { stripAnsi } from '../chrome/width.ts'
import { initialTranscript } from './event-views.ts'
import { renderView } from './transcript-render.ts'
import type { ViewOptions } from './transcript-render.ts'

function screen(input: string, status: 'idle' | 'running' = 'idle', modelReady?: boolean, options: Partial<ViewOptions> = {}): string {
  return renderView({ ...initialTranscript(), status }, {
    width: 100,
    height: 40,
    colors: false,
    model: 'deepseek-flash',
    input,
    inputCursor: input.length,
    steerKey: 'Alt+S',
    queueKey: 'Alt+Enter',
    ...(modelReady === undefined ? {} : { modelReady }),
    ...options,
  }).lines.map(stripAnsi).join('\n')
}

/** The composer's own rows, from its top border to its bottom border. */
function composerRows(frame: string): string {
  const lines = frame.split('\n')
  const start = lines.findLastIndex(line => line.includes('🐳'))
  if (start < 0) return ''
  const end = lines.findIndex((line, at) => at > start && line.startsWith('╰'))
  return lines.slice(start, end < 0 ? undefined : end + 1).join('\n')
}

describe('composer empty state', () => {
  it('offers a bare placeholder while idle and empty', () => {
    // Keep the ready composer focused on entering a task.
    const composer = composerRows(screen(''))
    expect(composer).toContain('Ask anything')
    expect(composer).not.toContain('/ commands')
    expect(composer).not.toContain('@ files')
  })

  it('drops the placeholder once the draft has content', () => {
    expect(screen('explain this file')).not.toContain('Ask anything')
  })

  it('points an unconnected session at /login', () => {
    expect(screen('', 'idle', false)).toContain('Run /login to connect a model')
    expect(screen('', 'idle', false)).not.toContain('Ask anything')
  })

  it('keeps the running hint instead of the idle placeholder', () => {
    const running = screen('', 'running')
    expect(running).not.toContain('Ask anything')
    expect(running).toContain('Enter: Queue · Alt+S: Steer')
  })

  it.each(['queue', 'steer'] as const)('teaches the effective alternate-send key with %s preference', busyEnter => {
    const hint = busyEnter === 'queue' ? 'Enter: Queue · F6: Steer' : 'Enter: Steer · F6: Queue'
    expect(screen('', 'running', true, { busyEnter, alternateSendKey: 'F6' })).toContain(hint)
    expect(screen('', 'running', true, { busyEnter, alternateSendKey: 'F6',
      inspected: { id: 'child', label: 'Child', phase: 'running', writable: true } })).toContain(hint)
  })

  it.each([false, true].flatMap(colors => (['queue', 'steer'] as const).flatMap(busyEnter =>
    [false, true].map(child => ({ colors, busyEnter, child }))),
  ))('shows busy hints only for empty drafts (colors=$colors, enter=$busyEnter, child=$child)', ({ colors, busyEnter, child }) => {
    const options: Partial<ViewOptions> = {
      colors, busyEnter,
      ...(child ? { inspected: { id: 'child', label: 'Child', phase: 'running', writable: true } } : {}),
    }
    const hint = busyEnter === 'queue' ? 'Enter: Queue · Alt+S: Steer' : 'Enter: Steer · Alt+Enter: Queue'
    expect(screen('', 'running', true, options)).toContain(hint)
    for (const input of ['继续处理', '继续处理\n', '第一行\n第二行\n', ' ']) {
      const draft = screen(input, 'running', true, options)
      expect(draft).not.toContain('Enter: Queue')
      expect(draft).not.toContain('Enter: Steer')
    }
    expect(screen('', 'running', true, { ...options, inputImages: 1 })).not.toContain(hint)
    expect(screen('', 'running', true, options)).toContain(hint)
  })

  it('hides the writable child send placeholder while drafting', () => {
    const inspected = { id: 'child', label: 'Child', phase: 'running', writable: true } as const
    expect(screen('', 'idle', true, { inspected })).toContain('Enter to send')
    expect(screen('Follow up\n', 'idle', true, { inspected })).not.toContain('Enter to send')
  })
})
