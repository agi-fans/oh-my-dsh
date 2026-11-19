import { localizedPath, type Locale } from './i18n'

export type NavEntry = { slug: string; en: string; zh: string }

export const tutorialsIndex: NavEntry = { slug: 'tutorials', en: 'Tutorials', zh: '教程导读' }

export const tutorialEntries: NavEntry[] = [
  { slug: 'tutorials/first-task', en: 'Complete your first change', zh: '快速上手：完成第一个改动' },
  { slug: 'tutorials/environment', en: 'Tune your terminal and models', zh: '调好终端与模型偏好' },
  { slug: 'tutorials/precise-context', en: 'Give precise context and quick inputs', zh: '精准上下文与快捷操作' },
  { slug: 'tutorials/guide-a-turn', en: 'Steer long tasks and background work', zh: '掌控长任务与后台作业' },
  { slug: 'tutorials/multi-agent', en: 'Subagents and Agent Teams', zh: '多智能体协作与 Agent Teams' },
  { slug: 'tutorials/long-session', en: 'Manage long sessions and recover files', zh: '管理长会话与安全回退' },
  { slug: 'tutorials/skills-and-mcp', en: 'Extend projects with Skills and MCP', zh: '用 Skills 与 MCP 扩展能力' },
  { slug: 'tutorials/install-plugin', en: 'Install plugins and built-in integrations', zh: '安装插件与内置集成' },
  { slug: 'tutorials/write-a-plugin', en: 'Write and publish a plugin', zh: '开发者进阶：编写与发布插件' },
]

export const referenceEntries: NavEntry[] = [
  { slug: 'commands', en: 'Commands', zh: '命令参考' },
  { slug: 'keyboard', en: 'Keyboard and mouse', zh: '快捷键与鼠标' },
  { slug: 'sessions', en: 'Sessions and recovery', zh: '会话与恢复' },
  { slug: 'subagents', en: 'Subagents and Agent Teams', zh: '子智能体与团队协作' },
  { slug: 'observability', en: 'Status and diagnostics', zh: '状态与诊断' },
  { slug: 'settings', en: 'Settings', zh: '设置' },
  { slug: 'permissions', en: 'Permissions and safety', zh: '权限与安全' },
  { slug: 'cli', en: 'Command line', zh: '命令行与脚本模式' },
  { slug: 'tools', en: 'Tools and presets', zh: '内置工具与预设' },
  { slug: 'troubleshooting', en: 'Troubleshooting', zh: '故障排查' },
  { slug: 'skills-and-mcp', en: 'Skills and MCP', zh: 'Skills 与 MCP' },
  { slug: 'language-servers', en: 'Language servers', zh: '语言服务器（LSP）' },
  { slug: 'plugins', en: 'Plugins and integrations', zh: '插件与内置集成' },
  { slug: 'plugin-internals', en: 'Plugin internals', zh: '插件开发内部机制' },
  { slug: 'architecture', en: 'Architecture', zh: '架构概览' },
  { slug: 'performance', en: 'Performance', zh: '性能与边界' },
]

/** Sidebar order, flattened so prev/next can walk it. */
export const docOrder: NavEntry[] = [tutorialsIndex, ...tutorialEntries, ...referenceEntries]

export function docsHref(slug: string, locale: Locale): string {
  return localizedPath(`/docs/${slug}`, locale)
}

export function label(entry: NavEntry, locale: Locale): string {
  return locale === 'zh' ? entry.zh : entry.en
}
