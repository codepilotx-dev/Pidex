import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Model, Provider } from '@pidex/model-schema'
import { removeFixturePaths } from './FixtureCleanup'
import {
  AgentDatabase,
  DATA_EPOCH,
  HISTORY_APPLICATION_ID,
  SCHEMA_VERSION,
} from '../src/storage/database/AgentDatabase'
import {
  FINAL_SCHEMA,
  HISTORY_SCHEMA,
  initializeSchema,
} from '../src/storage/database/SchemaInitializer'
import { PROFILE_APPLICATION_ID, PROFILE_SCHEMA_VERSION } from '../src/storage/database/Schema'
import { probeThreadsStorageCapabilities } from '../src/storage/database/StorageCapabilities'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'

const paths: string[] = []
const HISTORY_V19_SCHEMA = HISTORY_SCHEMA.filter(
  (statement) => !statement.startsWith('CREATE TRIGGER threads_workspace_'),
).map((statement) =>
  statement.startsWith('CREATE TABLE threads ')
    ? statement
        .replace(', workspace_roots TEXT, instruction_sources TEXT', '')
        .replace(', workspace_owner_thread_id TEXT', '')
        .replace(', git_branch TEXT)', ')')
    : statement,
)

// schema 37 冻结的语义历史视图契约；后续 schema 必须继续保留。
const SEMANTIC_VIEW_NAME = 'thread_semantic_history_v1'
const SEMANTIC_VIEW_VERSION = 37
const TOOL_OUTPUT_SUMMARY_LIMIT = 4000
const SESSION_GROUP_TABLES = [
  'session_group_operations',
  'session_group_context_entries',
  'session_group_context_state',
  'session_group_steps',
  'session_group_memberships',
  'session_groups',
] as const
const SEMANTIC_VIEW_COLUMNS = [
  'thread_id',
  'thread_title',
  'workspace_cwd',
  'turn_id',
  'entry_id',
  'agent_id',
  'role',
  'kind',
  'status',
  'content',
  'metadata_json',
  'created_at',
  'sort_order',
] as const

const semanticSubmit = (content: string) => ({
  content,
  model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt-4o') }),
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    approvalsReviewer: 'user' as const,
  },
  strategy: 'queue' as const,
  taskMode: 'chat' as const,
})

/** 写入 turn 对应的 Pi 会话/条目及边界，供视图暴露 entry_id 列。 */
const seedSemanticBoundary = (
  db: AgentDatabase,
  input: {
    turnID: string
    threadID: string
    agentID: string
    sessionID: string
    entryID: string
    createdAt: number
  },
) => {
  db.sqlite
    .query(
      'INSERT INTO pi_sessions (id, thread_id, agent_id, leaf_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
    )
    .run(
      input.sessionID,
      input.threadID,
      input.agentID,
      input.entryID,
      input.createdAt,
      input.createdAt,
    )
  db.sqlite
    .query(
      "INSERT INTO pi_session_entries (session_id, sequence, id, parent_id, type, payload, created_at) VALUES (?, 0, ?, NULL, 'assistant', '{}', ?)",
    )
    .run(input.sessionID, input.entryID, input.createdAt)
  db.sqlite
    .query('INSERT INTO turn_pi_boundaries (turn_id, session_id, entry_id) VALUES (?, ?, ?)')
    .run(input.turnID, input.sessionID, input.entryID)
}

afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

