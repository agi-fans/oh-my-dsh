import { expect, it } from 'vitest'
import { keyTestDescription } from './key-test.ts'

it('distinguishes bound keys, unassigned keys, text and unsupported sequences', () => {
  const bindings = { f6: 'tool-actions' as const }
  expect(keyTestDescription({ type: 'key', id: 'f6' }, bindings, 'en')).toContain('Assigned action: Copy or open')
  expect(keyTestDescription({ type: 'key', id: 'f7' }, bindings, 'en')).toContain('No application action')
  expect(keyTestDescription({ type: 'text', value: 'å' }, bindings, 'en')).toContain('No shortcut received')
  expect(keyTestDescription({ type: 'key', id: 'ctrl+csi-99' }, bindings, 'en')).toContain('not supported')
  expect(keyTestDescription({ type: 'focus', focused: true }, bindings, 'en')).toBeUndefined()
})
