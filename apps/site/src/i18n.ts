export type Locale = 'en' | 'zh'

export const siteUrl = 'https://omdsh.agi.fans'
export const repoUrl = 'https://github.com/agi-fans/oh-my-dsh'
export const npmUrl = 'https://www.npmjs.com/package/@agi-fans/oh-my-dsh'

export const descriptions = {
  en: 'omdsh is a keyboard-first DeepSeek coding agent for the terminal, built on the DeepSeek Harness plugin runtime. The CLI is @agi-fans/oh-my-dsh.',
  zh: 'omdsh 是一个键盘优先的 DeepSeek 终端编程智能体，构建于 DeepSeek Harness 插件运行时之上。命令行包名为 @agi-fans/oh-my-dsh。',
} as const

export const changelogDescriptions = {
  en: 'Release history for omdsh, the keyboard-first DeepSeek coding agent built on DeepSeek Harness.',
  zh: 'omdsh 的版本记录：基于 DeepSeek Harness 的键盘优先终端编程智能体。',
} as const

/** Directory-style site path with a trailing slash, matching GitHub Pages. */
export function pagePath(path: string): string {
  const value = path.startsWith('/') ? path : `/${path}`
  if (value === '/') return '/'
  return value.endsWith('/') ? value : `${value}/`
}

/** Path of the same page in the other locale. */
export function alternatePath(path: string, locale: Locale): string {
  const normalized = pagePath(path)
  if (locale === 'en') return normalized === '/' ? '/zh/' : `/zh${normalized}`
  const stripped = normalized.replace(/^\/zh(?=\/|$)/u, '')
  return stripped === '' || stripped === '/' ? '/' : pagePath(stripped)
}

/** Prefix a site path with the locale root when needed. */
export function localizedPath(path: string, locale: Locale): string {
  const normalized = pagePath(path)
  if (locale !== 'zh') return normalized
  return normalized === '/' ? '/zh/' : `/zh${normalized}`
}

export const ui = {
  en: {
    docs: 'Docs',
    changelog: 'Changelog',
    search: 'Search',
    searchPlaceholder: 'Type to search the docs…',
    searchEmpty: 'No results',
    searchUnavailable: 'Search is only available in the production build.',
    outline: 'On this page',
    previous: 'Previous',
    next: 'Next',
    theme: 'Theme',
  },
  zh: {
    docs: '文档',
    changelog: '更新日志',
    search: '搜索',
    searchPlaceholder: '输入以搜索文档…',
    searchEmpty: '没有匹配结果',
    searchUnavailable: '仅生产构建中可用搜索。',
    outline: '页面导航',
    previous: '上一篇',
    next: '下一篇',
    theme: '主题',
  },
} as const
