import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { ThreadHistoryService } from '../src/session/ThreadHistoryService'
import { removeFixturePaths } from './FixtureCleanup'

const roots: string[] = []

afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
})

/** Captures every published envelope so we can assert live-vs-durable semantics. */
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-pref-save-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const published: Array<Record<string, unknown>> = []
  const hub = {
    publish: (event: Record<string, unknown>) => {
      published.push(event)
      return Effect.void
    },
  }
  const history = new ThreadHistoryService(db, hub as never)
  const durableCount = (method?: string) => {
    const row = method
      ? (db.sqlite
          .query('SELECT COUNT(*) AS c FROM events WHERE method = ?')
          .get(method) as { c: number })
      : (db.sqlite.query('SELECT COUNT(*) AS c FROM events').get() as { c: number })
    return Number(row.c)
  }
  return { db, history, published, durableCount }
}

describe('saveModelRuntimePreference — 实时事件与持久事件语义', () => {
  test('无会话保存：返回偏好、实时事件有锚点、不新增持久事件', async () => {
    const { db, history, published, durableCount } = await fixture()
    try {
      const persistedBefore = durableCount('provider/modelPreferences/updated')
      const totalBefore = durableCount()
      const result = await history.saveModelRuntimePreference({
        providerId: 'workbuddy',
        modelId: 'hy4-preview',
        variant: 'high',
        maxContextTokens: 96_500,
      })
      expect(result.preference).toMatchObject({ variant: 'high', maxContextTokens: 96_500 })
      expect(db.repositories.modelRuntimePreferences.list()).toMatchObject([
        { providerId: 'workbuddy', modelId: 'hy4-preview', variant: 'high', maxContextTokens: 96_500 },
      ])

      expect(published).toHaveLength(1)
      const live = published[0]!
      expect(live.method).toBe('provider/modelPreferences/updated')
      expect(typeof live.afterSequence).toBe('number')
      expect(live.id).toBe(0)
      expect((live.params as { preference: unknown }).preference).toMatchObject({ variant: 'high' })

      // 实时事件不得写入 events 表，也不再产生任何持久事件。
      expect(durableCount('provider/modelPreferences/updated')).toBe(persistedBefore)
      expect(durableCount()).toBe(totalBefore)
    } finally {
      db.close()
    }
  })

  test('有会话保存：会话设置保持持久事件，偏好仅发实时事件', async () => {
    const { db, history, published, durableCount } = await fixture()
    try {
      const thread = db.createThread('参数保存事务')
      const totalBefore = durableCount()
      await history.saveModelRuntimePreference({
        threadId: thread.id,
        providerId: 'workbuddy',
        modelId: 'hy4-preview',
        maxContextTokens: 128_000,
      })
      expect(db.repositories.threads.getThreadSettings(thread.id)?.maxContextTokens).toBe(128_000)

      // 会话设置事件是唯一新增的持久事件；偏好只发实时事件。
      expect(durableCount()).toBe(totalBefore + 1)
      expect(durableCount('provider/modelPreferences/updated')).toBe(0)
      expect(durableCount('thread/settings/updated')).toBeGreaterThanOrEqual(1)

      const live = published.filter(
        (event) => event.method === 'provider/modelPreferences/updated',
      )
      expect(live).toHaveLength(1)
      expect(typeof live[0]!.afterSequence).toBe('number')
      expect(live[0]!.id).toBe(0)
      const settings = published.filter((event) => event.method === 'thread/settings/updated')
      expect(settings).toHaveLength(1)
      expect(Number(settings[0]!.id)).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  test('清除限制与连续保存：偏好表与会话额度保持一致', async () => {
    const { db, history, published, durableCount } = await fixture()
    try {
      const thread = db.createThread('参数连续保存')
      await history.saveModelRuntimePreference({
        threadId: thread.id,
        providerId: 'workbuddy',
        modelId: 'hy4-preview',
        maxContextTokens: 128_000,
      })
      // 只改思考档位不得覆盖已保存的会话额度。
      await history.saveModelRuntimePreference({
        threadId: thread.id,
        providerId: 'workbuddy',
        modelId: 'hy4-preview',
        variant: 'high',
      })
      expect(db.repositories.threads.getThreadSettings(thread.id)?.maxContextTokens).toBe(128_000)

      // 切回模型默认时删除会话额度行。
      await history.saveModelRuntimePreference({
        threadId: thread.id,
        providerId: 'workbuddy',
        modelId: 'hy4-preview',
        maxContextTokens: null,
      })
      expect(db.repositories.threads.getThreadSettings(thread.id)?.maxContextTokens).toBeUndefined()
      expect(db.repositories.modelRuntimePreferences.list()).toMatchObject([
        { providerId: 'workbuddy', modelId: 'hy4-preview', variant: 'high', maxContextTokens: null },
      ])

      // 每次保存都应发出带锚点的实时偏好事件，且都不写入 events 表。
      const live = published.filter(
        (event) => event.method === 'provider/modelPreferences/updated',
      )
      expect(live).toHaveLength(3)
      for (const event of live) {
        expect(typeof event.afterSequence).toBe('number')
        expect(event.id).toBe(0)
      }
      expect(durableCount('provider/modelPreferences/updated')).toBe(0)
    } finally {
      db.close()
    }
  })
})
