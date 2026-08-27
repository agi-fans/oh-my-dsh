import { alternatePath, descriptions, keywords, npmUrl, pagePath, repoUrl, siteUrl, type Locale } from './i18n'

export type SeoOptions = {
  index?: boolean
}

const ogImage = {
  url: `${siteUrl}/og-image.png`,
  type: 'image/png',
  width: 1200,
  height: 630,
} as const

export function seoFor(path: string, locale: Locale, pageTitle: string, pageDescription = '', options: SeoOptions = {}) {
  const index = options.index !== false
  const canonicalPath = pagePath(path)
  const canonical = `${siteUrl}${canonicalPath}`
  const alternate = `${siteUrl}${alternatePath(canonicalPath, locale)}`
  const home = canonicalPath === '/' || canonicalPath === '/zh/'
  const title = home
    ? `Oh My DSH (omdsh) | ${pageTitle || (locale === 'zh' ? '键盘优先的 DeepSeek 终端编程智能体' : 'Keyboard-first DeepSeek coding agent')}`
    : `${pageTitle} | Oh My DSH`
  const description = pageDescription || descriptions[locale]
  const ogLocale = locale === 'zh' ? 'zh_CN' : 'en_US'
  const ogLocaleAlternate = locale === 'zh' ? 'en_US' : 'zh_CN'
  const inLanguage = locale === 'zh' ? 'zh-CN' : 'en-US'
  const imageAlt =
    locale === 'zh'
      ? 'omdsh 终端界面，含 DeepSeek 标志、composer 和两行状态栏'
      : 'omdsh terminal interface with the DeepSeek logo, composer, and two-line status footer'
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'agi-fans',
        url: 'https://github.com/agi-fans',
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: 'Oh My DSH',
        alternateName: ['omdsh', 'oh-my-dsh'],
        keywords: keywords[locale],
        inLanguage: ['en-US', 'zh-CN'],
        publisher: { '@id': `${siteUrl}/#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${siteUrl}/#software`,
        name: 'Oh My DSH',
        alternateName: ['omdsh', 'oh-my-dsh'],
        keywords: keywords[locale],
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Linux, macOS, Windows',
        description: descriptions[locale],
        url: `${siteUrl}/`,
        image: ogImage.url,
        downloadUrl: npmUrl,
        installUrl: npmUrl,
        author: { '@id': `${siteUrl}/#organization` },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: `${repoUrl}/blob/main/LICENSE`,
        sameAs: [repoUrl, npmUrl],
      },
      {
        '@type': 'WebPage',
        '@id': canonical,
        url: canonical,
        name: title,
        description,
        inLanguage,
        isPartOf: { '@id': `${siteUrl}/#website` },
        about: { '@id': `${siteUrl}/#software` },
        primaryImageOfPage: {
          '@type': 'ImageObject',
          url: ogImage.url,
          width: ogImage.width,
          height: ogImage.height,
        },
      },
    ],
  }
  return {
    title,
    description,
    canonical,
    alternate,
    canonicalPath,
    ogLocale,
    ogLocaleAlternate,
    image: ogImage.url,
    imageType: ogImage.type,
    imageWidth: ogImage.width,
    imageHeight: ogImage.height,
    imageAlt,
    graph,
    index,
    inLanguage,
    keywords: keywords[locale],
  }
}
