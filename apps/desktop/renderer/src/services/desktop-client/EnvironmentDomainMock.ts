import type { RpcMethod, RpcParams, RpcResult } from '@pidex/agent-protocol'

export async function browserEnvironmentCall<M extends RpcMethod>(
  method: M,
  params: RpcParams<M>,
): Promise<RpcResult<M>> {
  const input = params as Record<string, unknown>
  let result: unknown
  switch (method) {
    case 'worktree/list':
    case 'worktree/settings/list':
      result = { worktrees: [] }
      break
    case 'github/watch/list':
      result = { watches: [] }
      break
    case 'local-environment/project/list':
      result = {
        environments: [
          {
            id: 'mock-default',
            name: '默认环境',
            path: `C:/mock/${String(input.projectId)}/.pidex/environments/environment.jsonc`,
            inherited: false,
            exists: false,
            invalid: false,
          },
        ],
        selectedEnvironmentId: null,
      }
      break
    case 'local-environment/project/read':
    case 'local-environment/read':
      result = {
        exists: false,
        filePath: `C:/mock/${String(input.projectId ?? input.threadId)}/.pidex/environments/environment.jsonc`,
        gitRoot: 'C:/mock',
        revision: '0'.repeat(64),
        configHash: '0'.repeat(64),
        config: { schema_version: 1, name: '默认环境', actions: [] },
        executionTrusted: false,
      }
      break
    case 'local-environment/action/list':
      result = { revision: '0'.repeat(64), actions: [] }
      break
    case 'thread/list':
      result = { threads: [], nextCursor: null }
      break
    default:
      throw new Error(
        '浏览器模拟环境不执行本地 Git、环境脚本或 GitHub 自动化；请在桌面应用中使用。',
      )
  }
  return result as RpcResult<M>
}
