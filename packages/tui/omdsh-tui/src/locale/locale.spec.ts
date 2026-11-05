import { describe, expect, it } from 'vitest'
import { resolveUiLanguage, uiText } from './index.ts'
import { localizePrompt } from './prompt.ts'
import { zh } from './zh.ts'
import { createTheme } from '../chrome/theme.ts'
import { applySettingsEvent, createSettings, renderSettings } from '../views/settings-list.ts'
import { renderPromptSelector, selectedPromptAnswer } from '../views/prompt-selector.ts'
import { visibleWidth } from '../chrome/width.ts'

describe('terminal languages', () => {
  it('resolves an explicit choice and POSIX locale precedence without persisting detection', () => {
    expect(resolveUiLanguage('en', { LANG: 'zh_CN.UTF-8' })).toBe('en')
    expect(resolveUiLanguage('auto', { LC_ALL: 'C', LC_MESSAGES: 'zh_CN.UTF-8' })).toBe('en')
    expect(resolveUiLanguage('auto', { LC_MESSAGES: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' })).toBe('zh-CN')
    expect(resolveUiLanguage('auto', { LANG: 'zh-CN' })).toBe('zh-CN')
    expect(resolveUiLanguage('auto', { LANG: 'fr_FR.UTF-8' })).toBe('en')
    expect(resolveUiLanguage('auto', {})).toBe('en')
  })

  it('preserves named placeholders in every translated message', () => {
    const parameters = (text: string) => [...text.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort()
    for (const [en, translated] of Object.entries(zh)) expect(parameters(translated), en).toEqual(parameters(en))
    expect(uiText('zh-CN', 'Allow {tool} once?', { tool: 'Cancel 🐳' })).toBe('允许执行一次 Cancel 🐳？')
    expect(uiText('zh-CN', 'Third-party wording')).toBe('Third-party wording')
    expect(uiText('zh-CN', 'Preferred language for replies, questions and plans. Saved in this profile; applies from the next turn.')).toBe('回复、提问和计划使用的首选语言。 保存在当前配置档案中，从下一回合生效。')
  })

  it('preserves model questions, tool details, previews and returned option values', () => {
    const request = { title: 'Question', question: 'Cancel', detail: 'Input', options: [{ label: 'Cancel', preview: 'Output' }] }
    expect(localizePrompt(request, 'zh-CN')).toBe(request)
    const translated = localizePrompt({ ...request, localize: true }, 'zh-CN')
    expect(translated.title).toBe('问题')
    expect(translated.detail).toBe('Input')
    expect(translated.options?.[0]).toMatchObject({ label: '取消', value: 'Cancel', preview: 'Output' })
    expect(selectedPromptAnswer({ request: translated, selected: 0, checked: new Set() })).toBe('Cancel')
  })

  it('localizes catalog chrome without changing user names that match dictionary entries', () => {
    const translated = localizePrompt({
      localize: ['title', 'question', 'actions'], title: 'Session Library', question: '',
      options: [{ label: 'Cancel', description: 'Settings', badge: { label: 'current', tone: 'muted' } }],
    }, 'zh-CN')
    expect(translated.title).not.toBe('Session Library')
    expect(translated.options?.[0]).toMatchObject({ label: 'Cancel', description: 'Settings', value: 'Cancel' })
  })

  it.each([false, true])('renders both languages in display cells and searches translated settings (colors=%s)', colors => {
    for (const language of ['en', 'zh-CN'] as const) {
      const theme = createTheme(colors, 'truecolor', 'dark', undefined, language)
      const state = createSettings({ theme: 'dark', colors, uiLanguage: language }, 'uiLanguage', { language: 'follow-ui' })
      for (const width of [24, 40, 80, 160]) {
        const frame = renderSettings(state, theme, width, 20)
        expect(frame.lines).toHaveLength(20)
        expect(frame.lines.every(line => visibleWidth(line) <= width)).toBe(true)
        expect(frame.lines.join('\n')).toContain(language === 'en' ? 'UI language' : '界面语言')
        const prompt = renderPromptSelector({ request: { title: '原文 🐳', question: 'Cancel', options: [{ label: 'English 原文' }] }, selected: 0, checked: new Set() }, theme, width, '', 0)
        expect(prompt.lines.every(line => visibleWidth(line) <= width)).toBe(true)
        expect(prompt.lines.join('\n')).toContain('Cancel')
        expect(prompt.lines.join('\n')).toContain(language === 'en' ? 'select' : '选择')
      }
      if (language === 'zh-CN') {
        const searched = applySettingsEvent(state, { type: 'text', value: '回复语言' })
        expect(searched.kind).toBe('update')
        if (searched.kind === 'update') {
          const result = applySettingsEvent(searched.state, { type: 'key', id: 'right' })
          expect(result).toMatchObject({ kind: 'apply', domain: 'agent', state: { agent: { language: 'auto' } } })
        }
      }
    }
    expect(createTheme(colors).key).not.toBe(createTheme(colors, 'truecolor', 'dark', undefined, 'zh-CN').key)
  })
})
