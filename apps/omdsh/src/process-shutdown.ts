/** Bounded, escalating process shutdown (mirrors the dsh CLI's own controller). */


/** Maximum grace allowed for the application tree to dispose before process exit. */
export const PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000

/** Process-exit controller shared by normal completion and Unix signal handlers. */
export interface ProcessShutdown {
  /** Start or join graceful disposal before allowing natural completion with `code`. */
  shutdown(code: number): Promise<void>
  /** Start graceful disposal followed by exit, or force exit when shutdown is already running. */
  interrupt(code: number): void
}

/**
 * Create one process-exit controller around an application disposer.
 * @param dispose - whole-application teardown that resolves at quiescence.
 * @returns a controller whose normal calls coalesce and whose repeated signal call escalates.
 */
export function createProcessShutdown(dispose: () => Promise<void>): ProcessShutdown {
  let pending: Promise<void> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let completed = false
  let forceExited = false

  const forceExitOnce = (code: number): void => {
    if (forceExited) return
    forceExited = true
    if (timeout !== undefined) clearTimeout(timeout)
    process.exit(code)
  }

  const completeOnce = (code: number): void => {
    if (completed || forceExited) return
    completed = true
    if (timeout !== undefined) clearTimeout(timeout)
    process.exitCode = code
  }

  const start = (code: number, forceAfterDispose: boolean): Promise<void> => {
    if (pending !== undefined) return pending
    timeout = setTimeout(() => {
      forceExitOnce(code)
    }, PROCESS_SHUTDOWN_TIMEOUT_MS)
    pending = Promise.resolve().then(dispose).then(
      () => {
        if (forceAfterDispose) forceExitOnce(code)
        else completeOnce(code)
      },
      () => { forceExitOnce(code) },
    )
    return pending
  }

  return {
    shutdown(code) {
      return start(code, false)
    },
    interrupt(code) {
      if (pending !== undefined) {
        forceExitOnce(code)
        return
      }
      void start(code, true)
    },
  }
}