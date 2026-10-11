import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
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

  test('proxies only a bounded GIF preview for a catalog slug', async () => {
    const root = await temporaryRoot()
    const gif = new TextEncoder().encode('GIF89a-preview')
    const service = new PetCatalogService(root, {
      fetch: mockFetch({
        ...catalogResponses(),
        'https://codexpet.top/assets/previews/firefly--lingxiaotian/gifs/idle.gif': new Response(
          gif,
          {
            headers: {
              'Content-Type': 'image/gif',
              'Content-Length': String(gif.byteLength),
            },
          },
        ),
      }),
    })
    await service.list(new Set(), true)

    const preview = await service.previewAsset('firefly--lingxiaotian')
    expect(preview.contentType).toBe('image/gif')
    expect(new TextDecoder().decode(preview.bytes)).toBe('GIF89a-preview')
    await expect(service.previewAsset('not-in-catalog')).rejects.toThrow('社区宠物不存在')
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
