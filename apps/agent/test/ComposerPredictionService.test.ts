import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Api, Model as PiModel } from '@earendil-works/pi-ai'
import { Model, Provider } from '@pidex/model-schema'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentError } from '../src/Domain'
import { AgentLogger } from '../src/observability/AgentLogger'
import type { PiModelService } from '../src/provider/pi/PiModelService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { ComposerPredictionService } from '../src/suggestion/ComposerPredictionService'

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    database.close()
  }
  await removeFixturePaths(roots.splice(0))
})

const modelRef = Model.Ref.make({
  providerID: Provider.ID.make('provider:test'),
  id: Model.ID.make('model:test'),
})

const piModel = { provider: 'provider:test', id: 'model:test' } as PiModel<Api>

const seedThread = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-composer-predictions-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(db)
  const logger = new AgentLogger(join(root, 'logs'))
  const thread = db.createThread('输入预测会话')
  return { root, db, logger, thread }
}

let turnSequence = 0
const seedTurn = (
  db: AgentDatabase,
  threadID: string,
  inputText: string,
  replyText: string,
  status: 'completed' | 'running' = 'completed',
) => {
  const created = db.createTurn(
    threadID,
    {
      content: inputText,
      model: modelRef,
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
      strategy: 'start',
      taskMode: 'chat',
    },
    status,
  )
  // 轮次顺序必须由 created_at 决定，避免同一毫秒内按随机 ID 排序。
  const createdAt = 1_700_000_000_000 + (turnSequence += 1) * 1_000
  db.sqlite
    .query('UPDATE turns SET created_at = ?, started_at = ? WHERE id = ?')
    .run(createdAt, createdAt, created.turnID)
  db.upsertItem(threadID, {
    id: `item-${created.turnID}`,
    turnID: created.turnID,
    agentID: created.agentID,
    type: 'text',
    status: 'completed',
    data: { text: replyText, placement: 'result' },
    createdAt,
    updatedAt: createdAt,
  })
  return created
}

const models = (attempted?: Model.Ref[]) =>
  ({
    pi: {},
    getPiModel: async (ref: Model.Ref) => {
      attempted?.push(ref)
      return piModel
    },
  }) as unknown as Pick<PiModelService, 'pi' | 'getPiModel'>

let threadsCounter = 0
const nextThreadId = () => `thread:fixture:${(threadsCounter += 1)}`

