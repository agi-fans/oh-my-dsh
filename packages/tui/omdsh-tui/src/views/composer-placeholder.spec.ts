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
    // `/ commands` and `@ files` live on the header's hint line. Repeating them
    // in the composer would cost every frame, since this text is redrawn while
    // the header's scrolls into history.
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
  })
})
