import { describe, expect, it } from 'vitest'
import {
  FEATURE_BLOCK_BEGIN,
  FEATURE_BLOCK_END,
  FEATURE_TOGGLES,
  defaultFeatureStates,
  featurePatchPath,
  featureStatesFromPatch,
  renderFeatureBlock,
  replaceFeatureBlock,
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

describe('feature block round trip', () => {
  it('persists enabling Ralph and removes the override when it is disabled again', () => {
    const enabled = { ...defaultFeatureStates(), 'tool-ralph': true }
    const first = replaceFeatureBlock(HAND_WRITTEN, renderFeatureBlock(enabled))
    expect(first).toContain('- id: tool-ralph\n  disabled: false')
    expect(featureStatesFromPatch(first)).toEqual(enabled)
    const second = replaceFeatureBlock(first, renderFeatureBlock(defaultFeatureStates()))
    expect(second).not.toContain('tool-ralph')
    expect(featureStatesFromPatch(second)).toEqual(defaultFeatureStates())
    expect(second).toContain(HAND_WRITTEN.trim())
  })

  it('round-trips every combination of shipped-on and shipped-off features', () => {
    for (let mask = 0; mask < 2 ** FEATURE_TOGGLES.length; mask += 1) {
      const states = Object.fromEntries(FEATURE_TOGGLES.map((feature, index) => [feature.id, (mask & (1 << index)) !== 0]))
      expect(featureStatesFromPatch(renderFeatureBlock(states))).toEqual(states)
    }
  })

  it('reads explicit enable and disable rows only inside the managed block', () => {
    const text = `${FEATURE_BLOCK_BEGIN}\n- id: tool-ralph\n  disabled: false\n- id: workspace-changes\n  disabled: true\n- id: unknown\n  disabled: false\n${FEATURE_BLOCK_END}\n- id: tool-ralph\n  disabled: true\n`
    expect(featureStatesFromPatch(text)).toEqual({ ...defaultFeatureStates(), 'tool-ralph': true, 'workspace-changes': false })
  })

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

  it('writes an empty but well-formed block for shipped defaults', () => {
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
