import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Schema } from 'effect'
import { LocalUsageResultSchema } from '@pidex/agent-protocol'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { UsageRepository } from '../src/storage/repositories/UsageRepository'

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(roots.splice(0))
})

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0, cost = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
})

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-usage-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(db)
  const main = db.createThread('main')
  const child = db.createThread('child')
  db.sqlite
    .query("UPDATE threads SET kind = 'subagent', parent_thread_id = ? WHERE id = ?")
    .run(main.id, child.id)
  const insertSession = db.sqlite.query(`
    INSERT INTO pi_sessions (id, thread_id, agent_id, leaf_id, name, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL, ?, ?)
  `)
  const insertEntry = db.sqlite.query(`
    INSERT INTO pi_session_entries (session_id, sequence, id, parent_id, type, payload, created_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?)
  `)
  const now = Date.UTC(2026, 2, 9, 0, 30)
  const addSession = (id: string, threadID: string, entries: Array<Record<string, unknown>>) => {
    insertSession.run(id, threadID, id, now, now)
    entries.forEach((entry, sequence) => {
      const entryID = `${id}-${sequence}`
      const payload: Record<string, unknown> = {
        ...entry,
        id: entryID,
        parentId: sequence ? `${id}-${sequence - 1}` : null,
      }
      insertEntry.run(
        id,
        sequence,
        entryID,
        String(entry.type),
        JSON.stringify(payload),
        Date.parse(String(entry.timestamp)),
      )
    })
  }
  return { db, main, child, now, addSession }
}

describe('UsageRepository', () => {
  test('按 session 关联模型、归并子代理根任务，并按时区自然日聚合 canonical 结果', async () => {
    const { db, main, child, now, addSession } = await setup()
    addSession('main-a', main.id, [
      {
        type: 'model_change',
        provider: 'openai',
        modelId: 'gpt-summary',
        timestamp: '2026-03-03T00:00:00.000Z',
      },
      {
        type: 'message',
        timestamp: '2026-03-03T00:01:00.000Z',
        message: {
          role: 'assistant',
          provider: 'anthropic',
          model: 'claude-answer',
          content: [],
          usage: usage(10, 5, 2, 1, 0.5),
          stopReason: 'stop',
          timestamp: 0,
        },
      },
      {
        type: 'compaction',
        summary: 'hidden',
        tokensBefore: 100,
        usage: usage(4, 2, 0, 0, 0.1),
        timestamp: '2026-03-03T00:02:00.000Z',
      },
    ])
    // Same thread, different Pi session: no model_change means it must be ignored.
    addSession('main-b', main.id, [
      {
        type: 'branch_summary',
        fromId: 'x',
        summary: 'hidden',
        usage: usage(99, 99),
        timestamp: '2026-03-03T00:03:00.000Z',
      },
    ])
    addSession('child-a', child.id, [
      {
        type: 'model_change',
        provider: 'deepseek',
        modelId: 'deepseek-chat',
        timestamp: '2026-03-02T16:00:00.000Z',
      },
      {
        type: 'branch_summary',
        fromId: 'x',
        summary: 'hidden',
        usage: usage(3, 1),
        timestamp: '2026-03-02T16:00:01.000Z',
      },
    ])
    // Asia/Shanghai local 2026-03-02, outside the seven natural-day range.
    addSession('old', main.id, [
      {
        type: 'model_change',
        provider: 'old',
        modelId: 'old',
        timestamp: '2026-03-02T15:59:58.000Z',
      },
      {
        type: 'compaction',
        summary: 'hidden',
        tokensBefore: 1,
        usage: usage(50, 50),
        timestamp: '2026-03-02T15:59:59.000Z',
      },
    ])

    const result = new UsageRepository(db, () => now).getLocalUsage('7d', 'Asia/Shanghai')
    expect(result.totals).toMatchObject({
      inputTokens: 17,
      outputTokens: 8,
      cachedTokens: 3,
      totalTokens: 28,
      estimatedCostUsd: '0.6',
      rootTasks: 1,
      modelResponses: 1,
      providerCalls: 3,
      activeDays: 1,
    })
    expect(result.models.map((item) => [String(item.providerId), String(item.modelId)])).toEqual([
      ['anthropic', 'claude-answer'],
      ['openai', 'gpt-summary'],
      ['deepseek', 'deepseek-chat'],
    ])
    expect(result.daily).toHaveLength(1)
    expect(Object.keys(result.daily[0]!).sort()).toEqual(['date', 'models', 'totals'])
    expect(Schema.decodeUnknownSync(LocalUsageResultSchema)(result)).toEqual(result)
  })

  test('跳过小数、损坏和会导致 SafeInteger 累加溢出的 usage', async () => {
    const { db, main, now, addSession } = await setup()
    addSession('invalid', main.id, [
      { type: 'model_change', provider: 'p', modelId: 'm', timestamp: '2026-03-08T00:00:00.000Z' },
      {
        type: 'compaction',
        summary: '',
        tokensBefore: 1,
        usage: usage(1.5, 2),
        timestamp: '2026-03-08T00:00:01.000Z',
      },
      {
        type: 'compaction',
        summary: '',
        tokensBefore: 1,
        usage: usage(Number.MAX_SAFE_INTEGER, 0),
        timestamp: '2026-03-08T00:00:02.000Z',
      },
      {
        type: 'compaction',
        summary: '',
        tokensBefore: 1,
        usage: usage(1, 0),
        timestamp: '2026-03-08T00:00:03.000Z',
      },
    ])
    const result = new UsageRepository(db, () => now).getLocalUsage('30d', 'UTC')
    expect(result.totals.totalTokens).toBe(Number.MAX_SAFE_INTEGER)
    expect(result.totals.modelResponses).toBe(0)
    expect(result.totals.providerCalls).toBe(1)
  })
})
