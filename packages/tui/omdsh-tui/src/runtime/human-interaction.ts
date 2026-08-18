/** Harness approval/question adapter mounted independently from the runner. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from './session-runtime.ts'
import { bindHumanInteraction } from '../session/interaction-adapter.ts'

export const name = 'omdsh-human-interaction'
export const inject = ['tui', 'omdshSession']

export function apply(ctx: Context): void {
  ctx.effect(() => bindHumanInteraction(ctx, ctx.tui, () => ctx.omdshSession.agent), 'omdsh human interaction')
}
