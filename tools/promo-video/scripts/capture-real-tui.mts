import fs from 'node:fs'
import path from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { renderView, type ViewOptions } from '../../../packages/tui/omdsh-tui/src/views/transcript-render.ts'
import { initialTranscript, type TranscriptState } from '../../../packages/tui/omdsh-tui/src/views/transcript-types.ts'
import { formatTeamBoardMarkdown } from '../../../packages/tui/omdsh-tui/src/commands/team.ts'
import { tuiSettingItems, type PluginSettingsEntry, type SettingsState } from '../../../packages/tui/omdsh-tui/src/views/settings-list.ts'
import type { FileBrowserState } from '../../../packages/tui/omdsh-tui/src/views/file-browser.ts'
import type { PromptSelectorState } from '../../../packages/tui/omdsh-tui/src/views/prompt-selector.ts'
import { createTrajectory } from '../../../packages/tui/omdsh-tui/src/views/trajectory.ts'
import type { TuiSessionStats } from '../../../packages/tui/omdsh-tui/src/definition.ts'

const COLS = 104
const ROWS = 29

const BASE_STATS: TuiSessionStats = {
  turns: 2,
  steps: 4,
  llmMs: 4800,
  toolMs: 1900,
  ttftMs: 3600,
  ttftSteps: 4,
  decodeMs: 4200,
  decodeTokens: 1180,
  inputTokens: 14200,
  outputTokens: 1180,
  cacheReadTokens: 13348,
  cacheWriteTokens: 420,
  contextTokens: 24100,
  contextWindow: 1_000_000,
  elapsedMs: 6700,
}

function baseOpts(overrides: Partial<ViewOptions> = {}): ViewOptions {
  return {
    width: COLS,
    height: ROWS,
    model: 'deepseek-flash',
    reasoningEffort: 'high',
    input: '',
    inputCursor: 0,
    colors: true,
    colorDepth: 'truecolor',
    themeName: 'dark',
    language: 'en', // Unified English TUI aligned with DeepSeek Harness terminology
    version: '0.29.2',
    appName: 'omdsh',
    displayName: 'Oh-My-DSH',
    pwd: '~/Workspace/oh-my-dsh',
    branch: 'main *3',
    modelReady: true,
    compactLinks: true,
    sessionStats: BASE_STATS,
    sessionControls: {
      agentPreset: 'standard',
      permission: 'workspace-write',
    },
    busyEnter: 'queue',
    steerKey: 'Alt+S',
    alternateSendKey: 'Alt+S',
    toolDetailsKey: 'Ctrl+O',
    turnDetailsKey: 'Ctrl+O',
    ...overrides,
  }
}

interface SerializedFrame {
  lines: string[]
  cursor: { row: number; column: number }
  cursorVisible: boolean
  theme: 'dark' | 'light'
}

function snap(state: TranscriptState, opts: Partial<ViewOptions> = {}): SerializedFrame {
  const merged = baseOpts(opts)
  const frame = renderView(state, merged)
  const overflow = Math.max(0, frame.lines.length - ROWS)
  const lines = overflow > 0 ? frame.lines.slice(overflow) : frame.lines
  return {
    lines,
    cursor: { row: Math.max(0, frame.cursor.row - overflow), column: frame.cursor.column },
    cursorVisible: frame.cursorVisible !== false,
    theme: merged.themeName === 'light' ? 'light' : 'dark',
  }
}

// ============================================================
// SCENE 2: DEEPSEEK HARNESS AGENT PRESETS (Standard / PTC / Cordis / Minimal)
// ============================================================
function makeAgentSelector(selected: number): PromptSelectorState {
  return {
    request: {
      title: 'Agent',
      question: 'Choose the Agent composition for this blank session',
      detail: 'Locked after the first prompt · /agent inspect shows composition diagnostics',
      submitLabel: 'apply',
      options: [
        {
          label: 'Standard',
          value: 'standard',
          description: 'Current · Full coding harness: tools, planning, subagents & time context',
        },
        {
          label: 'PTC (code)',
          value: 'code',
          description: 'Programmatic Tool Calling: orchestrate tools via Node run_code scripts',
          badge: { label: 'PTC', tone: 'accent' },
        },
        {
          label: 'Creator (cordis)',
          value: 'cordis',
          description: 'Author & debug Cordis plugins with dsh-doc skill and plugin_manager',
          badge: { label: 'Creator', tone: 'customMessageLabel' },
        },
        {
          label: 'Minimal',
          value: 'minimal',
          description: 'Lightweight chat with minimal tools and zero extra context injection',
        },
      ],
    },
    selected,
    checked: new Set(),
  }
}

const s2AgentSelect = [0, 1, 2, 3, 1].map((idx) =>
  snap(initialTranscript(), {
    promptSelector: makeAgentSelector(idx),
    sessionStats: { ...BASE_STATS, turns: 0, steps: 0, contextTokens: 8200 },
  }),
)

// PTC (code) real nested run_code + ptc-dispatch subcalls!
const PTC_CODE = [
  "const files = await tools.glob({ pattern: 'packages/tui/src/**/*.ts' })",
  "const hits = await tools.grep({ pattern: 'fitFrame', files })",
  "await tools.edit({ path: hits[0].path, fix: 'include compactLinks in key' })",
  "return await tools.bash({ command: 'pnpm --filter @agi-fans/dsh-tui test' })",
].join('\n')

