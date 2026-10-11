import { afterEach, describe, expect, test } from 'bun:test'
import { proxyRendererRequest } from '../src/transport/RendererProxy'

const servers: ReturnType<typeof Bun.serve>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
})

describe('Renderer 开发代理', () => {
  test('拒绝把 Vite HMR WebSocket 当作普通 HTTP 转发', async () => {
    let upstreamCalls = 0
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        upstreamCalls += 1
        return new Response('unexpected')
      },
    })
    servers.push(upstream)

    const response = await proxyRendererRequest(
      new Request('http://127.0.0.1:9000/', {
        headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
      }),
      `http://127.0.0.1:${upstream.port}`,
    )

    expect(response.status).toBe(426)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-pidex-renderer-proxy')).toBe('websocket-direct-only')
    expect(upstreamCalls).toBe(0)
  })

  test('普通页面请求仍然转发到 Vite', async () => {
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('renderer-ready', { headers: { 'Content-Type': 'text/plain' } }),
    })
    servers.push(upstream)

    const response = await proxyRendererRequest(
      new Request('http://127.0.0.1:9000/demo?mode=dev'),
      `http://127.0.0.1:${upstream.port}`,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('renderer-ready')
  })

  test('Vite 瞬时 504 会有限重试并恢复模块响应', async () => {
    let upstreamCalls = 0
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        upstreamCalls += 1
        if (upstreamCalls < 3) return new Response(null, { status: 504 })
        return new Response('module-ready')
      },
    })
    servers.push(upstream)

    const response = await proxyRendererRequest(
      new Request('http://127.0.0.1:9000/src/ConversationPage.tsx'),
      `http://127.0.0.1:${upstream.port}`,
    )

    expect(upstreamCalls).toBe(3)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('module-ready')
  })

  test('持续 504 最多尝试四次并保留最终响应', async () => {
    let upstreamCalls = 0
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        upstreamCalls += 1
        return new Response('still-outdated', { status: 504 })
      },
    })
    servers.push(upstream)

    const response = await proxyRendererRequest(
      new Request('http://127.0.0.1:9000/src/ConversationPage.tsx'),
      `http://127.0.0.1:${upstream.port}`,
    )

    expect(upstreamCalls).toBe(4)
    expect(response.status).toBe(504)
    expect(await response.text()).toBe('still-outdated')
  })

  test('非幂等请求遇到 504 不会重试', async () => {
    let upstreamCalls = 0
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        upstreamCalls += 1
        expect(await request.text()).toBe('payload')
        return new Response(null, { status: 504 })
      },
    })
    servers.push(upstream)

    const response = await proxyRendererRequest(
      new Request('http://127.0.0.1:9000/demo', {
        method: 'POST',
        body: 'payload',
      }),
      `http://127.0.0.1:${upstream.port}`,
    )

    expect(upstreamCalls).toBe(1)
    expect(response.status).toBe(504)
  })

  test('上游不可用时返回不泄露内部信息的安全响应', async () => {
    const rendererDevURL = 'http://127.0.0.1:1/private-renderer-path'
    const response = await proxyRendererRequest(
      new Request('http://127.0.0.1:9000/demo'),
      rendererDevURL,
    )
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-pidex-renderer-proxy')).toBe('upstream-unavailable')
    expect(body).toBe('Renderer 开发服务暂不可用')
    expect(body).not.toContain(rendererDevURL)
    expect(body).not.toContain('127.0.0.1')
  })

  test('条件请求保留 Vite 的 ETag、304 和空响应体', async () => {
    let receivedETag = ''
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => {
        receivedETag = request.headers.get('if-none-match') ?? ''
        return new Response(null, {
          status: 304,
          headers: { ETag: '"renderer-v1"' },
        })
      },
    })
    servers.push(upstream)

    const response = await proxyRendererRequest(
      new Request('http://127.0.0.1:9000/src/App.tsx', {
        headers: { 'If-None-Match': '"renderer-v1"' },
      }),
      `http://127.0.0.1:${upstream.port}`,
    )

    expect(receivedETag).toBe('"renderer-v1"')
    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe('"renderer-v1"')
    expect(await response.text()).toBe('')
  })
})
