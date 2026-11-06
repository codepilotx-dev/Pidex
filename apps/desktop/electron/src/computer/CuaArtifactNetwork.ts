import { net } from 'electron'
import { CUA_ARTIFACT, type CuaFetcher } from './CuaRuntimeArtifact.js'

/** net.fetch cancels manual redirects; net.request lets the caller validate each hop. */
export const fetchCuaArtifact: CuaFetcher = (url, { signal }, onProgress) =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const request = net.request({ url, redirect: 'manual', useSessionCookies: false })
    const finish = (response: Response) => {
      signal?.removeEventListener('abort', abort)
      resolve(response)
    }
    const fail = (error: unknown) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    }
    const abort = () => {
      request.abort()
      fail(signal?.reason ?? new Error('Download cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    request.once('error', fail)
    request.once('redirect', (status, _method, location) => {
      finish(new Response(null, { status, headers: { location } }))
      request.abort()
    })
    request.once('response', (response) => {
      if (response.statusCode !== 200) {
        finish(new Response(null, { status: response.statusCode }))
        request.abort()
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.once('end', () =>
        finish(new Response(Buffer.concat(chunks), { status: response.statusCode })),
      )
      response.once('error', fail)
      response.once('aborted', () => fail(new Error('Download cancelled')))
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > CUA_ARTIFACT.size) {
          request.abort()
          fail(new Error('Unexpected artifact size'))
        } else {
          chunks.push(chunk)
          onProgress?.(size)
        }
      })
    })
    request.end()
  })
