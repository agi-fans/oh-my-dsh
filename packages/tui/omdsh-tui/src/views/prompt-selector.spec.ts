import { describe, expect, it } from 'vitest'
import { togglePromptSelection, selectedPromptAnswer, selectedFilteredPromptAnswer, refreshPromptOptions, maskPromptSecret, renderImagePreviewPage, renderPlanReviewPage, renderPromptSelector, renderPromptTreePage, type PromptSelectorState } from './prompt-selector.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'

function reviewState(overrides: Partial<PromptSelectorState> = {}): PromptSelectorState {
  return {
    request: {
      title: 'Plan review',
      question: 'Approve this plan and leave plan mode?',
      detail: ['# Implementation plan', ...Array.from({ length: 80 }, (_, index) => `- Step ${index + 1}`)].join('\n'),
      options: [
        { label: 'Approve', description: 'Leave plan mode.' },
        { label: 'Keep planning', description: 'Revise the plan.' },
      ],
      presentation: 'plan-review',
      approveValue: 'Approve',
      allowCustom: true,
    },
    selected: 0,
    checked: new Set(),
    ...overrides,
  }
}

it.each([false, true])('renders progress with cancellation hints and no answer editor (color=%s)', color => {
  const state: PromptSelectorState = { request: { title: 'Install plugin', question: 'demo 🐳', detail: 'Plugin installing · 1/2', presentation: 'progress' }, selected: 0, checked: new Set() }
  for (const width of [30, 60, 100]) {
    const frame = renderPromptSelector(state, createTheme(color), width, '', 0)
    const text = stripAnsi(frame.lines.join('\n'))
    expect(text).toContain('Esc cancel')
    expect(text).not.toContain('Enter')
    expect(frame.cursorVisible).toBe(false)
    expect(frame.lines.every(line => visibleWidth(line) <= width)).toBe(true)
  }
})

