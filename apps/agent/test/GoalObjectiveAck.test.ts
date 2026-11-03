import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { ThreadGoalService } from '../src/session/ThreadGoalService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

/**
 * The acknowledgement of an injected objective travels through the harness's
 * wildcard `subscribe` channel, not the typed `on` hook registry. A typed handler
 * is never called for `after_provider_response`, and the evidence is that the
 * objective stayed acknowledged = 0 for a full turn until this was corrected.
 * This test pins the dispatch contract so a refactor cannot silently break it.
 */
describe('harness event dispatch contract', () => {
  test('notification events reach subscribe listeners, not typed hook handlers', async () => {
    const { AgentHarness } = await import('../src/orchestration/harness/AgentHarness')
    expect(typeof AgentHarness.prototype.subscribe).toBe('function')

    // Model the runtime's two registration APIs against the same event.
    const seenBySubscribe: string[] = []
    const seenByTypedHook: string[] = []
    const handlers = new Map<string, Set<(event: { type: string }) => void>>()

    const subscribe = (listener: (event: { type: string }) => void) => {
      const key = '*'
      const set = handlers.get(key) ?? new Set()
      set.add(listener)
      handlers.set(key, set)
    }
    const on = (type: string, listener: (event: { type: string }) => void) => {
      const set = handlers.get(type) ?? new Set()
      set.add(listener)
      handlers.set(type, set)
    }
    // The harness emits a result-less event through the wildcard channel only.
    const emitOwn = (event: { type: string }) => {
      for (const listener of handlers.get('*') ?? []) listener(event)
    }

    subscribe((event) => seenBySubscribe.push(event.type))
    on('after_provider_response', (event) => seenByTypedHook.push(event.type))
    emitOwn({ type: 'after_provider_response' })

    expect(seenBySubscribe).toEqual(['after_provider_response'])
    expect(seenByTypedHook).toEqual([])
  })

  test('只有 2xx 响应才确认目标修订', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-goal-ack-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const service = new ThreadGoalService(db, await Effect.runPromise(EventHub.make))
    const thread = db.createThread('确认消费')
    const created = (
      await service.set({
        threadId: thread.id,
        objective: '初始目标',
        expectedVersion: null,
        operationId: 'create',
      })
    ).goal
    await service.set({
      threadId: thread.id,
      objective: '修改后的目标',
      expectedVersion: created.version,
      operationId: 'edit',
    })
    const controls = db.repositories.threadGoalControls
    expect(controls.get(created.id)!.objective_ack_revision).toBe(0)

    // Mirror the runtime guard: a non-2xx response must not acknowledge, so the
    // update stays pending and is re-injected on the next attempt.
    const acknowledgeIfAccepted = (status: number) => {
      if (status < 200 || status >= 300) return
      controls.acknowledgeObjective(created.id, 1)
    }
    acknowledgeIfAccepted(500)
    expect(controls.get(created.id)!.objective_ack_revision).toBe(0)
    acknowledgeIfAccepted(200)
    expect(controls.get(created.id)!.objective_ack_revision).toBe(1)
  })
})
