import { expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Model, Provider } from '@pidex/model-schema'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { recoverInterruptedRuns } from '../src/storage/recovery/InterruptedRunRecovery'
import { AgentRuntimeService } from '../src/orchestration/AgentRuntimeService'
import { PiEventAdapter } from '../src/orchestration/pi/PiEventAdapter'
import type { PiRuntimeEventSink } from '../src/orchestration/pi/Types'
import type { AgentHarnessEvent } from '../src/orchestration/harness/Types'

for (const parseProposedPlan of [false, true]) {
  for (const finish of ['stop', 'complete'] as const) {
    test(`visible stream survives ${finish} and database reopen (plan parser=${parseProposedPlan})`, async () => {
      const path = join(await mkdtemp(join(tmpdir(), 'c24-stream-')), 'history.sqlite')
      let db = new AgentDatabase(path)
      try {
        const thread = db.createThread()
        const turn = db.createTurn(thread.id, {
          content: 'stream',
          model: Model.Ref.make({
            providerID: Provider.ID.make('fixture'),
            id: Model.ID.make('fixture'),
          }),
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'auto_review',
          },
          strategy: 'start',
          taskMode: 'chat',
        })
        const agent = db.claimTurnExecution(turn.turnID)!
        const context = { threadID: thread.id, turnID: turn.turnID, agentID: agent.id }
        let itemID = ''
        const published: string[] = []
        const runtime = new AgentRuntimeService({
          db,
          hub: {
            publish: (event: { method: string; params: { itemId?: string; delta?: string } }) =>
              Effect.sync(() => {
                if (event.method !== 'item/agentMessage/delta') return
                itemID = event.params.itemId!
                published.push(event.params.delta!)
                // The database must already contain everything the client has seen.
                expect(db.getItem(itemID)?.data.text).toBe(published.join(''))
              }),
          } as never,
          models: {} as never,
          toolExecutor: {} as never,
          contextCompaction: {} as never,
        })
        const sink = (
          runtime as unknown as { eventSink(...args: unknown[]): PiRuntimeEventSink }
        ).eventSink(
          { flush() {}, discardPending() {} },
          {},
          { provider: 'fixture', id: 'fixture', contextWindow: 128000 },
          'session',
        )
        const adapter = new PiEventAdapter(context, sink, { parseProposedPlan })
        const message = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] })
        await adapter.handle({
          type: 'message_start',
          message: message(''),
        } as unknown as AgentHarnessEvent)
        for (const delta of ['001 visible\n', '002 retained\n']) {
          await adapter.handle({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta },
          } as AgentHarnessEvent)
        }
        const prefix = published.join('')
        expect(prefix).toContain('001 visible')
        if (finish === 'stop') {
          await adapter.handle({ type: 'abort' } as AgentHarnessEvent)
          db.finalizeTurn({ ...context, status: 'interrupted', pauseReason: 'interrupted' })
          await sink.textDelta?.(context, { itemID, delta: 'LATE-MUST-NOT-APPEAR' })
          expect(published.join('')).toBe(prefix)
        } else {
          await adapter.handle({
            type: 'message_end',
            message: message('001 visible\n002 retained\n'),
          } as unknown as AgentHarnessEvent)
          await sink.savePoint?.(context, { hadPendingMutations: true })
          db.finalizeTurn({ ...context, status: 'completed' })
        }
        const before = db.getItem(itemID)!
        expect(before.status).toBe(finish === 'stop' ? 'interrupted' : 'completed')
        expect(before.data.text).toBe(finish === 'stop' ? prefix : prefix.trim())
        const count = () =>
          db.sqlite
            .query("SELECT count(*) AS n FROM events WHERE turn_id=? AND method='turn/completed'")
            .get(turn.turnID)
        expect(count()).toEqual({ n: finish === 'stop' ? 0 : 1 })
        db.close()
        db = new AgentDatabase(path)
        recoverInterruptedRuns(db)
        recoverInterruptedRuns(db)
        expect(db.getItem(itemID)).toEqual(before)
        expect(count()).toEqual({ n: finish === 'stop' ? 0 : 1 })
        expect(
          db.sqlite
            .query('SELECT count(*) AS n FROM items WHERE turn_id=? AND type=?')
            .get(turn.turnID, 'text'),
        ).toEqual({ n: 1 })
      } finally {
        db.close()
      }
    })
  }
}
