import { describe, expect, test } from 'bun:test'
import type { AgentHarnessEvent } from '../src/orchestration/harness/Types'
import { EventManifest } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { PiEventAdapter, piToolResultText } from '../src/orchestration/pi/PiEventAdapter'
import {
  finishedPiToolItem,
  mergeTimelineMutationFiles,
  AgentRuntimeService,
  piItemDeltaPayload,
  piToolItemPayload,
  piToolMutationFiles,
  piToolTimelineInput,
} from '../src/orchestration/AgentRuntimeService'
import { isProviderContextOverflow } from '../src/orchestration/pi/ContextOverflow'
import type { PiRuntimeEventSink } from '../src/orchestration/pi/Types'

describe('PiEventAdapter', () => {
  test('apply_patch 时间线输入隐藏补丁正文和其中的主机路径', () => {
    const input = piToolTimelineInput('apply_patch', {
      patch:
        '*** Begin Patch\n*** Update File: C:\\secret\\source.ts\n@@\n-old\n+new\n*** End Patch',
    })
    expect(input).toEqual({
      operation: 'apply_patch',
      patchBytes: expect.any(Number),
      hunkCount: 1,
      additions: 1,
      deletions: 1,
      patch: '[补丁正文已隐藏]',
      affectedPaths: [{ path: 'source.ts', operation: 'update', additions: 1, deletions: 1 }],
    })
    expect(JSON.stringify(input)).not.toContain('C:\\\\secret')
    expect(JSON.stringify(input)).not.toContain('-old')
  })

  test('Write 和 Edit 时间线输入只保留安全文件元数据', () => {
    const write = piToolTimelineInput('Write', {
      file_path: 'src/source.ts',
      content: "const secret = 'private'",
    })
    const edit = piToolTimelineInput('workspace.edit', {
      path: 'src/source.ts',
      edits: [{ oldText: 'secret-old', newText: 'secret-new' }],
    })

    expect(write).toEqual({
      operation: 'write',
      file_path: 'src/source.ts',
      contentBytes: Buffer.byteLength("const secret = 'private'", 'utf8'),
      affectedPaths: [{ path: 'src/source.ts', operation: 'write' }],
    })
    expect(edit).toEqual({
      operation: 'edit',
      path: 'src/source.ts',
      editCount: 1,
      affectedPaths: [{ path: 'src/source.ts', operation: 'update' }],
    })
    expect(JSON.stringify(write)).not.toContain('private')
    expect(JSON.stringify(edit)).not.toContain('secret-old')
    expect(JSON.stringify(edit)).not.toContain('secret-new')
  })

  test('routes live text and reasoning deltas without inventing durable events', async () => {
    const seen: string[] = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        textDelta: async (_context, input) => {
          seen.push(`text:${input.delta}`)
        },
        reasoningDelta: async (_context, input) => {
          seen.push(`reasoning:${input.delta}`)
        },
      },
    )

    await adapter.handle({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    } as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'why' },
    } as AgentHarnessEvent)

    expect(seen).toEqual(['text:hello', 'reasoning:why'])
  })

  test('allocates a unique stable item identity for each assistant message', async () => {
    const started: string[] = []
    const deltas: string[] = []
    const completed: string[] = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        assistantMessageStarted: async (_context, input) => {
          started.push(input.textItemID)
        },
        textDelta: async (_context, input) => {
          deltas.push(input.itemID)
        },
        assistantMessageCompleted: async (_context, input) => {
          completed.push(input.textItemID)
        },
      },
    )
    const assistant = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] })

    await adapter.handle({
      type: 'message_start',
      message: assistant(''),
    } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '开始检查' },
    } as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_end',
      message: assistant('开始检查'),
    } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_start',
      message: assistant(''),
    } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '检查完成' },
    } as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_end',
      message: assistant('检查完成'),
    } as unknown as AgentHarnessEvent)

    expect(new Set(started).size).toBe(2)
    expect(deltas).toEqual(started)
    expect(completed).toEqual(started)
  })

  test('marks streaming text as process and classifies completed tool-call messages as process', async () => {
    const started: string[] = []
    const completed: string[] = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        assistantMessageStarted: async (_context, input) => {
          started.push(input.placement)
        },
        assistantMessageCompleted: async (_context, input) => {
          completed.push(input.placement)
        },
      },
    )
    const assistant = (content: unknown[]) => ({ role: 'assistant', content })

    await adapter.handle({
      type: 'message_start',
      message: assistant([]),
    } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_end',
      message: assistant([
        { type: 'text', text: '开始检查' },
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: {} },
      ]),
    } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_start',
      message: assistant([]),
    } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_end',
      message: assistant([{ type: 'text', text: '检查完成' }]),
    } as unknown as AgentHarnessEvent)

    expect(started).toEqual(['process', 'process'])
    expect(completed).toEqual(['process', 'result'])
  })

  test('keeps the completion placement when building the durable text item', async () => {
    const db = {
      getItem: () => null,
    }
    const orchestrator = new AgentRuntimeService({
      db: db as never,
      hub: {} as never,
      models: {} as never,
      toolExecutor: {} as never,
      contextCompaction: {} as never,
    })
    const sink = (
      orchestrator as unknown as {
        eventSink(
          storage: unknown,
          session: unknown,
          runtimeModel: { provider: string; id: string; contextWindow: number },
          sessionID: string,
        ): PiRuntimeEventSink
      }
    ).eventSink(
      {},
      {},
      {
        provider: 'openai',
        id: 'model',
        contextWindow: 128_000,
      },
      'session',
    )

    await sink.assistantMessageCompleted?.(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        textItemID: 'text-1',
        reasoningItemID: 'reasoning-1',
        planItemID: 'plan-1',
        placement: 'process',
        content: [{ type: 'text', text: '继续调用工具' }],
        provider: 'openai',
        api: 'responses',
        model: 'model',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
        },
      },
    )

    const pending = (
      orchestrator as unknown as {
        pending: Map<string, { items: Map<string, { data: Record<string, unknown> }> }>
      }
    ).pending.get('thread')
    expect(pending?.items.get('text-1')?.data.placement).toBe('process')
  })

  test('normalizes standard Pi usage and prefers the actual response model', async () => {
    const completed: unknown[] = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        assistantMessageCompleted: async (_context, input) => {
          completed.push(input)
        },
      },
    )

    await adapter.handle({
      type: 'message_end',
      message: {
        role: 'assistant',
        provider: 'openai',
        api: 'openai-responses',
        model: 'requested-model',
        responseModel: 'actual-model',
        content: [{ type: 'text', text: 'done' }],
        usage: {
          input: 10,
          output: 4,
          cacheRead: 20,
          cacheWrite: 5,
          reasoning: 2,
        },
      },
    } as unknown as AgentHarnessEvent)

    expect(completed).toMatchObject([
      {
        provider: 'openai',
        api: 'openai-responses',
        model: 'actual-model',
        usage: {
          input: 10,
          output: 4,
          cacheRead: 20,
          cacheWrite: 5,
          reasoning: 2,
        },
      },
    ])
  })

  test('treats missing or invalid Pi usage fields as zero', async () => {
    const completed: Array<{ usage: Record<string, number> }> = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        assistantMessageCompleted: async (_context, input) => {
          completed.push(input)
        },
      },
    )

    await adapter.handle({
      type: 'message_end',
      message: {
        role: 'assistant',
        provider: 'anthropic',
        api: 'anthropic-messages',
        model: 'claude-test',
        content: [{ type: 'text', text: 'done' }],
        usage: { input: -1, output: Number.NaN, cacheRead: 3.9 },
      },
    } as unknown as AgentHarnessEvent)

    expect(completed[0]?.usage).toEqual({
      input: 0,
      output: 0,
      cacheRead: 3,
      cacheWrite: 0,
      reasoning: 0,
    })
  })

  test('Plan 模式流式输出独立计划且不创建空文本项', async () => {
    const seen: string[] = []
    const completed: Array<{ text?: string; plan?: string | null; planItemID: string }> = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        assistantMessageStarted: async () => {
          seen.push('text-start')
        },
        textDelta: async (_context, input) => {
          seen.push(`text:${input.delta}`)
        },
        planStarted: async () => {
          seen.push('plan-start')
        },
        planDelta: async (_context, input) => {
          seen.push(`plan:${input.delta}`)
        },
        assistantMessageCompleted: async (_context, input) => {
          completed.push(input)
        },
      },
      { parseProposedPlan: true },
    )
    const assistant = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] })

    await adapter.handle({
      type: 'message_start',
      message: assistant(''),
    } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '<proposed_' },
    } as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'plan>\n# 方案\n' },
    } as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '</proposed_plan>' },
    } as AgentHarnessEvent)
    await adapter.handle({
      type: 'message_end',
      message: assistant('<proposed_plan>\n# 方案\n</proposed_plan>'),
    } as unknown as AgentHarnessEvent)

    expect(seen).toEqual(['plan-start', 'plan:# 方案\n'])
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({ text: '', plan: '# 方案' })
    expect(completed[0]!.planItemID).toEndWith(':plan')
    expect(adapter.outputText([])).toBe('')
  })

  test('routes transaction boundaries and queue counts', async () => {
    const seen: unknown[] = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        queueUpdated: async (_context, queue) => {
          seen.push(queue)
        },
        savePoint: async (_context, point) => {
          seen.push(point)
        },
        settled: async (_context, settled) => {
          seen.push(settled)
        },
      },
    )

    await adapter.handle({
      type: 'queue_update',
      steer: [{}],
      followUp: [{}, {}],
      nextTurn: [],
    } as unknown as AgentHarnessEvent)
    await adapter.handle({ type: 'save_point', hadPendingMutations: true } as AgentHarnessEvent)
    await adapter.handle({ type: 'settled', nextTurnCount: 0 } as AgentHarnessEvent)

    expect(seen).toEqual([
      { steer: 1, followUp: 2, nextTurn: 0 },
      { hadPendingMutations: true },
      { nextTurnCount: 0 },
    ])
  })

  test('routes tool output updates with the stable tool call identity', async () => {
    const seen: unknown[] = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        toolUpdated: async (_context, update) => {
          seen.push(update)
        },
      },
    )

    await adapter.handle({
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'read_file',
      partialResult: { content: [{ type: 'text', text: 'partial' }] },
    } as unknown as AgentHarnessEvent)

    expect(seen).toEqual([
      {
        toolCallID: 'call-1',
        tool: 'read_file',
        update: 'partial',
      },
    ])
  })

  test('routes safe tool text together with structured result details', async () => {
    const seen: unknown[] = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        toolFinished: async (_context, result) => {
          seen.push(result)
        },
      },
    )

    await adapter.handle({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'Edit',
      result: {
        content: [{ type: 'text', text: '已编辑 src/source.ts（+2 -1）' }],
        details: {
          operation: 'edit',
          path: 'src/source.ts',
          additions: 2,
          deletions: 1,
        },
      },
      isError: false,
    } as unknown as AgentHarnessEvent)

    expect(seen).toEqual([
      {
        toolCallID: 'call-1',
        tool: 'Edit',
        result: '已编辑 src/source.ts（+2 -1）',
        details: {
          operation: 'edit',
          path: 'src/source.ts',
          additions: 2,
          deletions: 1,
        },
        resultBlocks: [{ type: 'text', text: '已编辑 src/source.ts（+2 -1）' }],
        isError: false,
      },
    ])
  })

  test('projects text, citation, JSON and artifact result blocks from a normalized tool result', async () => {
    const seen: Array<{
      toolCallID: string
      resultBlocks?: unknown[]
      artifactInputs?: unknown[]
    }> = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        toolFinished: async (_context, result) => {
          seen.push(result)
        },
      },
    )

    await adapter.handle({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'web_search',
      result: {
        content: [
          {
            type: 'text',
            text: '结论',
            citations: [
              { type: 'url_citation', url: 'https://example.com/a', title: '示例 A' },
              { type: 'url_citation', url: 'https://example.com/b' },
            ],
          },
          {
            type: 'image',
            data: Buffer.from('png-bytes').toString('base64'),
            mimeType: 'image/png',
            size: 9,
          },
          { type: 'unknown_part', payload: 'anything' },
        ],
        structuredContent: { items: [{ id: 1, ok: true }] },
      },
      isError: false,
    } as unknown as AgentHarnessEvent)

    const projected = seen[0]!
    expect(projected.toolCallID).toBe('call-1')
    expect(projected.resultBlocks).toEqual([
      { type: 'text', text: '结论' },
      { type: 'citation', title: '示例 A', url: 'https://example.com/a' },
      { type: 'citation', url: 'https://example.com/b' },
      {
        type: 'artifact',
        artifactId: expect.any(String),
        name: expect.any(String),
        mimeType: 'image/png',
        size: 9,
      },
      { type: 'text', text: '{"type":"unknown_part","payload":"anything"}' },
      { type: 'json', value: { items: [{ id: 1, ok: true }] } },
    ])
    expect(projected.artifactInputs).toHaveLength(1)
    expect(projected.artifactInputs![0]).toMatchObject({
      mimeType: 'image/png',
      data: Buffer.from('png-bytes').toString('base64'),
    })
  })

  test('normalizes an explicit result-card envelope inside structured content', async () => {
    const seen: Array<{ resultBlocks?: unknown[] }> = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        toolFinished: async (_context, result) => {
          seen.push(result)
        },
      },
    )

    await adapter.handle({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'mcp__demo__report',
      result: {
        content: [{ type: 'text', text: '报告' }],
        structuredContent: {
          kind: 'pidex.result-card',
          version: 1,
          card: {
            title: '  任务已完成  ',
            summary: '  回归通过  ',
            tone: 'success',
            sections: [
              {
                title: '验证',
                items: [{ label: 'bun test', value: '通过', tone: 'success' }],
              },
            ],
            references: [{ kind: 'file', value: 'apps/agent/src/tool/tool.ts', label: '工具实现' }],
          },
        },
      },
      isError: false,
    } as unknown as AgentHarnessEvent)

    expect(seen[0]?.resultBlocks).toEqual([
      { type: 'text', text: '报告' },
      {
        type: 'json',
        value: {
          kind: 'pidex.result-card',
          version: 1,
          card: {
            title: '任务已完成',
            summary: '回归通过',
            tone: 'success',
            sections: [
              {
                title: '验证',
                items: [{ label: 'bun test', value: '通过', tone: 'success' }],
              },
            ],
            references: [{ kind: 'file', value: 'apps/agent/src/tool/tool.ts', label: '工具实现' }],
          },
        },
      },
    ])
  })

  test('keeps forged or future result-card envelopes as raw JSON blocks', async () => {
    const forged = [
      { kind: 'pidex.result-card', version: 1, card: { title: '无摘要' } },
      {
        kind: 'pidex.result-card',
        version: 2,
        card: { title: '未来版本', summary: '按 JSON 降级' },
      },
      {
        kind: 'pidex.other-card',
        version: 1,
        card: { title: '错误标记', summary: '按 JSON 降级' },
      },
    ]
    for (const structuredContent of forged) {
      const seen: Array<{ resultBlocks?: unknown[] }> = []
      const adapter = new PiEventAdapter(
        { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
        {
          toolFinished: async (_context, result) => {
            seen.push(result)
          },
        },
      )
      await adapter.handle({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'mcp__demo__report',
        result: { content: [{ type: 'text', text: '报告' }], structuredContent },
        isError: false,
      } as unknown as AgentHarnessEvent)
      expect(seen[0]?.resultBlocks).toEqual([
        { type: 'text', text: '报告' },
        { type: 'json', value: structuredContent },
      ])
    }
  })

  test('degrades unknown or non-JSON tool parts to bounded text instead of throwing', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const seen: Array<{ resultBlocks?: unknown[] }> = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        toolFinished: async (_context, result) => {
          seen.push(result)
        },
      },
    )

    await adapter.handle({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'read_file',
      result: {
        content: [{ type: 'text', text: 'plain' }],
        structuredContent: circular,
      },
      isError: false,
    } as unknown as AgentHarnessEvent)

    expect(seen[0]?.resultBlocks).toEqual([{ type: 'text', text: 'plain' }])
  })

  test('projects safe completion metadata and tolerates missing stop reason and usage', async () => {
    const completed: Array<{ completion?: unknown }> = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        assistantMessageCompleted: async (_context, input) => {
          completed.push(input)
        },
      },
    )

    await adapter.handle({
      type: 'message_end',
      message: {
        role: 'assistant',
        provider: 'openai',
        api: 'openai-responses',
        model: 'requested-model',
        content: [{ type: 'text', text: 'done' }],
        stopReason: 'stop',
        usage: {
          input: 10,
          output: 4,
          cacheRead: 20,
          cacheWrite: 5,
          reasoning: 2,
          totalTokens: 14,
        },
      },
    } as unknown as AgentHarnessEvent)
    expect(completed[0]?.completion).toEqual({
      stopReason: 'stop',
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
    })

    await adapter.handle({
      type: 'message_end',
      message: {
        role: 'assistant',
        provider: 'anthropic',
        api: 'anthropic-messages',
        model: 'claude-test',
        content: [{ type: 'text', text: 'done' }],
      },
    } as unknown as AgentHarnessEvent)
    expect(completed[1]?.completion).toBeUndefined()
  })

  test('unwraps semantic progress and shell output instead of displaying AgentToolResult JSON', () => {
    expect(
      piToolResultText(
        {
          content: [{ type: 'text', text: 'fallback' }],
          details: { message: '正在执行 Bash' },
        },
        { tool: 'shell', progress: true },
      ),
    ).toBe('正在执行 Bash')
    expect(
      piToolResultText(
        {
          content: [{ type: 'text', text: 'fallback' }],
          details: { stdout: 'out', stderr: 'warning' },
        },
        { tool: 'shell' },
      ),
    ).toBe('out\nwarning')
    expect(
      piToolResultText(
        {
          content: [{ type: 'text', text: 'fallback' }],
          details: { stdout: 'pwsh output', stderr: '' },
        },
        { tool: 'PowerShell' },
      ),
    ).toBe('pwsh output')
  })

  test('builds protocol-valid public tool items', () => {
    const item = piToolItemPayload({
      id: 'call-1',
      turnID: 'turn',
      agentID: 'agent',
      type: 'tool',
      status: 'completed',
      data: {
        callID: 'call-1',
        tool: 'shell',
        title: 'shell',
        input: { command: 'pwd' },
        command: 'pwd',
        output: 'ok',
        error: null,
        startedAt: 100,
        finishedAt: 125,
        durationMs: 25,
      },
      createdAt: 100,
      updatedAt: 125,
    })
    expect(() =>
      Schema.decodeUnknownSync(EventManifest['tool/callStarted'].payload)({
        item: { ...item, state: 'running', output: null, finishedAt: null, durationMs: null },
        inputSummary: 'pwd',
      }),
    ).not.toThrow()
    expect(() =>
      Schema.decodeUnknownSync(EventManifest['tool/callCompleted'].payload)({ item }),
    ).not.toThrow()
    expect(() =>
      Schema.decodeUnknownSync(EventManifest['tool/error'].payload)({
        item: { ...item, state: 'error', output: null, error: 'failed' },
        error: { code: 'TOOL_EXECUTION_ERROR', message: 'failed', retryable: false },
      }),
    ).not.toThrow()
  })

  test('finalizes a resumed tool once and stops its elapsed timer', () => {
    const running = {
      id: 'call-1',
      turnID: 'turn',
      agentID: 'agent',
      type: 'tool' as const,
      status: 'running' as const,
      data: {
        callID: 'call-1',
        tool: 'PowerShell',
        input: { command: 'bun test' },
        command: 'bun test',
        startedAt: 100,
      },
      createdAt: 100,
      updatedAt: 100,
    }
    const finished = finishedPiToolItem({
      current: running,
      turnID: 'turn',
      agentID: 'agent',
      toolCallID: 'call-1',
      tool: 'PowerShell',
      output: '用户拒绝了此工具调用，请改用其他方案。',
      isError: true,
      timestamp: 125,
    })

    expect(finished).toMatchObject({
      id: 'call-1',
      status: 'error',
      data: { state: 'error', finishedAt: 125, durationMs: 25 },
    })
    expect(
      finishedPiToolItem({
        current: finished!,
        turnID: 'turn',
        agentID: 'agent',
        toolCallID: 'call-1',
        tool: 'PowerShell',
        output: 'duplicate',
        isError: true,
        timestamp: 150,
      }),
    ).toBeNull()
  })

  test('merges successful mutation details into one idempotent patch item', () => {
    const items = new Map<
      string,
      {
        id: string
        turnID: string
        agentID: string
        type: 'tool' | 'patch'
        status: 'running' | 'completed' | 'interrupted'
        data: Record<string, unknown>
        ordinal?: number
        createdAt: number
        updatedAt: number
      }
    >()
    items.set('call-1', {
      id: 'call-1',
      turnID: 'turn',
      agentID: 'agent',
      type: 'tool',
      status: 'running',
      data: {
        tool: 'apply_patch',
        input: {
          affectedPaths: [
            { path: 'src/source.ts', operation: 'update' },
            { path: 'src/added.ts', operation: 'create' },
          ],
        },
      },
      createdAt: 100,
      updatedAt: 100,
    })
    let transactionCount = 0
    let eventID = 0
    const db = {
      repositories: {
        turnPatches: {
          getByTurn: () => null,
        },
      },
      transaction: <T>(work: () => T) => {
        transactionCount += 1
        return work()
      },
      getItem: (id: string) => items.get(id) ?? null,
      upsertItem: (
        _threadID: string,
        item: typeof items extends Map<string, infer Value> ? Value : never,
      ) => {
        items.set(item.id, item)
      },
      insertEvent: (threadId: string, turnId: string, method: string, params: unknown) => ({
        id: ++eventID,
        threadId,
        turnId,
        method,
        params,
        createdAt: 200,
      }),
    }
    const orchestrator = new AgentRuntimeService({
      db: db as never,
      hub: {} as never,
      models: {} as never,
      toolExecutor: {} as never,
      contextCompaction: {} as never,
    })
    const persist = (
      orchestrator as unknown as {
        persistFinishedTool(context: unknown, input: unknown): Array<{ method: string }>
      }
    ).persistFinishedTool.bind(orchestrator)
    const input = {
      toolCallID: 'call-1',
      tool: 'apply_patch',
      output: '完成',
      details: {
        operation: 'apply_patch',
        files: [
          { path: 'src/source.ts', additions: 3, deletions: 1 },
          { path: 'src/added.ts', additions: 2, deletions: 0 },
        ],
      },
      isError: false,
    }

    expect(
      persist({ threadID: 'thread', turnID: 'turn', agentID: 'agent' }, input).map(
        (event) => event.method,
      ),
    ).toEqual(['tool/callCompleted', 'item/completed'])
    expect(items.get('call-1')?.data.input).toMatchObject({
      affectedPaths: [
        { path: 'src/source.ts', operation: 'update', additions: 3, deletions: 1 },
        { path: 'src/added.ts', operation: 'create', additions: 2, deletions: 0 },
      ],
    })
    expect(items.get('call-1')?.data.activity).toEqual({
      type: 'file_change',
      changes: [
        { path: 'source.ts', operation: 'update', additions: 3, deletions: 1 },
        { path: 'added.ts', operation: 'create', additions: 2, deletions: 0 },
      ],
    })
    expect(items.get('patch:turn')).toMatchObject({
      type: 'patch',
      status: 'completed',
      data: {
        files: [
          { path: 'src/source.ts', additions: 3, deletions: 1 },
          { path: 'src/added.ts', additions: 2, deletions: 0 },
        ],
        totalAdditions: 5,
        totalDeletions: 1,
      },
    })
    items.set('call-2', {
      id: 'call-2',
      turnID: 'turn',
      agentID: 'agent',
      type: 'tool',
      status: 'running',
      data: {
        tool: 'Edit',
        input: { path: 'src/source.ts' },
        activity: {
          type: 'file_change',
          changes: [{ path: 'src/source.ts', operation: 'update' }],
        },
      },
      createdAt: 100,
      updatedAt: 100,
    })
    expect(
      persist(
        { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
        {
          toolCallID: 'call-2',
          tool: 'Edit',
          output: '失败',
          details: { path: 'src/source.ts', additions: 100, deletions: 100 },
          isError: true,
        },
      ).map((event) => event.method),
    ).toEqual(['tool/error'])
    expect(items.get('call-2')?.data.activity).toEqual({
      type: 'file_change',
      changes: [{ path: 'source.ts', operation: 'update', additions: 100, deletions: 100 }],
    })
    expect(items.get('patch:turn')?.data).toMatchObject({
      totalAdditions: 5,
      totalDeletions: 1,
    })
    items.set('call-3', {
      id: 'call-3',
      turnID: 'turn',
      agentID: 'agent',
      type: 'tool',
      status: 'interrupted',
      data: {
        tool: 'Write',
        input: { file_path: 'src/other.ts' },
        activity: {
          type: 'file_change',
          changes: [{ path: 'src/other.ts', operation: 'create' }],
        },
      },
      createdAt: 100,
      updatedAt: 100,
    })
    expect(
      persist(
        { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
        {
          toolCallID: 'call-3',
          tool: 'Write',
          output: '中断',
          details: { path: 'src/other.ts', additions: 100, deletions: 0 },
          isError: false,
        },
      ),
    ).toEqual([])
    expect(items.get('call-3')?.data.activity).toEqual({
      type: 'file_change',
      changes: [{ path: 'src/other.ts', operation: 'create' }],
    })
    expect(persist({ threadID: 'thread', turnID: 'turn', agentID: 'agent' }, input)).toEqual([])
    expect(transactionCount).toBe(2)
  })

  test('normalizes mutation paths and accumulates repeated edits', () => {
    expect(
      piToolMutationFiles('Write', {
        path: 'src\\source.ts',
        additions: 2.8,
        deletions: -1,
        content: 'must-not-survive',
      }),
    ).toEqual([{ path: 'src/source.ts', additions: 2, deletions: 0 }])
    expect(
      mergeTimelineMutationFiles(
        [{ path: 'src/source.ts', additions: 1, deletions: 2 }],
        [{ path: 'src\\source.ts', additions: 3, deletions: 4 }],
      ),
    ).toEqual([{ path: 'src/source.ts', additions: 4, deletions: 6 }])
  })

  test('carries the pre-compaction branch size into the compacted callback', async () => {
    const seen: unknown[] = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        compacted: async (_context, compacted) => {
          seen.push(compacted)
        },
      },
    )

    await adapter.handle({
      type: 'session_before_compact',
      branchEntries: [{}, {}, {}],
      preparation: {
        messagesToSummarize: [{}, {}],
        turnPrefixMessages: [],
        retainedTail: [{}],
      },
      signal: new AbortController().signal,
    } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: 'session_compact',
      compactionEntry: { id: 'compact-1', summary: 'summary', tokensBefore: 8000 },
      fromHook: false,
    } as unknown as AgentHarnessEvent)

    expect(seen).toEqual([
      {
        entryID: 'compact-1',
        summary: 'summary',
        firstKeptEntryID: null,
        tokensBefore: 8000,
        beforeCount: 3,
        trigger: 'manual',
        promptText: '',
      },
    ])
  })

  test('classifies only provider context-window failures for reactive compaction', () => {
    expect(isProviderContextOverflow('context_length_exceeded')).toBe(true)
    expect(isProviderContextOverflow('Maximum context length is 128000 tokens')).toBe(true)
    expect(isProviderContextOverflow('Input token count exceeds the model limit')).toBe(true)
    expect(isProviderContextOverflow('context window limit exceeded')).toBe(true)
    expect(isProviderContextOverflow('attachment too large')).toBe(false)
    expect(isProviderContextOverflow('tool returned HTTP 413')).toBe(false)
  })

  test('uses the existing item delta payload for Pi reasoning and tool output', () => {
    const payload = piItemDeltaPayload({
      itemID: 'call-1',
      context: { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      delta: 'partial',
    })

    expect(() =>
      Schema.decodeUnknownSync(EventManifest['reasoning/textDelta'].payload)(payload),
    ).not.toThrow()
    expect(() =>
      Schema.decodeUnknownSync(EventManifest['tool/outputDelta'].payload)(payload),
    ).not.toThrow()
    expect(payload).toEqual({
      itemId: 'call-1',
      turnId: 'turn',
      agentId: 'agent',
      delta: 'partial',
    })
  })
})
