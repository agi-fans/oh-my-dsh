/** Keep a Changelog parsing and startup release-note selection. */

export interface ChangelogEntry {
  version: string
  markdown: string
  categoryCounts: Readonly<Record<string, number>>
}

export interface ChangelogSelection {
  entries: readonly ChangelogEntry[]
  latestVersion: string
  releaseCount: number
  changeCount: number
  categoryCounts: Readonly<Record<string, number>>
}

export const STARTUP_CHANGELOG_MODES = ['summary', 'expanded', 'hidden'] as const
export type StartupChangelogMode = typeof STARTUP_CHANGELOG_MODES[number]

function versionParts(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  if (a === undefined || b === undefined) return 0
  for (let index = 0; index < a.length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function countCategories(markdown: string): Record<string, number> {
  const counts: Record<string, number> = {}
  let category: string | undefined
  for (const line of markdown.split('\n')) {
    const heading = /^###\s+(.+?)\s*$/u.exec(line)
    if (heading?.[1] !== undefined) {
      category = heading[1]
      continue
    }
    if (category !== undefined && /^-\s+\S/u.test(line)) counts[category] = (counts[category] ?? 0) + 1
  }
  return counts
}

/** Parse released sections while ignoring the Unreleased bucket. */
export function parseChangelog(content: string): ChangelogEntry[] {
  const headings = [...content.matchAll(/^##\s+\[(\d+\.\d+\.\d+(?:[-+][^\]]+)?)\].*$/gmu)]
  return headings.map((heading, index) => {
    const start = heading.index ?? 0
    const end = headings[index + 1]?.index ?? content.length
    const markdown = content.slice(start, end).trim()
    return {
      version: heading[1] ?? '0.0.0',
      markdown,
      categoryCounts: countCategories(markdown),
    }
  })
}

/** Select release entries newer than the persisted marker and no newer than the running build. */
export function selectUnseenChangelog(
  entries: readonly ChangelogEntry[],
  lastVersion: string,
  currentVersion: string,
): ChangelogSelection | undefined {
  const selected = entries.filter(entry =>
    compareVersions(entry.version, lastVersion) > 0 && compareVersions(entry.version, currentVersion) <= 0)
  const latest = selected[0]
  if (latest === undefined) return undefined
  const categoryCounts: Record<string, number> = {}
  for (const entry of selected) {
    for (const [category, count] of Object.entries(entry.categoryCounts)) {
      categoryCounts[category] = (categoryCounts[category] ?? 0) + count
    }
  }
  return {
    entries: selected,
    latestVersion: latest.version,
    releaseCount: selected.length,
    changeCount: Object.values(categoryCounts).reduce((total, count) => total + count, 0),
    categoryCounts,
  }
}

function categoryLabel(category: string, count: number): string {
  const normalized = category.toLowerCase()
  if (normalized === 'changed') return count === 1 ? 'change' : 'changes'
  if (normalized === 'fixed') return count === 1 ? 'fix' : 'fixes'
  if (normalized === 'added') return count === 1 ? 'addition' : 'additions'
  return count === 1 ? normalized.replace(/s$/u, '') : normalized
}

/** Format the compact one-time startup release-note notice. */
export function formatStartupChangelog(selection: ChangelogSelection, mode: Exclude<StartupChangelogMode, 'hidden'>): string {
  if (mode === 'expanded') return selection.entries.map(entry => entry.markdown).join('\n\n')
  const order = ['Breaking Changes', 'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']
  const details = order
    .filter(category => selection.categoryCounts[category] !== undefined)
    .map(category => {
      const count = selection.categoryCounts[category] ?? 0
      return `${count} ${categoryLabel(category, count)}`
    })
  return `What's New · v${selection.latestVersion}\n${details.join(' · ')} · /changelog for details`
}

/** Resolve and persist the one-time startup notice for the running version. */
export async function resolveStartupChangelog(options: {
  changelog: string
  currentVersion: string
  mode: StartupChangelogMode
  readMarker(): Promise<string | undefined>
  writeMarker(version: string): Promise<void>
}): Promise<string | undefined> {
  const lastVersion = await options.readMarker()
  if (lastVersion === undefined) {
    await options.writeMarker(options.currentVersion)
    return undefined
  }
  if (lastVersion === options.currentVersion) return undefined
  const selection = selectUnseenChangelog(parseChangelog(options.changelog), lastVersion, options.currentVersion)
  if (selection === undefined) return undefined
  await options.writeMarker(options.currentVersion)
  if (options.mode === 'hidden') return undefined
  return formatStartupChangelog(selection, options.mode)
}

/** Render recent or complete release history for the slash-command surface. */
export function changelogText(content: string, full: boolean, recentLimit = 3): string {
  const entries = parseChangelog(content)
  if (entries.length === 0) return 'No changelog entries found.'
  const selected = full ? entries : entries.slice(0, recentLimit)
  const markdown = selected.map(entry => entry.markdown).join('\n\n')
  return full || entries.length <= selected.length
    ? markdown
    : `${markdown}\n\nUse \`/changelog full\` to view the complete changelog.`
}
