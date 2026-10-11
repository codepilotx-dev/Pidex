import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDatabase, SCHEMA_VERSION } from '../src/storage/database/AgentDatabase'
import { probeAutomationStorageCapabilities } from '../src/storage/database/StorageCapabilities'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []

afterEach(async () => {
  await removeFixturePaths(paths.splice(0))
})

describe('automation schema', () => {
  test('schema 41 前向迁移到当前版本时保留自动化存储和未知对象', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-automation-schema-'))
    paths.push(root)
    const historyPath = join(root, 'history.sqlite')
    const profilePath = join(root, 'profile.sqlite')

    const seeded = new AgentDatabase({ historyPath, profilePath })
    seeded.sqlite.exec(`
      DROP TABLE automation_runs;
      DROP TABLE automations;
      CREATE TABLE future_schema_41_extension (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO future_schema_41_extension VALUES ('kept', 'unknown');
      PRAGMA user_version = 41;
    `)
    seeded.close()

    const migrated = new AgentDatabase({ historyPath, profilePath })
    expect(migrated.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(SCHEMA_VERSION).toBe(58)
    expect(probeAutomationStorageCapabilities(migrated.sqlite)).toEqual({
      automations: true,
      automationRuns: true,
    })
    expect(filterAdvertisedCapabilities(migrated)).toContain('automation.manage.v1')
    expect(
      migrated.sqlite.query("SELECT value FROM future_schema_41_extension WHERE id = 'kept'").get(),
    ).toEqual({ value: 'unknown' })
    migrated.close()
  })

  test('更高未知 schema 缺少自动化表时保持只读能力降级', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-automation-future-schema-'))
    paths.push(root)
    const historyPath = join(root, 'history.sqlite')
    const profilePath = join(root, 'profile.sqlite')

    const seeded = new AgentDatabase({ historyPath, profilePath })
    seeded.sqlite.exec(`
      DROP TABLE automation_runs;
      DROP TABLE automations;
      CREATE TABLE future_automation_owner (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO future_automation_owner VALUES ('kept', 'future');
      PRAGMA user_version = ${SCHEMA_VERSION + 1};
    `)
    seeded.close()

    const reopened = new AgentDatabase({ historyPath, profilePath })
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION + 1,
    })
    expect(
      reopened.sqlite.query("SELECT value FROM future_automation_owner WHERE id = 'kept'").get(),
    ).toEqual({ value: 'future' })
    expect(probeAutomationStorageCapabilities(reopened.sqlite)).toEqual({
      automations: false,
      automationRuns: false,
    })
    expect(filterAdvertisedCapabilities(reopened)).not.toContain('automation.manage.v1')
    reopened.close()
  })
})
