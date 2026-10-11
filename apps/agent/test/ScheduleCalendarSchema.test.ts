import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDatabase, SCHEMA_VERSION } from '../src/storage/database/AgentDatabase'
import {
  probeAutomationStorageCapabilities,
  probeScheduleCalendarStorageCapabilities,
} from '../src/storage/database/StorageCapabilities'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []

afterEach(async () => {
  await removeFixturePaths(paths.splice(0))
})

describe('schedule calendar schema', () => {
  test('schema 42 前向迁移到 43 只新增日历存储', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-schedule-calendar-schema-'))
    paths.push(root)
    const databasePaths = {
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    const seeded = new AgentDatabase(databasePaths)
    seeded.sqlite.exec(`
      DROP TABLE scheduled_tasks;
      DROP TABLE schedule_plan_proposals;
      CREATE TABLE future_schema_42_extension (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO future_schema_42_extension VALUES ('kept', 'unknown');
      PRAGMA user_version = 42;
    `)
    seeded.close()

    const migrated = new AgentDatabase(databasePaths)
    expect(migrated.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(probeScheduleCalendarStorageCapabilities(migrated.sqlite)).toEqual({
      scheduledTasks: true,
      schedulePlanProposals: true,
    })
    expect(probeAutomationStorageCapabilities(migrated.sqlite)).toEqual({
      automations: true,
      automationRuns: true,
    })
    expect(
      migrated.sqlite.query("SELECT value FROM future_schema_42_extension WHERE id = 'kept'").get(),
    ).toEqual({ value: 'unknown' })
    migrated.close()
  })

  test('更高未知 schema 缺少日历表时保持原样并保留 automation 能力', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-schedule-calendar-future-'))
    paths.push(root)
    const databasePaths = {
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }
    const seeded = new AgentDatabase(databasePaths)
    seeded.sqlite.exec(`
      DROP TABLE scheduled_tasks;
      DROP TABLE schedule_plan_proposals;
      CREATE TABLE future_schedule_owner (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO future_schedule_owner VALUES ('kept', 'future');
      PRAGMA user_version = ${SCHEMA_VERSION + 1};
    `)
    seeded.close()

    const reopened = new AgentDatabase(databasePaths)
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION + 1,
    })
    expect(probeScheduleCalendarStorageCapabilities(reopened.sqlite)).toEqual({
      scheduledTasks: false,
      schedulePlanProposals: false,
    })
    expect(probeAutomationStorageCapabilities(reopened.sqlite)).toEqual({
      automations: true,
      automationRuns: true,
    })
    expect(
      reopened.sqlite.query("SELECT value FROM future_schedule_owner WHERE id = 'kept'").get(),
    ).toEqual({ value: 'future' })
    reopened.close()
  })
})
