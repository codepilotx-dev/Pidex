import { EventManifest, type EventType } from '@pidex/agent-protocol'
import type { EventEnvelope as StoredEventEnvelope } from '../Domain'
import type { ThreadProjection } from './ThreadProjection'

export type EventEnvelopeProjection = {
  id: number
  threadId: string | null
  createdAt: number
  notification: {
    jsonrpc: '2.0'
    method: EventType | string
    params: Record<string, unknown>
  }
}

export type BuildEventNextNotificationInput = {
  subscriptionId: string
  streamId: string
  event: StoredEventEnvelope
  projection: ThreadProjection
}

export type EventNextNotification = {
  jsonrpc: '2.0'
  method: 'event/next'
  params: {
    subscriptionId: string
    event:
      | {
          eventId: string
          streamId: string
          type: EventType | string
          version: number
          occurredAt: number
          threadId?: string
          turnId?: string
          payload: Record<string, unknown>
          durability: 'durable'
          sequence: number
        }
      | {
          eventId: string
          streamId: string
          type: EventType | string
          version: number
          occurredAt: number
          threadId?: string
          turnId?: string
          payload: Record<string, unknown>
          durability: 'live'
          sequence: null
          afterSequence: number
        }
  }
}

/**
 * Builds the production `event/next` notification for a stored event.
 * The projection maps internal storage envelopes onto the v4 wire shape so
 * SSE consumers can decode the payload through `decodeEventEnvelope`.
 *
 * Returns `null` when the event method is not part of the v4 manifest or when
 * a live event has not yet been anchored to a durable sequence; both cases
 * mirror the existing server-side gating.
 */
export const buildEventNextNotification = (
  input: BuildEventNextNotificationInput,
): EventNextNotification | null => {
  const { subscriptionId, streamId, event, projection } = input
  if (!(event.method in EventManifest)) return null
  const type = event.method as EventType
  const definition = EventManifest[type]
  if (definition.durability === 'live' && event.afterSequence === undefined) return null
  const payload = projection.notification(event).notification.params
  const base = {
    eventId:
      definition.durability === 'live'
        ? `live:${event.createdAt}:${crypto.randomUUID()}`
        : String(event.id),
    streamId,
    type,
    version: definition.version,
    occurredAt: event.createdAt,
    ...(event.threadId ? { threadId: event.threadId } : {}),
    ...(event.turnId ? { turnId: event.turnId } : {}),
    payload,
  }
  return {
    jsonrpc: '2.0' as const,
    method: 'event/next' as const,
    params: {
      subscriptionId,
      event:
        definition.durability === 'live'
          ? {
              ...base,
              durability: 'live' as const,
              sequence: null,
              afterSequence: event.afterSequence!,
            }
          : { ...base, durability: 'durable' as const, sequence: event.id },
    },
  }
}
