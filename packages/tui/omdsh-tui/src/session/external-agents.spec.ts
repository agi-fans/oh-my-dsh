import { describe, expect, it } from 'vitest'
import type { BundleInfo, PluginInfo } from '@deepseek-ai/dsh-plugin-manager'
import { externalAgentDiagnostic, externalAgentGuide } from './external-agents.ts'

describe('native external Agent guidance', () => {
  it.each(['codex', 'claude-code'])('describes bundled runtime and independent permissions for %s', provider => {
    const guide = externalAgentGuide(`@deepseek-ai/dsh-subagent-${provider}`)
    expect(guide).toContain('no executable from PATH')
    expect(guide).toContain('independent of the parent’s Access')
    expect(guide).toContain('no continuation or local transcript')
    expect(guide).toContain('scrubbed')
  })
  it('does not apply native guidance to an unrelated bundle', () => {
    expect(externalAgentGuide('@deepseek-ai/dsh-subagent-acp')).toBeUndefined()
  })
  it('reports actual disabled, failed and absent rows without claiming payload or authentication readiness', () => {
    const bundle = { name: '@deepseek-ai/dsh-subagent-codex', availability: 'profile', enabled: true, version: '0.2.1-alpha.2',
      rows: [{ rowId: 'provider', entryId: 'p' }, { rowId: 'tool', entryId: 't' }, { rowId: 'missing' }] } as BundleInfo
    const plugins = [{ entryId: 'p', enabled: true, fiberPhase: 'failed' }, { entryId: 't', enabled: false, fiberPhase: 'pending' }] as PluginInfo[]
    expect(externalAgentDiagnostic(bundle, plugins)).toContain('provider: enabled · failed')
    expect(externalAgentDiagnostic(bundle, plugins)).toContain('tool: disabled · pending')
    expect(externalAgentDiagnostic(bundle, plugins)).toContain('missing: not mounted')
    expect(externalAgentDiagnostic(bundle, plugins)).toContain('authentication: not tested')
  })
})
