/** Explain decoded terminal input without executing it or guessing its physical key. */
import type { KeyEvent } from './keys.ts'
import { TUI_ACTION_LABELS, type TuiAction } from './actions.ts'
import { uiText, type UiLanguage } from '../locale/index.ts'

export function keyTestDescription(event: KeyEvent, bindings: Readonly<Record<string, TuiAction>>, language: UiLanguage): string | undefined {
  const t = (text: string, values: Record<string, string> = {}) => uiText(language, text, values)
  if (event.type === 'paste-start' || event.type === 'paste-end') return t('Paste received. Paste is text input, not a shortcut.')
  if (event.type === 'text') return t('Text received: {text}', { text: JSON.stringify(event.value.slice(0, 80)) })
    + '\n' + t('No shortcut received. Option/Alt may be producing text; use another binding or configure the terminal’s Option/Alt behavior.')
  if (event.type !== 'key') return
  const action = bindings[event.id.toLowerCase()]
  const known = !/^(?:.*\+)?(?:csi-|code)/u.test(event.id)
  return t('Key received: {key}', { key: event.id }) + '\n' + (!known
    ? t('This key sequence is not supported. Try a different key.')
    : action === undefined ? t('Recognized key. No application action is assigned; an editor or open panel may still use it.')
      : t('Assigned action: {action}', { action: uiText(language, TUI_ACTION_LABELS[action]) }))
}
