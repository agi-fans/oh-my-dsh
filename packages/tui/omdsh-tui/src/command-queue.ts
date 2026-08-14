/** Follow-up and steering queue commands registered through dsh-commands. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { registerCommands } from './command-registration.ts'

export const name = 'omdsh-command-queue'
export const inject = ['commands']

function messageText(message: CommandInvocation['agent']['inbox']['nextTurn'][number]): string {
  return message.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join('')
}

function tableCell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim()
}

function messageTable(messages: readonly CommandInvocation['agent']['inbox']['nextTurn'][number][]): string[] {
  if (messages.length === 0) return ['_None queued._']
  return [
    '| # | Message |',
    '|---|---|',
    ...messages.map((message, index) => `| ${index + 1} | ${tableCell(messageText(message))} |`),
  ]
}

function steer(invocation: CommandInvocation): CommandResult {
  const input = invocation.rawInput.trim()
  if (input === '') return { kind: 'error', text: 'Usage: /steer <message>' }
  invocation.agent.steer(createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } }))
  return { kind: 'success', text: 'Steering queued for the next step.' }
}

function showQueue(invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /queue' }
  const inbox = invocation.agent.inbox
  const total = inbox.nextTurn.length + inbox.nextStep.length
  return {
    kind: 'success',
    text: [
      `Queued Messages · ${total}`,
      '',
      `**Follow-ups · ${inbox.nextTurn.length}**`,
      ...messageTable(inbox.nextTurn),
      '',
      `**Steering · ${inbox.nextStep.length}**`,
      ...messageTable(inbox.nextStep),
    ].join('\n'),
  }
}

function dequeue(invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /dequeue' }
  const inbox = invocation.agent.inbox
  const count = inbox.nextTurn.length + inbox.nextStep.length
  inbox.splice('next-turn', 0, inbox.nextTurn.length, [])
  inbox.splice('next-step', 0, inbox.nextStep.length, [])
  return { kind: 'success', text: `Removed ${count} queued message${count === 1 ? '' : 's'}.` }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    { name: 'steer', description: 'Send guidance to the next model step', input: { hint: '<message>' }, handler: steer },
    { name: 'queue', description: 'Show queued follow-up and steering messages', handler: showQueue },
    { name: 'dequeue', description: 'Clear queued follow-up and steering messages', handler: dequeue },
  ], 'omdsh queue commands')
}
