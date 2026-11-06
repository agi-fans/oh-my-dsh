/** Client-visible context diagnostics without exposing prompt contents. */

import type { ContextBreakdownProjection, ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { formatTokens } from '../chrome/status-line.ts'

export interface ContextDiagnostics {
  readonly pressure?: ContextPressureProjection
  readonly usage?: TokenUsageProjection
  readonly breakdown?: ContextBreakdownProjection
}

/** Current Harness projections and session identity shown by /context. */
export interface ContextOverview extends ContextDiagnostics {
  sessionId: string
  model: string
  reasoning?: string
  agent: string
  workflow: string
  access?: string
  turns: number
  steps: number
  inputTokens: number
  outputTokens: number
  followUp: number
  steering: number
}

export function contextOverviewDetails(snapshot: ContextOverview): string {
  return [contextDiagnosticsMarkdown(snapshot), '', '## Session', '', '| Field | Value |', '|---|---|',
    `| Session | \`${snapshot.sessionId}\` |`,
    `| Model | \`${snapshot.model}\` |`,
    `| Reasoning | \`${snapshot.reasoning ?? 'unavailable'}\` |`,
    `| Agent | ${snapshot.agent} |`,
    `| Workflow | ${snapshot.workflow} |`,
    ...(snapshot.access === undefined ? [] : [`| Access | ${snapshot.access} |`]),
    `| Activity | ${snapshot.turns} turns · ${snapshot.steps} steps |`,
    `| Tokens | ${formatTokens(snapshot.inputTokens)} in · ${formatTokens(snapshot.outputTokens)} out |`,
    `| Queue | ${snapshot.followUp} follow-up · ${snapshot.steering} steering |`,
  ].join('\n')
}

function value(tokens: number | undefined): string {
  return tokens === undefined ? 'unavailable' : formatTokens(tokens)
}

export function contextDiagnosticsMarkdown(diagnostics: ContextDiagnostics): string {
  const pressure = diagnostics.pressure
  const usage = diagnostics.usage
  const breakdown = diagnostics.breakdown
  const remaining = pressure?.contextWindow !== undefined && pressure.projectedTokens !== undefined
    ? Math.max(0, pressure.contextWindow - pressure.projectedTokens)
    : undefined
  const occupancy = pressure?.contextWindow !== undefined && pressure.projectedTokens !== undefined && pressure.contextWindow > 0
    ? `${Math.min(100, pressure.projectedTokens / pressure.contextWindow * 100).toFixed(1)}%`
    : 'unavailable'
  return [
    'Context Details',
    '',
    occupancy === 'unavailable' ? 'Context usage is not available yet.' : `**${occupancy} used** · ${value(remaining)} tokens remaining`,
    '',
    '## Occupancy',
    '',
    '| Metric | Tokens |',
    '|---|---:|',
    `| Context window | ${value(pressure?.contextWindow)} |`,
    `| Next request (projected) | ${value(pressure?.projectedTokens)} |`,
    `| Last provider sample | ${value(pressure?.pressureTokens)} |`,
    `| Remaining budget | ${value(remaining)} |`,
    `| Pressure | ${occupancy} |`,
    '',
    '## Cumulative provider usage',
    '',
    '| Bucket | Tokens |',
    '|---|---:|',
    `| Non-cache input | ${value(usage?.uncachedInputTokens)} |`,
    `| Cache read | ${value(usage?.cacheReadTokens)} |`,
    `| Cache write | ${value(usage?.cacheWriteTokens)} |`,
    `| Output | ${value(usage?.outputTokens)} |`,
    '',
    '## Approximate next-request composition',
    '',
    '> These categories are heuristic estimates and do not sum to the provider-anchored projection above.',
    '',
    '| Source | Estimated tokens |',
    '|---|---:|',
    `| System prompt | ${value(breakdown?.systemTokens)} |`,
    `| Tool schemas | ${value(breakdown?.toolsTokens)} |`,
    `| Conversation messages | ${value(breakdown?.messageTokens)} |`,
    '| Attachments | unavailable |',
  ].join('\n')
}
