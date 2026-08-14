/**
 * omdsh argument parsing: one optional prompt (positional words joined)
 * plus --model/--provider overrides, durable --resume, and help/version.
 * @module @omdsh/app
 */

export interface OmdshInvocation {
  /** Positional prompt words, joined by spaces (empty when interactive only). */
  prompt: string[]
  /** --model override (process.env.OMDSH_MODEL). */
  model: string | undefined
  /** --provider override (process.env.OMDSH_PROVIDER). */
  provider: string | undefined
  /** Durable session selected by --resume/-r. */
  resume: string | undefined
  /** --help requested. */
  help: boolean
}

const HELP = `
omdsh — a TUI coding agent on the DeepSeek Harness runtime

Usage:
  omdsh [options] [prompt...]

Options:
  --model <name>      model route (default deepseek-v4-flash)
  --provider <name>   provider route (default deepseek-official)
  -r, --resume <id>   resume a durable session
  -h, --help          show this help
  --version           show the version

Environment:
  DEEPSEEK_API_KEY    DeepSeek API key (required for live turns)
`

/**
 * Parse the omdsh command line.
 * @param argv - arguments after the bin name.
 * @param version - version string for --version output.
 * @returns the invocation, or prints help/version and exits.
 */
export function parseOmdshArgs(argv: readonly string[], version: string): OmdshInvocation {
  const prompt: string[] = []
  let model: string | undefined
  let provider: string | undefined
  let resume: string | undefined
  let help = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg === '-h' || arg === '--help') {
      help = true
    } else if (arg === '--version') {
      console.log(version)
      process.exit(0)
    } else if (arg === '--model') {
      model = argv[i + 1]
      i += 1
      if (model === undefined) usageError('--model requires a value')
    } else if (arg === '--provider') {
      provider = argv[i + 1]
      i += 1
      if (provider === undefined) usageError('--provider requires a value')
    } else if (arg === '--resume' || arg === '-r') {
      resume = argv[i + 1]
      i += 1
      if (resume === undefined || resume.startsWith('-')) usageError(`${arg} requires a session id`)
    } else if (arg.startsWith('-')) {
      usageError('unknown option ' + arg)
    } else {
      prompt.push(arg)
    }
  }
  if (help) {
    console.log(HELP.trim())
    process.exit(0)
  }
  if (resume !== undefined && prompt.length > 0) usageError('--resume cannot be combined with a prompt')
  return { prompt, model, provider, resume, help }
}

function usageError(message: string): never {
  console.error('omdsh: ' + message)
  console.error('run: omdsh --help')
  process.exit(2)
}
