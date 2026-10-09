import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  DurableEventEnvelopeSchema,
  EventManifest,
  LiveEventEnvelopeSchema,
} from '../src/wire/Events'
import { RpcMethods } from '../src/methods/index'

describe('event manifest invariants', () => {
  test('gives every live event an authoritative reconciliation target', () => {
    const authoritativeTargets = new Set([
      ...Object.keys(EventManifest),
      ...Object.keys(RpcMethods),
    ])

    for (const definition of Object.values(EventManifest)) {
      if (definition.durability !== 'live') continue
      expect(typeof definition.reconcilesWith).toBe('string')
      expect(definition.reconcilesWith?.trim()).not.toBe('')
      expect(authoritativeTargets.has(definition.reconcilesWith ?? '')).toBe(true)
    }
  })

  test('gives every durable event a valid version and stream', () => {
    for (const definition of Object.values(EventManifest)) {
      if (definition.durability !== 'durable') continue
      expect(Number.isInteger(definition.version)).toBe(true)
      expect(definition.version).toBeGreaterThanOrEqual(1)
      expect(['global', 'thread']).toContain(definition.stream)
    }
  })

  test('reconciles plan streaming with item completion and publishes execution plan snapshots', () => {
    expect(EventManifest['plan/delta'].reconcilesWith).toBe('item/completed')
    expect(EventManifest['turn/plan/updated']).toMatchObject({
      durability: 'durable',
      stream: 'thread',
    })

    const decodeUpdate = Schema.decodeUnknownSync(EventManifest['turn/plan/updated'].payload, {
      onExcessProperty: 'error',
    })
    const item = {
      id: 'turn-1:execution-plan',
      messageID: 'message-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'execution-plan' as const,
      explanation: '开始执行',
      steps: [{ step: '更新契约', status: 'in_progress' as const }],
      status: 'streaming' as const,
      createdAt: 1,
    }

    expect(decodeUpdate({ item })).toEqual({ item })
    expect(() => decodeUpdate({ item: { ...item, type: 'plan' } })).toThrow()
  })

  test('discriminates durable and live envelopes', () => {
    const decodeDurable = Schema.decodeUnknownSync(DurableEventEnvelopeSchema)
    const decodeLive = Schema.decodeUnknownSync(LiveEventEnvelopeSchema)
    const durable = {
      eventId: 'event-1',
      streamId: 'thread-1',
      type: 'thread/created',
      version: 1,
      occurredAt: 1,
      durability: 'durable',
      sequence: 0,
      payload: {},
    } as const
    const live = {
      eventId: 'event-2',
      streamId: 'thread-1',
      type: 'item/agentMessage/delta',
      version: 1,
      occurredAt: 2,
      durability: 'live',
      sequence: null,
      afterSequence: 0,
      payload: {},
    } as const

    expect(decodeDurable(durable)).toEqual(durable)
    expect(decodeLive(live)).toEqual(live)
    expect(() => decodeDurable(live)).toThrow()
    expect(() => decodeLive(durable)).toThrow()
    expect(() => decodeDurable({ ...durable, sequence: null })).toThrow()
    expect(() => decodeLive({ ...live, sequence: 0 })).toThrow()
  })

  test('keeps MCP update events path- and configuration-free', () => {
    const decode = Schema.decodeUnknownSync(EventManifest['mcp/updated'].payload, {
      onExcessProperty: 'error',
    })
    expect(decode({ generation: 2 })).toEqual({ generation: 2 })
    expect(() =>
      decode({
        generation: 2,
        workspace: 'C:\\sensitive\\workspace',
      }),
    ).toThrow()
    expect(() =>
      decode({
        generation: 2,
        server: { url: 'https://example.com', headers: { Authorization: 'secret' } },
      }),
    ).toThrow()
  })

  test('publishes plugin updates as minimal live invalidations', () => {
    expect(EventManifest['plugins/updated']).toMatchObject({
      durability: 'live',
      stream: 'global',
      capability: 'plugins.manage.v1',
      reconcilesWith: 'plugin/list',
    })
    const decode = Schema.decodeUnknownSync(EventManifest['plugins/updated'].payload, {
      onExcessProperty: 'error',
    })
    expect(decode({ generation: 2 })).toEqual({ generation: 2 })
    expect(() =>
      decode({
        generation: 2,
        pluginPath: 'C:\\sensitive\\plugin',
      }),
    ).toThrow()
  })

  test('publishes a minimal live usage source invalidation', () => {
    expect(EventManifest['usage/source/updated']).toMatchObject({
      durability: 'live',
      stream: 'global',
      reconcilesWith: 'usage/source/list',
    })
    const decode = Schema.decodeUnknownSync(EventManifest['usage/source/updated'].payload, {
      onExcessProperty: 'error',
    })
    expect(decode({ sourceId: 'openai-admin', changedAt: 1 })).toEqual({
      sourceId: 'openai-admin',
      changedAt: 1,
    })
    expect(() =>
      decode({
        sourceId: 'openai-admin',
        changedAt: 1,
        key: 'must-not-cross-event',
      }),
    ).toThrow()
  })

  test('keeps config update events path-, value-, and credential-free', () => {
    const decode = Schema.decodeUnknownSync(EventManifest['config/updated'].payload, {
      onExcessProperty: 'error',
    })
    const payload = {
      version: 'a'.repeat(64),
      changedKeyPaths: [['desktop', 'reviewView']],
      scope: 'user' as const,
      diagnostics: [],
    }
    expect(decode(payload)).toEqual(payload)
    for (const forbidden of [
      { filePath: 'C:/Users/example/.pidex/config.json' },
      { config: { apiKey: 'secret' } },
      { value: 'secret' },
      { token: 'secret' },
    ]) {
      expect(() => decode({ ...payload, ...forbidden })).toThrow()
    }
  })

  test('publishes session group changes as minimal durable global invalidations', () => {
    expect(EventManifest['session-group/changed']).toMatchObject({
      durability: 'durable',
      stream: 'global',
      capability: 'session-group.v1',
      reconcilesWith: 'session-group/list',
    })
    const decode = Schema.decodeUnknownSync(EventManifest['session-group/changed'].payload, {
      onExcessProperty: 'error',
    })
    const payload = {
      groupId: 'session-group:1',
      reason: 'step_changed' as const,
      stepId: 'session-group-step:1',
      revision: 2,
      changedAt: 1,
    }
    expect(decode(payload)).toEqual(payload)
    expect(() => decode({ ...payload, summary: '不得进入事件日志' })).toThrow()
    expect(() => decode({ ...payload, cwd: 'C:\\sensitive' })).toThrow()
  })
})
