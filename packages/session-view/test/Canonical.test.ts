import { describe, expect, test } from 'bun:test'
import type {
  AgentExecution,
  ApprovalRequest,
  Input,
  Item,
  SubagentProjection,
  Thread,
  Turn,
} from '@pidex/shared/thread'
import type {
  DurableEventEnvelope,
  DurableEventType,
  EventPayload,
  LiveEventEnvelope,
  LiveEventType,
} from '@pidex/agent-protocol'
import {
  applyThreadEnvelope,
  applyThreadEnvelopes,
  createCanonicalThreadState,
  pageFromThreadSnapshot,
  createRenderTurnEntriesSelector,
  prependOlderThreadPage,
  reconcileLatestThreadPage,
  selectRenderTurnEntries,
  selectVisibleTurnEntries,
  type ThreadEventEnvelopeLike,
  type ThreadHistoryPageLike,
} from '../src/canonical/index'

const model = { providerID: 'openai', id: 'gpt-test' }
const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const

const thread: Thread = {
  id: 'thread-1',
  title: '测试会话',
  projectID: null,
  gitBranch: null,
  settings: { taskMode: 'chat', permissionConfig },
  createdAt: 1,
  updatedAt: 2,
}

test('子代理树在快照和实时事件中统一投影后代进度与父级报告', () => {
  const projection = (
    id: string,
    parentThreadId: string,
    childThreadId: string,
  ): SubagentProjection => {
    const run = {
      id: `run-${id}`,
      taskId: id,
      generation: 1,
      status: 'running' as const,
      queueReason: null,
      model,
      permissionConfig,
      result: null,
      error: null,
      createdAt: 1,
      startedAt: 1,
      finishedAt: null,
      updatedAt: 1,
    }
    return {
      task: {
        id,
        parentThreadId,
        parentTurnId: 'root-turn',
        parentAgentId: 'root-agent',
        childThreadId,
        displayName: id,
        profile: 'worker',
        task: 'task',
        permissionCeiling: permissionConfig,
        workspace: { mode: 'shared', state: 'ready', rootPath: null, baselineRef: null },
        currentRun: run,
        createdAt: 1,
        updatedAt: 1,
      },
      currentRun: run,
    }
  }
  const parent = projection('parent', thread.id, 'child-thread')
  parent.task = {
    ...parent.task,
    depth: 1,
    waitingForDescendants: true,
    notices: [{ id: 'report', kind: 'report', message: '找到证据', createdAt: 1 }],
  }
  const child = projection('leaf', 'child-thread', 'leaf-thread')
  const item: Extract<Item, { type: 'subagent' }> = {
    id: 'subagent-item',
    messageID: 'message',
    turnId: 'root-turn',
    agentId: 'root-agent',
    type: 'subagent',
    subagentTaskId: parent.task.id,
    runId: parent.currentRun!.id,
    childThreadId: parent.task.childThreadId,
    displayName: 'parent',
    profile: 'worker',
    task: 'task',
    status: 'running',
    queueReason: null,
    result: null,
    createdAt: 1,
  }
  const state = createCanonicalThreadState({
    ...page([
      {
        turn: turn('root-turn'),
        inputs: [],
        messages: [],
        agents: [],
        items: [item],
        approvals: [],
      },
    ]),
    subagents: [parent, child],
  })
  expect(state.itemsById.get(item.id)).toMatchObject({
    depth: 1,
    descendantCount: 1,
    activeDescendantCount: 1,
    waitingForDescendants: true,
    latestReport: '找到证据',
  })
  const finished = { ...child.currentRun!, status: 'completed' as const }
  const next = applyThreadEnvelope(
    state,
    durable(11, 'subagent/updated', {
      projection: { task: { ...child.task, currentRun: finished }, currentRun: finished },
    }),
  )
  expect(next.itemsById.get(item.id)).toMatchObject({
    descendantCount: 1,
    activeDescendantCount: 0,
    latestReport: '找到证据',
  })
})

test('MCP 表单实时请求和三种回复经过统一 projection，重复事件不恢复待处理卡', () => {
  for (const action of ['accept', 'decline', 'cancel'] as const) {
    const requested = durable(11, 'mcp/elicitationRequested', {
      interactionId: 'form',
      threadId: thread.id,
      turnId: 'turn',
      agentId: 'agent',
      toolCallId: 'call',
      kind: 'mcp-elicitation',
      server: 'fixture',
      tool: 'save',
      version: 1,
      createdAt: 11,
      request: { message: '输入名称', requestedSchema: { type: 'object', properties: {} } },
    })
    const pending = applyThreadEnvelope(createCanonicalThreadState(page([])), requested)
    expect(pending.approvalsById.get('form')).toMatchObject({
      status: 'pending',
      tool: 'McpElicitation',
      input: { serverName: 'fixture' },
      toolIdentity: { server: 'fixture', tool: 'save' },
    })
    const resolved = applyThreadEnvelope(
      pending,
      durable(12, 'interaction/resolved', {
        interactionId: 'form',
        resolvedAt: 12,
        result: { kind: 'mcp-elicitation', action },
      }),
    )
    expect(resolved.approvalsById.get('form')?.status).toBe(
      action === 'accept' ? 'allowed' : action === 'cancel' ? 'cancelled' : 'denied',
    )
    expect(applyThreadEnvelope(resolved, requested).approvalsById.get('form')?.status).not.toBe(
      'pending',
    )
  }
})

test('preserves plan approval on snapshot/history hydration and clears it on new input', () => {
  const approval = {
    id: 'plan-approval',
    threadId: thread.id,
    turnId: 'plan-turn',
    planItemId: 'plan-item',
    version: 1,
    status: 'pending' as const,
    title: '计划',
    markdown: '# 计划',
    nextTurnId: null,
    createdAt: 1,
    resolvedAt: null,
  }
  const snapshotPage = pageFromThreadSnapshot({
    thread,
    turns: [],
    agents: [],
    subagents: [],
    inputs: [],
    messages: [],
    items: [],
    approvals: [],
    pendingPlanApproval: approval,
  })
  expect(snapshotPage.pendingPlanApproval).toEqual(approval)
  const state = createCanonicalThreadState({ ...page([]), pendingPlanApproval: approval })
  expect(state.pendingPlanApproval).toEqual(approval)
  expect(prependOlderThreadPage(state, page([])).pendingPlanApproval).toEqual(approval)
  expect(
    reconcileLatestThreadPage(state, { ...page([]), pendingPlanApproval: null })
      .pendingPlanApproval,
  ).toBeNull()
  for (const type of ['turn/queued', 'turn/started'] as const) {
    const nextTurn = turn('next')
    expect(
      applyThreadEnvelope(
        state,
        durable(11, type, { turn: nextTurn, input: input('next-input', nextTurn.id, 11) }),
      ).pendingPlanApproval,
    ).toBeNull()
  }
  expect(
    applyThreadEnvelope(
      state,
      durable(11, 'queue/updated', { threadId: thread.id, action: 'added' }),
    ).pendingPlanApproval,
  ).toBeNull()
  expect(
    applyThreadEnvelope(
      state,
      durable(11, 'thread/settings/updated', { threadId: thread.id, settings: thread.settings }),
    ).pendingPlanApproval,
  ).toBeNull()
  expect(createCanonicalThreadState(page([])).pendingPlanApproval).toBeNull()
})

