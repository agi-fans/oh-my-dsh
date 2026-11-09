/** Keyboard defaults for the local terminal; SSH does not identify the client's OS. */
export function useWindowsKeybindings(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  if (platform === 'win32') return true
  const remote = Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY)
  return platform === 'linux' && !remote && Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP)
}