describe('plan review page', () => {
  it.each([false, true])('does not leave an empty separator when a source reader has no custom actions (color=%s)', color => {
    for (const width of [30, 60, 130]) {
      const frame = renderPlanReviewPage({ request: { title: 'Approval', question: 'Exact invocation', presentation: 'document',
        documentSource: { text: 'command: echo hello' }, allowCustom: false, options: [{ label: 'Cancel' }] },
        selected: 0, checked: new Set() }, createTheme(color), width, 24, '', 0, 'omdsh')
      expect(stripAnsi(frame.lines.join('\n'))).not.toMatch(/·\s*·/u)
      expect(frame.lines.every(line => visibleWidth(line) === width)).toBe(true)
    }
  })
  it.each([false, true])('shows Ctrl+C only when a source reader supports interruption (color=%s)', color => {
    for (const width of [30, 40, 60, 100]) {
      const request = { title: 'Shell 中文 🐳', question: 'Output', presentation: 'document' as const,
        documentSource: { text: 'hello\n', status: '1 loaded' }, allowCustom: false,
        options: [{ label: 'Input', value: 'input' }] }
      const state = { request, selected: 0, checked: new Set<number>() }
      const ordinary = renderPlanReviewPage(state, createTheme(color), width, 24, '', 0, 'omdsh')
      expect(stripAnsi(ordinary.lines.join('\n'))).not.toContain('Ctrl+C interrupt')
      const shell = renderPlanReviewPage({ ...state, request: { ...request, interrupt: () => {} } }, createTheme(color), width, 24, '', 0, 'omdsh')
      expect(stripAnsi(shell.lines.join('\n'))).toContain('Ctrl+C interrupt')
      expect(shell.lines).toHaveLength(24)
      expect(shell.lines.every(line => visibleWidth(line) === width)).toBe(true)
    }
  })
  it.each([false, true])('keeps every document action visible with an explicit selection at narrow widths (color=%s)', color => {
    for (const width of [30, 40, 60, 100]) {
      const labels = ['Files', 'Previous', 'Next', 'Open', 'Editor']
      const frame = renderPlanReviewPage({ request: { title: 'File', question: 'a.txt', presentation: 'document', detail: 'Content',
        options: labels.map(label => ({ label })) }, selected: 4, checked: new Set() }, createTheme(color), width, 24, '', 0, 'omdsh')
      const text = stripAnsi(frame.lines.join('\n'))
      for (const label of labels) expect(text).toContain(`[ ${label} ]`)
      expect(text).toContain('› [ Editor ]')
      expect(frame.lines).toHaveLength(24)
      expect(frame.lines.every(line => visibleWidth(line) === width)).toBe(true)
    }
  })

  it('keeps the selected action inside a very short viewport', () => {
    const frame = renderPlanReviewPage({ request: { title: 'File', question: 'a.txt', presentation: 'document', detail: 'Content',
      options: ['Files', 'Preview', 'Previous', 'Next', 'Open', 'Editor'].map(label => ({ label })) },
      selected: 5, checked: new Set() }, createTheme(false), 30, 10, '', 0, 'omdsh')
    expect(frame.lines).toHaveLength(10)
    expect(frame.lines.every(line => visibleWidth(line) === 30)).toBe(true)
    expect(frame.lines.join('\n')).toContain('› [ Editor ]')
  })

  it('keeps a long Markdown plan inside the terminal viewport', () => {
    const frame = renderPlanReviewPage(reviewState(), createTheme(false), 100, 30, '', 0, 'omdsh')
    const text = stripAnsi(frame.lines.join('\n'))

    expect(frame.lines).toHaveLength(30)
    expect(frame.lines.every(line => visibleWidth(line) === 100)).toBe(true)
    expect(text).toContain('omdsh · Plan review')
    expect(text).toContain('Implementation plan')
    expect(text).toContain('later plan lines')
    expect(text).toContain('[ Approve ]')
    expect(frame.document?.maxStart).toBeGreaterThan(0)
    expect(frame.cursorVisible).toBe(false)
  })

  it('scrolls the document independently and reserves an in-frame feedback field', () => {
    const scrolled = renderPlanReviewPage(
      reviewState({ documentScroll: 10_000 }),
      createTheme(false),
      80,
      24,
      '',
      0,
      'omdsh',
    )
    expect(stripAnsi(scrolled.lines.join('\n'))).toContain('earlier plan lines')
    expect(scrolled.document?.start).toBe(scrolled.document?.maxStart)

    const feedback = renderPlanReviewPage(
      reviewState({ selected: 1, feedback: true }),
      createTheme(false),
      80,
      24,
      'Cover the failure path',
      22,
      'omdsh',
    )
    const text = stripAnsi(feedback.lines.join('\n'))
    expect(feedback.lines).toHaveLength(24)
    expect(text).toContain('Revision feedback · optional')
    expect(text).toContain('Cover the failure path')
    expect(feedback.cursorVisible).toBe(true)
  })
})

describe('a question that is only text', () => {
  const textPrompt = (over: Record<string, unknown> = {}) => renderPromptSelector({
    request: { title: 'Advisor', question: 'What should the advisor answer?', allowCustom: true, ...over },
    selected: 0, checked: new Set(),
  } as unknown as PromptSelectorState, createTheme(false), 72, '', 0)

  it('uses one frame: the composer itself, not a card above a second editor', () => {
    // The card plus a separate editor under it drew two borders that each looked
    // like the place to type, two hint lines saying what Enter does, and a label
    // reading `answer` that named nothing new.
    const frame = textPrompt()
    const lines = frame.lines.map(line => stripAnsi(line))
    expect(lines.filter(line => /^[╭╰─]/u.test(line)).length).toBe(2)
    expect(lines[0]).toContain('Advisor')
    expect(lines[1]).toContain('What should the advisor answer?')
    // The keys ride the bottom rule rather than costing a row of their own.
    expect(lines[1]).not.toContain('enter')
    expect(lines.at(-1)).toContain('enter answer')
    expect(frame.cursorVisible).toBe(true)
    expect(frame.cursor.row).toBe(1)
  })

  it('keeps the card when the question carries supporting copy', () => {
    // A question with a paragraph under it needs rows the bottom rule cannot give.
    const frame = textPrompt({ detail: 'Uses a committed snapshot and no tools.' })
    expect(frame.lines.map(line => stripAnsi(line)).join('\n')).toContain('Uses a committed snapshot')
    expect(frame.lines.length).toBeGreaterThan(4)
  })
})

