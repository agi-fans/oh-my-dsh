import { describe, expect, it } from 'vitest'
import type { BundleInfo, PluginInfo } from '@deepseek-ai/dsh-plugin-manager'
import { externalAgentDiagnostic, externalAgentGuide } from './external-agents.ts'
import { renderMarkdown } from '../chrome/markdown.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'

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
    const bundle = { name: '@deepseek-ai/dsh-subagent-codex', availability: 'profile', enabled: true, version: '0.2.1-rc.2',
      rows: [{ rowId: 'provider', entryId: 'p' }, { rowId: 'tool', entryId: 't' }, { rowId: 'missing' }] } as BundleInfo
    const plugins = [{ entryId: 'p', enabled: true, fiberPhase: 'failed' }, { entryId: 't', enabled: false, fiberPhase: 'pending' }] as PluginInfo[]
    expect(externalAgentDiagnostic(bundle, plugins)).toContain('| provider | Enabled · failed |')
    expect(externalAgentDiagnostic(bundle, plugins)).toContain('| tool | Disabled · pending |')
    expect(externalAgentDiagnostic(bundle, plugins)).toContain('| missing | Not mounted |')
    expect(externalAgentDiagnostic(bundle, plugins)).toContain('Not checked. Runtime startup and sign-in')
  })

  it.each([40, 80, 120])('keeps localized status and full diagnostics within %s display cells', width => {
    const bundle = { name: '@deepseek-ai/dsh-subagent-codex', availability: 'profile', enabled: true, version: '1.0',
      rows: [{ rowId: '工具|组件🐳', entryId: 'tool' }] } as BundleInfo
    const plugins = [{ entryId: 'tool', enabled: true, fiberPhase: 'failed', diagnostic: '加载失败 e\u0301🐳\n' + '/long/path/'.repeat(30) }] as PluginInfo[]
    for (const language of ['en', 'zh-CN'] as const) {
      const report = externalAgentDiagnostic(bundle, plugins, language)
      expect(report).toContain(plugins[0]!.diagnostic!.split('\n')[1])
      for (const colors of [false, true]) {
        const lines = renderMarkdown(report, createTheme(colors, true, 'dark', undefined, language), width)
        expect(lines.every(line => visibleWidth(line) <= width)).toBe(true)
        expect(lines.map(stripAnsi).join('\n')).toContain(language === 'en' ? 'Components' : '组件')
      }
    }
  })
})
