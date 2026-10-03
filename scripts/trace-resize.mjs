// Step-by-step trace of what the terminal does during a resize, against a real
// implementation rather than the renderer's own fake.
//
// The renderer is driven exactly as the app drives it, and its **real output** is fed
// to `@xterm/headless` so each step can be read from the terminal's own buffers. Two
// readings are taken per step: right after the terminal resizes and before the renderer
// paints, and after that paint's output has been parsed.
//
// Run: node scripts/trace-resize.mjs
//
// The probe lives in the repository because the calibration is evidence, not a
// throwaway: the contract in docs/design/tui-rendering.md is not enough to
// rebuild a sequence. It reads @xterm/headless out of the pnpm store because the
// package is a transitive dependency of the terminal plugin, not a declared one — if
// this probe becomes a permanent regression it belongs in the test package's
// devDependencies instead.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The published headless build this project already resolves. */
function loadHeadless() {
  const store = join(root, 'node_modules', '.pnpm')
  const entry = readdirSync(store).find(name => name.startsWith('@xterm+headless@'))
  if (entry === undefined) throw new Error('@xterm/headless is not installed')
  const path = join(store, entry, 'node_modules', '@xterm', 'headless')
  return require(path)
}

const { Terminal } = loadHeadless()

/** One buffer, row by row, with the wrap flag kept per row. */
function readBuffer(buffer, rows) {
  const lines = []
  for (let i = 0; i < buffer.length; i += 1) {
    const line = buffer.getLine(i)
    lines.push({
      text: line.translateToString(true).replace(/\s+$/u, ''),
      wrapped: line.isWrapped,
    })
  }
  return {
    length: buffer.length,
    baseY: buffer.baseY,
    cursorRow: buffer.cursorY,
    cursorColumn: buffer.cursorX,
    history: lines.slice(0, buffer.baseY),
    viewport: lines.slice(buffer.baseY, buffer.baseY + rows),
  }
}

/** Both buffers and whichever one is showing — the whole reading, not a summary. */
function read(term) {
  return {
    rows: term.rows,
    cols: term.cols,
    active: term.buffer.active.type,
    normal: readBuffer(term.buffer.normal, term.rows),
    alternate: readBuffer(term.buffer.alternate, term.rows),
  }
}

const write = (term, data) => new Promise(resolve => term.write(data, resolve))

/**
 * Record the frame a render call is made with, then make it. The **whole** frame is kept
 * — every line, not a first/last summary — because the trace is meant to be checkable
 * against the terminal rather than taken on trust.
 */
function capture(frame, keep, run) {
  const { lines, ...rest } = frame
  keep({ lines: [...(lines ?? [])], ...rest })
  return run()
}

/** A renderer driven through its public entry point, capturing every byte it emits. */
async function drive({ width, height, overlays, steps }) {
  const chunks = []
  const renderer = new (await import('../packages/tui/omdsh-tui/src/chrome/main-screen-renderer.ts'))
    .MainScreenRenderer({ write: chunk => chunks.push(chunk) }, { width, height, alternateScreenOverlays: overlays })
  const term = new Terminal({ cols: width, rows: height, scrollback: 2000, allowProposedApi: true })
  const trace = []
  for (const step of steps) {
    const before = chunks.length
    const beforeEvent = read(term)
    // The frame the renderer is actually given, captured at the call rather than taken
    // from the step description: a hand-written summary of it cannot be checked.
    let called = null
    await step.run({
      resizeTerminal: (cols, rows) => term.resize(cols, rows),
      resizeRenderer: (cols, rows) => renderer.resize(cols, rows),
      render: frame => capture(frame, value => { called = value }, () => renderer.render(frame)),
    })
    // Read the **original** terminal here: every write above has been awaited, so this
    // is exactly the state the event left, before this step's output is parsed. Replaying
    // the old bytes into a fresh terminal of the new size would not be the same thing —
    // the resize has to happen to the buffer that was written at the old size.
    const afterEvent = read(term)
    for (const chunk of chunks.slice(before)) await write(term, chunk)
    trace.push({
      event: step.event,
      frame: called,
      resize: step.resize,
      emitted: chunks.slice(before),
      beforeEvent,
      afterEvent,
      afterOutput: read(term),
    })
  }
  return trace
}

