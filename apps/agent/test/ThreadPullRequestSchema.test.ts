import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDatabase, SCHEMA_VERSION } from '../src/storage/database/AgentDatabase'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []

afterEach(async () => {
  await removeFixturePaths(paths.splice(0))
})

describe('thread pull request schema', () => {
  test('schema 58 前向迁移到当前版本时保留未知对象并广告 PR 关联能力', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-thread-pr-schema-'))
    paths.push(root)
    const historyPath = join(root, 'history.sqlite')
    const profilePath = join(root, 'profile.sqlite')

    const seeded = new AgentDatabase({ historyPath, profilePath })
    seeded.sqlite.exec(`
      DROP TABLE thread_pull_requests;
      CREATE TABLE future_schema_58_extension (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO future_schema_58_extension VALUES ('kept', 'unknown');
      PRAGMA user_version = 58;
    `)
    seeded.close()

    const migrated = new AgentDatabase({ historyPath, profilePath })
    expect(migrated.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(SCHEMA_VERSION).toBe(60)
    expect(migrated.repositories.threadPullRequests.available()).toBe(true)
    expect(filterAdvertisedCapabilities(migrated)).toContain('github.threadPullRequests.v1')
    expect(
      migrated.sqlite.query("SELECT value FROM future_schema_58_extension WHERE id = 'kept'").get(),
    ).toEqual({ value: 'unknown' })
    migrated.close()
  })

  test('更高未知 schema 缺少 PR 关联表时保持只读能力降级', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-thread-pr-future-schema-'))
    paths.push(root)
    const historyPath = join(root, 'history.sqlite')
    const profilePath = join(root, 'profile.sqlite')

    const seeded = new AgentDatabase({ historyPath, profilePath })
    seeded.sqlite.exec(`
      DROP TABLE thread_pull_requests;
      CREATE TABLE future_pr_owner (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO future_pr_owner VALUES ('kept', 'future');
      PRAGMA user_version = ${SCHEMA_VERSION + 1};
    `)
    seeded.close()

    const reopened = new AgentDatabase({ historyPath, profilePath })
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION + 1,
    })
    expect(
      reopened.sqlite.query("SELECT value FROM future_pr_owner WHERE id = 'kept'").get(),
    ).toEqual({ value: 'future' })
    expect(reopened.repositories.threadPullRequests.available()).toBe(false)
    expect(filterAdvertisedCapabilities(reopened)).not.toContain('github.threadPullRequests.v1')
    reopened.close()
  })
})