const s2PtcState: TranscriptState = {
  ...initialTranscript(),
  status: 'idle',
  turn: 1,
  turnSpans: { 1: { start: 1000, end: 5200 } },
  blocks: [
    { kind: 'user', text: 'Batch-audit every fitFrame caller and verify narrow-width tests via PTC' },
    {
      kind: 'tool',
      callId: 'ptc_root',
      turn: 1,
      name: 'run_code',
      args: JSON.stringify({ code: PTC_CODE }),
      status: 'ok',
      output: 'Audited 18 files, patched session-controller.ts, 482/482 tests passed in 1.3s.',
    },
    {
      kind: 'tool',
      callId: 'ptc_1',
      parentCallId: 'ptc_root',
      turn: 1,
      name: 'glob',
      args: JSON.stringify({ pattern: 'packages/tui/src/**/*.ts' }),
      status: 'ok',
      output: '18 files matched',
    },
    {
      kind: 'tool',
      callId: 'ptc_2',
      parentCallId: 'ptc_root',
      turn: 1,
      name: 'grep',
      args: JSON.stringify({ pattern: 'fitFrame' }),
      status: 'ok',
      output: '3 occurrences in session-controller.ts',
    },
    {
      kind: 'tool',
      callId: 'ptc_3',
      parentCallId: 'ptc_root',
      turn: 1,
      name: 'bash',
      args: JSON.stringify({ command: 'pnpm --filter @agi-fans/dsh-tui test' }),
      status: 'ok',
      output: '✓ 482 passed (0 failed)',
    },
    {
      kind: 'assistant',
      turn: 1,
      step: 2,
      text: 'PTC script executed **4 chained tools in a single turn** — patched `session-controller.ts` and verified all 482 tests pass.',
      reasoning: '',
      streaming: false,
    },
  ],
}

const s2PtcRaw = renderView(s2PtcState, baseOpts({ sessionControls: { agentPreset: 'code', permission: 'workspace-write' } }))
const ptcGroupKey = s2PtcRaw.disclosures?.[0]?.key ?? 'tool:ptc_root'

const s2PtcSubcalls = snap(s2PtcState, {
  sessionControls: { agentPreset: 'code', permission: 'workspace-write' },
  openedGroups: new Set([ptcGroupKey]),
})
const s2PtcExpanded = snap(s2PtcState, {
  sessionControls: { agentPreset: 'code', permission: 'workspace-write' },
  openedGroups: new Set([ptcGroupKey]),
  expandedTools: new Set(['ptc_root']),
  transientStatus: 'PTC run_code expanded · source & nested tool outputs',
})

// Creator (cordis) preset + /login DeepSeek account & /model switching
const s2CordisState: TranscriptState = {
  ...initialTranscript(),
  status: 'idle',
  turn: 1,
  turnSpans: { 1: { start: 1000, end: 4400 } },
  blocks: [
    { kind: 'user', text: '/agent creator' },
    {
      kind: 'notice',
      level: 'info',
      text: 'Creator is ready. Loaded dsh-doc authoring skill & plugin_manager. Describe the Cordis plugin you want to build.',
    },
    { kind: 'user', text: 'Scaffold a Cordis plugin that surfaces git worktree latency in the status footer' },
    {
      kind: 'tool',
      callId: 'cordis_1',
      turn: 1,
      name: 'plugin_manager',
      args: JSON.stringify({ action: 'inspect', package: '@agi-fans/dsh-tui' }),
      status: 'ok',
      output: 'Active profile: cordis · 38 mounted plugins · HMR watcher ready',
    },
    {
      kind: 'assistant',
      turn: 1,
      step: 1,
      text: 'Mounted **Creator (`cordis`)** composition with `dsh-doc` guidance. Created `src/plugins/worktree-telemetry.ts` using `ctx.inject([\'tui\', \'worktree\'])` — hot-reloadable with zero restart.',
      reasoning: '',
      streaming: false,
    },
  ],
}

const s2Cordis = snap(s2CordisState, {
  sessionControls: { agentPreset: 'cordis', permission: 'workspace-write' },
  transientStatus: 'DeepSeek Account synced · Ctrl+P switch model · Shift+Tab effort',
})

