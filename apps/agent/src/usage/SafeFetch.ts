import type { UsageErrorCategory } from './Types'

const MAX_RESPONSE_BYTES = 1024 * 1024

export class UsageRequestError extends Error {
  constructor(
    readonly category: UsageErrorCategory,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
  }
}

export type UsageFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.waiters.shift()?.()
    }
  }
}

const safeStatusError = (status: number) => {
  if (status === 401) return new UsageRequestError('authentication', '凭据鉴权失败', false, status)
  if (status === 403)
    return new UsageRequestError('permission', '当前凭据缺少查询用量所需权限', false, status)
  if (status === 402)
    return new UsageRequestError('plan', '当前套餐不支持此用量查询', false, status)
  if (status === 429)
    return new UsageRequestError('rate-limit', '厂商接口暂时限流，请稍后重试', true, status)
  if (status >= 500) return new UsageRequestError('network', '厂商用量服务暂时不可用', true, status)
  return new UsageRequestError('invalid-response', '厂商返回了无法处理的响应', false, status)
}

const readBoundedJSON = async (response: Response) => {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new UsageRequestError('invalid-response', '厂商响应超过安全大小限制', false)
  }
  if (!response.body) {
    try {
      return await response.json()
    } catch {
      throw new UsageRequestError('invalid-response', '厂商返回的 JSON 无效', false)
    }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new UsageRequestError('invalid-response', '厂商响应超过安全大小限制', false)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new UsageRequestError('invalid-response', '厂商返回的 JSON 无效', false)
  }
}

export const createSafeUsageRequester = (
  fetcher: UsageFetcher = globalThis.fetch.bind(globalThis),
) => {
  const concurrency = new Semaphore(4)
  return (url: string, init: RequestInit = {}) =>
    concurrency.run(async () => {
      let response: Response
      try {
        response = await fetcher(url, {
          ...init,
          redirect: 'manual',
          signal: init.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(8_000)])
            : AbortSignal.timeout(8_000),
        })
      } catch (cause) {
        if (cause instanceof UsageRequestError) throw cause
        if (
          cause instanceof DOMException &&
          (cause.name === 'TimeoutError' || cause.name === 'AbortError')
        ) {
          throw new UsageRequestError('network', '厂商用量查询请求超时或已取消', true)
        }
        throw new UsageRequestError('network', '无法连接厂商用量服务', true)
      }
      if (response.status >= 300 && response.status < 400) {
        throw new UsageRequestError(
          'invalid-response',
          '厂商用量接口返回了不安全的重定向',
          false,
          response.status,
        )
      }
      if (!response.ok) throw safeStatusError(response.status)
      try {
        return await readBoundedJSON(response)
      } catch (cause) {
        if (cause instanceof UsageRequestError) throw cause
        if (
          cause instanceof DOMException &&
          (cause.name === 'TimeoutError' || cause.name === 'AbortError')
        ) {
          throw new UsageRequestError('network', '厂商用量查询请求超时或已取消', true)
        }
        throw new UsageRequestError('network', '读取厂商用量响应失败', true)
      }
    })
}
