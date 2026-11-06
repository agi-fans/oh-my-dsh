/** Guidance and observable profile state for native one-shot Agent bundles. */
import type { BundleInfo, PluginInfo } from '@deepseek-ai/dsh-plugin-manager'
import { uiText, type UiLanguage } from '../locale/index.ts'

export function externalAgentSummary(bundle: string, language: UiLanguage = 'en'): string | undefined {
  const label = bundle === '@deepseek-ai/dsh-subagent-codex' ? 'Codex'
    : bundle === '@deepseek-ai/dsh-subagent-claude-code' ? 'Claude Code' : undefined
  if (label === undefined) return
  return [
    uiText(language, 'Bundled runtime · {name}', { name: label }),
    uiText(language, 'Model and sign-in follow native settings. Subagent permissions are configured separately.'),
  ].join('\n')
}

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
export function externalAgentDiagnostic(bundle: BundleInfo, plugins: readonly PluginInfo[], language: UiLanguage = 'en'): string {
  const t = (text: string) => uiText(language, text)
  const cell = (text: string) => text.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/[\r\n]+/gu, ' ')
  const installation = bundle.availability === 'missing' ? bundle.installed ? 'Declared in profile, files unavailable' : 'Not installed'
    : bundle.availability === 'installation' ? 'Included with omdsh' : 'Installed in profile'
  const entries = bundle.rows.map(row => ({ row, entry: plugins.find(entry => entry.entryId === row.entryId) }))
  const diagnostics = [
    ...(bundle.error === undefined ? [] : [{ name: bundle.name, text: bundle.error.diagnostic ?? bundle.error.code }]),
    ...entries.flatMap(({ row, entry }) => entry?.diagnostic === undefined ? [] : [{ name: row.rowId, text: entry.diagnostic }]),
  ]
  return [
    `| ${t('Item')} | ${t('Details')} |`, '| --- | --- |',
    `| ${t('Package')} | ${cell(bundle.name)} |`,
    `| ${t('Version')} | ${cell(bundle.version ?? bundle.installTarget?.version ?? t('Unknown'))} |`,
    `| ${t('Installation')} | ${t(installation)} |`,
    `| ${t('Profile')} | ${t(bundle.enabled ? 'Enabled' : 'Disabled')} |`, '',
    `### ${t('Components')}`, '',
    ...(entries.length === 0 ? [t('No component entries are registered.')] : [
      `| ${t('Component')} | ${t('State')} |`, '| --- | --- |',
      ...entries.map(({ row, entry }) => `| ${cell(row.rowId)} | ${entry === undefined ? t('Not mounted') : `${t(entry.enabled ? 'Enabled' : 'Disabled')} · ${t(entry.fiberPhase ?? 'Unknown')}`} |`),
    ]), '',
    `### ${t('Runtime and sign-in')}`, '',
    t('Not checked. Runtime startup and sign-in require a real delegated task to verify.'),
    ...diagnostics.flatMap(diagnostic => ['', `### ${t('Diagnostic')} · ${cell(diagnostic.name)}`, '',
      ...diagnostic.text.split('\n').map(line => '    ' + line)]),
  ].join('\n')
}
