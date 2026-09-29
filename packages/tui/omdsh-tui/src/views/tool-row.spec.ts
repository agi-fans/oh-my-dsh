/**
 * Folded tool row contract: a settled call is one unframed line, a failure or
 * an explicit expansion keeps the frame. Every assertion is on display cells
 * and on what a terminal shows, not on internal layout.
 */
import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { blockLines } from './event-views.ts'
import { createTheme, SPINNER, SYMBOL } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'

const plain = (lines: readonly string[]): string[] => lines.map(stripAnsi)
const theme = createTheme(false)

function tool(over: Partial<Parameters<typeof blockLines>[0]> & { name: string } = { name: 'bash' }) {
  return {
    kind: 'tool' as const,
    callId: ToolCallId('call-1'),
    status: 'ok' as const,
    args: '{}',
    output: '',
    ...over,
  } as Parameters<typeof blockLines>[0]
}

describe('folded tool row', () => {
  it('gives a settled read one unframed line carrying the path and the line count', () => {
    const lines = plain(blockLines(tool({
      name: 'read',
      output: 'x',
      presentation: {
        result: {
          card: 'read',
          path: 'packages/tui/omdsh-tui/src/views/event-views.ts',
          lines: [{ number: 1, text: 'a' }],
          totalLines: 581,
        },
      },
    }), theme, 80))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('event-views.ts')
    expect(lines[0]).toContain('1/581')
    expect(lines[0]?.startsWith('╭')).toBe(false)
  })

  it('carries the command itself, not just the tool name, for a shell call', () => {
    const lines = plain(blockLines(tool({
      name: 'bash',
      presentation: {
        call: { card: 'terminal', title: 'pnpm --filter @agi-fans/dsh-tui test' },
        result: { card: 'terminal', output: 'ok', exitCode: 0 },
      },
    }), theme, 80))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('pnpm --filter @agi-fans/dsh-tui test')
    expect(lines[0]).toContain('exit 0')
  })

  it('drops a shell call to its name when nothing identifies the call', () => {
    const lines = plain(blockLines(tool({ name: 'todo_write', args: '{}' }), theme, 80))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('todo_write')
  })

  it('reads the subject out of raw arguments instead of printing the opening brace', () => {
    const lines = plain(blockLines(tool({
      name: 'read',
      args: JSON.stringify({ path: 'src/views/tool-row.spec.ts', offset: 10 }),
    }), theme, 80))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('src/views/tool-row.spec.ts')
    expect(lines[0]).not.toContain('{')
  })

  it('leads a shell row with the command, not a prose description', () => {
    const lines = plain(blockLines(tool({
      name: 'bash',
      args: JSON.stringify({ command: 'pnpm check:md', description: 'check the docs' }),
    }), theme, 80))

    expect(lines[0]).toContain('pnpm check:md')
  })

  it('decodes a streamed argument prefix so a running row already names the call', () => {
    const lines = plain(blockLines(tool({
      name: 'bash',
      args: '{"command":"ls -la /tm',
      status: 'running',
      partial: true,
    }), theme, 60))

    expect(lines[0]).toContain('ls -la /tm')
    expect(lines[0]).not.toContain('"command"')
  })

  it('keeps the frame for a failure the reader never expanded', () => {
    const lines = plain(blockLines(tool({
      name: 'bash',
      status: 'error',
      output: '3 failing',
      presentation: {
        call: { card: 'terminal', title: 'pnpm test' },
        result: { card: 'terminal', output: '3 failing', exitCode: 1 },
      },
    }), theme, 80))

    expect(lines[0]?.startsWith('╭───')).toBe(true)
    expect(lines.join('\n')).toContain('3 failing')
  })

  it('restores the frame for a settled call under toolsExpanded', () => {
    const block = tool({
      name: 'bash',
      output: 'done',
      presentation: { result: { card: 'terminal', output: 'done', exitCode: 0 } },
    })

    expect(plain(blockLines(block, theme, 80))).toHaveLength(1)
    const expanded = plain(blockLines(block, theme, 80, 0, true))
    expect(expanded[0]?.startsWith('╭───')).toBe(true)
    expect(expanded.join('\n')).toContain('done')
  })

  it('folds a running call to a row and leaves activity to the status footer', () => {
    const lines = plain(blockLines(tool({ name: 'bash', status: 'running' }), theme, 80))

    expect(lines).toHaveLength(1)
    // The transcript records what the call was; the footer already owns the
    // spinner phase and the elapsed time.
    expect(lines[0]).not.toMatch(/\d+\.\d+s/u)
    expect(lines[0]).not.toMatch(/running|pending/iu)
  })

  it('uses the spinner glyph for a running row', () => {
    const lines = plain(blockLines(tool({ name: 'bash', status: 'running' }), theme, 80, 0))

    expect(lines[0]).toContain(SPINNER[0])
  })

  it('marks a running row with the running symbol when animation is off', () => {
    const lines = plain(blockLines(tool({ name: 'bash', status: 'running' }), theme, 80, -1))

    expect(lines[0]).toContain(SYMBOL.running)
  })

  describe('width discipline', () => {
    for (const width of [20, 40, 80, 120]) {
      it(`fills exactly ${width} display cells for a settled shell call`, () => {
        const lines = blockLines(tool({
          name: 'bash',
          presentation: {
            call: { card: 'terminal', title: 'pnpm --filter @agi-fans/dsh-tui test 2>&1 | tail -6' },
            result: { card: 'terminal', output: 'ok', exitCode: 0 },
          },
        }), theme, width)

        expect(lines).toHaveLength(1)
        expect(visibleWidth(lines[0]!)).toBe(width)
      })
    }

    it('truncates a long unbroken command by display cell, not string length', () => {
      const command = 'pnpm ' + 'a'.repeat(400)
      const lines = blockLines(tool({
        name: 'bash',
        presentation: {
          call: { card: 'terminal', title: command },
          result: { card: 'terminal', output: 'ok', exitCode: 0 },
        },
      }), theme, 40)

      expect(visibleWidth(lines[0]!)).toBe(40)
      expect(lines[0]).toContain('…')
    })

    it('keeps CJK and emoji from collapsing the right edge', () => {
      const lines = blockLines(tool({
        name: 'bash',
        presentation: {
          call: { card: 'terminal', title: '读取配置并运行测试 🎉' },
          result: { card: 'terminal', output: 'ok', exitCode: 0 },
        },
      }), theme, 40)

      expect(visibleWidth(lines[0]!)).toBe(40)
    })

    it('keeps the trailing fact when the title has to truncate', () => {
      const lines = plain(blockLines(tool({
        name: 'read',
        presentation: {
          result: {
            card: 'read',
            path: `src/${'nested/'.repeat(30)}file.ts`,
            lines: [{ number: 1, text: 'a' }],
            totalLines: 581,
          },
        },
      }), theme, 40))

      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('1/581')
    })
  })
})
