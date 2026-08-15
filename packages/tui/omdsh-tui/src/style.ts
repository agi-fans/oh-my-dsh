/**
 * Thin adapter over the oh-my-pi theme for callers that still want the
 * original six wrap functions. New view code should use `createTheme`.
 * @module @agi-fans/dsh-tui
 */

import { createTheme } from './theme.ts'

/** Per-style wrap functions; every member is (text: string) => string. */
export interface Style {
  /** Dimmed. */
  dim(text: string): string
  /** Bold. */
  bold(text: string): string
  cyan(text: string): string
  green(text: string): string
  red(text: string): string
  yellow(text: string): string
}

/**
 * Build the style set from the OMP theme.
 * @param colors - whether to emit SGR color/dim sequences.
 * @returns the wrapped style functions.
 */
export function createStyle(colors: boolean): Style {
  const theme = createTheme(colors, false)
  return {
    dim: (text) => theme.dim(text),
    bold: (text) => theme.bold(text),
    cyan: (text) => theme.fg('border', text),
    green: (text) => theme.fg('success', text),
    red: (text) => theme.fg('error', text),
    yellow: (text) => theme.fg('warning', text),
  }
}