const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
const doc = (ls, liveStart) => ({
  lines: ls,
  liveStart,
  documentRows: { documentStart: 0, documentEnd: ls.length, frameStart: 0 },
})
const overlay = n => ({
  lines: Array.from({ length: n }, (_, i) => `ov-${i}`),
  liveStart: 0,
  transientSurface: 'overlay',
})

const visible = await drive({
  width: 80,
  height: 10,
  overlays: false,
  steps: [
    { event: 'render', frame: { liveStart: 8 }, run: t => t.render(doc(lines, 8)) },
    { event: 'terminal.resize', resize: [80, 8], run: t => t.resizeTerminal(80, 8) },
    { event: 'renderer.resize', run: t => t.resizeRenderer(80, 8) },
    { event: 'render', frame: { liveStart: 8 }, run: t => t.render(doc(lines, 8)) },
    { event: 'terminal.resize', resize: [100, 8], run: t => t.resizeTerminal(100, 8) },
    { event: 'renderer.resize', run: t => t.resizeRenderer(100, 8) },
    { event: 'render', frame: { liveStart: 8 }, run: t => t.render(doc(lines, 8)) },
  ],
})

const alt = await drive({
  width: 80,
  height: 10,
  overlays: true,
  steps: [
    { event: 'render', frame: { liveStart: 8 }, run: t => t.render(doc(lines, 8)) },
    { event: 'render', frame: { transientSurface: 'overlay' }, run: t => t.render(overlay(3)) },
    { event: 'terminal.resize', resize: [80, 8], run: t => t.resizeTerminal(80, 8) },
    { event: 'renderer.resize', run: t => t.resizeRenderer(80, 8) },
    { event: 'render', frame: { transientSurface: 'overlay' }, run: t => t.render(overlay(4)) },
    { event: 'render', frame: { liveStart: 8 }, run: t => t.render(doc(lines, 8)) },
  ],
})

/**
 * The full trace, machine readable. Nothing is trimmed: raw emitted bytes, per-row
 * `isWrapped`, both buffers and their cursors. A summary table cannot be checked against
 * the terminal, which is the whole point of taking the reading.
 */
function report(name, trace, toStderr = false) {
  const emit = toStderr ? console.error : console.log
  emit(`\n=== ${name} ===`)
  for (const step of trace) {
    emit(JSON.stringify({
      event: step.event,
      frame: step.frame,
      resize: step.resize,
      emitted: step.emitted,
      beforeEvent: step.beforeEvent,
      afterEvent: step.afterEvent,
      afterOutput: step.afterOutput,
    }))
  }
}

/**
 * The sequence the earlier duplicate report came from: a width change at the full
 * height first, then a shrink at the new width. It is kept separate because it is a
 * different event order from `visible` above, and a clean run of one says nothing about
 * the other.
 */
const widthFirst = await drive({
  width: 80,
  height: 10,
  overlays: false,
  steps: [
    { event: 'render', frame: { liveStart: 8 }, run: t => t.render(doc(lines, 8)) },
    { event: 'terminal.resize', resize: [100, 10], run: t => t.resizeTerminal(100, 10) },
    { event: 'renderer.resize', run: t => t.resizeRenderer(100, 10) },
    { event: 'render', frame: { liveStart: 8 }, run: t => t.render(doc(lines, 8)) },
    { event: 'terminal.resize', resize: [100, 8], run: t => t.resizeTerminal(100, 8) },
    { event: 'renderer.resize', run: t => t.resizeRenderer(100, 8) },
    { event: 'render', frame: { liveStart: 8 }, run: t => t.render(doc(lines, 8)) },
  ],
})

/**
 * The shell-overlay sequence: history the renderer never watched, then a grow that pulls
 * it back onto the screen, then a return frame that repaints. The external rows have to
 * be locked **before** any paint, and again afterwards, so it is visible which frame
 * makes them disappear — the ledger cannot be asked to reproduce text it never read.
 */
/**
 * Two shell-overlay sequences, and they are not the same path.
 *
 * `visibleShell` grows a visible window, so the terminal pulls external rows back with no
 * overlay involved. `altShell` follows the failing case exactly: a small window, the
 * external rows, three flushes of its own, an overlay, a grow inside it, the overlay
 * again, and a return frame — the repaint that covers the snapshot is expected here, not
 * in the visible one.
 */
