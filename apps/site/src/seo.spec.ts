import { describe, expect, it } from 'vitest'
import { changelogDescriptions } from './i18n'
import { seoFor } from './seo'

describe('seoFor', () => {
  it('uses trailing-slash canonicals that match GitHub Pages', () => {
    const seo = seoFor('/docs/tutorials', 'en', 'Tutorials', 'Task-based omdsh tutorials.')
    expect(seo.canonical).toBe('https://omdsh.agi.fans/docs/tutorials/')
    expect(seo.alternate).toBe('https://omdsh.agi.fans/zh/docs/tutorials/')
    expect(seo.canonicalPath).toBe('/docs/tutorials/')
  })

  it('keeps the English homepage at the site root and pairs it with /zh/', () => {
    const seo = seoFor('/', 'en', 'Keyboard-first DeepSeek coding agent', 'omdsh is a keyboard-first DeepSeek coding agent.')
    expect(seo.canonical).toBe('https://omdsh.agi.fans/')
    expect(seo.alternate).toBe('https://omdsh.agi.fans/zh/')
    expect(seo.title).toBe('Oh My DSH (omdsh) | Keyboard-first DeepSeek coding agent')
    expect(seo.index).toBe(true)
  })

  it('pairs the Chinese homepage with the English root', () => {
    const seo = seoFor('/zh/', 'zh', '键盘优先的 DeepSeek 终端编程智能体')
    expect(seo.canonical).toBe('https://omdsh.agi.fans/zh/')
    expect(seo.alternate).toBe('https://omdsh.agi.fans/')
    expect(seo.inLanguage).toBe('zh-CN')
  })

  it('keeps changelog descriptions distinct from the site default', () => {
    const seo = seoFor('/changelog', 'en', 'Changelog', changelogDescriptions.en)
    expect(seo.description).toBe(changelogDescriptions.en)
    expect(seo.title).toBe('Changelog | Oh My DSH')
  })

  it('omits indexing for the 404 page', () => {
    const seo = seoFor('/404', 'en', '404', '', { index: false })
    expect(seo.index).toBe(false)
    expect(seo.canonical).toBe('https://omdsh.agi.fans/404/')
  })

  it('points social previews at the 1200x630 PNG', () => {
    const seo = seoFor('/', 'en', 'Keyboard-first DeepSeek coding agent')
    expect(seo.image).toBe('https://omdsh.agi.fans/og-image.png')
    expect(seo.imageType).toBe('image/png')
    expect(seo.imageWidth).toBe(1200)
    expect(seo.imageHeight).toBe(630)
  })
})
