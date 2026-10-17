import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DesktopProviderIconChange } from '@pidex/shared/desktop-provider-icon-ipc'
import {
  PROVIDER_ICON_CACHE_TTL_MS,
  ProviderIconCacheService,
  requireProviderIconURL,
  resolveIconMediaType,
} from '../src/ipc/ProviderIconCacheService'

const ICON_URL = 'https://models.dev/logos/openai.svg'
const OTHER_ICON_URL = 'https://models.dev/logos/anthropic.svg'
const SVG_BODY = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
const UPDATED_SVG_BODY = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1" /></svg>'
// 1×1 透明 PNG，仅用于验证上传图标的真实文件头校验。
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function createCacheRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'cpx-provider-icons-'))
  temporaryDirectories.push(directory)
  return directory
}

function createFetchStub(bodies: readonly string[]): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const stub = (async (input: string | URL | Request) => {
    calls.push(String(input))
    const body = bodies[Math.min(calls.length - 1, bodies.length - 1)] ?? SVG_BODY
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'image/svg+xml' },
    })
  }) as unknown as typeof fetch
  return { fetch: stub, calls }
}

function createFailingFetch(): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const stub = (async (input: string | URL | Request) => {
    calls.push(String(input))
    throw new Error('network down')
  }) as unknown as typeof fetch
  return { fetch: stub, calls }
}

