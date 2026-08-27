import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'
import sitemap from '@astrojs/sitemap'
import rehypeSlug from 'rehype-slug'
import rehypeDocLinks from './plugins/rehype-doc-links.mjs'

export default defineConfig({
  site: 'https://omdsh.agi.fans',
  trailingSlash: 'always',
  integrations: [
    vue(),
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en-US', zh: 'zh-CN' },
      },
    }),
  ],
  markdown: {
    rehypePlugins: [rehypeSlug, rehypeDocLinks],
    shikiConfig: {
      themes: { light: 'github-light-default', dark: 'github-dark-default' },
    },
  },
})
