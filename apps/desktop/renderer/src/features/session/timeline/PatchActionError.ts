import { AgentRpcError } from '../../../services/AgentRpcClient.js'

import type { PatchAction } from './CanonicalItemRenderer.js'

export function normalizePatchActionError(error: unknown, action: PatchAction): Error {
  if (
    error instanceof AgentRpcError &&
    (error.status === 409 || error.errorCode === 'WORKSPACE_CONFLICT')
  ) {
    return new Error(
      action === 'undo' ? '文件已被后续修改，无法撤销' : '文件已被后续修改，无法重新应用',
    )
  }
  if (error instanceof Error) return error
  return new Error(action === 'undo' ? '无法撤销文件修改' : '无法重新应用文件修改')
}
