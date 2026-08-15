/**
 * `/pwd` notice: workspace cwd, git branch, and model.
 * Pure — the provider owns the live values.
 * @module @oh-my-dsh/dsh-tui
 */

/** Inputs painted by `/pwd`. */
export interface WorkspaceInfo {
  cwd: string
  model: string
  branch?: string
}

/** Body shown as a notice when `/pwd` runs. */
export function formatWorkspaceText(info: WorkspaceInfo): string {
  const lines = ['Workspace', '  cwd: ' + info.cwd]
  if (info.branch !== undefined && info.branch !== '') lines.push('  branch: ' + info.branch)
  lines.push('  model: ' + info.model)
  return lines.join('\n')
}
