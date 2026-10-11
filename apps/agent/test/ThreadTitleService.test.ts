import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Api, Model as PiModel } from '@earendil-works/pi-ai'
import type { Model } from '@pidex/model-schema'
import { decodeEventEnvelope } from '@pidex/agent-protocol'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentLogger } from '../src/observability/AgentLogger'
import type { PiModelService } from '../src/provider/pi/PiModelService'
import { ThreadHistoryService } from '../src/session/ThreadHistoryService'
import {
  THREAD_TITLE_MAX_LENGTH,
  ThreadTitleService,
  normalizeThreadTitle,
} from '../src/session/ThreadTitleService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { buildEventNextNotification } from '../src/transport/EventEnvelope'
import { ThreadProjection } from '../src/transport/ThreadProjection'

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-thread-title-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(db)
  const hub = await Effect.runPromise(EventHub.make)
  const history = new ThreadHistoryService(db, hub)
  const logger = new AgentLogger(join(root, 'logs'))
  return { db, history, logger }
}

const config = {
  snapshot: () => ({
    model_provider: 'provider:test',
    model: 'fast',
    desktop: { recent_new_thread_model: { providerID: 'provider:test', id: 'fast' } },
    specialized_models: { generation: 'provider:test/small' },
  }),
  read: async () => ({
    config: {
      model_provider: 'provider:test',
      model: 'fast',
      desktop: { recent_new_thread_model: { providerID: 'provider:test', id: 'fast' } },
      specialized_models: { generation: 'provider:test/small' },
    },
  }),
} as never

const addUserMessage = (db: AgentDatabase, threadID: string, content: string) => {
  return db.createTurn(threadID, {
    content,
    model: { providerID: 'provider:test', id: 'fast' } as Model.Ref,
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    },
    strategy: 'queue',
    taskMode: 'chat',
  })
}

