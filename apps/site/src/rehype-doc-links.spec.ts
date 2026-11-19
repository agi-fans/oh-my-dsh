import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import rehypeDocLinks from '../plugins/rehype-doc-links.mjs'

function rewriteHref(sourceFile: string, href: string): string {
  const tree = {
    type: 'root',
    children: [{ type: 'element', tagName: 'a', properties: { href }, children: [] }],
  }
  rehypeDocLinks()(tree, { history: [sourceFile] })
  return tree.children[0]!.properties.href
}

describe('rehypeDocLinks', () => {
  const zhTutorials = resolve(import.meta.dirname, '../content/zh/tutorials.md')
  const zhFirstTask = resolve(import.meta.dirname, '../content/zh/tutorials/first-task.md')
  const enCommands = resolve(import.meta.dirname, '../content/en/commands.md')

  it('adds a trailing slash before anchors to match trailingSlash: always', () => {
    expect(rewriteHref(zhTutorials, 'tutorials/first-task.md')).toBe('/zh/docs/tutorials/first-task/')
    expect(rewriteHref(zhFirstTask, '../permissions.md')).toBe('/zh/docs/permissions/')
    expect(rewriteHref(enCommands, 'keyboard.md#shortcut-shell')).toBe('/docs/keyboard/#shortcut-shell')
  })

  it('leaves external URLs, bare anchors, and out-of-tree links unchanged', () => {
    expect(rewriteHref(zhTutorials, 'https://github.com/agi-fans/oh-my-dsh')).toBe('https://github.com/agi-fans/oh-my-dsh')
    expect(rewriteHref(zhTutorials, '#section')).toBe('#section')
    expect(rewriteHref(zhTutorials, '../../README.md')).toBe('../../README.md')
  })
})
