/** Session-scoped model selection over the product's existing delegation defaults. */
import type { Context } from '@deepseek-ai/cordis'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { apply as applyDelegation, Config, inject as delegationInject } from '@deepseek-ai/dsh-tool-subagent'
import type {} from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'

export const name = 'omdsh-subagent-model-selection'
export const inject = [...delegationInject, 'loader', 'subagentModelSelection']

export function apply(ctx: Context): void {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === 'tool-subagent'
    && row.options.name === '@deepseek-ai/dsh-tool-subagent')
  if (entry === undefined) throw new Error('Subagent model selection requires the product tool-subagent entry.')
  // The global tool stays available for deployment restrictions. The Harness
  // installs the sampled variant in each Agent's scope and owns its teardown.
  const inherited = Config(interpolate(ctx, entry.options.config))
  applyDelegation(ctx, { ...inherited, modelSelectionSettings: true })
}
