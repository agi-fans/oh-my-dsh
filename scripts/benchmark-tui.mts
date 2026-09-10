import { performance } from 'node:perf_hooks'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { MainScreenRenderer } from '../packages/tui/omdsh-tui/src/chrome/main-screen-renderer.ts'
import {
  initialTranscript,
  replayEvents,
  renderView,
  type TranscriptState,
} from '../packages/tui/omdsh-tui/src/views/event-views.ts'
import { sessionStats } from '../packages/tui/omdsh-tui/src/session/session-controller.ts'
import { streamingAssistantUnits } from '../packages/tui/omdsh-tui/src/views/streaming-reveal.ts'
import {
  applyTrajectoryEvent,
  createTrajectory,
  trajectorySearch,
  type TrajectoryState,
} from '../packages/tui/omdsh-tui/src/views/trajectory.ts'
import type { KeyEvent } from '../packages/tui/omdsh-tui/src/input/keys.ts'

const RUNS = 7

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function benchmark(label: string, run: () => void): number {
  run()
  const samples: number[] = []
  for (let index = 0; index < RUNS; index += 1) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
  const value = median(samples)
  console.log(`${label.padEnd(42)} ${value.toFixed(2).padStart(9)} ms`)
  return value
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
        stream: [{ type: 'text-chunks', time0: events.length + 1, index: 0, dt: [], texts: ['answer'] }],
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
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: 'x' }] },
        stream: [{ type: 'text-chunks', time0: index + 1, index: 0, dt: [], texts: ['x'] }],
        usage: { inputTokens: 10, outputTokens: 1 },
      },
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

benchmark('Render 200 streaming 5,000-turn frames', () => {
  for (let index = 0; index < 200; index += 1) {
    const liveBlock = {
      kind: 'assistant',
      reasoning: '',
      text: `streaming ${index}`,
      streaming: true,
    } as unknown as (typeof largeTranscript.blocks)[number]
    renderView({
      ...largeTranscript,
      status: 'running',
      blocks: [...largeTranscript.blocks, liveBlock],
    }, {
      width: 160,
      height: 50,
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      input: '',
      inputCursor: 0,
      colors: false,
      pwd: '~/project',
    })
  }
})

let terminalWrites = 0
let terminalBytes = 0
const terminalRenderer = new MainScreenRenderer(
  {
    write(chunk) {
      terminalWrites += 1
      terminalBytes += Buffer.byteLength(chunk)
    },
  },
  { width: 160, height: 50, synchronized: false },
)
terminalRenderer.render(renderView(largeTranscript, {
  width: 160,
  height: 50,
  model: 'deepseek-v4-pro',
  reasoningEffort: 'max',
  input: '',
  inputCursor: 0,
  colors: false,
  pwd: '~/project',
}))
terminalWrites = 0
terminalBytes = 0
for (let index = 0; index < 200; index += 1) {
  const liveBlock = {
    kind: 'assistant',
    reasoning: '',
    text: `streaming ${index}`,
    streaming: true,
  } as unknown as (typeof largeTranscript.blocks)[number]
  terminalRenderer.render(renderView({
    ...largeTranscript,
    status: 'running',
    blocks: [...largeTranscript.blocks, liveBlock],
  }, {
    width: 160,
    height: 50,
    model: 'deepseek-v4-pro',
    reasoningEffort: 'max',
    input: '',
    inputCursor: 0,
    colors: false,
    pwd: '~/project',
  }))
}
console.log(`${'Terminal output for 200 streaming frames'.padEnd(42)} ${String(terminalWrites).padStart(6)} writes · ${(terminalBytes / 1024).toFixed(2)} KiB`)

// --- Transcript search navigation ---
const searchState = createTrajectory(conversation.slice(0, 10_000))
const searchOpen: KeyEvent = { type: 'text', value: '/' }
const searchTyped = Array.from('question', char => ({ type: 'text' as const, value: char }))

function searchPreparedState(): TrajectoryState {
  let state = searchState
  state = (applyTrajectoryEvent(state, searchOpen) as { state: TrajectoryState }).state
  for (const event of searchTyped) state = (applyTrajectoryEvent(state, event) as { state: TrajectoryState }).state
  return state
}
const searchPrepared = searchPreparedState()
const searchMatchCount = trajectorySearch(searchPrepared).matches.length

// Navigation reuses one derived match list per ledger version, so this measures
// cache hits rather than a rescan. Before that cache it was 5139 ms, because
// every Ctrl+N derived the full match list twice and each rendered frame twice
// more (18 ms per derivation over 10,000 records).
benchmark('Search and navigate a 10,000-record ledger (200 frames)', () => {
  let state = searchPrepared
  for (let index = 0; index < 200; index += 1) {
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'ctrl+n' }) as { state: TrajectoryState }).state
  }
})
console.log(`${'Search matches over 10,000 records'.padEnd(42)} ${String(searchMatchCount).padStart(9)} matches`)
console.log(`${'Search navigation selection'.padEnd(42)} ${String((applyTrajectoryEvent(searchPrepared, { type: 'key', id: 'ctrl+n' }) as { state: TrajectoryState }).state.selectedId).padStart(9)}`)

benchmark('Search text cache over 10,000 records (cold vs warm)', () => {
  const state = createTrajectory(conversation.slice(0, 10_000))
  let count = 0
  for (const record of state.ledger.records) count += state.ledger.searchText(record).length
  for (const record of state.ledger.records) count += state.ledger.searchText(record).length
  if (count === 0) throw new Error('unreachable')
})

// --- Streaming reveal ---
// Counting an answer that only grows must cost the appended text, not the whole
// answer. Re-segmenting the full text per tick measured 2.9 ms at this size.
const revealAnswer = '中文 emoji 🚀 reasoning '.repeat(5500)
const revealTicks = 20
const revealState = (text: string): TranscriptState => ({
  ...initialTranscript(),
  status: 'running',
  blocks: [{ kind: 'assistant', turn: 1, step: 1, reasoning: '', text, streaming: true }],
})
let revealUnits = 0
const revealMedian = benchmark('Count 20 appends onto a 121k-char answer', () => {
  let text = revealAnswer
  let units = 0
  for (let tick = 0; tick < revealTicks; tick += 1) {
    text += `tail ${tick} arriving `
    units += streamingAssistantUnits(revealState(text))
  }
  revealUnits = units / revealTicks
})
console.log(`${'Per appended frame'.padEnd(42)} ${(revealMedian / revealTicks).toFixed(3).padStart(9)} ms`)
console.log(`${'Revealed units per frame'.padEnd(42)} ${revealUnits.toFixed(0).padStart(9)} units`)
