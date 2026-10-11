import { describe, expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

describe('desktop pet catalog client', () => {
  test('uses typed catalog list and install RPC methods', async () => {
    const requests: Array<{ method: string; params: unknown }> = []
    const catalogPet = {
      slug: 'firefly--lingxiaotian',
      displayName: '流萤',
      englishName: 'Firefly',
      author: 'Lingxiaotian',
      category: 'games',
      categoryLabel: '游戏',
      spriteVersionNumber: 1,
      license: 'MIT',
      licenseKind: 'permissive',
      previewUrl: '/api/pets/catalog/firefly--lingxiaotian/preview',
      installed: false,
    }
    const installedPet = {
      id: catalogPet.slug,
      displayName: catalogPet.displayName,
      spriteVersionNumber: 1,
      spritesheetPath: 'spritesheet.webp',
      spritesheetUrl: `/api/pets/${catalogPet.slug}/spritesheet`,
      installed: true,
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      requests.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult())
      }
      if (body.method === 'initialized') {
        return new Response(null, { status: 204 })
      }
      if (body.method === 'pet/catalog/list') {
        return rpc(body.id, {
          pets: [catalogPet],
          fetchedAt: '2026-07-24T00:00:00.000Z',
          cacheState: 'fresh',
        })
      }
      if (body.method === 'pet/catalog/install') {
        return rpc(body.id, { pet: installedPet })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const client = createDesktopClient({ fetch: fetcher })
    const catalog = await client.listPetCatalog(true)
    const installed = await client.installCatalogPet(catalogPet.slug, false)

    expect(catalog.pets[0]?.slug).toBe(catalogPet.slug)
    expect(installed.id).toBe(catalogPet.slug)
    expect(requests.find((request) => request.method === 'pet/catalog/list')?.params).toEqual({
      refresh: true,
    })
    expect(requests.find((request) => request.method === 'pet/catalog/install')?.params).toEqual({
      slug: catalogPet.slug,
      acceptedRestrictedLicense: false,
      operationId: expect.any(String),
    })
  })
})

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}

function initializedResult() {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: ['rpc.typed.v1', 'pets.management.v1'],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}
