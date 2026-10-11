import { ThreadProjection } from '../src/transport/ThreadProjection'
import { ProjectService } from '../src/project/ProjectService'
import { ThreadWorkspaceResolver } from '../src/workspace/ThreadWorkspaceResolver'
import { ManagedProjectlessWorkspaceService } from '../src/workspace/ManagedProjectlessWorkspaceService'
import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import {
  backfillProjectThreadWorkspaces,
  initializeSchema,
} from '../src/storage/database/SchemaInitializer'
import { PROFILE_SCHEMA_VERSION, SCHEMA_VERSION } from '../src/storage/database/Schema'

const temporaryPaths: string[] = []
afterEach(async () => {
  await removeFixturePaths(temporaryPaths.splice(0))
})

const legacyMemoryKey = (path: string) =>
  createHash('sha256')
    .update(path.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('en-US'))
    .digest('hex')

describe('项目共享上下文存储', () => {
  test('项目编辑原子保存，清空与移除保留聊天目录，撤销不覆盖后来归属', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-project-edit-'))
    temporaryPaths.push(root)
    const original = join(root, 'original')
    const replacement = join(root, 'replacement')
    await Promise.all([mkdir(original), mkdir(replacement)])
    const db = new AgentDatabase(join(root, 'history.sqlite'))
    try {
      const service = new ProjectService(db)
      const project = db.createProject({ primaryPath: original, name: 'Original' })
      const thread = db.createThread({ workspace: { kind: 'project', projectID: project.id } })
      const other = db.createProject({ primaryPath: replacement, name: 'Other' })
      await expect(
        service.edit({
          projectID: project.id,
          name: 'Changed',
          paths: [replacement],
          expectedVersion: project.updatedAt + 1,
          operationID: crypto.randomUUID(),
        }),
      ).rejects.toThrow('其他操作')
      expect(db.getProject(project.id)?.folders[0]?.path).toBe(resolve(original))
      const edited = await service.edit({
        projectID: project.id,
        name: 'Empty',
        paths: [],
        expectedVersion: project.updatedAt,
        operationID: crypto.randomUUID(),
      })
      expect(edited.project.folders).toEqual([])
      expect(edited.project.primaryFolderId).toBe('')
      const resolver = new ThreadWorkspaceResolver(db, {} as ManagedProjectlessWorkspaceService)
      expect((await resolver.resolve(thread.id)).cwd).toBe(resolve(original))
      const projection = new ThreadProjection(db)
      expect(projection.list({ projectID: project.id, limit: 10 }).map((item) => item.id)).toEqual([
        thread.id,
      ])
      const operationID = crypto.randomUUID()
      const removed = await service.remove({ projectID: project.id, operationID })
      expect(removed.archivedThreadCount).toBe(0)
      expect(db.projectMembership(thread.id)).toBeNull()
      expect(projection.list({ projectID: project.id, limit: 10 })).toEqual([])
      expect(
        db.sqlite.query('SELECT archived_at FROM threads WHERE id = ?').get(thread.id),
      ).toEqual({ archived_at: null })
      expect((await resolver.resolve(thread.id)).cwd).toBe(resolve(original))
      expect(await service.remove({ projectID: project.id, operationID })).toEqual(removed)
      db.transaction(() => db.setProjectMembership(thread.id, other.id))
      const restored = await service.restore({
        projectID: project.id,
        removalOperationID: operationID,
        operationID: crypto.randomUUID(),
      })
      expect(restored.project.removedAt).toBeNull()
      expect(db.projectMembership(thread.id)).toBe(other.id)
      const second = await service.remove({
        projectID: project.id,
        operationID: crypto.randomUUID(),
      })
      db.profileSqlite
        .query('UPDATE project_operations SET result = ? WHERE operation_id = ?')
        .run(JSON.stringify({ ...second, undoExpiresAt: 1 }), second.removalOperationId!)
      await expect(
        service.restore({
          projectID: project.id,
          removalOperationID: second.removalOperationId!,
          operationID: crypto.randomUUID(),
        }),
      ).rejects.toThrow('过期')
    } finally {
      db.close()
    }
  })

  test('目录添加幂等、主目录唯一且同一路径可以属于不同项目', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-project-folders-'))
    temporaryPaths.push(root)
    const primary = join(root, 'primary')
    const secondary = join(root, 'secondary')
    const nested = join(primary, 'nested')
    await Promise.all([mkdir(primary), mkdir(secondary)])
    await mkdir(nested)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))

    const first = db.createProject({ rootPath: primary, name: 'First' })
    expect(first.primaryFolderId).not.toBe('')
    expect(first.folders.map((folder) => folder.role)).toEqual(['primary'])

    const added = db.addProjectFolder(first.id, secondary)
    expect(added.changed).toBe(true)
    expect(db.addProjectFolder(first.id, secondary).changed).toBe(false)
    expect(() => db.addProjectFolder(first.id, nested)).toThrow('不能互相包含')

    const secondaryFolder = added.project.folders.find(
      (folder) => folder.path === resolve(secondary),
    )!
    const switched = db.setPrimaryProjectFolder(first.id, secondaryFolder.id)
    expect(switched.changed).toBe(true)
    expect(switched.project.primaryFolderId).toBe(secondaryFolder.id)
    expect(switched.project.folders.filter((folder) => folder.role === 'primary')).toHaveLength(1)

    const second = db.createProject({ rootPath: secondary, name: 'Second' })
    expect(second.id).not.toBe(first.id)
    expect(
      db
        .listProjects({ folderPath: secondary })
        .map((project) => project.id)
        .sort(),
    ).toEqual([first.id, second.id].sort())

    const thread = db.createThread({
      title: 'Project thread',
      workspace: { kind: 'project', projectID: first.id },
    })
    expect(thread.workspace).toMatchObject({
      kind: 'project',
      cwd: resolve(secondary),
      instructionSources: [],
    })
    if (thread.workspace?.kind !== 'project') throw new Error('expected project workspace')
    const originalCwd = thread.workspace?.cwd
    const refreshed = db.refreshThreadProjectContext({
      threadID: thread.id,
      runtimeWorkspaceRoots: switched.project.folders.map(({ id: folderId, path, role }) => ({
        folderId,
        path,
        role,
      })),
      instructionSources: [join(secondary, 'AGENTS.md')],
    })
    expect(refreshed?.cwd).toBe(originalCwd)
    expect(refreshed?.kind).toBe('project')
    if (refreshed?.kind !== 'project') throw new Error('Expected a project workspace')
    expect(refreshed.instructionSources).toEqual([join(secondary, 'AGENTS.md')])
    db.close()
  })

  test('Profile v2 与 History v20 前向迁移保留项目、记忆和任务 cwd', () => {
    const rootPath = resolve('F:\\legacy-project')
    const oldKey = legacyMemoryKey(rootPath)
    const profile = new Database(':memory:')
    profile.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_opened_at INTEGER NOT NULL
      );
      CREATE TABLE project_settings (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        default_model TEXT, updated_at INTEGER NOT NULL
      );
      CREATE TABLE memory_entries (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_key TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL, source_thread_id TEXT, content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(scope, project_key, content_hash)
      );
      CREATE INDEX projects_last_opened ON projects(last_opened_at DESC);
      INSERT INTO projects VALUES ('project:legacy', 'Legacy', '${rootPath.replaceAll("'", "''")}', 1, 2, 3);
      INSERT INTO project_settings VALUES ('project:legacy', NULL, 2);
      INSERT INTO memory_entries VALUES (
        'memory:legacy', 'project', '${oldKey}', 'remember me', NULL, 'content-hash', 1, 2
      );
      PRAGMA user_version = 2;
    `)

    initializeSchema(profile, 'profile')
    expect(profile.query('PRAGMA user_version').get()).toEqual({
      user_version: PROFILE_SCHEMA_VERSION,
    })
    expect(
      (profile.query('PRAGMA table_info(projects)').all() as Array<{ name: string }>).some(
        (column) => column.name === 'root_path',
      ),
    ).toBe(false)
    const folder = profile
      .query(
        `
      SELECT project_id, path, role FROM project_folders WHERE project_id = 'project:legacy'
    `,
      )
      .get() as { project_id: string; path: string; role: string }
    expect(folder).toEqual({ project_id: 'project:legacy', path: rootPath, role: 'primary' })
    expect(profile.query('SELECT instructions, version FROM project_settings').get()).toEqual({
      instructions: '',
      version: 1,
    })
    expect(profile.query('SELECT project_key FROM memory_entries').get()).toEqual({
      project_key: 'project:project:legacy',
    })

    const history = new Database(':memory:')
    history.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, project_id TEXT, workspace_kind TEXT NOT NULL,
        workspace_root TEXT, workspace_cwd TEXT, output_directory TEXT,
        archived_at INTEGER, kind TEXT NOT NULL DEFAULT 'main',
        created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT, turn_id TEXT,
        method TEXT NOT NULL, params TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE memory_jobs (
        id TEXT PRIMARY KEY, project_key TEXT, status TEXT NOT NULL
      );
      INSERT INTO threads (
        id, project_id, workspace_kind, workspace_root, workspace_cwd,
        output_directory, archived_at, updated_at
      ) VALUES (
        'thread:legacy', 'project:legacy', 'project', NULL, NULL, NULL, NULL, 1
      );
      INSERT INTO memory_jobs VALUES ('job:legacy', '${oldKey}', 'queued');
      PRAGMA user_version = 20;
    `)
    initializeSchema(history, 'history')
    backfillProjectThreadWorkspaces(history, profile)
    expect(history.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    const workspace = history
      .query(
        `
      SELECT workspace_cwd, workspace_roots, instruction_sources
      FROM threads WHERE id = 'thread:legacy'
    `,
      )
      .get() as { workspace_cwd: string; workspace_roots: string; instruction_sources: string }
    expect(workspace.workspace_cwd).toBe(rootPath)
    expect(JSON.parse(workspace.workspace_roots)).toEqual([
      {
        folderId: expect.any(String),
        path: rootPath,
        role: 'primary',
      },
    ])
    expect(workspace.instruction_sources).toBe('[]')
    expect(history.query('SELECT project_key FROM memory_jobs').get()).toEqual({
      project_key: 'project:project:legacy',
    })
    expect(profile.query('PRAGMA foreign_key_check').all()).toEqual([])
    profile.close()
    history.close()
  })
})
