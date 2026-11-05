/** Terminal-owned UI copy. Translate before measuring; never translate transcript content. */
import { zh } from './zh.ts'

export type UiLanguage = 'en' | 'zh-CN'
export type UiLanguagePreference = 'auto' | UiLanguage

/** POSIX locale precedence; an unsupported or C locale deliberately falls back to English. */
export function resolveUiLanguage(preference: UiLanguagePreference = 'auto', env: NodeJS.ProcessEnv = process.env): UiLanguage {
  if (preference !== 'auto') return preference
  const language = env.LC_ALL || env.LC_MESSAGES || env.LANG || ''
  return /^zh(?:[-_]|$)/iu.test(language) ? 'zh-CN' : 'en'
}

/** Only call for product-owned copy. Unknown plugin copy remains verbatim. */
export function uiText(language: UiLanguage, source: string, values: Readonly<Record<string, string | number>> = {}): string {
  const dictionary: Readonly<Record<string, string>> = zh
  const translate = (text: string): string => {
    if (language !== 'zh-CN') return text
    if (Object.hasOwn(dictionary, text)) return dictionary[text]!
    // Compose only explicitly owned UI phrases; user content never enters this function.
    const trimmed = text.trim()
    if (trimmed !== text && Object.hasOwn(dictionary, trimmed)) return text.replace(trimmed, dictionary[trimmed]!)
    for (const separator of [' · ', '. ']) {
      const parts = text.split(separator)
      if (parts.length > 1) return parts.map((part, at) => translate(separator === '. ' && at < parts.length - 1 ? part + '.' : part)).join(separator === '. ' ? ' ' : separator)
    }
    return text
  }
  const text = translate(source)
  return text.replace(/\{(\w+)\}/gu, (token, key: string) => Object.hasOwn(values, key) ? String(values[key]) : token)
}
