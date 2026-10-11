import type { DesktopApi, DesktopSessionSnapshot } from '../../../shared/Types.js'
import type { ThreadListItem } from '@pidex/shared/thread'
import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import { sessionDisplayTitle } from '../../UiTypes.js'

type WithAgentOrMock = <T>(
  agentOperation: () => Promise<T>,
  mockOperation: () => Promise<T>,
) => Promise<T>

type ThreadTitleRpc = {
  call(
    method: 'thread/title/regenerate',
    params: RpcParams<'thread/title/regenerate'>,
  ): Promise<RpcResult<'thread/title/regenerate'>>
}

export function regenerateSessionTitle(
  sessionId: string,
  withAgentOrMock: WithAgentOrMock,
  rpc: ThreadTitleRpc,
  cacheThread: (thread: ThreadListItem) => Promise<DesktopSessionSnapshot>,
  mockClient: Pick<DesktopApi, 'getSession' | 'renameSession'>,
): Promise<DesktopSessionSnapshot> {
  return withAgentOrMock(
    async () =>
      cacheThread(
        (
          await rpc.call('thread/title/regenerate', {
            threadId: sessionId,
            operationId: crypto.randomUUID(),
          })
        ).thread,
      ),
    async () =>
      mockClient.renameSession(
        sessionId,
        sessionDisplayTitle(null, (await mockClient.getSession(sessionId)).item.firstPrompt),
      ),
  )
}
