import type { ContextUsageBreakdownEntry, ContextUsageBreakdownSource } from '@pidex/shared/thread'

/** 分类展示顺序固定，占比相同的分类之间也保持稳定排序。 */
export const CONTEXT_USAGE_BREAKDOWN_ORDER: readonly ContextUsageBreakdownSource[] = [
  'messages',
  'system_prompt',
  'system_tools',
  'mcp_tools',
  'skills',
  'memory',
  'project',
  'other',
]

export const CONTEXT_USAGE_BREAKDOWN_LABELS: Record<ContextUsageBreakdownSource, string> = {
  messages: '消息',
  system_prompt: '系统提示词',
  system_tools: '系统工具',
  mcp_tools: 'MCP 工具',
  skills: '技能',
  memory: '记忆',
  project: '项目指令',
  other: '其他',
}

export interface ContextUsageBreakdownSegment {
  source: ContextUsageBreakdownSource
  chars: number
  percent: number
}

/**
 * Agent 只下发各来源的字符量，占比在渲染层按字符总量计算——
 * 与 provider 的 token 总数无关，因此各分类之和恒为 100%。
 * 这里的 percent 描述已用部分的内部构成，占窗口的比例由
 * `buildContextUsageBarSegments` 换算后再用于展示。
 */
export function buildContextUsageBreakdownSegments(
  breakdown: readonly ContextUsageBreakdownEntry[] | undefined,
): ContextUsageBreakdownSegment[] {
  const charsBySource = new Map<ContextUsageBreakdownSource, number>()
  for (const entry of breakdown ?? []) {
    if (!Number.isFinite(entry.chars) || entry.chars <= 0) continue
    charsBySource.set(entry.source, (charsBySource.get(entry.source) ?? 0) + entry.chars)
  }
  const totalChars = [...charsBySource.values()].reduce((sum, chars) => sum + chars, 0)
  if (totalChars <= 0) return []

  return [...charsBySource.entries()]
    .map(([source, chars]) => ({ source, chars, percent: chars / totalChars }))
    .sort(
      (left, right) =>
        right.chars - left.chars ||
        CONTEXT_USAGE_BREAKDOWN_ORDER.indexOf(left.source) -
          CONTEXT_USAGE_BREAKDOWN_ORDER.indexOf(right.source),
    )
}

export interface ContextUsageBarSegment extends ContextUsageBreakdownSegment {
  /** 该来源占整个上下文窗口的比例，等于条形中这一段的宽度。 */
  windowPercent: number
}

/**
 * 条形按实际用量缩放：整条轨道代表完整上下文窗口，着色部分只占 usedRatio，
 * 段内再按来源占比切分。分类行展示的也是同一份 windowPercent，
 * 因此条形宽度、分类行数值与顶部「已用/窗口」始终自洽，
 * 不会出现只用了十几个百分点却整条填满的错觉。
 */
export function buildContextUsageBarSegments(
  segments: readonly ContextUsageBreakdownSegment[],
  usedRatio: number,
): ContextUsageBarSegment[] {
  const fill = Number.isFinite(usedRatio) ? Math.min(1, Math.max(0, usedRatio)) : 0
  return segments.map((segment) => ({ ...segment, windowPercent: segment.percent * fill }))
}

const SEGMENT_TONE_PERCENTS = [100, 78, 58, 42, 28] as const

/** 按降序位置给堆叠条分段配色，超出色阶的段落复用最后一档。 */
export function contextUsageSegmentColor(index: number): string {
  const tone = SEGMENT_TONE_PERCENTS[Math.min(index, SEGMENT_TONE_PERCENTS.length - 1)] ?? 100
  return `color-mix(in srgb, var(--cpx-sys-color-accent) ${tone}%, var(--cpx-sys-color-surface-canvas))`
}

export function formatPercentValue(percent: number): string {
  return `${(percent * 100).toFixed(1)}%`
}

export function formatCacheHitRate(hitRate: number | null | undefined): string | null {
  if (hitRate === null || hitRate === undefined || !Number.isFinite(hitRate)) return null
  return formatPercentValue(Math.max(0, Math.min(1, hitRate)))
}
