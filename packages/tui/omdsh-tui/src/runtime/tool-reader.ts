import type { TuiService } from '../definition.ts'
import type { ToolInfo } from '../chrome/tools-list.ts'
import { choosePrompt } from '../prompt-intents.ts'
import { uiText, type UiLanguage } from '../locale/index.ts'
import { readReference } from './reference-reader.ts'
import { createPromptBrowser } from './prompt-browser.ts'

/** Search the visible tool catalog and read each complete description. */
export async function browseTools(tui: Pick<TuiService, 'prompt' | 'copyText'>, tools: readonly ToolInfo[], language: UiLanguage, signal: AbortSignal, title = 'Tools'): Promise<void> {
  const t = (source: string) => uiText(language, source)
  const prompt = createPromptBrowser(request => tui.prompt(request))
  let selected: string | undefined
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name))
  while (!signal.aborted) {
    const answer = await prompt(choosePrompt({ title: t(title), question: t('Search tools · Enter reads the full description'),
      filterable: true, submitLabel: t('read'), emptyText: t(tools.length === 0 ? 'No tools are available to this session.' : 'No tools match this search.'),
      ...(selected === undefined ? {} : { initialValue: selected }), signal,
      options: sorted.map(tool => ({ label: tool.name, value: tool.name,
        description: tool.description.split('\n').find(line => line.trim() !== '') ?? t('No description provided.'),
        preview: tool.description, submitLabel: t('read') })) }))
    if (answer === null || signal.aborted) return
    const tool = sorted.find(item => item.name === answer)
    if (tool === undefined) continue
    selected = answer
    await readReference(tui, tool.name, tool.description || t('No description provided.'), signal)
  }
}
