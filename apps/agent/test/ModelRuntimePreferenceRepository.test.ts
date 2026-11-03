import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { removeFixturePaths } from './FixtureCleanup'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { Database } from 'bun:sqlite'
import { SchemaInitializer } from '../src/storage/database/SchemaInitializer'
import { SCHEMA_VERSION } from '../src/storage/database/Schema'

const databases: AgentDatabase[] = []
const rawDatabases: Database[] = []
const paths: string[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  for (const raw of rawDatabases.splice(0)) raw.close()
  await removeFixturePaths(paths.splice(0))
})

const makeDb = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cpx-model-pref-test-'))
  paths.push(dir)
  const historyPath = join(dir, 'history.sqlite')
  const db = new AgentDatabase(historyPath)
  databases.push(db)
  return { db, historyPath }
}

describe('ModelRuntimePreferenceRepository & Context Limit Storage', () => {
  test('persists and retrieves model runtime preferences', async () => {
    const { db } = await makeDb()
    const repo = db.repositories.modelRuntimePreferences
    expect(repo.available()).toBe(true)

    expect(repo.get('anthropic', 'claude-3-7-sonnet')).toBeNull()

    const created = repo.set({
      providerId: 'anthropic',
      modelId: 'claude-3-7-sonnet',
      variant: 'high',
      maxContextTokens: 200_000,
    })
    expect(created).toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-3-7-sonnet',
      variant: 'high',
      maxContextTokens: 200_000,
    })

    const retrieved = repo.get('anthropic', 'claude-3-7-sonnet')
    expect(retrieved).toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-3-7-sonnet',
      variant: 'high',
      maxContextTokens: 200_000,
    })

    const updated = repo.set({
      providerId: 'anthropic',
      modelId: 'claude-3-7-sonnet',
      variant: 'medium',
    })
    expect(updated.variant).toBe('medium')
    expect(updated.maxContextTokens).toBe(200_000)

    const list = repo.list()
    expect(list).toHaveLength(1)
    expect(String(list[0]?.modelId)).toBe('claude-3-7-sonnet')
  })

  test('creates thread with maxContextTokens and synchronizes settings in thread_context_limits', async () => {
    const { db } = await makeDb()
    const projection = new ThreadProjection(db)

    const thread = db.createThread({
      title: '上限测试',
      settings: {
        taskMode: 'chat',
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
        },
        maxContextTokens: 500_000,
      },
      workspace: null,
    })
    expect(thread.settings.maxContextTokens).toBe(500_000)

    const settings = db.getThreadSettings(thread.id)
    expect(settings?.maxContextTokens).toBe(500_000)

    const snapshot = projection.snapshot(thread.id)
    expect(snapshot?.thread.settings.maxContextTokens).toBe(500_000)

    const list = projection.list({})
    const item = list.find((t) => t.id === thread.id)
    expect(item?.settings.maxContextTokens).toBe(500_000)

    // Update settings: reduce maxContextTokens
    db.updateThreadSettings(thread.id, { maxContextTokens: 128_000 })
    expect(db.getThreadSettings(thread.id)?.maxContextTokens).toBe(128_000)
    expect(projection.snapshot(thread.id)?.thread.settings.maxContextTokens).toBe(128_000)

    // Clear maxContextTokens by passing null
    db.updateThreadSettings(thread.id, { maxContextTokens: null })
    expect(db.getThreadSettings(thread.id)?.maxContextTokens).toBeUndefined()
    expect(projection.snapshot(thread.id)?.thread.settings.maxContextTokens).toBeUndefined()
  })

  test('migrates history database from schema 67 to 68 without data loss', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cpx-migration-test-'))
    paths.push(dir)
    const dbPath = join(dir, 'test-mig.sqlite')
    const sqlite = new Database(dbPath, { create: true, strict: true })
    rawDatabases.push(sqlite)

    // Initialize up to schema 67 using SchemaInitializer
    // First, let's create basic tables at user_version 67
    new SchemaInitializer(sqlite, 'history').initialize()
    expect(sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
  })
})
