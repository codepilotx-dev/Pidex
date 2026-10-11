import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { recoverThreadWorktreeOperations } from '../src/storage/recovery/ThreadWorktreeRecovery'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-worktree-recovery-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const deletions: Array<{ worktreeId: string; operationId: string }> = []
  const recover = (now = () => 1_000) =>
    recoverThreadWorktreeOperations({
      database: db.repositories.threadWorktreeOperations,
      deleteWorktree: async (input) => {
        deletions.push(input)
        return {}
      },
      now,
    })
  return { db, deletions, recover }
}

/** Seeds a thread-created worktree operation in the pre-publication stage. */
const seedOperation = (
  db: AgentDatabase,
  input: {
    threadOperationId: string
    worktreeOperationId: string
    worktreeId: string
    threadId?: string
    boundWorktreeId?: string | null
  },
) => {
  db.sqlite
    .query(
      `
    INSERT INTO thread_worktree_operations (thread_operation_id, worktree_operation_id, worktree_id, thread_id, stage, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 'worktree-created', 1, 1)
  `,
    )
    .run(input.threadOperationId, input.worktreeOperationId, input.worktreeId)
  if (input.threadId) {
    // The thread was created under the same operation id, and may or may not still
    // point at the worktree this operation created.
    db.sqlite
      .query(
        `
      INSERT INTO threads (id, title, kind, created_at, updated_at, create_operation_id, workspace_kind)
      VALUES (?, ?, 'main', 1, 1, ?, 'legacy')
    `,
      )
      .run(input.threadId, '恢复线程', input.threadOperationId)
    if (input.boundWorktreeId) {
      // The binding's worktree_id is a real foreign key, so the worktree must exist.
      db.sqlite
        .query(
          `
        INSERT OR IGNORE INTO managed_worktrees
          (id, project_id, repository_root, path, status, branch_name, base_commit, head_commit,
           setup_status, environment_revision, continued_without_setup, created_at, updated_at, last_used_at)
        VALUES (?, 'project:1', ?, ?, 'ready', NULL, 'base', 'head', 'succeeded', 0, 0, 1, 1, 1)
      `,
        )
        .run(
          input.boundWorktreeId,
          join(tmpdir(), 'recovery-root'),
          join(tmpdir(), `recovery-wt-${input.boundWorktreeId}`),
        )
      db.sqlite
        .query(
          `
        INSERT INTO thread_execution_bindings (thread_id, binding_id, kind, project_id, cwd, worktree_id, revision, environment_revision, created_at, updated_at)
        VALUES (?, ?, 'worktree', 'project:1', ?, ?, 1, 0, 1, 1)
      `,
        )
        .run(
          input.threadId,
          `binding:${input.threadId}`,
          join(tmpdir(), 'recovery'),
          input.boundWorktreeId,
        )
    }
  }
}

const stageOf = (db: AgentDatabase, threadOperationId: string) =>
  (
    db.sqlite
      .query('SELECT stage FROM thread_worktree_operations WHERE thread_operation_id = ?')
      .get(threadOperationId) as { stage: string }
  ).stage

describe('thread worktree create recovery', () => {
  test('已发布且绑定一致时补记 thread-published 且不清理资源', async () => {
    const { db, deletions, recover } = await fixture()
    seedOperation(db, {
      threadOperationId: 'thread-operation:1',
      worktreeOperationId: 'worktree-operation:1',
      worktreeId: 'worktree:1',
      threadId: 'thread:1',
      boundWorktreeId: 'worktree:1',
    })

    expect(await recover()).toEqual({ published: 1, failed: 0, cleaned: 0 })
    expect(stageOf(db, 'thread-operation:1')).toBe('thread-published')
    expect(deletions).toEqual([])
    db.close()
  })

  test('未发布时用确定性 operation 清理孤立 Worktree 并标记 cleaned', async () => {
    const { db, deletions, recover } = await fixture()
    seedOperation(db, {
      threadOperationId: 'thread-operation:2',
      worktreeOperationId: 'worktree-operation:2',
      worktreeId: 'worktree:2',
    })

    expect(await recover()).toEqual({ published: 0, failed: 0, cleaned: 1 })
    expect(stageOf(db, 'thread-operation:2')).toBe('cleaned')
    expect(deletions).toEqual([
      { worktreeId: 'worktree:2', operationId: 'worktree-operation:2:orphan-cleanup' },
    ])
    db.close()
  })

  test('Thread 已存在但绑定缺失或不匹配时保留资源并标记 failed', async () => {
    const { db, deletions, recover } = await fixture()
    seedOperation(db, {
      threadOperationId: 'thread-operation:3',
      worktreeOperationId: 'worktree-operation:3',
      worktreeId: 'worktree:3',
      threadId: 'thread:3',
    })
    seedOperation(db, {
      threadOperationId: 'thread-operation:4',
      worktreeOperationId: 'worktree-operation:4',
      worktreeId: 'worktree:4',
      threadId: 'thread:4',
      boundWorktreeId: 'worktree:other',
    })

    expect(await recover()).toEqual({ published: 0, failed: 2, cleaned: 0 })
    expect(stageOf(db, 'thread-operation:3')).toBe('failed')
    expect(stageOf(db, 'thread-operation:4')).toBe('failed')
    // User-visible resources must survive an ambiguous recovery.
    expect(deletions).toEqual([])
    db.close()
  })

  test('重复启动恢复保持幂等', async () => {
    const { db, deletions, recover } = await fixture()
    seedOperation(db, {
      threadOperationId: 'thread-operation:5',
      worktreeOperationId: 'worktree-operation:5',
      worktreeId: 'worktree:5',
      threadId: 'thread:5',
      boundWorktreeId: 'worktree:5',
    })
    seedOperation(db, {
      threadOperationId: 'thread-operation:6',
      worktreeOperationId: 'worktree-operation:6',
      worktreeId: 'worktree:6',
    })

    const first = await recover()
    expect(first).toEqual({ published: 1, failed: 0, cleaned: 1 })
    const deletionsAfterFirst = [...deletions]

    // Every outcome is terminal, so a second pass finds nothing to resume.
    expect(await recover()).toEqual({ published: 0, failed: 0, cleaned: 0 })
    expect(deletions).toEqual(deletionsAfterFirst)
    db.close()
  })
})
