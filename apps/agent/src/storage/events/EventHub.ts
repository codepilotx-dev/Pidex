import { PubSub, Effect } from 'effect'
import { EventManifest, type EventType } from '@pidex/agent-protocol'
import type { EventEnvelope } from '../../Domain'

export type EventHubSignal =
  | { kind: 'live'; event: EventEnvelope & { afterSequence: number } }
  | { kind: 'durable'; sequence: number; event: EventEnvelope }

export class EventHub {
  private readonly pubsub: PubSub.PubSub<EventHubSignal>
  private readonly listeners = new Set<(signal: EventHubSignal) => void>()
  private readonly visualizationPreviews = new Map<string, EventEnvelope>()

  visualizationSnapshots(afterSequence: number): EventEnvelope[] {
    return [...this.visualizationPreviews.values()].map((event) => ({ ...event, afterSequence }))
  }

  private constructor(pubsub: PubSub.PubSub<EventHubSignal>) {
    this.pubsub = pubsub
  }

  static make = Effect.gen(function* () {
    return new EventHub(yield* PubSub.unbounded<EventHubSignal>())
  })

  publish(event: EventEnvelope) {
    const params = event.params as {
      toolCallId?: string
      item?: { id: string }
      turn?: { id: string }
    }
    if (event.method === 'visualization/preview' && params.toolCallId) {
      this.visualizationPreviews.set(params.toolCallId, event)
      while (this.visualizationPreviews.size > 64)
        this.visualizationPreviews.delete(this.visualizationPreviews.keys().next().value!)
    } else if (['tool/callCompleted', 'tool/error'].includes(event.method) && params.item) {
      this.visualizationPreviews.delete(params.item.id)
    } else if (['turn/completed', 'turn/failed', 'turn/interrupted'].includes(event.method)) {
      for (const [id, preview] of this.visualizationPreviews) {
        if (preview.turnId === (params.turn?.id ?? event.turnId))
          this.visualizationPreviews.delete(id)
      }
    }
    const definition =
      event.method in EventManifest ? EventManifest[event.method as EventType] : null
    if (definition?.durability === 'live' && typeof event.afterSequence !== 'number') {
      throw new Error(`Live event is missing its fixed durable anchor: ${event.method}`)
    }
    const signal: EventHubSignal =
      definition?.durability === 'live'
        ? { kind: 'live', event: event as EventEnvelope & { afterSequence: number } }
        : { kind: 'durable', sequence: event.id, event }
    for (const listener of this.listeners) {
      try {
        listener(signal)
      } catch {
        /* one SSE consumer must not block publication */
      }
    }
    return PubSub.publish(this.pubsub, signal)
  }

  subscribe() {
    return PubSub.subscribe(this.pubsub)
  }

  /**
   * Promise/HTTP adapters cannot safely retain an Effect scoped Dequeue for
   * the lifetime of an SSE response. This listener API preserves the same
   * fan-out while making subscription-before-replay ordering explicit.
   */
  listen(listener: (signal: EventHubSignal) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
