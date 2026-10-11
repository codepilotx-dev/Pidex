import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { PetService } from '../src/pet/PetService'
import { asPetStorageError } from '../src/pet/PetStorageError'

const originalFetch = globalThis.fetch
const temporaryDirectories: string[] = []

afterEach(async () => {
  globalThis.fetch = originalFetch
  await removeFixturePaths(temporaryDirectories.splice(0))
})

describe('PetService', () => {
  test('previews, installs, lists and serves a v2 package', async () => {
    const root = join(await temporaryRoot(), 'missing', 'pets')
    const atlas = fakePng(1536, 2288)
    globalThis.fetch = mockFetch({
      'https://example.com/pets/whale/pet.json': new Response(
        JSON.stringify({
          id: 'little-whale',
          displayName: 'Little Whale',
          description: 'A small task companion',
          spriteVersionNumber: 2,
          spritesheetPath: 'spritesheet.png',
        }),
      ),
      'https://example.com/pets/whale/spritesheet.png': new Response(responseBody(atlas), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(atlas.byteLength),
        },
      }),
    })
    const service = new PetService(root)

    const preview = await service.preview('https://example.com/pets/whale/pet.json')
    expect(preview.pet).toMatchObject({
      id: 'little-whale',
      spriteVersionNumber: 2,
      installed: false,
    })

    const installed = await service.install('https://example.com/pets/whale/pet.json')
    expect(installed.installed).toBe(true)
    expect(await service.list()).toHaveLength(1)
    const asset = await service.spritesheet('little-whale')
    expect(asset.contentType).toBe('image/png')
    expect(asset.bytes.byteLength).toBe(atlas.byteLength)

    await service.remove('little-whale')
    expect(await service.list()).toEqual([])
  })

  test('maps filesystem failures to safe actionable storage errors', () => {
    const permission = asPetStorageError(
      Object.assign(new Error('sensitive path'), { code: 'EACCES' }),
    )
    expect(permission.code).toBe('PET_STORAGE_FAILED')
    expect(permission.message).toBe('宠物数据目录不可写，请检查目录权限')
    expect(permission.message).not.toContain('sensitive path')

    const capacity = asPetStorageError(Object.assign(new Error('disk'), { code: 'ENOSPC' }))
    expect(capacity.code).toBe('PET_STORAGE_FAILED')
    expect(capacity.message).toContain('磁盘空间不足')
  })

  test('rejects redirects and atlas dimensions that do not match the version', async () => {
    const root = await temporaryRoot()
    globalThis.fetch = mockFetch({
      'https://example.com/redirect.json': new Response(null, {
        status: 302,
        headers: { Location: 'https://example.com/pet.json' },
      }),
    })
    const service = new PetService(root)
    await expect(service.preview('https://example.com/redirect.json')).rejects.toThrow(
      '不允许重定向',
    )

    const atlas = fakePng(1536, 1872)
    globalThis.fetch = mockFetch({
      'https://example.com/pet.json': new Response(
        JSON.stringify({
          id: 'wrong-size',
          displayName: 'Wrong Size',
          spriteVersionNumber: 2,
          spritesheetPath: 'spritesheet.png',
        }),
      ),
      'https://example.com/spritesheet.png': new Response(responseBody(atlas), {
        headers: { 'Content-Type': 'image/png' },
      }),
    })
    await expect(service.preview('https://example.com/pet.json')).rejects.toThrow('1536x2288')
  })

  test('installs a catalog pet through the existing package validation path', async () => {
    const root = await temporaryRoot()
    const atlas = fakePng(1536, 1872)
    globalThis.fetch = mockFetch({
      'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets.json': new Response(
        JSON.stringify([
          {
            slug: 'sample-community-pet',
            name: 'Sample Community Pet',
            author: 'Pidex',
            primary_category: 'Original Characters',
            license: 'MIT',
            spriteVersionNumber: 1,
          },
        ]),
      ),
      'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/categories.json':
        new Response(
          JSON.stringify([
            {
              slug: 'original-characters',
              name: 'Original Characters',
              label: { zh: '原创角色' },
            },
          ]),
        ),
      'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/sample-community-pet/pet.json':
        new Response(
          JSON.stringify({
            id: 'sample-community-pet',
            displayName: 'Sample Community Pet',
            spriteVersionNumber: 1,
            spritesheetPath: 'spritesheet.png',
          }),
        ),
      'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/sample-community-pet/spritesheet.png':
        new Response(responseBody(atlas), {
          headers: { 'Content-Type': 'image/png' },
        }),
    })
    const service = new PetService(root)

    const installed = await service.installCatalog('sample-community-pet', false)

    expect(installed).toMatchObject({
      id: 'sample-community-pet',
      installed: true,
    })
    expect(await service.list()).toHaveLength(1)

    globalThis.fetch = mockFetch({
      'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/sample-community-pet/pet.json':
        new Response(
          JSON.stringify({
            id: 'different-pet',
            displayName: 'Different Pet',
            spriteVersionNumber: 1,
            spritesheetPath: 'spritesheet.png',
          }),
        ),
      'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/sample-community-pet/spritesheet.png':
        new Response(responseBody(atlas), {
          headers: { 'Content-Type': 'image/png' },
        }),
    })
    await expect(service.installCatalog('sample-community-pet', false)).rejects.toThrow(
      '目录 slug 不一致',
    )
    expect(await service.list()).toHaveLength(1)
  })
})

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-pets-'))
  temporaryDirectories.push(directory)
  return directory
}

function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function mockFetch(responses: Record<string, Response>): typeof fetch {
  return (async (input) => {
    const url = typeof input === 'string' ? input : input.toString()
    const response = responses[url]
    if (!response) throw new Error(`Unexpected URL: ${url}`)
    return response.clone()
  }) as typeof fetch
}