async function shellSequence({ name, height, overlays, steps, external: externalCount = 10 }) {
  const external = Array.from({ length: externalCount }, (_, i) => `shell-${i}`)
  const term = new Terminal({ cols: 80, rows: height, scrollback: 2000, allowProposedApi: true })
  for (const row of external) await write(term, `${row}\r\n`)
  const chunks = []
  const renderer = new (await import('../packages/tui/omdsh-tui/src/chrome/main-screen-renderer.ts'))
    .MainScreenRenderer({ write: chunk => chunks.push(chunk) }, {
      width: 80, height, alternateScreenOverlays: overlays,
    })
  const trace = []
  for (const step of steps) {
    const before = chunks.length
    const beforeEvent = read(term)
    let called = null
    await step.run({
      resizeTerminal: (cols, rows) => term.resize(cols, rows),
      resizeRenderer: (cols, rows) => renderer.resize(cols, rows),
      render: frame => capture(frame, value => { called = value }, () => renderer.render(frame)),
    })
    const afterEvent = read(term)
    for (const chunk of chunks.slice(before)) await write(term, chunk)
    trace.push({
      event: step.event,
      frame: called,
      resize: step.resize,
      emitted: chunks.slice(before),
      beforeEvent,
      afterEvent,
      afterOutput: read(term),
    })
  }
  return { name, external, trace }
}

const visibleShell = await shellSequence({
  name: 'visibleShell',
  height: 10,
  overlays: false,
  steps: [
    { event: 'render', run: t => t.render(doc(lines, 3)) },
    { event: 'terminal.resize', resize: [80, 15], run: t => t.resizeTerminal(80, 15) },
    { event: 'renderer.resize', run: t => t.resizeRenderer(80, 15) },
    { event: 'render', run: t => t.render(doc(lines, 3)) },
    { event: 'render', run: t => t.render(doc([...lines, 'more-0'], lines.length - 15)) },
  ],
})

const altShell = await shellSequence({
  name: 'altShell',
  height: 5,
  overlays: true,
  steps: [
    { event: 'render', run: t => t.render(doc(lines, 3)) },
    { event: 'render', frame: 'overlay(2)', run: t => t.render(overlay(2)) },
    { event: 'terminal.resize', resize: [80, 15], run: t => t.resizeTerminal(80, 15) },
    { event: 'renderer.resize', run: t => t.resizeRenderer(80, 15) },
    { event: 'render', frame: 'overlay(3)', run: t => t.render(overlay(3)) },
    {
      event: 'render',
      frame: 'grown, liveStart length-15',
      run: t => t.render(doc([...lines, ...Array.from({ length: 10 }, (_, i) => `more-${i}`)], lines.length + 10 - 15)),
    },
  ],
})

/**
 * The control for both shell sequences: the same moves with **no external history**, so
 * only the renderer's own rows can come back.
 *
 * It exists to check whether a protection strategy introduces an **extra** re-send or
 * loses a row. It does not by itself show that scrolling by the surplus would duplicate
 * them — there is no protection implementation yet, and a row pulled off history and
 * later re-entered is allowed. What it gives is the other half of the pairing: the same
 * renderer-visible input with a different real buffer state.
 */
const noExternalShell = await shellSequence({
  name: 'noExternalShell',
  height: 5,
  overlays: true,
  external: 0,
  steps: [
    { event: 'render', run: t => t.render(doc(lines, 3)) },
    { event: 'render', frame: 'overlay(2)', run: t => t.render(overlay(2)) },
    { event: 'terminal.resize', resize: [80, 15], run: t => t.resizeTerminal(80, 15) },
    { event: 'renderer.resize', run: t => t.resizeRenderer(80, 15) },
    { event: 'render', frame: 'overlay(3)', run: t => t.render(overlay(3)) },
    {
      event: 'render',
      frame: 'grown, liveStart length-15',
      run: t => t.render(doc([...lines, ...Array.from({ length: 10 }, (_, i) => `more-${i}`)], lines.length + 10 - 15)),
    },
  ],
})

/**
 * The rewrite sequence: the same shell-overlay moves, but the returning document has its
 * first row rewritten. Two rows are owed a commit — the old snapshot the scroll moves
 * back into history, and the new text the document now reads there.
 */
