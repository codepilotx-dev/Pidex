import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../../components/ui/Button.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { SkeletonBlock, SkeletonRegion } from '../../../components/ui/Skeleton.js'
import { formatCompactCount, formatCount, formatUsdAmount } from '../../../utils/UsageFormatters.js'

type LocalRange = RpcParams<'usage/local/get'>['range']
type LocalUsage = RpcResult<'usage/local/get'>
type DailyUsage = LocalUsage['daily'][number]

type Props = {
  data: LocalUsage | null
  error: string | null
  loading: boolean
  range: LocalRange
  onRangeChange: (range: LocalRange) => void
  onRefresh: () => void
}

const RANGE_OPTIONS = [
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: 'all', label: '全部时间' },
] as const

const CHART_COLORS = [
  'var(--usage-chart-1)',
  'var(--usage-chart-2)',
  'var(--usage-chart-3)',
  'var(--usage-chart-4)',
  'var(--usage-chart-5)',
  'var(--usage-chart-other)',
]

export function ApplicationUsagePanel({
  data,
  error,
  loading,
  range,
  onRangeChange,
  onRefresh,
}: Props): React.ReactNode {
  if (loading && !data) return <ApplicationUsageSkeleton />
  if (!data) {
    return (
      <div className="usage-empty-state" role="status">
        <h3>暂时无法读取应用用量</h3>
        <p>{error ?? '本机还没有可归属到模型的调用记录。'}</p>
        <Button color="secondary" onClick={onRefresh}>
          重新读取
        </Button>
      </div>
    )
  }

  const primaryModel = data.models[0]
  const metrics = [
    {
      label: '总 Token',
      value: formatCompactCount(data.totals.totalTokens),
      note: primaryModel ? `主力模型 · ${primaryModel.displayName}` : '暂无模型',
    },
    {
      label: '根任务数',
      value: formatCount(data.totals.rootTasks),
      note: '子代理已归并到根任务',
    },
    {
      label: '模型响应',
      value: formatCount(data.totals.modelResponses),
      note: 'Assistant 回复数量',
    },
    {
      label: 'Provider 调用',
      value: formatCount(data.totals.providerCalls),
      note: '含压缩、摘要和子代理',
    },
    {
      label: '活跃天数',
      value: `${formatCount(data.totals.activeDays)} 天`,
      note: `当前连续 ${data.totals.currentStreak} 天 · 最长 ${data.totals.longestStreak} 天`,
    },
    {
      label: '估算成本',
      value: formatUsdAmount(data.totals.estimatedCostUsd),
      note: '按调用记录中的模型价格估算',
    },
  ]

  return (
    <div
      aria-labelledby="usage-application-tab"
      className="usage-panel"
      id="usage-application-panel"
      role="tabpanel"
    >
      <div className="usage-panel-toolbar">
        <div>
          <h3>应用用量</h3>
          <p>仅统计本机已持久化、能够可靠归属 Provider 和模型的调用。</p>
        </div>
        <div className="usage-toolbar-actions">
          <SegmentedControl
            ariaLabel="应用用量时间范围"
            onChange={onRangeChange}
            options={RANGE_OPTIONS}
            value={range}
          />
          <Button color="secondary" loading={loading} onClick={onRefresh}>
            刷新
          </Button>
        </div>
      </div>

      {error ? (
        <div className="usage-inline-error" role="status">
          {error}
        </div>
      ) : null}

      <div className="usage-metric-grid">
        {metrics.map((metric) => (
          <article className="usage-metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </div>

      <section className="usage-visual-card">
        <header>
          <div>
            <h3>活跃记录</h3>
            <p>颜色越深表示当天模型调用 Token 越多。</p>
          </div>
        </header>
        <UsageHeatmap points={data.heatmap} />
      </section>

      <div className="usage-visual-grid">
        <section className="usage-visual-card usage-trend-card">
          <header>
            <div>
              <h3>Token 趋势</h3>
              <p>每日按模型堆叠，最多展示前五模型。</p>
            </div>
          </header>
          <TokenTrendChart daily={data.daily} modelRanking={data.models} />
        </section>
        <section className="usage-visual-card">
          <header>
            <div>
              <h3>模型分布</h3>
              <p>按总 Token 统计模型占比。</p>
            </div>
          </header>
          <ModelDistribution models={data.models} total={data.totals.totalTokens} />
        </section>
      </div>
    </div>
  )
}

function ApplicationUsageSkeleton(): React.ReactNode {
  return (
    <SkeletonRegion className="usage-loading" label="正在读取应用用量">
      <SkeletonBlock className="usage-loading-toolbar" />
      <div className="usage-metric-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonBlock className="usage-loading-metric" key={index} />
        ))}
      </div>
      <SkeletonBlock className="usage-loading-chart" />
    </SkeletonRegion>
  )
}

function UsageHeatmap({ points }: { points: LocalUsage['heatmap'] }): React.ReactNode {
  const max = Math.max(1, ...points.map((point) => point.totalTokens))
  if (points.length === 0) {
    return <p className="usage-chart-empty">所选时间范围内暂无活跃记录。</p>
  }
  return (
    <div aria-label="每日活跃热力图" className="usage-heatmap" role="list">
      {points.map((point) => {
        const intensity = Math.max(1, Math.ceil((point.totalTokens / max) * 4))
        return (
          <span
            aria-label={`${point.date}，${formatCount(point.totalTokens)} Token，${formatCount(point.modelResponses)} 次模型响应`}
            className="usage-heatmap-cell"
            data-intensity={intensity}
            key={point.date}
            role="listitem"
            tabIndex={0}
            title={`${point.date} · ${formatCount(point.totalTokens)} Token`}
          />
        )
      })}
    </div>
  )
}

