import { useState } from 'react'
import type React from 'react'
import { Tooltip } from '../../../components/ui/Tooltip.js'
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
 * Composer 圆环浮层：保留纵向详细布局，展示来源明细和缓存读写数据。
 * /status 使用下方独立的单行指标组件，两处共享同一份上下文统计。
 */
export function ContextUsagePanel({ contextUsage }: Props): React.ReactNode {
  if (!contextUsage) return null

  const usedPercent = Math.min(100, Math.max(0, contextUsage.usedPercent ?? 0))
  const metrics = buildUsagePanelMetrics(contextUsage)
  const cacheHitRate = formatCacheHitRate(contextUsage.averageCacheHitRate)
  const detailItems = contextUsageDetailItems(contextUsage)

  return (
    <div className="context-usage-panel tw:block">
      <div className="context-usage-panel-header tw:mb-2 tw:flex tw:items-center tw:gap-3">
        <span className="context-usage-panel-title tw:shrink-0 tw:text-app-text tw:type-row-title">
          上下文容量
        </span>
        <span className="context-usage-panel-total tw:ml-auto tw:min-w-0 tw:text-right tw:text-app-text-meta">
          {metrics.totalLabel}
        </span>
      </div>
      <div className="context-usage-panel-track tw:flex tw:h-2 tw:overflow-hidden tw:rounded-indicator tw:bg-app-border">
        {metrics.segments.length > 0 ? (
          metrics.segments.map((segment, index) => (
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
          <span
            className="context-usage-panel-fill tw:h-full tw:shrink-0 tw:bg-app-accent"
            style={{ width: `${usedPercent}%` }}
          />
        )}
      </div>
      {metrics.segments.length > 0 ? (
        <div className="context-usage-panel-rows tw:mt-3 tw:grid tw:gap-2">
          {metrics.segments.map((segment, index) => (
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
              <span className="tw:shrink-0 tw:text-app-text-meta tw:type-caption">
                {item.label}
              </span>
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

/**
 * /status 面板：两个指标均使用「标题、状态条、数据」单行布局。
 */
export function ContextUsageStatusPanel({ contextUsage }: Props): React.ReactNode {
  if (!contextUsage) return null

  const metrics = buildUsagePanelMetrics(contextUsage)

  return (
    <div className="context-usage-panel tw:grid tw:gap-3">
      <div
        className="context-usage-panel-metric tw:flex tw:min-w-0 tw:items-center tw:gap-3"
        data-usage-layout="title-bar-value"
      >
        <span className="context-usage-panel-title tw:w-[7.5rem] tw:shrink-0 tw:text-app-text-meta tw:type-label">
          上下文容量
        </span>
        <div className="tw:min-w-0 tw:flex-1">
          <UsageSegmentBar ariaLabel="上下文容量分类分布" segments={metrics.contextBarSegments} />
        </div>
        <span className="context-usage-panel-total tw:w-[9rem] tw:shrink-0 tw:text-right tw:text-app-text-meta">
          {metrics.totalLabel}
        </span>
      </div>
      {metrics.cacheHitRatio !== null ? (
        <section
          aria-label="平均缓存命中率"
          className="context-usage-panel-metric tw:flex tw:min-w-0 tw:items-center tw:gap-3"
          data-usage-layout="title-bar-value"
        >
          <span className="context-usage-panel-title tw:w-[7.5rem] tw:shrink-0 tw:text-app-text-meta tw:type-label">
            平均缓存命中率
          </span>
          <div className="tw:min-w-0 tw:flex-1">
            <UsageSegmentBar ariaLabel="缓存命中率分布" segments={metrics.cacheBarSegments} />
          </div>
          <span className="context-usage-panel-total tw:w-[9rem] tw:shrink-0 tw:text-right tw:text-app-text-meta">
            {formatPercentValue(metrics.cacheHitRatio)}
          </span>
        </section>
      ) : null}
    </div>
  )
}

function buildUsagePanelMetrics(contextUsage: DesktopContextUsage) {
  const usedPercent = Math.min(100, Math.max(0, contextUsage.usedPercent ?? 0))
  const segments = buildContextUsageBarSegments(
    buildContextUsageBreakdownSegments(contextUsage.breakdown),
    usedPercent / 100,
  )
  const totalLabel = `${formatCompactNumber(contextUsage.usedTokens)}/${formatCompactNumber(
    contextUsage.contextWindow,
  )} (${formatPercentValue(usedPercent / 100)})`
  const contextBarSegments: UsageBarSegment[] =
    segments.length > 0
      ? segments.map((segment, index) => {
          const label = CONTEXT_USAGE_BREAKDOWN_LABELS[segment.source]
          const windowPercent = formatPercentValue(segment.windowPercent)
          const usedPercentLabel = formatPercentValue(segment.percent)
          return {
            id: segment.source,
            widthPercent: segment.windowPercent * 100,
            color: contextUsageSegmentColor(index),
            tooltip: (
              <span className="tw:grid tw:gap-0.5">
                <span className="tw:text-app-text tw:type-label">{label}</span>
                <span>
                  占窗口 {windowPercent} · 占已用 {usedPercentLabel}
                </span>
                <span>{formatCompactNumber(segment.chars)} 字符</span>
              </span>
            ),
            ariaLabel: `${label}：占上下文窗口 ${windowPercent}，占已用上下文 ${usedPercentLabel}，共 ${formatCompactNumber(segment.chars)} 字符`,
          }
        })
      : usedPercent > 0
        ? [
            {
              id: 'used',
              widthPercent: usedPercent,
              color: contextUsageSegmentColor(0),
              tooltip: (
                <span className="tw:grid tw:gap-0.5">
                  <span className="tw:text-app-text tw:type-label">已用上下文</span>
                  <span>{totalLabel}</span>
                </span>
              ),
              ariaLabel: `已用上下文：${totalLabel}`,
            },
          ]
        : []

  const rawCacheHitRate = contextUsage.averageCacheHitRate
  const cacheHitRatio =
    rawCacheHitRate === null || rawCacheHitRate === undefined || !Number.isFinite(rawCacheHitRate)
      ? null
      : Math.min(1, Math.max(0, rawCacheHitRate))
  const cacheBarSegments: UsageBarSegment[] =
    cacheHitRatio === null
      ? []
      : [
          {
            id: 'cache-hit',
            widthPercent: cacheHitRatio * 100,
            color: contextUsageSegmentColor(0),
            tooltip: (
              <span className="tw:grid tw:gap-0.5">
                <span className="tw:text-app-text tw:type-label">缓存命中</span>
                <span>平均缓存命中率 {formatPercentValue(cacheHitRatio)}</span>
              </span>
            ),
            ariaLabel: `缓存命中：${formatPercentValue(cacheHitRatio)}`,
          },
        ].filter((segment) => segment.widthPercent > 0)

  return {
    cacheBarSegments,
    cacheHitRatio,
    contextBarSegments,
    segments,
    totalLabel,
  }
}

type UsageBarSegment = {
  id: string
  widthPercent: number
  color: string
  tooltip: React.ReactNode
  ariaLabel: string
}

function UsageSegmentBar({
  ariaLabel,
  segments,
}: {
  ariaLabel: string
  segments: readonly UsageBarSegment[]
}): React.ReactNode {
  // 悬停高亮要 0ms 响应，浮层则遵循冷启动延迟与预热瞬切，二者不能共用一份状态。
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null)
  const [activeTooltipId, setActiveTooltipId] = useState<string | null>(null)
  const activeHoverId = segments.some((segment) => segment.id === hoveredSegmentId)
    ? hoveredSegmentId
    : null
  const activeTooltipSegmentId = segments.some((segment) => segment.id === activeTooltipId)
    ? activeTooltipId
    : null

  // shortcut: 4px 最小宽度保证低占比色块仍可悬停；需要像素级严格比例时改用扩展热区。
  return (
    <div
      aria-label={ariaLabel}
      className="context-usage-panel-track tw:flex tw:h-6 tw:min-w-0 tw:gap-px tw:overflow-hidden tw:rounded-none tw:bg-app-border"
      role="group"
    >
      {segments.map((segment) => (
        <Tooltip
          align="center"
          content={segment.tooltip}
          key={segment.id}
          onOpenChange={(open) => {
            setActiveTooltipId((current) => {
              if (open) return segment.id
              // 旧分段的关闭回调不能清空刚接管的新分段。
              return current === segment.id ? null : current
            })
          }}
          open={activeTooltipSegmentId === segment.id}
          side="top"
        >
          <button
            aria-label={segment.ariaLabel}
            className="context-usage-panel-segment tw:h-full tw:min-w-1 tw:shrink-0 tw:cursor-help tw:rounded-none tw:border-0 tw:p-0 tw:outline-none tw:transition-opacity tw:duration-feedback tw:ease-standard tw:focus-visible:outline-1 tw:focus-visible:outline-app-focus tw:motion-reduce:transition-none"
            data-active={activeHoverId === segment.id}
            data-usage-bar-source={segment.id}
            onBlur={() =>
              setHoveredSegmentId((current) => (current === segment.id ? null : current))
            }
            onFocus={() => setHoveredSegmentId(segment.id)}
            onMouseEnter={() => setHoveredSegmentId(segment.id)}
            onMouseLeave={() =>
              setHoveredSegmentId((current) => (current === segment.id ? null : current))
            }
            style={{
              background: segment.color,
              opacity: activeHoverId && activeHoverId !== segment.id ? 0.3 : 1,
              width: `${segment.widthPercent.toFixed(2)}%`,
            }}
            type="button"
          />
        </Tooltip>
      ))}
    </div>
  )
}

type ContextUsageDetailItem = {
  label: string
  value: string
}

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
