/**
 * @oh-my-dsh/dsh-tui — the omdsh TUI capability seam.

 * Package root is the local terminal provider plugin (apply/Config). Other
 * runtime capabilities live on explicit plugin subpaths; rendering internals
 * remain private implementation modules.
 * @module @oh-my-dsh/dsh-tui
 */

export * from './definition.ts'
export { apply, name, type Config } from './provider-local.ts'
