#!/usr/bin/env node
/**
 * Renders the flagship 72-second 1080p60 MP4 with faststart metadata and a poster still
 * into tools/promo-video/out/ (gitignored).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const promoRoot = path.resolve(import.meta.dirname, '..')
const outDir = path.join(promoRoot, 'out')
const remotionBin = path.join(promoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'remotion.cmd' : 'remotion')

fs.mkdirSync(outDir, { recursive: true })

const requiredAssets = [
  path.join(promoRoot, 'src/data/live-frames.json'),
  path.join(promoRoot, 'src/data/real-frames.json'),
  path.join(promoRoot, 'public/media/soundtrack-72s.m4a'),
]
const missing = requiredAssets.filter((file) => !fs.existsSync(file))
if (missing.length > 0) {
  console.error('Missing generated promo assets. Run `pnpm run prepare:assets` first:')
  for (const file of missing) console.error(`  - ${path.relative(promoRoot, file)}`)
  process.exit(1)
}

const rawMp4 = path.join(outDir, 'raw-promo-flagship.mp4')
const finalMp4 = path.join(outDir, 'oh-my-dsh-promo-flagship-bilingual-1080p60.mp4')
const posterPng = path.join(outDir, 'oh-my-dsh-promo-flagship-poster.png')
const concurrency = process.env.REMOTION_CONCURRENCY || '6'

execFileSync(
  remotionBin,
  [
    'render',
    'src/index.ts',
    'OmdshPromo',
    rawMp4,
    '--codec=h264',
    '--crf=16',
    '--pixel-format=yuv420p',
    '--audio-codec=aac',
    '--audio-bitrate=256k',
    `--concurrency=${concurrency}`,
    '--log=warn',
  ],
  { cwd: promoRoot, stdio: 'inherit' },
)

execFileSync('ffmpeg', ['-y', '-i', rawMp4, '-c', 'copy', '-movflags', '+faststart', finalMp4], {
  cwd: promoRoot,
  stdio: 'inherit',
})
fs.rmSync(rawMp4, { force: true })

execFileSync(remotionBin, ['still', 'src/index.ts', 'OmdshPromo', posterPng, '--frame=260', '--log=error'], {
  cwd: promoRoot,
  stdio: 'inherit',
})

console.log(`\nRendered:\n  - ${finalMp4}\n  - ${posterPng}`)
