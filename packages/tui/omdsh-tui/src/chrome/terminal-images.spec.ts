import { describe, expect, it } from 'vitest'
import { deleteImage, imageProtocol, imageSequence, imageSize, type ImagePlacement, type PreviewImage } from './terminal-images.ts'
import { MainScreenRenderer } from './main-screen-renderer.ts'

const image: PreviewImage = { data: new Uint8Array(9000).fill(42), width: 640, height: 320, description: 'PNG' }
const placement: ImagePlacement = { image, protocol: 'kitty', row: 4, column: 4, columns: 40, rows: 10 }

describe('terminal images', () => {
  it('opts in only for known direct terminals, rejecting inherited multiplexer hints', () => {
    expect(imageProtocol({ TERM: 'xterm-kitty' })).toBe('kitty')
    expect(imageProtocol({ TERM_PROGRAM: 'ghostty' })).toBe('kitty')
    expect(imageProtocol({ TERM_PROGRAM: 'WezTerm' })).toBe('kitty')
    expect(imageProtocol({ TERM_PROGRAM: 'iTerm.app' })).toBe('iterm2')
    expect(imageProtocol({ TERM_PROGRAM: 'Apple_Terminal' })).toBeUndefined()
    for (const env of [{ TMUX: 'x' }, { STY: 'x' }, { ZELLIJ: '1' }, { HERDR_ENV: '1' }, { TERM: 'screen-256color' }]) {
      expect(imageProtocol({ TERM_PROGRAM: 'ghostty', ...env })).toBeUndefined()
    }
  })

  it('fits landscape and portrait images using actual cell geometry', () => {
    expect(imageSize(image, 40, 10, { width: 8, height: 16 })).toEqual({ columns: 40, rows: 10 })
    expect(imageSize({ ...image, width: 320, height: 640 }, 40, 10, { width: 8, height: 16 })).toEqual({ columns: 10, rows: 10 })
    expect(imageSize(image, 40, 10, { width: 10, height: 10 })).toEqual({ columns: 20, rows: 10 })
  })

  it('chunks Kitty data without loss and requests neither replies nor cursor movement', () => {
    const payload = imageSequence(placement, 123)
    const chunks = [...payload.matchAll(/\x1b_G([^;]*);([^\x1b]*)\x1b\\/gu)]
    expect(chunks).toHaveLength(3)
    expect(chunks[0]?.[1]).toBe('a=T,f=100,q=2,C=1,i=123,c=40,r=10,m=1')
    expect(chunks.at(-1)?.[1]).toBe('m=0')
    expect(chunks.every(chunk => chunk[2]!.length <= 4096)).toBe(true)
    expect(Buffer.from(chunks.map(chunk => chunk[2]).join(''), 'base64')).toEqual(Buffer.from(image.data))
    expect(deleteImage(123)).toBe('\x1b_Ga=d,d=I,i=123,q=2\x1b\\')
  })

  it('encodes iTerm dimensions and binary data without filename or text injection', () => {
    const payload = imageSequence({ ...placement, protocol: 'iterm2', image: { ...image, description: '\x07\x1b[3J' } }, 123)
    expect(payload).toContain('size=9000;width=40;height=10;preserveAspectRatio=1:')
    expect(payload).not.toContain('\x1b[3J')
  })

  it.each(['kitty', 'iterm2'] as const)('owns graphics through repaint, resize, dismissal and finish (%s)', protocol => {
    let output = ''
    const renderer = new MainScreenRenderer({ write: chunk => { output += chunk } }, { width: 60, height: 24 })
    const frame = { lines: ['image viewer'], image: { ...placement, protocol }, cursorVisible: false, documentRows: null }
    renderer.render(frame)
    expect(output).toContain('\x1b[?1049h')
    expect(output).toContain(protocol === 'kitty' ? '\x1b_Ga=T' : '\x1b]1337;File=')
    output = ''
    renderer.render(frame)
    expect(output).not.toContain('a=T')
    expect(output).not.toContain('1337;File=')
    expect(output).not.toContain('a=d')
    renderer.reset()
    renderer.render(frame)
    expect(output).toContain(protocol === 'kitty' ? '\x1b_Ga=T' : '\x1b]1337;File=')
    output = ''
    renderer.resize(70, 26)
    renderer.render(frame)
    expect(output).toContain(protocol === 'kitty' ? '\x1b_Ga=T' : '\x1b]1337;File=')
    output = ''
    renderer.render({ lines: ['composer'], liveStart: 1, documentRows: null })
    expect(output).toContain('\x1b[?1049l')
    if (protocol === 'kitty') expect(output.indexOf('a=d,d=I')).toBeLessThan(output.indexOf('\x1b[?1049l'))
    expect(output).not.toContain('\x1b[3J')
    renderer.render(frame)
    output = ''
    renderer.finish()
    expect(output).toContain('\x1b[?1049l')
    if (protocol === 'kitty') expect(output).toContain('a=d,d=I')
    expect(output).not.toContain('d=A')
  })

  it('clears the old image when another document borrows the same alternate screen', () => {
    let output = ''
    const renderer = new MainScreenRenderer({ write: chunk => { output += chunk } }, { width: 60, height: 24, alternateScreenOverlays: true })
    renderer.render({ lines: ['preview'], image: { ...placement, protocol: 'iterm2' } })
    output = ''
    renderer.render({ lines: ['question'] })
    expect(output).toContain('\x1b[2J')
    expect(output).not.toContain('\x1b[?1049l')
  })
})
