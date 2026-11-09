import type { TuiService } from '../definition.ts'
import { uiText, type UiLanguage } from '../locale/index.ts'
import { choosePrompt } from '../prompt-intents.ts'
import { argumentHint, buildSlashCommandCompletions, type SlashCommand } from '../views/autocomplete.ts'
import { formatEssentialHotkeysText, formatHotkeysText, type HotkeyBindings } from '../views/hotkeys.ts'
import { readReference } from './reference-reader.ts'

export function helpOptions(commands: readonly SlashCommand[], language: UiLanguage) {
  return buildSlashCommandCompletions(commands, '', language).map(item => {
    const command = commands.find(command => command.name === item.value)!
    return {
      label: `/${command.name}`, value: `/${command.name}`, description: uiText(language, command.description),
      preview: [`/${command.name}${argumentHint(command)}`,
        ...(command.aliases?.length ? [command.aliases.map(alias => `/${alias}`).join(' · ')] : []),
      ].join('\n'), submitLabel: 'insert',
    }
  })
}

export async function browseHelp(tui: Pick<TuiService, 'prompt' | 'copyText' | 'insertText'>, commands: readonly SlashCommand[], bindings: HotkeyBindings, language: UiLanguage, full: boolean, signal: AbortSignal, enhancedKeys = false): Promise<void> {
  const shortcuts = `# Keyboard Shortcuts\n\n## Essential\n\n${formatEssentialHotkeysText(bindings, enhancedKeys)}\n\n${formatHotkeysText(bindings, enhancedKeys)}`
  if (full) { await readReference(tui, 'Help · Shortcuts', shortcuts, signal); return }
  const options = helpOptions(commands, language)
  const byValue = new Map(options.map(option => [option.value, option]))
  const shortcutsOption = { label: uiText(language, 'Keyboard shortcuts'), value: 'shortcuts', description: uiText(language, 'Browse essential keys and shortcuts by section'), submitLabel: 'read' }
  while (!signal.aborted) {
    const answer = await tui.prompt({ ...choosePrompt({
      localize: ['title', 'question', 'actions'], title: 'Help', question: 'Find a command · Enter inserts it into the composer',
      options: [shortcutsOption, ...options], filterable: true, submitLabel: 'insert', notify: false, signal,
      actions: [{ key: 'alt+k', label: 'shortcuts', valuePrefix: 'shortcuts', scope: 'list' }],
    }), filterOptions: query => {
      if (query.trim() === '') return [shortcutsOption, ...options]
      const matches = buildSlashCommandCompletions(commands, query.toLowerCase(), language).map(item => byValue.get(`/${item.value}`)!)
      const shortcutMatch = ['shortcuts', '快捷键', shortcutsOption.label.toLowerCase()].some(term => term.includes(query.trim().toLowerCase()))
      return shortcutMatch ? [...matches, shortcutsOption] : matches
    } })
    if (signal.aborted || answer === null) return
    if (answer === 'shortcuts') { await readReference(tui, 'Help · Shortcuts', shortcuts, signal); continue }
    const command = commands.find(item => `/${item.name}` === answer)
    if (command !== undefined) tui.insertText?.(`/${command.name} `)
    return
  }
}
