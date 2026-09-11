/** Shared reading of tool-call argument JSON for summaries and streaming previews. */

/**
 * Argument fields worth surfacing as a one-line summary, in priority order. A
 * shell command is the whole intent, so `command` leads; `description` covers
 * delegation calls that carry no command or path.
 */
export const TOOL_ARG_FIELDS = ['command', 'file_path', 'path', 'pattern', 'query', 'description', 'url'] as const

/** Parse raw tool-call arguments into an object, or undefined when they are not one. */
export function toolArgsObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}
