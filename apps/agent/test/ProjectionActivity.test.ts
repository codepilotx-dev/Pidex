import { describe, expect, test } from 'bun:test'
import type { Item } from '../src/Domain'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import type { AgentDatabase } from '../src/storage/database/AgentDatabase'

describe('活动投影', () => {
  test('透传只读工具命令和输出', () => {
    const projection = new ThreadProjection({} as unknown as AgentDatabase)
    const item: Item = {
      id: 'activity-1',
      turnID: 'turn-1',
      agentID: 'agent-1',
      type: 'activity',
      status: 'completed',
      data: {
        role: 'planner',
        activity: 'notice',
        title: '读取文件',
        detail: 'README.md',
        commands: [
          {
            command: 'workspace_read README.md',
            output: '# README',
            status: 'success',
            truncated: false,
          },
        ],
      },
      createdAt: 1000,
      updatedAt: 1001,
    }

    expect(projection.item(item)).toMatchObject({
      type: 'activity',
      title: '读取文件',
      detail: 'README.md',
      commands: [
        {
          command: 'workspace_read README.md',
          output: '# README',
          status: 'success',
          truncated: false,
        },
      ],
    })
  })

  test('通知携带 Thread 上下文并投影原生 Item', () => {
    const projection = new ThreadProjection({} as unknown as AgentDatabase)
    const projected = projection.notification({
      id: 7,
      threadId: 'thread-1',
      turnId: 'turn-1',
      method: 'item/completed',
      params: {
        item: {
          id: 'text-1',
          turnID: 'turn-1',
          agentID: 'agent-1',
          type: 'text',
          status: 'completed',
          data: { text: '完成' },
          createdAt: 1000,
          updatedAt: 1001,
        },
      },
      createdAt: 1001,
    })

    expect(projected.notification.params).toMatchObject({
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { id: 'text-1', turnId: 'turn-1', type: 'text', text: '完成' },
    })
  })

  test('文本项投影标准模型 usage 并兼容缺失字段', () => {
    const projection = new ThreadProjection({} as unknown as AgentDatabase)
    const item: Item = {
      id: 'text-usage',
      turnID: 'turn-1',
      agentID: 'agent-1',
      type: 'text',
      status: 'completed',
      data: {
        placement: 'result',
        text: '完成',
        usage: {
          provider: 'openai',
          model: 'gpt-test',
          contextWindow: 128_000,
          input: 10,
          output: 4,
          cacheRead: 20,
          cacheWrite: 5,
          reasoning: 2,
        },
      },
      createdAt: 1000,
      updatedAt: 1001,
    }

    expect(projection.item(item)).toMatchObject({
      type: 'text',
      usage: {
        provider: 'openai',
        model: 'gpt-test',
        contextWindow: 128_000,
        input: 10,
        output: 4,
        cacheRead: 20,
        cacheWrite: 5,
        reasoning: 2,
      },
    })
    expect(projection.item(item)).not.toHaveProperty('usage.breakdown')
    expect(
      projection.item({
        ...item,
        id: 'text-without-usage',
        data: { placement: 'result', text: '旧数据' },
      }),
    ).not.toHaveProperty('usage')
  })

  test('上下文来源拆解随 usage 投影，非法条目被丢弃而不影响整条 usage', () => {
    const projection = new ThreadProjection({} as unknown as AgentDatabase)
    const item: Item = {
      id: 'text-breakdown',
      turnID: 'turn-1',
      agentID: 'agent-1',
      type: 'text',
      status: 'completed',
      data: {
        placement: 'result',
        text: '完成',
        usage: {
          provider: 'openai',
          model: 'gpt-test',
          contextWindow: 128_000,
          input: 10,
          output: 4,
          cacheRead: 20,
          cacheWrite: 5,
          reasoning: 2,
          breakdown: [
            { source: 'messages', chars: 120 },
            { source: 'mcp_tools', chars: 30.7 },
            { source: 'unknown-source', chars: 999 },
            { source: 'skills', chars: -1 },
          ],
        },
      } as Item['data'],
      createdAt: 1000,
      updatedAt: 1001,
    }

    expect(projection.item(item)).toMatchObject({
      type: 'text',
      usage: {
        input: 10,
        breakdown: [
          { source: 'messages', chars: 120 },
          { source: 'mcp_tools', chars: 30 },
        ],
      },
    })

    expect(
      projection.item({
        ...item,
        id: 'text-broken-breakdown',
        data: {
          ...(item.data as Record<string, unknown>),
          usage: {
            provider: 'openai',
            model: 'gpt-test',
            contextWindow: 128_000,
            input: 10,
            output: 4,
            cacheRead: 20,
            cacheWrite: 5,
            reasoning: 2,
            breakdown: [{ source: 'messages', chars: 0 }],
          },
        },
      } as Item),
    ).not.toHaveProperty('usage.breakdown')
  })

  test('工具投影保留调用标识、命令和实际时间', () => {
    const projection = new ThreadProjection({} as unknown as AgentDatabase)
    const item: Item = {
      id: 'stored-item',
      turnID: 'turn-1',
      agentID: 'agent-1',
      type: 'tool',
      status: 'completed',
      data: {
        callID: 'call-1',
        tool: 'shell',
        title: '执行命令',
        input: { command: 'pwd' },
        command: 'pwd',
        output: 'ok',
        error: null,
        startedAt: 1000,
        finishedAt: 1250,
        durationMs: 250,
      },
      createdAt: 900,
      updatedAt: 1300,
    }
    expect(projection.item(item)).toMatchObject({
      callID: 'call-1',
      tool: 'shell',
      title: '执行命令',
      command: 'pwd',
      startedAt: 1000,
      finishedAt: 1250,
      durationMs: 250,
    })
  })
})
