/** Shared lifecycle ownership for omdsh command plugins. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'

/** Register one command group, unregister before draining in-flight handlers. */
export function registerCommands(ctx: Context, definitions: readonly CommandDefinition[], label: string): void {
  const active = new Set<Promise<CommandResult>>()
  ctx.effect(function* () {
    yield async () => { await Promise.allSettled(active) }
    for (const definition of definitions) {
      yield ctx.commands.register({
        ...definition,
        handler: (invocation) => {
          const operation = Promise.resolve(definition.handler(invocation))
          active.add(operation)
          void operation.then(
            () => { active.delete(operation) },
            () => { active.delete(operation) },
          )
          return operation
        },
      })
    }
  }, label)
}
