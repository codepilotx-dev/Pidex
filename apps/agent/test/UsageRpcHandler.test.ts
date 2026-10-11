import { describe, expect, test } from 'bun:test'
import { usageHandlers } from '../src/transport/rpc/handlers/Usage'

describe('usage RPC handler', () => {
  test('解码五个 canonical RPC、透传来源筛选并发布凭据失效事件', async () => {
    const calls: unknown[] = []
    const events: unknown[] = []
    const runtime = {
      dependencies: {
        usage: {
          sourceList: (...args: unknown[]) => {
            calls.push(['source-list', ...args])
            return { sources: [] }
          },
          localUsage: (...args: unknown[]) => {
            calls.push(['local', ...args])
            return { ok: true }
          },
          providerUsage: (...args: unknown[]) => {
            calls.push(['provider', ...args])
            return { ok: true }
          },
          connect: (...args: unknown[]) => {
            calls.push(['connect', ...args])
            return {
              sourceId: 'openai-admin',
              connection: { kind: 'billing-key', disconnectible: true },
            }
          },
          disconnect: (...args: unknown[]) => {
            calls.push(['disconnect', ...args])
            return { sourceId: 'openai-admin', disconnected: true }
          },
        },
      },
      emit: (...args: unknown[]) => {
        events.push(args)
      },
    }
    await usageHandlers.handle(runtime as never, 'usage/source/list', {}, {})
    await usageHandlers.handle(
      runtime as never,
      'usage/local/get',
      { range: '30d', timeZone: 'Asia/Shanghai' },
      {},
    )
    await usageHandlers.handle(
      runtime as never,
      'usage/provider/query',
      {
        range: '7d',
        timeZone: 'UTC',
        providerIds: ['openai'],
        sourceIds: ['openai-admin'],
        force: true,
      },
      {},
    )
    await usageHandlers.handle(
      runtime as never,
      'usage/credential/connect',
      {
        sourceId: 'openai-admin',
        key: 'secret',
        operationId: 'op-1',
      },
      {},
    )
    await usageHandlers.handle(
      runtime as never,
      'usage/credential/disconnect',
      {
        sourceId: 'openai-admin',
        operationId: 'op-2',
      },
      {},
    )
    expect(calls.map((item) => (item as unknown[])[0])).toEqual([
      'source-list',
      'local',
      'provider',
      'connect',
      'disconnect',
    ])
    expect(calls[2]).toEqual([
      'provider',
      {
        range: '7d',
        timeZone: 'UTC',
        providerIds: ['openai'],
        sourceIds: ['openai-admin'],
        force: true,
      },
    ])
    expect(events).toHaveLength(2)
    expect(events.map((event) => (event as unknown[])[0])).toEqual([
      'usage/source/updated',
      'usage/source/updated',
    ])
    expect(events.map((event) => (event as unknown[])[1])).toEqual([
      expect.objectContaining({ sourceId: 'openai-admin' }),
      expect.objectContaining({ sourceId: 'openai-admin' }),
    ])
    await expect(
      usageHandlers.handle(
        runtime as never,
        'usage/provider/query',
        {
          range: '7d',
          timeZone: 'not/a-real-zone',
        },
        {},
      ),
    ).rejects.toThrow()
    await expect(
      usageHandlers.handle(
        runtime as never,
        'usage/source/list',
        {
          unknown: true,
        },
        {},
      ),
    ).rejects.toThrow()
  })
})
