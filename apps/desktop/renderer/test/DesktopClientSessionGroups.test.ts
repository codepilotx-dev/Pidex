import { expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

test('工作组客户端通过握手协商 workflow.v1 后调用工作组 RPC', async () => {
  const methods: string[] = []
  const fetcher = async (_path: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body))
    methods.push(body.method)
    if (body.method === 'initialize') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocol: 'thread-rpc-v4',
          serverInfo: { name: 'test', version: '1' },
          capabilities: body.params.capabilities.filter((capability: string) =>
            ['rpc.typed.v1', 'session-group.v1', 'workflow.v1'].includes(capability),
          ),
          limits: {
            maxFrameBytes: 1024,
            maxSubscriptions: 4,
            maxStreamsPerSubscription: 4,
            maxPendingRequests: 8,
          },
          connectionId: 'workgroup-test',
        },
      })
    }
    if (body.method === 'initialized') return new Response(null, { status: 204 })
    if (body.method === 'thread/list' || body.method === 'project/list') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result:
          body.method === 'thread/list'
            ? { threads: [], nextCursor: null }
            : { projects: [], nextCursor: null },
      })
    }
    if (body.method === 'workflow/list') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { workflows: [], nextCursor: null },
      })
    }
    if (body.method === 'workflow/membership/set') {
      expect(body.params).toEqual({
        threadId: 'thread-1',
        workflowId: 'group-1',
        operationId: expect.any(String),
      })
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { membership: { workflowId: 'group-1', threadId: 'thread-1', joinedAt: 1 } },
      })
    }
    throw new Error(`Unhandled RPC method: ${body.method}`)
  }
  const client = createDesktopClient({ fetch: fetcher })

  expect(await client.listSessionGroups()).toEqual([])
  await client.setSessionGroupMembership({ threadId: 'thread-1', groupId: 'group-1' })
  expect(methods.slice(0, 4)).toEqual([
    'initialize',
    'initialized',
    'workflow/list',
    'workflow/membership/set',
  ])
})
