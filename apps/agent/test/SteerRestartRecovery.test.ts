import { expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Model, Provider } from '@pidex/model-schema'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { recoverInterruptedRuns } from '../src/storage/recovery/InterruptedRunRecovery'

for (const scenario of ['pending-only', 'mixed', 'consumed'] as const) {
  test(`steer restart recovery preserves identity and consumption: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'c09-steer-'))
    const path = join(root, 'history.sqlite')
    const input = {
      content: 'hold',
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
    } as const
    let db = new AgentDatabase(path)
    try {
      const thread = db.createThread()
      const active = db.createTurn(thread.id, input)
      db.claimTurnExecution(active.turnID)
      const consumed = db.appendGuide(
        thread.id,
        active.turnID,
        { ...input, content: 'consumed' },
        'steer-consumed',
      )
      db.consumeGuideMailbox(active.turnID, [consumed.inputID])
      const existing =
        scenario === 'mixed'
          ? db.createTurn(thread.id, { ...input, content: 'existing', strategy: 'queue' })
          : null
      const pending =
        scenario === 'consumed'
          ? []
          : [
              db.appendGuide(
                thread.id,
                active.turnID,
                { ...input, content: 'first' },
                'steer-first',
              ),
              db.appendGuide(
                thread.id,
                active.turnID,
                { ...input, content: 'second' },
                'steer-second',
              ),
            ]
      // Ensure a deterministic order even when both admissions share a millisecond.
      if (pending.length)
        db.sqlite
          .query('UPDATE inputs SET created_at=created_at+1 WHERE id=?')
          .run(pending[1]!.inputID)
      const other = db.createThread()
      const otherTurn = db.createTurn(other.id, { ...input, strategy: 'queue' })
      const otherState = db.queueStateMeta(other.id)
      db.close()
      db = new AgentDatabase(path)
      recoverInterruptedRuns(db)
      const rows = () =>
        db.sqlite
          .query(
            'SELECT id,turn_id,status,strategy FROM inputs WHERE thread_id=? ORDER BY created_at,id',
          )
          .all(thread.id) as Array<{
          id: string
          turn_id: string
          status: string
          strategy: string
        }>
      const queued = () =>
        db.sqlite
          .query(
            "SELECT i.id,t.id AS turn_id FROM inputs i JOIN turns t ON t.id=i.turn_id WHERE i.thread_id=? AND i.status='queued' AND t.status='queued' ORDER BY t.queue_position,t.created_at,t.id",
          )
          .all(thread.id) as Array<{ id: string; turn_id: string }>
      expect(queued().map((row) => row.id)).toEqual([
        ...pending.map((row) => row.inputID),
        ...(existing ? [existing.inputID] : []),
      ])
      expect(rows().find((row) => row.id === consumed.inputID)).toMatchObject({
        turn_id: active.turnID,
        status: 'consumed',
        strategy: 'guide',
      })
      for (const steer of pending) {
        const row = rows().find((row) => row.id === steer.inputID)!
        expect(row).toMatchObject({ status: 'queued', strategy: 'queue' })
        expect(row.turn_id).not.toBe(active.turnID)
        expect(
          db.sqlite.query('SELECT turn_id FROM messages WHERE id=?').get(steer.inputID),
        ).toEqual({ turn_id: row.turn_id })
        expect(
          db.sqlite
            .query("SELECT count(*) AS n FROM events WHERE turn_id=? AND method='turn/queued'")
            .get(row.turn_id),
        ).toEqual({ n: 1 })
        expect(
          db.sqlite
            .query("SELECT count(*) AS n FROM events WHERE turn_id=? AND method='agent/upserted'")
            .get(row.turn_id),
        ).toEqual({ n: 1 })
      }
      expect(db.sqlite.query('SELECT status FROM turns WHERE id=?').get(active.turnID)).toEqual({
        status: 'interrupted',
      })
      expect(db.queueStateMeta(thread.id)?.pauseReason).toBe(pending.length ? 'interrupted' : null)
      expect(db.nextQueuedTurn(thread.id)).toBeNull()
      expect(
        db.sqlite
          .query(
            "SELECT count(*) AS n FROM events WHERE thread_id=? AND method='queue/updated' AND json_extract(params,'$.action')='paused'",
          )
          .get(thread.id),
      ).toEqual({ n: pending.length ? 1 : 0 })
      expect(db.queueStateMeta(other.id)).toEqual(otherState)
      expect(db.nextQueuedTurn(other.id)?.id).toBe(otherTurn.turnID)
      const beforeRepeat = {
        rows: rows(),
        queue: queued(),
        state: db.queueStateMeta(thread.id),
        events: db.sqlite
          .query('SELECT count(*) AS n FROM events WHERE thread_id=?')
          .get(thread.id),
      }
      db.close()
      db = new AgentDatabase(path)
      recoverInterruptedRuns(db)
      expect({
        rows: rows(),
        queue: queued(),
        state: db.queueStateMeta(thread.id),
        events: db.sqlite
          .query('SELECT count(*) AS n FROM events WHERE thread_id=?')
          .get(thread.id),
      }).toEqual(beforeRepeat)
      if (pending.length) {
        db.resumeQueue(thread.id, {
          operationID: 'resume',
          expectedVersion: db.queueStateMeta(thread.id)!.version,
        })
        for (const queuedInput of beforeRepeat.queue) {
          expect(db.nextQueuedTurn(thread.id)?.id).toBe(queuedInput.turn_id)
          const agent = db.claimTurnExecution(queuedInput.turn_id)!
          db.finalizeTurn({
            threadID: thread.id,
            turnID: queuedInput.turn_id,
            agentID: agent.id,
            status: 'completed',
          })
          expect(db.claimTurnExecution(queuedInput.turn_id)).toBeNull()
          expect(
            db.sqlite
              .query("SELECT count(*) AS n FROM events WHERE turn_id=? AND method='turn/completed'")
              .get(queuedInput.turn_id),
          ).toEqual({ n: 1 })
        }
        expect(queued()).toEqual([])
      }
      expect(rows()).toHaveLength(2 + pending.length + (existing ? 1 : 0))
    } finally {
      db.close()
    }
  })
}
