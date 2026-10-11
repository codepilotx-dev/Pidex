import { describe, expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

describe('desktop plugin client', () => {
  test('uses typed plugin RPC methods and supplies mutation operation ids', async () => {
    const requests: Array<{ method: string; params: unknown }> = []
    const plugin = {
      id: 'task-planning',
      name: '任务规划',
      version: '1.0.0',
      description: '拆解工作',
      developerName: 'Pidex',
      category: 'Productivity',
      source: 'bundled',
      installationPolicy: 'INSTALLED_BY_DEFAULT',
      installed: true,
      enabled: true,
      status: 'ready',
      capabilities: ['task-planning'],
      skills: ['task-planning'],
    }
    const details = {
      pluginId: 'task-planning',
      longDescription: '拆解复杂工作。',
      displayCapabilities: ['Planning'],
      defaultPrompts: ['帮我规划任务。'],
      skills: [{ id: 'task-planning', name: 'task-planning', description: '规划任务。' }],
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
            capabilities: ['rpc.typed.v1', 'plugins.manage.v1', 'plugins.details.v1'],
            limits: {
              maxFrameBytes: 1024,
              maxSubscriptions: 4,
              maxStreamsPerSubscription: 4,
              maxPendingRequests: 8,
            },
            connectionId: 'plugins-test',
          },
        })
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'plugin/list')
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: { plugins: [plugin], generation: 1, updatedAt: 1 },
        })
      if (body.method === 'plugin/getDetails')
        return Response.json({ jsonrpc: '2.0', id: body.id, result: { details } })
      if (body.method === 'plugin/setEnabled')
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: { plugin: { ...plugin, enabled: false }, generation: 2, updatedAt: 2 },
        })
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    const listed = await client.listPlugins('F:\\workspace', true)
    const loadedDetails = await client.getPluginDetails('task-planning', 'F:\\workspace')
    const disabled = await client.setPluginEnabled('task-planning', false)

    expect(listed.plugins[0]?.id).toBe('task-planning')
    expect(disabled.enabled).toBe(false)
    expect(loadedDetails).toEqual(details)
    expect(requests.find((item) => item.method === 'initialize')?.params).toMatchObject({
      capabilities: expect.arrayContaining(['plugins.manage.v1', 'plugins.details.v1']),
    })
    expect(requests.find((item) => item.method === 'plugin/list')?.params).toEqual({
      workspace: 'F:\\workspace',
      forceReload: true,
    })
    expect(requests.find((item) => item.method === 'plugin/getDetails')?.params).toEqual({
      pluginId: 'task-planning',
      workspace: 'F:\\workspace',
    })
    expect(requests.find((item) => item.method === 'plugin/setEnabled')?.params).toEqual({
      pluginId: 'task-planning',
      enabled: false,
      operationId: expect.any(String),
    })
  })

  test('reports a missing versioned capability without duplicating its version', async () => {
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
            capabilities: ['rpc.typed.v1'],
            limits: {
              maxFrameBytes: 1024,
              maxSubscriptions: 4,
              maxStreamsPerSubscription: 4,
              maxPendingRequests: 8,
            },
            connectionId: 'plugins-unsupported-test',
          },
        })
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    expect(await client.getPluginDetails('task-planning')).toBeNull()
    expect(methods).not.toContain('plugin/getDetails')
    expect(client.listPlugins()).rejects.toThrow(
      'AGENT_OPERATION_UNSUPPORTED: 真实 Agent 会话暂不支持 plugins.manage.v1。',
    )
  })
})
