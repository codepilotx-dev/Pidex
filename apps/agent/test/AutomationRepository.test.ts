import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import type { ModelRef } from '@pidex/shared/model'
import { AutomationRepository } from '../src/storage/repositories/AutomationRepository'

const schema = `
CREATE TABLE projects (id TEXT PRIMARY KEY, removed_at INTEGER);
CREATE TABLE automations (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL,
  status TEXT NOT NULL, project_id TEXT, target_thread_id TEXT, execution TEXT, model_ref TEXT NOT NULL, reasoning_effort TEXT,
  permission_config TEXT NOT NULL, schedule TEXT NOT NULL, canonical_rrule TEXT NOT NULL, time_zone TEXT NOT NULL,
  notification_policy TEXT NOT NULL, next_run_at INTEGER, pending_catch_up INTEGER NOT NULL DEFAULT 0, active_run_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, trigger TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL, status TEXT NOT NULL, thread_id TEXT, turn_id TEXT, worktree_id TEXT, read_at INTEGER,
  safe_error_code TEXT, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER
);
CREATE UNIQUE INDEX automation_runs_one_active ON automation_runs(automation_id)
WHERE status IN ('claimed','preparing','queued','running');
`

const fixture = () => {
  const sqlite = new Database(':memory:', { strict: true })
  const profileSqlite = new Database(':memory:', { strict: true })
  sqlite.exec(
    schema.replace('CREATE TABLE projects (id TEXT PRIMARY KEY, removed_at INTEGER);', ''),
  )
  profileSqlite.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, removed_at INTEGER);')
  profileSqlite.query('INSERT INTO projects (id, removed_at) VALUES (?, NULL)').run('project:1')
  let sequence = 0
  const database = {
    sqlite,
    profileSqlite,
    transaction: <T>(work: () => T) => sqlite.transaction(work)(),
  }
  return {
    sqlite,
    profileSqlite,
    repository: new AutomationRepository(database, () => `run:${++sequence}`),
  }
}

const model = { providerID: 'openai', id: 'codex' } as unknown as ModelRef
const record = (id: string, nextRunAt: number | null) => ({
  id,
  kind: 'standalone' as const,
  name: '每日检查',
  prompt: '检查工作区',
  projectId: 'project:1',
  targetThreadId: null,
  execution: { kind: 'local' as const },
  model,
  reasoningEffort: null,
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'never' as const,
    approvalsReviewer: 'user' as const,
  },
  schedule: { mode: 'daily' as const, time: '09:00' },
  canonicalRrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
  timeZone: 'Asia/Shanghai',
  notificationPolicy: 'all' as const,
  nextRunAt,
})

describe('AutomationRepository', () => {
  test('CRUD 使用 revision CAS、profile 项目检查并软删除', () => {
    const { repository, sqlite, profileSqlite } = fixture()
    expect(repository.projectAvailable('project:1')).toBe(true)
    const created = repository.create(record('automation:1', 100), 1)
    const paused = repository.pause(created.id, created.revision, 2)
    expect(paused).toMatchObject({ revision: 2, status: 'paused', nextRunAt: null })
    expect(() => repository.resume(created.id, 1, 200, 3)).toThrow()
    const resumed = repository.resume(created.id, paused.revision, 200, 3)
    expect(repository.softDelete(created.id, resumed.revision, 4)).toMatchObject({
      status: 'deleted',
      deletedAt: 4,
    })
    expect(repository.read(created.id)).toBeNull()
    sqlite.close()
    profileSqlite.close()
  })

  test('错过多个周期只 claim 一次并推进 nextRunAt', () => {
    const { repository, sqlite, profileSqlite } = fixture()
    repository.create(record('automation:due', Date.parse('2026-08-20T01:00:00Z')), 1)
    const now = Date.parse('2026-08-25T01:30:00Z')
    const first = repository.claimDue(now, 'startup-catch-up')
    expect(first).toHaveLength(1)
    expect(first[0]?.trigger).toBe('startup-catch-up')
    expect(repository.claimDue(now, 'startup-catch-up')).toHaveLength(0)
    expect(repository.read('automation:due')!.nextRunAt).toBeGreaterThan(now)
    sqlite.close()
    profileSqlite.close()
  })

  test('多次重叠只合并成一个 catch-up', () => {
    const { repository, sqlite, profileSqlite } = fixture()
    repository.create(record('automation:overlap', 100), 1)
    const [run] = repository.claimDue(100)
    repository.claimDue(Date.parse('2026-08-26T01:00:00Z'))
    repository.claimDue(Date.parse('2026-08-27T01:00:00Z'))
    expect(repository.read('automation:overlap')!.pendingCatchUp).toBe(true)
    const completed = repository.completeRun(run!.id, 'completed', 300)
    expect(completed.catchUpRun?.trigger).toBe('overlap-catch-up')
    expect(repository.completeRun(run!.id, 'completed', 301).catchUpRun).toBeNull()
    expect(repository.listActiveRuns()).toHaveLength(1)
    sqlite.close()
    profileSqlite.close()
  })

  test('立即运行 operation id 幂等且终态默认未读', () => {
    const { repository, sqlite, profileSqlite } = fixture()
    repository.create(record('automation:manual', null), 1)
    const run = repository.claimManual('automation:manual', 'operation:1', 10)
    expect(repository.claimManual('automation:manual', 'operation:1', 11).id).toBe(run.id)
    expect(
      repository.completeRun(run.id, 'failed', 12, 'AUTOMATION_EXECUTION_FAILED').run,
    ).toMatchObject({
      status: 'failed',
      readAt: null,
      safeErrorCode: 'AUTOMATION_EXECUTION_FAILED',
    })
    expect(repository.markAllRunsRead(13)).toBe(1)
    sqlite.close()
    profileSqlite.close()
  })
})
