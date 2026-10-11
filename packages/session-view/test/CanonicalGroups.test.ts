import { describe, expect, test } from 'bun:test'
import type { DurableEventEnvelope, LiveEventEnvelope } from '@pidex/agent-protocol'
import type { Thread, Turn } from '@pidex/shared/thread'

import {
  applyThreadEnvelopes,
  createCanonicalThreadState,
  prependOlderThreadPage,
  selectRenderTurnEntries,
  type CanonicalThreadState,
  type ThreadHistoryPageLike,
} from '../src/canonical/index.js'

const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const
const model = { providerID: 'openai', id: 'gpt-groups' }

const thread: Thread = {
  id: 'thread-groups',
  title: '索引等价性',
  projectID: null,
  gitBranch: null,
  settings: { taskMode: 'chat', permissionConfig },
  createdAt: 1,
  updatedAt: 1,
}

function makeTurn(index: number, status: Turn['status'] = 'running'): Turn {
  return {
    id: `turn-${index}`,
    threadId: thread.id,
    sourceInputID: `input-${index}`,
    status,
    mode: 'chat',
    model,
    permissionConfig,
    rootAgentId: `agent-${index}`,
    mergedInputIDs: [],
    startedAt: index,
    finishedAt: status === 'running' ? null : index + 1,
    elapsedSeconds: 0,
    error: null,
  }
}

