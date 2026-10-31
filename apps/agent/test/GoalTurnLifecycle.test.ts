import { expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { ThreadService } from '../src/session/ThreadService'
import { ThreadGoalService } from '../src/session/ThreadGoalService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { threadGoalHandlers } from '../src/transport/rpc/handlers/ThreadGoal'
import { removeFixturePaths } from './FixtureCleanup'

for (const action of ['pause', 'stop'] as const) {
  test(`运行中 ${action}：暂停 Goal 保留当前 Turn，显式停止仍中断`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-goal-turn-'))
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const workspace = await WorkspaceService.open(root)
    const events: string[] = []
    const hub = {
      publish: (event: { method: string }) => {
        events.push(event.method)
        return Effect.void
      },
    }
    const goals = new ThreadGoalService(db, hub as never)
    let entered!: (signal: AbortSignal) => void
    const started = new Promise<AbortSignal>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const response = new Promise<void>((resolve) => {
      release = resolve
    })
    let runs = 0
    const threads = new ThreadService(
      db,
      hub as never,
      {
        resolve: async () => ({ providerID: 'test', id: 'test' }),
        getModel: async () => ({}),
      } as never,
      {} as never,
      { setResumeHandler: () => {} } as never,
      {
        toolExposure: () => ({ exposed: [] }),
        clearTurnPermissionGrants: () => {},
        abort: async () => {},
        run: async ({ signal }: { signal: AbortSignal }) => {
          runs++
          entered(signal)
          await response
          return { status: 'completed', output: '完成当前轮次' }
        },
      } as never,
      {
        setParentResumeHandler: () => {},
        resolvedWaitCheckpoint: () => null,
        collaboration: { saved: () => null, available: false },
        deferCompletion: async () => false,
        reconcileCompletions: async () => {},
        delegationFor: () => undefined,
        stopChildrenForParent: async () => {},
      } as never,
      { listByBinding: async () => [] } as never,
      { dataRoot: root, userHome: root },
      { recall: () => [], enqueue: () => null } as never,
      { load: () => {}, run: async () => [] } as never,
      {
        resolve: async () => ({
          kind: 'projectless',
          workspace,
          workspaceRoot: root,
          cwd: root,
          outputDirectory: root,
        }),
      } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      goals,
    )
    let execution: Promise<void> | undefined
    try {
      const thread = db.createThread()
      const goal = (
        await goals.set({
          threadId: thread.id,
          objective: '保持持续目标',
          expectedVersion: null,
          operationId: 'create',
        })
      ).goal
      const turn = db.createTurn(
        thread.id,
        {
          content: '完成当前轮次',
          model: { providerID: 'test', id: 'test' } as never,
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
          },
          strategy: 'queue',
          taskMode: 'chat',
        },
        'queued',
      )
      execution = (
        threads as unknown as {
          executeTurn(threadId: string, turnId: string): Promise<void>
        }
      ).executeTurn(thread.id, turn.turnID)
      const signal = await Promise.race([
        started,
        execution.then(() => {
          throw new Error(
            `Turn ended before runtime: ${JSON.stringify(db.agentForTurn(turn.turnID))}`,
          )
        }),
      ])
      await threadGoalHandlers.handle(
        { dependencies: { threadGoals: goals, threads } } as never,
        'thread/goal/set',
        {
          threadId: thread.id,
          status: 'paused',
          expectedVersion: goal.version,
          operationId: 'pause',
        },
        {} as never,
      )
      expect(goals.get(thread.id).goal?.status).toBe('paused')
      expect(signal.aborted).toBe(false)
      expect(db.activeTurn(thread.id)?.id).toBe(turn.turnID)
      expect(events).not.toContain('turn/interrupted')
      const stopping = action === 'stop' ? threads.stop(thread.id, turn.turnID) : undefined
      if (stopping) {
        // stop takes the admission lock before aborting the live runtime.
        await new Promise((resolve) => setImmediate(resolve))
        expect(signal.aborted).toBe(true)
      }
      release()
      await execution
      await stopping
      expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
        status: action === 'pause' ? 'completed' : 'interrupted',
      })
      expect(db.nextQueuedTurn(thread.id)).toBeNull()
      expect(runs).toBe(1)
      expect(goals.get(thread.id).goal?.status).toBe('paused')
    } finally {
      release()
      await execution
      db.close()
      await removeFixturePaths([root])
    }
  })
}
