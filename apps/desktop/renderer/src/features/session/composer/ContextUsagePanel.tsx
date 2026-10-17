import type React from 'react'
import type { DesktopContextUsage } from '../../../../shared/Types.js'
import { formatCompactNumber } from '../../../utils/UsageFormatters.js'
import {
  CONTEXT_USAGE_BREAKDOWN_LABELS,
  buildContextUsageBarSegments,
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
 * 没有统计时保持空白，由调用方决定是否显示入口，不渲染占位文案。
 */
export function ContextUsagePanel({ contextUsage }: Props): React.ReactNode {
  if (!contextUsage) return null

  const usedPercent = Math.min(100, Math.max(0, contextUsage.usedPercent ?? 0))
  // 轨道代表完整上下文窗口，着色部分只按实际用量铺开，段内再分来源。
  const segments = buildContextUsageBarSegments(
    buildContextUsageBreakdownSegments(contextUsage.breakdown),
    usedPercent / 100,
  )
  const cacheHitRate = formatCacheHitRate(contextUsage.averageCacheHitRate)
  const detailItems = contextUsageDetailItems(contextUsage)
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
                width: formatPercentValue(segment.windowPercent),
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
                {formatPercentValue(segment.windowPercent)}
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
      {detailItems.length > 0 ? (
        <div
          className={
            detailItems.length > 3
              ? 'context-usage-panel-detail tw:mt-2 tw:grid tw:grid-cols-2 tw:gap-2'
              : 'context-usage-panel-detail tw:mt-2 tw:grid tw:grid-cols-3 tw:gap-2'
          }
        >
          {detailItems.map((item) => (
            <div
              className="context-usage-panel-detail-item tw:flex tw:min-w-0 tw:items-center tw:justify-center tw:gap-1.5"
              key={item.label}
            >
              <span className="tw:shrink-0 tw:text-app-text-meta tw:type-caption">{item.label}</span>
              <span className="context-usage-panel-detail-chip tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full tw:bg-app-hover tw:px-2 tw:py-0.5 tw:text-app-text tw:type-caption tw:tabular-nums">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type ContextUsageDetailItem = {
  label: string
  value: string
}

/** 缓存的读写明细：只在下发过缓存数据时出现，作为面板最下方的 chip 行。 */
function contextUsageDetailItems(contextUsage: DesktopContextUsage): ContextUsageDetailItem[] {
  const cacheRead = contextUsage.promptCacheReadTokens ?? 0
  const cacheWrite = contextUsage.promptCacheWriteTokens ?? 0
  const uncached = contextUsage.promptUncachedTokens ?? 0
  const reasoning = contextUsage.reasoningTokens ?? 0
  const items: ContextUsageDetailItem[] = []
  if (cacheRead + cacheWrite + uncached > 0) {
    items.push(
      { label: '读', value: formatCompactNumber(cacheRead) },
      { label: '写', value: formatCompactNumber(cacheWrite) },
      { label: '未缓存', value: formatCompactNumber(uncached) },
    )
  }
  if (reasoning > 0) items.push({ label: '推理', value: formatCompactNumber(reasoning) })
  return items
}
