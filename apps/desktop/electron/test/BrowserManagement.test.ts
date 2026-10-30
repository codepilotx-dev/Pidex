import { afterEach, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { BrowserCommand } from '@pidex/agent-protocol'
import { runBrowserOperation } from '../src/browser/BrowserOperations.js'
import { requireBrowserData, requireBrowserUtility } from '../src/browser/BrowserManagementInput.js'
import {
  browserDownloadFileName,
  reserveBrowserDownloadPath,
} from '../src/browser/BrowserDownloadPath.js'

const roots: string[] = []
test('全站授权仍阻止明确拒绝的主站、导航与 frame，单次 origin 只允许指定导航', async () => {
  const navigations: string[] = []
  const contents = {
    getURL: () => 'https://blocked.test/',
    loadURL: async (url: string) => {
      navigations.push(url)
    },
    debugger: { isAttached: () => true, sendCommand: async () => ({}) },
  } as unknown as Parameters<typeof runBrowserOperation>[0]
  const command: BrowserCommand = {
    requestId: 'request',
    tabId: 'tab',
    generation: 'generation',
    allowedOrigins: ['https://allowed.test'],
    deniedOrigins: ['https://blocked.test'],
    allowAllSites: true,
    operation: { action: 'snapshot' },
  }
  const invoke = (next: BrowserCommand) =>
    runBrowserOperation(contents, next, () => 'document', new AbortController().signal)
  await expect(invoke(command)).rejects.toThrow('需要授权')
  await expect(
    invoke({ ...command, operation: { action: 'navigate', url: 'https://blocked.test/' } }),
  ).rejects.toThrow('需要授权')
  await invoke({
    ...command,
    allowAllSites: false,
    operation: { action: 'navigate', url: 'https://allowed.test/' },
  })
  expect(navigations).toEqual(['https://allowed.test/'])
  await expect(
    invoke({
      ...command,
      allowAllSites: false,
      operation: { action: 'navigate', url: 'https://other.test/' },
    }),
  ).rejects.toThrow('需要授权')
  Object.assign(contents, {
    getURL: () => 'https://allowed.test/',
    debugger: {
      isAttached: () => true,
      sendCommand: async (method: string) => {
        if (method === 'Page.getFrameTree')
          return {
            frameTree: {
              frame: { id: 'main', url: 'https://allowed.test/' },
              childFrames: [{ frame: { id: 'child', url: 'https://blocked.test/' } }],
            },
          }
        if (method === 'Target.getTargets') return { targetInfos: [] }
        return {}
      },
    },
  })
  await expect(
    invoke({ ...command, operation: { action: 'snapshot', target: { frameId: 'child' } } }),
  ).rejects.toThrow('需要授权')
})

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  delete (globalThis as any).__browserManagementFixture
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'cpx-browser-management-'))
  roots.push(root)
  return root
}

test('download names stay safe and concurrent reservations never replace existing files', async () => {
  const root = await directory()
  await writeFile(join(root, 'file.txt'), 'keep')
  const paths = await Promise.all(
    Array.from({ length: 8 }, async () => reserveBrowserDownloadPath(root, '../file.txt')),
  )
  expect(new Set(paths).size).toBe(8)
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('keep')
  expect(paths[0]).toBe(join(root, 'file (1).txt'))
  expect(browserDownloadFileName('CON')).toBe('download')
  expect(browserDownloadFileName('file:bad?.txt')).toBe('file_bad_.txt')
})
test('management inputs reject arbitrary paths, stale-shaped IDs and out-of-range viewports', () => {
  expect(() =>
    requireBrowserData({
      action: 'downloadAction',
      id: 'download:1',
      command: 'open',
      path: 'private.txt',
    }),
  ).toThrow()
  expect(() => requireBrowserData({ action: 'clear', categories: ['cache', 'cache'] })).toThrow()
  expect(requireBrowserData({ action: 'clear', categories: ['cache'] })).toEqual({
    action: 'clear',
    categories: ['cache'],
  })
  const request = {
    tabId: 'tab:1',
    generation: 'generation:1',
    operation: { action: 'device', device: { mode: 'mobile', width: 390, height: 844 } },
  }
  expect(requireBrowserUtility(request)).toEqual(request)
  expect(() =>
    requireBrowserUtility({
      ...request,
      operation: { action: 'device', device: { mode: 'custom', width: 5000, height: 844 } },
    }),
  ).toThrow()
})

