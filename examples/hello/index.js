/**
 * Example omdsh bundle: register `/hello` on the host `dsh-commands` service.
 * The host already mounts that registry; this package must not nest a second
 * copy of Cordis or any `@deepseek-ai/dsh-*` package.
 */

export const name = 'omdsh-plugin-hello'
export const inject = ['commands']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'hello',
      description: 'Confirm the example omdsh plugin is mounted',
      handler() {
        return { kind: 'success', text: 'Hello from @agi-fans/omdsh-plugin-hello.' }
      },
    })
  }, 'omdsh-plugin-hello')
}
