/** Cached, transport-neutral npm update decision. */

import { compareVersions } from './version-compare.ts'

export interface UpdateCheckCache {
  checkedAt: number
  latestVersion: string
}

/** Whether a registry version is newer than the running package. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
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