describe('ComposerPredictionService', () => {
  test('不存在的聊天返回 404，未完成轮次返回 400', async () => {
    const { db, logger } = await seedThread()
    const service = new ComposerPredictionService(db, models(), logger, {
      generate: async () => ({ prediction: '继续' }),
    })

    const missing = service.predict({ threadId: nextThreadId(), turnId: 'turn:missing' })
    await expect(missing).rejects.toBeInstanceOf(AgentError)
    await expect(missing).rejects.toMatchObject({ status: 404, code: 'THREAD_NOT_FOUND' })

    const thread = db.createThread('未完成轮次')
    const running = seedTurn(db, thread.id, '继续实现', '处理中', 'running')
    await expect(
      service.predict({ threadId: thread.id, turnId: running.turnID }),
    ).rejects.toMatchObject({ status: 400, code: 'TURN_NOT_COMPLETED' })
  })

  test('超时折叠为 null 而不是抛错', async () => {
    const { db, logger, thread } = await seedThread()
    const turn = seedTurn(db, thread.id, '继续实现', '已完成')
    const service = new ComposerPredictionService(db, models(), logger, {
      timeoutMs: 20,
      generate: async (input) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })

    await expect(service.predict({ threadId: thread.id, turnId: turn.turnID })).resolves.toEqual({
      prediction: null,
    })
  })

  test('相同 threadId + turnId 的并发请求只生成一次并共享缓存', async () => {
    const { db, logger, thread } = await seedThread()
    const turn = seedTurn(db, thread.id, '继续实现', '已完成')
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const service = new ComposerPredictionService(db, models(), logger, {
      generate: async () => {
        calls += 1
        await gate
        return { prediction: '继续补齐测试' }
      },
    })

    const first = service.predict({ threadId: thread.id, turnId: turn.turnID })
    const second = service.predict({ threadId: thread.id, turnId: turn.turnID })
    release()
    const [left, right] = await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(left).toEqual({ prediction: '继续补齐测试' })
    expect(right).toEqual(left)

    const cached = await service.predict({ threadId: thread.id, turnId: turn.turnID })
    expect(cached).toEqual(left)
    expect(calls).toBe(1)
  })

  test('上下文只保留最近 6 轮，并从最旧内容开始裁剪到 12,000 字符', async () => {
    const { db, logger, thread } = await seedThread()
    for (let index = 1; index <= 8; index += 1) {
      seedTurn(db, thread.id, `第 ${index} 轮指令`, `第 ${index} 轮回复`)
    }
    const latest = db.sqlite
      .query("SELECT id FROM turns WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(thread.id) as { id: string }
    let prompt = ''
    const service = new ComposerPredictionService(db, models(), logger, {
      generate: async (input) => {
        prompt = input.prompt
        return { prediction: '继续' }
      },
    })

    await service.predict({ threadId: thread.id, turnId: latest.id })

    expect(prompt).toContain('第 8 轮回复')
    expect(prompt).toContain('第 3 轮指令')
    expect(prompt).not.toContain('第 2 轮')
    expect(prompt).not.toContain('第 1 轮')
  })

  test('上下文总长度不超过 12,000 字符，并脱敏凭据与绝对路径', async () => {
    const { db, logger, thread } = await seedThread()
    seedTurn(db, thread.id, '读取 C:\\private\\secret.md 并 api_key=sk-abcdefghijklmnopqrstuv', '第一轮回复')
    seedTurn(db, thread.id, '继续', '很长的历史内容 '.repeat(3_000))
    const latest = db.sqlite
      .query("SELECT id FROM turns WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(thread.id) as { id: string }
    let prompt = ''
    const service = new ComposerPredictionService(db, models(), logger, {
      generate: async (input) => {
        prompt = input.prompt
        return { prediction: '继续' }
      },
    })

    await service.predict({ threadId: thread.id, turnId: latest.id })

    const context = JSON.parse(
      prompt.slice(
        prompt.indexOf('<untrusted_conversation_context>') +
          '<untrusted_conversation_context>'.length,
        prompt.lastIndexOf('</untrusted_conversation_context>'),
      ),
    ) as Array<{ role: string; content: string }>
    const characters = context.reduce((total, entry) => total + entry.content.length, 0)
    expect(characters).toBeLessThanOrEqual(12_000)
    expect(context.filter((entry) => entry.role === 'assistant').length).toBeLessThanOrEqual(6)
    expect(prompt).not.toContain('sk-abcdefghijklmnopqrstuv')
  })

  test('用户上下文中包含的绝对路径被替换为占位符', async () => {
    const { db, logger, thread } = await seedThread()
    seedTurn(db, thread.id, '读取 C:\\private\\secret.md 并总结', '已读取')
    const latest = db.sqlite
      .query("SELECT id FROM turns WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(thread.id) as { id: string }
    let prompt = ''
    const service = new ComposerPredictionService(db, models(), logger, {
      generate: async (input) => {
        prompt = input.prompt
        return { prediction: '继续' }
      },
    })

    await service.predict({ threadId: thread.id, turnId: latest.id })

    expect(prompt).not.toContain('C:\\private')
    expect(prompt).toContain('<path>')
  })

  test('预测结果按 200 字符截断', async () => {
    const { db, logger, thread } = await seedThread()
    const turn = seedTurn(db, thread.id, '继续实现', '已完成')
    const service = new ComposerPredictionService(db, models(), logger, {
      generate: async () => ({ prediction: '预'.repeat(500) }),
    })

    const result = await service.predict({ threadId: thread.id, turnId: turn.turnID })
    expect(result.prediction).toHaveLength(200)
  })

  test('模型失败或无可用模型时返回 null', async () => {
    const { db, logger, thread } = await seedThread()
    const turn = seedTurn(db, thread.id, '继续实现', '已完成')
    const failing = new ComposerPredictionService(db, models(), logger, {
      generate: async () => {
        throw new Error('provider down')
      },
    })
    await expect(
      failing.predict({ threadId: thread.id, turnId: turn.turnID }),
    ).resolves.toEqual({ prediction: null })

    const unavailable = new ComposerPredictionService(
      db,
      {
        pi: {},
        getPiModel: async () => {
          throw new Error('missing model')
        },
      } as unknown as Pick<PiModelService, 'pi' | 'getPiModel'>,
      logger,
      { generate: async () => ({ prediction: '不会执行' }) },
    )
    await expect(
      unavailable.predict({ threadId: thread.id, turnId: turn.turnID }),
    ).resolves.toEqual({ prediction: null })
  })
})
