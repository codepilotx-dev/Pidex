import { describe, expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

describe('desktop MiniMax CLI client', () => {
  test('requests the capability and uses typed status, install, and uninstall RPCs', async () => {
    const requests: Array<{ method: string; params: unknown }> = []
    const status = {
      installationStatus: 'installed',
      installedVersion: '1.2.3',
      latestVersion: '1.2.3',
      updateAvailable: false,
      nodeVersion: 'v22.0.0',
      npmVersion: '10.0.0',
      authStatus: 'coding-plan-synced',
      credentialSource: {
        providerId: 'minimax-cn-coding-plan',
        credentialId: 'credential:cn',
        label: 'MiniMax CN Coding Plan',
        maskedValue: 'sk-****plan',
        region: 'cn',
      },
      generation: 2,
      updatedAt: 2,
    }
    const fetcher = async (_path: string, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body))
      requests.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocol: 'thread-rpc-v4',
            serverInfo: { name: 'test', version: '1' },
            capabilities: ['rpc.typed.v1', 'integrations.minimax-cli.v1'],
            limits: {
              maxFrameBytes: 1024,
              maxSubscriptions: 4,
              maxStreamsPerSubscription: 4,
              maxPendingRequests: 8,
            },
            connectionId: 'minimax-cli-test',
          },
        })
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (
        body.method === 'minimaxCli/status' ||
        body.method === 'minimaxCli/install' ||
        body.method === 'minimaxCli/uninstall'
      ) {
        return Response.json({ jsonrpc: '2.0', id: body.id, result: status })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    expect((await client.getMiniMaxCliStatus(true)).installedVersion).toBe('1.2.3')
    await client.installMiniMaxCli()
    await client.uninstallMiniMaxCli()

    expect(requests.find((item) => item.method === 'initialize')?.params).toMatchObject({
      capabilities: expect.arrayContaining(['integrations.minimax-cli.v1']),
    })
    expect(requests.find((item) => item.method === 'minimaxCli/status')?.params).toEqual({
      forceReload: true,
    })
    expect(requests.find((item) => item.method === 'minimaxCli/install')?.params).toEqual({
      operationId: expect.any(String),
    })
    expect(requests.find((item) => item.method === 'minimaxCli/uninstall')?.params).toEqual({
      operationId: expect.any(String),
    })
  })
})
