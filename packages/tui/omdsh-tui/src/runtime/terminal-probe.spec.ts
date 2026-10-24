import { describe, expect, it } from 'vitest'
import {
  KEYBOARD_PROTOCOL_QUERY,
  KITTY_PROTOCOL_OFF,
  KITTY_PROTOCOL_ON,
  negotiateKeyboard,
  type KeyboardProtocol,
} from './terminal-probe.ts'

const step = (protocol: KeyboardProtocol | undefined, event: Parameters<typeof negotiateKeyboard>[1]) =>
  negotiateKeyboard(protocol, event)

describe('keyboard protocol negotiation', () => {
  it('only asks: the query pushes nothing onto the Kitty stack', () => {
    expect(KEYBOARD_PROTOCOL_QUERY).toBe('\x1b[?u\x1b[c')
    expect(KEYBOARD_PROTOCOL_QUERY).not.toMatch(/\x1b\[>\d*u/u)
  })

  it('pushes disambiguate once when the terminal reports any flags, zero included', () => {
    expect(step(undefined, { type: 'kitty-flags', flags: 0 }))
      .toEqual({ protocol: 'kitty', output: '\x1b[>1u', settled: true })
    expect(step(undefined, { type: 'kitty-flags', flags: 5 }))
      .toEqual({ protocol: 'kitty', output: '\x1b[>1u', settled: true })
  })

  it('keeps the legacy encoding when only the device attributes answer', () => {
    expect(step(undefined, { type: 'device-attributes' })).toEqual({ settled: true })
  })

  it('never pushes a second time once a protocol is settled', () => {
    expect(step('kitty', { type: 'kitty-flags', flags: 1 })).toEqual({ protocol: 'kitty', settled: true })
    expect(step('kitty', { type: 'device-attributes' })).toEqual({ protocol: 'kitty', settled: true })
  })

  it('reports that unrelated events settle nothing', () => {
    expect(step(undefined, { type: 'key', id: 'a' })).toEqual({ settled: false })
  })

  it('pushes and pops exactly one Kitty entry', () => {
    expect(KITTY_PROTOCOL_ON).toBe('\x1b[>1u')
    expect(KITTY_PROTOCOL_OFF).toBe('\x1b[<u')
  })
})
