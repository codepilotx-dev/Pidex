import { describe, expect, test } from 'bun:test'
import type { Item } from '@pidex/shared/thread'

import {
  formatProcessElapsed,
  summarizeTurnProcessItems,
  summarizeTurnWork,
} from '../src/features/session/timeline/SummarizeProcessItems.js'

type ToolItem = Extract<Item, { type: 'tool' }>

function toolItem(overrides: Partial<ToolItem> & Pick<ToolItem, 'state'>, id = 'tool-1'): ToolItem {
  return {
    id,
    messageID: id,
    turnId: 'turn-1',
    agentId: 'agent-1',
    type: 'tool',
    callID: `call-${id}`,
    tool: 'Bash',
    title: '运行命令',
    input: null,
    command: 'bun test',
    output: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: 0,
    ...overrides,
  }
}

describe('summarizeTurnProcessItems', () => {
  test('combines semantic categories in fixed order and removes duplicates', () => {
    const result = summarizeTurnProcessItems(
      [
        toolItem({ state: 'completed' }, 'command-1'),
        toolItem(
          { activity: { type: 'web_search' }, command: null, state: 'completed', tool: 'web__run' },
          'web-1',
        ),
        toolItem(
          {
            activity: { type: 'read', subject: 'file', target: { displayLabel: 'src/a.ts' } },
            command: null,
            state: 'completed',
            tool: 'Read',
          },
          'read-1',
        ),
        toolItem(
          {
            activity: { type: 'file_change', changes: [{ path: 'src/a.ts', operation: 'update' }] },
            command: null,
            mutationDiffPaths: ['src/a.ts', 'src/b.ts'],
            state: 'completed',
            tool: 'Edit',
          },
          'edit-1',
        ),
        toolItem(
          {
            activity: { type: 'tool', mode: 'call' },
            command: null,
            state: 'completed',
            tool: 'custom_tool',
          },
          'other-1',
        ),
        toolItem(
          {
            activity: { type: 'tool', mode: 'call', name: 'custom.named' },
            command: null,
            state: 'completed',
            tool: 'custom_named',
          },
          'named-1',
        ),
        toolItem(
          {
            activity: { type: 'integration', source: 'drive' },
            command: null,
            state: 'completed',
            tool: 'mcp__drive__search',
          },
          'mcp-1',
        ),
        toolItem(
          {
            activity: { type: 'read', subject: 'skill', target: { displayLabel: 'review' } },
            command: null,
            state: 'completed',
            tool: 'skill_read',
          },
          'skill-1',
        ),
      ],
      'completed',
    )

    expect(result).toMatchObject({
      active: false,
      failed: false,
      kind: 'integration',
      label: '使用 drive、加载工具、调用工具、编辑文件、读取文件、运行命令、搜索网页、调用工具',
    })
    expect(result.summaryKey).toBe(
      'completed:ok:integration:drive|loaded-tool|tool|file-change|exploration|command|web-search|dynamic-tool',
    )
  })

  test('uses the file label and a safe fallback', () => {
    expect(
      summarizeTurnProcessItems(
        [
          toolItem({
            activity: { type: 'file_change', changes: [{ path: 'src/a.ts', operation: 'write' }] },
            command: null,
            state: 'completed',
            tool: 'Write',
          }),
        ],
        'completed',
      ),
    ).toMatchObject({
      kind: 'file-change',
      label: '编辑文件',
    })

    const text = {
      id: 'text-1',
      type: 'text',
      status: 'completed',
    } as unknown as Item
    expect(summarizeTurnProcessItems([text], 'completed')).toMatchObject({
      kind: 'tool',
      label: '处理过程',
    })
  })

  test('aggregates every activity item for a running summary', () => {
    const result = summarizeTurnProcessItems(
      [
        toolItem({ state: 'running' }, 'command-1'),
        toolItem(
          {
            activity: { type: 'read', subject: 'file', target: { displayLabel: 'src/foo.ts' } },
            command: null,
            state: 'running',
            tool: 'Read',
          },
          'read-1',
        ),
      ],
      'running',
    )

    expect(result).toMatchObject({
      active: true,
      failed: false,
      kind: 'exploration',
      label: '读取文件、运行命令',
    })
    expect(result.summaryKey).toContain('read-1')

    const streamingReasoning = {
      id: 'reasoning-streaming',
      type: 'reasoning',
      text: '继续分析',
      status: 'streaming',
    } as unknown as Item
    expect(
      summarizeTurnProcessItems(
        [
          toolItem(
            {
              activity: { type: 'search', query: 'needle' },
              command: null,
              state: 'running',
              tool: 'Grep',
            },
            'grep-running',
          ),
          streamingReasoning,
        ],
        'running',
      ),
    ).toMatchObject({
      kind: 'exploration',
      label: '读取文件',
    })

    const completedReasoning = {
      id: 'reasoning-1',
      type: 'reasoning',
      text: '分析下一步',
      status: 'completed',
    } as unknown as Item
    // 纯思考不产生聚合标签，思考态由时间线的 thinking fallback 承载。
    expect(summarizeTurnProcessItems([completedReasoning], 'running')).toMatchObject({
      active: true,
      kind: 'tool',
      label: '处理过程',
    })
  })

  test('promotes child failures to the group state', () => {
    expect(
      summarizeTurnProcessItems(
        [
          toolItem({ error: 'failed', state: 'error' }),
          toolItem({ state: 'completed' }, 'command-2'),
        ],
        'completed',
      ),
    ).toMatchObject({
      active: false,
      failed: true,
      kind: 'command',
      label: '运行命令',
    })
  })

  test('summarizes interrupted creates separately', () => {
    expect(
      summarizeTurnProcessItems(
        [
          toolItem({
            activity: {
              type: 'file_change',
              changes: [{ path: 'src/new.ts', operation: 'create' }],
            },
            command: null,
            state: 'interrupted',
            tool: 'Write',
          }),
        ],
        'completed',
      ),
    ).toMatchObject({
      failed: true,
      kind: 'file-change',
      label: '停止创建文件',
    })
  })
})

describe('turn work status', () => {
  test('formats compact elapsed time', () => {
    expect(formatProcessElapsed(12)).toBe('12s')
    expect(formatProcessElapsed(300)).toBe('5m')
    expect(formatProcessElapsed(359)).toBe('5m 59s')
    expect(formatProcessElapsed(3_723)).toBe('1h 2m 3s')
    expect(formatProcessElapsed(0)).toBe('')
  })

  test('uses Codex working, completed and stopped copy', () => {
    expect(summarizeTurnWork('running', 0)).toEqual({
      kind: 'working',
      label: '处理中',
    })
    expect(summarizeTurnWork('running', 12)).toEqual({
      kind: 'working',
      label: '已处理 12s',
    })
    expect(summarizeTurnWork('completed', 359)).toEqual({
      kind: 'worked',
      label: '已处理 5m 59s',
    })
    expect(summarizeTurnWork('stopped', 84)).toEqual({
      kind: 'stopped',
      label: '你在 1m 24s 后停止了',
    })
  })
})
