import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Effect } from 'effect'
import { Model, Provider } from '@pidex/model-schema'
import { TurnPatchService } from '../src/patch/TurnPatchService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { WorkspaceService } from '../src/workspace/WorkspaceService'

const roots: string[] = []
const databases: AgentDatabase[] = []
const hash = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex')

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(roots.splice(0))
})

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-turn-patch-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(db)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, {
    content: '修改两个文件',
    model: Model.Ref.make({
      providerID: Provider.ID.make('openai'),
      id: Model.ID.make('test'),
    }),
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'untrusted',
      approvalsReviewer: 'user',
    },
    strategy: 'queue',
    taskMode: 'chat',
  })
  const workspace = await WorkspaceService.open(root)
  const itemID = `patch:${turn.turnID}`
  db.upsertItem(thread.id, {
    id: itemID,
    turnID: turn.turnID,
    agentID: turn.agentID,
    type: 'patch',
    status: 'completed',
    data: {
      files: [
        { path: 'first.txt', additions: 1, deletions: 1 },
        { path: 'second.txt', additions: 1, deletions: 1 },
      ],
      totalAdditions: 2,
      totalDeletions: 2,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  db.repositories.turnPatches.recordBatch({
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    toolCallID: 'tool:edit-both',
    files: [
      {
        operation: 'update',
        path: 'first.txt',
        beforeContent: 'first-before\n',
        afterContent: 'first-after\n',
        beforeSha256: hash('first-before\n'),
        afterSha256: hash('first-after\n'),
      },
      {
        operation: 'update',
        path: 'second.txt',
        beforeContent: 'second-before\n',
        afterContent: 'second-after\n',
        beforeSha256: hash('second-before\n'),
        afterSha256: hash('second-after\n'),
      },
    ],
  })
  const service = new TurnPatchService(
    db,
    await Effect.runPromise(EventHub.make),
    async () => workspace,
  )
  return { root, db, thread, turn, itemID, service }
}

describe('TurnPatchService', () => {
  test('按工具调用和文件读取不可变的单次 unified diff', async () => {
    const { db, thread, turn, service } = await fixture()

    const first = service.readDiff({
      threadID: thread.id,
      toolCallID: 'tool:edit-both',
      path: 'first.txt',
    })
    expect(first).toMatchObject({
      path: 'first.txt',
      operation: 'update',
      renderable: true,
      tooLargeReason: null,
    })
    expect(first.patch).toContain('--- a/first.txt')
    expect(first.patch).toContain('+++ b/first.txt')
    expect(first.patch).toContain('-first-before')
    expect(first.patch).toContain('+first-after')
    expect(first.patch).not.toContain('second-after')
    expect(first.hunks).toHaveLength(1)

    db.repositories.turnPatches.recordBatch({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      toolCallID: 'tool:create',
      files: [
        {
          operation: 'create',
          path: 'created.txt',
          beforeContent: null,
          afterContent: 'created\n',
          beforeSha256: null,
          afterSha256: hash('created\n'),
        },
      ],
    })
    const created = service.readDiff({
      threadID: thread.id,
      toolCallID: 'tool:create',
      path: 'created.txt',
    })
    expect(created.patch).toContain('--- /dev/null')
    expect(created.patch).toContain('+++ b/created.txt')

    db.repositories.turnPatches.recordBatch({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      toolCallID: 'tool:later-edit',
      files: [
        {
          operation: 'update',
          path: 'first.txt',
          beforeContent: 'first-after\n',
          afterContent: 'first-final\n',
          beforeSha256: hash('first-after\n'),
          afterSha256: hash('first-final\n'),
        },
      ],
    })
    expect(
      service.readDiff({
        threadID: thread.id,
        toolCallID: 'tool:edit-both',
        path: 'first.txt',
      }),
    ).toEqual(first)
  })

  test('只投影同任务完成态工具的完整证据路径', async () => {
    const { db, thread, turn } = await fixture()
    const toolID = 'tool:edit-both'
    db.upsertItem(thread.id, {
      id: toolID,
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: 'tool',
      status: 'completed',
      data: { callID: 'tool:edit-both', tool: 'edit', title: '已编辑文件' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const projection = new ThreadProjection(db)
    expect(projection.item(db.getItem(toolID)!)).toMatchObject({
      type: 'tool',
      mutationDiffPaths: ['first.txt', 'second.txt'],
    })

    const events = db.repositories.turnPatches.markIncomplete(thread.id, turn.turnID)
    expect(events.map((event) => event.method)).toEqual(['tool/callCompleted'])
    expect(projection.item(db.getItem(toolID)!)).not.toHaveProperty('mutationDiffPaths')
    const notification = projection.notification(events[0]!)
    expect(notification.notification.params.item).not.toHaveProperty('mutationDiffPaths')
  })

  test('普通完成态工具不查询执行或 turn-patch 证据', () => {
    let executionQueries = 0
    let patchQueries = 0
    const projection = new ThreadProjection({
      getAgentExecution: () => {
        executionQueries += 1
        return { threadID: 'thread:1' }
      },
      repositories: {
        turnPatches: {
          diffPathsForToolCall: () => {
            patchQueries += 1
            return []
          },
        },
      },
    } as unknown as AgentDatabase)
    const base = {
      id: 'tool:1',
      turnID: 'turn:1',
      agentID: 'agent:1',
      type: 'tool' as const,
      status: 'completed' as const,
      data: { callID: 'tool:1', title: '已读取文件' },
      createdAt: 1,
      updatedAt: 2,
    }

    projection.item({ ...base, data: { ...base.data, tool: 'workspace.read' } })
    expect(executionQueries).toBe(0)
    expect(patchQueries).toBe(0)

    projection.item({ ...base, data: { ...base.data, tool: 'workspace.edit' } })
    expect(executionQueries).toBe(1)
    expect(patchQueries).toBe(1)
  })

  test('拒绝跨任务、错误工具或错误路径，并防御过大 diff', async () => {
    const { db, thread, turn, service } = await fixture()
    for (const input of [
      { threadID: 'thread:other', toolCallID: 'tool:edit-both', path: 'first.txt' },
      { threadID: thread.id, toolCallID: 'tool:missing', path: 'first.txt' },
      { threadID: thread.id, toolCallID: 'tool:edit-both', path: 'missing.txt' },
    ]) {
      expect(() => service.readDiff(input)).toThrow(
        expect.objectContaining({
          code: 'CHECKPOINT_UNAVAILABLE',
        }),
      )
    }

    const before = 'before\n'
    const after = `${'after\n'.repeat(15_001)}`
    db.repositories.turnPatches.recordBatch({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      toolCallID: 'tool:large-edit',
      files: [
        {
          operation: 'update',
          path: 'large.txt',
          beforeContent: before,
          afterContent: after,
          beforeSha256: hash(before),
          afterSha256: hash(after),
        },
      ],
    })
    expect(
      service.readDiff({
        threadID: thread.id,
        toolCallID: 'tool:large-edit',
        path: 'large.txt',
      }),
    ).toEqual({
      path: 'large.txt',
      operation: 'update',
      patch: '',
      hunks: [],
      renderable: false,
      tooLargeReason: 'changed-lines',
    })

    for (const scenario of [
      {
        toolCallID: 'tool:large-bytes',
        path: 'large-bytes.txt',
        afterContent: `${`${'x'.repeat(800)}\n`.repeat(4_000)}`,
        reason: 'changed-bytes' as const,
      },
      {
        toolCallID: 'tool:large-line',
        path: 'large-line.txt',
        afterContent: `${'x'.repeat(1024 * 1024 + 1)}\n`,
        reason: 'line-bytes' as const,
      },
    ]) {
      db.repositories.turnPatches.recordBatch({
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
        toolCallID: scenario.toolCallID,
        files: [
          {
            operation: 'update',
            path: scenario.path,
            beforeContent: before,
            afterContent: scenario.afterContent,
            beforeSha256: hash(before),
            afterSha256: hash(scenario.afterContent),
          },
        ],
      })
      expect(
        service.readDiff({
          threadID: thread.id,
          toolCallID: scenario.toolCallID,
          path: scenario.path,
        }),
      ).toMatchObject({
        patch: '',
        hunks: [],
        renderable: false,
        tooLargeReason: scenario.reason,
      })
    }
  })

  test('任一文件 SHA 不匹配时整次撤销零写入，恢复端点后可撤销和重做', async () => {
    const { root, itemID, thread, service } = await fixture()
    await writeFile(join(root, 'first.txt'), 'first-after\n', 'utf8')
    await writeFile(join(root, 'second.txt'), 'parallel-change\n', 'utf8')

    await expect(
      service.apply({
        threadID: thread.id,
        itemID,
        action: 'undo',
        expectedVersion: 0,
        operationID: 'operation:conflict',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'patch-state-changed', paths: ['second.txt'] },
    })
    expect(await readFile(join(root, 'first.txt'), 'utf8')).toBe('first-after\n')
    expect(await readFile(join(root, 'second.txt'), 'utf8')).toBe('parallel-change\n')

    await writeFile(join(root, 'second.txt'), 'second-after\n', 'utf8')
    const undone = await service.apply({
      threadID: thread.id,
      itemID,
      action: 'undo',
      expectedVersion: 0,
      operationID: 'operation:undo',
    })
    expect(undone.data).toMatchObject({
      reversible: true,
      applyState: 'undone',
      actionVersion: 1,
    })
    expect(await readFile(join(root, 'first.txt'), 'utf8')).toBe('first-before\n')
    expect(await readFile(join(root, 'second.txt'), 'utf8')).toBe('second-before\n')

    const reapplied = await service.apply({
      threadID: thread.id,
      itemID,
      action: 'reapply',
      expectedVersion: 1,
      operationID: 'operation:reapply',
    })
    expect(reapplied.data).toMatchObject({
      applyState: 'applied',
      actionVersion: 2,
    })
    expect(await readFile(join(root, 'first.txt'), 'utf8')).toBe('first-after\n')
    expect(await readFile(join(root, 'second.txt'), 'utf8')).toBe('second-after\n')
  })

  test('同一文件多批次折叠到轮次端点，并撤销/重做创建文件', async () => {
    const { root, db, itemID, thread, turn, service } = await fixture()
    db.repositories.turnPatches.recordBatch({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      toolCallID: 'tool:follow-up',
      files: [
        {
          operation: 'update',
          path: 'first.txt',
          beforeContent: 'first-after\n',
          afterContent: 'first-final\n',
          beforeSha256: hash('first-after\n'),
          afterSha256: hash('first-final\n'),
        },
        {
          operation: 'create',
          path: 'created.txt',
          beforeContent: null,
          afterContent: 'created\n',
          beforeSha256: null,
          afterSha256: hash('created\n'),
        },
      ],
    })
    await writeFile(join(root, 'first.txt'), 'first-final\n', 'utf8')
    await writeFile(join(root, 'second.txt'), 'second-after\n', 'utf8')
    await writeFile(join(root, 'created.txt'), 'created\n', 'utf8')

    await service.apply({
      threadID: thread.id,
      itemID,
      action: 'undo',
      expectedVersion: 0,
      operationID: 'operation:chain-undo',
    })
    expect(await readFile(join(root, 'first.txt'), 'utf8')).toBe('first-before\n')
    expect(await Bun.file(join(root, 'created.txt')).exists()).toBe(false)

    const reapplied = await service.apply({
      threadID: thread.id,
      itemID,
      action: 'reapply',
      expectedVersion: 1,
      operationID: 'operation:chain-reapply',
    })
    expect(reapplied.data.actionVersion).toBe(2)
    expect(await readFile(join(root, 'first.txt'), 'utf8')).toBe('first-final\n')
    expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe('created\n')

    const repeated = await service.apply({
      threadID: thread.id,
      itemID,
      action: 'reapply',
      expectedVersion: 1,
      operationID: 'operation:chain-reapply',
    })
    expect(repeated.data.actionVersion).toBe(2)
    expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe('created\n')
  })

  test('任一工具证据被标记不完整后整轮卡片拒绝撤销', async () => {
    const { root, db, itemID, thread, turn, service } = await fixture()
    db.repositories.turnPatches.markIncomplete(thread.id, turn.turnID)
    await writeFile(join(root, 'first.txt'), 'first-after\n', 'utf8')
    await writeFile(join(root, 'second.txt'), 'second-after\n', 'utf8')

    await expect(
      service.apply({
        threadID: thread.id,
        itemID,
        action: 'undo',
        expectedVersion: 0,
        operationID: 'operation:incomplete',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(join(root, 'first.txt'), 'utf8')).toBe('first-after\n')
    expect(await readFile(join(root, 'second.txt'), 'utf8')).toBe('second-after\n')
  })
})
