// Builds the omdsh runtime closure: harness package emissions (tsc -b over
// every vendor/packages project, the same projects the harness host face
// references) followed by the harness's own tsdown host pass, which emits
// each package's lib/index.js runtime bundle. After this, the built bin
// (node apps/omdsh/lib/bin.js) runs without tsx.
// Run: node scripts/build-runtime.mjs

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const projects = []
for (const base of ['refs/deepseek-harness/vendor', 'refs/deepseek-harness/packages']) {
  for (const group of readdirSync(base, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupPath = base + '/' + group.name
    for (const pkg of readdirSync(groupPath, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      const dir = groupPath + '/' + pkg.name
      try {
        readdirSync(dir).includes('tsconfig.json') && projects.push(dir)
      } catch { /* not a package */ }
    }
  }
}

const run = (label, cmd, args) => {
  console.log('[' + label + '] ' + cmd + ' ' + args.join(' '))
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(label + ' failed with status ' + result.status)
    process.exit(result.status ?? 1)
  }
}

run('emissions', 'pnpm', ['exec', 'tsc', '-b', ...projects])
run('runtime', 'pnpm', ['exec', 'tsdown', '--config', 'refs/deepseek-harness/tsdown.config.ts', '--env.DSH_BUILD_FACE', 'host'])
console.log('runtime closure built: node apps/omdsh/lib/bin.js --help')
