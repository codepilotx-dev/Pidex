import type { Database } from 'bun:sqlite'
import type {
  ManagedWorktree,
  TaskExecutionBinding,
  WorktreeOperation,
  WorktreeOperationKind,
} from './Types'

type WorktreeRow = {
  id: string
  project_id: string
  repository_root: string
  path: string
  status: ManagedWorktree['status']
  branch_name: string | null
  base_commit: string
  head_commit: string
  permanent: number
  pinned: number
  bound_once: number
  setup_status: ManagedWorktree['setupStatus']
  environment_revision: number
  continued_without_setup: number
  restore_snapshot_path: string | null
  created_at: number
  updated_at: number
  last_used_at: number
  deleted_at: number | null
}

export const WORKTREE_SETTINGS_SCHEMA = [
  'CREATE TABLE worktree_owned_roots (worktree_id TEXT PRIMARY KEY REFERENCES managed_worktrees(id) ON DELETE CASCADE, root_path TEXT NOT NULL)',
] as const

type BindingRow = {
  thread_id: string
  binding_id: string
  kind: TaskExecutionBinding['kind']
  project_id: string | null
  cwd: string
  worktree_id: string | null
  revision: number
  environment_revision: number
  created_at: number
  updated_at: number
}

type OperationRow = {
  operation_id: string
  worktree_id: string | null
  project_id: string
  kind: WorktreeOperationKind
  request_hash: string
  step: string
  status: WorktreeOperation['status']
  revision: number
  error_code: string | null
  warnings: string
  created_at: number
  updated_at: number
  completed_at: number | null
}

const worktreeFromRow = (row: WorktreeRow): ManagedWorktree => ({
  id: row.id,
  projectId: row.project_id,
  repositoryRoot: row.repository_root,
  path: row.path,
  status: row.status,
  branchName: row.branch_name,
  baseCommit: row.base_commit,
  headCommit: row.head_commit,
  permanent: row.permanent === 1,
  pinned: row.pinned === 1,
  boundOnce: row.bound_once === 1,
  setupStatus: row.setup_status,
  environmentRevision: row.environment_revision,
  continuedWithoutSetup: row.continued_without_setup === 1,
  restoreSnapshotPath: row.restore_snapshot_path,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastUsedAt: row.last_used_at,
  deletedAt: row.deleted_at,
})

