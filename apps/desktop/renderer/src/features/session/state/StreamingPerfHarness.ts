import type { EventEnvelope } from '@pidex/agent-protocol'

import {
  readStreamingPerfCounters,
  type StreamingPerfCountersSnapshot,
} from './StreamingPerfCounters.js'
import type { CanonicalThreadIngestionCoordinator } from '../timeline/CanonicalThreadIngestionCoordinator.js'

/**
 * 性能用例专用的流式注入钩子：把 live delta 直接喂给已挂载的 canonical
 * coordinator，绕开 SSE 传输层，从而单独度量"提交调度 + 投影 + 尾部渲染"这条
 * 路径的帧代价与提交次数。
 *
 * 只在 DEV 或 performance 构建里安装；生产构建不暴露、不改变行为。
 */

export const STREAMING_PERF_ITEM_ID = 'perf-streaming-item'

export type StreamingPerfHarnessSnapshot = {
  counters: StreamingPerfCountersSnapshot
  appliedSequence: number
  streamedItemTextLength: number
}

export type StreamingPerfHarness = {
  /**
   * 开始新的采样：换用新的目标 item，使每个采样的文本长度与计数可独立核对。
   * 传入 turnId 可指定已挂载的 turn；省略时使用最后一个 turn（虚拟列表下可能
   * 未被挂载，此时不会产生渲染，只适合度量投影提交）。
   */
  beginSample(turnId?: string): void
  /** 追加一个 live 文本 delta；返回的 promise 在该 delta 提交后 resolve。 */
  pushDelta(delta: string): Promise<void>
  /** 立即提交未决 delta，供用例在测量结束后收尾。 */
  flush(): void
  snapshot(): StreamingPerfHarnessSnapshot
}

type StreamingPerfHarnessGlobal = {
  __pidexStreamingPerfHarness?: StreamingPerfHarness
}

export function streamingPerfHarnessAvailable(): boolean {
  return (
    typeof import.meta !== 'undefined' &&
    (import.meta.env?.MODE === 'performance' || import.meta.env?.DEV === true) &&
    typeof window !== 'undefined'
  )
}

export function installStreamingPerfHarness(
  coordinator: CanonicalThreadIngestionCoordinator,
): () => void {
  if (!streamingPerfHarnessAvailable()) return () => undefined
  const target = window as unknown as StreamingPerfHarnessGlobal
  let deltaIndex = 0
  let sampleIndex = 0
  let itemId = STREAMING_PERF_ITEM_ID
  let turnIdOverride: string | null = null

  const pushDelta = (delta: string): Promise<void> => {
    const state = coordinator.getSnapshot()
    const turnId = turnIdOverride ?? state?.turnOrder.at(-1)
    if (!state || !turnId) return Promise.resolve()
    const turn = state.turnsById.get(turnId)
    const envelope: EventEnvelope = {
      eventId: `perf-delta-${deltaIndex}`,
      streamId: coordinator.streamId,
      type: 'item/agentMessage/delta',
      version: 1,
      occurredAt: Date.now(),
      threadId: coordinator.streamId,
      turnId,
      durability: 'live',
      sequence: null,
      afterSequence: state.stream.appliedSequence,
      payload: {
        itemId,
        turnId,
        agentId: turn?.rootAgentId ?? `perf-agent-${turnId}`,
        delta,
      },
    } as EventEnvelope
    deltaIndex += 1
    return coordinator.deliverBatch([envelope])
  }

  target.__pidexStreamingPerfHarness = {
    beginSample: (turnId?: string) => {
      sampleIndex += 1
      itemId = `${STREAMING_PERF_ITEM_ID}-${sampleIndex}`
      turnIdOverride = turnId ?? null
    },
    pushDelta,
    flush: () => coordinator.flush(),
    snapshot: () => {
      const state = coordinator.getSnapshot()
      const item = state?.itemsById.get(itemId)
      return {
        counters: readStreamingPerfCounters(),
        appliedSequence: state?.stream.appliedSequence ?? 0,
        streamedItemTextLength: item?.type === 'text' ? item.text.length : 0,
      }
    },
  }

  return () => {
    delete target.__pidexStreamingPerfHarness
  }
}
