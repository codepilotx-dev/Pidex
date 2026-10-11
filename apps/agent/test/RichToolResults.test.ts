import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentDatabase, SCHEMA_VERSION } from '../src/storage/database/AgentDatabase'
import { ArtifactService } from '../src/storage/ArtifactService'
import { ArtifactRepository } from '../src/storage/repositories/ArtifactRepository'
import { probeArtifactsStorageCapabilities } from '../src/storage/database/StorageCapabilities'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'
import { AgentRuntimeService } from '../src/orchestration/AgentRuntimeService'
import type { PiRuntimeEventContext } from '../src/orchestration/pi/Types'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { Model, Provider } from '@pidex/model-schema'

const paths: string[] = []

afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const model = Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt-5') })
const permission = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const

const openDatabase = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-rich-results-'))
  paths.push(root)
  return {
    root,
    db: new AgentDatabase({
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    }),
  }
}

const seedTurn = (db: AgentDatabase, threadID: string) => {
  const created = db.createTurn(threadID, {
    content: '请执行工具',
    model,
    permissionConfig: permission,
    strategy: 'queue',
    taskMode: 'chat',
  })
  return { turnID: created.turnID, agentID: created.agentID }
}

describe('富工具结果投影与 artifact', () => {
  test('schema 32 迁移到 33 时新增 item_artifacts 且保留既有会话数据', async () => {
    const { root, db } = await openDatabase()
    const thread = db.createThread('迁移保留会话')
    db.sqlite.query('DROP TABLE item_artifacts').run()
    db.sqlite.exec('PRAGMA user_version = 32')
    db.close()

    const reopened = new AgentDatabase({
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    })
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(reopened.getThread(thread.id)?.title).toBe('迁移保留会话')
    const tables = new Set(
      (
        reopened.sqlite
          .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'item_artifacts'")
          .all() as Array<{ name: string }>
      ).map(({ name }) => name),
    )
    expect(tables.has('item_artifacts')).toBe(true)
    reopened.close()
  })

  test('更高 schema 的库不降级、不创建 item_artifacts，并降级 artifact capability', async () => {
    const { root, db } = await openDatabase()
    db.close()

    const future = new (await import('bun:sqlite')).Database(join(root, 'history.sqlite'))
    future.exec(`
      DROP TABLE item_artifacts;
      CREATE TABLE future_artifact_records (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      INSERT INTO future_artifact_records VALUES ('future:1', '{"kept":true}');
      PRAGMA user_version = ${SCHEMA_VERSION + 1};
    `)
    future.close()

    const reopened = new AgentDatabase({
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    })
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION + 1,
    })
    const table = reopened.sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'item_artifacts'")
      .get()
    expect(table).toBeNull()
    expect(
      reopened.sqlite
        .query("SELECT payload FROM future_artifact_records WHERE id = 'future:1'")
        .get(),
    ).toEqual({ payload: '{"kept":true}' })
    expect(probeArtifactsStorageCapabilities(reopened.sqlite).itemArtifactsTable).toBe(false)
    const advertised = filterAdvertisedCapabilities(reopened)
    expect(advertised).not.toContain('artifacts.read.v1')
    reopened.close()
  })

  test('capability 探测在具备 item_artifacts 表时保留 artifacts.read.v1', async () => {
    const { db } = await openDatabase()
    expect(probeArtifactsStorageCapabilities(db.sqlite).itemArtifactsTable).toBe(true)
    expect(filterAdvertisedCapabilities(db)).toContain('artifacts.read.v1')
    db.close()
  })

  test('artifact 写入、读取与跨 thread/未知 ID/非法定位拒绝', async () => {
    const { root, db } = await openDatabase()
    const thread = db.createThread('artifact thread')
    const other = db.createThread('other thread')
    const { turnID, agentID } = seedTurn(db, thread.id)
    db.upsertItem(thread.id, {
      id: 'item-1',
      turnID,
      agentID,
      type: 'tool',
      status: 'completed',
      data: { callID: 'item-1' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const artifacts = await ArtifactService.open(root, db)
    const record = await artifacts.persistBlobs([
      {
        artifactId: 'artifact:1',
        name: 'preview.png',
        mimeType: 'image/png',
        data: Buffer.from('png-bytes').toString('base64'),
      },
    ])
    expect(record).toHaveLength(1)
    expect(record[0]!.sha256).toMatch(/^[a-f\d]{64}$/)
    expect(record[0]!.sizeBytes).toBe(9)

    db.transaction(() => {
      artifacts.insertArtifact({
        id: record[0]!.artifactId,
        threadId: thread.id,
        turnId: turnID,
        itemId: 'item-1',
        name: 'preview.png',
        mimeType: 'image/png',
        sizeBytes: record[0]!.sizeBytes,
        storagePath: record[0]!.sha256,
        sha256: record[0]!.sha256,
        createdAt: Date.now(),
      })
    })

    const read = await artifacts.read('artifact:1', thread.id)
    expect(read.artifact.name).toBe('preview.png')
    expect(read.artifact.mimeType).toBe('image/png')
    expect(Buffer.from(read.data).toString('utf8')).toBe('png-bytes')

    await expect(artifacts.read('artifact:1', other.id)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
    await expect(artifacts.read('artifact:missing', thread.id)).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
    })
    db.close()
  })

  test('artifact 非法存储定位被拒绝读取', async () => {
    const { root, db } = await openDatabase()
    const thread = db.createThread('invalid location thread')
    const { turnID, agentID } = seedTurn(db, thread.id)
    db.upsertItem(thread.id, {
      id: 'item-1',
      turnID,
      agentID,
      type: 'tool',
      status: 'completed',
      data: { callID: 'item-1' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    db.transaction(() => {
      new ArtifactRepository(db.sqlite).insert({
        id: 'artifact:bad',
        threadId: thread.id,
        turnId: turnID,
        itemId: 'item-1',
        name: 'unsafe.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: 4,
        storagePath: '../escape',
        sha256: 'abc',
        createdAt: Date.now(),
      })
    })
    const artifacts = await ArtifactService.open(root, db)
    await expect(artifacts.read('artifact:bad', thread.id)).rejects.toMatchObject({
      code: 'ARTIFACT_LOCATION_INVALID',
    })
    db.close()
  })

  test('artifact 行与 item/event 在同一事务内原子提交，事务回滚时不留 artifact 行', async () => {
    const { db } = await openDatabase()
    const repo = db.artifacts
    const threadID = db.createThread('rollback thread').id
    const { turnID, agentID } = seedTurn(db, threadID)
    expect(() => {
      db.transaction(() => {
        db.upsertItem(threadID, {
          id: 'item-rollback',
          turnID,
          agentID,
          type: 'tool',
          status: 'completed',
          data: { callID: 'item-rollback' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        repo.insert({
          id: 'artifact:rollback',
          threadId: threadID,
          turnId: turnID,
          itemId: 'item-rollback',
          name: 'rollback.bin',
          mimeType: 'application/octet-stream',
          sizeBytes: 4,
          storagePath: 'f'.repeat(64),
          sha256: 'f'.repeat(64),
          createdAt: Date.now(),
        })
        throw new Error('boom')
      })
    }).toThrow('boom')
    expect(repo.get('artifact:rollback')).toBeNull()
    expect(db.getItem('item-rollback')).toBeNull()
    db.close()
  })

  test('工具结束持久化把 resultBlocks 同时写入 item 和事件 payload（replay 使用原事件 payload）', async () => {
    const { db } = await openDatabase()
    const threadID = db.createThread('replay thread').id
    const { turnID, agentID } = seedTurn(db, threadID)
    const localContext: PiRuntimeEventContext = { threadID, turnID, agentID }
    const orchestrator = new AgentRuntimeService({
      db: db as never,
      hub: {} as never,
      models: {} as never,
      toolExecutor: {} as never,
      contextCompaction: {} as never,
    })
    const persist = (
      orchestrator as unknown as {
        persistFinishedTool(
          context: PiRuntimeEventContext,
          input: unknown,
        ): Array<{ method: string; params: unknown }>
      }
    ).persistFinishedTool.bind(orchestrator)
    const durable = persist(localContext, {
      toolCallID: 'call-1',
      tool: 'web_search',
      output: '结论',
      details: null,
      isError: false,
      resultBlocks: [
        { type: 'text', text: '结论' },
        { type: 'citation', title: '来源', url: 'https://example.com/source' },
        { type: 'json', value: { items: [1, 2] } },
      ],
    })
    expect(durable.map((event) => event.method)).toEqual(['tool/callCompleted'])
    const persisted = db.getItem('call-1')
    expect(persisted?.data.resultBlocks).toEqual([
      { type: 'text', text: '结论' },
      { type: 'citation', title: '来源', url: 'https://example.com/source' },
      { type: 'json', value: { items: [1, 2] } },
    ])
    // 事件 payload 携带同一份 resultBlocks（位于 domain item.data），replay 不依赖当前数据库重建。
    const replayed = durable[0]!.params
    expect(replayed).toMatchObject({
      item: {
        id: 'call-1',
        data: {
          resultBlocks: [
            { type: 'text', text: '结论' },
            { type: 'citation', title: '来源', url: 'https://example.com/source' },
            { type: 'json', value: { items: [1, 2] } },
          ],
        },
      },
    })
    db.close()
  })

  test('ThreadProjection 投影 resultBlocks 与 completion，并对未知块做安全过滤', async () => {
    const { db } = await openDatabase()
    const threadID = db.createThread('projection thread').id
    const { turnID, agentID } = seedTurn(db, threadID)
    db.upsertItem(threadID, {
      id: 'call-1',
      turnID,
      agentID,
      type: 'tool',
      status: 'completed',
      data: {
        callID: 'call-1',
        tool: 'web_search',
        title: '网页搜索',
        input: {},
        output: '结论',
        error: null,
        startedAt: 1,
        finishedAt: 2,
        durationMs: 1,
        resultBlocks: [
          { type: 'text', text: '结论' },
          { type: 'citation', title: '来源', url: 'https://example.com/source' },
          { type: 'artifact', artifactId: 'a1', name: 'x.png', mimeType: 'image/png', size: 9 },
          { type: 'unknown', junk: true },
        ],
      },
      createdAt: 1,
      updatedAt: 2,
    })
    db.upsertItem(threadID, {
      id: 'text-1',
      turnID,
      agentID,
      type: 'text',
      status: 'completed',
      data: {
        placement: 'result',
        text: '完成',
        completion: { stopReason: 'stop', inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      },
      createdAt: 1,
      updatedAt: 2,
    })
    const projection = new ThreadProjection(db)
    const tool = projection.item(db.getItem('call-1')!)
    expect(tool?.type).toBe('tool')
    if (tool?.type === 'tool') {
      expect(tool.resultBlocks).toEqual([
        { type: 'text', text: '结论' },
        { type: 'citation', title: '来源', url: 'https://example.com/source' },
        { type: 'artifact', artifactId: 'a1', name: 'x.png', mimeType: 'image/png', size: 9 },
      ])
    }
    const text = projection.item(db.getItem('text-1')!)
    expect(text?.type).toBe('text')
    if (text?.type === 'text') {
      expect(text.completion).toEqual({
        stopReason: 'stop',
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      })
    }
    db.close()
  })

  test('旧字符串工具结果在不带 resultBlocks 时仍投影为可渲染工具项', async () => {
    const { db } = await openDatabase()
    const threadID = db.createThread('legacy thread').id
    const { turnID, agentID } = seedTurn(db, threadID)
    db.upsertItem(threadID, {
      id: 'legacy-call',
      turnID,
      agentID,
      type: 'tool',
      status: 'completed',
      data: {
        callID: 'legacy-call',
        tool: 'shell_command',
        title: '执行命令',
        input: { command: 'bun test' },
        command: 'bun test',
        output: 'ok',
        error: null,
        startedAt: 1,
        finishedAt: 2,
        durationMs: 1,
      },
      createdAt: 1,
      updatedAt: 2,
    })
    const projection = new ThreadProjection(db)
    const item = projection.item(db.getItem('legacy-call')!)
    expect(item).toMatchObject({
      type: 'tool',
      callID: 'legacy-call',
      output: 'ok',
      state: 'completed',
    })
    if (item?.type === 'tool') {
      expect(item.resultBlocks).toBeUndefined()
    }
    db.close()
  })
})