function turn(id: string, sourceInputID = `input-${id}`): Turn {
  return {
    id,
    threadId: thread.id,
    sourceInputID,
    status: 'running',
    mode: 'chat',
    model,
    permissionConfig,
    rootAgentId: `agent-${id}`,
    mergedInputIDs: [],
    startedAt: 10,
    finishedAt: null,
    elapsedSeconds: 0,
    error: null,
  }
}

function input(id: string, turnId: string, createdAt: number): Input {
  return {
    id,
    threadId: thread.id,
    turnId,
    content: id,
    delivery: 'follow-up',
    mode: 'chat',
    model,
    permissionConfig,
    state: 'active',
    createdAt,
  }
}

function agent(id: string, turnId: string, runId: string | null = null): AgentExecution {
  return {
    id,
    threadId: thread.id,
    turnId,
    parentAgentId: null,
    profile: 'agent',
    task: 'task',
    model,
    sessionId: `session-${id}`,
    depth: 0,
    status: 'running',
    error: null,
    subagentRunId: runId,
    runSequence: 0,
    createdAt: 10,
    updatedAt: 10,
  }
}

function textItem(
  id: string,
  turnId: string,
  text: string,
  status: 'streaming' | 'completed' = 'streaming',
): Extract<Item, { type: 'text' }> {
  return {
    id,
    messageID: `message-${id}`,
    turnId,
    agentId: `agent-${turnId}`,
    type: 'text',
    placement: 'result',
    text,
    status,
    createdAt: 20,
  }
}

function page(turns: ThreadHistoryPageLike['turns'], sequence = 10): ThreadHistoryPageLike {
  return {
    thread,
    subagents: [],
    turns,
    olderCursor: 'older',
    hasOlder: true,
    streamPosition: { streamId: 'stream-1', sequence },
  }
}

function durable<T extends DurableEventType>(
  sequence: number,
  type: T,
  payload: EventPayload<T>,
): DurableEventEnvelope<T> {
  return {
    eventId: `event-${sequence}-${type}`,
    streamId: 'stream-1',
    type,
    version: 1,
    threadId: thread.id,
    occurredAt: sequence,
    durability: 'durable',
    sequence,
    payload,
  }
}

function live<T extends LiveEventType>(
  eventId: string,
  type: T,
  payload: EventPayload<T>,
  afterSequence = 10,
): LiveEventEnvelope<T> {
  return {
    eventId,
    streamId: 'stream-1',
    type,
    version: 1,
    threadId: thread.id,
    occurredAt: afterSequence,
    durability: 'live',
    sequence: null,
    afterSequence,
    payload,
  }
}