type TrendModel = {
  key: string
  label: string
}

function TokenTrendChart({
  daily,
  modelRanking,
}: {
  daily: LocalUsage['daily']
  modelRanking: LocalUsage['models']
}): React.ReactNode {
  const [activeDate, setActiveDate] = useState(daily.at(-1)?.date ?? '')
  const models = useMemo<TrendModel[]>(() => {
    const leading = modelRanking.slice(0, 5).map((model) => ({
      key: `${model.providerId}/${model.modelId}`,
      label: model.displayName,
    }))
    return modelRanking.length > 5 ? [...leading, { key: 'other', label: '其他' }] : leading
  }, [modelRanking])
  const chartData = useMemo(() => daily.map((day) => trendDay(day, models)), [daily, models])
  const max = Math.max(1, ...chartData.map((day) => day.total))
  const width = Math.max(560, chartData.length * 30)
  const active = chartData.find((day) => day.date === activeDate) ?? chartData.at(-1)

  if (daily.length === 0) {
    return <p className="usage-chart-empty">所选时间范围内暂无 Token 记录。</p>
  }

  return (
    <div className="usage-trend">
      <div className="usage-chart-scroll">
        <svg
          aria-label="每日 Token 趋势堆叠柱状图"
          className="usage-token-chart"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} 220`}
        >
          <line className="usage-chart-axis" x1="0" x2={width} y1="200" y2="200" />
          {chartData.map((day, dayIndex) => {
            const x = dayIndex * 30 + 5
            let offset = 200
            return (
              <g
                aria-label={`${day.date}，${formatCount(day.total)} Token`}
                key={day.date}
                onBlur={() => undefined}
                onFocus={() => setActiveDate(day.date)}
                onMouseEnter={() => setActiveDate(day.date)}
                role="listitem"
                tabIndex={0}
              >
                <title>{`${day.date} · ${formatCount(day.total)} Token`}</title>
                {day.values.map((value, modelIndex) => {
                  const height = (value / max) * 184
                  offset -= height
                  return (
                    <rect
                      fill={CHART_COLORS[modelIndex]}
                      height={height}
                      key={models[modelIndex]?.key}
                      rx="2"
                      width="20"
                      x={x}
                      y={offset}
                    />
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>
      <div aria-live="polite" className="usage-chart-detail">
        <strong>{active?.date ?? '—'}</strong>
        <span>{formatCount(active?.total)} Token</span>
        {active?.values.map((value, index) =>
          value > 0 ? (
            <span key={models[index]?.key}>
              <i style={{ background: CHART_COLORS[index] }} />
              {models[index]?.label} {formatCompactCount(value)}
            </span>
          ) : null,
        )}
      </div>
      <div aria-label="图表模型图例" className="usage-chart-legend">
        {models.map((model, index) => (
          <span key={model.key}>
            <i style={{ background: CHART_COLORS[index] }} />
            {model.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function trendDay(
  day: DailyUsage,
  models: TrendModel[],
): {
  date: string
  total: number
  values: number[]
} {
  const leadingKeys = new Set(
    models.filter((model) => model.key !== 'other').map((model) => model.key),
  )
  const byKey = new Map(
    day.models.map((model) => [`${model.providerId}/${model.modelId}`, model.totalTokens]),
  )
  return {
    date: day.date,
    total: day.totals.totalTokens,
    values: models.map((model) =>
      model.key === 'other'
        ? day.models
            .filter((item) => !leadingKeys.has(`${item.providerId}/${item.modelId}`))
            .reduce((sum, item) => sum + item.totalTokens, 0)
        : (byKey.get(model.key) ?? 0),
    ),
  }
}

function ModelDistribution({
  models,
  total,
}: {
  models: LocalUsage['models']
  total: number
}): React.ReactNode {
  const segments: string[] = []
  let offset = 0
  models.slice(0, 5).forEach((model, index) => {
    const end = Math.min(100, offset + model.sharePercent)
    segments.push(`${CHART_COLORS[index]} ${offset}% ${end}%`)
    offset = end
  })
  if (offset < 100) {
    segments.push(`${CHART_COLORS[5]} ${offset}% 100%`)
  }
  return (
    <div className="usage-distribution">
      <div
        aria-label={`模型分布，总计 ${formatCount(total)} Token`}
        className="usage-donut"
        role="img"
        style={{ background: `conic-gradient(${segments.join(',')})` }}
      >
        <span>
          <strong>{formatCompactCount(total)}</strong>
          <small>Token</small>
        </span>
      </div>
      <ol className="usage-model-ranking">
        {models.length === 0 ? (
          <li>暂无模型用量</li>
        ) : (
          models.map((model, index) => (
            <li key={`${model.providerId}/${model.modelId}`}>
              <i style={{ background: CHART_COLORS[Math.min(index, 5)] }} />
              <span>
                <Link
                  className="usage-provider-link"
                  to={`/settings/providers?provider=${encodeURIComponent(String(model.providerId))}&section=models`}
                >
                  {model.displayName}
                </Link>
                <small>{model.providerId}</small>
              </span>
              <span>
                {model.sharePercent.toFixed(1)}%
                <small>{formatCompactCount(model.totalTokens)} Token</small>
              </span>
            </li>
          ))
        )}
      </ol>
    </div>
  )
}
