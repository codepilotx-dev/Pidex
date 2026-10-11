import { afterEach, describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { publishAgentEvent } from '../src/storage/events/EventPublisher'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)))

describe('manifest-aware event publisher', () => {
  test('live 事件只发 EventHub，durable 事件才进入 SQLite', async () => {
    const path = join(tmpdir(), `pidex-events-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    const hub = await Effect.runPromise(EventHub.make)
    const received: string[] = []
    const unlisten = hub.listen((signal) =>
      received.push(
        signal.kind === 'live'
          ? signal.event.method
          : `wake:${signal.sequence}:${signal.event.method}`,
      ),
    )

    const live = await publishAgentEvent(db, hub, null, null, 'catalog/updated', {
      catalogVersion: 2,
    })
    expect(live.id).toBe(0)
    expect(live.afterSequence).toBe(0)
    expect(db.eventsAfter(0)).toEqual([])

    const durable = await publishAgentEvent(db, hub, 'thread:1', null, 'thread/updated', {})
    expect(durable.id).toBeGreaterThan(0)
    expect(db.eventsAfter(0).map((event) => event.method)).toEqual(['thread/updated'])
    expect(received).toEqual(['catalog/updated', `wake:${durable.id}:thread/updated`])

    const anchored = await publishAgentEvent(db, hub, null, null, 'catalog/updated', {
      catalogVersion: 3,
    })
    expect(anchored.afterSequence).toBe(durable.id)
    const { afterSequence: _afterSequence, ...unanchored } = anchored
    expect(() => hub.publish(unanchored)).toThrow('Live event is missing its fixed durable anchor')

    unlisten()
    db.close()
  })
})
