import { statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import type { ProjectExecutionEnvironment } from '@pidex/shared/thread'
import type { ModelRef } from '../../Domain'
import { AgentError } from '../../Domain'
import { CredentialRepositoryDatabase } from './CredentialRepository'
import { now, parse, stringify } from './RepositoryCore'

export type ProjectModelSettings = {
  defaultModel: ModelRef | null
  instructions: string
  executionEnvironment: ProjectExecutionEnvironment
  version: number
}

export type StoredProjectFolder = {
  id: string
  name: string
  path: string
  role: 'primary' | 'secondary'
  availability: 'available' | 'missing'
  order: number
  createdAt: number
  updatedAt: number
}

export type StoredProject = {
  id: string
  name: string
  primaryFolderId: string
  folders: StoredProjectFolder[]
  removedAt: number | null
  /** Internal compatibility alias for the primary folder. */
  rootPath: string
  lastOpenedAt: number
  createdAt: number
  updatedAt: number
  settings: ProjectModelSettings
}

type ProjectRow = {
  id: string
  name: string
  removed_at: number | null
  last_opened_at: number
  created_at: number
  updated_at: number
}

type FolderRow = {
  id: string
  project_id: string
  path: string
  role: 'primary' | 'secondary'
  sort_order: number
  created_at: number
  updated_at: number
}

type SettingsRow = {
  project_id: string
  default_model: string | null
  instructions: string
  execution_environment: string | null
  version: number
}

const canonicalPath = (value: string) => resolve(value)
export const projectPathKey = (value: string) => {
  const normalized = canonicalPath(value).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}
const pathContains = (parent: string, candidate: string) => {
  const nested = relative(parent, candidate)
  return nested === '' || (!nested.startsWith('..') && !isAbsolute(nested))
}
/** Project content revisions never repeat or move backwards under same-millisecond edits or clock skew. */
const nextProjectVersion = (previous: number) => Math.max(now(), previous + 1)
const directoryAvailable = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export abstract class ProjectRepositoryDatabase extends CredentialRepositoryDatabase {
  projectMembershipAvailable(): boolean {
    return Boolean(
      this.sqlite
        .query(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thread_project_memberships'",
        )
        .get(),
    )
  }

  projectMembershipSql(alias: 't' = 't'): string {
    const available = this.projectMembershipAvailable()
    return available
      ? `CASE WHEN EXISTS (SELECT 1 FROM thread_project_memberships m WHERE m.thread_id = ${alias}.id) THEN (SELECT m.project_id FROM thread_project_memberships m WHERE m.thread_id = ${alias}.id) ELSE ${alias}.project_id END`
      : `${alias}.project_id`
  }

  projectMembership(threadID: string): string | null {
    const row = this.sqlite
      .query(`SELECT ${this.projectMembershipSql()} AS project_id FROM threads t WHERE t.id = ?`)
      .get(threadID) as { project_id: string | null } | null
    return row?.project_id ?? null
  }

  saveRemovalCheckpoint(operationID: string, result: unknown) {
    this.profileSqlite
      .query(
        'UPDATE project_operations SET result = ?, updated_at = ? WHERE operation_id = ? AND status = ?',
      )
      .run(stringify(result), now(), operationID, 'pending')
  }

  setProjectMembership(
    threadID: string,
    projectID: string | null,
    removalOperationID: string | null = null,
  ) {
    if (projectID) this.requireProject(projectID)
    this.sqlite
      .query(
        `INSERT INTO thread_project_memberships (thread_id, project_id, removal_operation_id, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET project_id = excluded.project_id,
      removal_operation_id = excluded.removal_operation_id, updated_at = excluded.updated_at`,
      )
      .run(threadID, projectID, removalOperationID, now())
    return this.insertEvent(threadID, null, 'thread/updated', {
      threadId: threadID,
      patch: {},
      updatedAt: now(),
    })
  }

  detachProjectThreads(projectID: string, operationID: string) {
    return this.transaction(() => {
      const rows = this.sqlite
        .query(
          `SELECT t.id FROM threads t LEFT JOIN thread_project_memberships m ON m.thread_id = t.id
        WHERE CASE WHEN m.thread_id IS NULL THEN t.project_id ELSE m.project_id END = ?`,
        )
        .all(projectID) as Array<{ id: string }>
      return rows.map((row) => this.setProjectMembership(row.id, null, operationID))
    })
  }

  restoreProjectThreads(projectID: string, operationID: string) {
    return this.transaction(() => {
      const rows = this.sqlite
        .query(
          'SELECT thread_id FROM thread_project_memberships WHERE project_id IS NULL AND removal_operation_id = ?',
        )
        .all(operationID) as Array<{ thread_id: string }>
      return rows.map((row) => this.setProjectMembership(row.thread_id, projectID))
    })
  }

  editProject(input: {
    projectID: string
    name: string
    paths: string[]
    expectedVersion: number
  }) {
    return this.profileSqlite.transaction(() => {
      const project = this.requireProject(input.projectID)
      if (project.updatedAt !== input.expectedVersion)
        throw new AgentError('VERSION_CONFLICT', '项目已被其他操作更新', 409)
      if (!input.name.trim()) throw new AgentError('INVALID_REQUEST', '项目名称不能为空', 400)
      for (const [index, path] of input.paths.entries()) {
        if (
          input.paths
            .slice(index + 1)
            .some((other) => pathContains(path, other) || pathContains(other, path))
        )
          throw new AgentError('INVALID_REQUEST', '项目目录不能互相包含', 400)
      }
      const keys = new Set(input.paths.map(projectPathKey))
      // An edit always rewrites the folder set, so it always advances the revision.
      const timestamp = nextProjectVersion(project.updatedAt)
      // Keep folder identities (and their file references) for paths that remain.
      for (const folder of project.folders) {
        if (keys.has(projectPathKey(folder.path))) continue
        this.profileSqlite
          .query(
            "DELETE FROM project_sources WHERE project_id = ? AND folder_id = ? AND storage_kind = 'workspace-file'",
          )
          .run(input.projectID, folder.id)
        this.profileSqlite
          .query('DELETE FROM project_folders WHERE id = ? AND project_id = ?')
          .run(folder.id, input.projectID)
      }
      this.profileSqlite
        .query("UPDATE project_folders SET role = 'secondary' WHERE project_id = ?")
        .run(input.projectID)
      input.paths.forEach((path, order) => {
        const retained = project.folders.find(
          (folder) => projectPathKey(folder.path) === projectPathKey(path),
        )
        if (retained)
          this.profileSqlite
            .query(
              'UPDATE project_folders SET role = ?, sort_order = ?, updated_at = ? WHERE id = ?',
            )
            .run(order === 0 ? 'primary' : 'secondary', order, timestamp, retained.id)
        else
          this.profileSqlite
            .query(
              'INSERT INTO project_folders (id, project_id, path, path_key, role, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              crypto.randomUUID(),
              input.projectID,
              path,
              projectPathKey(path),
              order === 0 ? 'primary' : 'secondary',
              order,
              timestamp,
              timestamp,
            )
      })
      const edited = this.profileSqlite
        .query(
          `
      UPDATE projects SET name = ?, updated_at = ?
      WHERE id = ? AND updated_at = ? AND removed_at IS NULL
    `,
        )
        .run(input.name.trim(), timestamp, input.projectID, input.expectedVersion).changes
      if (edited === 0) throw new AgentError('CONFLICT', '项目已被其他操作更新', 409)
      return this.getProject(input.projectID)!
    })()
  }

  hideProject(projectID: string, removedAt: number) {
    this.profileSqlite
      .query('UPDATE projects SET removed_at = ?, updated_at = ? WHERE id = ?')
      .run(removedAt, removedAt, projectID)
  }

  restoreProjectRecord(projectID: string) {
    this.profileSqlite
      .query(
        'UPDATE projects SET removed_at = NULL, updated_at = MAX(?, updated_at + 1) WHERE id = ?',
      )
      .run(now(), projectID)
    return this.requireProject(projectID)
  }

  private mapProjects(rows: ProjectRow[]): StoredProject[] {
    if (rows.length === 0) return []
    // ponytail: one IN(...) per table, bounded by SQLite's parameter limit
    // (~32k). Page the id list here if a single call ever maps more projects.
    const placeholders = rows.map(() => '?').join(', ')
    const ids = rows.map((row) => row.id)
    const foldersByProject = new Map<string, StoredProjectFolder[]>()
    // One probe per normalized path: the same directory can belong to several projects.
    const availability = new Map<string, boolean>()
    for (const row of this.profileSqlite
      .query(
        `
      SELECT id, project_id, path, role, sort_order, created_at, updated_at
      FROM project_folders
      WHERE project_id IN (${placeholders})
      ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, sort_order, created_at, id
    `,
      )
      .all(...ids) as FolderRow[]) {
      const key = projectPathKey(row.path)
      let available = availability.get(key)
      if (available === undefined) {
        available = directoryAvailable(row.path)
        availability.set(key, available)
      }
      const folders = foldersByProject.get(row.project_id) ?? []
      folders.push({
        id: row.id,
        name: basename(row.path) || row.path,
        path: row.path,
        role: row.role,
        availability: available ? 'available' : 'missing',
        order: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
      foldersByProject.set(row.project_id, folders)
    }
    const settingsByProject = new Map<string, ProjectModelSettings>()
    for (const row of this.profileSqlite
      .query(
        `
      SELECT project_id, default_model, instructions, execution_environment, version
      FROM project_settings
      WHERE project_id IN (${placeholders})
    `,
      )
      .all(...ids) as SettingsRow[]) {
      settingsByProject.set(row.project_id, this.mapSettings(row))
    }
    return rows.map((row): StoredProject => {
      const folders = foldersByProject.get(row.id) ?? []
      const primary = folders.find((folder) => folder.role === 'primary')
      return {
        id: row.id,
        name: row.name,
        primaryFolderId: primary?.id ?? '',
        folders,
        removedAt: row.removed_at,
        rootPath: primary?.path ?? '',
        lastOpenedAt: row.last_opened_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        settings: settingsByProject.get(row.id) ?? this.mapSettings(null),
      }
    })
  }

  protected requireProject(projectID: string) {
    const project = this.getProject(projectID)
    if (!project) throw new AgentError('PROJECT_NOT_FOUND', '项目不存在', 404)
    if (project.removedAt !== null) throw new AgentError('PROJECT_REMOVED', '项目已被移除', 409)
    return project
  }

  requireProjectForRemoval(projectID: string) {
    return this.requireProject(projectID)
  }

  createProject(input: { id?: string; rootPath?: string; primaryPath?: string; name?: string }) {
    const primaryPath = canonicalPath(input.primaryPath ?? input.rootPath ?? '')
    const timestamp = now()
    const id = input.id ?? crypto.randomUUID()
    const folderID = crypto.randomUUID()
    const name = input.name?.trim() || basename(primaryPath) || primaryPath
    this.profileSqlite.transaction(() => {
      this.profileSqlite
        .query(
          `
        INSERT INTO projects (id, name, removed_at, created_at, updated_at, last_opened_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `,
        )
        .run(id, name, timestamp, timestamp, timestamp)
      this.profileSqlite
        .query(
          `
        INSERT INTO project_folders (
          id, project_id, path, path_key, role, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'primary', 0, ?, ?)
      `,
        )
        .run(folderID, id, primaryPath, projectPathKey(primaryPath), timestamp, timestamp)
      this.profileSqlite
        .query(
          `
        INSERT INTO project_settings (
          project_id, default_model, instructions, version, updated_at
        ) VALUES (?, NULL, '', 1, ?)
      `,
        )
        .run(id, timestamp)
    })()
    return this.getProject(id)!
  }

  listProjects(input: { folderPath?: string; includeRemoved?: boolean } = {}) {
    const conditions: string[] = []
    const params: string[] = []
    if (!input.includeRemoved) conditions.push('p.removed_at IS NULL')
    if (input.folderPath) {
      conditions.push(
        'EXISTS (SELECT 1 FROM project_folders f WHERE f.project_id = p.id AND f.path_key = ?)',
      )
      params.push(projectPathKey(input.folderPath))
    }
    const rows = this.profileSqlite
      .query(
        `
      SELECT p.id, p.name, p.removed_at, p.last_opened_at, p.created_at, p.updated_at
      FROM projects p
      ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY p.last_opened_at DESC, p.created_at DESC, p.id
    `,
      )
      .all(...params) as ProjectRow[]
    return this.mapProjects(rows)
  }

  getProject(projectID: string) {
    const row = this.profileSqlite
      .query(
        `
      SELECT id, name, removed_at, last_opened_at, created_at, updated_at
      FROM projects WHERE id = ?
    `,
      )
      .get(projectID) as ProjectRow | null
    return row ? (this.mapProjects([row])[0] ?? null) : null
  }

  getProjectFolder(projectID: string, folderID: string) {
    return this.requireProject(projectID).folders.find((folder) => folder.id === folderID) ?? null
  }

  touchProject(projectID: string) {
    this.requireProject(projectID)
    // Opening a project only records recency; it must not invalidate pending edit versions.
    this.profileSqlite
      .query('UPDATE projects SET last_opened_at = ? WHERE id = ?')
      .run(now(), projectID)
    return this.getProject(projectID)!
  }

  updateProject(input: { projectID: string; name: string; expectedVersion: number }) {
    const project = this.requireProject(input.projectID)
    if (project.updatedAt !== input.expectedVersion) {
      throw new AgentError('CONFLICT', '项目已被其他操作更新', 409)
    }
    const name = input.name.trim()
    if (name === project.name) return project
    const timestamp = nextProjectVersion(project.updatedAt)
    const changed = this.profileSqlite
      .query(
        `
      UPDATE projects SET name = ?, updated_at = ?
      WHERE id = ? AND updated_at = ? AND removed_at IS NULL
    `,
      )
      .run(name, timestamp, input.projectID, input.expectedVersion).changes
    if (changed === 0) throw new AgentError('CONFLICT', '项目已被其他操作更新', 409)
    return this.getProject(input.projectID)!
  }

  private mapSettings(row: SettingsRow | null): ProjectModelSettings {
    return {
      defaultModel: row?.default_model ? parse<ModelRef>(row.default_model) : null,
      instructions: row?.instructions ?? '',
      // A store that predates the column reads as the automatic default.
      executionEnvironment: row?.execution_environment === 'local' ? 'local' : 'auto',
      version: row?.version ?? 1,
    }
  }

  getProjectSettings(projectID: string): ProjectModelSettings {
    const row = this.profileSqlite
      .query(
        `
      SELECT project_id, default_model, instructions, execution_environment, version
      FROM project_settings WHERE project_id = ?
    `,
      )
      .get(projectID) as SettingsRow | null
    return this.mapSettings(row)
  }

  saveProjectSettings(
    projectID: string,
    settings: {
      defaultModel: ModelRef | null
      instructions?: string
      executionEnvironment?: ProjectExecutionEnvironment
    },
    expectedVersion?: number,
  ) {
    this.requireProject(projectID)
    const current = this.getProjectSettings(projectID)
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new AgentError('PROJECT_SETTINGS_CONFLICT', '项目设置已被其他操作更新', 409)
    }
    const timestamp = now()
    const nextVersion = current.version + 1
    this.profileSqlite
      .query(
        `
      INSERT INTO project_settings (
        project_id, default_model, instructions, execution_environment, version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        default_model = excluded.default_model,
        instructions = excluded.instructions,
        execution_environment = excluded.execution_environment,
        version = excluded.version,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        projectID,
        settings.defaultModel ? stringify(settings.defaultModel) : null,
        settings.instructions ?? current.instructions,
        settings.executionEnvironment ?? current.executionEnvironment,
        nextVersion,
        timestamp,
      )
    return this.getProjectSettings(projectID)
  }

  addProjectFolder(projectID: string, path: string) {
    const project = this.requireProject(projectID)
    const canonical = canonicalPath(path)
    const key = projectPathKey(canonical)
    const duplicate = project.folders.find((folder) => projectPathKey(folder.path) === key)
    if (duplicate) return { project, changed: false }
    const overlaps = project.folders.some(
      (folder) => pathContains(folder.path, canonical) || pathContains(canonical, folder.path),
    )
    if (overlaps)
      throw new AgentError('PROJECT_FOLDER_OVERLAP', '同一项目中的目录不能互相包含', 409)
    const timestamp = nextProjectVersion(project.updatedAt)
    const sortOrder =
      project.folders.reduce((maximum, folder) => Math.max(maximum, folder.order), 0) + 1
    const result = this.profileSqlite
      .query(
        `
      INSERT INTO project_folders (
        id, project_id, path, path_key, role, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'secondary', ?, ?, ?)
      ON CONFLICT(project_id, path_key) DO NOTHING
    `,
      )
      .run(crypto.randomUUID(), projectID, canonical, key, sortOrder, timestamp, timestamp)
    if (result.changes > 0) {
      this.profileSqlite
        .query('UPDATE projects SET updated_at = ? WHERE id = ?')
        .run(timestamp, projectID)
    }
    return { project: this.getProject(projectID)!, changed: result.changes > 0 }
  }

  removeProjectFolder(projectID: string, folderID: string) {
    const project = this.requireProject(projectID)
    const folder = project.folders.find((entry) => entry.id === folderID)
    if (!folder) throw new AgentError('PROJECT_FOLDER_NOT_FOUND', '项目目录不存在', 404)
    if (folder.role === 'primary') {
      throw new AgentError('PROJECT_FOLDER_IN_USE', '请先将其他目录设为主目录', 409)
    }
    const inUse = (
      this.sqlite
        .query(
          `
      SELECT workspace_cwd FROM threads
      WHERE project_id = ? AND archived_at IS NULL AND workspace_cwd IS NOT NULL
    `,
        )
        .all(projectID) as Array<{ workspace_cwd: string }>
    ).some(({ workspace_cwd }) => pathContains(folder.path, workspace_cwd))
    if (inUse)
      throw new AgentError('PROJECT_FOLDER_IN_USE', '仍有未归档任务使用此目录或其子目录', 409)
    const timestamp = nextProjectVersion(project.updatedAt)
    const changes = this.profileSqlite
      .query("DELETE FROM project_folders WHERE project_id = ? AND id = ? AND role = 'secondary'")
      .run(projectID, folderID).changes
    if (changes > 0) {
      this.profileSqlite
        .query('UPDATE projects SET updated_at = ? WHERE id = ?')
        .run(timestamp, projectID)
    }
    return { project: this.getProject(projectID)!, changed: changes > 0 }
  }

  setPrimaryProjectFolder(projectID: string, folderID: string) {
    const project = this.requireProject(projectID)
    const folder = project.folders.find((entry) => entry.id === folderID)
    if (!folder) throw new AgentError('PROJECT_FOLDER_NOT_FOUND', '项目目录不存在', 404)
    if (folder.role === 'primary') return { project, changed: false }
    const timestamp = nextProjectVersion(project.updatedAt)
    this.profileSqlite.transaction(() => {
      this.profileSqlite
        .query(
          "UPDATE project_folders SET role = 'secondary', updated_at = ? WHERE project_id = ? AND role = 'primary'",
        )
        .run(timestamp, projectID)
      this.profileSqlite
        .query(
          "UPDATE project_folders SET role = 'primary', sort_order = 0, updated_at = ? WHERE project_id = ? AND id = ?",
        )
        .run(timestamp, projectID, folderID)
      this.profileSqlite
        .query('UPDATE projects SET updated_at = ? WHERE id = ?')
        .run(timestamp, projectID)
    })()
    return { project: this.getProject(projectID)!, changed: true }
  }

  removeProjectRecord(projectID: string, removedAt: number) {
    this.requireProject(projectID)
    this.profileSqlite.transaction(() => {
      this.profileSqlite.query('DELETE FROM project_sources WHERE project_id = ?').run(projectID)
      this.profileSqlite.query('DELETE FROM project_folders WHERE project_id = ?').run(projectID)
      this.profileSqlite
        .query(
          `
        UPDATE projects
        SET removed_at = ?, updated_at = ?
        WHERE id = ? AND removed_at IS NULL
      `,
        )
        .run(removedAt, removedAt, projectID)
    })()
  }

  resolveProjectModel(projectID: string, globalDefault: ModelRef | null) {
    return this.getProjectSettings(projectID).defaultModel ?? globalDefault
  }

  projectOperation(operationID: string) {
    const row = this.profileSqlite
      .query(
        `
      SELECT project_id, method, request_hash, status, result
      FROM project_operations WHERE operation_id = ?
    `,
      )
      .get(operationID) as {
      project_id: string | null
      method: string
      request_hash: string
      status: 'pending' | 'completed'
      result: string | null
    } | null
    return row
      ? {
          projectID: row.project_id,
          method: row.method,
          requestHash: row.request_hash,
          status: row.status,
          result: row.result ? parse<unknown>(row.result) : null,
        }
      : null
  }

  beginProjectOperation(input: {
    operationID: string
    method: string
    requestHash: string
    projectID?: string
  }) {
    const existing = this.projectOperation(input.operationID)
    if (existing) {
      if (existing.method !== input.method || existing.requestHash !== input.requestHash) {
        throw new AgentError('CONFLICT', 'operationId 已用于不同的项目操作', 409)
      }
      return existing
    }
    this.profileSqlite
      .query(
        `
      INSERT INTO project_operations (
        operation_id, project_id, method, request_hash, status, result, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?)
    `,
      )
      .run(
        input.operationID,
        input.projectID ?? null,
        input.method,
        input.requestHash,
        now(),
        now(),
      )
    return this.projectOperation(input.operationID)!
  }

  completeProjectOperation(operationID: string, result: unknown) {
    this.profileSqlite
      .query(
        `
      UPDATE project_operations
      SET status = 'completed', result = ?, updated_at = ?
      WHERE operation_id = ?
    `,
      )
      .run(stringify(result), now(), operationID)
    return result
  }
}

export type ProjectRepository = ProjectRepositoryDatabase
export const projectRepository = (database: ProjectRepositoryDatabase): ProjectRepository =>
  database
