import { afterEach, describe, expect, test } from 'bun:test'
import type { ModelRef } from '@pidex/shared/model'
import { Model, Provider } from '@pidex/model-schema'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import type { ScheduledTaskCreateRecord } from '../src/storage/repositories/ScheduledTaskRepository'
import { removeFixturePaths } from './FixtureCleanup'

const databases: AgentDatabase[] = []
const paths: string[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(paths.splice(0))
})

const model = { providerID: 'openai', id: 'codex' } as unknown as ModelRef
const task = (
  id: string,
  operationId: string,
  scheduledFor: number,
): ScheduledTaskCreateRecord => ({
  id,
  operationId,
  proposalId: null,
  kind: 'standalone',
  name: `任务 ${id}`,
  prompt: '执行一次检查',
  projectId: null,
  targetThreadId: null,
  execution: { kind: 'local' },
  model,
  reasoningEffort: null,
  permissionConfig: {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
  },
  scheduledFor,
  timeZone: 'Asia/Shanghai',
  notificationPolicy: 'all',
})

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-scheduled-task-'))
  paths.push(root)
  const db = new AgentDatabase({
    historyPath: join(root, 'history.sqlite'),
    profilePath: join(root, 'profile.sqlite'),
  })
  databases.push(db)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, {
    content: '排期',
    model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
    },
    strategy: 'queue',
    taskMode: 'chat',
  })
  return { db, thread, turn }
}

describe('ScheduledTaskRepository', () => {
  test('独立计划任务引用 profile 项目时不建立跨数据库外键', async () => {
    const { db } = await setup()
    const project = db.createProject({ rootPath: process.cwd(), name: '日历项目' })
    const created = db.repositories.scheduledTasks.create(
      {
        ...task('scheduled:project', 'create:project', 100),
        projectId: project.id,
      },
      1,
    )
    expect(created.projectId).toBe(project.id)
  })

  test('一次性任务 CRUD/CAS、原子 claim 与终态绑定', async () => {
    const { db, thread, turn } = await setup()
    const repository = db.repositories.scheduledTasks
    const created = repository.create(task('scheduled:1', 'create:1', 100), 1)
    expect(repository.create(task('scheduled:1', 'create:1', 100), 2)).toEqual(created)
    expect(repository.nextDeadline()).toBe(100)
    expect(repository.listRange({ from: 0, to: 101 }).map((value) => value.id)).toEqual([
      created.id,
    ])

    const updated = repository.update(
      created.id,
      { expectedRevision: created.revision, name: '更新后', scheduledFor: 150 },
      3,
    )
    expect(updated).toMatchObject({ revision: 2, name: '更新后', scheduledFor: 150 })
    expect(() =>
      repository.update(created.id, { expectedRevision: created.revision, name: '冲突' }, 4),
    ).toThrow()
    expect(repository.claimDue(149)).toEqual([])
    const [claimed] = repository.claimDue(150)
    expect(claimed).toMatchObject({ id: created.id, status: 'claimed', revision: 3 })
    expect(repository.markPreparing(created.id, 5).status).toBe('preparing')
    expect(
      repository.bindExecution(created.id, { threadId: thread.id, turnId: turn.turnID }, 6).status,
    ).toBe('queued')
    expect(repository.markRunning(created.id, 7).status).toBe('running')
    expect(repository.complete(created.id, 'completed', 8)).toMatchObject({
      status: 'completed',
      completedAt: 8,
    })
    expect(repository.findByTurn(turn.turnID)?.id).toBe(created.id)
    expect(repository.listActive()).toEqual([])

    const paused = repository.update(
      repository.create(task('scheduled:2', 'create:2', 200), 9).id,
      { expectedRevision: 1, status: 'paused' },
      10,
    )
    const manual = repository.claimManual(paused.id, 'manual:1', 11)
    expect(repository.claimManual(paused.id, 'manual:1', 12)).toEqual(manual)
    const cancellable = repository.create(task('scheduled:3', 'create:3', 300), 13)
    expect(() => repository.claimManual(cancellable.id, 'manual:1', 14)).toThrow()
    expect(repository.cancel(cancellable.id, cancellable.revision, 15)).toMatchObject({
      status: 'cancelled',
      cancelledAt: 15,
    })
    expect(repository.read(cancellable.id)).toBeNull()
  })
})

describe('SchedulePlanProposalRepository', () => {
  test('proposal 创建与 commit 保持幂等并可与任务创建同事务提交', async () => {
    const { db, thread, turn } = await setup()
    const proposals = db.repositories.schedulePlanProposals
    const input = {
      id: 'proposal:1',
      operationId: 'proposal:create:1',
      threadId: thread.id,
      turnId: turn.turnID,
      toolCallId: 'tool:1',
      horizon: 'week' as const,
      defaults: {
        kind: 'standalone' as const,
        projectId: null,
        targetThreadId: null,
        execution: { kind: 'local' as const },
        model,
        reasoningEffort: null,
        permissionConfig: {
          sandboxMode: 'workspace-write' as const,
          approvalPolicy: 'never' as const,
          approvalsReviewer: 'user' as const,
        },
        timeZone: 'Asia/Shanghai',
        notificationPolicy: 'all' as const,
      },
      items: [
        {
          key: 'one',
          enabled: true,
          kind: 'one-off' as const,
          name: '检查',
          prompt: '执行检查',
          scheduledFor: 100,
        },
      ],
    }
    const proposal = proposals.create(input, 1)
    expect(proposals.create(input, 2)).toEqual(proposal)
    let missingError: unknown
    try {
      proposals.commit(
        'missing',
        {
          expectedRevision: 1,
          operationId: 'proposal:commit:missing',
          createdRefs: [],
        },
        2,
      )
    } catch (error) {
      missingError = error
    }
    expect(missingError).toMatchObject({ code: 'SCHEDULE_PLAN_NOT_FOUND' })

    const committed = db.transaction(() => {
      db.repositories.scheduledTasks.create(
        {
          ...task('scheduled:proposal', 'scheduled:create:proposal', 100),
          proposalId: proposal.id,
        },
        3,
      )
      return proposals.commit(
        proposal.id,
        {
          expectedRevision: proposal.revision,
          operationId: 'proposal:commit:1',
          createdRefs: [{ kind: 'scheduled-task', id: 'scheduled:proposal' }],
        },
        3,
      )
    })
    expect(db.repositories.scheduledTasks.proposalId('scheduled:proposal')).toBe(proposal.id)
    expect(committed).toMatchObject({ status: 'committed', revision: 2, committedAt: 3 })
    expect(
      proposals.commit(
        proposal.id,
        {
          expectedRevision: proposal.revision,
          operationId: 'proposal:commit:1',
          createdRefs: [{ kind: 'scheduled-task', id: 'scheduled:proposal' }],
        },
        4,
      ),
    ).toEqual(committed)
    expect(proposals.findByToolCall('tool:1')?.id).toBe(proposal.id)
    expect(proposals.findByCommitOperation('proposal:commit:1')?.id).toBe(proposal.id)
  })
})