// Bundle isolated Electron/RPC adapters so mocks cannot leak into other Bun tests.
async function nativeModule(file: string, fixture: any) {
  ;(globalThis as any).__browserManagementFixture = fixture
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, `../src/browser/${file}.ts`)],
    target: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'browser-native-fixture',
        setup(build) {
          build.onResolve({ filter: /^electron$/ }, () => ({
            path: 'electron',
            namespace: 'fixture',
          }))
          build.onResolve({ filter: /^@pidex\/shared\/guards$/ }, () => ({
            path: resolve(import.meta.dir, '../../../../packages/shared/src/Guards.ts'),
            external: true,
          }))
          build.onResolve({ filter: /BrowserHostRpcClient\.js$/ }, () => ({
            path: 'rpc',
            namespace: 'fixture',
          }))
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'js',
            contents:
              args.path === 'electron'
                ? 'const f=globalThis.__browserManagementFixture; export const app=f.app, shell=f.shell, session=f.session, webContents=f.webContents, dialog=f.dialog, clipboard=f.clipboard;'
                : 'export class BrowserHostRpcClient { constructor(){const f=globalThis.__browserManagementFixture;this.capabilities=new Set(["browser.data.v1"]);this.call=f.call;} invalidate(){} }',
          }))
        },
      },
    ],
  })
  expect(result.success).toBe(true)
  return import(
    `data:text/javascript;base64,${Buffer.from(await result.outputs[0]!.text()).toString('base64')}`
  )
}
test('composer screenshot captures once and copies the same image without changing focus', async () => {
  const copied: unknown[] = []
  const png = Buffer.from('screenshot-fixture')
  const image = { toPNG: () => png, isEmpty: () => false }
  let captures = 0
  const { runBrowserUtility } = await nativeModule('BrowserUtilities', {
    clipboard: { writeImage: (value: unknown) => copied.push(value) },
  })
  const contents = {
    capturePage: async () => {
      captures++
      return image
    },
    focus: () => {
      throw new Error('截图不应更改焦点')
    },
  }
  const result = await runBrowserUtility({}, contents, {
    action: 'screenshot',
    destination: 'composer',
  })
  expect(captures).toBe(1)
  expect(copied).toEqual([image])
  expect(result.image).toEqual({ data: png.toString('base64'), mimeType: 'image/png' })
  expect(result.message).toBe('截图已复制')
})

test('session downloads initialize once; both save modes, live controls and completed removal retain files', async () => {
  const root = await directory()
  const reports: any[] = []
  const fixture = { app: { getPath: () => root }, shell: {} }
  const { BrowserDownloads } = await nativeModule('BrowserDownloads', fixture)
  const rpc = {
    capabilities: new Set(['browser.data.v1']),
    call: async (method: string, input: any) => {
      reports.push([method, input])
      return method === 'browser/preferences/get' ? { downloadSaveMode: 'downloads' } : { ok: true }
    },
  }
  const downloads = new BrowserDownloads(
    rpc,
    () => ({ windowId: 'window:1', instanceId: 'instance:1' }),
    () => ({ tabId: 'tab:1', allowed: () => true }),
    () => {},
  )
  const session = new EventEmitter()
  rpc.capabilities.clear()
  await downloads.attach(session)
  expect(reports).toEqual([])
  expect(session.listenerCount('will-download')).toBe(0)
  rpc.capabilities.add('browser.data.v1')
  await Promise.all([downloads.attach(session), downloads.attach(session)])
  expect(session.listenerCount('will-download')).toBe(1)
  function item() {
    let path = ''
    let paused = false
    let options: unknown
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => 'file.txt',
      getURL: () => 'https://example.test/file',
      getTotalBytes: () => 100,
      getReceivedBytes: () => 50,
      getSavePath: () => path,
      setSavePath: (value: string) => {
        path = value
      },
      setSaveDialogOptions: (value: unknown) => {
        options = value
      },
      isPaused: () => paused,
      canResume: () => paused,
      pause: () => {
        paused = true
      },
      resume: () => {
        paused = false
      },
      cancel: () => item.emit('done', {}, 'cancelled'),
    })
    return { item, path: () => path, options: () => options }
  }
  try {
    const automatic = item()
    session.emit('will-download', {}, automatic.item, { id: 1 })
    await Bun.sleep(1)
    const id = reports.find(([method]) => method === 'browser/host/download')[1].download.id
    expect(automatic.path()).toBe(join(root, 'file.txt'))
    await downloads.action(id, 'pause')
    expect(automatic.item.isPaused()).toBe(true)
    await downloads.action(id, 'resume')
    expect(automatic.item.isPaused()).toBe(false)
    await expect(downloads.action(id, 'remove')).rejects.toThrow('请先取消')
    await writeFile(automatic.path(), 'downloaded')
    automatic.item.emit('done', {}, 'completed')
    await Bun.sleep(1)
    await downloads.action(id, 'remove')
    expect(await readFile(automatic.path(), 'utf8')).toBe('downloaded')
    await expect(downloads.action(id, 'pause')).rejects.toThrow('当前桌面实例')
    downloads.setSaveMode('ask')
    const asking = item()
    session.emit('will-download', {}, asking.item, { id: 1 })
    expect(asking.path()).toBe('')
    expect(asking.options()).toEqual({ defaultPath: join(root, 'file.txt') })
    asking.item.emit('done', {}, 'cancelled')
    await Bun.sleep(1)
  } finally {
    downloads.dispose()
  }
  expect(session.listenerCount('will-download')).toBe(0)
})

