import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { PetCatalogService, classifyPetLicense } from '../src/pet/PetCatalogService'

const temporaryDirectories: string[] = []
const catalogUrl = 'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets.json'
const categoriesUrl =
  'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/categories.json'

afterEach(async () => {
  await removeFixturePaths(temporaryDirectories.splice(0))
})

describe('PetCatalogService', () => {
  test('normalizes the community catalog and marks installed pets', async () => {
    const root = await temporaryRoot()
    const service = new PetCatalogService(root, {
      fetch: mockFetch(catalogResponses()),
      now: () => Date.parse('2026-07-24T00:00:00.000Z'),
    })

    const result = await service.list(new Set(['firefly--lingxiaotian']), true)

    expect(result).toEqual({
      pets: [
        {
          slug: 'firefly--lingxiaotian',
          displayName: '流萤',
          englishName: 'Firefly',
          description: 'A Firefly fan-art pet.',
          author: 'Lingxiaotian',
          category: 'game-characters',
          categoryLabel: '游戏角色',
          spriteVersionNumber: 1,
          license: 'CC BY-NC 4.0',
          licenseKind: 'restricted',
          previewUrl: '/api/pets/catalog/firefly--lingxiaotian/preview',
          installed: true,
        },
      ],
      fetchedAt: '2026-07-24T00:00:00.000Z',
      cacheState: 'fresh',
    })
  })

  test('serves stale cache when refresh fails and ignores a broken cache', async () => {
    const root = await temporaryRoot()
    const seeded = new PetCatalogService(root, {
      fetch: mockFetch(catalogResponses()),
      now: () => Date.parse('2026-07-24T00:00:00.000Z'),
    })
    await seeded.list(new Set(), true)

    const offline = new PetCatalogService(root, {
      fetch: rejectingFetch(),
      now: () => Date.parse('2026-07-25T00:00:00.000Z'),
    })
    const stale = await offline.list(new Set())
    expect(stale.cacheState).toBe('stale')
    expect(stale.pets).toHaveLength(1)

    const brokenRoot = await temporaryRoot()
    await writeFile(join(brokenRoot, '.catalog-cache.json'), '{not-json', 'utf8')
    const unavailable = await new PetCatalogService(brokenRoot, {
      fetch: rejectingFetch(),
    }).list(new Set(), true)
    expect(unavailable).toEqual({
      pets: [],
      fetchedAt: null,
      cacheState: 'unavailable',
    })
  })

  test('catalog cache expires after five hours while allowing manual refresh before expiry', async () => {
    const root = await temporaryRoot()
    let now = Date.parse('2026-10-16T00:00:00Z')
    let catalogRequests = 0
    const fetch = mockFetch(catalogResponses())
    const service = new PetCatalogService(root, {
      now: () => now,
      fetch: (async (input, init) => {
        if (input.toString() === catalogUrl) catalogRequests++
        return fetch(input, init)
      }) as typeof globalThis.fetch,
    })
    await service.list(new Set())
    now += 4 * 60 * 60 * 1_000
    expect((await service.list(new Set())).cacheState).toBe('fresh')
    expect(catalogRequests).toBe(1)
    await service.list(new Set(), true)
    expect(catalogRequests).toBe(2)
    now += 5 * 60 * 60 * 1_000 - 1
    expect((await service.list(new Set())).cacheState).toBe('fresh')
    now++
    expect((await service.list(new Set())).cacheState).toBe('stale')
    await service.list(new Set(), true)
    expect(catalogRequests).toBe(3)
  })

  test('atomically replaces an existing cache during explicit refresh', async () => {
    const root = await temporaryRoot()
    let displayName = '流萤'
    const fetch = (async (input: URL | RequestInfo) => {
      const responses = catalogResponses()
      if (input.toString() === catalogUrl) {
        const pets = JSON.parse(await responses[catalogUrl]!.text())
        pets[0].localized_names.zh = displayName
        return new Response(JSON.stringify(pets))
      }
      const response = responses[input.toString()]
      if (!response) throw new Error(`Unexpected URL: ${input}`)
      return response.clone()
    }) as unknown as typeof globalThis.fetch
    const service = new PetCatalogService(root, { fetch })

    expect((await service.list(new Set(), true)).pets[0]?.displayName).toBe('流萤')
    displayName = '流萤（更新）'
    expect((await service.list(new Set(), true)).pets[0]?.displayName).toBe('流萤（更新）')
  })

  test('requires confirmation for restricted licenses and derives the manifest URL', async () => {
    const root = await temporaryRoot()
    const service = new PetCatalogService(root, {
      fetch: mockFetch(catalogResponses()),
    })
    await service.list(new Set(), true)
    const installer = async (url: string) => ({
      id: 'firefly--lingxiaotian',
      displayName: '流萤',
      spriteVersionNumber: 1 as const,
      spritesheetPath: 'spritesheet.webp',
      spritesheetUrl: '/api/pets/firefly--lingxiaotian/spritesheet',
      installed: true,
      source: url,
    })

    await expect(service.install('firefly--lingxiaotian', false, installer)).rejects.toThrow(
      '需要确认',
    )
    const installed = await service.install('firefly--lingxiaotian', true, installer)
    expect(installed).toMatchObject({
      id: 'firefly--lingxiaotian',
      source:
        'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/firefly--lingxiaotian/pet.json',
    })
  })

  test('proxies only a bounded WebP preview for a catalog slug', async () => {
    const root = await temporaryRoot()
    const webp = new TextEncoder().encode('RIFF0000WEBPVP8 preview')
    const service = new PetCatalogService(root, {
      fetch: mockFetch({
        ...catalogResponses(),
        'https://codexpet.top/assets/previews/firefly--lingxiaotian/webp/idle.webp': new Response(
          webp,
          {
            headers: {
              'Content-Type': 'image/webp',
              'Content-Length': String(webp.byteLength),
            },
          },
        ),
      }),
    })
    await service.list(new Set(), true)

    const preview = await service.previewAsset('firefly--lingxiaotian')
    expect(preview.contentType).toBe('image/webp')
    expect(preview.bytes).toEqual(webp)
    await expect(service.previewAsset('not-in-catalog')).rejects.toThrow('社区宠物不存在')
  })

  test('rejects preview responses with an invalid WebP signature or content type', async () => {
    for (const [contentType, body, message] of [
      ['image/webp', 'GIF89a-preview', '文件签名无效'],
      ['text/html', '<html>not an image</html>', '只支持 WebP'],
    ] as const) {
      const service = new PetCatalogService(await temporaryRoot(), {
        fetch: mockFetch({
          ...catalogResponses(),
          'https://codexpet.top/assets/previews/firefly--lingxiaotian/webp/idle.webp': new Response(
            body,
            {
              headers: { 'Content-Type': contentType },
            },
          ),
        }),
      })
      await expect(service.previewAsset('firefly--lingxiaotian')).rejects.toThrow(message)
    }
  })

  test('shares concurrent preview downloads and serves disk cache after restart offline', async () => {
    const root = await temporaryRoot()
    const webp = new TextEncoder().encode('RIFF0000WEBPVP8 preview')
    const previewUrl = 'https://codexpet.top/assets/previews/firefly--lingxiaotian/webp/idle.webp'
    let previewRequests = 0
    const fetch = mockFetch({
      ...catalogResponses(),
      [previewUrl]: new Response(webp, { headers: { 'Content-Type': 'image/webp' } }),
    })
    const service = new PetCatalogService(root, {
      fetch: (async (input, init) => {
        if (input.toString() === previewUrl) previewRequests++
        return fetch(input, init)
      }) as typeof globalThis.fetch,
    })
    await service.list(new Set(), true)
    const [first, second] = await Promise.all([
      service.previewAsset('firefly--lingxiaotian'),
      service.previewAsset('firefly--lingxiaotian'),
    ])
    expect(previewRequests).toBe(1)
    expect(first.bytes).toEqual(second.bytes)
    const cachedPath = join(root, '.preview-cache', 'firefly--lingxiaotian.webp')
    expect(await readFile(cachedPath)).toEqual(Buffer.from(webp))

    let offlineRequests = 0
    const offline = new PetCatalogService(root, {
      fetch: (() => {
        offlineRequests++
        return Promise.reject(new Error('offline'))
      }) as unknown as typeof globalThis.fetch,
    })
    expect((await offline.previewAsset('firefly--lingxiaotian')).bytes).toEqual(webp)
    expect(offlineRequests).toBe(0)

    const expiredAt = new Date(Date.now() - 6 * 60 * 60 * 1_000)
    await utimes(cachedPath, expiredAt, expiredAt)
    expect((await offline.previewAsset('firefly--lingxiaotian')).bytes).toEqual(webp)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(offlineRequests).toBe(1)
    expect((await offline.previewAsset('firefly--lingxiaotian')).bytes).toEqual(webp)
    expect(offlineRequests).toBe(1)
    expect(await readFile(cachedPath)).toEqual(Buffer.from(webp))
  })

  test('serves expired previews immediately while refreshing their disk cache', async () => {
    const root = await temporaryRoot()
    const previewUrl = 'https://codexpet.top/assets/previews/firefly--lingxiaotian/webp/idle.webp'
    const oldImage = new TextEncoder().encode('RIFF0000WEBPVP8 old')
    const newImage = new TextEncoder().encode('RIFF0000WEBPVP8 new')
    let releaseDownload!: (response: Response) => void
    const download = new Promise<Response>((resolve) => {
      releaseDownload = resolve
    })
    const fetch = mockFetch({
      ...catalogResponses(),
      [previewUrl]: new Response(oldImage, { headers: { 'Content-Type': 'image/webp' } }),
    })
    const seeded = new PetCatalogService(root, { fetch })
    await seeded.previewAsset('firefly--lingxiaotian')
    const cachedPath = join(root, '.preview-cache', 'firefly--lingxiaotian.webp')
    const expiredAt = new Date(Date.now() - 6 * 60 * 60 * 1_000)
    await utimes(cachedPath, expiredAt, expiredAt)
    const refreshing = new PetCatalogService(root, {
      fetch: (async () => download) as unknown as typeof globalThis.fetch,
    })
    expect((await refreshing.previewAsset('firefly--lingxiaotian')).bytes).toEqual(oldImage)
    releaseDownload(new Response(newImage, { headers: { 'Content-Type': 'image/webp' } }))
    // 等待后台原子写入完成，不要求调用者等待更新。
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await readFile(cachedPath)).equals(Buffer.from(newImage))) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect((await refreshing.previewAsset('firefly--lingxiaotian')).bytes).toEqual(newImage)
  })

  test('classifies supported, attributed, restricted and unknown licenses', () => {
    expect(classifyPetLicense('MIT')).toBe('permissive')
    expect(classifyPetLicense('CC BY 4.0')).toBe('attribution')
    expect(classifyPetLicense('CC BY-NC 4.0')).toBe('restricted')
    expect(classifyPetLicense('Unknown license')).toBe('unknown')
  })
})

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-pet-catalog-'))
  temporaryDirectories.push(directory)
  return directory
}

function catalogResponses(): Record<string, Response> {
  return {
    [catalogUrl]: new Response(
      JSON.stringify([
        {
          slug: 'firefly--lingxiaotian',
          name: 'Firefly',
          localized_names: { en: 'Firefly', zh: '流萤' },
          author: 'Lingxiaotian',
          primary_category: 'Game Characters',
          license: 'CC BY-NC 4.0',
          description: 'A Firefly fan-art pet.',
          spriteVersionNumber: 1,
        },
      ]),
    ),
    [categoriesUrl]: new Response(
      JSON.stringify([
        {
          slug: 'game-characters',
          name: 'Game Characters',
          label: { en: 'Game Characters', zh: '游戏角色' },
        },
      ]),
    ),
  }
}

function mockFetch(responses: Record<string, Response>): typeof fetch {
  return (async (input) => {
    const url = input.toString()
    const response = responses[url]
    if (!response) throw new Error(`Unexpected URL: ${url}`)
    return response.clone()
  }) as typeof fetch
}

function rejectingFetch(): typeof fetch {
  return (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
}
