/** Exact invocation preview shared by approval and revocation readers. */
import type { ApprovalAction } from '../runtime/approval-rules.ts'

export function approvalActionDetail(action: ApprovalAction): string {
  return `Tool: ${action.tool}\nDirectory: ${action.cwd}\nWorkspace: ${action.workspace}\nAccess: ${action.sandbox}\n\nArguments:\n${JSON.stringify(JSON.parse(action.arguments), null, 2)}\n\nApproval reason:\n${action.reason || '(none)'}`
}
