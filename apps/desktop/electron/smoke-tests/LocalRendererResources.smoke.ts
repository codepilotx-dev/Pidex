import ts from 'typescript'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('本地壳独立加载，Chromium 保留认证、RPC、SSE、取消和 Range', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-resource-smoke-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const renderer = join(directory, 'renderer')
    await mkdir(renderer)
    await writeFile(
      join(renderer, 'index.html'),
      '<!doctype html><meta charset="utf-8"><title>Local shell</title><main>本地启动壳</main>',
    )
    await writeFile(join(renderer, 'module.js'), 'export const ready = true')
    const handler = join(directory, 'resources.mjs')
    await writeFile(
      handler,
      ts.transpileModule(
        await readFile(
          resolve(import.meta.dirname, '../src/security/LocalRendererResources.ts'),
          'utf8',
        ),
        { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
      ).outputText,
    )
    const entry = join(directory, 'main.cjs')
    await writeFile(
      entry,
      `
const { app, BrowserWindow, session } = require('electron');
const { createServer } = require('node:http');
const { gzipSync } = require('node:zlib');
const { pathToFileURL } = require('node:url');
app.setPath('userData', ${JSON.stringify(join(directory, 'user-data'))});
let server;
globalThis.cancelled = false;
app.on('before-quit', () => server?.closeAllConnections());
app.whenReady().then(async () => {
  const { createLocalRendererResourceHandler } = await import(pathToFileURL(${JSON.stringify(handler)}).href);
  server = createServer(async (req, res) => {
    if (req.headers.cookie !== 'pidex_session=resource-smoke') { res.writeHead(401).end(); return; }
    if (req.headers.origin && req.headers.origin !== globalThis.origin) { res.writeHead(403).end(); return; }
    if (req.url === '/api/compressed') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' }); res.end(gzipSync('compressed payload')); return; }
    if (req.url.startsWith('/rpc/events')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('id: 8\\ndata: first\\n\\n');
      const timer = setTimeout(() => res.write('id: 9\\ndata: second\\n\\n'), 150);
      res.on('close', () => { clearTimeout(timer); globalThis.cancelled = true; });
      return;
    }
    if (req.headers.range) { res.writeHead(206, { 'Content-Range': 'bytes 2-5/10' }); res.end('2345'); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ method: req.method, body, url: req.url }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  globalThis.origin = 'http://127.0.0.1:' + server.address().port;
  session.defaultSession.protocol.handle('http', createLocalRendererResourceHandler({ origin: globalThis.origin, directory: ${JSON.stringify(renderer)}, fetch: (input, init) => session.defaultSession.fetch(input, init) }));
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await window.loadURL(globalThis.origin);
});
`,
    )
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    application = await electron.launch({ args: [entry], env: environment })
    const page = await application.firstWindow()
    await expect(page.locator('main')).toHaveText('本地启动壳')
    expect(await page.evaluate(async () => (await fetch('/missing.js')).status)).toBe(404)
    expect(await page.evaluate(async () => (await import('/module.js')).ready)).toBe(true)
    expect(await page.evaluate(async () => (await fetch('/api/ready')).status)).toBe(401)
    await application.evaluate(async ({ session }) => {
      const origin = (globalThis as typeof globalThis & { origin: string }).origin
      await session.defaultSession.cookies.set({
        url: origin,
        name: 'pidex_session',
        value: 'resource-smoke',
        httpOnly: true,
        sameSite: 'strict',
      })
    })
    expect(
      await page.evaluate(async () =>
        (
          await fetch('/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"id":1}',
          })
        ).json(),
      ),
    ).toEqual({ method: 'POST', body: '{"id":1}', url: '/rpc' })
    expect(
      await page.evaluate(async () => {
        const response = await fetch('/api/download', { headers: { Range: 'bytes=2-5' } })
        return {
          status: response.status,
          range: response.headers.get('Content-Range'),
          body: await response.text(),
        }
      }),
    ).toEqual({ status: 206, range: 'bytes 2-5/10', body: '2345' })
    expect(await page.evaluate(async () => (await fetch('/api/compressed')).text())).toBe(
      'compressed payload',
    )
    expect(
      await page.evaluate(
        () =>
          new Promise<string[]>((resolve, reject) => {
            const events: string[] = []
            const source = new EventSource('/rpc/events?after=7', { withCredentials: true })
            source.onmessage = (event) => {
              events.push(`${event.lastEventId}:${event.data}`)
              if (events.length === 2) {
                source.close()
                resolve(events)
              }
            }
            source.onerror = () => {
              source.close()
              reject(new Error('SSE failed'))
            }
          }),
      ),
    ).toEqual(['8:first', '9:second'])
    await expect
      .poll(() =>
        application!.evaluate(
          () => (globalThis as typeof globalThis & { cancelled: boolean }).cancelled,
        ),
      )
      .toBe(true)
    const status = await page.evaluate(async () => (await fetch('/api/ready')).status)
    expect(status).toBe(200)
  } finally {
    await application?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})