// ============================================================
// SCENE 3: COMPLETE 6-TAB /settings + DARK/LIGHT + /plugins (Codex/Claude) & /mcp
// ============================================================
const FULL_SETTINGS_PLUGINS: PluginSettingsEntry[] = [
  // Models
  {
    id: 'deepseek-account',
    section: 'models',
    subgroup: 'Accounts and API keys',
    label: 'DeepSeek account',
    description: 'Signed in via browser OAuth (reuses existing DSH Web/Desktop grant). Account notifications active.',
    behavior: 'Account · Live',
    summary: 'Signed in (dy@agi.fans)',
  },
  {
    id: 'deepseek-api-key',
    section: 'models',
    subgroup: 'Accounts and API keys',
    label: 'DeepSeek API key',
    description: 'Stored securely in DSH credential store via ${credential:DEEPSEEK_API_KEY}.',
    behavior: 'Credentials · Live',
    summary: 'Configured (****9f2a)',
  },
  {
    id: 'custom-providers',
    section: 'models',
    subgroup: 'Connection settings',
    label: 'Custom OpenAI / Anthropic providers',
    description: 'Add OpenAI-compatible or custom baseURL model providers alongside DeepSeek.',
    behavior: 'Profile · Saves immediately',
    summary: '2 providers',
  },
  // Agent presets
  {
    id: 'default-preset',
    section: 'presets',
    subgroup: 'New sessions',
    label: 'Default Agent preset',
    description: 'Composition mounted for new sessions: Standard, PTC (code), Creator (cordis), or Minimal.',
    behavior: 'Profile · Next session',
    inline: {
      path: ['default'],
      revision: 1,
      value: 'standard',
      choices: [
        { label: 'standard', value: 'standard' },
        { label: 'code (PTC)', value: 'code' },
        { label: 'cordis (Creator)', value: 'cordis' },
        { label: 'minimal', value: 'minimal' },
      ],
    },
  },
  {
    id: 'subagent-models',
    section: 'presets',
    subgroup: 'New sessions',
    label: 'Subagent allowed models',
    description: 'Restrict or allow specific model routes when spawning child subagents.',
    behavior: 'Profile · Next session',
    summary: 'All configured models',
  },
  // Plugins (Tools / Agents / Integrations)
  {
    id: 'mcp-servers',
    section: 'integrations',
    subgroup: 'Integrations',
    label: 'MCP servers (/mcp)',
    description: 'Manage stdio & streamable-http MCP servers live with probe, restart, and credential templates.',
    behavior: 'Runtime · Zero-restart',
    summary: '3 connected',
  },
  {
    id: 'web-search-billing',
    section: 'tools',
    subgroup: 'Tools',
    label: 'Web search & fetch billing',
    description: 'Route DeepSeek Search & Fetch via account token, API key, or auto fallback.',
    behavior: 'Runtime · Live',
    inline: {
      path: ['billing'],
      revision: 1,
      value: 'auto',
      choices: [
        { label: 'auto', value: 'auto' },
        { label: 'account', value: 'account' },
        { label: 'api-key', value: 'api-key' },
      ],
    },
  },
  {
    id: 'tmux-context',
    section: 'tools',
    subgroup: 'Tools',
    label: 'Tmux location context',
    description: 'Inject active POSIX $TMUX_PANE window and layout context automatically; zero overhead outside tmux.',
    behavior: 'Runtime · Live',
    inline: {
      path: ['enabled'],
      revision: 1,
      value: 'on',
      choices: [
        { label: 'on', value: 'on' },
        { label: 'off', value: 'off' },
      ],
    },
  },
  {
    id: 'worktree-retain',
    section: 'tools',
    subgroup: 'Tools',
    label: 'Keep worktrees when archiving',
    description: 'Preserve session-created Git worktrees when archiving a session in /resume.',
    behavior: 'Runtime · Live',
    inline: {
      path: ['retainOnArchive'],
      revision: 1,
      value: 'on',
      choices: [
        { label: 'on', value: 'on' },
        { label: 'off', value: 'off' },
      ],
    },
  },
  {
    id: 'tool-parallelism',
    section: 'agent',
    subgroup: 'Agents',
    label: 'Tool parallelism',
    description: 'Run independent read/search tool calls concurrently inside each agent step.',
    behavior: 'Runtime · Live',
    inline: {
      path: ['parallel'],
      revision: 1,
      value: 'on',
      choices: [
        { label: 'on', value: 'on' },
        { label: 'off', value: 'off' },
      ],
    },
  },
  {
    id: 'command-hooks',
    section: 'integrations',
    subgroup: 'Integrations',
    label: 'Command hooks bridge',
    description: 'Enable compatible synchronous command hooks from Claude Code or Codex configs.',
    behavior: 'Profile · Live',
    inline: {
      path: ['mode'],
      revision: 1,
      value: 'claude-code',
      choices: [
        { label: 'off', value: 'off' },
        { label: 'claude-code', value: 'claude-code' },
        { label: 'codex', value: 'codex' },
      ],
    },
  },
  // Advanced
  {
    id: 'profile-patch',
    section: 'advanced',
    subgroup: 'Plugin configuration',
    label: 'Live Cordis plugin fields',
    description: 'Inspect schema-validated live configuration fields and profile overrides.',
    behavior: 'Profile · Schema validated',
    summary: '12 fields',
  },
]

const FULL_SETTINGS_ACTIONS: SettingsState['actions'] = [
  {
    id: 'action-model',
    group: 'Models',
    subgroup: 'Model selection',
    label: 'Active model & reasoning effort',
    description: 'Open /model picker, manage favorites (Ctrl+P / Alt+P), and set reasoning effort.',
    value: 'deepseek-flash · high',
    values: [],
    action: 'model',
  },
  {
    id: 'action-plugins',
    group: 'Plugins',
    subgroup: 'Plugin management',
    label: 'Manage plugins & bundles (/plugins)',
    description: 'Browse installed bundles, Discover marketplace, update versions, or toggle Codex / Claude Code.',
    value: 'Open',
    values: [],
    action: 'plugins',
  },
  {
    id: 'action-goal',
    group: 'General',
    subgroup: 'Session controls',
    label: 'Current goal (/goal)',
    description: 'Configure autonomous continuation objective and activation state.',
    value: 'Active',
    values: [],
    action: 'goal',
  },
]

const FULL_PREFS_DARK: SettingsState['prefs'] = {
  uiLanguage: 'en',
  theme: 'dark',
  colors: true,
  motion: 'full',
  mathMode: 'auto',
  mermaidMode: 'auto',
  hideThinking: false,
  showFileChanges: true,
  mouseInteraction: 'auto',
  busyEnter: 'queue',
  pasteProtection: true,
  copyOnSelect: true,
  statusBar: { density: 'standard' },
}

const FULL_AGENT_BEHAVIOR = {
  language: 'auto' as const,
  autoCompact: true,
  defaultAccess: 'workspace-write',
}

const fullSettingItems = tuiSettingItems(
  FULL_PREFS_DARK,
  FULL_AGENT_BEHAVIOR as any,
  undefined,
  FULL_SETTINGS_PLUGINS,
  [{ id: 'auto', label: 'Auto (VS Code / Cursor)' } as any],
  FULL_SETTINGS_ACTIONS,
)

function idxOf(id: string): number {
  const i = fullSettingItems.findIndex((item) => item.id === id)
  return i >= 0 ? i : 0
}

