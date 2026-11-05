/** Human controls over the Harness goal; durable phase and live activation stay distinct. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal/types'
import type { TuiPrompt, TuiService } from '../definition.ts'
import { askPrompt, confirmPrompt } from '../prompt-intents.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'

export async function openGoalControls(ctx: Context, tui: TuiService, agent: Agent, signal: AbortSignal): Promise<void> {
  const lifetime = new AbortController()
  const owned = AbortSignal.any([signal, lifetime.signal])
  const t = (source: string) => uiText(resolveUiLanguage(tui.prefs?.().uiLanguage), source)
  const prompt = (request: TuiPrompt) => tui.prompt({ ...request, signal: owned, notify: false, onSuperseded: () => lifetime.abort() })
  let diagnostic = '', draft: { id: string; objective: string } | undefined
  const read = (): GoalView | undefined => ctx.get('goals')?.get(agent)
  const resumable = (goal: GoalView) => goal.phase !== 'complete' && (goal.phase !== 'active' || goal.activation !== 'armed')
  const exhausted = (goal: GoalView) => goal.maxGoalRounds > 0 && goal.roundsStarted >= goal.maxGoalRounds
  const detail = (): string => {
    if (!ctx.get('goals')) return t('Goal controls are unavailable in this profile.')
    const goal = read()
    if (!goal || goal.phase === 'complete') return t('No current goal. Use /goal <objective> to create one.')
    return [diagnostic, goal.objective, t(goal.phase === 'active' ? goal.activation === 'armed' ? 'Automatic continuation enabled' : 'Waiting for your instruction to continue' : goal.phase === 'paused' ? 'Goal paused' : 'Goal blocked'),
      `${t('Rounds')}: ${goal.roundsStarted}${goal.maxGoalRounds > 0 ? '/' + goal.maxGoalRounds : ''}`, goal.blockedReason?.message,
      exhausted(goal) ? t('The round limit is reached. Ask the agent to raise the limit before resuming.') : ''].filter(Boolean).join('\n\n')
  }
  const options = (): NonNullable<TuiPrompt['options']> => {
    const goal = read()
    if (!goal || goal.phase === 'complete') return [{ label: t('Back'), value: 'back' }]
    return [
      { label: t(resumable(goal) ? 'Resume goal' : 'Pause goal'), value: resumable(goal) ? 'resume' : 'pause', disabled: resumable(goal) && exhausted(goal) },
      { label: t('Edit objective'), value: 'edit' }, { label: t('Clear goal'), value: 'clear' }, { label: t('Back'), value: 'back' },
    ]
  }
  try {
    while (!owned.aborted) {
      const action = await prompt({ title: t('Current goal'), question: t('Manage this session’s goal'), detail: detail(), refreshDocument: detail,
        options: options(), refreshOptions: options, allowCustom: false })
      if (owned.aborted || action === null || action === 'back') return
      const goal = read()
      if (!goal || goal.phase === 'complete') continue
      try {
        if (action === 'edit') {
          const objective = await prompt(askPrompt({ title: t('Edit objective'), question: t('What should this goal achieve?'), initialInput: draft?.id === goal.id ? draft.objective : goal.objective }))
          if (owned.aborted) return
          if (objective === null) continue
          draft = { id: goal.id, objective }
        } else if (action === 'clear') {
          if (!await confirmPrompt(prompt, { title: t('Clear goal'), question: t('Clear this goal?'), detail: goal.objective,
            acceptLabel: t('Clear goal'), cancelLabel: t('Keep goal'), signal: owned }) || owned.aborted) continue
        }
        owned.throwIfAborted()
        const service = ctx.get('goals')
        if (!service) throw new Error(t('Goal controls are unavailable in this profile.'))
        if (action === 'edit') { service.edit(agent, goal, { objective: draft!.objective }); draft = undefined }
        else if (action === 'clear') service.clear(agent, goal)
        else if (action === 'pause' && !resumable(goal)) service.pause(agent, goal)
        else if (action === 'resume' && resumable(goal) && !exhausted(goal)) service.resume(agent, goal)
        diagnostic = ''
      } catch (error) {
        if (owned.aborted) return
        diagnostic = error instanceof Error ? error.message : String(error)
      }
    }
  } finally { lifetime.abort() }
}
