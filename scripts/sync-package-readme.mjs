import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourcePath = resolve(root, 'README.md')
const targetPath = resolve(root, 'apps/omdsh/README.md')
const libraryReadmePath = resolve(root, 'packages/tui/omdsh-tui/README.md')
const check = process.argv.includes('--check')
const repositoryBlobBase = 'https://github.com/agi-fans/oh-my-dsh/blob/main'
const repositoryRawBase = 'https://raw.githubusercontent.com/agi-fans/oh-my-dsh/main'
const generatedNotice = '<!-- Generated from the repository README by scripts/sync-package-readme.mjs. -->'

function isRelativeDestination(destination) {
  return !/^(?:[a-z][a-z\d+.-]*:|#|\/)/iu.test(destination)
    && !destination.startsWith('../')
}

export function renderPackageReadme(source) {
  const linked = source.replace(
    /\]\(([^)\n]+)\)/gu,
    (match, destinationWithTitle) => {
      const destinationMatch = /^(\S+)(.*)$/su.exec(destinationWithTitle)
      const destination = destinationMatch?.[1]
      if (destination === undefined || !isRelativeDestination(destination)) return match

      const suffix = destinationMatch?.[2] ?? ''
      const normalized = destination.replace(/^\.\//u, '')
      const image = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/iu.test(normalized)
      const base = image ? repositoryRawBase : repositoryBlobBase
      return `](${base}/${normalized}${suffix})`
    },
  )
  return `${generatedNotice}\n\n${linked}`
}

const source = await readFile(sourcePath, 'utf8')
const generated = renderPackageReadme(source)
const current = await readFile(targetPath, 'utf8').catch(() => '')
const libraryReadme = await readFile(libraryReadmePath, 'utf8').catch(() => '')

if (!libraryReadme.includes('<!-- npm-package-role: library -->')
  || !libraryReadme.includes('It does not install the `omdsh` command')) {
  process.stderr.write(`${relative(root, libraryReadmePath)} must identify itself as a non-executable library package.\n`)
  process.exitCode = 1
}

if (current !== generated) {
  const target = relative(root, targetPath)
  if (check) {
    process.stderr.write(`${target} is out of date. Run pnpm sync:package-readme.\n`)
    process.exitCode = 1
  } else {
    await writeFile(targetPath, generated)
    process.stdout.write(`Updated ${target} from README.md.\n`)
  }
}
