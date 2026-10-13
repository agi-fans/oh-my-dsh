/** Guidance and observable profile state for native one-shot Agent bundles. */
import type { BundleInfo, PluginInfo } from '@deepseek-ai/dsh-plugin-manager'

export function externalAgentGuide(bundle: string): string | undefined {
  const codex = bundle === '@deepseek-ai/dsh-subagent-codex'
  if (!codex && bundle !== '@deepseek-ai/dsh-subagent-claude-code') return
  return [
    `${codex ? 'Codex' : 'Claude Code'} uses the bundle’s pinned platform runtime; no executable from PATH is used. Install optional dependencies and restart if the installer requests it.`,
    `Native ${codex ? 'Codex' : 'Claude'} login and user/project settings remain authoritative. omdsh does not sign in or inspect stored credentials. An omitted model inherits native settings.`,
    `The child’s permissionMode is independent of the parent’s Access. The default is ${codex ? 'never' : 'dontAsk'}; choose a broader mode only deliberately.`,
    'Explicit env overrides are configured in the provider’s profile patch. Credential-shaped ambient variables are scrubbed; do not assume the parent’s API key is inherited.',
    `The global ${codex ? 'subagent_codex' : 'subagent_claude_code'} tool starts a fresh text-only task, returns its final result to the parent, and provides no continuation or local transcript.`,
  ].join('\n\n')
}

/** Profile registration is observable; authentication and payload startup require a real delegation. */
export function externalAgentDiagnostic(bundle: BundleInfo, plugins: readonly PluginInfo[]): string {
  return [
    `${bundle.name} · ${bundle.version ?? bundle.installTarget?.version ?? 'version unknown'}`,
    `Package: ${bundle.availability === 'missing' ? bundle.installed ? 'declared in profile, files unavailable' : 'not installed' : `available (${bundle.availability})`}`,
    `Profile: ${bundle.enabled ? 'enabled' : 'disabled'}`,
    ...(bundle.error === undefined ? [] : [`Load error: ${bundle.error.diagnostic ?? bundle.error.code}`]),
    ...bundle.rows.map(row => {
      const entry = plugins.find(entry => entry.entryId === row.entryId)
      return `${row.rowId}: ${entry === undefined ? 'not mounted' : `${entry.enabled ? 'enabled' : 'disabled'} · ${entry.fiberPhase ?? 'phase unknown'}`}`
    }),
    'Native payload startup and authentication: not tested. This check sends no model request and reads no credentials.',
  ].join('\n')
}
