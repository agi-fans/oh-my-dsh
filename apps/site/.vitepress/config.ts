import { defineConfig, type HeadConfig } from 'vitepress'

const repoUrl = 'https://github.com/agi-fans/oh-my-dsh'
const npmUrl = 'https://www.npmjs.com/package/@agi-fans/oh-my-dsh'
const siteUrl = 'https://omdsh.agi.fans'
const descriptions = {
  en: 'A focused, keyboard-first DeepSeek coding agent for the terminal, built on the DeepSeek Harness plugin runtime.',
  zh: '一个专注、键盘优先的 DeepSeek 终端编程智能体，构建于 DeepSeek Harness 插件运行时之上。',
} as const

function routeFromRelativePath(relativePath: string): string {
  const route = relativePath.replace(/\.md$/, '').replace(/(^|\/)index$/, '$1')
  return route ? `/${route}` : '/'
}

function alternateRoute(route: string, chinese: boolean): string {
  if (chinese) return route.slice('/zh'.length) || '/'
  return route === '/' ? '/zh/' : `/zh${route}`
}

function pageHead(relativePath: string, pageTitle: string, pageDescription: string): HeadConfig[] {
  const route = routeFromRelativePath(relativePath)
  const chinese = route === '/zh/' || route.startsWith('/zh/')
  const canonical = `${siteUrl}${route}`
  const alternate = `${siteUrl}${alternateRoute(route, chinese)}`
  const title = pageTitle ? `${pageTitle} | Oh My DSH` : 'Oh My DSH | Into the Unknown'
  const description = pageDescription || descriptions[chinese ? 'zh' : 'en']
  const locale = chinese ? 'zh_CN' : 'en_US'
  const alternateLocale = chinese ? 'en_US' : 'zh_CN'
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: 'Oh My DSH',
        inLanguage: ['en-US', 'zh-CN'],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${siteUrl}/#software`,
        name: 'Oh My DSH',
        alternateName: 'omdsh',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Linux, macOS, Windows',
        description: descriptions.en,
        url: `${siteUrl}/`,
        codeRepository: repoUrl,
        downloadUrl: npmUrl,
      },
      {
        '@type': 'WebPage',
        '@id': canonical,
        url: canonical,
        name: title,
        description,
        inLanguage: chinese ? 'zh-CN' : 'en-US',
        isPartOf: { '@id': `${siteUrl}/#website` },
        about: { '@id': `${siteUrl}/#software` },
      },
    ],
  }

  return [
    ['link', { rel: 'canonical', href: canonical }],
    ['link', { rel: 'alternate', hreflang: chinese ? 'zh-CN' : 'en', href: canonical }],
    ['link', { rel: 'alternate', hreflang: chinese ? 'en' : 'zh-CN', href: alternate }],
    ['link', { rel: 'alternate', hreflang: 'x-default', href: chinese ? alternate : canonical }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Oh My DSH' }],
    ['meta', { property: 'og:title', content: title }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:url', content: canonical }],
    ['meta', { property: 'og:locale', content: locale }],
    ['meta', { property: 'og:locale:alternate', content: alternateLocale }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: title }],
    ['meta', { name: 'twitter:description', content: description }],
    ['script', { type: 'application/ld+json' }, JSON.stringify(graph)],
  ]
}

const guideSidebar = (prefix: string, zh: boolean) => [
  {
    text: zh ? '指南' : 'Guide',
    items: [
      {
        text: zh ? '教程' : 'Tutorials',
        link: `${prefix}/docs/tutorials`,
        collapsed: false,
        items: [
          { text: zh ? '完成第一个任务' : 'Complete your first task', link: `${prefix}/docs/tutorials/first-task` },
          { text: zh ? '提供精确的项目上下文' : 'Give the agent precise context', link: `${prefix}/docs/tutorials/precise-context` },
          { text: zh ? '引导运行中的任务' : 'Guide an active turn', link: `${prefix}/docs/tutorials/guide-a-turn` },
          { text: zh ? '恢复并管理长会话' : 'Recover and manage a long session', link: `${prefix}/docs/tutorials/long-session` },
          { text: zh ? '调整工作环境' : 'Tune the working environment', link: `${prefix}/docs/tutorials/environment` },
          { text: zh ? '使用 Skills 与 MCP 扩展项目' : 'Extend a project with Skills and MCP', link: `${prefix}/docs/tutorials/skills-and-mcp` },
          { text: zh ? '安装示例插件' : 'Install the example plugin', link: `${prefix}/docs/tutorials/install-plugin` },
          { text: zh ? '编写插件' : 'Write a plugin', link: `${prefix}/docs/tutorials/write-a-plugin` },
        ],
      },
      { text: zh ? 'Skills 与 MCP' : 'Skills and MCP', link: `${prefix}/docs/skills-and-mcp` },
      { text: zh ? '用户插件' : 'User plugins', link: `${prefix}/docs/plugins` },
      { text: zh ? '架构' : 'Architecture', link: `${prefix}/docs/architecture` },
      { text: zh ? '性能' : 'Performance', link: `${prefix}/docs/performance` },
    ],
  },
]

export default defineConfig({
  base: '/',
  srcDir: 'src',
  cleanUrls: true,
  title: 'Oh My DSH',
  description: descriptions.en,
  sitemap: { hostname: siteUrl },
  transformHead: ({ pageData }) => pageHead(pageData.relativePath, pageData.title, pageData.description),
  locales: {
    root: { label: 'English', lang: 'en-US' },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        nav: [
          { text: '文档', link: '/zh/docs/tutorials' },
          { text: '更新日志', link: '/zh/changelog' },
        ],
        sidebar: guideSidebar('/zh', true),
        docFooter: { prev: '上一页', next: '下一页' },
        outline: { label: '页面导航' },
        darkModeSwitchLabel: '主题',
        lightModeSwitchTitle: '切换到浅色模式',
        darkModeSwitchTitle: '切换到深色模式',
        sidebarMenuLabel: '菜单',
        returnToTopLabel: '回到顶部',
        langMenuLabel: '更多语言',
      },
    },
  },
  themeConfig: {
    nav: [
      { text: 'Docs', link: '/docs/tutorials' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: guideSidebar('', false),
    socialLinks: [{ icon: 'github', link: repoUrl }],
    search: {
      provider: 'local',
      options: {
        locales: {
          zh: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                noResultsText: '无法找到相关结果',
                resetButtonTitle: '清除查询条件',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
              },
            },
          },
        },
      },
    },
  },
})
