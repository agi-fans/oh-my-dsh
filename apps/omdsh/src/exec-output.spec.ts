import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { ExecOutput } from './exec-output.ts'

describe('exec NDJSON contract', () => {
  it('emits ordered versioned records and one final result with escaped control bytes', async () => {
    const stream = new PassThrough()
    let captured = ''
    stream.on('data', chunk => { captured += chunk.toString() })
    const writer = new ExecOutput(stream)
    writer.emit('assistant.delta', { text: '中文 🐳\n\x1b[31m' })
    writer.emit('tool.started', { name: 'read', callId: 'one' })
    await writer.finish({ outcome: 'completed', exitCode: 0, sessionId: 'session-one', text: 'Done.' })
    const records = captured.trim().split('\n').map(line => JSON.parse(line))
    expect(records.map(record => [record.schemaVersion, record.sequence, record.type])).toEqual([[1, 1, 'assistant.delta'], [1, 2, 'tool.started'], [1, 3, 'run.finished']])
    expect(records[0].data.text).toBe('中文 🐳\n\x1b[31m')
    expect(captured).not.toContain('\x1b')
    expect(records[2].data).toEqual({ outcome: 'completed', exitCode: 0, sessionId: 'session-one', text: 'Done.' })
    expect(() => writer.emit('late', {})).toThrow('already finished')
    await expect(writer.finish({ outcome: 'failed', exitCode: 1, text: '' })).rejects.toThrow('already finished')
  })

  it('does not lose records when the destination applies backpressure', async () => {
    const stream = new PassThrough({ highWaterMark: 1 })
    const writer = new ExecOutput(stream)
    writer.emit('first', { value: 1 })
    writer.emit('second', { value: 2 })
    const finished = writer.finish({ outcome: 'completed', exitCode: 0, text: 'end' })
    const settled = vi.fn()
    void finished.then(settled)
    await new Promise(resolve => setImmediate(resolve))
    expect(settled).not.toHaveBeenCalled()
    let captured = ''
    stream.on('data', chunk => { captured += chunk.toString() })
    await finished
    expect(captured.trim().split('\n').map(line => JSON.parse(line).type)).toEqual(['first', 'second', 'run.finished'])
  })

  it('reports a broken output stream once instead of claiming a final result was delivered', async () => {
    const failure = vi.fn()
    const writer = new ExecOutput({ write: () => { throw new Error('EPIPE') }, once: vi.fn(), off: vi.fn() } as never, failure)
    writer.emit('first', {})
    writer.emit('second', {})
    await expect(writer.finish({ outcome: 'completed', exitCode: 0, text: '' })).rejects.toThrow('EPIPE')
    expect(failure).toHaveBeenCalledOnce()
  })

  it('fails a stopped consumer at the documented queue bound without leaving a pending flush', async () => {
    const stream = new PassThrough({ highWaterMark: 1 })
    const failure = vi.fn()
    const writer = new ExecOutput(stream, failure)
    writer.emit('first', { text: 'waiting for the consumer' })
    await new Promise(resolve => setImmediate(resolve))
    writer.emit('oversized', { text: 'x'.repeat(32 * 1024 * 1024) })
    await expect(writer.flush()).rejects.toThrow('32 MiB')
    expect(failure).toHaveBeenCalledOnce()
    stream.destroy()
  })
})