function dataURL(body: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(body).toString('base64')}`
}

/** 等待后台刷新链路的微任务与宏任务全部结束。 */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('供应商图标缓存服务', () => {
  test('网站图标跨重启保留，失败不覆盖，恢复默认不影响目录缓存', async () => {
    const root = await createCacheRoot()
    const changes: DesktopProviderIconChange[] = []
    let fail = false
    const dependencies = {
      rootDirectory: root,
      publish: (change: DesktopProviderIconChange) => changes.push(change),
      fetch: createFetchStub([SVG_BODY]).fetch,
      discoverWebsiteIcon: async () => {
        if (fail) throw new Error('unavailable')
        return dataURL(UPDATED_SVG_BODY)
      },
    }
    const service = new ProviderIconCacheService(dependencies)
    const input = { providerID: 'custom-relay', url: '' }
    await expect(service.resolve(input)).resolves.toEqual({ source: null })
    await service.setWebsiteIcon({ providerID: input.providerID, website: 'https://example.com' })
    const restarted = new ProviderIconCacheService(dependencies)
    await expect(restarted.resolve(input)).resolves.toEqual({ source: dataURL(UPDATED_SVG_BODY) })
    fail = true
    await expect(service.setWebsiteIcon({ providerID: input.providerID, website: 'https://example.com' })).rejects.toThrow()
    await expect(service.resolve(input)).resolves.toEqual({ source: dataURL(UPDATED_SVG_BODY) })
    await service.setWebsiteIcon({ providerID: input.providerID })
    await expect(restarted.resolve(input)).resolves.toEqual({ source: null })
    await expect(service.resolve({ ...input, url: ICON_URL })).resolves.toEqual({ source: dataURL(SVG_BODY) })
    expect(changes.map((change) => change.source)).toEqual([dataURL(UPDATED_SVG_BODY), null])
  })

  test('上传图标跨重启保留，网站图标与恢复默认都会覆盖它', async () => {
    const root = await createCacheRoot()
    const changes: DesktopProviderIconChange[] = []
    const dependencies = {
      rootDirectory: root,
      publish: (change: DesktopProviderIconChange) => changes.push(change),
      discoverWebsiteIcon: async () => dataURL(UPDATED_SVG_BODY),
    }
    const source = `data:image/png;base64,${PNG_1X1_BASE64}`
    const service = new ProviderIconCacheService(dependencies)
    const input = { providerID: 'custom-upload', url: '' }

    await expect(
      service.setUploadedIcon({ providerID: input.providerID, dataURL: source }),
    ).resolves.toEqual({ source })
    await expect(service.resolve(input)).resolves.toEqual({ source })
    const restarted = new ProviderIconCacheService(dependencies)
    await expect(restarted.resolve(input)).resolves.toEqual({ source })

    await service.setWebsiteIcon({ providerID: input.providerID, website: 'https://example.com' })
    await expect(restarted.resolve(input)).resolves.toEqual({ source: dataURL(UPDATED_SVG_BODY) })

    await service.setWebsiteIcon({ providerID: input.providerID })
    await expect(restarted.resolve(input)).resolves.toEqual({ source: null })
    expect(changes).toEqual([
      { url: '', providerID: input.providerID, source },
      { url: '', providerID: input.providerID, source: dataURL(UPDATED_SVG_BODY) },
      { url: '', providerID: input.providerID, source: null },
    ])
  })

  test('上传图标按文件头校验真实类型与大小', async () => {
    const root = await createCacheRoot()
    const service = new ProviderIconCacheService({
      rootDirectory: root,
      publish: () => undefined,
    })
    const providerID = 'custom-upload'
    const png = `data:image/png;base64,${PNG_1X1_BASE64}`
    const oversized = `data:image/png;base64,${Buffer.alloc(600 * 1024, 1).toString('base64')}`

    await expect(service.setUploadedIcon({ providerID, dataURL: png })).resolves.toEqual({
      source: png,
    })
    // 声明类型、真实文件头与大小任一不匹配都拒绝，且保留原图标。
    await expect(
      service.setUploadedIcon({ providerID, dataURL: `data:image/jpeg;base64,${PNG_1X1_BASE64}` }),
    ).rejects.toThrow('格式不受支持')
    await expect(
      service.setUploadedIcon({ providerID, dataURL: 'data:image/png;base64,AAAA' }),
    ).rejects.toThrow('格式不受支持')
    await expect(
      service.setUploadedIcon({
        providerID,
        dataURL: `data:image/svg+xml;base64,${Buffer.from(SVG_BODY).toString('base64')}`,
      }),
    ).rejects.toThrow('格式不受支持')
    await expect(service.setUploadedIcon({ providerID, dataURL: oversized })).rejects.toThrow(
      '内容过大',
    )
    await expect(service.resolve({ providerID, url: '' })).resolves.toEqual({ source: png })
  })

  test('首次加载下载图标并写入独立缓存文件', async () => {
    const root = await createCacheRoot()
    const { fetch, calls } = createFetchStub([SVG_BODY])
    const changes: DesktopProviderIconChange[] = []
    const service = new ProviderIconCacheService({
      rootDirectory: root,
      publish: (change) => changes.push(change),
      fetch,
    })

    const resolution = await service.resolve({ url: ICON_URL })

    expect(calls).toEqual([ICON_URL])
    expect(resolution.source).toBe(dataURL(SVG_BODY))
    // 首次下载由 resolve 返回，不需要额外推送变更。
    expect(changes).toEqual([])
    expect((await readdir(root)).filter((name) => name.endsWith('.json'))).toHaveLength(1)
    service.dispose()
  })

  test('不同图标 URL 各用独立缓存', async () => {
    const root = await createCacheRoot()
    const { fetch, calls } = createFetchStub([SVG_BODY, UPDATED_SVG_BODY])
    const service = new ProviderIconCacheService({
      rootDirectory: root,
      publish: () => undefined,
      fetch,
    })

    expect((await service.resolve({ url: ICON_URL })).source).toBe(dataURL(SVG_BODY))
    expect((await service.resolve({ url: OTHER_ICON_URL })).source).toBe(dataURL(UPDATED_SVG_BODY))
    expect(calls).toEqual([ICON_URL, OTHER_ICON_URL])
    expect((await readdir(root)).filter((name) => name.endsWith('.json'))).toHaveLength(2)
    service.dispose()
  })

  test('重启后复用磁盘缓存，且 5 小时内不再请求', async () => {
    const root = await createCacheRoot()
    const first = createFetchStub([SVG_BODY])
    const firstService = new ProviderIconCacheService({
      rootDirectory: root,
      publish: () => undefined,
      fetch: first.fetch,
    })
    const initial = (await firstService.resolve({ url: ICON_URL })).source
    firstService.dispose()

    let now = 1_700_000_000_000
    const second = createFetchStub([UPDATED_SVG_BODY])
    const restarted = new ProviderIconCacheService({
      rootDirectory: root,
      publish: () => undefined,
      fetch: second.fetch,
      now: () => now,
    })

    expect((await restarted.resolve({ url: ICON_URL })).source).toBe(initial)
    now += PROVIDER_ICON_CACHE_TTL_MS - 1
    expect((await restarted.resolve({ url: ICON_URL })).source).toBe(initial)
    await settle()

    expect(second.calls).toEqual([])
    expect(first.calls).toHaveLength(1)
    restarted.dispose()
  })

  test('到期先显示旧内容，后台刷新成功后替换缓存与当前显示', async () => {
    const root = await createCacheRoot()
    let now = 1_700_000_000_000
    const initialFetch = createFetchStub([SVG_BODY])
    const seeded = new ProviderIconCacheService({
      rootDirectory: root,
      publish: () => undefined,
      fetch: initialFetch.fetch,
      now: () => now,
    })
    const initial = (await seeded.resolve({ url: ICON_URL })).source
    seeded.dispose()

    const changes: DesktopProviderIconChange[] = []
    const refreshing = createFetchStub([UPDATED_SVG_BODY])
    const service = new ProviderIconCacheService({
      rootDirectory: root,
      publish: (change) => changes.push(change),
      fetch: refreshing.fetch,
      now: () => now,
    })

    now += PROVIDER_ICON_CACHE_TTL_MS
    expect((await service.resolve({ url: ICON_URL })).source).toBe(initial)
    await settle()

    expect(refreshing.calls).toEqual([ICON_URL])
    expect(changes).toEqual([{ url: ICON_URL, source: dataURL(UPDATED_SVG_BODY) }])
    // 刷新成功后内存与磁盘都换成新内容。
    expect((await service.resolve({ url: ICON_URL })).source).toBe(dataURL(UPDATED_SVG_BODY))
    service.dispose()

    const reused = new ProviderIconCacheService({
      rootDirectory: root,
      publish: () => undefined,
      fetch: createFailingFetch().fetch,
      now: () => now,
    })
    expect((await reused.resolve({ url: ICON_URL })).source).toBe(dataURL(UPDATED_SVG_BODY))
    reused.dispose()
  })

  test('刷新失败保留旧图标且不发送变更，冷却期内不再重试', async () => {
    const root = await createCacheRoot()
    let now = 1_700_000_000_000
    const initialFetch = createFetchStub([SVG_BODY])
    const seeded = new ProviderIconCacheService({
      rootDirectory: root,
      publish: () => undefined,
      fetch: initialFetch.fetch,
      now: () => now,
    })
    const initial = (await seeded.resolve({ url: ICON_URL })).source
    seeded.dispose()

    const changes: DesktopProviderIconChange[] = []
    const failing = createFailingFetch()
    const service = new ProviderIconCacheService({
      rootDirectory: root,
      publish: (change) => changes.push(change),
      fetch: failing.fetch,
      now: () => now,
    })

    now += PROVIDER_ICON_CACHE_TTL_MS
    expect((await service.resolve({ url: ICON_URL })).source).toBe(initial)
    await settle()
    expect(failing.calls).toHaveLength(1)

    now += PROVIDER_ICON_CACHE_TTL_MS - 1
    expect((await service.resolve({ url: ICON_URL })).source).toBe(initial)
    await settle()
    expect(failing.calls).toHaveLength(1)
    expect(changes).toEqual([])
    service.dispose()
  })

  test('首次下载失败返回空地址，并在冷却期内不重复请求', async () => {
    const root = await createCacheRoot()
    const failing = createFailingFetch()
    const service = new ProviderIconCacheService({
      rootDirectory: root,
      publish: () => undefined,
      fetch: failing.fetch,
    })

    expect((await service.resolve({ url: ICON_URL })).source).toBeNull()
    expect((await service.resolve({ url: ICON_URL })).source).toBeNull()
    expect(failing.calls).toHaveLength(1)
    service.dispose()
  })

  test('同一地址的并发加载共用一个下载请求', async () => {
    const root = await createCacheRoot()
    const calls: string[] = []
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchStub = (async (input: string | URL | Request) => {
      calls.push(String(input))
      await gate
      return new Response(SVG_BODY, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
    }) as unknown as typeof fetch
    const service = new ProviderIconCacheService({
      rootDirectory: root,
      publish: () => undefined,
      fetch: fetchStub,
    })

    const pending = Promise.all([
      service.resolve({ url: ICON_URL }),
      service.resolve({ url: ICON_URL }),
      service.resolve({ url: ICON_URL }),
    ])
    release?.()
    const resolutions = await pending

    expect(calls).toEqual([ICON_URL])
    expect(resolutions.map((resolution) => resolution.source)).toEqual([
      dataURL(SVG_BODY),
      dataURL(SVG_BODY),
      dataURL(SVG_BODY),
    ])
    service.dispose()
  })
})

describe('供应商图标地址与类型校验', () => {
  test('只接受 models.dev 的 https 地址并原样保留缓存键', () => {
    expect(requireProviderIconURL({ url: ICON_URL })).toBe(ICON_URL)
    expect(() => requireProviderIconURL({ url: 'https://evil.example/logo.svg' })).toThrow(
      '供应商图标地址无效',
    )
    expect(() => requireProviderIconURL({ url: 'http://models.dev/logos/openai.svg' })).toThrow(
      '供应商图标地址无效',
    )
    expect(() => requireProviderIconURL({ url: 'not-a-url' })).toThrow('供应商图标地址无效')
    expect(() => requireProviderIconURL({})).toThrow('供应商图标地址无效')
  })

  test('声明类型优先，缺失时按扩展名推断，两者都不支持则拒绝', () => {
    expect(resolveIconMediaType('image/png; charset=binary', ICON_URL)).toBe('image/png')
    expect(resolveIconMediaType('text/html', ICON_URL)).toBe('image/svg+xml')
    expect(resolveIconMediaType(null, 'https://models.dev/logos/openai.png')).toBe('image/png')
    expect(() => resolveIconMediaType(null, 'https://models.dev/logos/openai.bin')).toThrow(
      '供应商图标类型不受支持',
    )
  })
})
