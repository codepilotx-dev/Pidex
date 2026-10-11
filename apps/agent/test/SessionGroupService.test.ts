import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Model, Provider } from '@pidex/model-schema'
import { SessionGroupService } from '../src/session-group/SessionGroupService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-session-group-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const service = new SessionGroupService(db, await Effect.runPromise(EventHub.make))
  return { db, service }
}

const submit = (content: string) => ({
  content,
  model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    approvalsReviewer: 'user' as const,
  },
  strategy: 'queue' as const,
  taskMode: 'chat' as const,
})

describe('SessionGroupService', () => {
  test('换组不移动历史步骤，删除组不删除会话、Turn 或 Patch', async () => {
    const { db, service } = await fixture()
    const first = (await service.create({ name: '登录修复', operationId: 'group:create:first' }))
      .group
    const second = (await service.create({ name: '后续修复', operationId: 'group:create:second' }))
      .group
    const thread = db.createThread('跨项目排查')
    await service.setMembership({
      threadId: thread.id,
      groupId: first.id,
      operationId: 'membership:first',
    })

    const turn = db.createTurn(thread.id, submit('修复登录'))
    db.repositories.turnPatches.recordBatch({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      toolCallID: 'tool:patch-login',
      files: [
        {
          operation: 'update',
          path: 'src/index.ts',
          beforeContent: 'before\n',
          afterContent: 'after\n',
          beforeSha256: createHash('sha256').update('before\n').digest('hex'),
          afterSha256: createHash('sha256').update('after\n').digest('hex'),
        },
      ],
    })
    db.sqlite
      .query("UPDATE turns SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(Date.now(), Date.now(), turn.turnID)
    const step = await service.captureTurn({
      threadId: thread.id,
      turnId: turn.turnID,
      status: 'completed',
      summary: '登录修复完成',
    })
    expect(step?.changedFiles[0]).toMatchObject({ path: 'src/index.ts', evidence: 'turn_patch' })

    await service.setMembership({
      threadId: thread.id,
      groupId: second.id,
      operationId: 'membership:second',
    })
    expect(service.listSteps(first.id).steps.map((item) => item.sourceTurnId)).toEqual([
      turn.turnID,
    ])
    expect(service.listSteps(second.id).steps).toEqual([])

    await service.delete({
      groupId: first.id,
      expectedVersion: first.version,
      operationId: 'group:delete:first',
    })
    expect(db.getThread(thread.id)?.id).toBe(thread.id)
    expect(db.sqlite.query('SELECT id FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      id: turn.turnID,
    })
    expect(db.repositories.turnPatches.batches(turn.turnID)).toHaveLength(1)
    db.close()
  })

  test('拒绝运行中换组，并且加入后不回填更早的 Turn', async () => {
    const { db, service } = await fixture()
    const group = (await service.create({ name: '排查组', operationId: 'group:create' })).group
    const thread = db.createThread('已有会话')
    const oldTurn = db.createTurn(thread.id, submit('加入前历史'))

    await expect(
      service.setMembership({
        threadId: thread.id,
        groupId: group.id,
        operationId: 'membership:busy',
      }),
    ).rejects.toMatchObject({ code: 'SESSION_GROUP_THREAD_BUSY' })

    db.sqlite
      .query(
        "UPDATE turns SET status = 'completed', finished_at = 1, created_at = 1, updated_at = 1 WHERE id = ?",
      )
      .run(oldTurn.turnID)
    await service.setMembership({
      threadId: thread.id,
      groupId: group.id,
      operationId: 'membership:joined',
    })
    await service.recoverMissingSteps()
    expect(service.listSteps(group.id).steps).toEqual([])
    db.close()
  })
})
