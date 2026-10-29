import { describe, expect, it } from 'vitest'
import { findSecrets, maskSecrets } from './secret-mask.ts'

const KEY = 'sk-proj-9f3a2b7c1d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5'

describe('masking a pasted credential', () => {
  it('leaves the provider prefix readable and masks the rest', () => {
    const masked = maskSecrets(`my key is ${KEY}`)
    expect(masked.startsWith('my key is sk-proj-')).toBe(true)
    expect(masked).not.toContain('9f3a2b7c')
    expect(masked).toHaveLength(`my key is ${KEY}`.length)
    // Only the tail changes; the words around it are the reader's.
    expect(masked.slice(0, 'my key is sk-proj-'.length)).toBe('my key is sk-proj-')
  })

  it('does not mask prose that merely looks hyphenated', () => {
    // `sk-` needs twenty characters and a digit; a hyphenated identifier has neither.
    expect(maskSecrets('the sk-learn-and-build pipeline')).toBe('the sk-learn-and-build pipeline')
    expect(maskSecrets('sk-abcdefghijklmnopqrstuvwxyz')).toBe('sk-abcdefghijklmnopqrstuvwxyz')
  })

  it('masks every recognized format, and only those', () => {
    const text = 'ghp_' + 'a'.repeat(36) + ' and AKIAABCDEFGHIJKLMNOP and npm notakey'
    const masked = maskSecrets(text)
    expect(masked).toContain('ghp_aaaa')
    expect(masked).not.toContain('a'.repeat(30))
    expect(masked).toContain('AKIAABCD')
    expect(masked).not.toContain('EFGHIJKLMNOP')
    // `npm` without the underscore is not a format.
    expect(masked).toContain('npm notakey')
  })

  it('masks a JSON Web Token across all three runs', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl'
    const masked = maskSecrets(`Bearer ${token}`)
    expect(masked.startsWith('Bearer eyJhbGci')).toBe(true)
    expect(masked).not.toContain('eyJzdWIi')
    expect(masked).not.toContain('c2lnbmF0dXJl')
  })

  it('keeps a key block\'s lines readable and masks its body', () => {
    const block = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\nkqC9pQ==\n-----END PRIVATE KEY-----'
    const masked = maskSecrets(block)
    const lines = masked.split('\n')
    expect(lines[0]).toBe('-----BEGIN PRIVATE KEY-----')
    expect(lines[1]).toBe('*'.repeat('MIIEvQIBADANBg'.length))
    expect(masked).toContain('-----END')
    // Line breaks stay, so the block keeps the height the reader already saw.
    expect(lines).toHaveLength(block.split('\n').length)
  })

  it('returns the same string when nothing matched, so callers can skip work', () => {
    const plain = 'nothing secret here'
    expect(maskSecrets(plain)).toBe(plain)
    expect(findSecrets(plain)).toEqual([])
  })

  it('finds ranges in order without overlap', () => {
    const text = `${KEY} and ${'ghp_' + 'b'.repeat(36)}`
    const ranges = findSecrets(text)
    expect(ranges).toHaveLength(2)
    expect(ranges[0]!.end).toBeLessThanOrEqual(ranges[1]!.start)
  })
})
