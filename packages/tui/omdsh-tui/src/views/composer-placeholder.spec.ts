import { describe, expect, it } from 'vitest'
import { stripAnsi } from '../chrome/width.ts'
import { initialTranscript } from './event-views.ts'
import { renderView } from './transcript-render.ts'

function screen(input: string, status: 'idle' | 'running' = 'idle', modelReady?: boolean): string {
  return renderView({ ...initialTranscript(), status }, {
    width: 100,
    height: 40,
    colors: false,
    model: 'deepseek-flash',
    input,
    inputCursor: input.length,
    ...(modelReady === undefined ? {} : { modelReady }),
  }).lines.map(stripAnsi).join('\n')
}

describe('composer empty state', () => {
  it('offers a quiet placeholder while idle and empty', () => {
    expect(screen('')).toContain('Ask anything · / commands · @ files')
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
  })
})
