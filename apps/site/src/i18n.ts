export type Locale = 'en' | 'zh'

export const siteUrl = 'https://omdsh.agi.fans'
export const repoUrl = 'https://github.com/agi-fans/oh-my-dsh'
export const npmUrl = 'https://www.npmjs.com/package/@agi-fans/oh-my-dsh'

export const descriptions = {
  en: 'oh-my-dsh aims to be the best TUI companion for DeepSeek Harness, with familiar interactions, careful visual design, and a fluid terminal coding workflow.',
  zh: 'oh-my-dsh 致力于成为 DeepSeek Harness 的最佳 TUI 补充，持续对齐使用体验、交互和视觉品质，提供美观、清晰、流畅的终端编程体验。',
} as const

export const changelogDescriptions = {
  en: 'Release history for oh-my-dsh, a community TUI companion built on DeepSeek Harness.',
  zh: 'oh-my-dsh 的版本记录，了解这个基于 DeepSeek Harness 的社区 TUI 项目的更新。',
} as const

export const keywords = {
  en: 'omdsh, oh-my-dsh, Oh My DSH, dsh, plugin, dsh-plugin, DeepSeek, DeepSeek Harness, TUI, coding agent',
  zh: 'omdsh, oh-my-dsh, Oh My DSH, dsh, plugin, dsh-plugin, DeepSeek, DeepSeek Harness, 终端编程智能体',
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
  if (normalized === '/404/') return '/zh/'
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
