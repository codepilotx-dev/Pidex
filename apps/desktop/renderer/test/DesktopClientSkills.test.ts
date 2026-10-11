import { describe, expect, test } from 'bun:test'
import { createBrowserMockDesktopClient } from '../src/services/desktop-client/BrowserMockClient.js'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

const workspace = 'F:\\CodeProject\\Pidex'
const skillPath = `${workspace}\\.agents\\skills\\review\\SKILL.md`
const wireSkill = {
  name: 'review',
  description: 'Review the current change.',
  path: skillPath,
  scope: 'workspace',
  format: 'agents',
  enabled: true,
} as const

describe('desktop runtime skills client', () => {
  test('uses the typed skill management RPC and maps workspace scope', async () => {
    const requests: Array<{ method: string; params: unknown }> = []
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
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
      if (body.method === 'skill/list') {
        return rpc(body.id, {
          skills: [wireSkill],
          generation: 2,
          updatedAt: 1_753_392_000_000,
        })
      }
      if (body.method === 'skill/read') {
        return rpc(body.id, {
          skill: wireSkill,
          content: '# Review\n',
        })
      }
      if (body.method === 'skill/setEnabled') {
        return rpc(body.id, {
          skill: { ...wireSkill, enabled: false },
          generation: 3,
          updatedAt: 1_753_392_001_000,
        })
      }
      if (body.method === 'event/subscribe') {
        return rpc(body.id, {
          subscriptionId: 'skill-subscription',
          highWatermarks: [{ streamId: 'global', sequence: 2 }],
        })
      }
      if (body.method === 'event/unsubscribe') {
        return rpc(body.id, { ok: true })
      }
      if (body.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: body.params.subscriptionId,
          acknowledged: body.params.positions,
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => source as unknown as EventSource,
    })

    const catalog = await client.listRuntimeSkills(workspace, {
      forceReload: true,
    })
    const details = await client.readRuntimeSkill(skillPath, workspace)
    const disabled = await client.setRuntimeSkillEnabled(skillPath, false)

    expect(catalog).toEqual({
      state: 'ready',
      data: [
        {
          name: 'review',
          description: 'Review the current change.',
          path: skillPath,
          scope: 'repo',
          source: 'workspace',
          format: 'agents',
          enabled: true,
        },
      ],
      updatedAt: new Date(1_753_392_000_000).toISOString(),
    })
    expect(details).toMatchObject({
      name: 'review',
      scope: 'repo',
      source: 'workspace',
      format: 'agents',
      content: '# Review\n',
    })
    expect(disabled.enabled).toBe(false)
    expect(requests.find((item) => item.method === 'skill/list')?.params).toEqual({
      workspace,
      forceReload: true,
    })
    expect(requests.find((item) => item.method === 'skill/read')?.params).toEqual({
      path: skillPath,
      workspace,
    })
    expect(requests.find((item) => item.method === 'skill/setEnabled')?.params).toEqual({
      path: skillPath,
      enabled: false,
      operationId: expect.any(String),
    })

    const generations: number[] = []
    const unsubscribe = client.onRuntimeSkillsUpdated((generation) => {
      generations.push(generation)
    })
    for (let index = 0; index < 20 && !source.onmessage; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(requests.find((item) => item.method === 'event/subscribe')?.params).toEqual({
      streams: [{ streamId: 'global', after: 'latest' }],
      liveEventTypes: [
        'catalog/updated',
        'provider/credential/updated',
        'config/updated',
        'workspace/file/changed',
        'workspace/git/changed',
        'usage/source/updated',
        'model/health/updated',
        'skill/updated',
        'plugins/updated',
        'minimaxCli/updated',
        'tooling/updated',
        'mcp/updated',
        'speech/statusChanged',
      ],
    })
    source.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'event/next',
        params: {
          subscriptionId: 'skill-subscription',
          event: {
            eventId: 'skill-event-3',
            streamId: 'global',
            type: 'skill/updated',
            version: 1,
            occurredAt: 1_753_392_002_000,
            durability: 'live',
            sequence: null,
            afterSequence: 2,
            payload: { generation: 3 },
          },
        },
      }),
    } as MessageEvent)
    for (let index = 0; index < 20 && generations.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(generations).toEqual([3])
    unsubscribe()
  })

  test('maps the stable builtin skill URI to the non-editable system source', async () => {
    const builtinSkill = {
      name: 'builtin-helper',
      description: 'Run built-in helper.',
      path: 'builtin://builtin-helper/SKILL.md',
      scope: 'user',
      format: 'pidex',
      enabled: true,
    } as const
    const fetcher = async (_path: string, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') return rpc(body.id, initializedResult())
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'skill/list') {
        return rpc(body.id, {
          skills: [builtinSkill],
          generation: 1,
          updatedAt: 1_753_392_000_000,
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    await expect(client.listRuntimeSkills(workspace)).resolves.toMatchObject({
      state: 'ready',
      data: [
        {
          name: 'builtin-helper',
          path: builtinSkill.path,
          scope: 'system',
          source: 'system',
        },
      ],
    })
  })

  test('browser mock reports local skill management as unavailable', async () => {
    const client = createBrowserMockDesktopClient()

    await expect(client.listRuntimeSkills()).resolves.toEqual({
      state: 'unavailable',
      data: null,
      error: '浏览器预览环境不支持读取本机技能目录。',
    })
    await expect(client.readRuntimeSkill(skillPath)).rejects.toThrow(
      '浏览器预览环境不支持读取本机技能详情。',
    )
    await expect(client.setRuntimeSkillEnabled(skillPath, false)).rejects.toThrow(
      '浏览器预览环境不支持修改本机技能状态。',
    )
    const unsubscribe = client.onRuntimeSkillsUpdated(() => {
      throw new Error('browser mock should not emit skill updates')
    })
    expect(unsubscribe()).toBeUndefined()
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
    capabilities: ['rpc.typed.v1', 'skills.manage.v1'],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}