describe('secret prompt', () => {
  it('masks the value without changing editor indices or exposing the key', () => {
    const secret = 'sk-secret-value'
    const state: PromptSelectorState = {
      request: {
        title: 'Login to DeepSeek',
        question: 'Paste your DeepSeek API key',
        allowCustom: true,
        secret: true,
      },
      selected: 0,
      checked: new Set(),
    }
    const frame = renderPromptSelector(state, createTheme(false), 72, secret, secret.length)
    const text = stripAnsi(frame.lines.join('\n'))

    expect(maskPromptSecret(secret)).toBe('•'.repeat(secret.length))
    expect(text).not.toContain(secret)
    expect(text).toContain('•'.repeat(secret.length))
    // The label is the prompt's own title plus the fact that typing is masked, so
    // the frame names the thing being asked for instead of a generic `API key`.
    expect(text).toContain('· hidden')
    expect(frame.cursorVisible).toBe(true)
  })
})

describe('selector density', () => {
  it('keeps compact choices and their descriptions on one row', () => {
    const state: PromptSelectorState = {
      request: {
        title: 'Model',
        question: 'Choose a model',
        presentation: 'fullscreen-list',
        optionLayout: 'compact',
        filterable: true,
        allowCustom: false,
        options: [
          { label: 'deepseek-v4-flash', description: 'DeepSeek-V4-Flash' },
          { label: 'deepseek-v4-pro', description: 'DeepSeek-V4-Pro' },
        ],
      },
      selected: 0,
      checked: new Set(),
    }

    const frame = renderPromptSelector(state, createTheme(false), 80, '', 0)
    const rows = frame.lines.map(stripAnsi)

    // One row per choice: the shared list row puts the description in its own
    // column instead of trailing an em dash, so long labels line up with each
    // other rather than pushing their descriptions to different columns.
    expect(rows.some(row => /deepseek-v4-flash\s+DeepSeek-V4-Flash/u.test(row))).toBe(true)
    expect(rows.some(row => /deepseek-v4-pro\s+DeepSeek-V4-Pro/u.test(row))).toBe(true)
    expect(rows.every(row => !row.includes('—'))).toBe(true)
  })
})

describe('timed question cards', () => {
  it.each([false, true])('keeps the countdown and multilingual answer padding within display cells (colors=%s)', (colors) => {
    const state: PromptSelectorState = {
      request: { title: 'Question', question: '选择项目范围 🐳',
        options: [{ label: '项目范围 e\u0301' }], skippable: true, dismissLabel: 'Later',
        wait: { deadline: Date.now() + 120_000, hold: () => {} },
      }, selected: 0, checked: new Set(),
    }
    for (const width of [30, 60, 90]) {
      const frame = renderPromptSelector(state, createTheme(colors), width, '自定义答案 🐳', 6)
      expect(frame.lines.every(line => visibleWidth(line) <= width), `width=${width}`).toBe(true)
    }
    const frame = renderPromptSelector(state, createTheme(colors), 90, '', 0)
    const text = stripAnsi(frame.lines.join('\n'))
    expect(text).toContain('Continues in')
    expect(text).toContain('ctrl+t take time')
    expect(text).toContain('esc later')
    expect(text).toContain('ctrl+s skip')
    const held = renderPromptSelector({ ...state, waitHeld: true }, createTheme(colors), 90, '', 0)
    expect(stripAnsi(held.lines.join('\n'))).toContain('Take your time')
  })
})