const s3SettingsBaseState: TranscriptState = {
  ...initialTranscript(),
  status: 'idle',
  turn: 1,
  turnSpans: { 1: { start: 1000, end: 5000 } },
  blocks: [
    { kind: 'user', text: 'Inspect active DeepSeek Harness plugins and configure live status telemetry' },
    {
      kind: 'tool',
      callId: 'cfg1',
      turn: 1,
      name: 'read_file',
      args: JSON.stringify({ path: 'apps/omdsh/config/cordis.yml' }),
      status: 'ok',
      output: 'Loaded 38 Harness plugins across 6 configuration domains',
    },
    {
      kind: 'assistant',
      turn: 1,
      step: 1,
      text: 'All **6 DeepSeek Harness setting sections** dock directly above your live status footer — edit models, plugins, or themes without leaving the conversation.',
      reasoning: '',
      streaming: false,
    },
  ],
}

function fullSettingsObj(selectedId: string, prefs = FULL_PREFS_DARK): SettingsState {
  return {
    selected: idxOf(selectedId),
    prefs,
    agent: FULL_AGENT_BEHAVIOR as any,
    plugins: FULL_SETTINGS_PLUGINS,
    editors: [{ id: 'auto', label: 'Auto' } as any],
    actions: FULL_SETTINGS_ACTIONS,
  }
}

const s3SettingsModels = snap(s3SettingsBaseState, {
  settings: fullSettingsObj('plugin:deepseek-account'),
})
const s3SettingsPlugins = snap(s3SettingsBaseState, {
  settings: fullSettingsObj('plugin:mcp-servers'),
})
const s3SettingsTerminalVerbose = snap(s3SettingsBaseState, {
  settings: fullSettingsObj('statusDensity', { ...FULL_PREFS_DARK, statusBar: { density: 'verbose' } }),
  statusBar: { density: 'verbose' },
})
const s3SettingsTerminalLight = snap(s3SettingsBaseState, {
  themeName: 'light',
  settings: fullSettingsObj('theme', { ...FULL_PREFS_DARK, theme: 'light', statusBar: { density: 'verbose' } }),
  statusBar: { density: 'verbose' },
})

// /plugins (Bundles & Discover: Codex / Claude Code / Worktree / Auto-review) & /mcp live probe
const s3PluginsFrame = snap(initialTranscript(), {
  promptSelector: {
    request: {
      title: 'Plugins · Bundles & Discover',
      question: 'Manage built-in Harness bundles and external integrations without restarting',
      detail: 'Included with omdsh · Toggle, inspect README, or update registry/Git versions in place',
      filterable: true,
      submitLabel: 'configure',
      options: [
        {
          label: '@deepseek-ai/dsh-experimental-auto-review',
          value: 'auto-review',
          description: 'Model pre-execution permission review (/permission → Auto review)',
          badge: { label: 'Enabled', tone: 'success' },
        },
        {
          label: '@deepseek-ai/dsh-experimental-tool-worktree',
          value: 'worktree',
          description: 'Isolated Git worktree checkout tool with archive retention',
          badge: { label: 'Enabled', tone: 'success' },
        },
        {
          label: '@deepseek-ai/dsh-subagent-codex',
          value: 'codex',
          description: 'Official Codex subagent integration bundle · Included with omdsh',
          badge: { label: 'Available', tone: 'accent' },
        },
        {
          label: '@deepseek-ai/dsh-subagent-claude-code',
          value: 'claude-code',
          description: 'Official Claude Code Agent SDK integration · Included with omdsh',
          badge: { label: 'Available', tone: 'accent' },
        },
        {
          label: '@deepseek-ai/dsh-agent-team',
          value: 'team',
          description: 'Shared CAS task board & continuable subagent coordination (/team)',
          badge: { label: 'Enabled', tone: 'success' },
        },
      ],
    },
    selected: 2,
    checked: new Set(),
  },
})

const s3McpFrame = snap(initialTranscript(), {
  promptSelector: {
    request: {
      title: 'MCP servers · Runtime Manager',
      question: 'Add, probe, or restart stdio & streamable-http servers with zero restart',
      detail: 'Secrets resolve through ${credential:NAME} templates · Coexists with static mcp.json',
      filterable: true,
      submitLabel: 'probe',
      actions: [
        { key: 'A', label: 'Add server' },
        { key: 'P', label: 'Probe' },
        { key: 'R', label: 'Restart' },
      ],
      options: [
        {
          label: 'github-mcp',
          value: 'github',
          description: 'stdio · 28 tools ready · ${credential:GITHUB_TOKEN}',
          badge: { label: 'Connected · 14ms', tone: 'success' },
        },
        {
          label: 'postgres-readonly',
          value: 'postgres',
          description: 'streamable-http · probe succeeded · 6 schema resources',
          badge: { label: 'Probe OK · 21ms', tone: 'success' },
        },
        {
          label: 'playwright-browser',
          value: 'playwright',
          description: 'stdio · headless browser automation tools',
          badge: { label: 'Connected · 32ms', tone: 'success' },
        },
        {
          label: 'typescript-lsp (Local LSP)',
          value: 'lsp',
          description: 'Go-to-definition, hover diagnostics & workspace symbols',
          badge: { label: 'Active', tone: 'accent' },
        },
      ],
    },
    selected: 1,
    checked: new Set(),
  },
})

// ============================================================
// SCENE 4: TERMINAL CRAFT & FLOW (Coherent @, !shell, /btw, /diff, #L142)
// ============================================================
const PROMPT_S4 = 'Fix narrow-width transcript reflow in session-controller and add regression tests'

