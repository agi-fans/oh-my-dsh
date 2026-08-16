/** Small, truthful startup hints sampled once for each TUI process. */

/** One compact key/action pair rendered in the welcome card. */
export interface WelcomeTip {
  key: string
  text: string
}

/** Capabilities worth surfacing without turning the welcome card into a manual. */
export const WELCOME_TIPS: readonly WelcomeTip[] = [
  { key: '/', text: 'Browse available commands' },
  { key: 'Tab', text: 'Complete commands and paths' },
  { key: 'Ctrl+R', text: 'Search and reuse prompt history' },
  { key: 'Ctrl+O', text: 'Expand or collapse tool output' },
  { key: 'PgUp/PgDn', text: 'Scroll through the transcript' },
  { key: 'Shift+Enter/Ctrl+J', text: 'Insert a newline in the composer' },
  { key: 'Ctrl+C ×2', text: 'Exit with a resumable session hint' },
  { key: '/resume', text: 'Continue a durable session' },
  { key: '/model', text: 'Switch model and reasoning effort' },
  { key: '/login', text: 'Configure and validate your DeepSeek API key' },
  { key: '/plan', text: 'Plan before making workspace changes' },
  { key: '/loop', text: 'Repeat a prompt after each completed turn' },
  { key: '/permission', text: 'Choose the session permission' },
  { key: '/settings', text: 'Customize appearance and status' },
  { key: '/copy code', text: 'Copy the latest code block' },
  { key: 'Esc Esc', text: 'Rewind to an earlier conversation turn' },
  { key: 'Ctrl+V', text: 'Paste an image or clipboard text' },
  { key: '/tools', text: 'Inspect tools available to the agent' },
  { key: '/mcp', text: 'Inspect connected MCP servers' },
  { key: '/changelog', text: 'Read recent release notes' },
]

/** Pick distinct hints without mutating the shared catalog. */
export function pickWelcomeTips(
  random: () => number = Math.random,
  count: number = 4,
): readonly WelcomeTip[] {
  const pool = [...WELCOME_TIPS]
  const picked: WelcomeTip[] = []
  const limit = Math.max(0, Math.min(Math.floor(count), pool.length))
  while (picked.length < limit) {
    const sample = Math.max(0, Math.min(0.9999999999999999, random()))
    const index = Math.floor(sample * pool.length)
    const [tip] = pool.splice(index, 1)
    if (tip !== undefined) picked.push(tip)
  }
  return picked
}
