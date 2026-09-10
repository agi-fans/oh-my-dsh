/**
 * omdsh argument parsing: one optional prompt, --model/--provider
 * overrides, durable --resume, --dump-config, `omdsh plugin`, and help/version.
 * @module @agi-fans/oh-my-dsh
 */

export type CompletionShell = 'bash' | 'zsh' | 'fish'

export const OMDSH_CLI_COMMANDS = [
  { name: 'plugin', description: 'Manage profile plugins' },
  { name: 'completions', description: 'Generate shell completion scripts' },
] as const

export const OMDSH_CLI_OPTIONS = [
  { names: ['--model'], description: 'Model route', takesValue: true },
  { names: ['--provider'], description: 'Provider route', takesValue: true },
  { names: ['-r', '--resume'], description: 'Resume a durable session', takesValue: true },
  { names: ['--dump-config'], description: 'Print the composed plugin tree', takesValue: false },
  { names: ['-h', '--help'], description: 'Show help', takesValue: false },
  { names: ['--version'], description: 'Show version', takesValue: false },
] as const

export interface OmdshInvocation {
  /** Positional prompt words, joined by spaces (empty when interactive only). */
  prompt: string[]
  /** --model override (process.env.OMDSH_MODEL). */
  model: string | undefined
  /** --provider override (process.env.OMDSH_PROVIDER). */
  provider: string | undefined
  /** Durable session selected by --resume/-r. */
  resume: string | undefined
  /** Print the composed plugin tree and exit. */
  dumpConfig: boolean
  /** `omdsh plugin` forwarded the remaining arguments to pnpm. */
  plugin: boolean
  /** pnpm arguments after `omdsh plugin`. */
  pluginArgs: string[]
  /** Requested completion script, without booting the application. */
  completions: CompletionShell | undefined
  /** --help requested. */
  help: boolean
}

const HELP = `
omdsh — a TUI coding agent on the DeepSeek Harness runtime

Usage:
  omdsh [options] [prompt...]
  omdsh plugin add <package>
  omdsh plugin remove <package>
  omdsh plugin <pnpm-args...>
  omdsh completions bash|zsh|fish

Options:
  --model <name>      model route (default deepseek-flash)
  --provider <name>   provider route (default deepseek-official)
  -r, --resume <id>   resume a durable session
  --dump-config       print the composed plugin tree and exit
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
  if (argv[0] === 'plugin') {
    return {
      prompt: [],
      model: undefined,
      provider: undefined,
      resume: undefined,
      dumpConfig: false,
      plugin: true,
      pluginArgs: argv.slice(1).map(String),
      completions: undefined,
      help: false,
    }
  }
  if (argv[0] === 'completions') {
    const shell = argv[1]
    if (shell !== 'bash' && shell !== 'zsh' && shell !== 'fish') usageError('completions requires bash, zsh, or fish')
    if (argv.length !== 2) usageError('completions accepts exactly one shell')
    return {
      prompt: [], model: undefined, provider: undefined, resume: undefined, dumpConfig: false,
      plugin: false, pluginArgs: [], completions: shell, help: false,
    }
  }
  const prompt: string[] = []
  let model: string | undefined
  let provider: string | undefined
  let resume: string | undefined
  let dumpConfig = false
  let help = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg === '-h' || arg === '--help') {
      help = true
    } else if (arg === '--dump-config') {
      dumpConfig = true
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
  if (dumpConfig && (resume !== undefined || prompt.length > 0)) {
    usageError('--dump-config cannot be combined with a prompt or --resume')
  }
  return { prompt, model, provider, resume, dumpConfig, plugin: false, pluginArgs: [], completions: undefined, help }
}

function usageError(message: string): never {
  console.error('omdsh: ' + message)
  console.error('run: omdsh --help')
  process.exit(2)
}
