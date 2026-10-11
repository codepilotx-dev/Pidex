import type {
  EventAckParamsSchema,
  EventSubscribeParamsSchema,
  ProtocolCapability,
} from '@pidex/agent-protocol'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import { AgentError } from '../Domain'
import { globalEventSequence } from '../storage/events/EventPublisher'

type SubscribeParams = typeof EventSubscribeParamsSchema.Type
type AckParams = typeof EventAckParamsSchema.Type

export type EventSubscription = {
  id: string
  connectionId: string
  streams: Map<string, number>
  acknowledged: Map<string, number>
  liveEventTypes: ReadonlySet<string> | null
  /** Capabilities negotiated by the owning connection at initialize time. */
  capabilities: ReadonlySet<ProtocolCapability>
  createdAt: number
}

/**
 * Owns RPC v4 subscription identity and cursor acknowledgements. The HTTP/SSE
 * adapter consumes these records; replay data remains in the existing events
 * table and is never duplicated here.
 */
export class EventSubscriptionRegistry {
  private readonly subscriptions = new Map<string, EventSubscription>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly limits = { maxSubscriptions: 16, maxStreamsPerSubscription: 64 },
  ) {}

  subscribe(
    connectionId: string,
    params: SubscribeParams,
    capabilities: ReadonlySet<ProtocolCapability> = new Set(),
  ) {
    const connectionSubscriptions = [...this.subscriptions.values()].filter(
      (subscription) => subscription.connectionId === connectionId,
    ).length
    if (connectionSubscriptions >= this.limits.maxSubscriptions) {
      throw new AgentError('SUBSCRIPTION_OVERFLOW', '事件订阅数量已达到上限', 409)
    }
    if (
      params.streams.length === 0 ||
      params.streams.length > this.limits.maxStreamsPerSubscription
    ) {
      throw new AgentError('SUBSCRIPTION_OVERFLOW', '事件订阅的 stream 数量无效', 409)
    }
    const streams = new Map<string, number>()
    const highWatermarks = new Map<string, number>()
    for (const cursor of params.streams) {
      if (streams.has(cursor.streamId))
        throw new AgentError('CONFLICT', `重复的事件 stream：${cursor.streamId}`, 409)
      const bounds = this.cursorBounds(cursor.streamId)
      const after = cursor.after === 'latest' ? bounds.high : cursor.after
      if (
        cursor.after !== 'latest' &&
        (after > bounds.high || (bounds.low !== null && after < bounds.low - 1))
      ) {
        throw new AgentError(
          'CURSOR_EXPIRED',
          `事件游标不在可重放范围内：${cursor.streamId}`,
          409,
          {
            streamId: cursor.streamId,
            lowWatermark: bounds.low,
            highWatermark: bounds.high,
          },
        )
      }
      streams.set(cursor.streamId, after)
      highWatermarks.set(cursor.streamId, bounds.high)
    }
    const id = crypto.randomUUID()
    const subscription: EventSubscription = {
      id,
      connectionId,
      streams,
      acknowledged: new Map(streams),
      liveEventTypes: params.liveEventTypes ? new Set(params.liveEventTypes) : null,
      capabilities,
      createdAt: Date.now(),
    }
    this.subscriptions.set(id, subscription)
    return {
      subscriptionId: id,
      highWatermarks: [...streams.keys()].map((streamId) => ({
        streamId,
        sequence: highWatermarks.get(streamId)!,
      })),
    }
  }

  ack(connectionId: string, params: AckParams) {
    const subscription = this.require(params.subscriptionId, connectionId)
    const acknowledged = params.positions.map((position) => {
      if (!subscription.streams.has(position.streamId)) {
        throw new AgentError(
          'SUBSCRIPTION_NOT_FOUND',
          `订阅不包含 stream：${position.streamId}`,
          404,
        )
      }
      const highWatermark = this.highWatermark(position.streamId)
      if (position.sequence > highWatermark) {
        throw new AgentError('CONFLICT', `确认游标超过 stream 高水位：${position.streamId}`, 409)
      }
      const previous = subscription.acknowledged.get(position.streamId) ?? 0
      const sequence = Math.max(previous, position.sequence)
      subscription.acknowledged.set(position.streamId, sequence)
      return { streamId: position.streamId, sequence }
    })
    return { subscriptionId: subscription.id, acknowledged }
  }

  unsubscribe(connectionId: string, subscriptionId: string) {
    this.require(subscriptionId, connectionId)
    if (!this.subscriptions.delete(subscriptionId)) {
      throw new AgentError('SUBSCRIPTION_NOT_FOUND', '事件订阅不存在或已经关闭', 404)
    }
    return { ok: true as const }
  }

  get(subscriptionId: string, connectionId: string) {
    const subscription = this.subscriptions.get(subscriptionId)
    return subscription?.connectionId === connectionId ? subscription : null
  }

  validateLastEventID(subscription: EventSubscription, raw: string | undefined) {
    if (raw === undefined || raw === '') return
    if (subscription.acknowledged.size !== 1) {
      throw new AgentError('CONFLICT', '多 stream 订阅不能使用单一 Last-Event-ID', 409)
    }
    if (!/^\d+$/.test(raw)) throw new AgentError('INVALID_REQUEST', 'Last-Event-ID 格式无效', 400)
    const cursor = Number(raw)
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new AgentError('INVALID_REQUEST', 'Last-Event-ID 超出安全范围', 400)
    const [streamID] = subscription.acknowledged.keys()
    const bounds = this.cursorBounds(streamID!)
    if (cursor > bounds.high)
      throw new AgentError('CONFLICT', 'Last-Event-ID 超过 stream 高水位', 409)
    if (bounds.low !== null && cursor < bounds.low - 1) {
      throw new AgentError('CURSOR_EXPIRED', 'Last-Event-ID 已超出可重放范围', 409, {
        streamId: streamID,
        lowWatermark: bounds.low,
        highWatermark: bounds.high,
      })
    }
    if (streamID !== 'global') {
      const acknowledged = subscription.acknowledged.get(streamID!) ?? 0
      if (
        cursor === 0 ||
        cursor === acknowledged ||
        (bounds.low !== null && cursor === bounds.low - 1)
      )
        return
      const event = this.db.sqlite
        .query('SELECT thread_id FROM events WHERE id = ?')
        .get(cursor) as { thread_id: string | null } | null
      if (!event || (event.thread_id !== null && event.thread_id !== streamID)) {
        throw new AgentError('CONFLICT', 'Last-Event-ID 不属于当前 stream', 409)
      }
    }
  }

  closeConnection(connectionId: string) {
    for (const [id, subscription] of this.subscriptions) {
      if (subscription.connectionId === connectionId) this.subscriptions.delete(id)
    }
  }

  private require(subscriptionId: string, connectionId: string) {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription || subscription.connectionId !== connectionId)
      throw new AgentError('SUBSCRIPTION_NOT_FOUND', '事件订阅不存在或已经关闭', 404)
    return subscription
  }

  private highWatermark(streamId: string) {
    return this.cursorBounds(streamId).high
  }

  private cursorBounds(streamId: string) {
    const high = globalEventSequence(this.db)
    if (streamId === 'global') {
      const row = this.db.sqlite.query('SELECT MIN(id) AS low FROM events').get() as {
        low: number | null
      }
      return { low: row.low === null ? null : Number(row.low), high }
    }
    const row = this.db.sqlite
      .query('SELECT MIN(id) AS low FROM events WHERE thread_id = ?')
      .get(streamId) as { low: number | null }
    return { low: row.low === null ? null : Number(row.low), high }
  }
}
