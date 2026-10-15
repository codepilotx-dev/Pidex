import { expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

test('可视化客户端协商结果资源与追问能力，原样发送来源和选中参数', async () => {
  const methods: string[] = []
  const selection = { people: 4 }
  const fetcher = async (_path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    methods.push(body.method)
    if (body.method === 'initialized') return new Response(null, { status: 204 })
    let result: unknown
    if (body.method === 'initialize') {
      result = {
        protocol: 'thread-rpc-v4',
        serverInfo: { name: 'test', version: '1' },
        capabilities: body.params.capabilities.filter((name: string) =>
          ['rpc.typed.v1', 'artifacts.read.v1', 'visualizations.v1'].includes(name),
        ),
        limits: {
          maxFrameBytes: 1024,
          maxSubscriptions: 4,
          maxStreamsPerSubscription: 4,
          maxPendingRequests: 8,
        },
        connectionId: 'visualization-test',
      }
    } else if (body.method === 'artifact/read') {
      expect(body.params).toEqual({ threadId: 'thread-1', artifactId: 'library-1' })
      result = {
        artifact: {
          id: 'library-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'ui-1',
          name: 'd3.js',
          mimeType: 'text/javascript',
          sizeBytes: 3,
          createdAt: 1,
        },
        data: 'YWJj',
        encoding: 'base64',
        sizeBytes: 3,
      }
    } else if (body.method === 'visualization/submitFollowUp') {
      expect(body.params).toEqual({
        threadId: 'thread-1',
        itemId: 'ui-1',
        inputId: 'follow-1',
        text: '继续分析',
        selection,
      })
      result = {
        inputId: 'follow-1',
        turnId: 'turn-2',
        disposition: 'accepted',
        streamPosition: { streamId: 'thread-1', sequence: 1 },
      }
    } else throw new Error(`Unexpected method ${body.method}`)
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  }
  const client = createDesktopClient({ fetch: fetcher })
  expect((await client.readArtifact('thread-1', 'library-1')).data).toBe('YWJj')
  expect(
    (
      await client.submitVisualizationFollowUp({
        threadId: 'thread-1',
        itemId: 'ui-1',
        inputId: 'follow-1',
        text: '继续分析',
        selection,
      })
    ).turnId,
  ).toBe('turn-2')
  expect(methods).toEqual([
    'initialize',
    'initialized',
    'artifact/read',
    'visualization/submitFollowUp',
  ])
})
