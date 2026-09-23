/**
 * @agi-fans/dsh-tui — the omdsh TUI capability seam.

 * Package root is the local terminal provider plugin (apply/Config). Other
 * runtime capabilities live on explicit plugin subpaths; rendering internals
 * remain private implementation modules.
 * @module @agi-fans/dsh-tui
 */

export * from './definition.ts'
export { apply, Config, name } from './runtime/provider-local.ts'
