import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'

// content/en and content/zh are the documentation source of truth, authored
// bilingually in place. The changelog stays at the repository root (release
// tooling reads it there); the site loads it in place instead of copying it.
const en = defineCollection({ loader: glob({ pattern: '**/*.md', base: './content/en' }) })
const zh = defineCollection({ loader: glob({ pattern: '**/*.md', base: './content/zh' }) })
const changelog = defineCollection({ loader: glob({ pattern: 'CHANGELOG.md', base: '../..' }) })

export const collections = { en, zh, changelog }
