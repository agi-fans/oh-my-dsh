// Regenerates tsconfig.paths.json from the DeepSeek Harness submodule's own
// tsconfig.base.json: same source-plane wildcard map, re-prefixed so every
// path resolves through refs/deepseek-harness from this repo's root.
// Re-run after updating the refs/deepseek-harness submodule.
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync('refs/deepseek-harness/tsconfig.base.json', 'utf8')
const stripped = src
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .filter((line) => line.trim() !== '')
  .join('\n')
const parsed = JSON.parse(stripped)
const paths = parsed.compilerOptions?.paths
if (!paths) throw new Error('no paths in harness tsconfig.base.json')

const reprefix = (p) => (p.startsWith('./') ? 'refs/deepseek-harness/' + p.slice(2) : p)
const ours = Object.fromEntries(
  Object.entries(paths).map(([spec, targets]) => [spec, targets.map(reprefix)])
)

// omdsh's own packages resolve to source on the same plane.
ours['@omdsh/tui'] = ['packages/tui/omdsh-tui/src/index.ts']
ours['@omdsh/tui/*'] = ['packages/tui/omdsh-tui/src/*']

writeFileSync(
  'tsconfig.paths.json',
  JSON.stringify({ compilerOptions: { baseUrl: '.', paths: ours } }, null, 2) + '\n',
)
console.log(`tsconfig.paths.json: ${Object.keys(ours).length} path entries`)