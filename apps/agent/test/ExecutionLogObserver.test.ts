import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentHarnessEvent } from '../src/orchestration/harness/Types'
import { removeFixturePaths } from './FixtureCleanup'
import type { EventEnvelope } from '../src/Domain'
import { AgentLogger } from '../src/observability/AgentLogger'
import { ExecutionLogObserver, HarnessLogObserver } from '../src/observability/ExecutionLogObserver'

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-execution-logs-'))
  roots.push(root)
  const output: string[] = []
  const logger = new AgentLogger(root, {
    detailMode: 'development',
    consoleLevel: 'info',
    consoleSink: (line) => output.push(line),
  })
  const read = async () =>
    (await readFile(join(root, 'agent.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  return { logger, read, output }
}

const event = (method: string, params: unknown): EventEnvelope => ({
  id: 1,
  threadId: 'thread-1',
  turnId: 'turn-1',
  method,
  params,
  createdAt: 1,
})

describe('execution log observers', () => {
  test('只映射 allowlist 事件，Shell 仅记录安全元数据且不包含完整输入输出', async () => {
    const { logger, read } = await setup()
    const observer = new ExecutionLogObserver(logger)
    observer.observeEvent(
      event('turn/started', {
        turn: { id: 'turn-1', rootAgentId: 'agent-1', status: 'running', mode: 'chat' },
        input: { content: 'private prompt' },
      }),
    )
    observer.observeEvent(
      event('tool/callStarted', {
        item: {
          id: 'call-1',
          turnID: 'turn-1',
          agentID: 'agent-1',
          status: 'running',
          data: {
            tool: 'PowerShell',
            input: {
              command: 'echo token=secret',
              cwd: 'C:\\Users\\private\\workspace',
              timeout: 12_345,
              env: { OPENAI_API_KEY: 'sk-private' },
            },
            output: 'private output',
          },
        },
      }),
    )
    observer.observeEvent(event('tool/outputDelta', { delta: 'private delta' }))
    observer.observeEvent(event('unknown/event', { prompt: 'private prompt' }))

    const result = await read()
    expect(result.map((record) => record.event)).toEqual(['turn.started', 'tool.started'])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('private prompt')
    expect(serialized).not.toContain('private output')
    expect(serialized).not.toContain('private delta')
    expect(serialized).not.toContain('token=secret')
    expect(serialized).not.toContain('echo')
    expect(serialized).not.toContain('Users')
    expect(serialized).not.toContain('OPENAI_API_KEY')
    expect(serialized).not.toContain('sk-private')
    expect(result[1]).not.toHaveProperty('development')
    expect(result[1]!.details).toMatchObject({
      tool: 'PowerShell',
      commandBytes: Buffer.byteLength('echo token=secret', 'utf8'),
      cwdScope: 'absolute',
      timeoutMs: 12_345,
    })
  })

  test('Write、Edit 和 apply_patch 只投影安全路径、字节数与统计', async () => {
    const { logger, read } = await setup()
    const observer = new ExecutionLogObserver(logger)
    observer.observeEvent(
      event('tool/callStarted', {
        item: {
          id: 'write-1',
          status: 'running',
          data: {
            tool: 'workspace.write',
            input: {
              file_path: 'src/new.ts',
              content: "const apiKey = 'sk-private'",
            },
          },
        },
      }),
    )
    observer.observeEvent(
      event('tool/callStarted', {
        item: {
          id: 'edit-1',
          status: 'running',
          data: {
            tool: 'Edit',
            input: {
              path: 'C:\\Users\\private\\secret.ts',
              edits: [
                { oldText: 'password=before', newText: 'password=after' },
                { oldText: 'token=before', newText: 'token=after' },
              ],
            },
          },
        },
      }),
    )
    observer.observeEvent(
      event('tool/callCompleted', {
        item: {
          id: 'patch-1',
          status: 'completed',
          data: {
            tool: 'apply_patch',
            durationMs: 42,
            input: {
              operation: 'apply_patch',
              patch: '[补丁正文已隐藏]',
              patchBytes: 321,
              affectedPaths: [
                { path: 'src/a.ts', operation: 'update' },
                { path: 'C:\\Users\\private\\added.ts', operation: 'create' },
              ],
              fileCount: 2,
              hunkCount: 3,
              additions: 7,
              deletions: 2,
            },
            output: 'private stdout',
          },
        },
      }),
    )

    const result = await read()
    expect(result.map((record) => record.event)).toEqual([
      'tool.started',
      'tool.started',
      'tool.completed',
    ])
    expect(result[0]!.details).toMatchObject({
      tool: 'workspace.write',
      path: 'src/new.ts',
      fileCount: 1,
      contentBytes: Buffer.byteLength("const apiKey = 'sk-private'", 'utf8'),
    })
    expect(result[1]!.details).toMatchObject({
      tool: 'Edit',
      path: '[outside-workspace]',
      fileCount: 1,
      editCount: 2,
      oldTextBytes: Buffer.byteLength('password=beforetoken=before', 'utf8'),
      newTextBytes: Buffer.byteLength('password=aftertoken=after', 'utf8'),
    })
    expect(result[2]!.details).toMatchObject({
      tool: 'apply_patch',
      durationMs: 42,
      affectedPaths: [
        { path: 'src/a.ts', operation: 'update' },
        { path: '[outside-workspace]', operation: 'create' },
      ],
      fileCount: 2,
      createCount: 1,
      updateCount: 1,
      patchBytes: 321,
      hunkCount: 3,
      additions: 7,
      deletions: 2,
    })
    const serialized = JSON.stringify(result)
    for (const forbidden of [
      'const apiKey',
      'sk-private',
      'password=before',
      'password=after',
      'token=before',
      'token=after',
      'Users',
      '补丁正文',
      'private stdout',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test('provider 记录响应序号、首响应及总耗时，usage 可见而内容不可见', async () => {
    const { logger, read, output } = await setup()
    let now = 1_000
    const observer = new HarnessLogObserver(logger, () => now)
    const context = { threadId: 'thread-1', turnId: 'turn-1', agentId: 'agent-1' }
    observer.observe(context, {
      type: 'before_provider_request',
      model: { provider: 'openai', id: 'gpt-test' },
      sessionId: 'session-1',
      streamOptions: {},
    } as AgentHarnessEvent)
    now = 1_100
    observer.observe(context, {
      type: 'after_provider_response',
      status: 429,
      headers: { authorization: 'secret' },
    } as AgentHarnessEvent)
    now = 1_250
    observer.observe(context, {
      type: 'after_provider_response',
      status: 200,
      headers: {},
    } as AgentHarnessEvent)
    const delta = {
      type: 'message_update',
      message: { role: 'assistant' },
      assistantMessageEvent: { type: 'thinking_delta', delta: 'private thought' },
    } as AgentHarnessEvent
    observer.observe(context, delta)
    now = 1_500
    observer.observe(context, delta)
    observer.observe(context, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'private response' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 },
      },
    } as AgentHarnessEvent)

    const result = await read()
    const responses = result.filter((record) => record.event === 'provider.response')
    expect(responses).toHaveLength(2)
    expect((responses[0]!.details as Record<string, unknown>).responseIndex).toBe(1)
    expect((responses[1]!.details as Record<string, unknown>).responseIndex).toBe(2)
    expect(result.filter((record) => record.event === 'provider.first-response')).toHaveLength(1)
    expect(result.at(-1)?.details).toMatchObject({
      requestIndex: 1,
      firstResponseMs: 250,
      durationMs: 500,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    })
    expect(output.join('')).toContain('inputTokens=10')
    expect(JSON.stringify(result)).not.toContain('private thought')
    expect(JSON.stringify(result)).not.toContain('private response')
    expect(JSON.stringify(result)).not.toContain('authorization')
  })

  test('模型连续请求递增，失败分类安全，结束和取消清理观测状态', async () => {
    const { logger, read } = await setup()
    const observer = new HarnessLogObserver(logger, () => 1_000)
    const context = { threadId: 'thread-1', turnId: 'turn-1', agentId: 'agent-1' }
    const request = {
      type: 'before_provider_request',
      model: { provider: 'openai', id: 'test' },
      sessionId: 'session-1',
      streamOptions: {},
    } as AgentHarnessEvent
    observer.observe(context, request)
    observer.observe(context, {
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: '429 private response token=secret',
        usage: {},
      },
    } as AgentHarnessEvent)
    observer.observe(context, request)
    observer.observe(context, { type: 'abort' } as AgentHarnessEvent)
    observer.observe(context, request)
    observer.observe(context, { type: 'settled', nextTurnCount: 0 })
    observer.observe(context, request)
    observer.finishTurn('turn-1')
    observer.observe(context, request)
    observer.observe(context, {
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'aborted', usage: {} },
    } as AgentHarnessEvent)
    const logged = await read()
    expect(
      logged
        .filter((record) => record.event === 'provider.requested')
        .map((record) => (record.details as Record<string, unknown>).requestIndex),
    ).toEqual([1, 2, 1, 1, 1])
    expect(logged.find((record) => record.event === 'provider.failed')).toMatchObject({
      level: 'error',
      details: { category: 'rate-limit', reason: 'error' },
    })
    expect(logged.at(-1)).toMatchObject({ level: 'warn', event: 'provider.aborted' })
    expect(JSON.stringify(logged)).not.toContain('private response')
    expect(JSON.stringify(logged)).not.toContain('secret')
  })

  test('真实回合 payload、工具和交互带关联，准备与队列仅投影统计', async () => {
    const { logger, read, output } = await setup()
    const observer = new ExecutionLogObserver(logger)
    observer.observeEvent({
      ...event('turn/started', {
        turnId: 'turn-1',
        rootAgentId: 'agent-1',
        startedAt: 100,
        input: {
          taskMode: 'chat',
          model: { providerID: 'openai', id: 'test' },
          content: 'private input',
        },
      }),
      createdAt: 100,
    })
    observer.observeEvent(
      event('tool/error', {
        item: { id: 'call-1', data: { tool: 'PowerShell' } },
        error: { code: 'TOOL_EXECUTION_ERROR', message: 'private output' },
      }),
    )
    observer.observeEvent(
      event('permission/requested', {
        agentId: 'agent-1',
        toolCallId: 'call-1',
        interactionId: 'interaction-1',
        tool: 'request_permissions',
        risk: 'high',
        requestedPermissions: { private: 'private request' },
      }),
    )
    observer.observeEvent(
      event('interaction/resolved', {
        interactionId: 'interaction-1',
        result: {
          kind: 'permission',
          decision: 'grant',
          grantedPermissions: { private: 'private grant' },
        },
      }),
    )
    observer.observeEvent({ ...event('turn/completed', { finishedAt: 300 }), createdAt: 300 })
    observer.observeEvent({ ...event('turn/completed', { finishedAt: 400 }), createdAt: 400 })
    const harness = new HarnessLogObserver(logger)
    const context = { threadId: 'thread-1', turnId: 'turn-1' }
    harness.observe(context, {
      type: 'before_agent_start',
      resources: { skills: [{}] },
      prompt: 'private prompt',
    } as AgentHarnessEvent)
    harness.observe(context, {
      type: 'context',
      messages: [{ content: 'private messages' }],
    } as AgentHarnessEvent)
    harness.observe(context, {
      type: 'turn_composition',
      stepIndex: 0,
      activeToolNames: ['Read'],
    } as AgentHarnessEvent)
    harness.observe(context, { type: 'queue_consumed', delivery: 'steer', inputIds: ['input-1'] })
    harness.observe(context, {
      type: 'save_point',
      activeToolNames: ['Read'],
      hadPendingMutations: true,
    })
    harness.observe(context, {
      type: 'retry_scheduled',
      operation: 'compaction',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'private error',
    })
    const logged = await read()
    expect(logged[0]?.details).toMatchObject({ provider: 'openai', model: 'test', mode: 'chat' })
    expect(logged[1]?.context).toMatchObject({
      threadId: 'thread-1',
      turnId: 'turn-1',
      toolCallId: 'call-1',
    })
    expect(logged[2]?.context).toMatchObject({
      interactionId: 'interaction-1',
      toolCallId: 'call-1',
    })
    expect(logged[3]?.details).toMatchObject({ kind: 'permission', decision: 'grant' })
    expect(logged[4]?.details).toMatchObject({ durationMs: 200 })
    expect(logged[5]?.details).not.toHaveProperty('durationMs')
    expect(logged.at(-1)).toMatchObject({
      level: 'warn',
      event: 'retry.scheduled',
      details: { operation: 'compaction', attempt: 2, delayMs: 100 },
    })
    expect(output.join('')).toContain('stepIndex=1')
    expect(output.join('')).toContain('inputCount=1')
    expect(JSON.stringify(logged)).not.toContain('private')
  })
})
