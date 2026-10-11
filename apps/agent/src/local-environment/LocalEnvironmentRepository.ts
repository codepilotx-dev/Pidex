import type { Database } from 'bun:sqlite'
import { relative, resolve, isAbsolute } from 'node:path'

export const LOCAL_ENVIRONMENT_SELECTION_SCHEMA = [
  'CREATE TABLE local_environment_selections (project_id TEXT PRIMARY KEY, scope_root TEXT NOT NULL, config_path TEXT NOT NULL)',
  'CREATE TABLE worktree_environment_snapshots (worktree_id TEXT PRIMARY KEY REFERENCES managed_worktrees(id) ON DELETE CASCADE, project_id TEXT NOT NULL, source_path TEXT NOT NULL, snapshot_path TEXT NOT NULL, revision TEXT NOT NULL, trust_identity TEXT NOT NULL)',
] as const

export class LocalEnvironmentRepository {
  constructor(private readonly sqlite: Database) {}
  available() {
    return (
      Boolean(
        this.sqlite
          .query(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_environment_selections'",
          )
          .get(),
      ) &&
      Boolean(
        this.sqlite
          .query(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worktree_environment_snapshots'",
          )
          .get(),
      )
    )
  }
  select(projectId: string, scopeRoot: string, configPath: string) {
    this.sqlite
      .query(
        'INSERT INTO local_environment_selections (project_id, scope_root, config_path) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET scope_root = excluded.scope_root, config_path = excluded.config_path',
      )
      .run(projectId, scopeRoot, configPath)
  }
  selection(projectId: string) {
    return this.sqlite
      .query('SELECT config_path FROM local_environment_selections WHERE project_id = ?')
      .get(projectId) as { config_path: string } | null
  }
  selectedForCwd(cwd: string) {
    if (!this.available()) return null
    const rows = this.sqlite
      .query('SELECT scope_root, config_path FROM local_environment_selections')
      .all() as Array<{ scope_root: string; config_path: string }>
    return (
      rows
        .filter((row) => within(row.scope_root, cwd))
        .sort((a, b) => b.scope_root.length - a.scope_root.length)[0] ?? null
    )
  }
  freeze(
    worktreeId: string,
    projectId: string,
    sourcePath: string,
    snapshotPath: string,
    revision: string,
    trustIdentity: string,
  ) {
    this.sqlite
      .query(
        'INSERT INTO worktree_environment_snapshots (worktree_id, project_id, source_path, snapshot_path, revision, trust_identity) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(worktree_id) DO NOTHING',
      )
      .run(worktreeId, projectId, sourcePath, snapshotPath, revision, trustIdentity)
  }
  snapshotForCwd(cwd: string) {
    if (!this.available()) return null
    const rows = this.sqlite
      .query(
        'SELECT snapshot.project_id, snapshot.source_path, snapshot.snapshot_path, snapshot.revision, snapshot.trust_identity, worktree.path FROM worktree_environment_snapshots snapshot JOIN managed_worktrees worktree ON worktree.id = snapshot.worktree_id WHERE worktree.deleted_at IS NULL',
      )
      .all() as Array<{
      source_path: string
      project_id: string
      snapshot_path: string
      revision: string
      trust_identity: string
      path: string
    }>
    return rows.find((row) => within(row.path, cwd)) ?? null
  }
  snapshot(worktreeId: string) {
    return this.sqlite
      .query('SELECT 1 FROM worktree_environment_snapshots WHERE worktree_id = ?')
      .get(worktreeId)
  }
  renameSource(previous: string, next: string) {
    this.sqlite.transaction(() => {
      this.sqlite
        .query('UPDATE local_environment_selections SET config_path = ? WHERE config_path = ?')
        .run(next, previous)
      this.sqlite
        .query('UPDATE worktree_environment_snapshots SET source_path = ? WHERE source_path = ?')
        .run(next, previous)
    })()
  }
  referenced(configPath: string) {
    return Boolean(
      this.sqlite
        .query(
          'SELECT 1 FROM local_environment_selections WHERE config_path = ? UNION ALL SELECT 1 FROM worktree_environment_snapshots snapshot JOIN managed_worktrees worktree ON worktree.id = snapshot.worktree_id WHERE snapshot.source_path = ? AND worktree.deleted_at IS NULL LIMIT 1',
        )
        .get(configPath, configPath),
    )
  }
}

function within(root: string, path: string) {
  const value = relative(resolve(root), resolve(path))
  return (
    value === '' ||
    (!isAbsolute(value) && value !== '..' && !value.startsWith('..\\') && !value.startsWith('../'))
  )
}
