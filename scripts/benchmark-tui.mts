import { performance } from 'node:perf_hooks'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  replayEvents,
  renderView,
} from '../packages/tui/omdsh-tui/src/event-views.ts'
import { sessionStats } from '../packages/tui/omdsh-tui/src/session-controller.ts'

const RUNS = 7

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function benchmark(label: string, run: () => void): void {
  run()
  const samples: number[] = []
  for (let index = 0; index < RUNS; index += 1) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
  console.log(`${label.padEnd(42)} ${median(samples).toFixed(2).padStart(9)} ms`)
}

function conversationEvents(turns: number): SessionEvent[] {
  const events: SessionEvent[] = []
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push({
      seq: events.length + 1,
      time: events.length + 1,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `question ${turn}` }] },
    } as unknown as SessionEvent)
    events.push({
      seq: events.length + 1,
      time: events.length + 1,
      type: 'assistant/message',
      data: {
        turn,
        step: 1,
        message: { content: [{ type: 'text', text: `answer ${turn}` }] },
      },
    } as unknown as SessionEvent)
  }
  return events
}

function toolEvents(count: number): SessionEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    time: index + 1,
    type: 'tool/call',
    data: {
      turn: 1,
      step: index + 1,
      callId: `call-${index}`,
      name: 'bash',
      arguments: { command: 'true' },
    },
  } as unknown as SessionEvent))
}

const conversation = conversationEvents(10_000)
const tools = toolEvents(10_000)
const projectedEvents: SessionEvent[] = []
const projection = {
  sessionStats: {
    turns: 1,
    steps: 1,
    llmMs: 1,
    toolMs: 0,
    ttftMs: 1,
    ttftSteps: 1,
    decodeMs: 1,
    decodeTokens: 1,
  },
  tokenUsage: {
    uncachedInputTokens: 1,
    cacheReadTokens: 1,
    cacheWriteTokens: 0,
    outputTokens: 1,
  },
  contextPressure: {
    projectedTokens: 3,
    contextWindow: 1_000_000,
  },
}

console.log('oh-my-dsh TUI microbenchmarks')
console.log(`Node ${process.version} · ${process.platform}/${process.arch} · median of ${RUNS} measured runs`)
console.log('')

benchmark('Resume 10,000 conversation turns', () => {
  replayEvents(conversation)
})

benchmark('Resume 10,000 tool calls', () => {
  replayEvents(tools)
})

benchmark('Apply 10,000 projected stats updates', () => {
  projectedEvents.length = 0
  for (let index = 0; index < 10_000; index += 1) {
    projectedEvents.push({
      seq: index + 1,
      time: index + 1,
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'x' } },
    } as unknown as SessionEvent)
    sessionStats(projectedEvents, 1_000_000, projection)
  }
})

const largeTranscript = replayEvents(conversation.slice(0, 10_000))
benchmark('Render 200 cached 5,000-turn frames', () => {
  for (let index = 0; index < 200; index += 1) {
    renderView(largeTranscript, {
      width: 160,
      height: 50,
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      input: '',
      inputCursor: 0,
      colors: false,
      pwd: '~/project',
      sessionStats: {
        turns: 5_000,
        steps: 5_000,
        inputTokens: 100_000,
        outputTokens: 10_000,
        cacheReadTokens: 90_000,
        cacheWriteTokens: 0,
        llmMs: 1_000,
        toolMs: 100,
        ttftMs: 100,
        ttftSteps: 100,
        decodeMs: 900,
        decodeTokens: 10_000,
        elapsedMs: index,
      },
    })
  }
})
