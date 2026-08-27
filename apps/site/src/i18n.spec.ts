import { describe, expect, it } from 'vitest'
import { alternatePath, localizedPath, pagePath } from './i18n'

describe('pagePath', () => {
  it('adds a trailing slash to directory URLs', () => {
    expect(pagePath('/docs/architecture')).toBe('/docs/architecture/')
    expect(pagePath('/docs/architecture/')).toBe('/docs/architecture/')
    expect(pagePath('/')).toBe('/')
  })
})

describe('alternatePath', () => {
  it('maps English pages onto the /zh/ tree', () => {
    expect(alternatePath('/', 'en')).toBe('/zh/')
    expect(alternatePath('/docs/plugins', 'en')).toBe('/zh/docs/plugins/')
  })

  it('maps Chinese pages back onto the English tree', () => {
    expect(alternatePath('/zh/', 'zh')).toBe('/')
    expect(alternatePath('/zh/docs/plugins/', 'zh')).toBe('/docs/plugins/')
  })
})

describe('localizedPath', () => {
  it('emits trailing slashes for in-page links', () => {
    expect(localizedPath('/docs/tutorials', 'en')).toBe('/docs/tutorials/')
    expect(localizedPath('/docs/tutorials', 'zh')).toBe('/zh/docs/tutorials/')
    expect(localizedPath('/', 'zh')).toBe('/zh/')
  })
})
