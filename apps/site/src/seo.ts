import { alternatePath, descriptions, npmUrl, repoUrl, siteUrl, type Locale } from './i18n'

export function seoFor(path: string, locale: Locale, pageTitle: string, pageDescription = '') {
  const canonical = `${siteUrl}${path}`
  const alternate = `${siteUrl}${alternatePath(path, locale)}`
  const title = pageTitle ? `${pageTitle} | Oh My DSH` : 'Oh My DSH | Into the Unknown'
  const description = pageDescription || descriptions[locale]
  const ogLocale = locale === 'zh' ? 'zh_CN' : 'en_US'
  const ogLocaleAlternate = locale === 'zh' ? 'en_US' : 'zh_CN'
  const image = `${siteUrl}/screenshot.webp`
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
        inLanguage: locale === 'zh' ? 'zh-CN' : 'en-US',
        isPartOf: { '@id': `${siteUrl}/#website` },
        about: { '@id': `${siteUrl}/#software` },
      },
    ],
  }
  return { title, description, canonical, alternate, ogLocale, ogLocaleAlternate, image, graph }
}
