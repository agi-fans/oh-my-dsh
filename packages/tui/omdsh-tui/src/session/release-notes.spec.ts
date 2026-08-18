import { describe, expect, it } from 'vitest'
import {
  changelogText,
  formatStartupChangelog,
  parseChangelog,
  resolveStartupChangelog,
  selectUnseenChangelog,
} from './release-notes.ts'

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.3.0] - 2026-08-16

### Changed

- Improved startup behavior.

### Fixed

- Fixed the displayed version.

## [0.2.0] - 2026-08-15

### Added

- Added release support.
`

describe('release notes', () => {
  it('summarizes only releases newer than the last version the user saw', () => {
    const selection = selectUnseenChangelog(parseChangelog(CHANGELOG), '0.2.0', '0.3.0')

    expect(selection).toMatchObject({ latestVersion: '0.3.0', releaseCount: 1, changeCount: 2 })
    expect(formatStartupChangelog(selection!, 'summary')).toBe(
      "What's New · v0.3.0\n1 change · 1 fix · /changelog for details",
    )
  })

  it('seeds a first install silently and shows an upgrade only once', async () => {
    let marker: string | undefined
    const common = {
      changelog: CHANGELOG,
      mode: 'summary' as const,
      readMarker: async (): Promise<string | undefined> => marker,
      writeMarker: async (version: string): Promise<void> => { marker = version },
    }

    expect(await resolveStartupChangelog({ ...common, currentVersion: '0.2.0' })).toBeUndefined()
    expect(marker).toBe('0.2.0')
    expect(await resolveStartupChangelog({ ...common, currentVersion: '0.3.0' })).toBe(
      "What's New · v0.3.0\n1 change · 1 fix · /changelog for details",
    )
    expect(marker).toBe('0.3.0')
    expect(await resolveStartupChangelog({ ...common, currentVersion: '0.3.0' })).toBeUndefined()
  })

  it('supports expanded startup notes and hidden-but-acknowledged upgrades', async () => {
    let marker = '0.2.0'
    const common = {
      changelog: CHANGELOG,
      currentVersion: '0.3.0',
      readMarker: async (): Promise<string | undefined> => marker,
      writeMarker: async (version: string): Promise<void> => { marker = version },
    }

    const expanded = await resolveStartupChangelog({ ...common, mode: 'expanded' })
    expect(expanded).toContain('## [0.3.0]')
    expect(expanded).toContain('Fixed the displayed version.')
    marker = '0.2.0'
    expect(await resolveStartupChangelog({ ...common, mode: 'hidden' })).toBeUndefined()
    expect(marker).toBe('0.3.0')
  })

  it('shows only the latest release by default and complete history on request', () => {
    const recent = changelogText(CHANGELOG, false)
    const full = changelogText(CHANGELOG, true, 1)

    expect(recent).toContain('## [0.3.0]')
    expect(recent).not.toContain('## [0.2.0]')
    expect(recent).toContain('/changelog full')
    expect(full).toContain('## [0.2.0]')
  })
})
