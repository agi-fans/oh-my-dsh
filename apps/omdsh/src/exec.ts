/** Script entry: input and process lifetime around the independent Cordis consumer. */

import type { Context } from '@deepseek-ai/cordis'
import type { OmdshInvocation } from './args.ts'
import { ExecOutput, reserveExecStdout, type ExecResult } from './exec-output.ts'
import { mountOmdsh } from './boot.ts'
import { execConsumer } from './exec-runtime.ts'
import { PROCESS_SHUTDOWN_TIMEOUT_MS } from './process-shutdown.ts'

export class ExecInputError extends Error {}
const MAX_INPUT_BYTES = 8 * 1024 * 1024

/** Read one literal prompt; positional text uses stdin only for the explicit `-`. */
export async function readExecPrompt(args: readonly string[], input: NodeJS.ReadStream, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  if (args.length > 0 && !(args.length === 1 && args[0] === '-')) return args.join(' ')
  if (input.isTTY) throw new ExecInputError('Provide a prompt or pipe UTF-8 text into omdsh exec --json.')
  const abort = (): void => { input.destroy(signal.reason instanceof Error ? signal.reason : new Error('Input interrupted.')) }
  input.setEncoding('utf8')
  signal.addEventListener('abort', abort, { once: true })
  let text = '', bytes = 0
  try {
    for await (const chunk of input) {
      signal.throwIfAborted()
      const part = String(chunk)
      bytes += Buffer.byteLength(part)
      if (bytes > MAX_INPUT_BYTES) throw new ExecInputError('The stdin prompt exceeds the 8 MiB limit.')
      text += part
    }
    return text
  } finally { signal.removeEventListener('abort', abort) }
}

export async function runExec(invocation: Pick<OmdshInvocation, 'prompt' | 'resume'>, version: string): Promise<number> {
  const reserved = reserveExecStdout()
  const stopped = new AbortController()
  const output = new ExecOutput(reserved.stream, error => { stopped.abort(error); process.stdout.destroy(error) })
  let ctx: Context | undefined, result: ExecResult | undefined, signalExit: number | undefined
  let fatal: Error | undefined
  let cleanupTimedOut = false
  let executionStarted = false
  let offBootAbort = (): void => {}
  const interrupt = (code: number): void => {
    if (signalExit !== undefined) { process.exit(code); return }
    signalExit = code
    stopped.abort(new Error(code === 130 ? 'SIGINT' : 'SIGTERM'))
  }
  const sigint = (): void => { interrupt(130) }, sigterm = (): void => { interrupt(143) }
  const onFatal = (error: unknown): void => {
    fatal = error instanceof Error ? error : new Error(String(error))
    stopped.abort(fatal)
  }
  process.on('SIGINT', sigint)
  process.on('SIGTERM', sigterm)
  process.on('uncaughtException', onFatal)
  process.on('unhandledRejection', onFatal)
  process.stdout.on('error', onFatal)
  try {
    output.emit('run.started', { app: 'omdsh', version })
    const prompt = await readExecPrompt(invocation.prompt, process.stdin, stopped.signal)
    if (prompt.trim() === '') throw new ExecInputError('The prompt is empty.')
    stopped.signal.throwIfAborted()
    ctx = await mountOmdsh({ args: [], mode: 'exec', exit: code => { fatal = new Error(`A plugin requested application exit (${code}).`); stopped.abort(fatal) },
      onContext: current => {
        ctx = current
        const abortBoot = (): void => { void current.fiber.dispose().catch(onFatal) }
        stopped.signal.addEventListener('abort', abortBoot, { once: true })
        offBootAbort = () => { stopped.signal.removeEventListener('abort', abortBoot) }
        current.effect(() => offBootAbort)
        if (stopped.signal.aborted) abortBoot()
      } })
    offBootAbort()
    stopped.signal.throwIfAborted()
    for (const service of ['agents', 'agentDefaultModel', 'agentPresets', 'sessionProjections', 'sessions'] as const) {
      if (ctx.get(service) === undefined) throw new Error(`Script execution requires the ${service} provider. Enable it in this Profile.`)
    }
    const consumer = execConsumer({ prompt, ...(invocation.resume === undefined ? {} : { resume: invocation.resume }) }, output, stopped.signal)
    executionStarted = true
    await ctx.plugin(consumer.plugin)
    result = await consumer.result
  } catch (error) {
    result = { outcome: signalExit === undefined ? 'failed' : 'cancelled', exitCode: signalExit ?? (error instanceof ExecInputError ? 2 : 1), text: '',
      error: { code: signalExit === undefined ? error instanceof ExecInputError ? 'INVALID_INPUT' : executionStarted ? 'RUN_FAILED' : 'BOOT_FAILED' : 'CANCELLED',
        message: error instanceof Error ? error.message : String(error) } }
  } finally {
    offBootAbort()
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([ctx?.fiber.dispose(), new Promise<never>((_resolve, reject) => {
        cleanupTimer = setTimeout(() => { cleanupTimedOut = true; reject(new Error(`Cleanup did not finish within ${PROCESS_SHUTDOWN_TIMEOUT_MS} ms.`)) }, PROCESS_SHUTDOWN_TIMEOUT_MS)
      })])
    }
    catch (error) { fatal = error instanceof Error ? error : new Error(String(error)) }
    finally { clearTimeout(cleanupTimer) }
    process.off('SIGINT', sigint)
    process.off('SIGTERM', sigterm)
    process.off('uncaughtException', onFatal)
    process.off('unhandledRejection', onFatal)
  }
  try {
    if (result === undefined) throw new Error('Script execution produced no result.')
    if (signalExit !== undefined) result = { ...result, outcome: 'cancelled', exitCode: signalExit, error: { code: 'CANCELLED', message: 'Execution was interrupted.' } }
    else if (fatal !== undefined) result = { ...result, outcome: 'failed', exitCode: 1, error: { code: cleanupTimedOut ? 'SHUTDOWN_TIMEOUT' : 'RUNTIME_FAILED',
      message: cleanupTimedOut ? [result.error?.message, fatal.message].filter(Boolean).join(' ') : fatal.message } }
    if (cleanupTimedOut && signalExit !== undefined) result = { ...result, error: { code: 'SHUTDOWN_TIMEOUT', message: `Execution was interrupted; cleanup exceeded ${PROCESS_SHUTDOWN_TIMEOUT_MS} ms.` } }
    let outputTimer: ReturnType<typeof setTimeout> | undefined
    try {
      if (signalExit !== undefined || cleanupTimedOut) outputTimer = setTimeout(() => {
        process.stdout.destroy(new Error('Interrupted output did not drain within the shutdown grace period.'))
      }, PROCESS_SHUTDOWN_TIMEOUT_MS)
      await output.finish(result)
    } finally { clearTimeout(outputTimer) }
    if (cleanupTimedOut) process.exit(result.exitCode)
    return result.exitCode
  } catch (error) {
    process.stderr.write(`omdsh exec: ${error instanceof Error ? error.message : String(error)}\n`)
    return signalExit ?? 1
  } finally {
    reserved.restore()
    // Keep a stdout error answerer until process shutdown: callbacks for the
    // final write can report a broken pipe after its buffer was accepted.
  }
}
