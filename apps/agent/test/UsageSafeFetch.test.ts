import { describe, expect, test } from 'bun:test'
import { createSafeUsageRequester } from '../src/usage/SafeFetch'

describe('safe usage fetch', () => {
  test('拒绝 redirect、超大响应和非法 JSON，并映射安全状态', async () => {
    const responses = [
      new Response(null, { status: 302, headers: { Location: 'https://example.com' } }),
      new Response('x', { headers: { 'content-length': String(1024 * 1024 + 1) } }),
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(700_000))
            controller.enqueue(new Uint8Array(400_000))
            controller.close()
          },
        }),
      ),
      new Response('{'),
      new Response(null, { status: 401 }),
      new Response(null, { status: 403 }),
      new Response(null, { status: 429 }),
    ]
    const request = createSafeUsageRequester(async () => responses.shift()!)
    await expect(request('https://api.example.test/redirect')).rejects.toMatchObject({
      category: 'invalid-response',
    })
    await expect(request('https://api.example.test/large')).rejects.toMatchObject({
      category: 'invalid-response',
    })
    await expect(request('https://api.example.test/chunked-large')).rejects.toMatchObject({
      category: 'invalid-response',
    })
    await expect(request('https://api.example.test/json')).rejects.toMatchObject({
      category: 'invalid-response',
    })
    await expect(request('https://api.example.test/auth')).rejects.toMatchObject({
      category: 'authentication',
      retryable: false,
    })
    await expect(request('https://api.example.test/permission')).rejects.toMatchObject({
      category: 'permission',
      retryable: false,
    })
    await expect(request('https://api.example.test/rate')).rejects.toMatchObject({
      category: 'rate-limit',
      retryable: true,
    })
  })

  test('合并调用方 signal 且始终附加八秒超时', async () => {
    const controller = new AbortController()
    let signal: AbortSignal | null = null
    const request = createSafeUsageRequester(async (_url, init) => {
      signal = init?.signal ?? null
      return Response.json({ ok: true })
    })
    await request('https://api.example.test', { signal: controller.signal })
    expect(signal).not.toBe(controller.signal)
    controller.abort()
    expect((signal as AbortSignal | null)?.aborted).toBe(true)
  })

  test('超时只返回安全的可重试网络错误', async () => {
    const request = createSafeUsageRequester(async () => {
      throw new DOMException('contains raw upstream details', 'TimeoutError')
    })
    await expect(request('https://api.example.test')).rejects.toMatchObject({
      category: 'network',
      retryable: true,
      message: '厂商用量查询请求超时或已取消',
    })
  })
})
