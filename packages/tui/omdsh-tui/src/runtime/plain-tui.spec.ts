import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import type { TuiPrompt } from '../definition.ts'
import type { Block } from '../views/event-views.ts'
import { PlainTui } from './plain-tui.ts'
import { LocalTui, type TerminalLike } from './provider-local.ts'

class FakeTerm implements TerminalLike {
  captured = ''
  output = {
    isTTY: false,
    write: (chunk: string): void => { this.captured += chunk },
  }
  input = Object.assign(new PassThrough(), { isTTY: false })
  width(): number { return 60 }
  height(): number { return 24 }
}

function notice(text: string): Block {
  return { kind: 'notice', level: 'info', text }
}

function make(blocks: readonly Block[] = [], prompt?: TuiPrompt) {
  const term = new FakeTerm()
  const answers: (string | null)[] = []
  const plain = new PlainTui({
    term,
    blocks: () => blocks,
    promptRequest: () => prompt,
    finishPrompt: answer => { answers.push(answer) },
  })
  return { term, plain, answers }
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('PlainTui.readline', () => {
  it('uses the stored math preference without changing the original reply', () => {
    const blocks: Block[] = [{ kind: 'assistant', turn: 1, step: 1, text: '$x^2$', reasoning: '' }]
    const term = new FakeTerm()
    const plain = new PlainTui({ term, blocks: () => blocks, mathMode: () => 'source', promptRequest: () => undefined, finishPrompt: () => {} })
    plain.print()
    expect(term.captured).toContain('$x^2$')
    expect(blocks[0]).toMatchObject({ text: '$x^2$' })
    plain.dispose()
  })
  it('uses the stored Mermaid preference without changing source text', () => {
    const source = '```mermaid\ngraph TD\nA[First] --> B[Second]\n```'
    const blocks: Block[] = [{ kind: 'assistant', turn: 1, step: 1, text: source, reasoning: '' }]
    const term = new FakeTerm()
    const plain = new PlainTui({ term, blocks: () => blocks, mermaidMode: () => 'source', promptRequest: () => undefined, finishPrompt: () => {} })
    plain.print()
    expect(term.captured).toContain('A[First] --> B[Second]')
    expect(blocks[0]).toMatchObject({ text: source })
    plain.dispose()
  })

  it('resolves each pending read with the next queued line', async () => {
    const { term, plain } = make()
    const first = plain.readline()
    term.input.write('one\n')
    expect(await first).toEqual({ text: 'one', images: [] })
    const second = plain.readline()
    term.input.write('two\n')
    expect(await second).toEqual({ text: 'two', images: [] })
  })

  it('queues a line that arrives before the next read is pending', async () => {
    const { term, plain } = make()
    const first = plain.readline()
    term.input.write('one\nearly\n')
    expect(await first).toEqual({ text: 'one', images: [] })
    const second = plain.readline()
    expect(await second).toEqual({ text: 'early', images: [] })
  })

  it('resolves null on EOF once the queue has drained', async () => {
    const { term, plain } = make()
    const first = plain.readline()
    term.input.write('one\n')
    expect(await first).toEqual({ text: 'one', images: [] })
    const second = plain.readline()
    term.input.end()
    expect(await second).toBeNull()
    const third = plain.readline()
    expect(await third).toBeNull()
  })

  it('resolves null when the abort signal fires', async () => {
    const { plain } = make()
    const controller = new AbortController()
    const read = plain.readline(controller.signal)
    controller.abort()
    expect(await read).toBeNull()
  })
})

describe('PlainTui explicit question skips', () => {
  it('distinguishes a blank submitted answer from EOF', async () => {
    const { term, plain, answers } = make([], { title: 'Question', question: 'Choose', skippable: true })
    const read = plain.readline()
    term.input.write('\n')
    await tick()
    expect(answers).toEqual([''])
    term.input.end()
    expect(await read).toBeNull()
    expect(answers).toEqual(['', null])
    plain.dispose()
  })
})

describe('PlainTui prompt routing', () => {
  const request: TuiPrompt = {
    title: 'Pick',
    question: 'Choose one',
    options: [
      { label: 'Alpha', value: 'a' },
      { label: 'Beta', value: 'b' },
    ],
    allowCustom: false,
  }

  it('answers a fixed-choice prompt by number or label, not the queue', async () => {
    const { term, plain, answers } = make([], request)
    void plain.readline()
    term.input.write('2\n')
    await tick()
    term.input.write('Alpha\n')
    await tick()
    expect(answers).toEqual(['b', 'a'])
  })

  it('passes a custom prompt answer through verbatim', async () => {
    const { term, plain, answers } = make([], { title: 'Ask', question: 'Say' })
    void plain.readline()
    term.input.write('free form\n')
    await tick()
    expect(answers).toEqual(['free form'])
  })

  it('cancels the prompt on empty input and on EOF', async () => {
    const { term, plain, answers } = make([], request)
    void plain.readline()
    term.input.write('\n')
    await tick()
    term.input.end()
    await tick()
    expect(answers).toEqual([null, null])
  })
})

describe('PlainTui.print', () => {
  it('prints only blocks appended since the last flush', () => {
    const blocks: Block[] = [notice('first')]
    const { term, plain } = make(blocks)
    plain.print()
    expect(term.captured).toContain('first')
    const afterFirst = term.captured
    plain.print()
    expect(term.captured).toBe(afterFirst)
    blocks.push(notice('second'))
    plain.print()
    expect(term.captured).toContain('second')
    expect(term.captured.indexOf('first')).toBeLessThan(term.captured.indexOf('second'))
  })

  it('reprints everything after resetPrinted', () => {
    const { term, plain } = make([notice('again')])
    plain.print()
    const once = term.captured
    plain.resetPrinted()
    plain.print()
    expect(term.captured).toBe(once + once)
  })
})

it('reads piped choices before composer input and buffers successive lines through EOF', async () => {
  const input = new PassThrough()
  const tui = new LocalTui({ input, width: () => 80, height: () => 24, output: { write() {} } }, 'm', false)
  try {
    const first = tui.prompt({
      title: 'Choose levels', question: '', multiSelect: true, allowCustom: false,
      options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }],
    })
    input.end('1, 2\n2\nnext message\n')
    expect(await first).toBe('low, high')
    expect(await tui.prompt({
      title: 'Disabled', question: '', allowCustom: false,
      options: [{ label: 'Allowed' }, { label: 'Disabled', disabled: true }],
    })).toBeNull()
    expect(await tui.readline()).toBe('next message')
    expect(await tui.readline()).toBeNull()
  } finally { tui.dispose() }
})

