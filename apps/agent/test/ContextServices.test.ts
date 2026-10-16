import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Model, Provider } from '@pidex/model-schema'
import type { CompactionEntry } from '../src/orchestration/harness/Types'
import { ContextCompactionService } from '../src/context/ContextCompactionService'
import {
  ContextManager,
  contextFingerprint,
  estimateContextTokens,
  type AgentInputItem,
} from '../src/context/ContextManager'
import { HookService } from '../src/hooks/HookService'
import { MemoryService, projectMemoryKey } from '../src/memory/MemoryService'
import { AgentDatabase, SCHEMA_VERSION } from '../src/storage/database/AgentDatabase'
import {
  SqlitePiSessionRepo,
  type SqlitePiSessionStorage,
} from '../src/storage/pi-session/SqlitePiSession'
import { ConfigService } from '../src/config/ConfigService'
import { ThreadService } from '../src/session/ThreadService'
import { AgentHarnessError } from '../src/orchestration/harness/Types'

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-context-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const thread = db.createThread('上下文')
  return { root, db, thread }
}

describe('v8 上下文存储', () => {
  test('创建新表并持久化 granular approval JSON', async () => {
    const { db } = await fixture()
    const policy = {
      type: 'granular' as const,
      sandboxApproval: true,
      rules: false,
      skillApproval: true,
      requestPermissions: false,
      mcpTools: true,
      mcpElicitations: true,
    }
    const thread = db.createThread('granular', undefined, {
      taskMode: 'chat',
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: policy,
        approvalsReviewer: 'user',
      },
    })
    expect(db.getThreadSettings(thread.id)?.permissionConfig.approvalPolicy).toEqual(policy)
    expect(db.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    const tables = new Set(
      (
        db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string
        }>
      ).map(({ name }) => name),
    )
    for (const table of [
      'prompt_session_state',
      'agent_compactions',
      'guardian_review_sessions',
      'hook_runs',
      'memory_jobs',
      'context_usage_samples',
    ])
      expect(tables.has(table)).toBe(true)
    db.close()
  })

  test('估算确定且仅在同一输入指纹上优先使用实测 usage', async () => {
    const { db, thread } = await fixture()
    const manager = new ContextManager(db)
    manager.establishBaseline({
      threadID: thread.id,
      promptVersion: 'v1',
      baseHash: 'base',
      contextHash: 'context',
      cacheKey: thread.id,
    })
    const left = [
      { role: 'user', content: 'hello', metadata: { b: 2, a: 1 } },
    ] as unknown as AgentInputItem[]
    const right = [
      { metadata: { a: 1, b: 2 }, content: 'hello', role: 'user' },
    ] as unknown as AgentInputItem[]
    expect(estimateContextTokens({ items: left })).toBe(estimateContextTokens({ items: right }))
    expect(contextFingerprint({ items: left })).toBe(contextFingerprint({ items: right }))

    manager.recordMeasuredUsage({
      threadID: thread.id,
      items: left,
      contextWindowTokens: 100,
      inputTokens: 79,
      outputTokens: 7,
    })
    expect(
      manager.snapshot({ threadID: thread.id, items: right, contextWindowTokens: 100 }),
    ).toMatchObject({ usedTokens: 79, utilization: 0.79, needsCompaction: false })

    manager.recordMeasuredUsage({
      threadID: thread.id,
      items: left,
      contextWindowTokens: 100,
      inputTokens: 80,
      outputTokens: 7,
    })
    const measured = manager.snapshot({
      threadID: thread.id,
      items: right,
      contextWindowTokens: 100,
    })
    expect(measured).toMatchObject({
      source: 'measured',
      usedTokens: 80,
      triggerTokens: 80,
      targetTokens: 55,
      needsCompaction: true,
    })
    expect(manager.state(thread.id)).toMatchObject({
      usageTokens: 80,
      usageSource: 'measured',
      needsCompaction: true,
    })

    manager.appendFragments(
      thread.id,
      [
        {
          id: 'mode.chat',
          kind: 'mode',
          version: 2,
          hash: 'mode-2',
          payload: {},
          createdAt: Date.now(),
        },
      ],
      'context-2',
    )
    const changed = manager.snapshot({
      threadID: thread.id,
      items: [{ role: 'user', content: 'changed' }] as AgentInputItem[],
      contextWindowTokens: 100,
    })
    expect(changed).toMatchObject({ source: 'estimated', needsCompaction: true })
    expect(manager.usageSamples(thread.id)).toHaveLength(3)
    db.close()
  })

  test('自动压缩熔断三次失败，成功估算与新 baseline 会重置熔断', async () => {
    const { db, thread } = await fixture()
    const manager = new ContextManager(db)
    const service = new ContextCompactionService(db, manager)
    manager.establishBaseline({
      threadID: thread.id,
      promptVersion: 'v1',
      baseHash: 'base',
      contextHash: 'context',
      cacheKey: thread.id,
    })
    manager.recordMeasuredUsage({
      threadID: thread.id,
      items: [],
      contextWindowTokens: 100,
      inputTokens: 80,
    })
    expect(service.shouldAutoCompact(thread.id)).toBe(true)

    service.recordFailure(thread.id, 'automatic')
    service.recordFailure(thread.id, 'reactive')
    service.recordFailure(thread.id, 'automatic')
    expect(manager.state(thread.id)).toMatchObject({
      autoCompactFailures: 3,
      autoCompactSuspended: true,
      needsCompaction: true,
    })
    expect(service.shouldAutoCompact(thread.id)).toBe(false)

    const ineffective = manager.recordCompactionEstimate({
      threadID: thread.id,
      items: [{ role: 'user', content: 'x'.repeat(400) }],
      contextWindowTokens: 100,
    })
    expect(ineffective.needsCompaction).toBe(true)
    expect(manager.state(thread.id)).toMatchObject({
      autoCompactFailures: 3,
      autoCompactSuspended: true,
    })

    const estimate = manager.recordCompactionEstimate({
      threadID: thread.id,
      items: [],
      contextWindowTokens: 100,
    })
    expect(estimate).toMatchObject({ source: 'compaction-estimate', needsCompaction: false })
    expect(manager.state(thread.id)).toMatchObject({
      autoCompactFailures: 0,
      autoCompactSuspended: false,
      needsCompaction: false,
    })

    service.recordFailure(thread.id, 'automatic')
    manager.establishBaseline({
      threadID: thread.id,
      promptVersion: 'v2',
      baseHash: 'base-2',
      contextHash: 'context-2',
      cacheKey: thread.id,
    })
    expect(manager.state(thread.id)).toMatchObject({
      autoCompactFailures: 0,
      autoCompactSuspended: false,
    })
    db.close()
  })

  test('压缩完成将 Pi 引用、usage、状态和 durable event 原子提交', async () => {
    const { db, thread } = await fixture()
    const manager = new ContextManager(db)
    manager.establishBaseline({
      threadID: thread.id,
      promptVersion: 'v1',
      baseHash: 'base',
      contextHash: 'context',
      cacheKey: thread.id,
    })
    const service = new ContextCompactionService(db, manager)
    const session = await new SqlitePiSessionRepo(db).create({
      id: 'session',
      threadID: thread.id,
      agentID: 'main',
    })
    const storage = session.getStorage() as SqlitePiSessionStorage
    const piEntry: CompactionEntry = {
      type: 'compaction',
      id: 'compact-1',
      parentId: null,
      timestamp: new Date().toISOString() as CompactionEntry['timestamp'],
      summary: '保留当前目标与已修改文件。',
      firstKeptEntryId: 'kept-1',
      tokensBefore: 900,
    }
    await storage.appendEntry(piEntry)

    let completed!: ReturnType<ContextCompactionService['complete']>
    db.transaction(() => {
      storage.flush()
      completed = service.complete({
        threadID: thread.id,
        sessionID: 'session',
        piEntry,
        summary: piEntry.summary,
        firstKeptEntryID: piEntry.firstKeptEntryId ?? null,
        beforeCount: 12,
        afterCount: 3,
        items: [{ role: 'user', content: '继续' }],
        promptText: 'system',
        contextWindowTokens: 1_000,
        trigger: 'automatic',
      })
    })

    expect(completed.compaction).toMatchObject({
      id: piEntry.id,
      beforeCount: 12,
      afterCount: 3,
      beforeTokens: 900,
      trigger: 'automatic',
      afterTokensSource: 'compaction-estimate',
      baselineVersion: 1,
    })
    expect(completed.event).toMatchObject({
      threadId: thread.id,
      method: 'context/compacted',
      params: {
        compactionId: piEntry.id,
        trigger: 'automatic',
        afterTokensSource: 'compaction-estimate',
      },
    })
    expect(service.latest(thread.id)).toEqual(completed.compaction)
    expect(service.byID(piEntry.id)).toEqual(completed.compaction)
    expect(manager.state(thread.id)).toMatchObject({
      usageSource: 'compaction-estimate',
      needsCompaction: false,
    })
    const stored = db.sqlite
      .query('SELECT replacement_history FROM agent_compactions WHERE id = ?')
      .get(piEntry.id) as { replacement_history: string }
    expect(JSON.parse(stored.replacement_history)).toEqual({
      version: 1,
      kind: 'pi-compaction-reference',
      sessionID: 'session',
      entryID: piEntry.id,
      firstKeptEntryID: piEntry.firstKeptEntryId,
      trigger: 'automatic',
      afterTokensSource: 'compaction-estimate',
    })

    const failedEntry: CompactionEntry = {
      type: 'compaction',
      id: 'compact-rollback',
      parentId: piEntry.id,
      timestamp: new Date().toISOString() as CompactionEntry['timestamp'],
      summary: '这次事务必须回滚。',
      tokensBefore: 100,
    }
    await storage.appendEntry(failedEntry)
    db.sqlite.exec(
      `CREATE TRIGGER fail_context_compacted BEFORE INSERT ON events WHEN NEW.method = 'context/compacted' BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END`,
    )
    expect(() =>
      db.transaction(() => {
        storage.flush()
        service.complete({
          threadID: thread.id,
          sessionID: 'session',
          piEntry: failedEntry,
          summary: failedEntry.summary,
          firstKeptEntryID: null,
          beforeCount: 3,
          afterCount: 2,
          items: [],
          contextWindowTokens: 1_000,
          trigger: 'reactive',
        })
      }),
    ).toThrow('outbox unavailable')
    expect(
      db.sqlite.query('SELECT id FROM agent_compactions WHERE id = ?').get(failedEntry.id),
    ).toBeNull()
    expect(
      db.sqlite.query('SELECT id FROM pi_session_entries WHERE id = ?').get(failedEntry.id),
    ).toBeNull()
    expect(manager.usageSamples(thread.id)).toHaveLength(1)
    db.close()
  })
})

