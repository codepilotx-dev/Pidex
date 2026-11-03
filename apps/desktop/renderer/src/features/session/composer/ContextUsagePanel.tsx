import { Fragment, useId, useState } from 'react'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import type React from 'react'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { Gauge, Zap } from 'lucide-react'
import { APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import type { DesktopContextUsage } from '../../../../shared/Types.js'
import { formatCompactNumber } from '../../../utils/UsageFormatters.js'
import {
  CONTEXT_USAGE_BREAKDOWN_LABELS,
  CONTEXT_USAGE_SOURCE_COLORS,
  buildContextUsageDotOwners,
  buildContextUsageBarSegments,
  buildContextUsageBreakdownSegments,
  contextUsageSegmentColor,
  ensureMinSegmentRatios,
  formatPercentValue,
} from './ContextUsageBreakdown.js'

type Props = {
  contextUsage: DesktopContextUsage | null
  view?: 'bar' | 'field'
  maxContextTokens?: number | null
  modelContextWindow?: number | null
}

/** 圆环浮层使用真实用量；分类来自字符比例，不估算分类 token。 */
export function ContextUsagePanel({
  contextUsage,
  view = 'bar',
  maxContextTokens,
  modelContextWindow,
}: Props): React.ReactNode {
  const [metric, setMetric] = useState<'context' | 'cache'>('context')
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const id = useId()
  if (!contextUsage) return null

  const physicalWindow = contextUsage.budgetFrozen
    ? (contextUsage.budget?.contextWindowTokens ?? modelContextWindow ?? contextUsage.contextWindow)
    : (modelContextWindow ?? contextUsage.budget?.contextWindowTokens ?? contextUsage.contextWindow)
  const configuredLimit =
    maxContextTokens != null && maxContextTokens > 0
      ? contextUsage.budgetFrozen
        ? (contextUsage.budget?.inputBudgetTokens ?? maxContextTokens)
        : maxContextTokens
      : null
  const hasLimit =
    configuredLimit !== null && configuredLimit > 0 && configuredLimit < physicalWindow
  const contextWindow = hasLimit ? configuredLimit : physicalWindow
  const usedRatio = contextWindow > 0 ? Math.max(0, contextUsage.usedTokens / contextWindow) : 0
  const metrics = buildUsagePanelMetrics({
    ...contextUsage,
    contextWindow,
    usedPercent: usedRatio * 100,
  })
  const triggerTokens = contextUsage.budget?.triggerTokens
  const beforeCompression =
    triggerTokens == null ? null : Math.max(0, triggerTokens - contextUsage.usedTokens)
  const compressionRemainingRatio =
    triggerTokens != null && triggerTokens > 0 && beforeCompression != null
      ? Math.min(1, beforeCompression / triggerTokens)
      : 0
  // 两层窗口分别展示：已用构成优先，紫色按距阈值的真实剩余收缩，总窗口保留独立参照。
  const windowReferenceWidth = 0.1
  const compressionRoomWidth =
    contextUsage.usedTokens > 0 ? compressionRemainingRatio * 0.2 : 1 - windowReferenceWidth
  const compositionWidth = 1 - windowReferenceWidth - compressionRoomWidth
  const cache = metric === 'cache'
  const detailItems = cache
    ? contextUsageDetailItems(contextUsage).filter((item) => item.label !== '推理')
    : []
  const ratio = cache ? metrics.cacheHitRatio : usedRatio
  const parts = cache
    ? ratio === null
      ? []
      : ensureMinSegmentRatios(
          [
            { id: 'hit', label: '命中', ratio, color: 'var(--cpx-sys-color-charts-green)' },
            {
              id: 'miss',
              label: '未命中',
              ratio: 1 - ratio,
              color: 'var(--cpx-sys-color-fg-tertiary)',
            },
          ],
          1,
          0.024,
        )
    : [
        ...(metrics.segments.length > 0
          ? ensureMinSegmentRatios(
              metrics.segments.map((segment) => ({
                id: segment.source,
                label: CONTEXT_USAGE_BREAKDOWN_LABELS[segment.source],
                ratio: segment.percent * compositionWidth,
                color: CONTEXT_USAGE_SOURCE_COLORS[segment.source],
              })),
              compositionWidth,
              0.024,
            )
          : [
              {
                id: 'used',
                label: '已用',
                ratio: compositionWidth,
                color: 'var(--cpx-sys-color-accent)',
              },
            ]),
        {
          id: 'room',
          label: '压缩前剩余',
          ratio: compressionRoomWidth,
          color:
            'color-mix(in srgb, var(--cpx-sys-color-charts-purple) 25%, var(--cpx-sys-color-surface-raised))',
        },
        {
          id: 'window',
          label: '总窗口',
          ratio: windowReferenceWidth,
          color: 'var(--cpx-sys-color-fg-tertiary)',
        },
      ]
  const active = parts.find((part) => part.id === (focused ?? hovered))
  const selected = metrics.segments.find((segment) => segment.source === active?.id)
  const activeRatio = cache
    ? active?.ratio
    : (selected?.percent ?? (contextUsage.usedTokens > 0 ? 1 : 0))
  const figure = active
    ? !cache && active.id === 'room'
      ? beforeCompression == null
        ? '—'
        : formatCompactNumber(beforeCompression)
      : !cache && active.id === 'window'
        ? formatCompactNumber(physicalWindow)
        : formatPercentValue(activeRatio ?? 0)
    : cache
      ? ratio === null
        ? '—'
        : formatPercentValue(ratio)
      : formatCompactNumber(contextUsage.usedTokens)
  const owners = cache
    ? Array.from({ length: 200 }, (_, i) => (i < Math.round((ratio ?? 0) * 200) ? 'hit' : 'miss'))
    : buildContextUsageDotOwners(metrics.segments, compositionWidth).map(
        (owner, index) => owner ?? (index >= 180 ? 'window' : 'room'),
      )
  const clearHighlight = () => {
    setHovered(null)
    setFocused(null)
  }

  return (
    <div className="context-usage-panel tw:grid tw:w-[300px] tw:max-w-full tw:max-h-[min(392px,calc(100vh-124px))] tw:gap-3 tw:overflow-x-hidden tw:overflow-y-auto">
      <div className="tw:flex tw:items-center tw:justify-between tw:gap-3">
        <div className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-2">
          <div
            className="tw:text-app-text tw:type-display tw:tabular-nums"
            aria-live="polite"
            aria-atomic="true"
          >
            {figure}
          </div>
          <div
            className="tw:text-app-text-meta tw:type-caption"
            title={
              hasLimit
                ? `模型容量 ${formatCompactNumber(physicalWindow)} tokens；当前上下文上限 ${formatCompactNumber(contextWindow)} tokens`
                : undefined
            }
          >
            {active
              ? active.label
              : cache
                ? '平均缓存命中率'
                : ` / ${formatCompactNumber(contextWindow)} tokens`}
          </div>
        </div>
        <SegmentedControl
          ariaLabel="用量指标"
          semantics="tabs"
          variant="inset"
          size="xs"
          value={metric}
          options={[
            {
              value: 'context',
              ariaLabel: '上下文用量',
              tooltip: '上下文用量',
              label: (
                <span className="tw:inline-flex tw:items-center tw:justify-center">
                  <Gauge
                    className="tw:size-3.5"
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                    aria-hidden="true"
                  />
                  <span className="tw:sr-only">上下文用量</span>
                </span>
              ),
            },
            {
              value: 'cache',
              ariaLabel: '平均缓存命中率',
              tooltip: '平均缓存命中率',
              label: (
                <span className="tw:inline-flex tw:items-center tw:justify-center">
                  <Zap
                    className="tw:size-3.5"
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                    aria-hidden="true"
                  />
                  <span className="tw:sr-only">平均缓存命中率</span>
                </span>
              ),
            },
          ]}
          getTabId={(value) => `${id}-${value}-tab`}
          getPanelId={(value) => `${id}-${value}-panel`}
          onChange={(value) => {
            setMetric(value)
            clearHighlight()
          }}
        />
      </div>
      <section role="tabpanel" id={`${id}-${metric}-panel`} aria-labelledby={`${id}-${metric}-tab`}>
        <div>
          <div className="tw:relative">
            {ratio === null ? (
              <p className="tw:py-4 tw:text-app-text-meta tw:type-secondary">暂无缓存命中数据</p>
            ) : view === 'field' ? (
              <div
                className="context-meter-field"
                aria-hidden="true"
                onPointerLeave={() => setHovered(null)}
              >
                {owners.map((owner, index) => (
                  // 每个点保留索引身份：数据变化只改变颜色，错开的延迟让变化沿点阵推进。
                  <i
                    key={index}
                    className="context-meter-dot"
                    data-owner={owner}
                    style={
                      {
                        background: parts.find((part) => part.id === owner)?.color,
                        opacity: active && owner !== active.id ? 0.22 : 1,
                        '--context-meter-delay': `${index * 1.1}ms`,
                      } as React.CSSProperties
                    }
                    onPointerEnter={() => setHovered(owner)}
                  />
                ))}
              </div>
            ) : (
              <div
                className="context-meter-bar tw:flex-row"
                role="group"
                aria-label={cache ? '缓存命中率分布' : '已用上下文分类构成'}
              >
                {(() => {
                  const visible = parts.filter((part) => part.ratio > 0)
                  const firstUnusedIndex = visible.findIndex(
                    (p) => p.id === 'room' || p.id === 'window',
                  )
                  const showLimit = !cache && compositionWidth > 0
                  const limitIndex =
                    firstUnusedIndex >= 0
                      ? firstUnusedIndex
                      : showLimit && compositionWidth < 1
                        ? visible.length
                        : -1

                  return (
                    <>
                      {visible.map((part, index) => (
                        <Fragment key={part.id}>
                          {showLimit && index === limitIndex ? (
                            <span className="context-meter-limit" aria-hidden="true" />
                          ) : null}
                          <span
                            className="context-meter-segment"
                            aria-hidden="true"
                            data-source={part.id}
                            onPointerEnter={() => setHovered(part.id)}
                            onPointerLeave={() => setHovered(null)}
                            style={{
                              flex: `${Math.round(part.ratio * 10000)} 1 0%`,
                              minWidth: part.ratio > 0 ? '6px' : 0,
                              height: '100%',
                              background: part.color,
                              opacity: active && active.id !== part.id ? 0.22 : 1,
                              zIndex: active && active.id === part.id ? 2 : 1,
                            }}
                          />
                        </Fragment>
                      ))}
                      {showLimit && limitIndex === visible.length ? (
                        <span className="context-meter-limit" aria-hidden="true" />
                      ) : null}
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
        {ratio !== null && (
          <div className="tw:mt-3 tw:flex tw:flex-wrap tw:gap-1.5">
            {parts.map((part) => {
              const segment = metrics.segments.find((entry) => entry.source === part.id)
              const share = cache ? part.ratio : (segment?.percent ?? 0)
              const value =
                !cache && part.id === 'room'
                  ? beforeCompression == null
                    ? '暂无压缩阈值'
                    : `${formatCompactNumber(beforeCompression)} tokens（阈值 ${formatCompactNumber(triggerTokens!)}）`
                  : !cache && part.id === 'window'
                    ? `${formatCompactNumber(physicalWindow)} tokens`
                    : formatPercentValue(share)
              return (
                <button
                  type="button"
                  key={part.id}
                  className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:border-0 tw:bg-app-hover tw:px-2 tw:py-1 tw:text-app-text tw:type-caption tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
                  aria-label={`${part.label} ${value}`}
                  title={
                    segment
                      ? `占已用 ${formatPercentValue(segment.percent)} · ${formatCompactNumber(segment.chars)} 字符（按字符占比分配）`
                      : `${part.label} ${value}`
                  }
                  onPointerEnter={() => setHovered(part.id)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setFocused(part.id)}
                  onBlur={() => setFocused(null)}
                  style={{ opacity: active && active.id !== part.id ? 0.4 : 1 }}
                >
                  <i
                    className="tw:size-2 tw:rounded-2xs"
                    style={{ background: part.color }}
                    aria-hidden="true"
                  />
                  {part.label}
                </button>
              )
            })}
          </div>
        )}
        {selected && (
          <span className="tw:sr-only" aria-live="polite">
            占已用 {formatPercentValue(selected.percent)} · {formatCompactNumber(selected.chars)}{' '}
            字符（分类按字符占比分配）
          </span>
        )}
      </section>
      {detailItems.length > 0 ? (
        <div className="context-usage-panel-detail tw:mt-2 tw:grid tw:grid-cols-3 tw:gap-2">
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
  )} (${formatPercentValue((contextUsage.usedPercent ?? 0) / 100)})`
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
