import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

/** Ask the OS to open an explicitly selected file, without a command shell. */
export async function openSystemFile(path: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [resolve(path)], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`File opener exited with status ${String(code)}.`)))
  })
}

