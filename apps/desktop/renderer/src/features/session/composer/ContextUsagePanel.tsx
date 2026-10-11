import type React from 'react'
import type { DesktopContextUsage } from '../../../../shared/Types.js'
import { formatCompactNumber } from '../../../utils/UsageFormatters.js'
import {
  CONTEXT_USAGE_BREAKDOWN_LABELS,
  buildContextUsageBreakdownSegments,
  contextUsageSegmentColor,
  formatCacheHitRate,
  formatPercentValue,
} from './ContextUsageBreakdown.js'

type Props = {
  contextUsage: DesktopContextUsage | null
}

/**
 * 上下文容量面板：标题行 + 总量 + 进度条 + 来源分类行 + 平均缓存命中率。
 * Composer 圆环浮层与 /status 弹层共用，避免两处各画一套。
 */
export function ContextUsagePanel({ contextUsage }: Props): React.ReactNode {
  if (!contextUsage) {
    return (
      <div className="context-usage-panel-empty tw:text-app-text-meta tw:type-secondary">
        暂无上下文统计
      </div>
    )
  }

  const usedPercent = Math.min(100, Math.max(0, contextUsage.usedPercent ?? 0))
  const segments = buildContextUsageBreakdownSegments(contextUsage.breakdown)
  const cacheHitRate = formatCacheHitRate(contextUsage.averageCacheHitRate)
  const detail = contextUsageDetail(contextUsage)
  const totalLabel = `${formatCompactNumber(contextUsage.usedTokens)}/${formatCompactNumber(
    contextUsage.contextWindow,
  )} (${formatPercentValue(usedPercent / 100)})`

  return (
    <div className="context-usage-panel tw:block">
      <div className="context-usage-panel-header tw:mb-2 tw:flex tw:items-center tw:gap-3">
        <span className="context-usage-panel-title tw:shrink-0 tw:text-app-text tw:type-row-title">
          上下文容量
        </span>
        <span className="context-usage-panel-total tw:ml-auto tw:min-w-0 tw:text-right tw:text-app-text-meta">
          {totalLabel}
        </span>
      </div>
      <div className="context-usage-panel-track tw:flex tw:h-2 tw:overflow-hidden tw:rounded-indicator tw:bg-app-border">
        {segments.length > 0 ? (
          segments.map((segment, index) => (
            <span
              className="context-usage-panel-segment tw:h-full tw:shrink-0"
              key={segment.source}
              style={{
                width: formatPercentValue(segment.percent),
                background: contextUsageSegmentColor(index),
              }}
            />
          ))
        ) : (
          // 旧会话没有分类数据时退化成单色占用条。
          <span
            className="context-usage-panel-fill tw:h-full tw:shrink-0 tw:bg-app-accent"
            style={{ width: `${usedPercent}%` }}
          />
        )}
      </div>
      {segments.length > 0 ? (
        <div className="context-usage-panel-rows tw:mt-3 tw:grid tw:gap-2">
          {segments.map((segment, index) => (
            <div
              className="context-usage-panel-row tw:flex tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-secondary"
              key={segment.source}
            >
              <span
                className="context-usage-panel-dot tw:size-2 tw:shrink-0 tw:rounded-2xs tw:border tw:border-app-border"
                style={{ background: contextUsageSegmentColor(index) }}
              />
              <span className="context-usage-panel-label tw:min-w-0 tw:flex-1 tw:truncate">
                {CONTEXT_USAGE_BREAKDOWN_LABELS[segment.source]}
              </span>
              <span className="context-usage-panel-value tw:ml-auto tw:shrink-0 tw:text-right tw:text-app-text">
                {formatPercentValue(segment.percent)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {cacheHitRate ? (
        <div className="context-usage-panel-row context-usage-panel-divider tw:mt-2 tw:flex tw:items-center tw:gap-2 tw:border-t tw:border-app-border tw:pt-3 tw:text-app-text-meta tw:type-secondary">
          <span className="context-usage-panel-label tw:min-w-0 tw:flex-1 tw:truncate">
            平均缓存命中率
          </span>
          <span className="context-usage-panel-value tw:ml-auto tw:shrink-0 tw:text-right tw:text-app-text">
            {cacheHitRate}
          </span>
        </div>
      ) : null}
      {detail ? (
        <div className="context-usage-panel-detail tw:mt-2 tw:text-app-text-meta tw:type-caption">
          {detail}
        </div>
      ) : null}
    </div>
  )
}

/** 缓存的读写明细：只在下发过缓存数据时出现，作为面板最下方的一行补充。 */
function contextUsageDetail(contextUsage: DesktopContextUsage): string | null {
  const cacheRead = contextUsage.promptCacheReadTokens ?? 0
  const cacheWrite = contextUsage.promptCacheWriteTokens ?? 0
  const uncached = contextUsage.promptUncachedTokens ?? 0
  const reasoning = contextUsage.reasoningTokens ?? 0
  const parts: string[] = []
  if (cacheRead + cacheWrite + uncached > 0) {
    parts.push(
      `缓存 读 ${formatCompactNumber(cacheRead)}`,
      `写 ${formatCompactNumber(cacheWrite)}`,
      `未缓存 ${formatCompactNumber(uncached)}`,
    )
  }
  if (reasoning > 0) parts.push(`推理 ${formatCompactNumber(reasoning)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
