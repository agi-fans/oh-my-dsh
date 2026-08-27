#!/usr/bin/env node
/**
 * Rewrites relative Markdown links between content files to site routes.
 * Sources under content/ stay GitHub-readable (plain relative `*.md` links);
 * the built site links to rendered pages instead. Links that do not point at
 * a sibling Markdown file — absolute URLs, anchors, and anything outside the
 * page's locale tree — pass through untouched, so references leaving the
 * documentation set must be written as full GitHub URLs in the source.
 */
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const contentDir = fileURLToPath(new URL('../content', import.meta.url))
const external = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/iu

export default function rehypeDocLinks() {
  return (tree, file) => {
    const filePath = file?.history?.[0] ?? file?.path ?? ''
    const baseDir = dirname(filePath)
    const locale = filePath.includes(`${sep}content${sep}zh${sep}`) ? 'zh' : 'en'
    const localeRoot = resolve(contentDir, locale)

    const walk = (node) => {
      if (node.tagName === 'a') {
        const href = node.properties?.href
        if (typeof href === 'string') node.properties.href = rewrite(href)
      }
      node.children?.forEach(walk)
    }

    const rewrite = (href) => {
      if (external.test(href)) return href
      const hashIndex = href.indexOf('#')
      const anchor = hashIndex === -1 ? '' : href.slice(hashIndex)
      const path = hashIndex === -1 ? href : href.slice(0, hashIndex)
      if (!path.endsWith('.md')) return href
      const rel = relative(localeRoot, resolve(baseDir, path)).replaceAll('\\', '/')
      if (rel.startsWith('..')) return href
      return `${locale === 'zh' ? '/zh/docs/' : '/docs/'}${rel.slice(0, -'.md'.length)}${anchor}`
    }

    walk(tree)
  }
}