const s4RunningFrames: SerializedFrame[] = [0, 3, 6, 9, 12, 15].map((sp, i) =>
  snap(
    {
      ...initialTranscript(),
      status: 'running',
      turn: 1,
      turnSpans: { 1: { start: 1000 } },
      blocks: [
        { kind: 'user', text: PROMPT_S4 },
        {
          kind: 'assistant',
          turn: 1,
          step: 1,
          text: '',
          reasoning: 'Checking renderTranscriptBody cache key: missing colorDepth and compactLinks triggers redundant wrapping on resize.',
          streaming: i < 2,
        },
        ...(i >= 2
          ? [
              {
                kind: 'tool' as const,
                callId: 'c1',
                turn: 1,
                name: 'read_file',
                args: JSON.stringify({ path: 'packages/tui/omdsh-tui/src/session/session-controller.ts' }),
                status: 'ok' as const,
                output: 'Read 120 lines',
              },
            ]
          : []),
        ...(i >= 4
          ? [
              {
                kind: 'tool' as const,
                callId: 'c2',
                turn: 1,
                name: 'edit_file',
                args: JSON.stringify({ path: 'packages/tui/omdsh-tui/src/session/session-controller.ts' }),
                status: 'running' as const,
                output: 'Updating resolveTranscriptCacheKey...',
              },
            ]
          : []),
      ],
    },
    { spinnerFrame: sp },
  ),
)

const S4_REPLY = [
  'Fixed cache invalidation and added narrow-width CJK/Emoji regression tests:',
  '',
  '1. Included `colorDepth`, `compactLinks`, and `turnDetailsKey` in `resolveTranscriptCacheKey`.',
  '2. Fixed `fitFrame` double-counting `topPad` on short sessions.',
  '3. All 482 tests pass — see [session-controller.ts#L142](src/session/session-controller.ts#L142) (中英文对齐校验通过).',
].join('\n')

const s4SettledState: TranscriptState = {
  ...initialTranscript(),
  status: 'idle',
  turn: 1,
  turnSpans: { 1: { start: 1000, end: 8000 } },
  blocks: [
    { kind: 'user', text: PROMPT_S4 },
    {
      kind: 'assistant',
      turn: 1,
      step: 1,
      text: '',
      reasoning: 'Verified cache key missed colorDepth & compactLinks; added both and verified zero scrollback rewrite.',
      streaming: false,
    },
    {
      kind: 'tool',
      callId: 'c1',
      turn: 1,
      name: 'read_file',
      args: JSON.stringify({ path: 'packages/tui/omdsh-tui/src/session/session-controller.ts' }),
      status: 'ok',
      output: '141: export function resolveTranscriptCacheKey(state: ViewCacheKeyInput): string',
    },
    {
      kind: 'tool',
      callId: 'c2',
      turn: 1,
      name: 'edit_file',
      args: JSON.stringify({ path: 'packages/tui/omdsh-tui/src/session/session-controller.ts' }),
      status: 'ok',
      output: '@@ -139,3 +139,4 @@\n-  return `${state.width}:${state.turnDetailsKey}`\n+  const { width, colorDepth, compactLinks, turnDetailsKey } = state\n+  return `${width}:${colorDepth}:${compactLinks ? 1 : 0}:${turnDetailsKey}`',
    },
    {
      kind: 'tool',
      callId: 'c3',
      turn: 1,
      name: 'bash',
      args: JSON.stringify({ command: 'pnpm --filter @agi-fans/dsh-tui test' }),
      status: 'ok',
      output: '✓ 42 test files passed · 482 tests passed (0 failed) · 1.4s',
    },
    { kind: 'assistant', turn: 1, step: 2, text: S4_REPLY, reasoning: '', streaming: false },
  ],
}

const s4GroupKey = renderView(s4SettledState, baseOpts()).disclosures?.[0]?.key ?? 'assistant:1:1'
const s4Folded = snap(s4SettledState)
const s4Expanded = snap(s4SettledState, {
  openedGroups: new Set([s4GroupKey]),
  expandedTools: new Set(['c2']),
  transientStatus: 'Process expanded · Ctrl+O fold',
})

// Coherent Flow A: !shell inline card + @file autocomplete -> selected path cleanly inserted!
const s4ShellBase: TranscriptState = {
  ...initialTranscript(),
  status: 'idle',
  turn: 1,
  blocks: [
    {
      kind: 'shell',
      command: 'pnpm test --run theme-contrast',
      output: [
        '✓ packages/tui/omdsh-tui/src/chrome/theme-contrast.spec.ts (18 tests) 112ms',
        '  ✓ WCAG AA contrast verified across Catppuccin Mocha & Latte',
        'Test Files  1 passed (1) · Tests  18 passed (18)',
      ].join('\n'),
      status: 'ok',
      code: 0,
    },
  ],
}

const s4AtDropdown = snap(s4ShellBase, {
  input: 'Audit contrast in @src/chrome/theme',
  inputCursor: 'Audit contrast in @src/chrome/theme'.length,
  autocomplete: {
    selected: 0,
    items: [
      { value: 'packages/tui/omdsh-tui/src/chrome/theme.ts', label: 'packages/tui/omdsh-tui/src/chrome/theme.ts', description: 'file · 1,024 lines', kind: 'path' },
      { value: 'packages/tui/omdsh-tui/src/chrome/theme-contrast.spec.ts', label: 'packages/tui/omdsh-tui/src/chrome/theme-contrast.spec.ts', description: 'file · 218 lines', kind: 'path' },
      { value: 'packages/tui/omdsh-tui/src/chrome/terminal-colors.ts', label: 'packages/tui/omdsh-tui/src/chrome/terminal-colors.ts', description: 'file · 312 lines', kind: 'path' },
      { value: '@session:8f31a2', label: 'Refactor narrow-width cache & footer layout', description: 'session · yesterday', kind: 'session' },
    ],
  },
})

const s4AtInserted = snap(s4ShellBase, {
  input: 'Audit contrast in @packages/tui/omdsh-tui/src/chrome/theme.ts ',
  inputCursor: 'Audit contrast in @packages/tui/omdsh-tui/src/chrome/theme.ts '.length,
  transientStatus: 'Attached file mention · Tab accepted',
})