it('resumes a pending read from the closed pipe when progress finishes', async () => {
  const term = new FakeTerm()
  const tui = new LocalTui(term, 'm', false)
  const done = new AbortController()
  try {
    const progress = tui.prompt({ presentation: 'progress', title: 'Working', question: '', signal: done.signal })
    const read = tui.readInput()
    term.input.end('piped message\n')
    await tick()
    done.abort()
    expect(await progress).toBeNull()
    expect(await read).toMatchObject({ text: 'piped message' })
    expect(await tui.readInput()).toBeNull()
  } finally { tui.dispose() }
})

it('settles unanswered progress at EOF without a buffered line', async () => {
  const term = new FakeTerm()
  const tui = new LocalTui(term, 'm', false)
  try {
    const progress = tui.prompt({ presentation: 'progress', title: 'Working', question: '' })
    term.input.end()
    expect(await progress).toBeNull()
  } finally { tui.dispose() }
})

it('keeps numbered choices and custom text together in a structured answer', async () => {
  const term = new FakeTerm()
  const tui = new LocalTui(term, 'm', false)
  try {
    const prompt = tui.prompt({ title: 'Pick', question: '', answerFormat: 'json', multiSelect: true, allowCustom: true,
      options: [{ label: 'First' }, { label: 'Second', value: 'b' }] })
    term.input.end('2, keep this, too\n')
    expect(JSON.parse((await prompt)!)).toEqual({ selected: ['b'], custom: 'keep this, too' })
  } finally { tui.dispose() }
})
