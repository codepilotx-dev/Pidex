import { describe, expect, test } from 'bun:test'
import type { RpcResult } from '@pidex/agent-protocol'
import {
  createDesktopClient,
  type DesktopReleaseNotesApi,
} from '../src/services/desktop-client/index.js'
import {
  loadReleaseNotes,
  releaseNotesViewError,
} from '../src/features/whats-new/ReleaseNotesModel.js'

describe('whats new release notes', () => {
  test('provides fixed GitHub release fixtures in browser mock mode', async () => {
    const result = await createDesktopClient({}).listReleaseNotes()

    expect(result.repository).toBe('codepilotx-dev/Pidex')
    expect(result.currentReleaseFound).toBe(true)
    expect(result.releases[0]?.tagName).toBe(`v${result.currentVersion}`)
  })

  test('uses the typed release notes RPC method and capability', async () => {
    const requests: Array<{ method: string; params: unknown }> = []
    const result = releaseNotesResult()
    const client = createDesktopClient({
      fetch: async (path, init) => {
        if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
        const body = JSON.parse(String(init?.body))
        requests.push({ method: body.method, params: body.params })
        if (body.method === 'initialize') {
          return rpc(body.id, initializedResult())
        }
        if (body.method === 'initialized') {
          return new Response(null, { status: 204 })
        }
        if (body.method === 'release-notes/list') {
          return rpc(body.id, result)
        }
        throw new Error(`Unhandled RPC method: ${body.method}`)
      },
    })

    expect(await client.listReleaseNotes({ refresh: true })).toEqual(result)
    expect(requests.find((request) => request.method === 'release-notes/list')?.params).toEqual({
      currentVersion: '0.0.0-dev',
      refresh: true,
    })
  })

  test('retries a failed request with cache refresh enabled', async () => {
    const calls: Array<{ refresh?: boolean } | undefined> = []
    const result = releaseNotesResult()
    const client: DesktopReleaseNotesApi = {
      listReleaseNotes: async (options) => {
        calls.push(options)
        if (calls.length === 1) {
          throw {
            data: { code: 'RELEASE_NOTES_NOT_PUBLIC' },
          }
        }
        return result
      },
    }

    const initialError = await loadReleaseNotes(client).catch((error) => error)
    const retried = await loadReleaseNotes(client, true)

    expect(releaseNotesViewError(initialError)).toBe('not-public')
    expect(retried).toEqual(result)
    expect(calls).toEqual([undefined, { refresh: true }])
  })
})

function releaseNotesResult(): RpcResult<'release-notes/list'> {
  return {
    source: 'github-releases',
    repository: 'codepilotx-dev/Pidex',
    currentVersion: '0.2.0-beta.1',
    currentReleaseFound: true,
    fetchedAt: '2026-07-27T00:00:00.000Z',
    truncated: false,
    releases: [
      {
        tagName: 'v0.2.0-beta.1',
        name: 'Pidex 0.2.0-beta.1',
        body: '测试更新记录',
        htmlUrl: 'https://github.com/codepilotx-dev/Pidex/releases/tag/v0.2.0-beta.1',
        publishedAt: '2026-07-27T00:00:00.000Z',
        prerelease: true,
      },
    ],
  }
}

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}

function initializedResult() {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: ['rpc.typed.v1', 'release-notes.read.v1'],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}
