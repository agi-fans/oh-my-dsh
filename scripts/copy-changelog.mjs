import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const destinationArg = process.argv[2]
if (destinationArg === undefined) throw new Error('usage: copy-changelog.mjs <destination>')

const source = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))
const destination = resolve(process.cwd(), destinationArg)
mkdirSync(dirname(destination), { recursive: true })
copyFileSync(source, destination)
