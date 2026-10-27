import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 只替换当前应用的静态资源，API/SSE 交回 Chromium，保留原有同源和认证语义。 */
export function createLocalRendererResourceHandler(options: {
  origin: string
  directory: string
  fetch: (
    request: Request | string,
    init?: RequestInit & { bypassCustomProtocolHandlers?: boolean },
  ) => Promise<Response>
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url)
    if (
      url.origin !== options.origin ||
      /^\/(?:api|rpc|auth)(?:\/|$)/.test(url.pathname) ||
      url.pathname === '/health'
    ) {
      const abort = new AbortController()
      const cancel = () => abort.abort()
      if (request.signal.aborted) cancel()
      request.signal.addEventListener('abort', cancel, { once: true })
      const cleanup = () => request.signal.removeEventListener('abort', cancel)
      try {
        const response = await options.fetch(request, {
          bypassCustomProtocolHandlers: true,
          credentials: url.origin === options.origin ? 'include' : request.credentials,
          signal: abort.signal,
        })
        if (!response.body) {
          cleanup()
          return response
        }
        const reader = response.body.getReader()
        // Chromium 取消原始 URLLoader 时，要同时关闭转发请求，避免遗留 SSE 连接。
        return new Response(
          new ReadableStream({
            async pull(controller) {
              try {
                const next = await reader.read()
                if (next.done) {
                  cleanup()
                  controller.close()
                } else controller.enqueue(next.value)
              } catch (error) {
                cleanup()
                controller.error(error)
              }
            },
            cancel(reason) {
              cleanup()
              abort.abort()
              return reader.cancel(reason)
            },
          }),
          { status: response.status, statusText: response.statusText, headers: response.headers },
        )
      } catch (error) {
        cleanup()
        throw error
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response(null, { status: 405 })
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return new Response(null, { status: 400 })
    }
    if (pathname.includes('\\') || pathname.includes('\0'))
      return new Response(null, { status: 403 })
    try {
      const root = await realpath(options.directory)
      const file = await realpath(resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`))
      const child = relative(root, file)
      if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`))
        return new Response(null, { status: 403 })
      if (!(await stat(file)).isFile()) return new Response(null, { status: 404 })
      return options.fetch(pathToFileURL(file).href, {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
      })
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' ||
        (error as NodeJS.ErrnoException).code === 'ENOTDIR'
      ) {
        return new Response(null, { status: 404 })
      }
      return new Response(null, { status: 500 })
    }
  }
}
