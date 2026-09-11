/** Three-part numeric version comparison shared by update checks and release notes. */

function versionParts(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Compare two `major.minor.patch` versions; unparsable inputs compare equal. */
export function compareVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  if (a === undefined || b === undefined) return 0
  for (let index = 0; index < a.length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