const bindingFromRow = (row: BindingRow): TaskExecutionBinding => ({
  threadId: row.thread_id,
  bindingId: row.binding_id,
  kind: row.kind,
  projectId: row.project_id,
  cwd: row.cwd,
  worktreeId: row.worktree_id,
  revision: row.revision,
  environmentRevision: row.environment_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const operationFromRow = (row: OperationRow): WorktreeOperation => ({
  operationId: row.operation_id,
  worktreeId: row.worktree_id,
  projectId: row.project_id,
  kind: row.kind,
  requestHash: row.request_hash,
  step: row.step,
  status: row.status,
  revision: row.revision,
  errorCode: row.error_code,
  warnings: JSON.parse(row.warnings) as string[],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
})

/** SQL boundary for managed worktrees and per-thread execution bindings. */
export class WorktreeRepository {
  constructor(readonly sqlite: Database) {}

  setOwnedRoot(worktreeId: string, root: string) {
    if (!this.settingsAvailable()) return
    this.sqlite
      .query('INSERT INTO worktree_owned_roots (worktree_id, root_path) VALUES (?, ?)')
      .run(worktreeId, root)
  }

  ownedRoot(worktreeId: string): string | null {
    if (!this.settingsAvailable()) return null
    const row = this.sqlite
      .query('SELECT root_path FROM worktree_owned_roots WHERE worktree_id = ?')
      .get(worktreeId) as { root_path: string } | null
    return row?.root_path ?? null
  }
  settingsAvailable() {
    return Boolean(
      this.sqlite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worktree_owned_roots'")
        .get(),
    )
  }

  conversations(worktreeId: string) {
    return this.sqlite
      .query(
        'SELECT thread.id, thread.title, thread.archived_at FROM thread_execution_bindings binding JOIN threads thread ON thread.id = binding.thread_id WHERE binding.worktree_id = ? ORDER BY thread.updated_at DESC',
      )
      .all(worktreeId) as Array<{ id: string; title: string; archived_at: number | null }>
  }

  insertWorktree(value: ManagedWorktree) {
    this.sqlite
      .query(
        `
      INSERT INTO managed_worktrees (
        id, project_id, repository_root, path, status, branch_name, base_commit, head_commit,
        permanent, pinned, bound_once, setup_status, environment_revision, continued_without_setup, restore_snapshot_path,
        created_at, updated_at, last_used_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        value.id,
        value.projectId,
        value.repositoryRoot,
        value.path,
        value.status,
        value.branchName,
        value.baseCommit,
        value.headCommit,
        Number(value.permanent),
        Number(value.pinned),
        Number(value.boundOnce),
        value.setupStatus,
        value.environmentRevision,
        Number(value.continuedWithoutSetup),
        value.restoreSnapshotPath,
        value.createdAt,
        value.updatedAt,
        value.lastUsedAt,
        value.deletedAt,
      )
    return value
  }

  readWorktree(id: string) {
    const row = this.sqlite
      .query('SELECT * FROM managed_worktrees WHERE id = ?')
      .get(id) as WorktreeRow | null
    return row ? worktreeFromRow(row) : null
  }

  listWorktrees(projectId?: string) {
    const rows = projectId
      ? this.sqlite
          .query(
            'SELECT * FROM managed_worktrees WHERE project_id = ? ORDER BY last_used_at DESC, id',
          )
          .all(projectId)
      : this.sqlite.query('SELECT * FROM managed_worktrees ORDER BY last_used_at DESC, id').all()
    return (rows as WorktreeRow[]).map(worktreeFromRow)
  }

  updateWorktree(
    id: string,
    patch: Partial<
      Pick<
        ManagedWorktree,
        | 'path'
        | 'status'
        | 'headCommit'
        | 'permanent'
        | 'pinned'
        | 'setupStatus'
        | 'boundOnce'
        | 'environmentRevision'
        | 'continuedWithoutSetup'
        | 'restoreSnapshotPath'
        | 'updatedAt'
        | 'lastUsedAt'
        | 'deletedAt'
      >
    >,
  ) {
    const current = this.readWorktree(id)
    if (!current) return null
    const next = { ...current, ...patch }
    this.sqlite
      .query(
        `
      UPDATE managed_worktrees SET path = ?, status = ?, head_commit = ?, permanent = ?, pinned = ?,
        bound_once = ?, setup_status = ?, environment_revision = ?, continued_without_setup = ?, restore_snapshot_path = ?, updated_at = ?,
        last_used_at = ?, deleted_at = ? WHERE id = ?
    `,
      )
      .run(
        next.path,
        next.status,
        next.headCommit,
        Number(next.permanent),
        Number(next.pinned),
        Number(next.boundOnce),
        next.setupStatus,
        next.environmentRevision,
        Number(next.continuedWithoutSetup),
        next.restoreSnapshotPath,
        next.updatedAt,
        next.lastUsedAt,
        next.deletedAt,
        id,
      )
    return next
  }

  updateWorktreeCas(
    id: string,
    expectedUpdatedAt: number,
    patch: Partial<
      Pick<
        ManagedWorktree,
        | 'path'
        | 'status'
        | 'headCommit'
        | 'permanent'
        | 'pinned'
        | 'setupStatus'
        | 'boundOnce'
        | 'environmentRevision'
        | 'continuedWithoutSetup'
        | 'restoreSnapshotPath'
        | 'updatedAt'
        | 'lastUsedAt'
        | 'deletedAt'
      >
    >,
  ) {
    const current = this.readWorktree(id)
    if (!current || current.updatedAt !== expectedUpdatedAt) return null
    const next = { ...current, ...patch }
    const changed = this.sqlite
      .query(
        `
      UPDATE managed_worktrees SET path = ?, status = ?, head_commit = ?, permanent = ?, pinned = ?,
        bound_once = ?, setup_status = ?, environment_revision = ?, continued_without_setup = ?, restore_snapshot_path = ?, updated_at = ?,
        last_used_at = ?, deleted_at = ? WHERE id = ? AND updated_at = ?
    `,
      )
      .run(
        next.path,
        next.status,
        next.headCommit,
        Number(next.permanent),
        Number(next.pinned),
        Number(next.boundOnce),
        next.setupStatus,
        next.environmentRevision,
        Number(next.continuedWithoutSetup),
        next.restoreSnapshotPath,
        next.updatedAt,
        next.lastUsedAt,
        next.deletedAt,
        id,
        expectedUpdatedAt,
      )
    return changed.changes === 1 ? next : null
  }

  markBound(worktreeId: string, timestamp: number) {
    this.sqlite
      .query(
        'UPDATE managed_worktrees SET bound_once = 1, last_used_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(timestamp, timestamp, worktreeId)
  }

  binding(threadId: string) {
    const row = this.sqlite
      .query('SELECT * FROM thread_execution_bindings WHERE thread_id = ?')
      .get(threadId) as BindingRow | null
    return row ? bindingFromRow(row) : null
  }

  bind(value: TaskExecutionBinding) {
    this.sqlite
      .query(
        `
      INSERT INTO thread_execution_bindings (
        thread_id, binding_id, kind, project_id, cwd, worktree_id, revision,
        environment_revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        binding_id = excluded.binding_id, kind = excluded.kind, project_id = excluded.project_id,
        cwd = excluded.cwd, worktree_id = excluded.worktree_id, revision = excluded.revision,
        environment_revision = excluded.environment_revision, updated_at = excluded.updated_at
    `,
      )
      .run(
        value.threadId,
        value.bindingId,
        value.kind,
        value.projectId,
        value.cwd,
        value.worktreeId,
        value.revision,
        value.environmentRevision,
        value.createdAt,
        value.updatedAt,
      )
    return value
  }

  bumpEnvironmentRevision(threadId: string, revision: number, updatedAt: number) {
    this.sqlite
      .query(
        `
      UPDATE thread_execution_bindings
      SET environment_revision = ?, revision = revision + 1, updated_at = ?
      WHERE thread_id = ?
    `,
      )
      .run(revision, updatedAt, threadId)
    return this.binding(threadId)
  }

  insertOperation(value: WorktreeOperation) {
    this.sqlite
      .query(
        `
      INSERT INTO worktree_operations (
        operation_id, worktree_id, project_id, kind, request_hash, step, status, revision,
        error_code, warnings, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        value.operationId,
        value.worktreeId,
        value.projectId,
        value.kind,
        value.requestHash,
        value.step,
        value.status,
        value.revision,
        value.errorCode,
        JSON.stringify(value.warnings),
        value.createdAt,
        value.updatedAt,
        value.completedAt,
      )
    return value
  }

  operation(operationId: string) {
    const row = this.sqlite
      .query('SELECT * FROM worktree_operations WHERE operation_id = ?')
      .get(operationId) as OperationRow | null
    return row ? operationFromRow(row) : null
  }

  updateOperation(
    operationId: string,
    patch: Partial<
      Pick<
        WorktreeOperation,
        'worktreeId' | 'step' | 'status' | 'errorCode' | 'warnings' | 'updatedAt' | 'completedAt'
      >
    >,
  ) {
    const current = this.operation(operationId)
    if (!current) return null
    const next = { ...current, ...patch, revision: current.revision + 1 }
    const changed = this.sqlite
      .query(
        `
      UPDATE worktree_operations SET worktree_id = ?, step = ?, status = ?, revision = ?, error_code = ?,
        warnings = ?, updated_at = ?, completed_at = ? WHERE operation_id = ? AND revision = ?
    `,
      )
      .run(
        next.worktreeId,
        next.step,
        next.status,
        next.revision,
        next.errorCode,
        JSON.stringify(next.warnings),
        next.updatedAt,
        next.completedAt,
        operationId,
        current.revision,
      )
    return changed.changes === 1 ? next : null
  }

  claimOperation(
    operationId: string,
    worktreeId: string,
    updatedAt: number,
  ): { status: 'claimed'; operation: WorktreeOperation } | { status: 'busy' | 'invalid' } {
    const claim = this.sqlite.transaction(() => {
      const current = this.operation(operationId)
      if (!current || current.worktreeId !== worktreeId || current.status !== 'pending') {
        return { status: 'invalid' as const }
      }
      const active = this.sqlite
        .query(
          `
        SELECT operation_id FROM worktree_operations
        WHERE worktree_id = ? AND operation_id <> ? AND status = 'running'
        LIMIT 1
      `,
        )
        .get(worktreeId, operationId)
      if (active) return { status: 'busy' as const }
      const pendingWinner = this.sqlite
        .query(
          `
        SELECT operation_id FROM worktree_operations
        WHERE worktree_id = ? AND status = 'pending'
        ORDER BY created_at ASC, operation_id ASC
        LIMIT 1
      `,
        )
        .get(worktreeId) as { operation_id: string } | null
      if (pendingWinner?.operation_id !== operationId) return { status: 'busy' as const }
      const nextRevision = current.revision + 1
      const changed = this.sqlite
        .query(
          `
        UPDATE worktree_operations
        SET status = 'running', step = 'claimed', revision = ?, updated_at = ?
        WHERE operation_id = ? AND worktree_id = ? AND status = 'pending' AND revision = ?
      `,
        )
        .run(nextRevision, updatedAt, operationId, worktreeId, current.revision)
      if (changed.changes !== 1) return { status: 'invalid' as const }
      return {
        status: 'claimed' as const,
        operation: {
          ...current,
          status: 'running' as const,
          step: 'claimed',
          revision: nextRevision,
          updatedAt,
        },
      }
    })
    return claim()
  }

  cleanupCandidates(projectId: string, limit: number) {
    const rows = this.sqlite
      .query(
        `
      SELECT worktree.* FROM managed_worktrees AS worktree
      WHERE worktree.project_id = ? AND worktree.status IN ('ready', 'ready-with-setup-error')
        AND worktree.permanent = 0 AND worktree.pinned = 0 AND worktree.bound_once = 1
        AND NOT EXISTS (
          SELECT 1 FROM thread_execution_bindings binding
          JOIN threads thread ON thread.id = binding.thread_id
          WHERE binding.worktree_id = worktree.id AND thread.archived_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM worktree_operations operation
          WHERE operation.worktree_id = worktree.id AND operation.status IN ('pending', 'running')
        )
      ORDER BY worktree.last_used_at ASC, worktree.created_at ASC LIMIT ?
    `,
      )
      .all(projectId, limit) as WorktreeRow[]
    return rows.map(worktreeFromRow)
  }

  hasUnarchivedBinding(worktreeId: string) {
    return Boolean(
      this.sqlite
        .query(
          `
      SELECT 1 FROM thread_execution_bindings AS binding
      JOIN threads AS thread ON thread.id = binding.thread_id
      WHERE binding.worktree_id = ? AND thread.archived_at IS NULL
      LIMIT 1
    `,
        )
        .get(worktreeId),
    )
  }

  rebindWorktreePath(worktreeId: string, cwd: string, updatedAt: number) {
    this.sqlite
      .query(
        `
      UPDATE thread_execution_bindings
      SET cwd = ?, revision = revision + 1, updated_at = ?
      WHERE worktree_id = ?
    `,
      )
      .run(cwd, updatedAt, worktreeId)
  }
}
