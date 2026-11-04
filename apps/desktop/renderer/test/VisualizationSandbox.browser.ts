import { _electron, type ElectronApplication } from '@playwright/test'
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

// Real Chromium/Electron boundary check; no screenshot or UI click sequence.
const root = await mkdtemp(join(tmpdir(), 'pidex-visualization-check-'))
const renderer = fileURLToPath(new URL('..', import.meta.url))
let leaks = 0
const server = createServer(async (request, response) => {
  const path = new URL(request.url!, 'http://127.0.0.1').pathname
  if (path === '/visualization-frame.html' || path === '/visualization-frame.js') {
    response.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : 'text/javascript')
    response.end(await readFile(join(renderer, 'public', path.slice(1))))
    return
  }
  if (path === '/leak') {
    leaks++
    response.end('leak')
    return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end(
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; frame-src \'self\'"></head><body><iframe id="frame" src="/visualization-frame.html" sandbox="allow-scripts"></iframe></body></html>',
  )
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const origin = `http://127.0.0.1:${address.port}`
let app: ElectronApplication | undefined
try {
  const isolation = join(root, 'isolation.cjs')
  const electronRequire = createRequire(new URL('../../electron/package.json', import.meta.url))
  const ts = electronRequire('typescript') as typeof import('typescript')
  const source = await readFile(
    new URL('../../electron/src/security/VisualizationIsolation.ts', import.meta.url),
    'utf8',
  )
  await writeFile(
    isolation,
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    'utf8',
  )
  const executablePath = electronRequire('electron') as string
  const harness = join(root, 'main.cjs')
  const preload = join(root, 'preload.cjs')
  await writeFile(
    preload,
    "require('electron').contextBridge.exposeInMainWorld('DesktopBridge', {host: true});",
    'utf8',
  )
  await mkdir(join(root, 'userData'))
  await writeFile(
    harness,
    `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(root, 'userData'))});
const {installVisualizationIsolation}=require(${JSON.stringify(isolation)});
app.whenReady().then(()=>{const win=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(preload)},sandbox:true,nodeIntegration:false,contextIsolation:true}});installVisualizationIsolation(win.webContents);win.loadURL(${JSON.stringify(origin)});});`,
    'utf8',
  )
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  app = await _electron.launch({
    executablePath,
    args: [harness],
    env: environment,
    timeout: 15000,
  })
  const page = await app.firstWindow({ timeout: 15000 })
  page.setDefaultTimeout(10000)
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('sandbox console:', message.text())
  })
  page.on('pageerror', (error) => console.log('sandbox page error:', error.message))
  await page.waitForLoadState('load')
  assert.equal(await page.evaluate(() => 'DesktopBridge' in globalThis), true)
  await page.evaluate(() => {
    localStorage.setItem('host-secret', 'private')
    const frame = document.querySelector<HTMLIFrameElement>('#frame')!
    const channel = new MessageChannel()
    const harness = window as unknown as { messages: unknown[]; port: MessagePort }
    harness.messages = []
    harness.port = channel.port1
    channel.port1.onmessage = (event) => harness.messages.push(event.data)
    channel.port1.start()
    frame.contentWindow!.postMessage({ type: 'pidex:initialize' }, '*', [channel.port2])
  })
  await page.waitForFunction(() =>
    (window as unknown as { messages: { type: string }[] }).messages.some(
      (m) => m.type === 'connected',
    ),
  )
  const send = (content: Record<string, unknown>) =>
    page.evaluate(
      (content) => (window as unknown as { port: MessagePort }).port.postMessage(content),
      content,
    )
  await send({
    type: 'render',
    revision: 1,
    final: false,
    css: '',
    html: '<p id="preview" onclick="window.generatedRan=1">预览</p><script>window.generatedRan=1</script>',
    jsFunctions: 'window.generatedRan=1',
    jsExpressions: [],
  })
  const frame = page.frames().find((frame) => frame.url().endsWith('/visualization-frame.html'))!
  await frame.waitForSelector('#preview')
  assert.equal(await frame.evaluate(() => 'DesktopBridge' in globalThis), false)
  assert.equal(
    await frame.locator('#visualization-root').evaluate((node) => (node as HTMLElement).inert),
    true,
  )
  assert.equal(
    await frame.evaluate(() => (window as unknown as { generatedRan?: number }).generatedRan),
    undefined,
  )
  assert.equal(await frame.locator('#preview').getAttribute('onclick'), null)
  await send({
    type: 'render',
    revision: 2,
    final: true,
    css: '',
    html: '<input id="count" value="2" aria-label="人数">',
    libraries: [],
    jsFunctions: `window.executions=(window.executions||0)+1;try{parent.document.body.dataset.exposed='yes'}catch{window.parentBlocked=true}try{localStorage.getItem('host-secret')}catch{window.storageBlocked=true}try{fetch(${JSON.stringify(`${origin}/leak`)}).catch(()=>{})}catch{};Pidex.sendPrompt({text:'继续分析',selection:{people:2}});`,
    jsExpressions: [],
  })
  await page.waitForFunction(() =>
    (window as unknown as { messages: { type: string }[] }).messages.some(
      (m) => m.type === 'ready',
    ),
  )
  assert.deepEqual(
    await frame.evaluate(() => {
      const w = window as unknown as {
        executions: number
        parentBlocked: boolean
        storageBlocked: boolean
      }
      return {
        executions: w.executions,
        parentBlocked: w.parentBlocked,
        storageBlocked: w.storageBlocked,
      }
    }),
    { executions: 1, parentBlocked: true, storageBlocked: true },
  )
  assert.equal(leaks, 0)
  await send({
    type: 'render',
    revision: 3,
    final: true,
    css: '',
    html: '',
    jsFunctions: 'window.executions++',
  })
  await send({ type: 'theme', theme: { foreground: '#123456', scheme: 'dark' } })
  await frame.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--pidex-foreground') === '#123456',
  )
  assert.equal(
    await frame.evaluate(() => (window as unknown as { executions: number }).executions),
    1,
  )
  await frame.evaluate((url) => {
    location.href = url
  }, `${origin}/leak`)
  await page.waitForFunction(
    () => document.querySelector<HTMLIFrameElement>('#frame')?.contentWindow !== null,
  )
  assert.equal(leaks, 0)
  console.log(
    'PASS: static preview, isolated execution/storage/network/navigation, once-only execution, theme, staged follow-up',
  )
} finally {
  await app?.close()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes('pidex-visualization-check-'))
    throw new Error('Unexpected cleanup directory')
  await rm(root, { recursive: true, force: true })
}
