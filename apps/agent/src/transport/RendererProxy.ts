const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const

const RENDERER_REQUEST_TIMEOUT_MS = 15_000
const RENDERER_RETRY_DELAYS_MS = [100, 300, 1_000] as const

const sanitizedHeaders = (source: Headers) => {
  const headers = new Headers(source)
  headers.delete('host')
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name)
  return headers
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const unavailableResponse = () =>
  new Response('Renderer 开发服务暂不可用', {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Pidex-Renderer-Proxy': 'upstream-unavailable',
    },
  })

const forwardedResponse = (request: Request, upstream: Response) =>
  new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: sanitizedHeaders(upstream.headers),
  })

export const proxyRendererRequest = async (request: Request, rendererDevURL: string) => {
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    return new Response('Vite HMR WebSocket 必须直连 Renderer 开发服务', {
      status: 426,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Pidex-Renderer-Proxy': 'websocket-direct-only',
        Connection: 'close',
      },
    })
  }

  const source = new URL(request.url)
  const target = new URL(source.pathname + source.search, rendererDevURL)
  const retryable = ['GET', 'HEAD'].includes(request.method)
  const deadline = Date.now() + RENDERER_REQUEST_TIMEOUT_MS

  for (let attempt = 0; ; attempt += 1) {
    let upstream: Response
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers: sanitizedHeaders(request.headers),
        ...(retryable ? {} : { body: request.body }),
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      })
    } catch {
      return unavailableResponse()
    }

    const retryDelay = RENDERER_RETRY_DELAYS_MS[attempt]
    if (
      !retryable ||
      upstream.status !== 504 ||
      retryDelay === undefined ||
      Date.now() + retryDelay >= deadline
    ) {
      return forwardedResponse(request, upstream)
    }

    await upstream.body?.cancel()
    await delay(retryDelay)
  }
}
