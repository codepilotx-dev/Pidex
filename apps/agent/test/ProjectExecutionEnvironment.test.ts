import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { PROFILE_SCHEMA_VERSION } from '../src/storage/database/Schema'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-project-execution-'))
  paths.push(root)
  const historyPath = join(root, 'agent.sqlite')
  const db = new AgentDatabase(historyPath)
  return { db, historyPath }
}

const profileColumns = (db: AgentDatabase) =>
  (
    db.profileSqlite.query('PRAGMA table_info(project_settings)').all() as Array<{ name: string }>
  ).map((column) => column.name)

describe('project execution environment setting', () => {
  test('默认自动，可持久化为本地目录并读回', async () => {
    const { db } = await fixture()
    const project = db.createProject({
      rootPath: join(tmpdir(), 'exec-root'),
      name: '执行环境项目',
    })

    expect(db.getProjectSettings(project.id).executionEnvironment).toBe('auto')

    const saved = db.saveProjectSettings(project.id, {
      defaultModel: null,
      executionEnvironment: 'local',
    })
    expect(saved.executionEnvironment).toBe('local')
    expect(db.getProjectSettings(project.id).executionEnvironment).toBe('local')

    // Switching back to automatic is allowed; there is no "force worktree" value.
    const back = db.saveProjectSettings(project.id, {
      defaultModel: null,
      executionEnvironment: 'auto',
    })
    expect(back.executionEnvironment).toBe('auto')
    db.close()
  })

  test('保存其他字段不会重置执行环境', async () => {
    const { db } = await fixture()
    const project = db.createProject({
      rootPath: join(tmpdir(), 'exec-root-2'),
      name: '保留设置项目',
    })
    db.saveProjectSettings(project.id, { defaultModel: null, executionEnvironment: 'local' })

    const saved = db.saveProjectSettings(project.id, {
      defaultModel: null,
      instructions: '只改指令',
    })
    expect(saved.executionEnvironment).toBe('local')
    expect(saved.instructions).toBe('只改指令')
    db.close()
  })

  test('项目设置不改变已有任务的执行绑定', async () => {
    const { db } = await fixture()
    const project = db.createProject({
      rootPath: join(tmpdir(), 'exec-root-3'),
      name: '已有任务项目',
    })
    const thread = db.createThread('已有任务', project.id)

    db.saveProjectSettings(project.id, { defaultModel: null, executionEnvironment: 'local' })

    // Only future task creation consults the setting; no existing binding is rewritten.
    expect(
      db.sqlite
        .query('SELECT COUNT(*) AS count FROM thread_execution_bindings WHERE thread_id = ?')
        .get(thread.id),
    ).toEqual({ count: 0 })
    db.close()
  })

  test('schema 3 资料库前向迁移到当前版本并补默认值', async () => {
    const { db, historyPath } = await fixture()
    const project = db.createProject({ rootPath: join(tmpdir(), 'exec-root-4'), name: '迁移项目' })
    // Reproduce the pre-column profile shape, keeping the existing settings row.
    db.profileSqlite.exec(`
      DROP TABLE project_settings;
      CREATE TABLE project_settings (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        default_model TEXT,
        instructions TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO project_settings (project_id, instructions, version, updated_at)
        VALUES ('${project.id}', '旧指令', 3, 5);
      PRAGMA user_version = 3;
    `)
    expect(profileColumns(db)).not.toContain('execution_environment')
    db.close()

    const migrated = new AgentDatabase(historyPath)
    expect(migrated.profileSqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: PROFILE_SCHEMA_VERSION,
    })
    expect(profileColumns(migrated)).toContain('execution_environment')
    expect(migrated.getProjectSettings(project.id)).toMatchObject({
      instructions: '旧指令',
      executionEnvironment: 'auto',
      version: 3,
    })
    migrated.close()
  })

  test('schema 4 标记已写入但增量列缺失时自修复', async () => {
    const { db, historyPath } = await fixture()
    const project = db.createProject({
      rootPath: join(tmpdir(), 'exec-root-5'),
      name: '中断迁移项目',
    })
    db.profileSqlite.exec(`
      DROP TABLE project_settings;
      CREATE TABLE project_settings (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        default_model TEXT,
        instructions TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO project_settings (project_id, instructions, version, updated_at)
        VALUES ('${project.id}', '保留内容', 2, 7);
      PRAGMA user_version = ${PROFILE_SCHEMA_VERSION};
    `)
    db.close()

    const repaired = new AgentDatabase(historyPath)
    expect(profileColumns(repaired)).toContain('execution_environment')
    expect(repaired.getProjectSettings(project.id)).toMatchObject({
      instructions: '保留内容',
      executionEnvironment: 'auto',
      version: 2,
    })
    repaired.close()
  })
})