it('renders scrolling documents in bounded cells and keeps action selection visible', () => {
  for (const color of [false, true]) for (const width of [24, 40, 80]) {
    const state = reviewState()
    state.request = { ...state.request, presentation: 'document', question: '文件 🐳', detail: Array.from({ length: 30 }, (_, index) => `文档 e\u0301 🐳 ${index}`).join('\n'),
      options: [{ label: 'Open', value: 'open' }, { label: 'Files', value: 'files' }], actions: [{ key: 'o', label: 'open', valuePrefix: 'open' }] }
    state.documentScroll = Number.POSITIVE_INFINITY
    const frame = renderPlanReviewPage(state, createTheme(color), width, 20, '', 0, 'omdsh')
    expect(frame.lines).toHaveLength(20)
    expect(frame.lines.every(line => visibleWidth(line) <= width)).toBe(true)
    expect(stripAnsi(frame.lines.join('\n'))).toContain('29')
    expect(frame.document!.start).toBe(frame.document!.maxStart)
  }
})


describe('Session Library footer actions', () => {
  it.each([false, true])('keeps archive and view switching discoverable when empty (colors=%s)', colors => {
    const frame = renderPromptSelector({ request: { title: 'Session Library', question: '', allowCustom: false, options: [], actions: [
      { key: 'r', label: 'rename', valuePrefix: 'rename:' }, { key: 'p', label: 'pin/unpin', valuePrefix: 'pin:' },
      { key: 'Alt+A', label: 'archive', valuePrefix: 'archive:' },
      { key: 'Alt+V', label: 'archived sessions', valuePrefix: 'view:', scope: 'list' },
    ] }, selected: 0, checked: new Set() }, createTheme(colors), 60, '', 0)
    const text = stripAnsi(frame.lines.join(' '))
    // The card carries the action hints too, so archive and view stay discoverable.
    expect(text).toContain('Alt+A')
    expect(text).toContain('Alt+V')
    expect(frame.lines.every(line => visibleWidth(line) <= 60)).toBe(true)
  })
})


describe('live prompt choices', () => {
  const choices = [{ label: '你好 🐳', value: 'a' }, { label: 'Beta', value: 'b' }, { label: 'Gamma', value: 'c' }]
  it('retains selected and checked identities through reordering and filtering', () => {
    const state: PromptSelectorState = { request: { title: 'Queue', question: '', options: choices, presentation: 'fullscreen-list', filterable: true }, selected: 1, checked: new Set([0, 1]), previewScroll: 5 }
    const reordered = refreshPromptOptions(state, [choices[1]!, choices[2]!, choices[0]!], '')
    expect(reordered.selected).toBe(0)
    expect(reordered.checked).toEqual(new Set([0, 2]))
    expect(reordered.previewScroll).toBe(5)
    const filtered = refreshPromptOptions({ ...state, selected: 0 }, [choices[2]!, choices[1]!], 'beta')
    expect(filtered.selected).toBe(0)
    expect(filtered.checked).toEqual(new Set([1]))
  })
  it.each([false, true])('clamps a removed selection, resets its preview and handles an empty list (color=%s)', color => {
    const state: PromptSelectorState = { request: { title: 'Queue', question: '', options: choices, presentation: 'fullscreen-list' }, selected: 1, checked: new Set(), previewScroll: 99 }
    const next = refreshPromptOptions(state, [choices[0]!, choices[2]!], '')
    expect(next.selected).toBe(1)
    expect(next.previewScroll).toBe(0)
    const empty = refreshPromptOptions(next, [], '')
    expect(empty.selected).toBe(0)
    for (const width of [24, 40, 80]) {
      for (const current of [next, empty]) {
        const frame = renderPromptSelector(current, createTheme(color), width, '', 0)
        expect(frame.lines.length).toBeLessThanOrEqual(20)
        expect(frame.lines.every(line => visibleWidth(line) <= width)).toBe(true)
      }
    }
  })
})


