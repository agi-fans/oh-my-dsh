/**
 * Drives the REAL `omdsh` binary over a real `node-pty` pseudo-terminal into
 * `@xterm/headless` (104x29, 24-bit TrueColor), sending real keystrokes and
 * capturing authentic screen buffers with zero hand-fabricated UI!
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const PROMO_ROOT = path.resolve(import.meta.dirname, '..')
const REPO_ROOT = path.resolve(PROMO_ROOT, '../..')

const repoRequire = createRequire(path.join(REPO_ROOT, 'package.json'))
const promoRequire = createRequire(path.join(PROMO_ROOT, 'package.json'))

const pty = repoRequire('node-pty')
const { Terminal } = promoRequire('@xterm/headless')

const COLS = 104
const ROWS = 29

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Create isolated temporary OMDSH_HOME with clean default profile + real local stdio MCP servers
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omdsh-live-capture-'))
const demoMcpScript = path.join(PROMO_ROOT, 'scripts/demo-mcp-server.mjs')
fs.writeFileSync(
  path.join(home, 'mcp.json'),
  JSON.stringify(
    {
      mcpServers: {
        github: { command: process.execPath, args: [demoMcpScript, 'github'] },
        memory: { command: process.execPath, args: [demoMcpScript, 'memory'] },
      },
    },
    null,
    2,
  ),
)

const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key === 'OMDSH' || key === 'TMUX' || key === 'TMUX_PANE' || key.startsWith('HERDR_') || key.startsWith('HC_')) {
    delete env[key]
  }
}
delete env.NO_COLOR
env.OMDSH_HOME = home
env.LC_ALL = 'en_US.UTF-8'
env.LANG = 'en_US.UTF-8'
env.TERM = 'xterm-256color'
env.COLORTERM = 'truecolor'
env.DEEPSEEK_API_KEY = 'sk-demo-capture-key'

const xterm = new Terminal({
  cols: COLS,
  rows: ROWS,
  scrollback: 2000,
  allowProposedApi: true,
})

let pendingWrite = Promise.resolve()
function feedXterm(chunk) {
  pendingWrite = pendingWrite.then(
    () =>
      new Promise((resolve) => {
        xterm.write(chunk, resolve)
      }),
  )
}

function screenText() {
  const buf = xterm.buffer.active
  const base = buf.baseY
  const out = []
  for (let y = 0; y < ROWS; y++) {
    const line = buf.getLine(base + y)
    out.push(line ? line.translateToString(true) : '')
  }
  return out.join('\n')
}

async function waitForScreen(predicate, label, timeoutMs = 45000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await pendingWrite
    const txt = screenText()
    if (predicate(txt)) {
      await sleep(220)
      await pendingWrite
      return txt
    }
    await sleep(120)
  }
  await pendingWrite
  console.error(`TIMEOUT waiting for ${label}. Current screen:\n${screenText()}`)
  throw new Error(`Timeout waiting for ${label}`)
}

async function captureFrame(theme = 'dark', cursorVisible = true) {
  await pendingWrite
  const buf = xterm.buffer.active
  const base = buf.baseY
  const lines = []
  const reusableCell = buf.getNullCell()

  for (let y = 0; y < ROWS; y++) {
    const line = buf.getLine(base + y)
    if (!line) {
      lines.push('')
      continue
    }
    let rowStr = ''
    let prevSig = ''
    for (let x = 0; x < COLS; x++) {
      const cell = line.getCell(x, reusableCell)
      if (!cell) continue
      const w = cell.getWidth()
      if (w === 0) continue // trailing half of wide char
      const ch = cell.getChars() || ' '

      const codes = []
      if (cell.isBold()) codes.push('1')
      if (cell.isDim()) codes.push('2')
      if (cell.isItalic()) codes.push('3')
      if (cell.isUnderline()) codes.push('4')
      if (cell.isInverse()) codes.push('7')
      if (cell.isStrikethrough()) codes.push('9')

      if (cell.isFgRGB()) {
        const c = cell.getFgColor()
        codes.push(`38;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}`)
      } else if (cell.isFgPalette()) {
        codes.push(`38;5;${cell.getFgColor()}`)
      }

      if (cell.isBgRGB()) {
        const c = cell.getBgColor()
        codes.push(`48;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}`)
      } else if (cell.isBgPalette()) {
        codes.push(`48;5;${cell.getBgColor()}`)
      }

      const sig = codes.join(';')
      if (sig !== prevSig) {
        rowStr += sig === '' ? '\x1b[0m' : `\x1b[0;${sig}m`
        prevSig = sig
      }
      rowStr += ch
    }
    if (prevSig !== '') rowStr += '\x1b[0m'
    lines.push(rowStr)
  }

  return {
    lines,
    cursor: { row: buf.cursorY, column: buf.cursorX },
    cursorVisible,
    theme,
  }
}

const term = pty.spawn('pnpm', ['exec', 'tsx', 'apps/omdsh/src/bin.ts'], {
  name: 'xterm-256color',
  cols: COLS,
  rows: ROWS,
  cwd: REPO_ROOT,
  env,
})

term.onData((data) => feedXterm(data))

const send = async (str, waitMs = 260) => {
  term.write(str)
  await sleep(waitMs)
  await pendingWrite
}

const captured = {}

try {
  // 1. Boot real omdsh and wait for welcome screen
  await waitForScreen((t) => t.includes('Into the Unknown') && t.includes('Ask anything'), 'omdsh boot')
  captured.liveWelcome = await captureFrame('dark', true)
  console.log('[1] Captured liveWelcome')

  // 2. Capture REAL /agent picker cycling through presets!
  await send('/agent\r', 400)
  await waitForScreen((t) => t.includes('Agent') && (t.includes('Standard') || t.includes('standard')), '/agent picker')
  captured.liveAgent0 = await captureFrame('dark', false)
  console.log('[2a] Captured liveAgent0:\n' + screenText().split('\n').filter((l) => l.trim()).slice(-14).join('\n'))
  await send('\x1b[B', 260) // Down
  captured.liveAgent1 = await captureFrame('dark', false)
  await send('\x1b[B', 260) // Down
  captured.liveAgent2 = await captureFrame('dark', false)
  await send('\x1b[B', 260) // Down
  captured.liveAgent3 = await captureFrame('dark', false)
  await send('\x1b', 350) // Esc close
  await waitForScreen((t) => t.includes('Ask anything'), 'return after /agent')

  // 3. Capture REAL /model picker
  await send('/model\r', 400)
  await waitForScreen((t) => t.includes('Model') && !t.includes('Ask anything'), '/model picker')
  captured.liveModel = await captureFrame('dark', false)
  console.log('[3] Captured liveModel:\n' + screenText().split('\n').filter((l) => l.trim()).slice(-12).join('\n'))
  await send('\x1b', 350)
  await waitForScreen((t) => t.includes('Ask anything'), 'return after /model')

  // 4. Capture REAL /settings across ALL 6 tabs (General, Models, Agent presets, Plugins, Terminal, Advanced)!
  await send('/settings\r', 450)
  await waitForScreen((t) => t.includes('Settings') && t.includes('General') && t.includes('Models'), '/settings open')
  captured.liveSettingsGeneral = await captureFrame('dark', false)
  console.log('[4a] Captured liveSettingsGeneral')

  await send('\t', 320) // Tab -> Models
  captured.liveSettingsModels = await captureFrame('dark', false)
  console.log('[4b] Captured liveSettingsModels:\n' + screenText().split('\n').filter((l) => l.trim()).slice(-14).join('\n'))

  await send('\t', 320) // Tab -> Agent presets
  captured.liveSettingsPresets = await captureFrame('dark', false)
  console.log('[4c] Captured liveSettingsPresets')

  await send('\t', 320) // Tab -> Plugins
  captured.liveSettingsPlugins = await captureFrame('dark', false)
  console.log('[4d] Captured liveSettingsPlugins:\n' + screenText().split('\n').filter((l) => l.trim()).slice(-14).join('\n'))

  await send('\t', 320) // Tab -> Terminal
  captured.liveSettingsTerminalDark = await captureFrame('dark', false)
  console.log('[4e] Captured liveSettingsTerminalDark')

  // Switch theme from dark -> light live inside real /settings -> Terminal!
  await send('\x1b[C', 380) // Right arrow on Theme row (first item in Terminal!)
  const afterTheme = screenText()
  console.log('[4e-theme] After Right arrow on Theme:\n' + afterTheme.split('\n').filter((l) => l.includes('Theme')).join('\n'))
  if (!afterTheme.includes('light')) {
    await send('\x1b[C', 380)
  }
  captured.liveSettingsTerminalLight = await captureFrame('light', false)
  console.log('[4f] Captured liveSettingsTerminalLight')

  // Restore dark theme before moving on
  await send('\x1b[D', 320)
  if (!screenText().includes('dark')) await send('\x1b[D', 320)

  await send('\t', 320) // Tab -> Advanced (if present)
  captured.liveSettingsAdvanced = await captureFrame('dark', false)
  console.log('[4g] Captured liveSettingsAdvanced')

  await send('\x1b', 350) // Close /settings
  await waitForScreen((t) => t.includes('Ask anything'), 'return after /settings')

  // 5. Capture REAL /plugins menu + REAL Bundles list (3 downs -> Bundles -> Enter)!
  await send('/plugins\r', 450)
  await waitForScreen((t) => t.includes('Plugins') && t.includes('Bundles'), '/plugins home')
  captured.livePluginsHome = await captureFrame('dark', false)
  console.log('[5a] Captured livePluginsHome')
  await send('\x1b[B', 160) // Let the agent create a plugin
  await send('\x1b[B', 160) // Plugin entries
  await send('\x1b[B', 160) // Bundles
  await send('\r', 550)
  await waitForScreen((t) => t.includes('Bundles') || t.includes('codex') || t.includes('worktree'), '/plugins Bundles')
  captured.livePluginsBundles = await captureFrame('dark', false)
  console.log('[5b] Captured livePluginsBundles:\n' + screenText().split('\n').filter((l) => l.trim()).slice(-14).join('\n'))
  await send('\x1b', 320)
  await send('\x1b', 350)
  await waitForScreen((t) => t.includes('Ask anything'), 'return after /plugins')

  // 6. Capture REAL /mcp panel (with live connected stdio MCP servers)!
  await send('/mcp\r', 700)
  await waitForScreen((t) => t.includes('MCP') && (t.includes('github') || t.includes('memory')) && !t.includes('Ask anything'), '/mcp open with live servers')
  await sleep(300)
  captured.liveMcp = await captureFrame('dark', false)
  console.log('[6] Captured liveMcp:\n' + screenText().split('\n').filter((l) => l.trim()).slice(-15).join('\n'))
  await send('\x1b', 350)
  await waitForScreen((t) => t.includes('Ask anything'), 'return after /mcp')

  // 7. Capture REAL /permission panel (highlighting Auto review)!
  await send('/permission\r', 450)
  await waitForScreen((t) => t.includes('Access') && t.includes('Auto review'), '/permission open')
  captured.livePermission0 = await captureFrame('dark', false)
  await send('\x1b[B', 200) // Full access
  await send('\x1b[B', 260) // Auto review
  captured.livePermissionAuto = await captureFrame('dark', false)
  console.log('[7] Captured livePermissionAuto:\n' + screenText().split('\n').filter((l) => l.trim()).slice(-12).join('\n'))
  await send('\x1b', 350)
  await waitForScreen((t) => t.includes('Ask anything'), 'return after /permission')

  // 8. Capture REAL !shell inline card + @ file autocomplete + Tab insertion!
  await send('!git status --short --branch\r', 700)
  await waitForScreen((t) => t.includes('## main') || t.includes('git status'), '!shell card')
  await sleep(350)
  await send('Audit contrast in @packages/tui/omdsh-tui/src/chrome/theme', 600)
  await waitForScreen((t) => t.includes('theme.ts'), '@mention autocomplete')
  captured.liveShellAtDropdown = await captureFrame('dark', true)
  console.log('[8a] Captured liveShellAtDropdown')
  await send('\t', 320) // Tab insert!
  captured.liveShellAtInserted = await captureFrame('dark', true)
  console.log('[8b] Captured liveShellAtInserted')

  // Save all live frames
  const outPath = path.join(PROMO_ROOT, 'src/data/live-frames.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify({ cols: COLS, rows: ROWS, ...captured }))
  console.log(`\nSUCCESS! Saved ${Object.keys(captured).length} REAL live omdsh frames -> ${outPath}`)
} finally {
  try {
    term.kill()
  } catch {}
  fs.rmSync(home, { recursive: true, force: true })
}
