import { describe, expect, test } from 'bun:test'
import type { DurableEventEnvelope, LiveEventEnvelope } from '@pidex/agent-protocol'
import type { Thread, Turn } from '@pidex/shared/thread'

import { CanonicalThreadIngestionCoordinator } from '../src/features/session/timeline/CanonicalThreadIngestionCoordinator.js'
import {
  createLiveItemTailStore,
  type LiveItemTailStore,
  type TailNotificationScheduler,
} from '../src/features/session/state/LiveItemTailStore.js'

const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const

const thread: Thread = {
  id: 'thread-stream',
  title: '流式测试会话',
  projectID: null,
  gitBranch: null,
  settings: { taskMode: 'chat', permissionConfig },
  createdAt: 1,
  updatedAt: 1,
}

const turn: Turn = {
  id: 'turn-stream',
  threadId: thread.id,
  sourceInputID: 'input-stream',
  status: 'running',
  mode: 'chat',
  model: { providerID: 'openai', id: 'gpt-test' },
  permissionConfig,
  rootAgentId: 'agent-stream',
  mergedInputIDs: [],
  startedAt: 1,
  finishedAt: null,
  elapsedSeconds: 0,
  error: null,
}

function historyPage() {
  return {
    thread,
    subagents: [],
    turns: [
      {
        turn,
        inputs: [],
        messages: [],
        agents: [],
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

function textDelta(
  itemId: string,
  delta: string,
  index: number,
): LiveEventEnvelope<'item/agentMessage/delta'> {
  return {
    eventId: `${itemId}-delta-${index}`,
    streamId: thread.id,
    type: 'item/agentMessage/delta',
    version: 1,
    occurredAt: 10 + index,
    threadId: thread.id,
    turnId: turn.id,
    durability: 'live',
    sequence: null,
    afterSequence: 0,
    payload: { itemId, turnId: turn.id, agentId: 'agent-stream', delta },
  }
}

function completedItem(sequence: number): DurableEventEnvelope<'item/completed'> {
  return {
    eventId: `completed-${sequence}`,
    streamId: thread.id,
    type: 'item/completed',
    version: 1,
    occurredAt: 100 + sequence,
    threadId: thread.id,
    turnId: turn.id,
    durability: 'durable',
    sequence,
    payload: {
      item: {
        id: 'message-1',
        messageID: 'message-1',
        turnId: turn.id,
        agentId: 'agent-stream',
        type: 'text',
        placement: 'result',
        text: '最终文本',
        status: 'completed',
        createdAt: 100,
      },
    },
  }
}

/**
 * 手动 checkpoint 调度器：测试显式决定何时提交，避免依赖 rAF 或定时器。
 */
function createManualScheduler() {
  const pending: Array<() => void> = []
  const scheduler = (flush: () => void): (() => void) => {
    pending.push(flush)
    return () => {
      const index = pending.indexOf(flush)
      if (index >= 0) pending.splice(index, 1)
    }
  }
  return {
    scheduler,
    runCheckpoint(): void {
      const flush = pending.shift()
      flush?.()
    },
    pendingCount: (): number => pending.length,
  }
}

function createHarness() {
  const manual = createManualScheduler()
  const tailStore = createLiveItemTailStore()
  const commitCount = { value: 0 }
  const coordinator = new CanonicalThreadIngestionCoordinator({
    threadId: thread.id,
    checkpointScheduler: manual.scheduler,
    tailStore,
    onCommit: () => {
      commitCount.value += 1
    },
  })
  coordinator.rehydrate(historyPage())
  commitCount.value = 0
  return { coordinator, manual, tailStore, commitCount }
}

/**
 * 模拟"按帧 + 兜底定时器"双句柄调度：一次提交必须取消同一轮里另一个句柄，
 * 否则被漏掉的定时器会在稍后补一次提交。
 */
function createTwoHandleScheduler() {
  const pending: Array<() => void> = []
  const record = { cancelCount: 0, commitCount: 0 }
  const scheduler = (flush: () => void): (() => void) => {
    let cancelled = false
    const frame = (): void => {
      if (!cancelled) {
        record.commitCount += 1
        flush()
      }
    }
    const timer = (): void => {
      if (!cancelled) {
        record.commitCount += 1
        flush()
      }
    }
    pending.push(frame, timer)
    return () => {
      cancelled = true
      record.cancelCount += 1
      for (const handle of [frame, timer]) {
        const index = pending.indexOf(handle)
        if (index >= 0) pending.splice(index, 1)
      }
    }
  }
  return {
    scheduler,
    record,
    runFrame: (): void => {
      pending.shift()?.()
    },
    pendingCount: (): number => pending.length,
  }
}

describe('canonical streaming checkpoints', () => {
  test('一次 checkpoint 取消同轮另一个句柄，不会补出额外提交', () => {
    const dual = createTwoHandleScheduler()
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: thread.id,
      checkpointScheduler: dual.scheduler,
      tailStore: createLiveItemTailStore(),
    })
    coordinator.rehydrate(historyPage())
    void coordinator.deliverBatch([textDelta('message-1', 'A', 0)])
    expect(dual.pendingCount()).toBe(2)

    dual.runFrame()

    // 兜底定时器句柄必须被取消，否则它稍后会再提交一次。
    expect(dual.record.cancelCount).toBe(1)
    expect(dual.record.commitCount).toBe(1)
    expect(dual.pendingCount()).toBe(0)
  })

  test('live delta 在 checkpoint 前不提交，deliverBatch 在提交后才 resolve', async () => {
    const { coordinator, manual, tailStore, commitCount } = createHarness()
    let settled = false
    const delivered = coordinator.deliverBatch([textDelta('message-1', '你', 0)]).then(() => {
      settled = true
    })
    await Promise.resolve()

    // 提交前：投影为空、尾部已可见、调用方仍未被放行（ack 不能先于提交）。
    expect(commitCount.value).toBe(0)
    expect(coordinator.getSnapshot()?.itemsById.size).toBe(0)
    expect(tailStore.read(thread.id, 'message-1')).toBe('你')
    expect(settled).toBe(false)
    expect(manual.pendingCount()).toBe(1)

    manual.runCheckpoint()
    await delivered

    expect(settled).toBe(true)
    expect(commitCount.value).toBe(1)
    expect(coordinator.getSnapshot()?.itemsById.get('message-1')).toMatchObject({
      text: '你',
      status: 'streaming',
    })
    // 提交之后尾部清空，避免同一段文本在投影与缓冲里各存一份。
    expect(tailStore.read(thread.id, 'message-1')).toBe('')
  })

  test('durable 事件立即提交，不等帧 checkpoint', async () => {
    const { coordinator, manual, commitCount } = createHarness()
    await coordinator.deliverBatch([completedItem(1)])

    expect(manual.pendingCount()).toBe(0)
    expect(commitCount.value).toBe(1)
    expect(coordinator.getSnapshot()?.itemsById.get('message-1')).toMatchObject({
      text: '最终文本',
      status: 'completed',
    })
  })

  test('同一 checkpoint 合并多个 live 批次为一次提交', async () => {
    const { coordinator, manual, commitCount } = createHarness()
    const first = coordinator.deliverBatch([textDelta('message-1', 'A', 0)])
    const second = coordinator.deliverBatch([textDelta('message-1', 'B', 1)])
    expect(manual.pendingCount()).toBe(1)

    manual.runCheckpoint()
    await first
    await second

    expect(commitCount.value).toBe(1)
    expect(coordinator.getSnapshot()?.itemsById.get('message-1')?.text).toBe('AB')
  })

  test('入队达到事件上限时立即提交，积压不会无界增长', async () => {
    const { coordinator, manual, commitCount } = createHarness()
    const events = Array.from({ length: 512 }, (_, index) => textDelta('message-1', 'x', index))
    await coordinator.deliverBatch(events)

    expect(manual.pendingCount()).toBe(0)
    expect(commitCount.value).toBe(1)
    const item = coordinator.getSnapshot()?.itemsById.get('message-1')
    expect(item?.type === 'text' ? item.text.length : 0).toBe(512)
  })

  test('rehydrate 前先提交已入队 delta，保持先 delta 后历史的顺序', () => {
    const manual = createManualScheduler()
    const tailStore = createLiveItemTailStore()
    const committedTexts: Array<string | undefined> = []
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: thread.id,
      checkpointScheduler: manual.scheduler,
      tailStore,
      onCommit: (state) => {
        committedTexts.push(
          state.itemsById.get('message-1')?.type === 'text'
            ? state.itemsById.get('message-1')?.text
            : undefined,
        )
      },
    })
    coordinator.rehydrate(historyPage())
    committedTexts.length = 0
    void coordinator.deliverBatch([textDelta('message-1', '未提交', 0)])

    const page = historyPage()
    page.streamPosition = { streamId: thread.id, sequence: 5 }
    coordinator.rehydrate(page)

    expect(manual.pendingCount()).toBe(0)
    expect(tailStore.read(thread.id, 'message-1')).toBe('')
    // 先提交 delta、再应用历史页：历史页是新的 fence，因此最终由页面接管。
    expect(committedTexts[0]).toBe('未提交')
    expect(coordinator.getSnapshot()?.itemsById.get('message-1')).toBeUndefined()
  })

  test('dispose 提交未决批次，不遗留悬空 promise', async () => {
    const { coordinator, manual, commitCount } = createHarness()
    let settled = false
    const delivered = coordinator.deliverBatch([textDelta('message-1', '尾', 0)]).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    coordinator.dispose()
    await delivered

    expect(settled).toBe(true)
    expect(manual.pendingCount()).toBe(0)
    expect(commitCount.value).toBe(1)
  })

  test('投影会拒绝的 delta 不进入尾部缓冲', async () => {
    const { coordinator, tailStore } = createHarness()
    await coordinator.deliverBatch([completedItem(1)])
    // 已完成的 item 不再接受 delta；尾部不得显示投影会丢弃的文本。
    const delivered = coordinator.deliverBatch([textDelta('message-1', '迟到', 9)])
    expect(tailStore.read(thread.id, 'message-1')).toBe('')
    coordinator.flush()
    await delivered
    expect(coordinator.getSnapshot()?.itemsById.get('message-1')?.text).toBe('最终文本')
  })
})

