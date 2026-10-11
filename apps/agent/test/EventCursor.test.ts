import { describe, expect, test } from 'bun:test'
import {
  deliverAnchoredLive,
  deliverDurablePage,
  eventDeliveryAllowed,
  resolveEventCursor,
} from '../src/transport/Server'
import type { ProtocolCapability } from '@pidex/agent-protocol'
import type { EventEnvelope } from '../src/Domain'

describe('Agent SSE event cursor', () => {
  test('fresh subscriptions start after existing events', () => {
    expect(resolveEventCursor(undefined, undefined, 418)).toBe(418)
  })

  test('explicit cursors preserve replay semantics', () => {
    expect(resolveEventCursor('120', undefined, 418)).toBe(120)
    expect(resolveEventCursor(undefined, '240', 418)).toBe(240)
    expect(resolveEventCursor('120', '240', 418)).toBe(240)
    expect(resolveEventCursor('0', undefined, 418)).toBe(0)
  })

  test('live delivery catches durable state up to its fixed anchor first', async () => {
    let cursor = 3
    const order: string[] = []
    const delivered = await deliverAnchoredLive(
      () => cursor,
      5,
      async (target) => {
        order.push(`durable:${target}`)
        cursor = target
      },
      async () => {
        order.push('live')
      },
    )

    expect(delivered).toBe(true)
    expect(order).toEqual(['durable:5', 'live'])
  })

  test('live delivery drops an event whose anchor is behind the stream cursor', async () => {
    const order: string[] = []
    const delivered = await deliverAnchoredLive(
      () => 6,
      5,
      async () => {
        order.push('durable')
      },
      async () => {
        order.push('live')
      },
    )

    expect(delivered).toBe(false)
    expect(order).toEqual([])
  })

  test('eventDeliveryAllowed blocks durable event without required capability, permits thread/updated with events.replay.v1', () => {
    const taskboardEvent = {
      id: 1,
      afterSequence: 2,
      threadId: null as string | null,
      turnId: null as string | null,
      method: 'session-group/changed',
      params: { groupId: 'g1', reason: 'created' as const, revision: 1, changedAt: 1 },
      createdAt: Date.now(),
    } as EventEnvelope
    const threadEvent = {
      id: 2,
      afterSequence: 3,
      threadId: null as string | null,
      turnId: null as string | null,
      method: 'thread/updated',
      params: {
        thread: {
          id: 't1',
          title: 't',
          projectId: null,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
          unreadAt: null,
          readThroughAt: null,
        },
        version: 1,
      },
      createdAt: Date.now(),
    } as EventEnvelope
    const withTaskboard = {
      capabilities: new Set<ProtocolCapability>([
        'rpc.typed.v1',
        'events.replay.v1',
        'session-group.v1',
      ]),
    }
    expect(eventDeliveryAllowed(taskboardEvent, withTaskboard)).toBe(true)
    const withoutTaskboard = {
      capabilities: new Set<ProtocolCapability>(['rpc.typed.v1', 'events.replay.v1']),
    }
    expect(eventDeliveryAllowed(taskboardEvent, withoutTaskboard)).toBe(false)
    expect(eventDeliveryAllowed(threadEvent, withoutTaskboard)).toBe(true)
  })

  test('capability gate blocks delivery but cursor still advances past filtered events', async () => {
    const taskboardEvent = {
      id: 1,
      afterSequence: 2,
      threadId: 't1' as string | null,
      turnId: null as string | null,
      method: 'session-group/changed',
      params: { groupId: 'g1', reason: 'created' as const, revision: 1, changedAt: 1 },
      createdAt: Date.now(),
    } as EventEnvelope
    const threadEvent = {
      id: 2,
      afterSequence: 3,
      threadId: 't1' as string | null,
      turnId: null as string | null,
      method: 'thread/updated',
      params: {
        thread: {
          id: 't1',
          title: 't',
          projectId: null,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
          unreadAt: null,
          readThroughAt: null,
        },
        version: 1,
      },
      createdAt: Date.now(),
    } as EventEnvelope
    const events = [taskboardEvent, threadEvent]
    const cursors: number[] = []
    const delivered: string[] = []
    const subscription = {
      capabilities: new Set<ProtocolCapability>(['rpc.typed.v1', 'events.replay.v1']),
    }
    const result = await deliverDurablePage({
      events,
      target: 2,
      subscription,
      updateCursor: (cursor) => {
        cursors.push(cursor)
      },
      deliver: (event) => {
        delivered.push(event.method)
        return true
      },
    })

    expect(cursors).toEqual([1, 2])
    expect(delivered).toEqual(['thread/updated'])
    expect(result).toEqual({ lastCursor: 2, delivered: 1 })
  })
})