// Coherent Flow B: Type EXACT /btw question in composer -> docked /btw pane answers THAT EXACT question!
const BTW_QUESTION = 'Why does Catppuccin Latte keep #4d6bfe for borderAccent?'
const BTW_CMD = `/btw ${BTW_QUESTION}`
const s4BtwTypingSteps: SerializedFrame[] = [0.25, 0.55, 0.82, 1.0].map((p) => {
  const txt = BTW_CMD.slice(0, Math.max(5, Math.round(BTW_CMD.length * p)))
  return snap(s4SettledState, { input: txt, inputCursor: txt.length })
})
const s4BtwAnswered = snap(
  {
    ...s4SettledState,
    blocks: [
      { kind: 'notice', level: 'info', text: 'Session resumed · branch main · 482/482 tests passing' },
      ...s4SettledState.blocks,
    ],
  },
  {
    aside: {
      question: BTW_QUESTION,
      text: 'On the Latte `#eff1f5` canvas, `#4d6bfe` achieves a **4.8:1** contrast ratio (WCAG AA) while staying visually identical to the DeepSeek brand blue. Dismissing this pane leaves your main conversation completely untouched.',
      status: 'done',
      scroll: 0,
    },
  },
)

// Coherent Flow C: /diff split pane -> Alt+Y quote -> Click #L142 source preview
const DIFF_TEXT = [
  '@@ -114,9 +114,10 @@',
  ' const DARK_PALETTE: Record<ThemeColor, Swatch> = {',
  "   accent: '#89b4fa',",
  "-  border: '#3c4259', borderAccent: '#6c8cff',",
  "+  border: '#454e70', borderAccent: '#4d6bfe',",
  "   borderMuted: '#45475a',",
  "   success: '#a6e3a1', error: '#f38ba8', warning: '#f9e2af',",
  "-  userMessageBg: '#1c2233',",
  "+  userMessageBg: '#20283f',",
  "+  toolSuccessBg: '#293b35', // Lab-checked contrast",
  "   mdCode: '#cba6f7',",
  ' }',
].join('\n')

const s4Diff = snap(initialTranscript(), {
  fileBrowser: {
    title: 'Workspace changes',
    files: [
      { path: 'packages/tui/omdsh-tui/src/chrome/theme.ts', label: 'packages/tui/omdsh-tui/src/chrome/theme.ts', status: 'M', description: '+3 -2' },
      { path: 'packages/tui/omdsh-tui/src/session/session-controller.ts', label: 'packages/tui/omdsh-tui/src/session/session-controller.ts', status: 'M', description: '+14 -6' },
      { path: 'packages/tui/omdsh-tui/src/chrome/width.ts', label: 'packages/tui/omdsh-tui/src/chrome/width.ts', status: 'M', description: '+9 -4' },
      { path: 'packages/tui/omdsh-tui/src/chrome/theme-contrast.spec.ts', label: 'packages/tui/omdsh-tui/src/chrome/theme-contrast.spec.ts', status: 'A', description: '+42 -0' },
    ],
    selected: 0,
    focus: 'document',
    filter: '',
    input: '',
    inputCursor: 0,
    mode: 'diff',
    markdown: false,
    position: { row: 0, wrap: 0, column: 0, wordWrap: true, query: '' },
    source: { text: DIFF_TEXT, diff: true, language: 'ts', status: 'Comparison · Alt+Y / Q quotes selected lines into composer' },
    message: '',
    loading: false,
    help: false,
    helpScroll: 0,
    menu: undefined,
    notice: '',
    canEdit: true,
    canQuote: true,
    truncated: false,
    limit: 256 * 1024,
  } as FileBrowserState,
})

const s4DiffQuoted = snap(s4SettledState, {
  input: 'From `src/chrome/theme.ts:116-118`: map borderAccent consistently for 16-color terminals too',
  inputCursor: 90,
  transientStatus: 'Quoted 3 lines from theme.ts into composer',
})

const SOURCE_PREVIEW_TEXT = [
  'export interface ViewCacheKeyInput {',
  '  width: number',
  '  colorDepth: ColorDepth',
  '  compactLinks: boolean',
  '  turnDetailsKey: string',
  '}',
  '',
  '/**',
  ' * Stable incremental frame cache key.',
  ' * Prevents full-viewport reflow on narrow terminals or scroll ticks.',
  ' */',
  'export function resolveTranscriptCacheKey(state: ViewCacheKeyInput): string {',
  '  const { width, colorDepth, compactLinks, turnDetailsKey } = state',
  '  return `${width}:${colorDepth}:${compactLinks ? 1 : 0}:${turnDetailsKey}`',
  '}',
  '',
  'export function shouldFreezeScrollbackRow(row: FrameRow): boolean {',
  '  return row.settled && !row.ephemeral',
  '}',
].join('\n')

const s4SourcePreview = snap(s4SettledState, {
  promptSelector: {
    request: {
      title: 'packages/tui/omdsh-tui/src/session/session-controller.ts',
      question: 'Opened from local file link · Line 142 · Native scrollback untouched',
      presentation: 'document',
      documentSource: {
        text: SOURCE_PREVIEW_TEXT,
        language: 'ts',
        firstLine: 129,
        diff: false,
        status: 'Line 142 / 318 · R reload · O open · Esc return',
      },
      options: [
        { label: 'Close', value: 'close' },
        { label: 'Open in editor', value: 'editor' },
      ],
    },
    selected: 0,
    checked: new Set(),
    documentScroll: 0,
    documentAnchor: { row: 0, wrap: 0, column: 0, wordWrap: true, query: 'return `${width}' },
    documentQuery: 'return `${width}',
  },
})

