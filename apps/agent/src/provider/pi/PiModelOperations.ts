import { AgentError } from '../../Domain'

export type ModelOperationOptions = {
  apiKey?: string
  signal?: AbortSignal
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

export async function requestModelOperation(
  endpoint: string,
  headers: Headers,
  body: Record<string, unknown>,
  options: ModelOperationOptions = {},
): Promise<Record<string, unknown>> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(60000),
    ...(options.signal ? [options.signal] : []),
  ])
  const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers,
    body: JSON.stringify(body),
    signal,
  }).catch(() => {
    if (signal.aborted) throw new DOMException('模型请求已取消或超时', 'AbortError')
    throw new AgentError('PROVIDER_UNAVAILABLE', '模型请求未完成，请检查网络和端点配置', 502)
  })
  if (!response.ok)
    throw new AgentError(
      'PROVIDER_UNAVAILABLE',
      `模型请求失败（HTTP ${response.status}）`,
      response.status,
    )
  if (!response.body) throw new AgentError('PROVIDER_UNAVAILABLE', '模型返回了空响应', 502)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 16 * 1024 * 1024) {
        await reader.cancel()
        throw new AgentError('PROVIDER_UNAVAILABLE', '模型响应超过 16 MiB 限制', 502)
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new AgentError('PROVIDER_UNAVAILABLE', '模型返回的 JSON 格式无效', 502)
  }
}

export function operationInputTokens(result: Record<string, unknown>): number {
  const usage = result.usage as { prompt_tokens?: unknown; total_tokens?: unknown } | undefined
  const value = usage?.prompt_tokens ?? usage?.total_tokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}