test('controller enforces window/generation, shares device state, and isolates clearing categories', async () => {
  const root = await directory()
  const calls: any[] = []
  const native: any[] = []
  const tabs = new Map<string, any>()
  const session = Object.assign(new EventEmitter(), {
    setPermissionCheckHandler: () => {},
    setPermissionRequestHandler: () => {},
    clearData: async (input: unknown) => {
      native.push(input)
    },
  })
  let currentURL = 'about:blank'
  let deliverCommand: ((result: unknown) => void) | undefined
  let attached = false
  let zoom = 1
  const guest = Object.assign(new EventEmitter(), {
    id: 10,
    session,
    getUserAgent: () =>
      'Mozilla/5.0 (Windows NT 10.0) Chrome/138.0.0.0 Electron/39.8.10 Safari/537.36',
    setUserAgent: (ua: string) => native.push(ua),
    isDestroyed: () => false,
    setWindowOpenHandler: () => {},
    getURL: () => currentURL,
    getTitle: () => 'Example',
    isLoading: () => false,
    loadURL: async (url: string) => {
      currentURL = url
      guest.emit('did-navigate')
    },
    stop: () => {},
    close: () => {},
    getZoomFactor: () => zoom,
    setZoomFactor: (value: number) => {
      zoom = value
    },
    focus: () => {},
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true
      },
      detach: () => {
        attached = false
      },
      sendCommand: async (method: string, input: unknown) => native.push([method, input]),
    },
    navigationHistory: {
      clear: () => native.push('clearNavigation'),
      getAllEntries: () => [{ url: currentURL, title: 'Example' }],
      getActiveIndex: () => 0,
      canGoBack: () => false,
      canGoForward: () => false,
    },
  })
  const owner = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    webContents: Object.assign(new EventEmitter(), { send: () => {} }),
  })
  const fixture = {
    app: { getPath: () => root },
    shell: {},
    webContents: { fromId: () => guest },
    session: {
      fromPartition: (partition: string) => {
        expect(partition).toBe('persist:pidex-browser')
        return session
      },
    },
    call: async (method: string, input: any) => {
      calls.push([method, input])
      if (method === 'browser/host/register') return { tabs: [] }
      if (method === 'browser/list') return { tabs: [...tabs.values()], permissions: [] }
      if (method === 'browser/host/next')
        return new Promise((resolve) => {
          deliverCommand = resolve
        })
      if (method === 'browser/preferences/get') return { downloadSaveMode: 'downloads' }
      if (method === 'browser/create') {
        if (tabs.has(input.tabId)) return tabs.get(input.tabId)
        const tab = {
          ...input,
          state: 'suspended',
          generation: 'generation:1',
          revision: 1,
          viewport: { width: 1280, height: 720 },
          controlThreadId: 'thread:1',
          busy: true,
        }
        tabs.set(tab.tabId, tab)
        return tab
      }
      if (
        method === 'browser/host/restore' ||
        method === 'browser/control' ||
        method === 'browser/host/report'
      ) {
        if (method === 'browser/host/restore') await Bun.sleep(5)
        const tab = {
          ...tabs.get(input.tabId),
          ...input.patch,
          ...(method === 'browser/host/restore' ? { state: 'parked' } : {}),
          ...(method === 'browser/control' ? { controlThreadId: input.threadId, busy: false } : {}),
        }
        tab.revision++
        tabs.set(tab.tabId, tab)
        return tab
      }
      if (method === 'browser/history/remove')
        for (const tab of tabs.values())
          tabs.set(tab.tabId, { ...tab, historyEpoch: 1, revision: tab.revision + 1 })
      return { ok: true }
    },
  }
  const { DesktopBrowserController } = await nativeModule('BrowserGuestManager', fixture)
  const controller = new DesktopBrowserController({
    publish: () => {},
    logger: {},
    getSupervisor: () => undefined,
  })
  try {
    await Promise.all([
      controller.createOrRestore(owner, 'tab:1', 'https://example.test/'),
      controller.createOrRestore(owner, 'tab:1', 'https://example.test/'),
    ])
    expect(calls.filter(([method]) => method === 'browser/host/restore')).toHaveLength(1)
    owner.webContents.emit('did-attach-webview', {}, guest)
    await controller.attach(owner, 'tab:1', 'generation:1', guest.id)
    const staleTab = { ...tabs.get('tab:1') }
    const annotation = {
      tabId: 'tab:1',
      generation: 'generation:1',
      documentId: 'stale-document',
      operation: { action: 'start', mode: 'element', annotations: [], theme: {} },
    }
    await expect(controller.annotation({ id: 2 }, annotation)).rejects.toThrow('不属于')
    await expect(controller.annotation(owner, annotation)).rejects.toThrow('网页已变化')
    await expect(
      controller.annotation(owner, { ...annotation, generation: 'stale' }),
    ).rejects.toThrow('网页已变化')
    const device = { action: 'device', device: { mode: 'mobile', width: 390, height: 844 } }
    await expect(
      controller.utility(
        { id: 2 },
        { tabId: 'tab:1', generation: 'generation:1', operation: device },
      ),
    ).rejects.toThrow('不属于')
    await expect(
      controller.utility(owner, { tabId: 'tab:1', generation: 'stale', operation: device }),
    ).rejects.toThrow('失效')
    await controller.utility(owner, {
      tabId: 'tab:1',
      generation: 'generation:1',
      operation: device,
    })
    expect(tabs.get('tab:1')).toMatchObject({
      controlThreadId: null,
      device: device.device,
      viewport: { width: 390, height: 844 },
    })
    expect(native).toContainEqual(['Emulation.setTouchEmulationEnabled', { enabled: true }])
    await controller.utility(owner, {
      tabId: 'tab:1',
      generation: 'generation:1',
      operation: { action: 'device', device: { mode: 'desktop', width: 1280, height: 720 } },
    })
    expect(native).toContainEqual(['Emulation.setTouchEmulationEnabled', { enabled: false }])
    await controller.utility(owner, {
      tabId: 'tab:1',
      generation: 'generation:1',
      operation: { action: 'zoom', direction: 'in' },
    })
    expect(zoom).toBe(1.1)
    deliverCommand?.({
      tabs: [staleTab],
      permissions: [],
      command: {
        requestId: 'request:stale',
        tabId: 'tab:1',
        generation: 'generation:1',
        allowedOrigins: ['https://example.test'],
        operation: { action: 'viewport', width: 777, height: 555 },
      },
    })
    await Bun.sleep(10)
    expect(tabs.get('tab:1').device.mode).toBe('desktop')
    expect(native).not.toContainEqual([
      'Emulation.setDeviceMetricsOverride',
      { width: 777, height: 555, deviceScaleFactor: 1, mobile: false },
    ])
    calls.length = 0
    native.length = 0
    await controller.data(owner, { action: 'clear', categories: ['cache'] })
    expect(native).toEqual([{ dataTypes: ['cache'] }])
    expect(calls).toEqual([])
    await controller.data(owner, { action: 'clear', categories: ['history'] })
    expect(calls.some(([method]) => method === 'browser/history/remove')).toBe(true)
    expect(native).toContain('clearNavigation')
    native.length = 0
    const result = await controller.data(owner, { action: 'clear', categories: ['siteData'] })
    expect(native[0].dataTypes).not.toContain('cache')
    expect(result.cleared[0]).toMatchObject({ ok: true, message: '站点数据已清除，请按需刷新网页' })
    await expect(controller.setVisible({ id: 2 }, 'tab:1', true)).rejects.toThrow('不属于')
    await controller.close(owner, 'tab:1')
    for (const visible of [true, false]) {
      await expect(controller.setVisible(owner, 'tab:1', visible)).resolves.toMatchObject({
        tabId: 'tab:1', open: false,
      })
    }
  } finally {
    controller.dispose()
  }
})
