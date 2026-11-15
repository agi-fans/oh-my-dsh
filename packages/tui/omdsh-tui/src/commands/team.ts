/** Human controls and task-board inspection for Harness Agent Teams. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TeamTaskView } from '@deepseek-ai/dsh-agent-team'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-subagent'
import { createPromptBrowser } from '../runtime/prompt-browser.ts'
import { readReference } from '../runtime/reference-reader.ts'
import { choosePrompt } from '../prompt-intents.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-team'
export const inject = ['commands', 'tui']

type TranslateFn = (source: string, values?: Record<string, string | number>) => string

function resolveRootAgent(ctx: Context, agent: Agent): Agent {
  const subagents = ctx.get('subagents')
  if (subagents === undefined) return agent
  try {
    return subagents.rootOf(agent)
  } catch {
    return agent
  }
}

function ownerLabel(task: TeamTaskView, t: TranslateFn): string {
  return task.ownerName ?? task.ownerId ?? t('unowned')
}

function statusBadge(task: TeamTaskView, t: TranslateFn): string {
  if (task.status === 'pending') return task.ready ? t('pending (ready)') : t('pending (blocked)')
  if (task.status === 'in_progress') return t('in progress')
  if (task.status === 'completed') return t('completed')
  return t('deleted')
}

/** Format one shared task for full-document inspection. */
export function formatTeamTaskDetail(
  task: TeamTaskView,
  t: TranslateFn = (source, values) => uiText('en', source, values),
): string {
  const lines = [
    `## #${task.id} · ${task.subject}`,
    `${t('Status')}: ${statusBadge(task, t)} · ${t('Owner')}: ${ownerLabel(task, t)} · rev ${task.revision}`,
    ...(task.blockedBy.length > 0 ? [`${t('Blocked by')}: ${task.blockedBy.map(id => `#${id}`).join(', ')}`] : []),
    ...(task.writeScopes.length > 0 ? [`${t('Write scopes')}: ${task.writeScopes.map(scope => `\`${scope}\``).join(', ')}`] : []),
    ...(task.writeScopeWarnings.length > 0 ? ['', '### ' + t('Write-scope warnings'), ...task.writeScopeWarnings.map(warning => `- ${warning}`)] : []),
    '',
    task.description,
  ]
  return lines.join('\n')
}

/** Render the session's Team mode and shared task board as Markdown. */
export function formatTeamBoardMarkdown(
  enabled: boolean,
  tasks: readonly TeamTaskView[],
  t: TranslateFn = (source, values) => uiText('en', source, values),
): string {
  const pending = tasks.filter(task => task.status === 'pending').length
  const inProgress = tasks.filter(task => task.status === 'in_progress').length
  const completed = tasks.filter(task => task.status === 'completed').length

  const header = [
    '## ' + t('Agent Teams'),
    `${t('Mode')}: **${t(enabled ? 'Enabled' : 'Disabled')}**`,
    t('Tasks: {total} ({pending} pending · {inProgress} in progress · {completed} completed)', {
      total: tasks.length,
      pending,
      inProgress,
      completed,
    }),
  ]
  if (tasks.length === 0) {
    return [
      ...header,
      '',
      t(enabled
        ? 'No shared tasks recorded yet. The root agent and continuable subagents can create and claim tasks with team_task_* tools.'
        : 'Enable Team mode (`/team on`) to expose shared task-board tools (`team_task_*`) to this session and its continuable subagents.'),
    ].join('\n')
  }
  const rows = tasks.map(task => {
    const subject = task.subject.replace(/\|/gu, '\\|')
    const owner = ownerLabel(task, t).replace(/\|/gu, '\\|')
    const scopes = task.writeScopes.length > 0 ? task.writeScopes.join(', ').replace(/\|/gu, '\\|') : '—'
    return `| #${task.id} | ${statusBadge(task, t)} | ${owner} | ${subject} | ${scopes} |`
  })
  const warnings = tasks.flatMap(task => task.writeScopeWarnings.map(warning => `- #${task.id}: ${warning}`))
  return [
    ...header,
    '',
    `| ID | ${t('Status')} | ${t('Owner')} | ${t('Task')} | ${t('Write scopes')} |`,
    '|---|---|---|---|---|',
    ...rows,
    ...(warnings.length > 0 ? ['', '### ' + t('Write-scope warnings'), ...warnings] : []),
  ].join('\n')
}

async function handleTeam(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const language = resolveUiLanguage(ctx.tui.prefs?.().uiLanguage)
  const t: TranslateFn = (source, values) => uiText(language, source, values)
  const teams = ctx.get('agentTeams')
  if (teams === undefined) {
    return { kind: 'error', text: t('Agent Teams service is not mounted in this profile.') }
  }

  const arg = invocation.rawInput.trim().toLowerCase()
  if (arg !== '' && arg !== 'on' && arg !== 'off' && arg !== 'status') {
    return { kind: 'error', text: 'Usage: /team [on|off|status]' }
  }

  const root = resolveRootAgent(ctx, invocation.agent)

  if (arg === 'on' || arg === 'off') {
    const target = arg === 'on'
    await teams.setEnabled(root, target, invocation.signal)
    return {
      kind: 'success',
      text: t(target
        ? 'Agent Teams enabled for this session. Shared task-board tools (team_task_*) are now available on the next step.'
        : 'Agent Teams disabled for this session. Existing shared tasks remain saved in the session log.'),
    }
  }

  if (arg === 'status' || ctx.tui.interactive === false) {
    return {
      kind: 'success',
      text: formatTeamBoardMarkdown(teams.isEnabled(root), teams.listTasks(root), t),
    }
  }

  const lifetime = new AbortController()
  const signal = AbortSignal.any([invocation.signal, lifetime.signal])
  const tui = {
    prompt: (request: Parameters<typeof ctx.tui.prompt>[0]) => ctx.tui.prompt({ ...request, signal, onSuperseded: () => lifetime.abort() }),
    ...(ctx.tui.copyText === undefined ? {} : { copyText: (text: string, label?: string) => ctx.tui.copyText!(text, label) }),
  }
  const browse = createPromptBrowser(tui.prompt)
  let diagnostic = ''

  while (!signal.aborted) {
    const enabled = teams.isEnabled(root)
    const tasks = teams.listTasks(root)
    const pending = tasks.filter(task => task.status === 'pending').length
    const inProgress = tasks.filter(task => task.status === 'in_progress').length
    const completed = tasks.filter(task => task.status === 'completed').length

    const summary = [
      diagnostic,
      `${t('Mode')}: ${t(enabled ? 'Enabled' : 'Disabled')} · ${t('Tasks: {total} ({pending} pending · {inProgress} in progress · {completed} completed)', {
        total: tasks.length,
        pending,
        inProgress,
        completed,
      })}`,
      t(enabled
        ? 'Shared task-board tools (team_task_*) and collaboration guidance are active for this session tree.'
        : 'Team mode is off. Enable it to expose shared task-board tools (team_task_*) to the root agent and its continuable subagents.'),
    ].filter(Boolean).join('\n')

    const answer = await browse(choosePrompt({
      title: t('Agent Teams'),
      question: t('Toggle Team mode or inspect the shared task board'),
      filterable: tasks.length > 0,
      detail: summary,
      signal,
      options: [
        {
          label: t(enabled ? 'Disable Team mode' : 'Enable Team mode'),
          value: 'toggle',
          description: t(enabled
            ? 'Hide team_task_* tools on subsequent steps while keeping recorded tasks.'
            : 'Expose team_task_* tools and collaboration policy to this session tree.'),
        },
        ...tasks.map(task => ({
          label: `#${task.id} · ${task.subject}`,
          value: `task:${task.id}`,
          description: `${statusBadge(task, t)} · ${ownerLabel(task, t)} · rev ${task.revision}`,
          preview: [
            task.description,
            ...(task.writeScopes.length > 0 ? [`${t('Write scopes')}: ${task.writeScopes.join(', ')}`] : []),
            ...task.writeScopeWarnings,
          ].filter(Boolean).join('\n'),
        })),
        { label: t('Refresh'), value: 'refresh' },
      ],
    }))
    if (signal.aborted || answer === null) break
    if (answer === 'refresh') { diagnostic = ''; continue }
    if (answer === 'toggle') {
      try {
        const next = !teams.isEnabled(root)
        await teams.setEnabled(root, next, signal)
        diagnostic = ''
        ctx.tui.notice(t(next ? 'Agent Teams enabled for this session.' : 'Agent Teams disabled for this session.'), { transient: true })
      } catch (error) {
        if (!signal.aborted) diagnostic = error instanceof Error ? error.message : String(error)
      }
      continue
    }
    if (answer.startsWith('task:')) {
      const id = answer.slice(5)
      const task = tasks.find(candidate => String(candidate.id) === id)
      if (task !== undefined) {
        await readReference(tui, `#${task.id} · ${task.subject}`, formatTeamTaskDetail(task, t), signal)
      }
    }
  }
  return { kind: 'success' }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    {
      name: 'team',
      description: 'Toggle Agent Teams mode and inspect the shared task board',
      input: { hint: '[on|off|status]' },
      handler: invocation => handleTeam(ctx, invocation),
    },
  ], 'omdsh team commands')
}