describe('image preview page', () => {
  it.each([false, true])('reserves padded image cells and readable actions across sizes (color=%s)', colors => {
    const state: PromptSelectorState = { selected: 1, checked: new Set(), request: { title: 'Image preview', question: '中文🐳e\u0301.png',
      documentImage: { data: new Uint8Array([0]), width: 640, height: 320, description: 'PNG · 640 × 320 px' },
      options: [{ label: 'Previous' }, { label: 'Open' }, { label: 'Close' }] } }
    for (const [width, height] of [[24, 10], [40, 14], [80, 24], [120, 40]]) {
      const frame = renderImagePreviewPage(state, createTheme(colors), width!, height!, 'omdsh', 'kitty', { width: 8, height: 16 })
      expect(frame.lines).toHaveLength(height!)
      expect(frame.lines.every(line => visibleWidth(line) === width)).toBe(true)
      expect(frame.image!.column).toBeGreaterThanOrEqual(4)
      expect(frame.image!.column + frame.image!.columns).toBeLessThanOrEqual(width! - 4)
      expect(frame.image!.row + frame.image!.rows).toBeLessThanOrEqual(height! - 4)
      expect(stripAnsi(frame.lines.join('\n'))).toContain('› [ Open ]')
      expect(frame.cursorVisible).toBe(false)
    }
    const fallback = renderImagePreviewPage(state, createTheme(colors), 80, 24, 'omdsh')
    expect(fallback.image).toBeUndefined()
    expect(stripAnsi(fallback.lines.join('\n'))).toContain('Inline images are unavailable')
  })
})


it.each([[60, 24], [24, 9]])('paints filtered multi-select checkboxes by original identity at %sx%s', (width, _height) => {
  const state: PromptSelectorState = { request: { title: 'Models', question: '', presentation: 'fullscreen-list', filterable: true, optionLayout: 'compact', multiSelect: true, options: [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }] }, selected: 0, checked: new Set([1]) }
  const frame = renderPromptSelector({ ...state, request: { ...state.request, allowCustom: false } }, createTheme(false), width, 'Beta', 4)
  expect(stripAnsi(frame.lines.join('\n'))).toContain('[x] Beta')
  expect(togglePromptSelection(state, 'Beta').checked).toEqual(new Set())
  expect(selectedPromptAnswer({ ...state, checked: new Set(), request: { ...state.request, allowEmptySelection: true } })).toBe('')
  expect(selectedPromptAnswer({ ...state, checked: new Set() })).toBeNull()
})

describe('a filterable card', () => {
  const options = [
    { label: 'hello from the model', value: 'a', description: '1 line', preview: 'hello from the model' },
    { label: 'the build failed', value: 'b', description: '2 lines' },
  ]
  const card = (input: string) => renderPromptSelector(
    { request: { title: 'Copy', question: 'Choose what to copy', filterable: true, allowCustom: false, options }, selected: 0, checked: new Set() },
    createTheme(false),
    70,
    input,
    input.length,
  )
  const text = (input: string) => stripAnsi(card(input).lines.join('\n'))

  it('draws the query and how much it kept', () => {
    // The paged list printed the query; the card filtered on it without showing
    // it, so the rows narrowed while the reader's own words appeared nowhere.
    const shown = text('build')
    expect(shown).toContain('⌕ build · 1/1')
    expect(shown).toContain('the build failed')
    expect(shown).not.toContain('hello from the model')
  })

  it('says the query matched nothing and stops advertising Enter', () => {
    // An empty frame reads as a broken list; `enter select` there promises a key
    // the handler swallows.
    const shown = text('zzz')
    expect(shown).toContain('No match for “zzz”')
    expect(shown).toContain('no match')
    expect(shown).not.toContain('enter select')
    expect(shown).toContain('esc cancel')
  })

  it('says what to do before anything is typed', () => {
    expect(text('')).toContain('type to filter')
  })

  it('marks a preview that was cut off', () => {
    const long = renderPromptSelector(
      { request: { title: 'Copy', question: 'q', filterable: true, allowCustom: false,
        options: [{ label: 'x', value: 'x', preview: Array.from({ length: 9 }, (_, at) => `line ${at}`).join('\n') }] }, selected: 0, checked: new Set() },
      createTheme(false), 60, '', 0,
    )
    expect(stripAnsi(long.lines.join('\n'))).toContain('… 6 more lines')
  })
})

