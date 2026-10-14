/** Shell completion generation from the canonical omdsh CLI metadata. */

import { OMDSH_CLI_COMMANDS, OMDSH_CLI_OPTIONS, type CompletionShell } from './args.ts'

const words = [...OMDSH_CLI_COMMANDS.map(command => command.name), ...OMDSH_CLI_OPTIONS.flatMap(option => option.names)].join(' ')

function bash(): string {
  return `# bash completion for omdsh
_omdsh() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [[ "$prev" == "completions" ]]; then COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") ); return; fi
  if [[ "\${COMP_WORDS[1]}" == "doctor" ]]; then COMPREPLY=( $(compgen -W "--json --help" -- "$cur") ); return; fi
  if [[ "\${COMP_WORDS[1]}" == "exec" ]]; then COMPREPLY=( $(compgen -W "--json --model --provider --resume --help" -- "$cur") ); return; fi
  COMPREPLY=( $(compgen -W "${words}" -- "$cur") )
}
complete -F _omdsh omdsh
`
}

function zsh(): string {
  const options = OMDSH_CLI_OPTIONS.map(option => `  '${option.names.join(',')}[${option.description}]${option.takesValue ? ':value:' : ''}'`).join(' \\\n')
  return `#compdef omdsh
_omdsh() {
  local -a commands
  commands=(${OMDSH_CLI_COMMANDS.map(command => `'${command.name}:${command.description}'`).join(' ')})
  _arguments -s \\
${options} \\
  '1:command:->command' '*::argument:->args'
  case $state in
    command) _describe 'command' commands ;;
    args)
      if [[ $words[2] == completions ]]; then _values 'shell' bash zsh fish
      elif [[ $words[2] == doctor ]]; then _values 'option' --json --help
      elif [[ $words[2] == exec ]]; then _values 'option' --json --model --provider --resume --help; fi ;;
  esac
}
_omdsh "$@"
`
}

function fish(): string {
  const options = OMDSH_CLI_OPTIONS.flatMap(option => {
    const long = option.names.find(name => name.startsWith('--'))
    const short = option.names.find(name => /^-[^-]$/u.test(name))
    if (long === undefined) return []
    return [`complete -c omdsh${short === undefined ? '' : ` -s ${short.slice(1)}`} -l ${long.slice(2)}${option.takesValue ? ' -r' : ''} -d '${option.description.replace(/'/gu, "\\'")}'`]
  })
  const commands = OMDSH_CLI_COMMANDS.map(command => `complete -c omdsh -f -n '__fish_use_subcommand' -a '${command.name}' -d '${command.description}'`)
  return ['# fish completion for omdsh', ...options, ...commands, "complete -c omdsh -f -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish'",
    "complete -c omdsh -f -n '__fish_seen_subcommand_from doctor' -l json -d 'Print diagnostic JSON'", "complete -c omdsh -f -n '__fish_seen_subcommand_from exec' -l json -d 'Stream execution JSON'", ''].join('\n')
}

export function generateCompletions(shell: CompletionShell): string {
  if (shell === 'bash') return bash()
  if (shell === 'zsh') return zsh()
  return fish()
}