function basePage(): ThreadHistoryPageLike {
  return {
    thread,
    subagents: [],
    turns: [
      {
        turn: makeTurn(1, 'completed'),
        inputs: [
          {
            id: 'input-1',
            threadId: thread.id,
            turnId: 'turn-1',
            content: '第一轮',
            delivery: 'start',
            mode: 'chat',
            model,
            permissionConfig,
            state: 'completed',
            attachmentIds: [],
            createdAt: 1,
          },
        ],
        messages: [],
        agents: [
          {
            id: 'agent-1',
            threadId: thread.id,
            turnId: 'turn-1',
            parentAgentId: null,
            profile: 'main',
            task: '第一轮',
            model,
            sessionId: 'session-1',
            depth: 0,
            status: 'completed',
            error: null,
            subagentRunId: null,
            runSequence: 0,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        items: [
          {
            id: 'item-1-text',
            messageID: 'message-1',
            turnId: 'turn-1',
            agentId: 'agent-1',
            type: 'text',
            placement: 'result',
            text: '第一轮结果',
            status: 'completed',
            ordinal: 0,
            createdAt: 2,
          },
        ],
        approvals: [],
        attachments: [],
      },
      {
        turn: makeTurn(2),
        inputs: [
          {
            id: 'input-2',
            threadId: thread.id,
            turnId: 'turn-2',
            content: '第二轮',
            delivery: 'start',
            mode: 'chat',
            model,
            permissionConfig,
            state: 'completed',
            attachmentIds: [],
            createdAt: 3,
          },
        ],
        messages: [],
        agents: [
          {
            id: 'agent-2',
            threadId: thread.id,
            turnId: 'turn-2',
            parentAgentId: null,
            profile: 'main',
            task: '第二轮',
            model,
            sessionId: 'session-2',
            depth: 0,
            status: 'running',
            error: null,
            subagentRunId: 'run-2',
            runSequence: 0,
            createdAt: 3,
            updatedAt: 3,
          },
        ],
        items: [],
        approvals: [],
        attachments: [],
      },
    ],
    queue: { version: 0, pauseReason: null, turns: [], inputs: [] },
    olderCursor: null,
    hasOlder: false,
    streamPosition: { streamId: thread.id, sequence: 0 },
  }
}

function liveDelta(
  itemId: string,
  delta: string,
  index: number,
): LiveEventEnvelope<'item/agentMessage/delta'> {
  return {
    eventId: `${itemId}-live-${index}`,
    streamId: thread.id,
    type: 'item/agentMessage/delta',
    version: 1,
    occurredAt: 20 + index,
    threadId: thread.id,
    turnId: 'turn-2',
    durability: 'live',
    sequence: null,
    afterSequence: 0,
    payload: { itemId, turnId: 'turn-2', agentId: 'agent-2', delta },
  }
}

const eventSequence: readonly DurableEventEnvelope[] = [
  {
    eventId: 'tool-started',
    streamId: thread.id,
    type: 'tool/callStarted',
    version: 1,
    occurredAt: 30,
    threadId: thread.id,
    turnId: 'turn-2',
    durability: 'durable',
    sequence: 1,
    payload: {
      item: {
        id: 'item-2-tool',
        messageID: 'message-2',
        turnId: 'turn-2',
        agentId: 'agent-2',
        type: 'tool',
        tool: 'Bash',
        callID: 'call-1',
        title: '运行测试',
        state: 'running',
        output: '',
        ordinal: 0,
        createdAt: 30,
        startedAt: 30,
      },
    },
  },
  {
    eventId: 'approval-requested',
    streamId: thread.id,
    type: 'approval/requested',
    version: 1,
    occurredAt: 31,
    threadId: thread.id,
    turnId: 'turn-2',
    durability: 'durable',
    sequence: 2,
    payload: {
      interactionId: 'approval-1',
      threadId: thread.id,
      turnId: 'turn-2',
      agentId: 'agent-2',
      toolCallId: 'call-1',
      tool: 'Bash',
      requestedPermissions: [],
      risk: 'high',
      reason: '需要审批',
      createdAt: 31,
    },
  },
  {
    eventId: 'question-requested',
    streamId: thread.id,
    type: 'question/requested',
    version: 1,
    occurredAt: 32,
    threadId: thread.id,
    turnId: 'turn-2',
    durability: 'durable',
    sequence: 3,
    payload: {
      interactionId: 'question-1',
      turnId: 'turn-2',
      agentId: 'agent-2',
      questions: [{ id: 'q1', prompt: '继续吗', choices: [] }],
      createdAt: 32,
    },
  },
  {
    eventId: 'item-completed',
    streamId: thread.id,
    type: 'item/completed',
    version: 1,
    occurredAt: 40,
    threadId: thread.id,
    turnId: 'turn-2',
    durability: 'durable',
    sequence: 4,
    payload: {
      item: {
        id: 'item-2-stream',
        messageID: 'message-2-stream',
        turnId: 'turn-2',
        agentId: 'agent-2',
        type: 'text',
        placement: 'result',
        text: '流式结果',
        status: 'completed',
        ordinal: 1,
        createdAt: 40,
      },
    },
  },
  {
    eventId: 'turn-completed',
    streamId: thread.id,
    type: 'turn/completed',
    version: 2,
    occurredAt: 41,
    threadId: thread.id,
    turnId: 'turn-2',
    durability: 'durable',
    sequence: 5,
    payload: { turn: makeTurn(2, 'completed') },
  },
] as unknown as readonly DurableEventEnvelope[]

describe('canonical turn group index', () => {
  test('增量维护的分组索引与整体重建的渲染输出逐项一致', () => {
    let state: CanonicalThreadState = createCanonicalThreadState(basePage())
    // 混入 live delta 与 durable 事件，覆盖新建条目、原位更新、审批与提问。
    const envelopes = [
      liveDelta('item-2-stream', '流式', 0),
      liveDelta('item-2-stream', '结果', 1),
      ...eventSequence,
    ]
    state = applyThreadEnvelopes(state, envelopes)

    // 用一次空 prepend 触发索引整体重建，作为增量维护的对照实现。
    const olderPage: ThreadHistoryPageLike = {
      ...basePage(),
      turns: [],
      olderCursor: 'cursor-1',
    }
    const rebuilt = prependOlderThreadPage(state, olderPage)

    // 重建前必须真的走了增量路径，否则本用例失去意义。排序按 ordinal 优先，
    // 无 ordinal 的条目回落到 createdAt：tool(ordinal 0) < question(32) < stream(40)。
    expect(state.groups.itemsByTurnId.get('turn-2')?.map((item) => item.id)).toEqual([
      'item-2-tool',
      'question-1',
      'item-2-stream',
    ])
    expect(state.groups.approvalsByTurnId.get('turn-2')?.map((a) => a.id)).toEqual(['approval-1'])

    expect(selectRenderTurnEntries(rebuilt)).toEqual(selectRenderTurnEntries(state))
  })

  test('subagent 作用域按 runId 索引过滤 items 与 approvals', () => {
    let state = createCanonicalThreadState(basePage())
    state = applyThreadEnvelopes(state, [
      { ...liveDelta('item-2-stream', '流式', 0), turnId: 'turn-2' },
      ...eventSequence,
    ])

    const mainScope = selectRenderTurnEntries(state)
    const subagentScope = selectRenderTurnEntries(state, { type: 'subagent', runId: 'run-2' })

    // agent-2 属于 run-2，因此 subagent 作用域保留 turn-2 的条目；turn-1 因仍
    // 带 agent 条目而保留，但其 items/approvals 被 runId 过滤为空。
    expect(subagentScope.map((entry) => entry.id)).toEqual(['turn-1', 'turn-2'])
    expect(subagentScope.find((entry) => entry.id === 'turn-1')?.items).toEqual([])
    expect(
      subagentScope.find((entry) => entry.id === 'turn-2')?.items.map((item) => item.id),
    ).toEqual(['item-2-tool', 'question-1', 'item-2-stream'])
    expect(
      subagentScope.find((entry) => entry.id === 'turn-2')?.approvals.map((a) => a.id),
    ).toEqual(['approval-1'])
    expect(mainScope.map((entry) => entry.id)).toEqual(['turn-1', 'turn-2'])

    // 与改动前一致：runId 过滤只作用于 items/approvals，带 agent 的 turn 仍然
    // 保留（因此不存在的 runId 也会返回空的 turn 骨架）。
    const otherRunScope = selectRenderTurnEntries(state, { type: 'subagent', runId: 'run-missing' })
    expect(otherRunScope.map((entry) => entry.id)).toEqual(['turn-1', 'turn-2'])
    expect(
      otherRunScope.every((entry) => entry.items.length === 0 && entry.approvals.length === 0),
    ).toBe(true)
  })
})
