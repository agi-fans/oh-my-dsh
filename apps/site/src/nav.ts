import { localizedPath, type Locale } from './i18n'

export type NavEntry = { slug: string; en: string; zh: string }

export const tutorialsIndex: NavEntry = { slug: 'tutorials', en: 'Tutorials', zh: '教程' }

export const tutorialEntries: NavEntry[] = [
  { slug: 'tutorials/first-task', en: 'Complete your first task', zh: '完成第一个任务' },
  { slug: 'tutorials/precise-context', en: 'Give the agent precise context', zh: '提供精确的项目上下文' },
  { slug: 'tutorials/guide-a-turn', en: 'Guide an active turn', zh: '引导运行中的任务' },
  { slug: 'tutorials/long-session', en: 'Recover and manage a long session', zh: '恢复并管理长会话' },
  { slug: 'tutorials/environment', en: 'Tune the working environment', zh: '调整工作环境' },
  { slug: 'tutorials/skills-and-mcp', en: 'Extend a project with Skills and MCP', zh: '使用 Skills 与 MCP 扩展项目' },
  { slug: 'tutorials/install-plugin', en: 'Install the example plugin', zh: '安装示例插件' },
  { slug: 'tutorials/write-a-plugin', en: 'Write a plugin', zh: '编写插件' },
]

export const referenceEntries: NavEntry[] = [
  { slug: 'skills-and-mcp', en: 'Skills and MCP', zh: 'Skills 与 MCP' },
  { slug: 'language-servers', en: 'Language servers', zh: '语言服务器' },
  { slug: 'plugins', en: 'User plugins', zh: '用户插件' },
  { slug: 'architecture', en: 'Architecture', zh: '架构' },
  { slug: 'performance', en: 'Performance', zh: '性能' },
]

/** Sidebar order, flattened so prev/next can walk it. */
export const docOrder: NavEntry[] = [tutorialsIndex, ...tutorialEntries, ...referenceEntries]

export function docsHref(slug: string, locale: Locale): string {
  return localizedPath(`/docs/${slug}`, locale)
}

export function label(entry: NavEntry, locale: Locale): string {
  return locale === 'zh' ? entry.zh : entry.en
}