describe('数据库兼容与迁移', () => {
  test('v39 迁移到当前版本新增空会话组表并保留旧任务看板记录', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v39-'))
    paths.push(root)
    const historyPath = join(root, 'agent.sqlite')
    const profilePath = join(root, 'profile.sqlite')
    const db = new AgentDatabase({ historyPath, profilePath })
    const project = db.createProject({
      id: 'project:v39',
      rootPath: join(root, 'workspace'),
      name: '旧项目',
    })
    const taskId = 'task:legacy-v39'
    db.sqlite
      .query(
        `INSERT INTO taskboard_tasks
      (id, project_id, number, title, description, status, priority, position, version, archived_at, created_at, updated_at)
      VALUES (?, ?, 1, '旧任务', '', 'todo', 'none', 0, 1, NULL, 1, 1)`,
      )
      .run(taskId, project.id)
    for (const table of SESSION_GROUP_TABLES) db.sqlite.query(`DROP TABLE ${table}`).run()
    db.sqlite.exec('PRAGMA user_version = 39')
    db.close()

    const reopened = new AgentDatabase({ historyPath, profilePath })
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(
      reopened.sqlite.query('SELECT title FROM taskboard_tasks WHERE id = ?').get(taskId),
    ).toEqual({ title: '旧任务' })
    expect(reopened.repositories.sessionGroups.list()).toEqual([])
    reopened.close()
  })

  test('v40 缺少会话组表时迁移到当前版本并保留既有记录', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v40-incomplete-'))
    paths.push(root)
    const historyPath = join(root, 'agent.sqlite')
    const profilePath = join(root, 'profile.sqlite')
    const db = new AgentDatabase({ historyPath, profilePath })
    const thread = db.createThread({ title: '保留的会话' })
    for (const table of SESSION_GROUP_TABLES) db.sqlite.query(`DROP TABLE ${table}`).run()
    db.sqlite.exec('PRAGMA user_version = 40')
    db.close()

    const reopened = new AgentDatabase({ historyPath, profilePath })
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(reopened.getThread(thread.id)?.title).toBe('保留的会话')
    expect(reopened.repositories.sessionGroups.list()).toEqual([])
    reopened.close()
  })

  test('v35 工作流表补齐排序位置并保留已有任务', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v35-'))
    paths.push(root)
    const historyPath = join(root, 'agent.sqlite')
    const profilePath = join(root, 'profile.sqlite')
    const db = new AgentDatabase({ historyPath, profilePath })
    const taskId = 'task:workflow-v35'
    const expectedPosition = 0
    db.sqlite
      .query(
        `INSERT INTO taskboard_tasks
      (id, project_id, number, title, description, status, priority, position, version, archived_at, created_at, updated_at)
      VALUES (?, 'project:migration', 1, '保留的任务', '', 'todo', 'none', ?, 1, NULL, 1, 1)`,
      )
      .run(taskId, expectedPosition)
    db.sqlite.exec(`
      DROP TRIGGER taskboard_workflow_after_task_insert;
      DROP TRIGGER taskboard_workflow_after_legacy_status_change;
      DROP TRIGGER taskboard_workflow_after_legacy_position_change;
      ALTER TABLE taskboard_task_workflows RENAME TO taskboard_task_workflows_current;
      CREATE TABLE taskboard_task_workflows (
        task_id TEXT PRIMARY KEY REFERENCES taskboard_tasks(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('backlog','todo','in_progress','in_review','blocked','done','canceled')),
        start_date TEXT,
        due_date TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO taskboard_task_workflows (task_id, status, start_date, due_date, created_at, updated_at)
        SELECT task_id, status, start_date, due_date, created_at, updated_at FROM taskboard_task_workflows_current;
      DROP TABLE taskboard_task_workflows_current;
      PRAGMA user_version = 35;
    `)
    db.close()

    const reopened = new AgentDatabase({ historyPath, profilePath })
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(
      reopened.sqlite
        .query('SELECT position FROM taskboard_task_workflows WHERE task_id = ?')
        .get(taskId),
    ).toEqual({ position: expectedPosition })
    expect(
      reopened.sqlite
        .query('SELECT id FROM taskboard_tasks WHERE project_id = ?')
        .all('project:migration'),
    ).toEqual([{ id: taskId }])
    reopened.close()
  })

  test('v31 到 v32 新增 creation_surface 列并校验约束与既有数据', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v31-'))
    paths.push(root)
    const historyPath = join(root, 'agent.sqlite')
    const profilePath = join(root, 'profile.sqlite')
    const db = new AgentDatabase({ historyPath, profilePath })
    const thread = db.createThread({ title: 'v31 migration test', creationSurface: 'working' })
    expect(
      db.sqlite.query('SELECT creation_surface FROM threads WHERE id = ?').get(thread.id),
    ).toEqual({ creation_surface: 'working' })
    db.close()

    // 重新打开并验证 user_version
    const reopened = new AgentDatabase({ historyPath, profilePath })
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(
      reopened.sqlite.query('SELECT creation_surface FROM threads WHERE id = ?').get(thread.id),
    ).toEqual({ creation_surface: 'working' })

    // 验证 CHECK 约束：支持 coding, working, chat, null；非法值抛错
    expect(() => {
      reopened.sqlite
        .query(
          "INSERT INTO threads (id, title, creation_surface, created_at, updated_at) VALUES ('invalid-surface', 'bad', 'invalid_surface', 1, 1)",
        )
        .run()
    }).toThrow()

    // 合法 surface
    reopened.sqlite
      .query(
        "INSERT INTO threads (id, title, creation_surface, created_at, updated_at) VALUES ('valid-coding', 'coding', 'coding', 1, 1)",
      )
      .run()
    reopened.sqlite
      .query(
        "INSERT INTO threads (id, title, creation_surface, created_at, updated_at) VALUES ('valid-null', 'null', NULL, 1, 1)",
      )
      .run()
    expect(
      reopened.sqlite.query("SELECT creation_surface FROM threads WHERE id = 'valid-coding'").get(),
    ).toEqual({ creation_surface: 'coding' })
    expect(
      reopened.sqlite.query("SELECT creation_surface FROM threads WHERE id = 'valid-null'").get(),
    ).toEqual({ creation_surface: null })
    reopened.close()
  })

  test('v30 到 v31 新增任务看板表且保留既有会话', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v30-'))
    paths.push(root)
    const historyPath = join(root, 'agent.sqlite')
    const profilePath = join(root, 'profile.sqlite')
    const db = new AgentDatabase({ historyPath, profilePath })
    const thread = db.createThread('v30 taskboard migration')
    for (const table of [
      'taskboard_start_operations',
      'taskboard_operations',
      'taskboard_activities',
      'taskboard_comments',
      'taskboard_task_threads',
      'taskboard_task_labels',
      'taskboard_labels',
      'taskboard_tasks',
      'taskboard_project_sequences',
    ])
      db.sqlite.query(`DROP TABLE ${table}`).run()
    db.sqlite.exec('PRAGMA user_version = 30')
    db.close()

    const reopened = new AgentDatabase({ historyPath, profilePath })
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(reopened.sqlite.query('SELECT title FROM threads WHERE id = ?').get(thread.id)).toEqual({
      title: 'v30 taskboard migration',
    })
    const tables = new Set(
      (
        reopened.sqlite
          .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'taskboard_%'")
          .all() as Array<{ name: string }>
      ).map(({ name }) => name),
    )
    expect(tables.size).toBe(16)
    expect(tables.has('taskboard_tasks')).toBe(true)
    expect(tables.has('taskboard_start_operations')).toBe(true)
    expect(tables.has('taskboard_task_workflows')).toBe(true)
    expect(tables.has('taskboard_task_attention')).toBe(true)
    reopened.close()
  })

  test('v29 到 v30 新增独立本地上下文表且不改写核心会话', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v29-'))
    paths.push(root)
    const path = join(root, 'agent.sqlite')
    const db = new AgentDatabase({ historyPath: path, profilePath: join(root, 'profile.sqlite') })
    const thread = db.createThread('v29 context migration')
    db.sqlite.query('DROP TABLE context_path_operations').run()
    db.sqlite.query('DROP TABLE input_context_paths').run()
    db.sqlite.query('DROP TABLE thread_context_paths').run()
    db.sqlite.exec('PRAGMA user_version = 29')
    db.close()

    const reopened = new AgentDatabase({
      historyPath: path,
      profilePath: join(root, 'profile.sqlite'),
    })
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(reopened.sqlite.query('SELECT title FROM threads WHERE id = ?').get(thread.id)).toEqual({
      title: 'v29 context migration',
    })
    expect(
      reopened.sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_context_paths'",
        )
        .get(),
    ).toEqual({ name: 'thread_context_paths' })
    reopened.close()
  })

  test('v18 到 v19 从 durable events 恢复被覆盖正文并分配稳定 ordinal', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn_id TEXT NOT NULL,
        agent_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
        data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT, turn_id TEXT,
        method TEXT NOT NULL, params TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'main',
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      PRAGMA user_version = 18;
    `)
    const internalItem = (
      id: string,
      type: string,
      data: Record<string, unknown>,
      createdAt: number,
    ) => ({
      id,
      turnID: 'turn-1',
      agentID: 'agent-1',
      type,
      status: 'completed',
      data,
      createdAt,
      updatedAt: createdAt,
    })
    const first = internalItem(
      'turn-1:pi:text',
      'text',
      { placement: 'result', text: '开始检查' },
      100,
    )
    const final = internalItem(
      'turn-1:pi:text',
      'text',
      { placement: 'result', text: '根 package.json 已读取' },
      200,
    )
    const tool = internalItem('tool-1', 'tool', { tool: 'Read' }, 101)
    sqlite
      .query('INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        final.id,
        'thread-1',
        final.turnID,
        final.agentID,
        final.type,
        final.status,
        JSON.stringify(final.data),
        final.createdAt,
        final.updatedAt,
      )
    sqlite
      .query('INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        tool.id,
        'thread-1',
        tool.turnID,
        tool.agentID,
        tool.type,
        tool.status,
        JSON.stringify(tool.data),
        tool.createdAt,
        tool.updatedAt,
      )
    sqlite
      .query('INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        'legacy-unproven',
        'thread-1',
        'turn-1',
        'agent-1',
        'activity',
        'completed',
        '{}',
        300,
        300,
      )
    for (const [method, item, createdAt] of [
      ['item/completed', first, 100],
      ['tool/callStarted', tool, 101],
      ['item/completed', final, 200],
    ] as const) {
      sqlite
        .query(
          'INSERT INTO events (thread_id, turn_id, method, params, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run('thread-1', 'turn-1', method, JSON.stringify({ item }), createdAt)
    }

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    const rows = sqlite
      .query('SELECT id, type, data, ordinal FROM items WHERE turn_id = ? ORDER BY ordinal')
      .all('turn-1') as Array<{
      id: string
      type: string
      data: string
      ordinal: number
    }>
    expect(rows.map((row) => [row.type, JSON.parse(row.data).text ?? null])).toEqual([
      ['text', '开始检查'],
      ['tool', null],
      ['text', '根 package.json 已读取'],
      ['activity', null],
    ])
    expect(rows.map((row) => row.ordinal)).toEqual([0, 1, 2, 3])
    expect(rows.some((row) => row.id === 'legacy-unproven')).toBe(true)
    expect(sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test('v19 到 v20 保留会话和消息并新增 nullable 工作分支', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'main',
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        method TEXT NOT NULL,
        params TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO threads (id, title) VALUES ('thread-1', '保留的会话');
      INSERT INTO messages (id, thread_id, content) VALUES ('message-1', 'thread-1', '保留的消息');
      PRAGMA user_version = 19;
    `)

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    expect(sqlite.query('SELECT id, title, git_branch FROM threads').get()).toEqual({
      id: 'thread-1',
      title: '保留的会话',
      git_branch: null,
    })
    expect(sqlite.query("SELECT content FROM messages WHERE id = 'message-1'").get()).toEqual({
      content: '保留的消息',
    })
    expect(sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test('v21 到 v22 只恢复被纯标题事件覆盖的会话活跃时间', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(HISTORY_SCHEMA.join(';\n'))
    sqlite.exec('PRAGMA user_version = 21')
    for (const [id, createdAt, updatedAt] of [
      ['thread:title', 100, 900],
      ['thread:empty', 150, 950],
      ['thread:active-after-title', 200, 1_000],
      ['thread:title-and-archive', 250, 800],
    ] as const) {
      sqlite
        .query("INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, '标题', ?, ?)")
        .run(id, createdAt, updatedAt)
    }
    for (const [id, threadID, createdAt, ordinal] of [
      ['message:title', 'thread:title', 300, 0],
      ['message:before-title', 'thread:active-after-title', 400, 0],
      ['message:after-title', 'thread:active-after-title', 1_000, 1],
      ['message:archive', 'thread:title-and-archive', 500, 0],
    ] as const) {
      sqlite
        .query(
          `
        INSERT INTO messages (id, thread_id, turn_id, role, content, created_at, ordinal)
        VALUES (?, ?, NULL, 'user', '内容', ?, ?)
      `,
        )
        .run(id, threadID, createdAt, ordinal)
    }
    for (const [threadID, patch, updatedAt] of [
      ['thread:title', { title: '新标题' }, 900],
      ['thread:empty', { title: null }, 950],
      ['thread:active-after-title', { title: '旧标题' }, 900],
      ['thread:title-and-archive', { title: '归档标题', archived: true }, 800],
    ] as const) {
      sqlite
        .query(
          `
        INSERT INTO events (thread_id, turn_id, method, params, created_at)
        VALUES (?, NULL, 'thread/updated', ?, ?)
      `,
        )
        .run(threadID, JSON.stringify({ threadId: threadID, patch, updatedAt }), updatedAt)
    }

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    const activityByThread = new Map(
      (
        sqlite.query('SELECT id, updated_at FROM threads ORDER BY id').all() as Array<{
          id: string
          updated_at: number
        }>
      ).map((row) => [row.id, row.updated_at]),
    )
    expect(activityByThread.get('thread:title')).toBe(300)
    expect(activityByThread.get('thread:empty')).toBe(150)
    expect(activityByThread.get('thread:active-after-title')).toBe(1_000)
    expect(activityByThread.get('thread:title-and-archive')).toBe(800)
    expect(sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test('v22 到 v23 新增独立未读表并保留现有会话', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(
      HISTORY_SCHEMA.filter(
        (statement) => !statement.startsWith('CREATE TABLE thread_read_state'),
      ).join(';\n'),
    )
    sqlite.exec(`
      PRAGMA user_version = 22;
      INSERT INTO threads (id, title, created_at, updated_at)
      VALUES ('thread:existing', '保留的会话', 1, 2);
    `)

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    expect(sqlite.query('SELECT id, title FROM threads').get()).toEqual({
      id: 'thread:existing',
      title: '保留的会话',
    })
    expect(sqlite.query('SELECT * FROM thread_read_state').all()).toEqual([])
    expect(sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test('v25 到 v26 只新增消息分叉表并保留既有会话 schema', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(HISTORY_SCHEMA.join(';\n'))
    sqlite.exec(`
      DROP TABLE turn_pi_boundaries;
      DROP TABLE thread_message_forks;
      DROP TABLE thread_message_fork_operations;
      PRAGMA user_version = 25;
      INSERT INTO threads (id, title, created_at, updated_at)
      VALUES ('thread:existing', '保留的会话', 1, 2);
    `)
    const threadSqlBefore = sqlite
      .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
      .get() as { sql: string }

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    const tables = new Set(
      (
        sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string
        }>
      ).map(({ name }) => name),
    )
    expect(tables.has('thread_message_fork_operations')).toBe(true)
    expect(tables.has('thread_message_forks')).toBe(true)
    expect(tables.has('turn_pi_boundaries')).toBe(true)
    expect(sqlite.query('SELECT id, title FROM threads').get()).toEqual({
      id: 'thread:existing',
      title: '保留的会话',
    })
    expect(
      sqlite.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'threads'").get(),
    ).toEqual(threadSqlBefore)
    expect(
      (
        sqlite.query('PRAGMA table_info(thread_message_fork_operations)').all() as Array<{
          name: string
        }>
      ).map(({ name }) => name),
    ).toContain('worktree_operation_id')
    expect(sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test('v26 到 v27 只新增恢复 lease 表并保留既有会话 schema', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(HISTORY_SCHEMA.join(';\n'))
    sqlite.exec(`
      DROP TABLE resume_checkpoint_leases;
      PRAGMA user_version = 26;
      INSERT INTO threads (id, title, created_at, updated_at)
      VALUES ('thread:existing', '保留的会话', 1, 2);
    `)
    const threadSqlBefore = sqlite
      .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
      .get()

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    expect(sqlite.query('SELECT id, title FROM threads').get()).toEqual({
      id: 'thread:existing',
      title: '保留的会话',
    })
    expect(
      sqlite.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'threads'").get(),
    ).toEqual(threadSqlBefore)
    expect(
      sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'resume_checkpoint_leases'",
        )
        .get(),
    ).toEqual({ name: 'resume_checkpoint_leases' })
    expect(sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test('v27 到 v28 只新增临时侧边聊天表并保留既有会话 schema', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(HISTORY_SCHEMA.join(';\n'))
    sqlite.exec(`
      DROP TABLE thread_side_chats;
      PRAGMA user_version = 27;
      INSERT INTO threads (id, title, created_at, updated_at)
      VALUES ('thread:existing', '保留的会话', 1, 2);
    `)
    const threadSqlBefore = sqlite
      .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
      .get()

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    expect(sqlite.query('SELECT id, title FROM threads').get()).toEqual({
      id: 'thread:existing',
      title: '保留的会话',
    })
    expect(
      sqlite.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'threads'").get(),
    ).toEqual(threadSqlBefore)
    expect(
      sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_side_chats'")
        .get(),
    ).toEqual({ name: 'thread_side_chats' })
    expect(sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test('已知 history application ID 2 从 schema 19 原地升级并保留会话', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v19-'))
    paths.push(root)
    const databasePaths = {
      legacyPath: join(root, 'agent.sqlite'),
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    const legacy = new Database(databasePaths.historyPath, { create: true })
    legacy.exec(HISTORY_V19_SCHEMA.join(';\n'))
    legacy.exec(`
      PRAGMA application_id = 2;
      PRAGMA user_version = 19;
      INSERT INTO threads (id, title, created_at, updated_at)
      VALUES ('thread:legacy', '保留的旧会话', 1, 1);
    `)
    legacy.close()

    const db = new AgentDatabase(databasePaths)

    expect(db.getThread('thread:legacy')?.title).toBe('保留的旧会话')
    expect(db.sqlite.query('PRAGMA application_id').get()).toEqual({
      application_id: HISTORY_APPLICATION_ID,
    })
    expect(db.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    db.close()
  })

  test('旧客户端打开更高 history schema 时保留未知结构并继续读写核心会话', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-future-'))
    paths.push(root)
    const databasePaths = {
      legacyPath: join(root, 'agent.sqlite'),
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    const initial = new AgentDatabase(databasePaths)
    const existing = initial.createThread('已有会话')
    initial.close()

    const future = new Database(databasePaths.historyPath)
    future.exec(`
      ALTER TABLE threads ADD COLUMN future_note TEXT;
      CREATE TABLE future_feature_records (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      INSERT INTO future_feature_records VALUES ('future:1', '{"enabled":true}');
      UPDATE threads SET future_note = 'keep' WHERE id = '${existing.id}';
      PRAGMA user_version = ${SCHEMA_VERSION + 1};
    `)
    future.close()

    const reopened = new AgentDatabase(databasePaths)
    expect(reopened.getThread(existing.id)?.title).toBe('已有会话')
    const created = reopened.createThread('旧客户端新建会话')
    expect(reopened.getThread(created.id)?.title).toBe('旧客户端新建会话')
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION + 1,
    })
    expect(
      reopened.sqlite
        .query("SELECT payload FROM future_feature_records WHERE id = 'future:1'")
        .get(),
    ).toEqual({
      payload: '{"enabled":true}',
    })
    expect(
      reopened.sqlite.query('SELECT future_note FROM threads WHERE id = ?').get(existing.id),
    ).toEqual({
      future_note: 'keep',
    })
    reopened.close()
  })

  test('旧客户端打开更高 profile schema 时保留未知设置结构', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-profile-future-'))
    paths.push(root)
    const databasePaths = {
      legacyPath: join(root, 'agent.sqlite'),
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    const initial = new AgentDatabase(databasePaths)
    initial.setSetting('compatibility.known', { enabled: true })
    initial.close()

    const future = new Database(databasePaths.profilePath)
    future.exec(`
      CREATE TABLE future_profile_records (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      INSERT INTO future_profile_records VALUES ('future:profile', '{"keep":true}');
      PRAGMA user_version = ${PROFILE_SCHEMA_VERSION + 1};
    `)
    future.close()

    const reopened = new AgentDatabase(databasePaths)
    expect(reopened.getSetting<{ enabled: boolean }>('compatibility.known')).toEqual({
      enabled: true,
    })
    expect(reopened.profileSqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: PROFILE_SCHEMA_VERSION + 1,
    })
    expect(
      reopened.profileSqlite
        .query("SELECT payload FROM future_profile_records WHERE id = 'future:profile'")
        .get(),
    ).toEqual({ payload: '{"keep":true}' })
    reopened.close()
  })

  test('读取旧 on-failure 审批策略时迁移为 on-request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-on-failure-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const thread = db.createThread('旧审批策略')
    db.sqlite.query("UPDATE threads SET approval_policy = 'on-failure' WHERE id = ?").run(thread.id)

    expect(db.getThread(thread.id)?.settings.permissionConfig.approvalPolicy).toBe('on-request')
    db.close()
  })

  test('新数据库创建 Pi session schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-pi-epoch-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))

    expect(db.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.sqlite.query('PRAGMA application_id').get()).toEqual({ application_id: DATA_EPOCH })
    const tables = new Set(
      (
        db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string
        }>
      ).map(({ name }) => name),
    )
    expect(tables.has('pi_sessions')).toBe(true)
    expect(tables.has('pi_session_entries')).toBe(true)
    expect(
      (db.sqlite.query('PRAGMA table_info(threads)').all() as Array<{ name: string }>).some(
        (column) => column.name === 'git_branch',
      ),
    ).toBe(true)
    db.close()
  })

  test('无法识别的旧 schema 会保留原文件并阻止启动', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-pi-v17-'))
    paths.push(root)
    const path = join(root, 'agent.sqlite')
    const seeded = new Database(path, { create: true })
    seeded.exec(`
      PRAGMA application_id = ${DATA_EPOCH};
      PRAGMA user_version = 16;
      CREATE TABLE stale_schema (value TEXT NOT NULL);
      INSERT INTO stale_schema VALUES ('must reset');
    `)
    seeded.close()
    const originalSize = (await stat(path)).size

    expect(() => new AgentDatabase(path)).toThrow('缺少 16 → 17 迁移')
    expect((await stat(path)).size).toBe(originalSize)
  })

  test('空白 SQLite 文件可以初始化为当前 Pidex 数据库', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-empty-database-'))
    paths.push(root)
    const path = join(root, 'agent.sqlite')
    new Database(path, { create: true }).close()

    const db = new AgentDatabase(path)
    expect(db.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.sqlite.query('PRAGMA application_id').get()).toEqual({
      application_id: HISTORY_APPLICATION_ID,
    })
    db.close()
  })

  test('当前 Pi epoch 重开时保留数据', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-keep-pi-epoch-'))
    paths.push(root)
    const path = join(root, 'agent.sqlite')
    const initial = new AgentDatabase(path)
    const thread = initial.createThread('保留的会话')
    initial.close()

    const reopened = new AgentDatabase(path)
    expect(reopened.getThread(thread.id)?.title).toBe('保留的会话')
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    reopened.close()
  })

  test('旧单库原子拆分为 history/profile 并保留来源且不创建备份', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-split-'))
    paths.push(root)
    const legacyPath = join(root, 'agent.sqlite')
    const historyPath = join(root, 'history.sqlite')
    const profilePath = join(root, 'profile.sqlite')
    const legacy = new Database(legacyPath, { create: true })
    legacy.exec('PRAGMA foreign_keys = ON')
    legacy.exec(FINAL_SCHEMA.join(';\n'))
    legacy.exec(`
      PRAGMA application_id = ${DATA_EPOCH};
      PRAGMA user_version = 17;
      INSERT INTO app_settings VALUES ('desktop.settings.v1', '{"theme":"dark"}', 1);
      INSERT INTO projects VALUES ('project:1', '项目', NULL, 1, 1, 1);
      INSERT INTO project_settings (project_id, default_model, instructions, execution_environment, version, updated_at) VALUES ('project:1', NULL, '', 'auto', 1, 1);
      INSERT INTO project_folders VALUES ('folder:1', 'project:1', 'F:\\workspace', 'f:/workspace', 'primary', 0, 1, 1);
      INSERT INTO threads (
        id, title, project_id, workspace_kind, workspace_cwd, workspace_roots,
        instruction_sources, created_at, updated_at
      ) VALUES (
        'thread:1', '保留的会话', 'project:1', 'project', 'F:\\workspace',
        '[{"folderId":"folder:1","path":"F:\\\\workspace","role":"primary"}]', '[]', 1, 1
      );
      INSERT INTO memory_entries VALUES ('memory:1', 'user', '', '偏好深色主题', 'thread:1', 'hash:1', 1, 1);
    `)
    legacy.close()

    const db = new AgentDatabase({ legacyPath, historyPath, profilePath })
    expect(db.getThread('thread:1')?.title).toBe('保留的会话')
    expect(db.getSetting<{ theme: string }>('desktop.settings.v1')).toEqual({ theme: 'dark' })
    expect(db.getProject('project:1')?.name).toBe('项目')
    expect(
      db.profileSqlite.query("SELECT content FROM memory_entries WHERE id = 'memory:1'").get(),
    ).toEqual({ content: '偏好深色主题' })
    expect(
      db.sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE name IN ('app_settings', 'projects', 'memory_entries')",
        )
        .all(),
    ).toEqual([])
    expect(db.profileSqlite.query('PRAGMA application_id').get()).toEqual({
      application_id: PROFILE_APPLICATION_ID,
    })
    expect(db.profileSqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: PROFILE_SCHEMA_VERSION,
    })
    db.sqlite.query("DELETE FROM threads WHERE id = 'thread:1'").run()
    expect(
      db.profileSqlite
        .query("SELECT source_thread_id FROM memory_entries WHERE id = 'memory:1'")
        .get(),
    ).toEqual({ source_thread_id: 'thread:1' })
    db.close()

    const names = await readdir(root)
    expect(names.some((name) => name.endsWith('.bak'))).toBe(false)
    expect(names).toContain('agent.sqlite')
  })

  test('混合 history v17 原子拆分并保留会话与设置且不创建备份', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-split-history-v17-'))
    paths.push(root)
    const legacyPath = join(root, 'agent.sqlite')
    const historyPath = join(root, 'history.sqlite')
    const profilePath = join(root, 'profile.sqlite')
    const mixed = new Database(historyPath, { create: true })
    mixed.exec(FINAL_SCHEMA.join(';\n'))
    mixed.exec(`
      PRAGMA application_id = ${DATA_EPOCH};
      PRAGMA user_version = 17;
      INSERT INTO app_settings VALUES ('desktop.settings.v1', '{"theme":"dark"}', 1);
      INSERT INTO threads (
        id, title, workspace_kind, created_at, updated_at
      ) VALUES ('thread:mixed', '混合库会话', 'legacy', 1, 1);
    `)
    mixed.close()

    const db = new AgentDatabase({ legacyPath, historyPath, profilePath })
    expect(db.getThread('thread:mixed')?.title).toBe('混合库会话')
    expect(db.getSetting<{ theme: string }>('desktop.settings.v1')).toEqual({ theme: 'dark' })
    expect(
      db.sqlite.query("SELECT name FROM sqlite_master WHERE name = 'app_settings'").get(),
    ).toBeNull()
    db.close()

    const names = await readdir(root)
    expect(names).toContain('history.sqlite')
    expect(names).toContain('profile.sqlite')
    expect(names.some((name) => name.endsWith('.bak'))).toBe(false)
    expect(names.some((name) => name.includes('.migrating'))).toBe(false)
  })

  test('未知 history application ID 保留原库并阻止覆盖', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-epoch-'))
    paths.push(root)
    const pathsForDatabase = {
      legacyPath: join(root, 'agent.sqlite'),
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    const initial = new AgentDatabase(pathsForDatabase)
    initial.setSetting('desktop.settings.v1', { fontSize: 16 })
    const staleThread = initial.createThread('应重建的会话')
    initial.close()
    const staleHistory = new Database(pathsForDatabase.historyPath)
    staleHistory.exec('PRAGMA application_id = 1')
    staleHistory.close()

    expect(() => new AgentDatabase(pathsForDatabase)).toThrow(
      'history.sqlite 不属于受支持的 Pidex 数据代际',
    )
    const preserved = new Database(pathsForDatabase.historyPath, { strict: true })
    expect(preserved.query('SELECT title FROM threads WHERE id = ?').get(staleThread.id)).toEqual({
      title: '应重建的会话',
    })
    expect(preserved.query('PRAGMA application_id').get()).toEqual({ application_id: 1 })
    preserved.close()
    expect((await readdir(root)).some((name) => name.includes('.bak'))).toBe(false)
  })

  test('资料迁移校验失败时保留旧库且不发布正式双库', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-profile-failure-'))
    paths.push(root)
    const legacyPath = join(root, 'agent.sqlite')
    const historyPath = join(root, 'history.sqlite')
    const profilePath = join(root, 'profile.sqlite')
    const legacy = new Database(legacyPath, { create: true })
    legacy.exec(FINAL_SCHEMA.join(';\n'))
    legacy.exec(`
      PRAGMA application_id = ${DATA_EPOCH};
      PRAGMA user_version = 17;
      INSERT INTO app_settings VALUES ('desktop.settings.v1', '{broken', 1);
    `)
    legacy.close()

    expect(() => new AgentDatabase({ legacyPath, historyPath, profilePath })).toThrow(
      '不是有效 JSON',
    )
    expect(await Bun.file(legacyPath).exists()).toBe(true)
    expect(await Bun.file(profilePath).exists()).toBe(false)
  })

  test('v16 持久化 projectless workspace 和创建操作幂等键', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-projectless-v16-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const workspaceRoot = join(root, 'managed', 'thread-1')
    const cwd = join(workspaceRoot, 'work')
    const outputDirectory = join(workspaceRoot, 'outputs')

    const thread = db.createThread({
      id: 'thread:projectless',
      title: '无项目会话',
      workspace: { kind: 'projectless', workspaceRoot, cwd, outputDirectory },
      operationID: 'operation:projectless-create',
      requestHash: 'request-hash',
    })

    expect(thread.workspace).toEqual({
      kind: 'projectless',
      projectID: null,
      workspaceRoot,
      cwd,
      outputDirectory,
    })
    expect(db.threadWorkspace(thread.id)).toEqual(thread.workspace)
    expect(db.threadForCreateOperation('operation:projectless-create')).toEqual({
      threadID: thread.id,
      requestHash: 'request-hash',
    })
    expect(() =>
      db.createThread({
        title: '越界会话',
        workspace: {
          kind: 'projectless',
          workspaceRoot,
          cwd: join(root, 'outside'),
          outputDirectory,
        },
      }),
    ).toThrow('必须位于工作区根目录内')
    db.close()
  })

  test('higher history schema 缺 creation_surface 列时初始化保持 user_version 与现有会话并兼容 list/snapshot/create', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-future-no-creation-surface-'))
    paths.push(root)
    const historyPath = join(root, 'agent.sqlite')
    const profilePath = join(root, 'profile.sqlite')

    // 步骤 1：建立完整 SCHEMA_VERSION 数据库并写入示例会话。
    const initial = new AgentDatabase({ historyPath, profilePath })
    const existing = initial.createThread({ title: '向前兼容会话' })
    initial.close()

    // 步骤 2：模拟更高 history schema，且其中 threads 不含 creation_surface 列。
    const futureVersion = SCHEMA_VERSION + 1
    const mutator = new Database(historyPath)
    mutator.exec('ALTER TABLE threads DROP COLUMN creation_surface')
    mutator.exec(`
      CREATE TABLE future_feature_records (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      INSERT INTO future_feature_records VALUES ('future:1', '{"enabled":true}');
      PRAGMA user_version = ${futureVersion};
    `)
    const columnRows = mutator.query('PRAGMA table_info(threads)').all() as Array<{ name: string }>
    expect(columnRows.some((col) => col.name === 'creation_surface')).toBe(false)
    mutator.close()

    // 步骤 3：用当前代码初始化数据库；不能改 user_version、不能加列、不能丢记录。
    const reopened = new AgentDatabase({ historyPath, profilePath })
    const versionRow = reopened.sqlite.query('PRAGMA user_version').get() as {
      user_version: number
    }
    expect(versionRow.user_version).toBe(futureVersion)
    const afterColumns = reopened.sqlite.query('PRAGMA table_info(threads)').all() as Array<{
      name: string
    }>
    expect(afterColumns.some((col) => col.name === 'creation_surface')).toBe(false)
    expect(
      reopened.sqlite
        .query("SELECT payload FROM future_feature_records WHERE id = 'future:1'")
        .get() as { payload: string },
    ).toEqual({ payload: '{"enabled":true}' })

    // 步骤 4：集中探测必须准确报告缺列；ThreadProjection 与 system.initialize 都依赖此结果。
    expect(probeThreadsStorageCapabilities(reopened.sqlite).creationSurface).toBe(false)

    // 步骤 5：list/snapshot 历史会话必须可用，且 creationSurface 字段在投影里不存在。
    const projection = new ThreadProjection(reopened)
    const listed = projection.list()
    const legacy = listed.find((item) => item.id === existing.id)
    expect(legacy?.title).toBe('向前兼容会话')
    expect((legacy as Record<string, unknown>).creationSurface).toBeUndefined()
    const snap = projection.snapshot(existing.id)
    expect(snap?.thread.title).toBe('向前兼容会话')
    expect((snap?.thread as Record<string, unknown>).creationSurface).toBeUndefined()
    expect(probeThreadsStorageCapabilities(reopened.sqlite).creationSurface).toBe(false)

    // 步骤 6：create 路径不得写到不存在的列；显式传入 creationSurface 验证 repository 主动丢弃，
    // 而非仅在调用方不传字段时才不出现。返回值、写入事件、数据库行三者都不应出现该字段。
    const created = reopened.createThread({ title: '无列库新建', creationSurface: 'chat' })
    expect(created.title).toBe('无列库新建')
    expect((created as Record<string, unknown>).creationSurface).toBeUndefined()
    const row = reopened.sqlite
      .query('SELECT id, title FROM threads WHERE id = ?')
      .get(created.id) as { id: string; title: string } | null
    expect(row).toEqual({ id: created.id, title: '无列库新建' })
    const columnProbe = reopened.sqlite.query('PRAGMA table_info(threads)').all() as Array<{
      name: string
    }>
    expect(columnProbe.some((col) => col.name === 'creation_surface')).toBe(false)
    // 写入事件亦不能出现 creationSurface 来源。
    const storedEvents = reopened.sqlite
      .query("SELECT params FROM events WHERE method = 'thread/created' ORDER BY id DESC LIMIT 1")
      .get() as { params: string } | null
    expect(storedEvents).not.toBeNull()
    const parsed = JSON.parse(storedEvents!.params) as { thread: Record<string, unknown> }
    expect(parsed.thread.creationSurface).toBeUndefined()

    // 步骤 7：能力广告必须过滤 thread.creation-surface.v1；以与生产 system.initialize 一致的边界过滤。
    const advertised = filterAdvertisedCapabilities(reopened)
    expect(advertised.includes('thread.creation-surface.v1')).toBe(false)

    // 步骤 8：以相同 fixture 验证列存在时能力广告仍包含该 capability。
    const normal = new AgentDatabase({
      historyPath: join(root, 'normal.sqlite'),
      profilePath: join(root, 'normal-profile.sqlite'),
    })
    const normalCapabilities = filterAdvertisedCapabilities(normal)
    expect(normalCapabilities.includes('thread.creation-surface.v1')).toBe(true)
    normal.close()

    reopened.close()
  })

  test('v33 升至当前版本后保留 immutable runtime composition 表和索引', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v33-runtime-composition-'))
    paths.push(root)
    const databasePaths = {
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    const initial = new AgentDatabase(databasePaths)
    initial.close()
    const legacy = new Database(databasePaths.historyPath)
    legacy.exec(`
      DROP TABLE runtime_composition_plans;
      PRAGMA user_version = 33;
    `)
    legacy.close()

    const migrated = new AgentDatabase(databasePaths)
    expect(migrated.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(
      migrated.sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_composition_plans'",
        )
        .get(),
    ).toEqual({ name: 'runtime_composition_plans' })
    expect(
      migrated.sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'runtime_composition_plans_agent'",
        )
        .get(),
    ).toEqual({ name: 'runtime_composition_plans_agent' })
    migrated.close()
  })

  test('高版本 history 缺 runtime composition 表时不迁移也不创建', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-future-runtime-composition-'))
    paths.push(root)
    const databasePaths = {
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    const initial = new AgentDatabase(databasePaths)
    initial.close()
    const future = new Database(databasePaths.historyPath)
    future.exec(`
      DROP TABLE runtime_composition_plans;
      CREATE TABLE future_runtime_data (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      INSERT INTO future_runtime_data VALUES ('future:1', 'keep');
      PRAGMA user_version = ${SCHEMA_VERSION + 1};
    `)
    future.close()

    const reopened = new AgentDatabase(databasePaths)
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION + 1,
    })
    expect(
      reopened.sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_composition_plans'",
        )
        .get(),
    ).toBeNull()
    expect(
      reopened.sqlite.query("SELECT payload FROM future_runtime_data WHERE id = 'future:1'").get(),
    ).toEqual({ payload: 'keep' })
    reopened.close()
  })

  test('schema 37 fresh 数据库创建只读 thread_semantic_history_v1 视图且列集合固定', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v37-fresh-'))
    paths.push(root)
    const db = new AgentDatabase({
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    })

    expect(db.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(
      db.sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'view' AND name = ?")
        .get(SEMANTIC_VIEW_NAME),
    ).toEqual({ name: SEMANTIC_VIEW_NAME })
    const columns = (
      db.sqlite.query(`PRAGMA table_info(${SEMANTIC_VIEW_NAME})`).all() as Array<{ name: string }>
    ).map(({ name }) => name)
    expect(columns).toEqual([...SEMANTIC_VIEW_COLUMNS])
    expect(() =>
      db.sqlite
        .query(`INSERT INTO ${SEMANTIC_VIEW_NAME} (thread_id, thread_title) VALUES ('x', 'y')`)
        .run(),
    ).toThrow()
    db.close()
  })

  test('schema 36 前向迁移到 37 保留原数据并新增语义历史视图', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v36-to-v37-'))
    paths.push(root)
    const databasePaths = {
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    const db = new AgentDatabase(databasePaths)
    const thread = db.createThread('迁移保留会话')
    const turn = db.createTurn(thread.id, semanticSubmit('迁移保留的输入'), 'completed')
    const textItemID = 'item:migration:text'
    db.upsertItemWithEvent(
      thread.id,
      {
        id: textItemID,
        turnID: turn.turnID,
        agentID: turn.agentID,
        type: 'text',
        status: 'completed',
        data: { placement: 'result', text: '迁移保留的助手回复' },
        createdAt: 1000,
        updatedAt: 1000,
      },
      'item/completed',
    )
    db.close()

    // 模拟升级前仍停留在 schema 36：删除视图并回退 user_version。
    const legacy = new Database(databasePaths.historyPath)
    legacy.exec(
      `DROP VIEW IF EXISTS ${SEMANTIC_VIEW_NAME}; PRAGMA user_version = ${SEMANTIC_VIEW_VERSION - 1};`,
    )
    legacy.close()

    const migrated = new AgentDatabase(databasePaths)
    expect(migrated.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(migrated.getThread(thread.id)?.title).toBe('迁移保留会话')
    expect(
      migrated.sqlite.query('SELECT data FROM items WHERE id = ?').get(textItemID),
    ).toMatchObject({
      data: expect.stringContaining('迁移保留的助手回复'),
    })
    expect(
      migrated.sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'view' AND name = ?")
        .get(SEMANTIC_VIEW_NAME),
    ).toEqual({ name: SEMANTIC_VIEW_NAME })
    const rows = migrated.sqlite
      .query(`SELECT role, kind, content FROM ${SEMANTIC_VIEW_NAME} WHERE thread_id = ?`)
      .all(thread.id) as Array<{ role: string; kind: string; content: string }>
    expect(rows).toContainEqual({ role: 'user', kind: 'message', content: '迁移保留的输入' })
    expect(rows).toContainEqual({ role: 'assistant', kind: 'text', content: '迁移保留的助手回复' })
    migrated.close()
  })

  test('schema 37 顺序迁移到当前版本并新增任务上下文表且保留未知对象', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v37-to-v38-'))
    paths.push(root)
    const databasePaths = {
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    new AgentDatabase(databasePaths).close()
    const legacy = new Database(databasePaths.historyPath)
    for (const table of [
      'task_context_promotion_jobs',
      'task_context_memory_promotions',
      'task_context_operations',
      'task_context_ai_proposals',
      'task_context_evidence',
      'task_context_entries',
      'task_context_state',
    ])
      legacy.exec(`DROP TABLE ${table}`)
    legacy.exec(
      "CREATE TABLE future_extension (id TEXT PRIMARY KEY, value TEXT); INSERT INTO future_extension VALUES ('kept', 'unknown'); PRAGMA user_version = 37;",
    )
    legacy.close()

    const migrated = new AgentDatabase(databasePaths)
    expect(migrated.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(
      (
        migrated.sqlite
          .query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'task_context_%'",
          )
          .all() as Array<{ name: string }>
      )
        .map((row) => row.name)
        .sort(),
    ).toEqual([
      'task_context_ai_proposals',
      'task_context_entries',
      'task_context_evidence',
      'task_context_memory_promotions',
      'task_context_operations',
      'task_context_promotion_jobs',
      'task_context_state',
    ])
    expect(migrated.sqlite.query('SELECT * FROM future_extension').get()).toEqual({
      id: 'kept',
      value: 'unknown',
    })
    migrated.close()
  })

  test('schema 38 前向迁移到当前版本新增任务规划和会话组表并保留未知对象', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v38-to-v39-'))
    paths.push(root)
    const databasePaths = {
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    new AgentDatabase(databasePaths).close()
    const legacy = new Database(databasePaths.historyPath)
    for (const table of [
      'taskboard_archive_batch_tasks',
      'taskboard_archive_batches',
      'taskboard_blockers',
      'taskboard_plan_dependencies',
      'taskboard_plan_items',
    ])
      legacy.exec(`DROP TABLE ${table}`)
    legacy.exec(
      "CREATE TABLE future_planning_extension (id TEXT PRIMARY KEY, value TEXT); INSERT INTO future_planning_extension VALUES ('kept', 'unknown'); PRAGMA user_version = 38;",
    )
    legacy.close()

    const migrated = new AgentDatabase(databasePaths)
    expect(migrated.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(
      (
        migrated.sqlite
          .query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('taskboard_plan_items','taskboard_plan_dependencies','taskboard_blockers','taskboard_archive_batches','taskboard_archive_batch_tasks')",
          )
          .all() as Array<{ name: string }>
      )
        .map((row) => row.name)
        .sort(),
    ).toEqual([
      'taskboard_archive_batch_tasks',
      'taskboard_archive_batches',
      'taskboard_blockers',
      'taskboard_plan_dependencies',
      'taskboard_plan_items',
    ])
    expect(migrated.sqlite.query('SELECT * FROM future_planning_extension').get()).toEqual({
      id: 'kept',
      value: 'unknown',
    })
    migrated.close()
  })

  test('语义历史视图按线程返回 inputs/result 文本/plan/tool 并排除 reasoning 与 process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-semantic-history-'))
    paths.push(root)
    const db = new AgentDatabase({
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    })
    const workspaceRoot = join(root, 'workspace')
    const cwd = join(workspaceRoot, 'work')
    const thread = db.createThread({
      id: 'thread:semantic',
      title: '语义历史会话',
      workspace: {
        kind: 'projectless',
        workspaceRoot,
        cwd,
        outputDirectory: join(workspaceRoot, 'outputs'),
      },
    })
    const turn1 = db.createTurn(thread.id, semanticSubmit('用户第一条消息'), 'completed', {
      inputID: 'input:semantic:1',
    })
    const turn2 = db.createTurn(thread.id, semanticSubmit('用户第二条消息'), 'completed', {
      inputID: 'input:semantic:2',
    })
    const setTurnTime = (turnID: string, inputID: string, createdAt: number) => {
      db.sqlite
        .query(
          'UPDATE turns SET created_at = ?, updated_at = ?, started_at = ?, finished_at = ? WHERE id = ?',
        )
        .run(createdAt, createdAt, createdAt, createdAt + 1000, turnID)
      db.sqlite.query('UPDATE inputs SET created_at = ? WHERE id = ?').run(createdAt, inputID)
    }
    setTurnTime(turn1.turnID, turn1.inputID, 1000)
    setTurnTime(turn2.turnID, turn2.inputID, 2000)
    seedSemanticBoundary(db, {
      turnID: turn1.turnID,
      threadID: thread.id,
      agentID: turn1.agentID,
      sessionID: 'session:semantic:1',
      entryID: 'entry:semantic:1',
      createdAt: 1000,
    })
    seedSemanticBoundary(db, {
      turnID: turn2.turnID,
      threadID: thread.id,
      agentID: turn2.agentID,
      sessionID: 'session:semantic:2',
      entryID: 'entry:semantic:2',
      createdAt: 2000,
    })

    const longOutput = 'X'.repeat(TOOL_OUTPUT_SUMMARY_LIMIT + 1000)
    db.upsertItemWithEvent(
      thread.id,
      {
        id: 'item:semantic:1:reasoning',
        turnID: turn1.turnID,
        agentID: turn1.agentID,
        type: 'reasoning',
        status: 'completed',
        data: { text: 'MUST_NOT_APPEAR_REASONING' },
        createdAt: 1001,
        updatedAt: 1001,
      },
      'item/completed',
    )
    db.upsertItemWithEvent(
      thread.id,
      {
        id: 'item:semantic:1:process',
        turnID: turn1.turnID,
        agentID: turn1.agentID,
        type: 'text',
        status: 'completed',
        data: { placement: 'process', text: 'MUST_NOT_APPEAR_PROCESS' },
        createdAt: 1002,
        updatedAt: 1002,
      },
      'item/completed',
    )
    db.upsertItemWithEvent(
      thread.id,
      {
        id: 'item:semantic:1:result',
        turnID: turn1.turnID,
        agentID: turn1.agentID,
        type: 'text',
        status: 'completed',
        data: { placement: 'result', text: '第一条助手回复' },
        createdAt: 1003,
        updatedAt: 1003,
      },
      'item/completed',
    )
    db.upsertItemWithEvent(
      thread.id,
      {
        id: 'item:semantic:1:plan',
        turnID: turn1.turnID,
        agentID: turn1.agentID,
        type: 'plan',
        status: 'completed',
        data: { title: '实施计划', markdown: '# 第一步\n执行 A' },
        createdAt: 1004,
        updatedAt: 1004,
      },
      'item/completed',
    )
    db.upsertItemWithEvent(
      thread.id,
      {
        id: 'item:semantic:1:tool-short',
        turnID: turn1.turnID,
        agentID: turn1.agentID,
        type: 'tool',
        status: 'completed',
        data: { tool: 'Read', title: '读取文件', output: '文件内容很短' },
        createdAt: 1005,
        updatedAt: 1005,
      },
      'item/completed',
    )
    db.upsertItemWithEvent(
      thread.id,
      {
        id: 'item:semantic:1:tool-long',
        turnID: turn1.turnID,
        agentID: turn1.agentID,
        type: 'tool',
        status: 'completed',
        data: { tool: 'Bash', title: '执行命令', output: longOutput },
        createdAt: 1006,
        updatedAt: 1006,
      },
      'item/completed',
    )
    db.upsertItemWithEvent(
      thread.id,
      {
        id: 'item:semantic:2:reasoning',
        turnID: turn2.turnID,
        agentID: turn2.agentID,
        type: 'reasoning',
        status: 'completed',
        data: { text: 'MUST_NOT_APPEAR_REASONING_2' },
        createdAt: 2001,
        updatedAt: 2001,
      },
      'item/completed',
    )
    db.upsertItemWithEvent(
      thread.id,
      {
        id: 'item:semantic:2:result',
        turnID: turn2.turnID,
        agentID: turn2.agentID,
        type: 'text',
        status: 'completed',
        data: { placement: 'result', text: '第二条助手回复' },
        createdAt: 2002,
        updatedAt: 2002,
      },
      'item/completed',
    )
    db.upsertItemWithEvent(
      thread.id,
      {
        id: 'item:semantic:2:tool',
        turnID: turn2.turnID,
        agentID: turn2.agentID,
        type: 'tool',
        status: 'completed',
        data: { tool: 'Grep', title: '搜索符号', output: '非截断工具输出' },
        createdAt: 2003,
        updatedAt: 2003,
      },
      'item/completed',
    )

    const rows = db.sqlite
      .query(`SELECT * FROM ${SEMANTIC_VIEW_NAME} WHERE thread_id = ? ORDER BY sort_order`)
      .all(thread.id) as Array<Record<string, string | number | null>>
    expect(rows).toHaveLength(8)
    for (const row of rows) {
      expect(row.thread_id).toBe(thread.id)
      expect(row.thread_title).toBe('语义历史会话')
      expect(row.workspace_cwd).toBe(cwd)
      expect(() => JSON.parse(String(row.metadata_json))).not.toThrow()
    }
    const kinds = rows.map((row) => String(row.kind))
    expect(kinds.filter((kind) => kind === 'message')).toHaveLength(2)
    expect(kinds.filter((kind) => kind === 'text')).toHaveLength(2)
    expect(kinds.filter((kind) => kind === 'plan')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'tool')).toHaveLength(3)
    expect(rows.some((row) => String(row.kind) === 'reasoning')).toBe(false)
    expect(rows.map((row) => String(row.content)).join('\n')).not.toContain('MUST_NOT_APPEAR')
    expect(
      rows.filter((row) => String(row.kind) === 'message').map((row) => String(row.role)),
    ).toEqual(['user', 'user'])
    expect(
      rows
        .filter((row) => String(row.kind) !== 'message')
        .every((row) => String(row.role) === 'assistant'),
    ).toBe(true)

    const byContent = new Map<string, Record<string, string | number | null>>()
    for (const row of rows) byContent.set(String(row.content), row)
    const result1 = byContent.get('第一条助手回复')!
    expect(result1.kind).toBe('text')
    expect(result1.role).toBe('assistant')
    expect(result1.entry_id).toBe('entry:semantic:1')
    expect(result1.agent_id).toBe(turn1.agentID)
    const result2 = byContent.get('第二条助手回复')!
    expect(result2.entry_id).toBe('entry:semantic:2')
    const plan = byContent.get('# 第一步\n执行 A')!
    expect(plan.kind).toBe('plan')
    expect(plan.entry_id).toBe('entry:semantic:1')

    const shortMeta = JSON.parse(String(byContent.get('读取文件')!.metadata_json)) as Record<
      string,
      unknown
    >
    expect(shortMeta.output_summary).toBe('文件内容很短')
    expect(Boolean(shortMeta.output_truncated)).toBe(false)
    const longMeta = JSON.parse(String(byContent.get('执行命令')!.metadata_json)) as Record<
      string,
      unknown
    >
    expect(String(longMeta.output_summary)).toHaveLength(TOOL_OUTPUT_SUMMARY_LIMIT)
    expect(longMeta.output_summary).not.toBe(longOutput)
    expect(Boolean(longMeta.output_truncated)).toBe(true)
    const shortMeta2 = JSON.parse(String(byContent.get('搜索符号')!.metadata_json)) as Record<
      string,
      unknown
    >
    expect(shortMeta2.output_summary).toBe('非截断工具输出')
    expect(Boolean(shortMeta2.output_truncated)).toBe(false)

    const createdAts = rows.map((row) => Number(row.created_at))
    expect([...createdAts]).toEqual([...createdAts].sort((a, b) => a - b))
    const sortOrders = rows.map((row) => Number(row.sort_order))
    expect(new Set(sortOrders).size).toBe(rows.length)
    expect(rows[0]?.kind).toBe('message')
    expect(rows[0]?.content).toBe('用户第一条消息')
    db.close()
  })

  test('更高未知 history schema 保留 user_version 与未知对象且不降级', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-history-v37-future-'))
    paths.push(root)
    const databasePaths = {
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    const initial = new AgentDatabase(databasePaths)
    const existing = initial.createThread('更高未知 schema 保留会话')
    initial.close()

    const futureVersion = SCHEMA_VERSION + 1
    const future = new Database(databasePaths.historyPath)
    future.exec(`
      ALTER TABLE threads ADD COLUMN future_semantic_note TEXT;
      CREATE TABLE future_semantic_records (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      INSERT INTO future_semantic_records VALUES ('future:1', '{"keep":true}');
      UPDATE threads SET future_semantic_note = 'keep' WHERE id = '${existing.id}';
      PRAGMA user_version = ${futureVersion};
    `)
    future.close()

    const reopened = new AgentDatabase(databasePaths)
    expect(reopened.getThread(existing.id)?.title).toBe('更高未知 schema 保留会话')
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: futureVersion,
    })
    expect(
      reopened.sqlite
        .query("SELECT payload FROM future_semantic_records WHERE id = 'future:1'")
        .get(),
    ).toEqual({ payload: '{"keep":true}' })
    expect(
      reopened.sqlite
        .query('SELECT future_semantic_note FROM threads WHERE id = ?')
        .get(existing.id),
    ).toEqual({ future_semantic_note: 'keep' })
    reopened.close()
  })
})