describe('Hooks 与记忆', () => {
  test('合并 hooks.json 与用户 config.json 内联 Hook', async () => {
    const { root, db } = await fixture()
    const userHooks = join(root, 'hooks.json')
    const configPath = join(root, 'config.json')
    await writeFile(
      userHooks,
      JSON.stringify({
        hooks: [{ id: 'json', event: 'pre_tool_use', command: 'json-hook' }],
      }),
      'utf8',
    )
    await writeFile(
      configPath,
      JSON.stringify(
        {
          hooks: {
            inline: {
              event: 'pre_tool_use',
              command: 'inline-hook',
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const config = new ConfigService(configPath)
    await config.initialize()
    const called: string[] = []
    const hooks = new HookService(
      db,
      {
        run: async ({ command }) => {
          called.push(command)
          return { output: JSON.stringify({ decision: 'continue' }) }
        },
      },
      undefined,
      undefined,
      config,
    )

    expect(hooks.load({ userConfigPath: userHooks }).map((hook) => hook.id)).toEqual([
      'json',
      'inline',
    ])
    await hooks.run('pre_tool_use', {})
    expect(called).toEqual(['json-hook', 'inline-hook'])
    await config.dispose()
    db.close()
  })

  test('用户 Hook 先执行，未知项目 Hook 暂停且响应后可恢复', async () => {
    const { root, db, thread } = await fixture()
    const userConfig = join(root, 'user-hooks.json')
    await mkdir(join(root, '.pidex'))
    await writeFile(
      userConfig,
      JSON.stringify({ hooks: [{ id: 'user', event: 'pre_tool_use', command: 'user-hook' }] }),
      'utf8',
    )
    await writeFile(
      join(root, '.pidex', 'hooks.json'),
      JSON.stringify({
        hooks: [{ id: 'project', event: 'pre_tool_use', command: 'project-hook' }],
      }),
      'utf8',
    )
    const input = {
      content: 'test',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    const called: string[] = []
    const hooks = new HookService(db, {
      run: async ({ command }) => {
        called.push(command)
        return { output: JSON.stringify({ decision: 'continue' }) }
      },
    })
    hooks.load({ userConfigPath: userConfig, projectRoot: root })
    await expect(
      hooks.run(
        'pre_tool_use',
        {},
        { threadID: thread.id, turnID: turn.turnID, workspaceRoot: root },
      ),
    ).rejects.toMatchObject({ code: 'HOOK_TRUST_REQUIRED' })
    expect(called).toEqual(['user-hook'])
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.state).toBe('waiting_hook_trust')
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'waiting_permission',
    })
    const request = db.sqlite
      .query("SELECT id FROM hook_trust_requests WHERE status = 'pending'")
      .get() as { id: string }
    const resolved = db.resolveHookTrustRequest(request.id, 'allow')
    expect(resolved.resumed).toEqual([
      { agentID: turn.agentID, turnID: turn.turnID, threadID: thread.id },
    ])
    expect(resolved.events).toHaveLength(1)
    expect(db.getAgentTurnCheckpoint(turn.turnID)).toMatchObject({
      state: 'ready',
      payload: { kind: 'hook-trust', requestID: request.id, decision: 'allow' },
    })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'queued',
    })
    db.close()
  })

  test('缺少可选 Hook 配置时为空，命令交由注入 runner', async () => {
    const { root, db, thread } = await fixture()
    const called: string[] = []
    const hooks = new HookService(db, {
      run: async (input) => {
        called.push(input.command)
        return { output: JSON.stringify({ decision: 'ask', reason: '检查' }) }
      },
    })
    expect(hooks.load({ projectRoot: root })).toEqual([])
    await mkdir(join(root, '.pidex'))
    await writeFile(
      join(root, '.pidex', 'hooks.json'),
      JSON.stringify({
        hooks: [{ id: 'check', event: 'pre_tool_use', command: 'check-hook', timeoutMs: 1000 }],
      }),
      'utf8',
    )
    hooks.load({ projectRoot: root })
    await expect(
      hooks.run(
        'pre_tool_use',
        { value: 'evidence' },
        { threadID: thread.id, toolName: 'shell', workspaceRoot: root },
      ),
    ).rejects.toMatchObject({ code: 'HOOK_TRUST_REQUIRED' })
    expect(called).toEqual([])
    const trust = db.sqlite
      .query("SELECT id FROM hook_trust_requests WHERE status = 'pending'")
      .get() as { id: string }
    db.resolveHookTrustRequest(trust.id, 'allow')
    const result = await hooks.run(
      'pre_tool_use',
      { value: 'evidence' },
      { threadID: thread.id, toolName: 'shell' },
    )
    expect(called).toEqual(['check-hook'])
    expect(result[0]?.result.decision).toBe('ask')
    db.close()
  })

  test('Hook narrowedInput 不能扩大原始 scope', async () => {
    const { root, db } = await fixture()
    await mkdir(join(root, '.pidex'))
    await writeFile(
      join(root, '.pidex', 'hooks.json'),
      JSON.stringify({ hooks: [{ id: 'narrow', event: 'pre_tool_use', command: 'check' }] }),
      'utf8',
    )
    const hooks = new HookService(db, {
      run: async () => ({
        output: JSON.stringify({ decision: 'continue', narrowedInput: { timeoutMs: 60_000 } }),
      }),
    })
    hooks.load({ projectRoot: root })
    await expect(
      hooks.run('pre_tool_use', { input: { timeoutMs: 1_000 } }, { workspaceRoot: root }),
    ).rejects.toMatchObject({ code: 'HOOK_TRUST_REQUIRED' })
    const trust = db.sqlite
      .query("SELECT id FROM hook_trust_requests WHERE status = 'pending'")
      .get() as { id: string }
    db.resolveHookTrustRequest(trust.id, 'allow')
    await expect(hooks.run('pre_tool_use', { input: { timeoutMs: 1_000 } })).rejects.toThrow('扩大')
    db.close()
  })

  test('Hook hash 变化重新请求信任且 block 后绝不执行', async () => {
    const { root, db } = await fixture()
    await mkdir(join(root, '.pidex'))
    const path = join(root, '.pidex', 'hooks.json')
    await writeFile(
      path,
      JSON.stringify({ hooks: [{ id: 'project', event: 'pre_tool_use', command: 'first' }] }),
      'utf8',
    )
    let executions = 0
    const hooks = new HookService(db, {
      run: async () => {
        executions += 1
        return { output: JSON.stringify({ decision: 'continue' }) }
      },
    })
    hooks.load({ projectRoot: root })
    await expect(
      hooks.run('pre_tool_use', { input: {} }, { workspaceRoot: root }),
    ).rejects.toMatchObject({ code: 'HOOK_TRUST_REQUIRED' })
    const first = db.sqlite
      .query("SELECT id FROM hook_trust_requests WHERE status = 'pending'")
      .get() as { id: string }
    db.resolveHookTrustRequest(first.id, 'allow')
    await hooks.run('pre_tool_use', { input: {} }, { workspaceRoot: root })
    expect(executions).toBe(1)

    await writeFile(
      path,
      JSON.stringify({ hooks: [{ id: 'project', event: 'pre_tool_use', command: 'changed' }] }),
      'utf8',
    )
    hooks.load({ projectRoot: root })
    await expect(
      hooks.run('pre_tool_use', { input: {} }, { workspaceRoot: root }),
    ).rejects.toMatchObject({ code: 'HOOK_TRUST_REQUIRED' })
    const second = db.sqlite
      .query("SELECT id FROM hook_trust_requests WHERE status = 'pending'")
      .get() as { id: string }
    expect(second.id).not.toBe(first.id)
    db.resolveHookTrustRequest(second.id, 'block')
    expect(await hooks.run('pre_tool_use', { input: {} }, { workspaceRoot: root })).toEqual([])
    expect(executions).toBe(1)
    db.close()
  })

  test('并行 workspace 使用各自不可变 Hook 配置', async () => {
    const { root, db } = await fixture()
    const projectA = join(root, 'project-a')
    const projectB = join(root, 'project-b')
    await Promise.all([
      mkdir(join(projectA, '.pidex'), { recursive: true }),
      mkdir(join(projectB, '.pidex'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(
        join(projectA, '.pidex', 'hooks.json'),
        JSON.stringify({ hooks: [{ id: 'same-id', event: 'pre_tool_use', command: 'project-a' }] }),
        'utf8',
      ),
      writeFile(
        join(projectB, '.pidex', 'hooks.json'),
        JSON.stringify({ hooks: [{ id: 'same-id', event: 'pre_tool_use', command: 'project-b' }] }),
        'utf8',
      ),
    ])
    const called: string[] = []
    const hooks = new HookService(db, {
      run: async (input) => {
        if (input.command === 'project-a') await Bun.sleep(20)
        called.push(input.command)
        return { output: JSON.stringify({ decision: 'continue' }) }
      },
    })
    hooks.load({ projectRoot: projectA })
    hooks.load({ projectRoot: projectB })
    await Promise.allSettled([
      hooks.run('pre_tool_use', { input: {} }, { workspaceRoot: projectA }),
      hooks.run('pre_tool_use', { input: {} }, { workspaceRoot: projectB }),
    ])
    const requests = db.sqlite
      .query("SELECT id FROM hook_trust_requests WHERE status = 'pending'")
      .all() as Array<{ id: string }>
    expect(requests).toHaveLength(2)
    requests.forEach(({ id }) => db.resolveHookTrustRequest(id, 'allow'))
    const [a, b] = await Promise.all([
      hooks.run('pre_tool_use', { input: {} }, { workspaceRoot: projectA }),
      hooks.run('pre_tool_use', { input: {} }, { workspaceRoot: projectB }),
    ])
    expect(a[0]?.hook.command).toBe('project-a')
    expect(b[0]?.hook.command).toBe('project-b')
    expect(called.sort()).toEqual(['project-a', 'project-b'])
    db.close()
  })

  test('记忆严格 opt-in，项目隔离并过滤凭据', async () => {
    const { db } = await fixture()
    const disabled = new MemoryService(db, { enabled: false })
    expect(disabled.remember({ scope: 'user', content: '偏好简洁回答' })).toBeNull()
    const memory = new MemoryService(db, { enabled: true })
    const projectKey = projectMemoryKey('F:\\repo')
    expect(
      memory.remember({ scope: 'project', projectKey, content: '项目使用 Bun' })?.content,
    ).toBe('项目使用 Bun')
    expect(memory.remember({ scope: 'user', content: 'api_key=super-secret-value' })).toBeNull()
    expect(memory.recall({ query: 'Bun', projectKey })).toHaveLength(1)
    expect(memory.recall({ query: 'Bun', projectKey: projectMemoryKey('F:\\other') })).toHaveLength(
      0,
    )
    db.close()
  })

  test('记忆单 worker 排空队列且业务失败不无限重试', async () => {
    const { db } = await fixture()
    let calls = 0
    let active = 0
    let maxActive = 0
    const memory = new MemoryService(db, {
      enabled: true,
      extractor: {
        extract: async () => {
          calls += 1
          active += 1
          maxActive = Math.max(maxActive, active)
          try {
            if (calls === 1) throw new Error('business failure')
            return [{ scope: 'user', content: '记住第二项' }]
          } finally {
            active -= 1
          }
        },
      },
    })
    memory.enqueue({ transcript: 'first' })
    memory.enqueue({ transcript: 'second' })
    await memory.drain()
    expect(calls).toBe(2)
    expect(maxActive).toBe(1)
    expect(
      db.sqlite
        .query('SELECT status, COUNT(*) AS count FROM memory_jobs GROUP BY status ORDER BY status')
        .all(),
    ).toEqual([
      { status: 'completed', count: 1 },
      { status: 'failed', count: 1 },
    ])
    db.close()
  })
})


describe('手动上下文压缩', () => {
  test.each(['nothing_to_compact', 'compaction'] as const)('maps %s without hiding other failures', async (code) => {
    const failure = new AgentHarnessError(code, 'test compaction failure')
    const service = {
      get: () => undefined,
      db: { activeTurn: () => null },
      promptPreview: async () => null,
      orchestrator: { compact: async () => { throw failure } },
    }
    const result = ThreadService.prototype.compact.call(service as never, 'thread-compaction')
    if (code === 'nothing_to_compact') {
      await expect(result).rejects.toMatchObject({
        code: 'CONFLICT', message: '上下文已压缩，暂无新增消息需要压缩', status: 409,
      })
    } else {
      await expect(result).rejects.toBe(failure)
    }
  })
})