const rewritten = await shellSequence({
  name: 'rewritten',
  height: 5,
  overlays: true,
  // The spec's fixture writes three shell rows, so the calibration has to as well: a
  // different count changes how much history the grow can pull and where the cursor ends
  // up, and a mismatch would be read as a model difference.
  external: 3,
  steps: [
    { event: 'render', run: t => t.render(doc(lines, 3)) },
    { event: 'render', frame: 'overlay(2)', run: t => t.render(overlay(2)) },
    { event: 'terminal.resize', resize: [80, 15], run: t => t.resizeTerminal(80, 15) },
    { event: 'renderer.resize', run: t => t.resizeRenderer(80, 15) },
    { event: 'render', frame: 'overlay(3)', run: t => t.render(overlay(3)) },
    {
      event: 'render',
      frame: 'grown, first row rewritten',
      run: t => {
        const edited = ['replacement-0', ...lines.slice(1)]
        return t.render(doc([...edited, ...Array.from({ length: 10 }, (_, i) => `more-${i}`)], edited.length + 10 - 15))
      },
    },
  ],
})

for (const sequence of [visibleShell, altShell, noExternalShell, rewritten]) {
  report(sequence.name, sequence.trace, true)
}

/**
 * Where every row the sequence cares about is, with its **count** on each side.
 *
 * External and own rows are reported through the same shape, so the two sequences can
 * be read against each other: a total says nothing about a row appearing twice or not
 * at all, and an empty list on one axis is not a zero on the other.
 */
const rowState = sequence => {
  const collect = rows => rows.filter(row => row.text !== '').map(row => row.text)
  const tally = rows => {
    const counts = new Map()
    for (const row of rows) counts.set(row, (counts.get(row) ?? 0) + 1)
    return [...counts].map(([row, count]) => `${row}x${count}`)
  }
  const side = step => {
    const history = collect(step.afterOutput.normal.history)
    const screen = collect(step.afterOutput.normal.viewport)
    return {
      externalHistory: tally(history.filter(row => sequence.external.includes(row))),
      externalScreen: tally(screen.filter(row => sequence.external.includes(row))),
      ownHistory: tally(history.filter(row => !sequence.external.includes(row))),
      ownScreen: tally(screen.filter(row => !sequence.external.includes(row))),
    }
  }
  return sequence.trace.map(step => ({ event: step.event, ...side(step) }))
}
console.log('ROWS', JSON.stringify({
  visibleShell: rowState(visibleShell),
  altShell: rowState(altShell),
  noExternalShell: rowState(noExternalShell),
  // The two sides are reported separately: a row leaving history for the viewport keeps
  // its total at one, so a sum cannot say which side it is on.
  rewritten: rewritten.trace.map(step => ({
    event: step.event,
    baseY: step.afterOutput.normal.baseY,
    cursorRow: step.afterOutput.normal.cursorRow,
    line0History: step.afterOutput.normal.history.filter(row => row.text === 'line-0').length,
    line0Screen: step.afterOutput.normal.viewport.filter(row => row.text === 'line-0').length,
    replacementHistory: step.afterOutput.normal.history.filter(row => row.text === 'replacement-0').length,
    replacementScreen: step.afterOutput.normal.viewport.filter(row => row.text === 'replacement-0').length,
  })),
}))
report('visible', visible, true)
report('alt', alt, true)
report('widthFirst', widthFirst, true)

// A one-line-per-step view for reading, over the same readings.
const brief = (trace) => trace.map(step => ({
  event: step.event,
  frame: step.frame,
  bytes: step.emitted.map(chunk => chunk.length),
  beforeEvent: `${step.beforeEvent.normal.baseY}/${step.beforeEvent.normal.cursorRow}`,
  afterEvent: `${step.afterEvent.normal.baseY}/${step.afterEvent.normal.cursorRow}`,
  afterOutput: `${step.afterOutput.normal.baseY}/${step.afterOutput.normal.cursorRow}`,
  alt: step.afterOutput.active,
  anyWrapped: [step.beforeEvent, step.afterEvent, step.afterOutput].some(reading =>
    [...reading.normal.viewport, ...reading.normal.history].some(row => row.wrapped)),
}))
console.log('SUMMARY', JSON.stringify({
  visible: brief(visible), alt: brief(alt), widthFirst: brief(widthFirst),
}, null, 1))

if (!existsSync(join(root, 'packages', 'tui', 'omdsh-tui', 'src', 'chrome', 'main-screen-renderer.ts'))) {
  console.error('renderer source not found')
}