// ============================================================
// SCENE 5: AUTONOMY (/goal, /permission Auto review, /schedule, /team, /trajectory, Esc Esc)
// ============================================================
const s5GoalAutoReview = snap(
  {
    ...initialTranscript(),
    status: 'idle',
    turn: 1,
    blocks: [
      { kind: 'user', text: '/goal Migrate all renderer specs to cross-platform POSIX + Windows assertions' },
      { kind: 'notice', level: 'info', text: 'Goal armed · Auto-continuation enabled until all checks pass' },
      {
        kind: 'commandOutput',
        command: '/schedule',
        text: [
          '## Scheduled tasks · 2 active',
          '',
          '| Name | Schedule | Next run | Target |',
          '|---|---|---|---|',
          '| Nightly CI regression check | `0 2 * * *` (daily) | Tomorrow 02:00 | Cold-resume this session |',
          '| Release readiness audit | `every 30m` | In 14m | Active session follow-up |',
        ].join('\n'),
      },
    ],
  },
  {
    sessionControls: {
      agentPreset: 'standard',
      permission: 'auto',
      goal: {
        phase: 'active',
        activation: 'armed',
        objective: 'Migrate all renderer specs to cross-platform POSIX + Windows assertions',
      },
    },
    promptSelector: {
      request: {
        title: 'Access · /permission',
        question: 'Choose how omdsh may access your workspace',
        options: [
          { label: 'Workspace write', value: 'workspace-write', description: 'Sandboxed reads & writes inside this workspace' },
          {
            label: 'Auto review',
            value: 'auto',
            description: 'Current · Model pre-reviews every native tool & PTC call before execution',
            badge: { label: 'Experimental', tone: 'warning' },
          },
          { label: 'Full access', value: 'danger-full-access', description: 'Unrestricted local execution without sandbox prompts' },
          { label: 'Approval rules', value: 'rules', description: 'Inspect and revoke remembered decisions' },
        ],
      },
      selected: 1,
      checked: new Set(),
    },
  },
)

// /team Agent Teams + Subagent Roster + Workflow run
const teamMarkdown = formatTeamBoardMarkdown(true, [
  {
    id: '1',
    subject: 'Design cache invalidation & /plan',
    description: '',
    status: 'completed',
    ready: false,
    ownerName: 'planner',
    revision: 3,
    blockedBy: [],
    writeScopes: ['docs/design/*'],
    writeScopeWarnings: [],
  },
  {
    id: '2',
    subject: 'Refactor session-controller & width cache',
    description: '',
    status: 'in_progress',
    ready: false,
    ownerName: 'implementer',
    revision: 4,
    blockedBy: [],
    writeScopes: ['packages/tui/src/session/*'],
    writeScopeWarnings: [],
  },
  {
    id: '3',
    subject: 'Verify CJK alignment & PTY smoke tests',
    description: '',
    status: 'in_progress',
    ready: false,
    ownerName: 'reviewer',
    revision: 2,
    blockedBy: [],
    writeScopes: ['packages/tui/src/**/*.spec.ts'],
    writeScopeWarnings: [],
  },
])

const s5TeamFrames: SerializedFrame[] = [0, 3, 6, 9, 12, 15].map((sp) =>
  snap(
    {
      ...initialTranscript(),
      status: 'running',
      turn: 2,
      turnSpans: { 2: { start: 2000 } },
      blocks: [
        { kind: 'user', text: '/team status' },
        { kind: 'commandOutput', command: '/team status', text: teamMarkdown },
        {
          kind: 'tool',
          callId: 'tm1',
          turn: 2,
          name: 'team_task_update',
          args: JSON.stringify({ id: '2', status: 'in_progress', owner: 'implementer' }),
          status: 'ok',
          output: 'Task #2 claimed by implementer · write scopes isolated (0 conflicts)',
        },
      ],
    },
    {
      spinnerFrame: sp,
      sessionControls: { agentPreset: 'standard', permission: 'auto' },
      subagents: {
        agents: [
          {
            id: 'a1',
            depth: 1,
            name: 'planner',
            label: 'Design cache key & /plan',
            mode: 'continuable',
            phase: 'completed',
            activity: [{ kind: 'tool', label: 'write_file docs/design/tui-rendering.md' }],
          },
          {
            id: 'a2',
            depth: 1,
            name: 'implementer',
            label: 'Refactor session-controller cache',
            mode: 'continuable',
            phase: 'running',
            activity: [{ kind: 'tool', label: 'edit_file session-controller.ts (+14 -6)' }],
          },
          {
            id: 'a3',
            depth: 1,
            name: 'reviewer',
            label: 'Run CJK width & PTY smoke suite',
            mode: 'continuable',
            phase: 'running',
            activity: [{ kind: 'tool', label: 'bash pnpm smoke:happy' }],
          },
        ],
        workflows: [
          {
            id: 'wf1',
            name: 'release-verify',
            status: 'running',
            phase: 'implement & review',
            members: [
              { seq: 1, childId: 'a1', label: 'planner', phase: 'done', outcome: 'completed' },
              { seq: 2, childId: 'a2', label: 'implementer', phase: 'patching' },
              { seq: 3, childId: 'a3', label: 'reviewer', phase: 'testing' },
            ],
          },
        ],
      },
    },
  ),
)

