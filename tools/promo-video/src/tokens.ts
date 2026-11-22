export const FPS = 60
export const WIDTH = 1920
export const HEIGHT = 1080
export const TOTAL_FRAMES = 4320 // 72.0s Flagship @ 60fps = 144 beats @ 120 BPM

export const SCENES = {
  intro: { from: 0, duration: 480 },        // 0:00 - 0:08 (8s)
  agents: { from: 480, duration: 720 },     // 0:08 - 0:20 (12s) - Standard / PTC / Cordis / Minimal
  settings: { from: 1200, duration: 720 },  // 0:20 - 0:32 (12s) - Full 6-tab Settings + Dark/Light + Plugins & MCP
  craft: { from: 1920, duration: 960 },     // 0:32 - 0:48 (16s) - Fold/Ctrl+O/Telemetry + !shell/@ + /btw + /diff/#L142
  autonomy: { from: 2880, duration: 720 },  // 0:48 - 1:00 (12s) - /goal + Auto review + /schedule + /team + /trajectory + Esc Esc
  speed: { from: 3600, duration: 360 },     // 1:00 - 1:06 (6s)  - 2.567ms / 0.383ms / 0.212ms
  outro: { from: 3960, duration: 360 },     // 1:06 - 1:12 (6s)  - npm i -g & Hero Lockup
} as const

export const BRAND = {
  bg: '#060a12',
  bgRaise: '#0b1120',
  panel: '#0e1628',
  line: '#1d2a45',
  ink: '#d9deea',
  inkDim: '#99a1b6',
  inkFaint: '#626b84',
  blue: '#4d6bfe',
  blueBright: '#7c93ff',
  cyan: '#35c8de',
  cyanBright: '#7ce7f2',
  ok: '#a6e3a1',
  warn: '#f9e2af',
  danger: '#f38ba8',
  mauve: '#cba6f7',
  grad: 'linear-gradient(120deg, #4d6bfe 15%, #35c8de 85%)',
} as const

export const FONT = {
  sans: "'Space Grotesk Variable', 'PingFang SC', 'Hiragino Sans GB', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'JetBrains Mono Variable', 'Menlo', 'PingFang SC', 'Hiragino Sans GB', monospace",
} as const

export interface TuiPalette {
  bg: string
  chromeBg: string
  border: string
  borderMuted: string
  borderAccent: string
  text: string
  muted: string
  dim: string
  accent: string
  success: string
  error: string
  warning: string
  mauve: string
  cyan: string
  userBg: string
  toolPendingBg: string
  toolSuccessBg: string
  toolErrorBg: string
  toolAltBg: string
  diffAddedBg: string
  diffRemovedBg: string
}

export const TUI_DARK: TuiPalette = {
  bg: '#161722',
  chromeBg: '#1b1d2b',
  border: '#454e70',
  borderMuted: '#34384c',
  borderAccent: '#4d6bfe',
  text: '#cdd6f4',
  muted: '#bac2de',
  dim: '#7f86a3',
  accent: '#89b4fa',
  success: '#a6e3a1',
  error: '#f38ba8',
  warning: '#f9e2af',
  mauve: '#cba6f7',
  cyan: '#89dceb',
  userBg: '#20283f',
  toolPendingBg: '#282a3b',
  toolSuccessBg: '#20312b',
  toolErrorBg: '#3a2430',
  toolAltBg: '#222536',
  diffAddedBg: 'rgba(166, 227, 161, 0.14)',
  diffRemovedBg: 'rgba(243, 139, 168, 0.14)',
}

export const TUI_LIGHT: TuiPalette = {
  bg: '#eff1f5',
  chromeBg: '#e4e7ef',
  border: '#a0adca',
  borderMuted: '#cbd0dc',
  borderAccent: '#4d6bfe',
  text: '#4c4f69',
  muted: '#5c5f77',
  dim: '#7c8198',
  accent: '#245ac7',
  success: '#386b35',
  error: '#b52e4d',
  warning: '#805d16',
  mauve: '#783ab0',
  cyan: '#17758a',
  userBg: '#e1e8fa',
  toolPendingBg: '#e3e6ee',
  toolSuccessBg: '#dce9dc',
  toolErrorBg: '#f2dfe5',
  toolAltBg: '#e6e9f2',
  diffAddedBg: 'rgba(56, 107, 53, 0.12)',
  diffRemovedBg: 'rgba(181, 46, 77, 0.12)',
}

export const DEEPSEEK_LOGO = [
  '         ⢀⣀  ⢀⡀     ',
  '⢀⣤⣶⣿⣿⣿⣿⣿⣿⣿⣧⣄⡀⢻⣿⣷⣶⣶⣶⡿',
  '⣿⡟⠛⠛⠛⠿⢿⣿⣿⣿⣿⡿⢿⣷⣾⣿⣿⠉⠉ ',
  '⢻⣿⣄⡀  ⢀⠈⠛⢿⣿⣿⣶⣿⣿⡿⠃   ',
  ' ⠙⠻⢿⣶⣦⣼⣿⣷⣦⣭⣿⠿⣿⣷⠦    ',
  '     ⠉⠉⠉⠉⠉⠁         ',
] as const

const GRADIENT_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [47, 73, 224],
  [77, 107, 254],
  [53, 200, 222],
  [124, 231, 242],
]

export function whaleGradientColor(col: number, row: number, cols = 20, rows = 6): string {
  const t = Math.max(0, Math.min(1, (col / Math.max(1, cols - 1)) * 0.78 + (row / Math.max(1, rows - 1)) * 0.22))
  const seg = t * (GRADIENT_STOPS.length - 1)
  const i = Math.min(GRADIENT_STOPS.length - 2, Math.floor(seg))
  const f = seg - i
  const a = GRADIENT_STOPS[i]!
  const b = GRADIENT_STOPS[i + 1]!
  const r = Math.round(a[0] + (b[0] - a[0]) * f)
  const g = Math.round(a[1] + (b[1] - a[1]) * f)
  const bl = Math.round(a[2] + (b[2] - a[2]) * f)
  return `rgb(${r}, ${g}, ${bl})`
}

export function beatPulse(frame: number): number {
  const phase = (frame % 30) / 30
  return Math.exp(-phase * 6.5)
}

export function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return 1 - Math.pow(1 - c, 3)
}

export function easeOutQuint(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return 1 - Math.pow(1 - c, 5)
}

export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}
