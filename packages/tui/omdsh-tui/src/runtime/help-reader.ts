import type { TuiService } from '../definition.ts'
import { uiText, type UiLanguage } from '../locale/index.ts'
import { choosePrompt } from '../prompt-intents.ts'
import { argumentHint, COMMON_COMMANDS, COMMAND_GROUPS, type SlashCommand } from '../views/autocomplete.ts'
import { formatEssentialHotkeysText, formatHotkeysText, type HotkeyBindings } from '../views/hotkeys.ts'
import { readReference } from './reference-reader.ts'

export function helpOptions(commands: readonly SlashCommand[], language: UiLanguage) {
  const rank = (name: string) => {
    const common = COMMON_COMMANDS.indexOf(name)
    if (common >= 0) return common
    const group = COMMAND_GROUPS.findIndex(item => item.names.includes(name))
    return COMMON_COMMANDS.length + (group < 0 ? COMMAND_GROUPS.length : group)
  }
  return [...commands].sort((left, right) => rank(left.name) - rank(right.name)).map(command => ({
    label: `/${command.name}`,
    value: `/${command.name}`,
    description: uiText(language, command.description),
    preview: [`/${command.name}${argumentHint(command)}`,
      ...(command.aliases?.length ? [command.aliases.map(alias => `/${alias}`).join(' · ')] : []),
    ].join('\n'),
    submitLabel: 'insert',
  }))
}

export async function browseHelp(tui: Pick<TuiService, 'prompt' | 'copyText' | 'insertText'>, commands: readonly SlashCommand[], bindings: HotkeyBindings, language: UiLanguage, full: boolean, signal: AbortSignal): Promise<void> {
  const shortcuts = `# Keyboard Shortcuts\n\n## Essential\n\n${formatEssentialHotkeysText(bindings)}\n\n${formatHotkeysText(bindings)}`
  if (full) { await readReference(tui, 'Help · Shortcuts', shortcuts, signal); return }
  while (!signal.aborted) {
    const answer = await tui.prompt(choosePrompt({
      localize: ['title', 'question', 'actions'], title: 'Help', question: 'Find a command · Enter inserts it into the composer',
      options: [{ label: uiText(language, 'Keyboard shortcuts'), value: 'shortcuts', description: uiText(language, 'Browse essential keys and shortcuts by section'), submitLabel: 'read' }, ...helpOptions(commands, language)], filterable: true, submitLabel: 'insert', notify: false, signal,
      actions: [{ key: 'alt+k', label: 'shortcuts', valuePrefix: 'shortcuts', scope: 'list' }],
    }))
    if (signal.aborted || answer === null) return
    if (answer === 'shortcuts') { await readReference(tui, 'Help · Shortcuts', shortcuts, signal); continue }
    const command = commands.find(item => `/${item.name}` === answer)
    if (command !== undefined) tui.insertText?.(`/${command.name} `)
    return
  }
}
