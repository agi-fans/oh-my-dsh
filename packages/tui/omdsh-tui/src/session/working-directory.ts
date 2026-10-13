/** Read the Harness directory projection, retaining header-based hosts as a fallback. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-working-directory'

export function currentWorkingDirectory(ctx: Context, session: Session): string {
  return ctx.get('workingDirectory')?.get(session) ?? session.header.cwd ?? process.cwd()
}
