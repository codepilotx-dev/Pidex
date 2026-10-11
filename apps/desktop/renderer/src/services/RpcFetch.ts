import type { PublicRpcMethod } from '@pidex/agent-protocol'

export class AgentRpcTimeoutError extends Error {
  readonly code = 'REVIEW_REQUEST_TIMEOUT'

  constructor(method: PublicRpcMethod) {
    super(
      method === 'review/summary' || method === 'review/refresh'
        ? '加载变更摘要超时，请重试。'
        : '加载文件差异超时，请重试。',
    )
    this.name = 'AgentRpcTimeoutError'
  }
}

export async function send(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  message: { method: string },
  connectionId: string | null,
  timeoutOverride?: (method: PublicRpcMethod) => number | undefined,
): Promise<Response> {
  const method = message.method as PublicRpcMethod
  const timeoutMs =
    timeoutOverride?.(method) ??
    (method === 'review/summary' || method === 'review/refresh'
      ? 60_000
      : method === 'review/fileDiff' || method === 'review/file-diffs'
        ? 25_000
        : undefined)
  const init: RequestInit = {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(connectionId ? { 'x-pidex-connection-id': connectionId } : {}),
    },
    body: JSON.stringify(message),
  }
  if (timeoutMs === undefined) return fetcher('/rpc', init)
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    return await fetcher('/rpc', { ...init, signal })
  } catch (error) {
    if (signal.aborted) throw new AgentRpcTimeoutError(method)
    throw error
  }
}
