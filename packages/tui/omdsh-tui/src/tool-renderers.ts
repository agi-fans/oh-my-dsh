/**
 * Tool presentation registry. Built-ins provide compact coding-agent views;
 * third-party plugins can contribute an exact-name renderer through TuiService.
 * @module @omdsh/tui/tool-renderers
 */

export interface ToolRenderInput {
  name: string
  arguments: string
  output: string
  status: 'running' | 'ok' | 'error'
  expanded: boolean
}

export interface ToolPresentation {
  title?: string
  summary?: string
  lines?: readonly string[]
}

export interface TuiToolRenderer {
  readonly names: readonly string[]
  render(input: ToolRenderInput): ToolPresentation
}

function objectArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function stringArg(args: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) if (typeof args[name] === 'string') return args[name]
  return undefined
}

function outputLines(input: ToolRenderInput): string[] {
  return input.output === '' ? [] : input.output.split('\n')
}

const bashRenderer: TuiToolRenderer = {
  names: ['bash'],
  render: (input) => {
    const args = objectArgs(input.arguments)
    const command = stringArg(args, 'command') ?? input.arguments
    const cwd = stringArg(args, 'cwd', 'workdir')
    return {
      title: 'bash',
      summary: `$ ${command}${cwd === undefined ? '' : `  ·  ${cwd}`}`,
      lines: outputLines(input),
    }
  },
}

const fileRenderer: TuiToolRenderer = {
  names: ['read', 'read_image', 'write', 'edit', 'str_replace_editor', 'apply_patch'],
  render: (input) => {
    const args = objectArgs(input.arguments)
    const path = stringArg(args, 'path', 'file_path', 'filePath')
    const range = [args.offset, args.limit].filter(value => typeof value === 'number').join(':')
    return {
      title: input.name,
      summary: path === undefined ? input.arguments : path + (range === '' ? '' : `:${range}`),
      lines: outputLines(input),
    }
  },
}

const searchRenderer: TuiToolRenderer = {
  names: ['grep', 'glob'],
  render: (input) => {
    const args = objectArgs(input.arguments)
    const query = stringArg(args, 'pattern', 'query', 'glob')
    const path = stringArg(args, 'path', 'cwd')
    const lines = outputLines(input)
    return {
      title: input.name,
      summary: [query, path].filter(Boolean).join('  ·  ') || input.arguments,
      lines,
    }
  },
}

const workflowRenderer: TuiToolRenderer = {
  names: [
    'todo_write', 'get_goal', 'create_goal', 'update_goal',
    'job_output', 'job_list', 'job_kill',
    'subagent', 'send_message', 'interrupt_agent', 'list_agents',
    'ask_user_question', 'exit_plan_mode',
  ],
  render: input => ({
    title: input.name.replaceAll('_', ' '),
    summary: input.arguments,
    lines: outputLines(input),
  }),
}

export const BUILTIN_TOOL_RENDERERS: readonly TuiToolRenderer[] = [
  bashRenderer,
  fileRenderer,
  searchRenderer,
  workflowRenderer,
]

/** Resolve the last registered exact-name contribution, then the generic fallback. */
export function renderTool(
  input: ToolRenderInput,
  renderers: readonly TuiToolRenderer[] = BUILTIN_TOOL_RENDERERS,
): ToolPresentation {
  for (let i = renderers.length - 1; i >= 0; i -= 1) {
    const renderer = renderers[i]
    if (renderer?.names.includes(input.name) !== true) continue
    try {
      return renderer.render(input)
    } catch {
      break
    }
  }
  return { title: input.name, summary: input.arguments, lines: outputLines(input) }
}