describe('canonical thread state', () => {
  test.each([false, true])(
    'keeps a question group intact through replay, snapshot and resolution (skip: %s)',
    (skip) => {
      const activeTurn = turn('group-turn')
      const rootAgent = agent('group-agent', activeTurn.id)
      const bundle = {
        turn: activeTurn,
        inputs: [],
        messages: [],
        agents: [rootAgent],
        items: [],
        approvals: [],
      }
      const questions = ['scope', 'format', 'selection'].map((id) => ({
        id,
        header: id,
        prompt: `Choose ${id}`,
        choices: ['a', 'b'].map((choice) => ({
          id: choice,
          label: choice,
          description: choice,
          recommended: choice === 'a',
        })),
        allowFreeform: true as const,
        required: true as const,
      }))
      const requested = applyThreadEnvelope(
        createCanonicalThreadState(page([bundle])),
        durable(11, 'question/requested', {
          interactionId: 'group',
          threadId: thread.id,
          turnId: activeTurn.id,
          agentId: rootAgent.id,
          createdAt: 10,
          version: 2,
          kind: 'question',
          questions,
          toolCallId: 'call-group',
        }),
      )
      const item = requested.itemsById.get('group')!
      expect([...requested.itemsById.keys()]).toEqual(['group'])
      expect(item).toMatchObject({ questions, toolCallId: 'call-group', status: 'pending' })
      const restored = createCanonicalThreadState(page([{ ...bundle, items: [item] }]))
      expect(restored.itemsById.get('group')).toEqual(item)
      const answers = questions.map((question, index) =>
        skip && index === 0
          ? { questionId: question.id, choiceIds: [], skipped: true as const }
          : { questionId: question.id, choiceIds: ['b'] },
      )
      const resolved = applyThreadEnvelope(
        requested,
        durable(12, 'interaction/resolved', {
          interactionId: 'group',
          result: { kind: 'question', status: 'answered', resolution: 'user', answers },
          resolvedAt: 12,
        }),
      )
      expect(resolved.itemsById.get('group')).toMatchObject({
        status: 'answered',
        answers,
        answer: skip ? '' : 'b',
      })
      expect(
        createCanonicalThreadState(
          page([{ ...bundle, items: [resolved.itemsById.get('group')!] }]),
        ).itemsById.get('group'),
      ).toEqual(resolved.itemsById.get('group'))
      const ignored = applyThreadEnvelope(
        requested,
        durable(12, 'interaction/resolved', {
          interactionId: 'group',
          result: { kind: 'question', status: 'ignored' },
          resolvedAt: 12,
        }),
      )
      expect(ignored.itemsById.get('group')).toMatchObject({ status: 'ignored' })
      const cancelled = applyThreadEnvelope(
        requested,
        durable(12, 'turn/interrupted', { turn: { ...activeTurn, status: 'interrupted' } }),
      )
      expect(cancelled.itemsById.get('group')).toMatchObject({ status: 'cancelled' })
    },
  )
  test('projects local context references onto only their owning input', () => {
    const currentTurn = turn('turn-context')
    const currentInput = {
      ...input('input-context', currentTurn.id, 20),
      contextReferenceIds: ['context-docs'],
    }
    const state = createCanonicalThreadState(
      page([
        {
          turn: currentTurn,
          inputs: [currentInput],
          messages: [],
          agents: [],
          items: [],
          approvals: [],
          contextReferences: [
            {
              id: 'context-docs',
              name: 'docs',
              path: 'C:\\outside\\docs',
              kind: 'directory',
              status: 'available',
              createdAt: 20,
            },
          ],
        },
      ]),
    )

    expect(selectVisibleTurnEntries(state)[0]?.contextReferences).toEqual([
      {
        id: 'context-docs',
        name: 'docs',
        path: 'C:\\outside\\docs',
        kind: 'directory',
        status: 'available',
        createdAt: 20,
      },
    ])
  })

  test('hydrates latest page and prepends older turns without duplicates or cursor rollback', () => {
    const newer = turn('turn-2')
    const state = createCanonicalThreadState(
      page(
        [
          {
            turn: newer,
            inputs: [input('input-turn-2', newer.id, 20)],
            messages: [],
            agents: [agent('agent-turn-2', newer.id)],
            items: [],
            approvals: [],
          },
        ],
        10,
      ),
    )

    const older = turn('turn-1')
    const next = prependOlderThreadPage(state, {
      ...page(
        [
          {
            turn: older,
            inputs: [input('input-turn-1', older.id, 10)],
            messages: [],
            agents: [],
            items: [],
            approvals: [],
          },
          { turn: newer, inputs: [], messages: [], agents: [], items: [], approvals: [] },
        ],
        4,
      ),
      olderCursor: null,
      hasOlder: false,
    })

    expect(next.turnOrder).toEqual(['turn-1', 'turn-2'])
    expect(next.history).toMatchObject({ olderCursor: null, hasOlder: false })
    expect(next.stream.appliedSequence).toBe(10)
    expect(state.turnOrder).toEqual(['turn-2'])
  })

  test('does not advance the live cursor from an older page read fence', () => {
    const activeTurn = turn('turn-active')
    const streaming = textItem('item-active', activeTurn.id, 'streaming')
    const state = createCanonicalThreadState(
      page(
        [
          {
            turn: activeTurn,
            inputs: [],
            messages: [],
            agents: [agent('agent-active', activeTurn.id)],
            items: [streaming],
            approvals: [],
          },
        ],
        10,
      ),
    )
    const olderTurn = turn('turn-older')
    const withHistory = prependOlderThreadPage(state, {
      ...page(
        [
          {
            turn: olderTurn,
            inputs: [],
            messages: [],
            agents: [],
            items: [],
            approvals: [],
          },
        ],
        12,
      ),
      olderCursor: null,
      hasOlder: false,
    })

    expect(withHistory.stream.appliedSequence).toBe(10)
    const completed = applyThreadEnvelope(
      withHistory,
      durable(11, 'item/completed', {
        item: { ...streaming, text: 'completed', status: 'completed' },
      }),
    )
    expect(completed.stream.appliedSequence).toBe(11)
    expect(completed.itemsById.get(streaming.id)).toMatchObject({
      text: 'completed',
      status: 'completed',
    })
  })

  test('appends live deltas once and reconciles them with the durable terminal item', () => {
    const activeTurn = turn('turn-1')
    const streaming = textItem('item-1', activeTurn.id, 'Hello')
    const state = createCanonicalThreadState(
      page([
        {
          turn: activeTurn,
          inputs: [],
          messages: [],
          agents: [agent('agent-turn-1', activeTurn.id)],
          items: [streaming],
          approvals: [],
        },
      ]),
    )
    const delta = live('live-1', 'item/agentMessage/delta', {
      itemId: streaming.id,
      turnId: activeTurn.id,
      agentId: streaming.agentId,
      delta: ' world',
    })

    const appended = applyThreadEnvelope(state, delta)
    expect((appended.itemsById.get(streaming.id) as typeof streaming).text).toBe('Hello world')
    expect(applyThreadEnvelope(appended, delta)).toBe(appended)

    const terminal = textItem(streaming.id, activeTurn.id, 'Hello world!', 'completed')
    const completed = applyThreadEnvelope(
      appended,
      durable(11, 'item/completed', { item: terminal }),
    )
    expect(completed.itemsById.get(streaming.id)).toEqual(terminal)

    const stale = live(
      'live-stale',
      'item/agentMessage/delta',
      {
        itemId: streaming.id,
        turnId: activeTurn.id,
        agentId: streaming.agentId,
        delta: ' stale',
      },
      10,
    )
    expect(applyThreadEnvelope(completed, stale)).toBe(completed)

    const sameAnchor = live(
      'live-same-anchor',
      'item/agentMessage/delta',
      {
        itemId: streaming.id,
        turnId: activeTurn.id,
        agentId: streaming.agentId,
        delta: ' duplicate',
      },
      11,
    )
    const protectedTerminal = applyThreadEnvelope(completed, sameAnchor)
    expect(protectedTerminal.itemsById.get(streaming.id)).toEqual(terminal)
  })

  test('applies an ordered envelope batch equivalently to individual updates', () => {
    const activeTurn = turn('turn-batch')
    const streaming = textItem('item-batch', activeTurn.id, '')
    const state = createCanonicalThreadState(
      page([
        {
          turn: activeTurn,
          inputs: [],
          messages: [],
          agents: [agent('agent-turn-batch', activeTurn.id)],
          items: [streaming],
          approvals: [],
        },
      ]),
    )
    const envelopes = [
      live('batch-live-1', 'item/agentMessage/delta', {
        itemId: streaming.id,
        turnId: activeTurn.id,
        agentId: streaming.agentId,
        delta: '第一段',
      }),
      live('batch-live-2', 'item/agentMessage/delta', {
        itemId: streaming.id,
        turnId: activeTurn.id,
        agentId: streaming.agentId,
        delta: '第二段',
      }),
      durable(11, 'item/completed', {
        item: textItem(streaming.id, activeTurn.id, '第一段第二段', 'completed'),
      }),
    ]

    const batched = applyThreadEnvelopes(state, envelopes)
    const individual = envelopes.reduce(applyThreadEnvelope, state)

    expect(batched).toEqual(individual)
    expect(batched.itemsById.get(streaming.id)).toMatchObject({
      text: '第一段第二段',
      status: 'completed',
    })
    expect(batched.stream.appliedEventIds).toEqual(new Set(['batch-live-1', 'batch-live-2']))
  })

  test('preserves live order and idempotency while protecting terminal items in a batch', () => {
    const activeTurn = turn('turn-batch-terminal')
    const streaming = textItem('item-batch-terminal', activeTurn.id, '')
    const state = createCanonicalThreadState(
      page([
        {
          turn: activeTurn,
          inputs: [],
          messages: [],
          agents: [agent('agent-turn-batch-terminal', activeTurn.id)],
          items: [streaming],
          approvals: [],
        },
      ]),
    )
    const first = live('batch-duplicate', 'item/agentMessage/delta', {
      itemId: streaming.id,
      turnId: activeTurn.id,
      agentId: streaming.agentId,
      delta: 'A',
    })
    const terminal = textItem(streaming.id, activeTurn.id, 'AB!', 'completed')
    const batched = applyThreadEnvelopes(state, [
      first,
      first,
      live('batch-second', 'item/agentMessage/delta', {
        itemId: streaming.id,
        turnId: activeTurn.id,
        agentId: streaming.agentId,
        delta: 'B',
      }),
      durable(11, 'item/completed', { item: terminal }),
      live(
        'batch-stale',
        'item/agentMessage/delta',
        {
          itemId: streaming.id,
          turnId: activeTurn.id,
          agentId: streaming.agentId,
          delta: ' stale',
        },
        10,
      ),
      live(
        'batch-terminal',
        'item/agentMessage/delta',
        {
          itemId: streaming.id,
          turnId: activeTurn.id,
          agentId: streaming.agentId,
          delta: ' ignored',
        },
        11,
      ),
    ])

    expect(batched.itemsById.get(streaming.id)).toEqual(terminal)
    expect(batched.stream.appliedSequence).toBe(11)
    expect(batched.stream.appliedEventIds).toEqual(
      new Set(['batch-duplicate', 'batch-second', 'batch-terminal']),
    )
  })

  test('bounds recent live event ids and does not retain durable event ids', () => {
    const state = createCanonicalThreadState(page([]))
    const envelopes: ThreadEventEnvelopeLike[] = [
      durable(11, 'thread/updated', { thread: { ...thread, updatedAt: 11 } }),
    ]
    for (let index = 0; index < 5_000; index += 1) {
      envelopes.push(live(`bounded-live-${index}`, 'reasoning/summaryPartAdded', {}, 11))
    }

    const next = applyThreadEnvelopes(state, envelopes)

    expect(next.stream.appliedEventIds.size).toBe(2_048)
    expect(next.stream.appliedEventIds.has(envelopes[0]!.eventId)).toBe(false)
    expect(next.stream.appliedEventIds.has('bounded-live-0')).toBe(false)
    expect(next.stream.appliedEventIds.has('bounded-live-2951')).toBe(false)
    expect(next.stream.appliedEventIds.has('bounded-live-2952')).toBe(true)
    expect(next.stream.appliedEventIds.has('bounded-live-4999')).toBe(true)
  })

  test('projects final plans as content and upserts execution plan snapshots by item id', () => {
    const activeTurn = turn('turn-plan')
    const finalPlan: Extract<Item, { type: 'plan' }> = {
      id: 'plan-1',
      messageID: 'message-plan',
      turnId: activeTurn.id,
      agentId: 'agent-turn-plan',
      type: 'plan',
      title: '实施计划',
      markdown: '第一步',
      status: 'streaming',
      createdAt: 20,
    }
    const state = createCanonicalThreadState(
      page([
        {
          turn: activeTurn,
          inputs: [],
          messages: [],
          agents: [agent('agent-turn-plan', activeTurn.id)],
          items: [finalPlan],
          approvals: [],
        },
      ]),
    )

    const streamed = applyThreadEnvelope(
      state,
      live('plan-live', 'plan/delta', {
        itemId: finalPlan.id,
        turnId: activeTurn.id,
        agentId: finalPlan.agentId,
        delta: '，第二步',
      }),
    )
    expect(streamed.itemsById.get(finalPlan.id)).toMatchObject({
      markdown: '第一步，第二步',
      status: 'streaming',
    })

    const completedPlan = { ...finalPlan, markdown: '权威计划', status: 'completed' as const }
    const completed = applyThreadEnvelope(
      streamed,
      durable(11, 'item/completed', { item: completedPlan }),
    )
    expect(completed.itemsById.get(finalPlan.id)).toEqual(completedPlan)
    expect(selectRenderTurnEntries(completed)[0]?.blockers).toEqual([])

    const executionPlan: Extract<Item, { type: 'execution-plan' }> = {
      id: `${activeTurn.id}:execution-plan`,
      messageID: 'message-plan',
      turnId: activeTurn.id,
      agentId: finalPlan.agentId,
      type: 'execution-plan',
      explanation: '开始执行',
      steps: [{ step: '实现契约', status: 'in_progress' }],
      status: 'streaming',
      createdAt: 21,
    }
    const firstUpdate = applyThreadEnvelope(
      completed,
      durable(12, 'turn/plan/updated', { item: executionPlan }),
    )
    const secondUpdate = applyThreadEnvelope(
      firstUpdate,
      durable(13, 'turn/plan/updated', {
        item: {
          ...executionPlan,
          explanation: '契约已完成',
          steps: [{ step: '实现契约', status: 'completed' }],
        },
      }),
    )
    const rendered = selectRenderTurnEntries(secondUpdate)[0]

    expect(
      [...secondUpdate.itemsById.values()].filter((item) => item.type === 'execution-plan'),
    ).toHaveLength(1)
    expect(secondUpdate.itemsById.get(executionPlan.id)).toMatchObject({
      explanation: '契约已完成',
      steps: [{ step: '实现契约', status: 'completed' }],
    })
    expect(rendered?.executionPlanItems.map((item) => item.id)).toEqual([executionPlan.id])
    expect(rendered?.contentBlocks.map((block) => block.kind)).toEqual(['plan', 'execution-plan'])
  })

  test('upserts a missing turn from turn/started and ignores replayed durable sequences', () => {
    const state = createCanonicalThreadState(page([]))
    const startedTurn = turn('turn-new')
    const startedInput = input('input-new', startedTurn.id, 1)
    const envelope = durable(11, 'turn/started', { turn: startedTurn, input: startedInput })
    const next = applyThreadEnvelope(state, envelope)

    expect(next.turnOrder).toEqual([startedTurn.id])
    expect(next.turnsById.get(startedTurn.id)).toEqual(startedTurn)
    expect(next.inputsById.get(startedInput.id)).toEqual(startedInput)
    expect(applyThreadEnvelope(next, { ...envelope, eventId: 'different-id' })).toBe(next)
  })

  test('projects affected approval paths from the safe scope', () => {
    const activeTurn = turn('turn-approval')
    const rootAgent = agent('agent-approval', activeTurn.id)
    const bundle = {
      turn: activeTurn,
      inputs: [input('input-approval', activeTurn.id, 1)],
      messages: [],
      agents: [rootAgent],
      items: [],
      approvals: [],
    }
    const payload = {
      computerApp: { name: '记事本', allowPersistentApproval: false },
      interactionId: 'approval-scoped',
      threadId: thread.id,
      turnId: activeTurn.id,
      agentId: rootAgent.id,
      toolCallId: 'tool-scoped',
      tool: 'apply_patch',
      risk: 'high' as const,
      reason: '需要确认',
      affectedPaths: [
        { path: 'src/a.ts', operation: 'update' as const },
        { path: 'src/b.ts', operation: 'create' as const },
      ],
      reviewSummary: {
        fileCount: 2,
        hunkCount: 2,
        additions: 4,
        deletions: 1,
      },
      requestedPermissions: { writePaths: ['legacy-only.ts'] },
      createdAt: 20,
    }
    const state = createCanonicalThreadState(page([bundle]))
    const projected = applyThreadEnvelope(state, durable(11, 'approval/requested', payload))
    expect(projected.approvalsById.get(payload.interactionId)).toMatchObject({
      paths: ['src/a.ts', 'src/b.ts'],
      affectedPaths: payload.affectedPaths,
      reviewSummary: payload.reviewSummary,
      computerApp: payload.computerApp,
    })
  })

  test('projects dynamic permission requests and closes them via interaction/resolved', () => {
    const activeTurn = turn('turn-permission')
    const rootAgent = agent('agent-permission', activeTurn.id)
    const bundle = {
      turn: activeTurn,
      inputs: [input('input-permission', activeTurn.id, 1)],
      messages: [],
      agents: [rootAgent],
      items: [],
      approvals: [],
    }
    const payload = {
      interactionId: 'permission-1',
      threadId: thread.id,
      turnId: activeTurn.id,
      agentId: rootAgent.id,
      toolCallId: 'tool-permission',
      tool: 'request_permissions',
      reason: '需要读取文档并写入产物',
      requestedPermissions: {
        readPaths: ['C:\\workspace\\docs'],
        writePaths: ['C:\\workspace\\out'],
        networkDomains: ['api.example.com'],
      },
      requestedScope: 'turn' as const,
      allowedScopes: ['tool-call', 'turn'] as const,
      risk: 'high' as const,
      createdAt: 30,
    }
    const state = createCanonicalThreadState(page([bundle]))
    const projected = applyThreadEnvelope(state, durable(11, 'permission/requested', payload))
    expect(projected.approvalsById.get(payload.interactionId)).toMatchObject({
      paths: ['C:\\workspace\\docs', 'C:\\workspace\\out', 'api.example.com'],
      risk: 'high',
      status: 'pending',
      permissionGrant: {
        requestedScope: 'turn',
        allowedScopes: ['tool-call', 'turn'],
      },
    })

    const granted = applyThreadEnvelope(
      projected,
      durable(12, 'interaction/resolved', {
        interactionId: 'permission-1',
        result: {
          kind: 'permission',
          decision: 'grant',
          scope: 'turn',
          grantedPermissions: { readPaths: ['C:\\workspace\\docs'] },
        },
        resolvedAt: 40,
      }),
    )
    expect(granted.approvalsById.get('permission-1')?.status).toBe('allowed')

    const denied = applyThreadEnvelope(
      projected,
      durable(12, 'interaction/resolved', {
        interactionId: 'permission-1',
        result: { kind: 'permission', decision: 'deny' },
        resolvedAt: 40,
      }),
    )
    expect(denied.approvalsById.get('permission-1')?.status).toBe('denied')

    // Historical resolved events without an interactionId must not guess which
    // request to close; the snapshot reconciliation remains the source of truth.
    const unresolved = applyThreadEnvelope(
      projected,
      durable(12, 'interaction/resolved', {
        result: {
          kind: 'permission',
          decision: 'grant',
          scope: 'tool-call',
          grantedPermissions: {},
        },
        resolvedAt: 40,
      }),
    )
    expect(unresolved.approvalsById.get('permission-1')?.status).toBe('pending')
  })

  test('projects and resolves typed hook trust interactions', () => {
    const state = createCanonicalThreadState(page([]))
    const requested = applyThreadEnvelope(
      state,
      durable(11, 'hook/trust/requested', {
        interactionId: 'hook-trust-1',
        threadId: thread.id,
        turnId: 'turn-hook',
        agentId: 'agent-hook',
        createdAt: 30,
        version: 1,
        kind: 'hookTrust',
        configPath: '.pidex/hooks.json',
        sha256: 'fixture-sha256',
        hook: {
          id: 'hook-1',
          name: 'Pre tool hook',
          event: 'pre-tool',
          command: 'fixture-command',
        },
      }),
    )

    expect(requested.hookTrustsById.get('hook-trust-1')).toMatchObject({
      kind: 'hookTrust',
      configPath: '.pidex/hooks.json',
    })
    const resolved = applyThreadEnvelope(
      requested,
      durable(12, 'interaction/resolved', {
        interactionId: 'hook-trust-1',
        result: { kind: 'hookTrust', decision: 'allow' },
        resolvedAt: 40,
      }),
    )
    expect(resolved.hookTrustsById.size).toBe(0)
  })

  test('closes ordinary approvals via interaction/resolved and keeps questions untouched', () => {
    const activeTurn = turn('turn-approval-resolved')
    const rootAgent = agent('agent-approval-resolved', activeTurn.id)
    const bundle = {
      turn: activeTurn,
      inputs: [input('input-approval-resolved', activeTurn.id, 1)],
      messages: [],
      agents: [rootAgent],
      items: [],
      approvals: [],
    }
    const approvalPayload = {
      interactionId: 'approval-close',
      threadId: thread.id,
      turnId: activeTurn.id,
      agentId: rootAgent.id,
      toolCallId: 'tool-close',
      tool: 'PowerShell',
      risk: 'medium' as const,
      reason: '需要运行命令',
      requestedPermissions: {},
      allowedChoices: ['allow-once', 'deny', 'stop'] as const,
      createdAt: 30,
    }
    const state = createCanonicalThreadState(page([bundle]))
    const projected = applyThreadEnvelope(state, durable(11, 'approval/requested', approvalPayload))
    expect(projected.approvalsById.get('approval-close')?.status).toBe('pending')

    const allowed = applyThreadEnvelope(
      projected,
      durable(12, 'interaction/resolved', {
        interactionId: 'approval-close',
        result: { kind: 'approval', decision: 'allow-once' },
        resolvedAt: 40,
      }),
    )
    expect(allowed.approvalsById.get('approval-close')?.status).toBe('allowed')

    const stopped = applyThreadEnvelope(
      projected,
      durable(12, 'interaction/resolved', {
        interactionId: 'approval-close',
        result: { kind: 'approval', decision: 'stop' },
        resolvedAt: 40,
      }),
    )
    expect(stopped.approvalsById.get('approval-close')?.status).toBe('denied')

    // Question resolution must not touch approval state.
    const questionState = applyThreadEnvelope(
      projected,
      durable(12, 'interaction/resolved', {
        interactionId: 'approval-close',
        result: { kind: 'question', status: 'answered', resolution: 'user', answers: [] },
        resolvedAt: 40,
      }),
    )
    expect(questionState.approvalsById.get('approval-close')?.status).toBe('pending')
  })

  test('keeps only the final result text after process items as the assistant result', () => {
    const activeTurn = turn('turn-ordered')
    const rootAgent = agent('agent-ordered', activeTurn.id)
    const first = { ...textItem('text-1', activeTurn.id, '开始检查'), ordinal: 0, createdAt: 30 }
    const tool: Extract<Item, { type: 'tool' }> = {
      id: 'tool-1',
      messageID: activeTurn.id,
      turnId: activeTurn.id,
      agentId: rootAgent.id,
      type: 'tool',
      callID: 'tool-1',
      tool: 'Read',
      title: 'Read',
      state: 'completed',
      input: {},
      command: null,
      output: 'ok',
      error: null,
      startedAt: 10,
      finishedAt: 20,
      durationMs: 10,
      ordinal: 1,
      createdAt: 10,
    }
    const second = { ...textItem('text-2', activeTurn.id, '读取完成'), ordinal: 2, createdAt: 20 }
    const state = createCanonicalThreadState(
      page([
        {
          turn: activeTurn,
          inputs: [input('input-ordered', activeTurn.id, 1)],
          messages: [],
          agents: [rootAgent],
          items: [second, tool, first],
          approvals: [],
        },
      ]),
    )

    const [entry] = selectRenderTurnEntries(state)
    expect(entry?.items.map((item) => item.id)).toEqual(['text-1', 'tool-1', 'text-2'])
    expect(entry?.processItems.map((item) => item.id)).toEqual(['text-1', 'tool-1'])
    expect(entry?.assistantResultItems.map((item) => item.id)).toEqual(['text-2'])
    expect(entry?.contentBlocks.map((block) => block.kind)).toEqual(['process', 'assistant'])
    expect(
      entry?.contentBlocks.flatMap((block) =>
        block.kind === 'process' || block.kind === 'assistant'
          ? block.items.map((item) => item.id)
          : [],
      ),
    ).toEqual(['text-1', 'tool-1', 'text-2'])
  })

  test('does not invent an assistant result when legacy result text precedes the final process item', () => {
    const activeTurn = turn('turn-process-only')
    const rootAgent = agent('agent-process-only', activeTurn.id)
    const text = { ...textItem('text-before-tool', activeTurn.id, '开始检查'), ordinal: 0 }
    const tool: Extract<Item, { type: 'tool' }> = {
      id: 'tool-last',
      messageID: activeTurn.id,
      turnId: activeTurn.id,
      agentId: rootAgent.id,
      type: 'tool',
      callID: 'tool-last',
      tool: 'Read',
      title: 'Read',
      state: 'completed',
      input: {},
      command: null,
      output: 'ok',
      error: null,
      startedAt: 10,
      finishedAt: 20,
      durationMs: 10,
      ordinal: 1,
      createdAt: 21,
    }
    const state = createCanonicalThreadState(
      page([
        {
          turn: activeTurn,
          inputs: [input('input-process-only', activeTurn.id, 1)],
          messages: [],
          agents: [rootAgent],
          items: [text, tool],
          approvals: [],
        },
      ]),
    )

    const [entry] = selectRenderTurnEntries(state)
    expect(entry?.processItems.map((item) => item.id)).toEqual(['text-before-tool', 'tool-last'])
    expect(entry?.assistantResultItems).toEqual([])
    expect(entry?.contentBlocks.map((block) => block.kind)).toEqual(['process'])
  })

  test('always projects explicitly placed process text into the process slot', () => {
    const activeTurn = turn('turn-explicit-process')
    const rootAgent = agent('agent-explicit-process', activeTurn.id)
    const processText = {
      ...textItem('process-text', activeTurn.id, '正在检查'),
      placement: 'process' as const,
      ordinal: 0,
    }
    const resultText = {
      ...textItem('result-text', activeTurn.id, '检查完成', 'completed'),
      ordinal: 1,
    }
    const state = createCanonicalThreadState(
      page([
        {
          turn: activeTurn,
          inputs: [input('input-explicit-process', activeTurn.id, 1)],
          messages: [],
          agents: [rootAgent],
          items: [processText, resultText],
          approvals: [],
        },
      ]),
    )

    const [entry] = selectRenderTurnEntries(state)
    expect(entry?.processItems.map((item) => item.id)).toEqual(['process-text'])
    expect(entry?.assistantResultItems.map((item) => item.id)).toEqual(['result-text'])
    expect(entry?.contentBlocks.map((block) => block.kind)).toEqual(['process', 'assistant'])
  })

  test('projects context compaction after the assistant result with stable turn and agent anchors', () => {
    const explicitTurn = turn('turn-compaction-explicit')
    const latestTurn = turn('turn-compaction-latest')
    const explicitRoot = agent('agent-compaction-explicit-root', explicitTurn.id)
    const explicitLatestAgent = {
      ...agent('agent-compaction-explicit-latest', explicitTurn.id),
      createdAt: 11,
      updatedAt: 11,
    }
    const latestAgent = agent('agent-compaction-latest', latestTurn.id)
    const state = createCanonicalThreadState(
      page([
        {
          turn: explicitTurn,
          inputs: [input('input-compaction-explicit', explicitTurn.id, 1)],
          messages: [],
          agents: [explicitRoot, explicitLatestAgent],
          items: [
            {
              ...textItem('result-compaction-explicit', explicitTurn.id, '原有回答', 'completed'),
              agentId: explicitLatestAgent.id,
            },
          ],
          approvals: [],
        },
        {
          turn: latestTurn,
          inputs: [input('input-compaction-latest', latestTurn.id, 2)],
          messages: [],
          agents: [latestAgent],
          items: [textItem('result-compaction-latest', latestTurn.id, '最新回答', 'completed')],
          approvals: [],
        },
      ]),
    )

    const withExplicitAnchor = applyThreadEnvelope(state, {
      ...durable(11, 'context/compacted', {
        compactionId: 'compaction-explicit',
        trigger: 'manual',
        beforeCount: 10,
        afterCount: 4,
        beforeTokens: 1_000,
        afterTokens: 400,
        afterTokensSource: 'measured',
        targetTokens: 500,
        baselineVersion: 2,
        usageSampleId: 'usage-explicit',
      }),
      turnId: explicitTurn.id,
    })
    const explicitActivityId = 'activity:context-compression:compaction-explicit'
    expect(withExplicitAnchor.itemsById.get(explicitActivityId)).toMatchObject({
      turnId: explicitTurn.id,
      agentId: explicitLatestAgent.id,
      type: 'activity',
      activity: 'context-compression',
      status: 'completed',
    })
    const explicitEntry = selectRenderTurnEntries(withExplicitAnchor).find(
      (entry) => entry.id === explicitTurn.id,
    )
    expect(explicitEntry?.assistantResultItems.map((item) => item.id)).toEqual([
      'result-compaction-explicit',
    ])
    expect(explicitEntry?.postAssistantItems.map((item) => item.id)).toEqual([explicitActivityId])
    expect(explicitEntry?.contentBlocks.map((block) => block.kind)).toEqual(['assistant', 'post'])

    const withLatestFallback = applyThreadEnvelope(
      withExplicitAnchor,
      durable(12, 'context/compacted', {
        compactionId: 'compaction-latest',
        beforeCount: 4,
        afterCount: 2,
        beforeTokens: 400,
        afterTokens: 200,
        targetTokens: 250,
        baselineVersion: 3,
        usageSampleId: 'usage-latest',
      }),
    )
    expect(
      withLatestFallback.itemsById.get('activity:context-compression:compaction-latest'),
    ).toMatchObject({ turnId: latestTurn.id, agentId: latestAgent.id })
  })

  test('projects semantic slots and filters subagent scope by run id', () => {
    const activeTurn = turn('turn-1')
    const rootAgent = agent('agent-turn-1', activeTurn.id)
    const childAgent = agent('agent-child', activeTurn.id, 'run-1')
    const process: Extract<Item, { type: 'reasoning' }> = {
      id: 'reasoning-1',
      messageID: 'm-1',
      turnId: activeTurn.id,
      agentId: childAgent.id,
      type: 'reasoning',
      text: '思考',
      status: 'completed',
      createdAt: 21,
    }
    const result = {
      ...textItem('result-1', activeTurn.id, '完成', 'completed'),
      agentId: childAgent.id,
      createdAt: 21.5,
    }
    const patch: Extract<Item, { type: 'patch' }> = {
      id: 'patch-1',
      messageID: 'm-2',
      turnId: activeTurn.id,
      agentId: childAgent.id,
      type: 'patch',
      files: [],
      totalAdditions: 1,
      totalDeletions: 0,
      createdAt: 22,
    }
    const question: Extract<Item, { type: 'question' }> = {
      id: 'question-1',
      messageID: 'm-3',
      turnId: activeTurn.id,
      agentId: childAgent.id,
      type: 'question',
      prompt: '继续？',
      choices: [],
      status: 'pending',
      answer: null,
      createdAt: 23,
    }
    const approval: ApprovalRequest = {
      id: 'approval-1',
      threadId: thread.id,
      turnId: activeTurn.id,
      agentId: childAgent.id,
      toolCallID: 'tool-1',
      tool: 'shell',
      command: null,
      cwd: null,
      paths: [],
      requestedPermissions: {},
      review: null,
      risk: 'low',
      reason: '确认',
      status: 'pending',
      createdAt: 24,
    }
    const state = createCanonicalThreadState(
      page([
        {
          turn: activeTurn,
          inputs: [input('input-1', activeTurn.id, 1)],
          messages: [],
          agents: [rootAgent, childAgent],
          items: [process, result, patch, question, textItem('root-result', activeTurn.id, 'root')],
          approvals: [approval],
        },
      ]),
    )

    const visible = selectVisibleTurnEntries(state, { type: 'subagent', runId: 'run-1' })
    expect(visible).toHaveLength(1)
    expect(visible[0]?.items.map((item) => item.id)).toEqual([
      'reasoning-1',
      'result-1',
      'patch-1',
      'question-1',
    ])

    const [rendered] = selectRenderTurnEntries(state, { type: 'subagent', runId: 'run-1' })
    expect(rendered?.processItems.map((item) => item.id)).toEqual(['reasoning-1'])
    expect(rendered?.assistantResultItems.map((item) => item.id)).toEqual(['result-1'])
    expect(rendered?.patchItems.map((item) => item.id)).toEqual(['patch-1'])
    expect(rendered?.blockers.map((blocker) => blocker.kind)).toEqual(['question', 'approval'])
  })

  test('filters side-chat scope after its inherited turn boundary', () => {
    const inheritedTurn = turn('turn-side-chat-inherited')
    const firstVisibleTurn = turn('turn-side-chat-visible-1')
    const secondVisibleTurn = turn('turn-side-chat-visible-2')
    const state = createCanonicalThreadState(
      page([
        {
          turn: inheritedTurn,
          inputs: [input('input-side-chat-inherited', inheritedTurn.id, 1)],
          messages: [],
          agents: [agent('agent-side-chat-inherited', inheritedTurn.id)],
          items: [textItem('item-side-chat-inherited', inheritedTurn.id, 'inherited')],
          approvals: [],
        },
        {
          turn: firstVisibleTurn,
          inputs: [input('input-side-chat-visible-1', firstVisibleTurn.id, 2)],
          messages: [],
          agents: [agent('agent-side-chat-visible-1', firstVisibleTurn.id)],
          items: [textItem('item-side-chat-visible-1', firstVisibleTurn.id, 'first')],
          approvals: [],
        },
        {
          turn: secondVisibleTurn,
          inputs: [input('input-side-chat-visible-2', secondVisibleTurn.id, 3)],
          messages: [],
          agents: [agent('agent-side-chat-visible-2', secondVisibleTurn.id)],
          items: [textItem('item-side-chat-visible-2', secondVisibleTurn.id, 'second')],
          approvals: [],
        },
      ]),
    )
    const selectEntries = createRenderTurnEntriesSelector()

    expect(
      selectVisibleTurnEntries(state, {
        type: 'side-chat',
        inheritedThroughTurnId: inheritedTurn.id,
      }).map((entry) => entry.id),
    ).toEqual([firstVisibleTurn.id, secondVisibleTurn.id])

    const afterInherited = selectEntries(state, {
      type: 'side-chat',
      inheritedThroughTurnId: inheritedTurn.id,
    })
    const afterFirstVisible = selectEntries(state, {
      type: 'side-chat',
      inheritedThroughTurnId: firstVisibleTurn.id,
    })
    expect(afterInherited.map((entry) => entry.id)).toEqual([
      firstVisibleTurn.id,
      secondVisibleTurn.id,
    ])
    expect(afterFirstVisible.map((entry) => entry.id)).toEqual([secondVisibleTurn.id])
    expect(afterFirstVisible).not.toBe(afterInherited)
  })

  test('shows every loaded turn when side-chat has no inherited boundary', () => {
    const firstTurn = turn('turn-side-chat-empty-1')
    const secondTurn = turn('turn-side-chat-empty-2')
    const state = createCanonicalThreadState(
      page([
        {
          turn: firstTurn,
          inputs: [],
          messages: [],
          agents: [agent('agent-side-chat-empty-1', firstTurn.id)],
          items: [],
          approvals: [],
        },
        {
          turn: secondTurn,
          inputs: [],
          messages: [],
          agents: [agent('agent-side-chat-empty-2', secondTurn.id)],
          items: [],
          approvals: [],
        },
      ]),
    )

    expect(
      selectVisibleTurnEntries(state, {
        type: 'side-chat',
        inheritedThroughTurnId: null,
      }).map((entry) => entry.id),
    ).toEqual([firstTurn.id, secondTurn.id])
  })

  test('keeps current side-chat turns visible until an older page supplies the inherited boundary', () => {
    const inheritedTurn = turn('turn-side-chat-paged-boundary')
    const currentTurn = turn('turn-side-chat-paged-current')
    const state = createCanonicalThreadState(
      page([
        {
          turn: currentTurn,
          inputs: [input('input-side-chat-paged-current', currentTurn.id, 3)],
          messages: [],
          agents: [agent('agent-side-chat-paged-current', currentTurn.id)],
          items: [],
          approvals: [],
        },
      ]),
    )
    const scope = {
      type: 'side-chat' as const,
      inheritedThroughTurnId: inheritedTurn.id,
    }

    expect(selectVisibleTurnEntries(state, scope).map((entry) => entry.id)).toEqual([
      currentTurn.id,
    ])

    const olderPrefixTurn = turn('turn-side-chat-paged-prefix')
    const withBoundary = prependOlderThreadPage(state, {
      ...page([
        {
          turn: olderPrefixTurn,
          inputs: [input('input-side-chat-paged-prefix', olderPrefixTurn.id, 1)],
          messages: [],
          agents: [],
          items: [],
          approvals: [],
        },
        {
          turn: inheritedTurn,
          inputs: [input('input-side-chat-paged-boundary', inheritedTurn.id, 2)],
          messages: [],
          agents: [],
          items: [],
          approvals: [],
        },
      ]),
      olderCursor: null,
      hasOlder: false,
    })

    expect(withBoundary.turnOrder).toEqual([olderPrefixTurn.id, inheritedTurn.id, currentTurn.id])
    expect(selectVisibleTurnEntries(withBoundary, scope).map((entry) => entry.id)).toEqual([
      currentTurn.id,
    ])
  })

  test('reuses unchanged render turn entries when one turn receives an update', () => {
    const firstTurn = turn('turn-selector-1')
    const secondTurn = turn('turn-selector-2')
    const firstItem = textItem('item-selector-1', firstTurn.id, 'first')
    const secondItem = textItem('item-selector-2', secondTurn.id, 'second')
    const state = createCanonicalThreadState(
      page([
        {
          turn: firstTurn,
          inputs: [input('input-selector-1', firstTurn.id, 1)],
          messages: [],
          agents: [agent('agent-turn-selector-1', firstTurn.id)],
          items: [firstItem],
          approvals: [],
        },
        {
          turn: secondTurn,
          inputs: [input('input-selector-2', secondTurn.id, 2)],
          messages: [],
          agents: [agent('agent-turn-selector-2', secondTurn.id)],
          items: [secondItem],
          approvals: [],
        },
      ]),
    )
    const selectEntries = createRenderTurnEntriesSelector()
    const initial = selectEntries(state)
    expect(selectEntries(state)).toBe(initial)

    const updated = applyThreadEnvelope(
      state,
      durable(11, 'item/completed', {
        item: { ...secondItem, text: 'second complete', status: 'completed' },
      }),
    )
    const next = selectEntries(updated)

    expect(next).not.toBe(initial)
    expect(next[0]).toBe(initial[0])
    expect(next[1]).not.toBe(initial[1])
    expect(next[1]?.assistantResultItems[0]?.text).toBe('second complete')
  })

  test('reconciles the latest page while preserving loaded older turns', () => {
    const latestTurn = turn('turn-reconcile-2')
    const initial = createCanonicalThreadState(
      page(
        [
          {
            turn: latestTurn,
            inputs: [input('input-reconcile-2', latestTurn.id, 2)],
            messages: [],
            agents: [agent('agent-turn-reconcile-2', latestTurn.id)],
            items: [textItem('item-reconcile-2', latestTurn.id, 'stale')],
            approvals: [],
          },
        ],
        10,
      ),
    )
    const olderTurn = turn('turn-reconcile-1')
    const cached = prependOlderThreadPage(initial, {
      ...page(
        [
          {
            turn: olderTurn,
            inputs: [input('input-reconcile-1', olderTurn.id, 1)],
            messages: [],
            agents: [agent('agent-turn-reconcile-1', olderTurn.id)],
            items: [textItem('item-reconcile-1', olderTurn.id, 'older', 'completed')],
            approvals: [],
          },
        ],
        5,
      ),
      olderCursor: null,
      hasOlder: false,
    })
    cached.stream.appliedEventIds.add('old-live-event')
    const refreshedTurn = { ...latestTurn, status: 'completed' as const }
    const reconciled = reconcileLatestThreadPage(
      cached,
      page(
        [
          {
            turn: refreshedTurn,
            inputs: [input('input-reconcile-2', refreshedTurn.id, 2)],
            messages: [],
            agents: [agent('agent-turn-reconcile-2', refreshedTurn.id)],
            items: [textItem('item-reconcile-2', refreshedTurn.id, 'fresh', 'completed')],
            approvals: [],
          },
        ],
        20,
      ),
    )

    expect(reconciled.turnOrder).toEqual([olderTurn.id, refreshedTurn.id])
    expect(reconciled.turnsById.get(olderTurn.id)).toBe(cached.turnsById.get(olderTurn.id))
    expect(reconciled.turnsById.get(refreshedTurn.id)).toBe(refreshedTurn)
    expect(reconciled.itemsById.get('item-reconcile-2')).toMatchObject({ text: 'fresh' })
    expect(reconciled.history).toMatchObject({ olderCursor: null, hasOlder: false })
    expect(reconciled.stream).toMatchObject({ streamId: 'stream-1', appliedSequence: 20 })
    expect(reconciled.stream.appliedEventIds.size).toBe(0)
  })

  test('drops cached history when the stream generation changes', () => {
    const cachedTurn = turn('turn-old-stream')
    const cached = createCanonicalThreadState(
      page([
        {
          turn: cachedTurn,
          inputs: [],
          messages: [],
          agents: [],
          items: [],
          approvals: [],
        },
      ]),
    )
    const freshTurn = turn('turn-new-stream')
    const reconciled = reconcileLatestThreadPage(cached, {
      ...page(
        [
          {
            turn: freshTurn,
            inputs: [],
            messages: [],
            agents: [],
            items: [],
            approvals: [],
          },
        ],
        1,
      ),
      streamPosition: { streamId: 'stream-2', sequence: 1 },
    })

    expect(reconciled.turnOrder).toEqual([freshTurn.id])
    expect(reconciled.turnsById.has(cachedTurn.id)).toBe(false)
  })
})

