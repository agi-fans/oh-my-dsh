import { describe, expect, it } from 'vitest'
import {
  FEATURE_BLOCK_BEGIN,
  FEATURE_BLOCK_END,
  FEATURE_TOGGLES,
  applyDisabledRows,
  defaultFeatureStates,
  featurePatchPath,
  featureStatesFromPatch,
  renderFeatureBlock,
  replaceFeatureBlock,
  rowsToDisable,
} from './feature-toggles.ts'

const HAND_WRITTEN = [
  '# my own notes',
  '- id: my-row',
  '  disabled: true',
  '',
].join('\n')

describe('feature registry', () => {
  it('keys every feature at a row id the composition declares', () => {
    expect(FEATURE_TOGGLES.length).toBeGreaterThan(0)
    for (const feature of FEATURE_TOGGLES) {
      expect(feature.id).toMatch(/^[a-z][a-z0-9-]*$/u)
      expect(feature.label.length).toBeGreaterThan(0)
      expect(feature.description.length).toBeGreaterThan(0)
    }
  })

  it('leaves a row that backs a command or core tool out of reach', () => {
    const ids = FEATURE_TOGGLES.map(feature => feature.id)
    for (const core of ['session-query', 'workspace', 'tool-fs', 'tool-bash', 'tool-todo', 'mcp-resources', 'tool-web']) {
      expect(ids, `${core} must not be toggleable`).not.toContain(core)
    }
  })

  it('gives ralph the off-by-default state the composition ships', () => {
    expect(defaultFeatureStates()['tool-ralph']).toBe(false)
  })

  it('derives the patch path from the profile home', () => {
    expect(featurePatchPath('/tmp/home')).toBe('/tmp/home/profiles/omdsh/cordis.patch.yml')
  })
})

describe('applyDisabledRows', () => {
  it('turns a known feature off', () => {
    expect(applyDisabledRows(defaultFeatureStates(), ['workspace-changes'])['workspace-changes']).toBe(false)
  })

  it('ignores a row id that is not a feature', () => {
    const states = applyDisabledRows(defaultFeatureStates(), ['session-query'])
    expect(states).toEqual(defaultFeatureStates())
  })
})

describe('rowsToDisable', () => {
  it('lists only shipped-on features that were turned off', () => {
    expect(rowsToDisable({ ...defaultFeatureStates(), 'workspace-changes': false })).toEqual(['workspace-changes'])
  })

  it('never lists a feature that was already off by default', () => {
    expect(rowsToDisable(defaultFeatureStates())).toEqual([])
  })
})

describe('feature block round trip', () => {
  it('writes the off features and reads them back', () => {
    const states = { ...defaultFeatureStates(), 'workspace-changes': false, 'tool-session-query': false }
    const text = replaceFeatureBlock(HAND_WRITTEN, renderFeatureBlock(states))
    expect(featureStatesFromPatch(text)).toEqual(states)
  })

  it('preserves hand-written rows and comments', () => {
    const text = replaceFeatureBlock(HAND_WRITTEN, renderFeatureBlock(defaultFeatureStates()))
    expect(text).toContain('# my own notes')
    expect(text).toContain('- id: my-row')
  })

  it('replaces its own block instead of stacking copies', () => {
    const once = replaceFeatureBlock(HAND_WRITTEN, renderFeatureBlock({ ...defaultFeatureStates(), 'workspace-changes': false }))
    const twice = replaceFeatureBlock(once, renderFeatureBlock({ ...defaultFeatureStates(), 'tool-session-query': false }))
    expect(twice.split(FEATURE_BLOCK_BEGIN)).toHaveLength(2)
    expect(twice).not.toContain('workspace-changes')
    expect(featureStatesFromPatch(twice)['tool-session-query']).toBe(false)
    expect(featureStatesFromPatch(twice)['workspace-changes']).toBe(true)
  })

  it('keeps content that follows the block', () => {
    const withTail = `${HAND_WRITTEN}\n${renderFeatureBlock(defaultFeatureStates())}\n- id: after-block\n  disabled: true\n`
    const next = replaceFeatureBlock(withTail, renderFeatureBlock({ ...defaultFeatureStates(), 'workspace-changes': false }))
    expect(next).toContain('- id: after-block')
    expect(featureStatesFromPatch(next)['workspace-changes']).toBe(false)
  })

  it('reads a patch with no block as the shipped defaults', () => {
    expect(featureStatesFromPatch(HAND_WRITTEN)).toEqual(defaultFeatureStates())
  })

  it('writes an empty but well-formed block when everything is on', () => {
    const text = replaceFeatureBlock(HAND_WRITTEN, renderFeatureBlock(defaultFeatureStates()))
    expect(text).toContain(FEATURE_BLOCK_BEGIN)
    expect(text).toContain(FEATURE_BLOCK_END)
    expect(text).not.toContain('disabled: true\n# <<<')
  })

  it('starts from an empty file without inventing content', () => {
    const text = replaceFeatureBlock('', renderFeatureBlock({ ...defaultFeatureStates(), 'workspace-changes': false }))
    expect(text.startsWith(FEATURE_BLOCK_BEGIN)).toBe(true)
    expect(featureStatesFromPatch(text)['workspace-changes']).toBe(false)
  })
})
