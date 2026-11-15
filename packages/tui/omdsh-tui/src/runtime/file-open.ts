import { resolve } from 'node:path'
import { openNativePath, type PathOpenerInternals } from '@deepseek-ai/dsh-native-command'

/** Ask the OS to open an explicitly selected file, without a command shell. */
export async function openSystemFile(
  path: string,
  signal: AbortSignal = new AbortController().signal,
  internals?: PathOpenerInternals,
): Promise<void> {
  await openNativePath(resolve(path), signal, internals)
}