test('消息阶段优先选择主任务最终回答，后续活动控制展开且完成恢复默认', () => {
  const activeTurn = turn('turn-phases')
  const root = agent(activeTurn.rootAgentId, activeTurn.id)
  const child = { ...agent('child-phases', activeTurn.id, 'child-run'), parentAgentId: root.id }
  const commentary = {
    ...textItem('commentary', activeTurn.id, '检查中'),
    phase: 'commentary' as const,
    ordinal: 0,
  }
  const first = {
    ...textItem('first-final', activeTurn.id, '前一个结果'),
    phase: 'final_answer' as const,
    ordinal: 1,
  }
  const final = {
    ...textItem('final', activeTurn.id, '最终回答'),
    phase: 'final_answer' as const,
    ordinal: 2,
  }
  const childFinal = { ...final, id: 'child-final', agentId: child.id, ordinal: 3 }
  const tool: Extract<Item, { type: 'tool' }> = {
    id: 'after-final',
    messageID: 'tool-message',
    turnId: activeTurn.id,
    agentId: root.id,
    type: 'tool',
    callID: 'call',
    tool: 'Read',
    title: 'Read',
    state: 'completed',
    input: {},
    command: null,
    output: 'ok',
    error: null,
    startedAt: 1,
    finishedAt: 2,
    durationMs: 1,
    ordinal: 4,
    createdAt: 30,
  }
  const make = (items: Item[], status: Turn['status'] = 'running') =>
    createCanonicalThreadState(
      page([
        {
          turn: { ...activeTurn, status },
          inputs: [],
          messages: [],
          agents: [root, child],
          items,
          approvals: [],
        },
      ]),
    )
  const state = make([commentary, first, final, childFinal, tool])
  const [entry] = selectRenderTurnEntries(state)
  expect(entry!.assistantResultItems.map((item) => item.id)).toEqual(['final'])
  expect(entry!.processItems.map((item) => item.id)).toEqual([
    'commentary',
    'first-final',
    'child-final',
    'after-final',
  ])
  expect(entry!.forceExpandActivity).toBe(false)
  expect(
    selectRenderTurnEntries(state, { type: 'subagent', runId: 'child-run' })[0]!
      .assistantResultItems[0]!.id,
  ).toBe('child-final')
  expect(
    selectRenderTurnEntries(make([commentary, final, { ...tool, state: 'running' }]))[0]!
      .forceExpandActivity,
  ).toBe(true)
  expect(
    selectRenderTurnEntries(
      make([commentary, final, { ...commentary, id: 'new-work', ordinal: 5 }]),
    )[0]!.forceExpandActivity,
  ).toBe(true)
  expect(
    selectRenderTurnEntries(
      make([commentary, final, { ...commentary, id: 'new-work', ordinal: 5 }], 'completed'),
    )[0]!.forceExpandActivity,
  ).toBe(false)
  for (const status of ['interrupted', 'failed', 'cancelled', 'stopped'] as const)
    expect(selectRenderTurnEntries(make([commentary, final], status))[0]!.forceExpandActivity).toBe(
      true,
    )
  expect(selectRenderTurnEntries(make([commentary], 'completed'))[0]!.assistantResultItems).toEqual(
    [],
  )
  const partial = { ...final, id: 'partial', phase: 'partial_answer' as const }
  expect(selectRenderTurnEntries(make([commentary, partial]))[0]!.assistantResultItems).toEqual([])
  expect(
    selectRenderTurnEntries(make([commentary, partial], 'completed'))[0]!.assistantResultItems[0]!
      .id,
  ).toBe('partial')
})