// Real /trajectory Event Ledger!
const trajEvents: SessionEvent[] = [
  { type: 'turn/start', seq: 1, time: 1_700_000_000_000, data: { turn: 1 } },
  {
    type: 'user/message',
    seq: 2,
    time: 1_700_000_000_050,
    data: { turn: 1, message: { role: 'user', content: [{ type: 'text', text: PROMPT_S4 }] } },
  },
  {
    type: 'assistant/message',
    seq: 3,
    time: 1_700_000_001_200,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'Inspecting fitFrame & cache key invalidation across narrow terminal widths.' }],
      },
      usage: { inputTokens: 12400, outputTokens: 320 },
    },
  },
  {
    type: 'tool/call',
    seq: 4,
    time: 1_700_000_001_350,
    data: { turn: 1, step: 1, callId: 'c1', name: 'read_file', arguments: JSON.stringify({ path: 'packages/tui/omdsh-tui/src/session/session-controller.ts' }) },
  },
  {
    type: 'tool/result',
    seq: 5,
    time: 1_700_000_001_420,
    data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'Read 120 lines (0.07s)' }] } },
  },
  {
    type: 'tool/call',
    seq: 6,
    time: 1_700_000_002_100,
    data: { turn: 1, step: 2, callId: 'c2', name: 'edit_file', arguments: JSON.stringify({ path: 'packages/tui/omdsh-tui/src/session/session-controller.ts', delta: '+14 -6' }) },
  },
  {
    type: 'tool/result',
    seq: 7,
    time: 1_700_000_002_180,
    data: { turn: 1, step: 2, message: { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: 'Updated resolveTranscriptCacheKey (+14 -6)' }] } },
  },
  {
    type: 'tool/call',
    seq: 8,
    time: 1_700_000_002_600,
    data: { turn: 1, step: 2, callId: 'c3', name: 'bash', arguments: JSON.stringify({ command: 'pnpm --filter @agi-fans/dsh-tui test' }) },
  },
  {
    type: 'tool/result',
    seq: 9,
    time: 1_700_000_004_020,
    data: { turn: 1, step: 2, message: { role: 'tool', toolCallId: 'c3', content: [{ type: 'text', text: '✓ 42 test files passed · 482 tests passed (1.42s)' }] } },
  },
  { type: 'turn/end', seq: 10, time: 1_700_000_004_800, data: { turn: 1 } },
] as unknown as SessionEvent[]

const trajState = createTrajectory(trajEvents)
const s5Trajectory = snap(s4SettledState, {
  trajectory: { ...trajState, details: true, detailTab: 'summary' },
})

// Real Esc Esc Session Tree + Alt+R Snapshot Restore
const s5TreeBranch = snap(s4SettledState, {
  promptSelector: {
    request: {
      title: 'Session tree',
      presentation: 'tree',
      filterable: true,
      submitLabel: 'switch branch',
      actions: [
        { key: 'Alt+R', label: 'Restore files' },
        { key: 'Ctrl+F', label: 'Fork' },
      ],
      options: [
        {
          value: 'root',
          label: 'Analyze streaming Markdown render bottlenecks',
          description: 'snapshot #1 · 10:12',
          badge: { label: 'root', tone: 'dim' },
          previewFormat: 'markdown',
          preview: '### Turn 1 · Baseline Analysis\n\nLocated `wrapIndexed` & `fitFrame` hotspots; captured clean **snapshot #1**.',
        },
        {
          value: 'branch-a',
          parentValue: 'root',
          label: 'Branch A: Refactor cache key & narrow-width tests',
          description: 'snapshot #2 · clean',
          badge: { label: 'current', tone: 'success' },
          previewFormat: 'markdown',
          preview: [
            '### Branch A · Clean Checkpoint (snapshot #2)',
            '',
            '- `packages/tui/omdsh-tui/src/session/session-controller.ts` (+14 -6)',
            '- `packages/tui/omdsh-tui/src/chrome/width.ts` (+9 -4)',
            '- **482 / 482 tests passing** · press `Alt+R` to restore workspace files',
          ].join('\n'),
        },
        {
          value: 'branch-exp',
          parentValue: 'branch-a',
          label: 'Experiment: Rewrite full wrapping engine (3 files broken)',
          description: '3 files modified',
          badge: { label: 'experiment', tone: 'warning' },
          previewFormat: 'markdown',
          preview: '### Experiment Branch\n\n3 files diverged — jump back to Branch A and restore snapshot #2 cleanly with `Alt+R`.',
        },
        {
          value: 'branch-b',
          parentValue: 'root',
          label: 'Branch B: Benchmark 10,000-turn session replay',
          description: '2.567 ms median',
          badge: { label: 'bench', tone: 'accent' },
          previewFormat: 'markdown',
          preview: '### Benchmark Run\n\nApple M5 Pro median CPU time: **2.567 ms**.',
        },
      ],
    },
    selected: 1,
    checked: new Set(),
  },
})

const s5TreeRestored = snap(s4SettledState, {
  transientStatus: '✔ Restored file snapshot #2 · 3 files cleanly rolled back',
})

const outPath = path.resolve(import.meta.dirname, '../src/data/real-frames.json')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
const payload = {
  cols: COLS,
  rows: ROWS,
  // Scene 2: Agents
  s2AgentSelect,
  s2PtcSubcalls,
  s2PtcExpanded,
  s2Cordis,
  // Scene 3: Full Settings, Dark/Light, Plugins, MCP
  s3SettingsModels,
  s3SettingsPlugins,
  s3SettingsTerminalVerbose,
  s3SettingsTerminalLight,
  s3PluginsFrame,
  s3McpFrame,
  // Scene 4: Terminal Craft & Flow
  s4RunningFrames,
  s4Folded,
  s4Expanded,
  s4AtDropdown,
  s4AtInserted,
  s4BtwTypingSteps,
  s4BtwAnswered,
  s4Diff,
  s4DiffQuoted,
  s4SourcePreview,
  // Scene 5: Autonomy, Teams, Trajectory & Snapshots
  s5GoalAutoReview,
  s5TeamFrames,
  s5Trajectory,
  s5TreeBranch,
  s5TreeRestored,
}
fs.writeFileSync(outPath, JSON.stringify(payload))
console.log(`Captured Flagship v4 real TUI frames -> ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`)
