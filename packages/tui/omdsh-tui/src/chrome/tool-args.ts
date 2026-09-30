/** Shared reading of tool-call argument JSON for summaries and streaming previews. */

/**
 * Argument fields worth surfacing as a one-line summary, in priority order. A
 * shell command is the whole intent, so `command` leads; `description` covers
 * delegation calls that carry no command or path.
 */
/**
 * Argument keys, in the order a folded row reads them.
 *
 * A search tool carries both a pattern and a scope, and the order decides
 * whether the row names what it looked for or where it looked — `path` first
 * made every `grep` read `grep packages`, which is the one fact a reader cannot
 * guess, since the directory is usually the same one for every search in the
 * run. What the call went looking for comes first, and where it looked rides
 * along after it.
 */
export const TOOL_ARG_FIELDS = [
  'command',
  'query',
  'pattern',
  'description',
  'url',
  'file_path',
  'path',
] as const

/** Keys that say what a call looked for, as opposed to where it looked. */
export const TOOL_ARG_INTENT_FIELDS: readonly string[] = ['query', 'pattern', 'url', 'command', 'description']

/** Keys that say where a call looked. */
export const TOOL_ARG_SCOPE_FIELDS: readonly string[] = ['file_path', 'path']

/**
 * The order a framed block lists a call's arguments in.
 *
 * Deliberately not {@link TOOL_ARG_FIELDS}. A boxed call is a block of input a
 * reader is being shown, and the thing being worked on belongs at the top of it;
 * only a one-line row has to choose between naming what was sought and naming
 * where, because a row has room for one of them.
 */
export const TOOL_PREVIEW_FIELDS: readonly string[] = [
  'file_path',
  'path',
  'command',
  'query',
  'pattern',
  'url',
  'description',
]

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