test('流式阶段更新、持久重放和快照得到同一回答且不重复 delta', () => {
  const activeTurn = turn('turn-phase-replay')
  const root = agent(activeTurn.rootAgentId, activeTurn.id)
  const bundle = {
    turn: activeTurn,
    inputs: [],
    messages: [],
    agents: [root],
    items: [] as Item[],
    approvals: [],
  }
  const initial = createCanonicalThreadState(page([bundle], 0))
  const text = { ...textItem('phase-replay', activeTurn.id, ''), placement: 'process' as const }
  const started = durable(1, 'item/started', { item: text })
  const delta = live(
    'phase-delta',
    'item/agentMessage/delta',
    { itemId: text.id, turnId: activeTurn.id, agentId: root.id, itemType: 'text', delta: '回答' },
    1,
  )
  const phased = {
    ...text,
    phase: 'final_answer' as const,
    placement: 'result' as const,
    text: '回答',
  }
  const changed = durable(2, 'item/agentMessage/phaseChanged', { item: phased })
  const completed = { ...phased, status: 'completed' as const }
  const ended = durable(3, 'item/completed', { item: completed })
  const realtime = applyThreadEnvelopes(initial, [started, delta, changed])
  expect(selectRenderTurnEntries(realtime)[0]!.assistantResultItems[0]!.text).toBe('回答')
  const terminal = applyThreadEnvelopes(realtime, [ended])
  const replay = applyThreadEnvelopes(initial, [started, changed, ended])
  const snapshot = createCanonicalThreadState(page([{ ...bundle, items: [completed] }], 3))
  const result = (state: typeof initial) => selectRenderTurnEntries(state)[0]!.assistantResultItems
  expect(result(terminal)).toEqual(result(replay))
  expect(result(terminal)).toEqual(result(snapshot))
})
