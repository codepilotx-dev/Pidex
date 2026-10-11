/**
 * 流式性能计数器：只在性能用例显式启用后才累计，生产与日常开发路径保持 0，
 * 因此可以安全地留在生产代码里而不改变行为。
 *
 * 用途见 `performance-tests/DesktopUx.performance.ts` 的 streaming 场景：
 * 证明"提交次数受帧率约束"且"流式期间的 item 重渲染与尾部更新同阶，而不是
 * 与线程长度同阶"。
 */

export type StreamingPerfCountersSnapshot = {
  canonicalCommitCount: number
  tailNotificationCount: number
  streamingItemRenderCount: number
  /**
   * 已入队但尚未提交到 canonical projection 的 delta 字符数。
   * 流结束时必须回到 0，代表没有 delta 被丢在队列里。
   */
  pendingDeltaCharacters: number
}

type StreamingPerfCountersGlobal = {
  enable(): void
  reset(): void
  snapshot(): StreamingPerfCountersSnapshot
}

const counters: StreamingPerfCountersSnapshot = {
  canonicalCommitCount: 0,
  tailNotificationCount: 0,
  streamingItemRenderCount: 0,
  pendingDeltaCharacters: 0,
}

let enabled = false

export function countCanonicalCommit(): void {
  if (enabled) counters.canonicalCommitCount += 1
}

export function countTailNotification(): void {
  if (enabled) counters.tailNotificationCount += 1
}

export function countStreamingItemRender(): void {
  if (enabled) counters.streamingItemRenderCount += 1
}

export function setPendingDeltaCharacters(value: number): void {
  counters.pendingDeltaCharacters = value
}

export function readStreamingPerfCounters(): StreamingPerfCountersSnapshot {
  return { ...counters }
}

function resetCounters(): void {
  counters.canonicalCommitCount = 0
  counters.tailNotificationCount = 0
  counters.streamingItemRenderCount = 0
  counters.pendingDeltaCharacters = 0
}

const instrumentationAvailable =
  typeof import.meta !== 'undefined' &&
  (import.meta.env?.MODE === 'performance' || import.meta.env?.DEV === true)

if (instrumentationAvailable && typeof window !== 'undefined') {
  const target = window as typeof window & {
    __pidexStreamingPerfCounters?: StreamingPerfCountersGlobal
  }
  target.__pidexStreamingPerfCounters = {
    enable(): void {
      enabled = true
    },
    reset(): void {
      resetCounters()
    },
    snapshot: readStreamingPerfCounters,
  }
}
