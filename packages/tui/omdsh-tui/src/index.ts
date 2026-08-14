/**
 * @omdsh/tui — the omdsh TUI capability seam.

 * Package root is the local terminal provider plugin (apply/Config); the
 * interactive runner lives on the ./runner subpath, mirroring the harness
 * bundle/startup entry split. The rendering pipeline is pure and exported
 * for tests and alternative providers.
 * @module @omdsh/tui
 */

export * from './definition.ts'
export * from './renderer.ts'
export * from './style.ts'
export * from './theme.ts'
export * from './width.ts'
export * from './box.ts'
export * from './markdown.ts'
export * from './keys.ts'
export * from './editor.ts'
export * from './autocomplete.ts'
export * from './history-search.ts'
export * from './settings-list.ts'
export * from './event-views.ts'
export * from './provider-local.ts'
