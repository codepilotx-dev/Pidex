import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalRendererResourceHandler } from '../src/security/LocalRendererResources.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test('Agent 未启动也可加载本地资源，缺失 chunk 不回退 HTML，禁止越界', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-local-renderer-'))
  directories.push(directory)
  const root = join(directory, 'renderer')
  await mkdir(root)
  await writeFile(join(root, 'index.html'), '<main>startup shell</main>')
  await writeFile(join(directory, 'private.txt'), 'private')
  const handle = createLocalRendererResourceHandler({
    origin: 'http://127.0.0.1:4250',
    directory: root,
    fetch: async (input) => {
      if (typeof input !== 'string' || !input.startsWith('file:'))
        throw new Error('network unavailable')
      return new Response(Bun.file(fileURLToPath(input)))
    },
  })
  const request = (path: string) => handle(new Request(`http://127.0.0.1:4250${path}`))
  expect(await (await request('/')).text()).toContain('startup shell')
  expect((await request('/missing.js')).status).toBe(404)
  expect((await request('/..%2fprivate.txt')).status).toBe(403)
  expect((await request('/%zz')).status).toBe(400)
})

test('API、RPC、回调及其他 origin 原样交给网络栈，保留 POST、cookie、Range 和取消信号', async () => {
  for (const path of [
    '/rpc',
    '/rpc/events?after=12',
    '/api/ready',
    '/auth/github/callback',
    '/health',
    'http://127.0.0.1:4251/assets/module.js',
  ]) {
    const request = new Request(path.startsWith('http:') ? path : `http://127.0.0.1:4250${path}`, {
      method: 'POST',
      headers: { Cookie: 'pidex_session=test', Range: 'bytes=2-5' },
      body: 'payload',
    })
    const handle = createLocalRendererResourceHandler({
      origin: 'http://127.0.0.1:4250',
      directory: 'unused',
      fetch: async (forwarded, init) => {
        expect(forwarded).toBe(request)
        expect(init).toMatchObject({
          bypassCustomProtocolHandlers: true,
          credentials:
            new URL(request.url).origin === 'http://127.0.0.1:4250'
              ? 'include'
              : request.credentials,
        })
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        expect(await (forwarded as Request).text()).toBe('payload')
        expect((forwarded as Request).headers.get('Range')).toBe('bytes=2-5')
        return new Response('ok')
      },
    })
    expect(await (await handle(request)).text()).toBe('ok')
  }
})