describe('ThreadTitleService', () => {
  test('uses the generation-model fallback chain and persists a normalized 20-character title', async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread()
    addUserMessage(db, thread.id, '# 修复设置页下拉框文字消失并统一选项布局')
    const activityAt = history.getListItem(thread.id)!.updatedAt
    const attemptedModels: string[] = []
    const models = {
      pi: {},
      getPiModel: async (ref: Model.Ref) => {
        attemptedModels.push(String(ref.id))
        if (String(ref.id) === 'small') throw new Error('unavailable')
        return { provider: 'provider:test', id: 'fast' } as PiModel<Api>
      },
    } as unknown as Pick<PiModelService, 'pi' | 'getPiModel'>
    const service = new ThreadTitleService(db, history, models, logger, config, {
      generate: async () => ({
        title: '# 这是一个非常非常长的会话标题用于验证统一截断行为',
      }),
    })

    await service.generateForFirstMessage(thread.id, '# 修复设置页下拉框文字消失并统一选项布局')

    const title = history.getListItem(thread.id)?.title ?? ''
    expect(attemptedModels).toEqual(['small', 'fast'])
    expect(title.startsWith('#')).toBe(false)
    expect(Array.from(title)).toHaveLength(THREAD_TITLE_MAX_LENGTH)
    expect(title.endsWith('…')).toBe(true)
    expect(history.getListItem(thread.id)?.updatedAt).toBe(activityAt)
  })

  test('persists a deterministic fallback when no generation model is configured', async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread()
    const content = '> **修复普通下拉框文字消失并保持现有交互行为**'
    addUserMessage(db, thread.id, content)
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => {
          throw new Error('unexpected')
        },
      } as never,
      logger,
    )

    await service.generateForFirstMessage(thread.id, content)

    expect(history.getListItem(thread.id)?.title).toBe(normalizeThreadTitle(content))
    expect(history.getListItem(thread.id)?.title).not.toContain('*')
  })

  test('persists the fallback when title generation times out', async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread()
    const content = '修复标题生成超时后的回退行为'
    addUserMessage(db, thread.id, content)
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: 'provider:test', id: 'small' }) as PiModel<Api>,
      } as never,
      logger,
      config,
      {
        timeoutMs: 5,
        generate: async ({ signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      },
    )

    await service.generateForFirstMessage(thread.id, content)

    expect(history.getListItem(thread.id)?.title).toBe(content)
  })

  test('persists the fallback when generated output is invalid', async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread()
    const content = '修复无效标题输出的回退行为'
    addUserMessage(db, thread.id, content)
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: 'provider:test', id: 'small' }) as PiModel<Api>,
      } as never,
      logger,
      config,
      { generate: async () => ({ title: '   ' }) },
    )

    await service.generateForFirstMessage(thread.id, content)

    expect(history.getListItem(thread.id)?.title).toBe(content)
  })

  test('does not overwrite a manual rename while title generation is in flight', async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread()
    addUserMessage(db, thread.id, '实现异步标题')
    let resolveGenerated!: (value: { title: string }) => void
    const generated = new Promise<{ title: string }>((resolve) => {
      resolveGenerated = resolve
    })
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: 'provider:test', id: 'small' }) as PiModel<Api>,
      } as never,
      logger,
      config,
      { generate: async () => generated },
    )

    const pending = service.generateForFirstMessage(thread.id, '实现异步标题')
    await history.patch(thread.id, { title: '用户手工标题' })
    resolveGenerated({ title: '模型生成标题' })
    await pending

    expect(history.getListItem(thread.id)?.title).toBe('用户手工标题')
  })

  test('skips explicit titles and threads that already contain multiple messages', async () => {
    const { db, history, logger } = await fixture()
    let generated = 0
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: 'provider:test', id: 'small' }) as PiModel<Api>,
      } as never,
      logger,
      config,
      {
        generate: async () => {
          generated += 1
          return { title: '不应生成' }
        },
      },
    )
    const explicit = db.createThread('技能会话标题')
    addUserMessage(db, explicit.id, '第一条')
    await service.generateForFirstMessage(explicit.id, '第一条')
    const multiple = db.createThread()
    addUserMessage(db, multiple.id, '第一条')
    addUserMessage(db, multiple.id, '第二条')
    await service.generateForFirstMessage(multiple.id, '第二条')

    expect(generated).toBe(0)
    expect(history.getListItem(explicit.id)?.title).toBe('技能会话标题')
    expect(history.getListItem(multiple.id)?.title).toBe('新对话')
  })

  test('regenerates from the first task and recent completed conversation', async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread('用户旧标题')
    const baseTimestamp = Date.now()
    const addCompletedTurn = (content: string, ordinal: number) => {
      const turn = addUserMessage(db, thread.id, content)
      db.sqlite
        .query('UPDATE turns SET created_at = ?, updated_at = ? WHERE id = ?')
        .run(baseTimestamp + ordinal, baseTimestamp + ordinal, turn.turnID)
      db.updateTurnStatus(turn.turnID, 'completed')
      return turn
    }
    addCompletedTurn('修复会话标题更新只关注最后一轮的问题', 1)
    addCompletedTurn('窗口外的普通中间内容不应进入标题上下文', 2)
    for (let index = 3; index <= 7; index += 1) {
      addCompletedTurn(`继续完善会话标题主线识别 ${index}`, index)
    }
    const latest = addCompletedTurn('帮我上传代码到 Git', 8)
    const timestamp = baseTimestamp + 100
    db.upsertItem(thread.id, {
      id: 'latest-result',
      turnID: latest.turnID,
      agentID: latest.agentID,
      type: 'text',
      status: 'completed',
      data: { placement: 'result', text: '代码已经推送，但本次会话的主要成果是修复标题主线识别' },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    db.upsertItem(thread.id, {
      id: 'latest-tool',
      turnID: latest.turnID,
      agentID: latest.agentID,
      type: 'tool',
      status: 'completed',
      data: { tool: 'Shell', output: '工具输出不应进入标题上下文' },
      createdAt: timestamp + 1,
      updatedAt: timestamp + 1,
    })
    const activityAt = history.getListItem(thread.id)!.updatedAt
    let receivedPrompt = ''
    let receivedSystem = ''
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: 'provider:test', id: 'small' }) as PiModel<Api>,
      } as never,
      logger,
      config,
      {
        generate: async ({ prompt, system }) => {
          receivedPrompt = prompt
          receivedSystem = system
          return { title: '修复标题主线识别' }
        },
      },
    )

    const updated = await service.regenerateFromConversation(thread.id)

    expect(updated.title).toBe('修复标题主线识别')
    expect(receivedPrompt).toContain('首轮任务（主线锚点）')
    expect(receivedPrompt).toContain('修复会话标题更新只关注最后一轮的问题')
    expect(receivedPrompt).toContain('帮我上传代码到 Git')
    expect(receivedPrompt).toContain('主要成果是修复标题主线识别')
    expect(receivedPrompt).not.toContain('窗口外的普通中间内容')
    expect(receivedPrompt).not.toContain('工具输出')
    expect(receivedSystem).toContain('整个会话贯穿始终的主要目标')
    expect(receivedSystem).toContain('推送')
    expect(receivedSystem).toContain('不得取代主任务成为标题')
    expect(updated.updatedAt).toBe(activityAt)
    const lastEvent = db.eventsAfter(0).at(-1)
    expect(lastEvent?.method).toBe('thread/updated')
    const envelope = buildEventNextNotification({
      subscriptionId: 'sub-title',
      streamId: 'thread',
      event: lastEvent!,
      projection: new ThreadProjection(db),
    })
    expect(envelope).not.toBeNull()
    const decoded = decodeEventEnvelope(envelope!.params.event)
    expect(decoded.type).toBe('thread/updated')
    expect(decoded.payload).toMatchObject({
      thread: { id: thread.id, title: '修复标题主线识别' },
      version: updated.updatedAt,
    })
    expect((decoded.payload as { thread: { title: string } }).thread.title.length).toBeGreaterThan(
      0,
    )
  })

  test('explicit regeneration does not overwrite concurrent rename', async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread('原手工标题')
    const turn = addUserMessage(db, thread.id, '# 最新用户内容用于确定性回退')
    db.updateTurnStatus(turn.turnID, 'completed')
    let resolveGenerated!: (value: { title: string }) => void
    const generated = new Promise<{ title: string }>((resolve) => {
      resolveGenerated = resolve
    })
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: 'provider:test', id: 'small' }) as PiModel<Api>,
      } as never,
      logger,
      config,
      { generate: async () => generated },
    )

    const pending = service.regenerateFromConversation(thread.id)
    await history.patch(thread.id, { title: '并发手工标题' })
    resolveGenerated({ title: '模型刷新标题' })
    const updated = await pending

    expect(updated.title).toBe('并发手工标题')
    expect(history.getListItem(thread.id)?.title).toBe('并发手工标题')
  })

  test('explicit regeneration rejects on failure and keeps the current title unchanged', async () => {
    const { db, history, logger } = await fixture()
    const thread = db.createThread('原手工标题')
    const turn = addUserMessage(db, thread.id, '完成的会话内容')
    db.updateTurnStatus(turn.turnID, 'completed')

    // 1. 未配置模型 -> MODEL_UNAVAILABLE
    const unconfigured = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => {
          throw new Error('unavailable')
        },
      } as never,
      logger,
    )
    const eventCountBefore = db.eventsAfter(0).length
    await expect(unconfigured.regenerateFromConversation(thread.id)).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      message: '未配置可用的会话标题生成模型',
    })
    expect(history.getListItem(thread.id)?.title).toBe('原手工标题')
    expect(db.eventsAfter(0)).toHaveLength(eventCountBefore)

    // 2. 超时 -> INTERNAL_ERROR
    const timeoutService = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: 'provider:test', id: 'small' }) as PiModel<Api>,
      } as never,
      logger,
      config,
      {
        timeoutMs: 5,
        generate: async ({ signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      },
    )
    await expect(timeoutService.regenerateFromConversation(thread.id)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '生成会话标题超时，请重试',
    })
    expect(history.getListItem(thread.id)?.title).toBe('原手工标题')
    expect(db.eventsAfter(0)).toHaveLength(eventCountBefore)

    // 3. Provider 失败 -> INTERNAL_ERROR
    const providerFailureService = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: 'provider:test', id: 'small' }) as PiModel<Api>,
      } as never,
      logger,
      config,
      {
        generate: async () => {
          throw new Error('internal provider error: credentials or network failed')
        },
      },
    )
    await expect(
      providerFailureService.regenerateFromConversation(thread.id),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '生成会话标题失败，模型服务暂不可用',
    })
    expect(history.getListItem(thread.id)?.title).toBe('原手工标题')
    expect(db.eventsAfter(0)).toHaveLength(eventCountBefore)

    // 4. 无效输出 -> INTERNAL_ERROR
    const invalidOutputService = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => ({ provider: 'provider:test', id: 'small' }) as PiModel<Api>,
      } as never,
      logger,
      config,
      { generate: async () => ({ title: '   ' }) },
    )
    await expect(invalidOutputService.regenerateFromConversation(thread.id)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '生成会话标题失败，模型未返回有效标题',
    })
    expect(history.getListItem(thread.id)?.title).toBe('原手工标题')
    expect(db.eventsAfter(0)).toHaveLength(eventCountBefore)
  })

  test('rejects regeneration unless the latest turn completed successfully', async () => {
    const { db, history, logger } = await fixture()
    const service = new ThreadTitleService(
      db,
      history,
      {
        pi: {},
        getPiModel: async () => {
          throw new Error('unexpected')
        },
      } as never,
      logger,
    )
    const empty = db.createThread()
    await expect(service.regenerateFromConversation(empty.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    })

    for (const status of [
      'queued',
      'running',
      'waiting_question',
      'failed',
      'interrupted',
    ] as const) {
      const thread = db.createThread(`状态 ${status}`)
      const turn = addUserMessage(db, thread.id, `状态 ${status}`)
      db.updateTurnStatus(turn.turnID, status)
      await expect(service.regenerateFromConversation(thread.id)).rejects.toMatchObject({
        code:
          status === 'queued' || status === 'running' || status === 'waiting_question'
            ? 'TURN_ACTIVE'
            : 'CONFLICT',
      })
    }
  })
})
