import { formatTokens } from '../chrome/status-line.ts'
import type { Theme } from '../chrome/theme.ts'
import { padToWidth, wrapTextStable } from '../chrome/width.ts'
import type { ContextOverview } from '../session/context-diagnostics.ts'

/** Occupancy uses the calibrated projection; category estimates have their own rows. */
export function renderContextOverview(snapshot: ContextOverview, theme: Theme, width: number): string[] {
  const { pressure, breakdown } = snapshot
  const window = pressure?.contextWindow
  const projected = pressure?.projectedTokens
  const known = window !== undefined && window > 0 && projected !== undefined
  const ratio = known ? Math.max(0, Math.min(1, projected / window)) : 0
  const tone = ratio >= 0.9 ? 'error' : ratio >= 0.75 ? 'warning' : 'accent'
  const used = known ? `${formatTokens(projected)} / ${formatTokens(window)} · ${(projected / window * 100).toFixed(1)}%`
    : theme.text('Context usage is not available yet.')
  const remaining = known ? theme.text('{tokens} tokens remaining', { tokens: formatTokens(Math.max(0, window - projected)) }) : ''
  const estimate = (tokens: number | undefined): string => tokens === undefined ? theme.text('unavailable') : `≈ ${formatTokens(tokens)}`
  const categories = [
    [theme.text('System prompt'), breakdown?.systemTokens],
    [theme.text('Tool schemas'), breakdown?.toolsTokens],
    [theme.text('Conversation messages'), breakdown?.messageTokens],
  ] as const
  const categoryRows = categories.map(([label, tokens]) => padToWidth(label, Math.min(24, Math.max(1, width - 14))) + '  ' + estimate(tokens))
  const lines: string[] = []
  if (width >= 58 && known) {
    const count = Math.round(ratio * 40)
    const labels = [theme.bold(used), theme.fg('muted', remaining), theme.bold(theme.text('Estimated composition')), ...categoryRows]
    for (let row = 0; row < labels.length; row++) {
      const cells = row < 4 ? Array.from({ length: 10 }, (_, column) => row * 10 + column < count
        ? theme.fg(tone, '■') : theme.fg('dim', '·')).join(' ') : ' '.repeat(19)
      lines.push(cells + '    ' + labels[row])
    }
  } else {
    lines.push(theme.bold(used))
    if (known) {
      const cells = Math.max(1, Math.min(32, width))
      const filled = Math.round(ratio * cells)
      lines.push(theme.fg(tone, '━'.repeat(filled)) + theme.fg('dim', '─'.repeat(cells - filled)), theme.fg('muted', remaining))
    }
    lines.push('', theme.bold(theme.text('Estimated composition')), ...categoryRows)
  }
  lines.push(theme.fg('dim', theme.text('Estimates use a separate token count.')),
    '', theme.bold(theme.text('This session')) + '  ' + theme.text('{turns} turns · {steps} steps', { turns: snapshot.turns, steps: snapshot.steps }),
    theme.text('Input {input} · Output {output}', { input: formatTokens(snapshot.inputTokens), output: formatTokens(snapshot.outputTokens) }),
    theme.fg('muted', [theme.text(snapshot.agent), theme.text(snapshot.workflow), ...(snapshot.access === undefined ? [] : [theme.text(snapshot.access)])].join(' · ')))
  return lines.flatMap(line => wrapTextStable(line, Math.max(1, width)))
}
