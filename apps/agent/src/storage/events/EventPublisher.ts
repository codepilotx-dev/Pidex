import { EventManifest, type EventType } from '@pidex/agent-protocol'
import { Effect } from 'effect'
import type { EventEnvelope } from '../../Domain'
import type { AgentDatabase } from '../database/AgentDatabase'

export const isLiveEvent = (method: string): method is EventType =>
  method in EventManifest && EventManifest[method as EventType].durability === 'live'

export const globalEventSequence = (db: Pick<AgentDatabase, 'sqlite'>) =>
  Number(
    (
      db.sqlite.query('SELECT COALESCE(MAX(id), 0) AS sequence FROM events').get() as {
        sequence: number
      }
    ).sequence,
  )

export const createLiveEvent = (
  db: Pick<AgentDatabase, 'sqlite'>,
  threadId: string | null,
  turnId: string | null,
  method: string,
  params: unknown,
): EventEnvelope => ({
  // Live events deliberately have no durable sequence. The internal zero is
  // never exposed as a sequence by the SSE adapter.
  id: 0,
  afterSequence: globalEventSequence(db),
  threadId,
  turnId,
  method,
  params,
  createdAt: Date.now(),
})

/** Manifest-aware publishing boundary shared by transport and orchestration. */
export const publishAgentEvent = async (
  db: Pick<AgentDatabase, 'insertEvent' | 'sqlite'>,
  hub: { publish(event: EventEnvelope): Effect.Effect<unknown> },
  threadId: string | null,
  turnId: string | null,
  method: string,
  params: unknown,
) => {
  const event = isLiveEvent(method)
    ? createLiveEvent(db, threadId, turnId, method, params)
    : db.insertEvent(threadId, turnId, method, params)
  await Effect.runPromise(hub.publish(event))
  return event
}
