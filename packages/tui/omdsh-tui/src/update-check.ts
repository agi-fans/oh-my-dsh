/** Cached, transport-neutral npm update decision. */

export interface UpdateCheckCache {
  checkedAt: number
  latestVersion: string
}

function numericVersion(version: string): readonly number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Whether a registry version is newer than the running package. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const left = numericVersion(candidate)
  const right = numericVersion(current)
  if (left === undefined || right === undefined) return false
  for (let index = 0; index < left.length; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0)
  }
  return false
}

/** Resolve the latest version through a bounded cache and return only actionable updates. */
export async function checkForUpdate(options: {
  currentVersion: string
  now: number
  maxAgeMs: number
  readCache(): Promise<UpdateCheckCache | undefined>
  writeCache(cache: UpdateCheckCache): Promise<void>
  fetchLatest(): Promise<string>
}): Promise<string | undefined> {
  const cached = await options.readCache()
  let latestVersion: string
  if (cached !== undefined && options.now - cached.checkedAt <= options.maxAgeMs) {
    latestVersion = cached.latestVersion
  } else {
    latestVersion = await options.fetchLatest()
    await options.writeCache({ checkedAt: options.now, latestVersion })
  }
  return isNewerVersion(latestVersion, options.currentVersion) ? latestVersion : undefined
}
