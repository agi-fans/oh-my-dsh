/**
 * @omdsh/tui — the omdsh TUI capability seam.

 * Package root is the local terminal provider plugin (apply/Config). Other
 * runtime capabilities live on explicit plugin subpaths; rendering internals
 * remain private implementation modules.
 * @module @omdsh/tui
 */

export * from './definition.ts'
export { apply, name, type Config } from './provider-local.ts'