describe('a tree row says everything the option knows', () => {
  it('draws the description and the badge tone the card mode draws', () => {
    // The page used to drop both, so a full-screen tree lost the agent's phase
    // colour and its elapsed time — the two things that tell similar nodes apart.
    const frame = renderPromptTreePage({
      request: {
        title: 'Agent Hub',
        question: '',
        presentation: 'fullscreen-tree',
        filterable: true,
        allowCustom: false,
        options: [
          { value: 'child', label: 'review auth', description: 'running · 12s', badge: { label: 'working', tone: 'warning' } },
        ],
      },
      selected: 0,
      checked: new Set(),
    }, createTheme(true), 100, 20, '', 0, 'omdsh')
    const rows = frame.lines
    const row = rows.find(line => stripAnsi(line).includes('review auth'))
    expect(row).toBeDefined()
    expect(stripAnsi(row!)).toContain('running · 12s')
    expect(stripAnsi(row!)).toContain('[working]')
    // The tone reaches the badge, so the colour is the caller's decision.
    expect(row).toContain(createTheme(true).fg('warning', '').slice(0, 5))
  })

  it('keeps the row inside the list column when the description is long', () => {
    const frame = renderPromptTreePage({
      request: {
        title: 'T',
        question: '',
        presentation: 'fullscreen-tree',
        filterable: true,
        allowCustom: false,
        options: [{ value: 'a', label: 'node', description: 'x'.repeat(400) }],
      },
      selected: 0,
      checked: new Set(),
    }, createTheme(false), 40, 20, '', 0, 'omdsh')
    expect(frame.lines.every(line => visibleWidth(line) <= 40)).toBe(true)
  })
})

describe('preview format', () => {
  const card = (option: Record<string, unknown>) => stripAnsi(renderPromptSelector(
    { request: { title: 'X', question: 'q', filterable: true, allowCustom: false, options: [option] }, selected: 0, checked: new Set() },
    createTheme(false), 60, '', 0,
  ).lines.join('\n'))
  const tree = (option: Record<string, unknown>) => stripAnsi(renderPromptTreePage(
    { request: { title: 'X', question: '', presentation: 'fullscreen-tree', filterable: true, allowCustom: false, options: [option] },
      selected: 0, checked: new Set() },
    createTheme(false), 100, 20, '', 0, 'omdsh',
  ).lines.join('\n'))

  it('reads a preview as plain text by default, and the same way on both surfaces', () => {
    const option = { value: 'a', label: 'node', preview: 'a **bold** word' }
    expect(card(option)).toContain('a **bold** word')
    expect(tree(option)).toContain('a **bold** word')
  })

  it('renders markdown only where the caller asked for it', () => {
    // Before this, the tree page rendered markdown unconditionally and the card
    // rendered text, so one field meant two things depending on the surface.
    const option = { value: 'a', label: 'node', preview: 'a **bold** word', previewFormat: 'markdown' }
    expect(card(option)).toContain('a bold word')
    expect(card(option)).not.toContain('**')
    expect(tree(option)).toContain('a bold word')
    expect(tree(option)).not.toContain('**')
  })
})

describe('a disabled row', () => {
  const request = {
    title: 'X', question: '', presentation: 'fullscreen-tree' as const, filterable: true, allowCustom: false,
    options: [
      { value: 'group', label: 'workflow group', disabled: true },
      { value: 'child', parentValue: 'group', label: 'child agent' },
    ],
  }

  it('is focusable but carries no answer', () => {
    const state = { request, selected: 0, checked: new Set() }
    expect(selectedFilteredPromptAnswer(state, '')).toBeNull()
    expect(selectedPromptAnswer(state)).toBeNull()
    expect(selectedFilteredPromptAnswer({ ...state, selected: 1 }, '')).toBe('child')
  })

  it('is drawn without the cursor colour, so it does not read as a destination', () => {
    const frame = renderPromptTreePage({ request, selected: 0, checked: new Set() }, createTheme(true), 100, 20, '', 0, 'omdsh')
    const row = frame.lines.find(line => stripAnsi(line).includes('workflow group'))
    expect(row).toBeDefined()
    expect(row).not.toContain(createTheme(true).fg('accent', '').slice(0, 5) + 'workflow group')
  })
})