describe('live item tail store', () => {
  test('按 key 订阅、读取并按帧合并通知', () => {
    const scheduled: Array<() => void> = []
    const scheduler: TailNotificationScheduler = (notify) => {
      scheduled.push(notify)
      return () => {
        const index = scheduled.indexOf(notify)
        if (index >= 0) scheduled.splice(index, 1)
      }
    }
    const store: LiveItemTailStore = createLiveItemTailStore(scheduler)
    const notifications: string[] = []
    const unsubscribe = store.subscribe(thread.id, 'message-1', () => {
      notifications.push(store.read(thread.id, 'message-1'))
    })

    store.append(thread.id, 'message-1', 'text', 'A')
    store.append(thread.id, 'message-1', 'text', 'B')
    expect(store.read(thread.id, 'message-1')).toBe('AB')
    expect(notifications).toEqual([])
    expect(scheduled).toHaveLength(1)

    scheduled.shift()?.()
    expect(notifications).toEqual(['AB'])

    // 提交后清空：只通知一次，且读到空串代表渲染回落到 canonical。
    store.clearItems(thread.id, ['message-1'])
    expect(store.read(thread.id, 'message-1')).toBe('')
    expect(notifications).toEqual(['AB', ''])
    unsubscribe()
  })

  test('clearThread 只清空目标会话', () => {
    const store = createLiveItemTailStore()
    store.append('thread-a', 'item-1', 'text', 'A')
    store.append('thread-b', 'item-1', 'text', 'B')

    store.clearThread('thread-a')

    expect(store.read('thread-a', 'item-1')).toBe('')
    expect(store.read('thread-b', 'item-1')).toBe('B')
  })
})
