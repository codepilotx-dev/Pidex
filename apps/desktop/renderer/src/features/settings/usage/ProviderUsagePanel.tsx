import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import React, { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../../components/ui/Button.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { SkeletonBlock, SkeletonRegion } from '../../../components/ui/Skeleton.js'
import {
  formatAmount,
  formatCheckedAt,
  formatCompactCount,
  formatCount,
  formatQuotaValue,
  formatResetTime,
  quotaRemainingPercent,
  sumDecimalAmounts,
  usageStatusLabel,
  type ProviderQuotaWindow,
  type ProviderUsageSource,
} from '../../../utils/UsageFormatters.js'

type ProviderRange = RpcParams<'usage/provider/query'>['range']
type ProviderUsageResult = RpcResult<'usage/provider/query'>
type UsageSourceDescriptor = RpcResult<'usage/source/list'>['sources'][number]

type Props = {
  data: ProviderUsageResult | null
  descriptors: readonly UsageSourceDescriptor[]
  error: string | null
  loading: boolean
  providerNames?: Readonly<Record<string, string>>
  refreshingSourceIds?: readonly string[]
  selectedProviderId?: string
  selectedSourceId?: string
  onClearFilter: () => void
  onRefresh: (sourceIds?: readonly string[], force?: boolean, range?: ProviderRange) => void
}

const RANGE_OPTIONS = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
] as const

export function ProviderUsagePanel({
  data,
  descriptors,
  error,
  loading,
  providerNames = {},
  refreshingSourceIds = [],
  selectedProviderId,
  selectedSourceId,
  onClearFilter,
  onRefresh,
}: Props): React.ReactNode {
  const [sourceRanges, setSourceRanges] = useState<Record<string, ProviderRange>>({})
  const descriptorById = useMemo(
    () => new Map(descriptors.map((source) => [source.sourceId, source])),
    [descriptors],
  )
  const sourceById = useMemo(
    () => new Map((data?.sources ?? []).map((source) => [source.sourceId, source])),
    [data],
  )
  const analyticsDescriptors = useMemo(
    () =>
      descriptors.filter(
        (source) =>
          source.availability === 'queryable' &&
          source.capabilities.some(
            (capability) =>
              capability === 'usage' ||
              capability === 'cost' ||
              capability === 'balance' ||
              capability === 'quota',
          ),
      ),
    [descriptors],
  )
  const visibleAnalytics = useMemo(
    () => filterDescriptors(analyticsDescriptors, selectedProviderId, selectedSourceId),
    [analyticsDescriptors, selectedProviderId, selectedSourceId],
  )
  const visibleResults = useMemo(
    () =>
      visibleAnalytics
        .map((descriptor) => sourceById.get(descriptor.sourceId))
        .filter((source): source is ProviderUsageSource => source !== undefined),
    [sourceById, visibleAnalytics],
  )
  const totals = useMemo(() => summarizeSources(visibleResults), [visibleResults])
  const hasFilter = Boolean(selectedProviderId || selectedSourceId)
  const activeSource = selectedSourceId ? descriptorById.get(selectedSourceId) : undefined
  const noMatchingFilter = hasFilter && visibleAnalytics.length === 0

  const handleSourceRangeChange = useCallback(
    (sourceId: string, nextRange: ProviderRange) => {
      setSourceRanges((current) => ({ ...current, [sourceId]: nextRange }))
      onRefresh([sourceId], true, nextRange)
    },
    [onRefresh],
  )

  const isRefreshingAll =
    visibleAnalytics.length > 0 &&
    visibleAnalytics.every((source) => refreshingSourceIds.includes(source.sourceId))

  return (
    <div
      aria-labelledby="usage-accounts-tab"
      className="usage-panel"
      id="usage-accounts-panel"
      role="tabpanel"
    >
      <div className="usage-panel-toolbar">
        <div>
          <h3>账户用量与成本</h3>
          <p>汇总已配置账户的远端历史用量与成本；余额、套餐和凭据请到账户连接管理。</p>
        </div>
        <div className="usage-toolbar-actions">
          <Button
            color="secondary"
            loading={isRefreshingAll || (loading && refreshingSourceIds.length === 0)}
            onClick={() =>
              onRefresh(
                visibleAnalytics.map((source) => source.sourceId),
                true,
              )
            }
          >
            刷新全部
          </Button>
        </div>
      </div>

      {hasFilter ? (
        <div className="usage-active-filter" role="status">
          <span>
            当前筛选：
            {activeSource?.displayName ?? selectedProviderId ?? selectedSourceId}
          </span>
          <Button color="secondary" onClick={onClearFilter}>
            清除筛选
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="usage-inline-error" role="status">
          {error}
        </div>
      ) : null}
      {loading && !data ? <ProviderUsageSkeleton /> : null}

      {!loading && descriptors.length === 0 ? (
        <div className="usage-empty-state" role="status">
          <h3>还没有已配置的厂商</h3>
          <p>请先从供应商目录完成连接，这里只展示已配置账户的用量与成本。</p>
          <Link className="usage-text-link" to="/settings/providers">
            前往供应商
          </Link>
        </div>
      ) : null}

      {!loading && noMatchingFilter ? (
        <div className="usage-empty-state" role="status">
          <h3>没有匹配的已配置来源</h3>
          <p>当前深链筛选可能已失效，清除后可查看其他账户。</p>
          <Button color="secondary" onClick={onClearFilter}>
            清除筛选
          </Button>
        </div>
      ) : null}

      {visibleAnalytics.length > 0 ? <UsageSummary totals={totals} /> : null}

      <div className="provider-usage-list">
        {visibleAnalytics.map((descriptor) => {
          const isSourceLoading =
            loading &&
            (refreshingSourceIds.length === 0 || refreshingSourceIds.includes(descriptor.sourceId))
          return (
            <ProviderUsageCard
              descriptor={descriptor}
              key={descriptor.sourceId}
              loading={isSourceLoading}
              onRangeChange={(range) => handleSourceRangeChange(descriptor.sourceId, range)}
              onRefresh={() =>
                onRefresh([descriptor.sourceId], true, sourceRanges[descriptor.sourceId] ?? '7d')
              }
              providerName={
                providerNames[String(descriptor.canonicalProviderId)] ??
                String(descriptor.canonicalProviderId)
              }
              range={sourceRanges[descriptor.sourceId] ?? '7d'}
              source={sourceById.get(descriptor.sourceId)}
            />
          )
        })}
      </div>
    </div>
  )
}

function UsageSummary({
  totals,
}: {
  totals: ReturnType<typeof summarizeSources>
}): React.ReactNode {
  return (
    <dl className="usage-account-summary">
      <div>
        <dt>总 Token</dt>
        <dd>{formatCompactCount(totals.tokens)}</dd>
      </div>
      <div>
        <dt>请求数</dt>
        <dd>{formatCount(totals.requests)}</dd>
      </div>
      <div>
        <dt>有数据的来源</dt>
        <dd>{formatCount(totals.sources)}</dd>
      </div>
      {totals.costs.map((cost) => (
        <div key={cost.currency}>
          <dt>{cost.currency} 成本</dt>
          <dd>{formatAmount(cost.currency, cost.amount)}</dd>
        </div>
      ))}
    </dl>
  )
}

function ProviderUsageSkeleton(): React.ReactNode {
  return (
    <SkeletonRegion className="usage-loading" label="正在查询账户用量与成本">
      {Array.from({ length: 3 }, (_, index) => (
        <SkeletonBlock className="usage-loading-provider" key={index} />
      ))}
    </SkeletonRegion>
  )
}

function ProviderUsageCard({
  descriptor,
  providerName,
  source,
  loading,
  range = '7d',
  onRangeChange,
  onRefresh,
}: {
  descriptor: UsageSourceDescriptor
  providerName: string
  source?: ProviderUsageSource
  loading: boolean
  range?: ProviderRange
  onRangeChange?: (range: ProviderRange) => void
  onRefresh: () => void
}): React.ReactNode {
  const providerId = String(descriptor.canonicalProviderId)
  const status =
    source?.status ?? (descriptor.connection.kind === 'none' ? 'not-connected' : 'unavailable')
  const hasTimeSeries = descriptor.capabilities.some(
    (capability) => capability === 'usage' || capability === 'cost',
  )
  return (
    <article
      className="provider-usage-card"
      data-status={status}
      data-stability={descriptor.stability}
    >
      <header className="provider-usage-header">
        <div>
          <div className="provider-usage-title">
            <h3>
              <Link
                title="前往账户连接"
                to={`/settings/providers?provider=${encodeURIComponent(providerId)}`}
              >
                {descriptor.displayName}
              </Link>
            </h3>
            <span className="usage-badge">{scopeLabel(descriptor.scope)}</span>
            <span className="usage-badge" data-stability={descriptor.stability}>
              {descriptor.stability === 'official' ? '官方接口' : '实验性'}
            </span>
            <span className="usage-badge" data-status={status}>
              {usageStatusLabel(status)}
            </span>
          </div>
          <p>
            <Link
              className="usage-text-link"
              to={`/settings/providers?provider=${encodeURIComponent(providerId)}`}
            >
              {providerName}
            </Link>
            {' · '}
            {connectionLabel(descriptor.connection)}
            {' · '}
            {formatCheckedAt(source?.checkedAt)}
          </p>
        </div>
        <div className="provider-usage-card-actions">
          {hasTimeSeries && onRangeChange ? (
            <SegmentedControl
              ariaLabel={`${descriptor.displayName} 时间范围`}
              onChange={onRangeChange}
              options={RANGE_OPTIONS}
              value={range}
            />
          ) : null}
          <Button color="secondary" loading={loading} onClick={onRefresh}>
            刷新
          </Button>
        </div>
      </header>

      {descriptor.queryPolicy === 'metered' ? (
        <div className="usage-cost-notice" role="note">
          Reporting API 为计费查询，价格以官方为准；Pidex 使用一小时缓存且不会后台轮询。
        </div>
      ) : null}
      {descriptor.stability === 'experimental' ? (
        <div className="usage-experimental-note">
          实验性来源可能随官方客户端端点变化；失败只影响此卡片。
        </div>
      ) : null}
      {source?.error ? (
        <div className="usage-source-error" role="status">
          <strong>{source.error.message}</strong>
          <span>
            {source.error.retryable ? '可以稍后重试。' : errorCategoryLabel(source.error.category)}
          </span>
          <Link
            className="usage-text-link"
            to={`/settings/providers?provider=${encodeURIComponent(providerId)}`}
          >
            修复账户连接
          </Link>
        </div>
      ) : null}

      {source?.groups.length ? (
        <div className="provider-usage-groups">
          {source.groups.map((group) => (
            <ProviderUsageGroupCard group={group} key={group.id} />
          ))}
        </div>
      ) : (
        <p className="usage-chart-empty">
          {loading ? '正在查询此来源。' : '当前时间范围没有可展示的历史用量。'}
        </p>
      )}
    </article>
  )
}

function ProviderUsageGroupCard({
  group,
}: {
  group: ProviderUsageSource['groups'][number]
}): React.ReactNode {
  return (
    <section className="provider-usage-group">
      <h4>{group.label}</h4>
      {group.balances && group.balances.length > 0 ? (
        <div aria-label="账户余额" className="provider-balances" role="group">
          {group.balances.map((balance) => (
            <div className="provider-balance-card" key={balance.currency}>
              <div className="provider-balance-header">
                <span className="provider-balance-label">{balance.currency} 账户余额</span>
                <span className="provider-balance-total">
                  {formatAmount(balance.currency, balance.total)}
                </span>
              </div>
              {balance.components && balance.components.length > 0 ? (
                <div className="provider-balance-components">
                  {balance.components.map((component) => (
                    <span className="provider-balance-component" key={component.label}>
                      <span className="provider-balance-component-label">{component.label}</span>
                      <span className="provider-balance-component-amount">
                        {formatAmount(balance.currency, component.amount)}
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {group.quotaWindows && group.quotaWindows.length > 0 ? (
        <div aria-label="额度与重置" className="provider-quotas" role="group">
          {group.quotaWindows.map((quota) => {
            const percent = quotaRemainingPercent(quota)
            const resetText =
              quota.state === 'unlimited' ? '不重置' : formatResetTime(quota.resetsAt)
            return (
              <div className="provider-quota-card" data-state={quota.state} key={quota.id}>
                <div className="provider-quota-header">
                  <span className="provider-quota-label">{quota.label}</span>
                  <span className="provider-quota-reset" title="重置时间">
                    {resetText}
                  </span>
                </div>
                <div className="provider-quota-progress">
                  <div className="provider-quota-bar-track">
                    <div
                      className="provider-quota-bar-fill"
                      style={{ '--usage-ratio': percent / 100 } as React.CSSProperties}
                    />
                  </div>
                </div>
                <div className="provider-quota-meta">
                  <span className="provider-quota-value">{formatQuotaValue(quota)}</span>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
      {group.totals ? (
        <dl className="provider-totals">
          <div>
            <dt>输入 Token</dt>
            <dd>{formatCompactCount(group.totals.inputTokens)}</dd>
          </div>
          <div>
            <dt>输出 Token</dt>
            <dd>{formatCompactCount(group.totals.outputTokens)}</dd>
          </div>
          <div>
            <dt>缓存 Token</dt>
            <dd>{formatCompactCount(group.totals.cachedTokens)}</dd>
          </div>
          <div>
            <dt>请求数</dt>
            <dd>{formatCount(group.totals.requests)}</dd>
          </div>
          {group.totals.costs.map((cost) => (
            <div key={cost.currency}>
              <dt>{cost.currency} 成本</dt>
              <dd>{formatAmount(cost.currency, cost.amount)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {group.series && group.series.length > 0 ? <ProviderSeries points={group.series} /> : null}
      {group.breakdown && group.breakdown.length > 0 ? (
        <ol className="provider-breakdown">
          {group.breakdown.map((item) => (
            <li key={`${item.kind}/${item.id}`}>
              <span>
                <strong>{item.label}</strong>
                <small>{item.kind === 'model' ? '模型' : '工具'}</small>
              </span>
              <span>{formatBreakdownUsage(item)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {!group.totals &&
      !group.series?.length &&
      !group.breakdown?.length &&
      !group.quotaWindows?.length &&
      !group.balances?.length ? (
        <p className="usage-chart-empty">当前时间范围没有返回数据。</p>
      ) : null}
    </section>
  )
}

function ProviderSeries({
  points,
}: {
  points: NonNullable<ProviderUsageSource['groups'][number]['series']>
}): React.ReactNode {
  const tokenValues = points.map(
    (point) => point.inputTokens + point.outputTokens + point.cachedTokens,
  )
  const requestValues = points.map((point) => point.requests)
  const costCurrency = [
    ...new Set(points.flatMap((point) => point.costs.map((cost) => cost.currency))),
  ].sort()[0]
  const costValues = costCurrency
    ? points.map((point) => {
        const amount = point.costs.find((cost) => cost.currency === costCurrency)?.amount
        const value = amount === undefined ? 0 : Number(amount)
        return Number.isFinite(value) && value >= 0 ? value : 0
      })
    : points.map(() => 0)
  const hasTokens = tokenValues.some((value) => value > 0)
  const hasRequests = requestValues.some((value) => value > 0)
  const mode = hasTokens ? 'tokens' : hasRequests ? 'requests' : 'costs'
  const values = mode === 'tokens' ? tokenValues : mode === 'requests' ? requestValues : costValues
  const max = Math.max(1, ...values)
  const width = Math.max(240, points.length * 18)
  return (
    <div className="provider-series">
      <svg
        aria-label="来源每日用量趋势"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${width} 64`}
      >
        {values.map((value, index) => (
          <rect
            fill="var(--usage-chart-1)"
            height={(value / max) * 56}
            key={points[index]?.date}
            rx="2"
            width="12"
            x={index * 18 + 3}
            y={60 - (value / max) * 56}
          >
            <title>
              {mode === 'tokens'
                ? `${points[index]?.date} · ${formatCount(value)} Token`
                : mode === 'requests'
                  ? `${points[index]?.date} · ${formatCount(value)} 次请求`
                  : `${points[index]?.date} · ${formatAmount(
                      costCurrency ?? 'USD',
                      points[index]?.costs.find((cost) => cost.currency === costCurrency)?.amount ??
                        '0',
                    )}`}
            </title>
          </rect>
        ))}
      </svg>
    </div>
  )
}

function filterDescriptors(
  descriptors: readonly UsageSourceDescriptor[],
  providerId: string | undefined,
  sourceId: string | undefined,
): UsageSourceDescriptor[] {
  return descriptors
    .filter(
      (descriptor) => !providerId || descriptor.providerIds.some((id) => String(id) === providerId),
    )
    .filter((descriptor) => !sourceId || descriptor.sourceId === sourceId)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'))
}

function summarizeSources(sources: readonly ProviderUsageSource[]): {
  tokens: number
  requests: number
  sources: number
  costs: Array<{ currency: string; amount: string }>
} {
  let tokens = 0
  let requests = 0
  let populatedSources = 0
  const costs = new Map<string, string[]>()
  for (const source of sources) {
    let populated = false
    for (const group of source.groups) {
      if (!group.totals) continue
      populated = true
      tokens += group.totals.inputTokens + group.totals.outputTokens + group.totals.cachedTokens
      requests += group.totals.requests
      for (const cost of group.totals.costs) {
        const values = costs.get(cost.currency) ?? []
        values.push(cost.amount)
        costs.set(cost.currency, values)
      }
    }
    if (populated) populatedSources += 1
  }
  return {
    tokens,
    requests,
    sources: populatedSources,
    costs: [...costs]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, values]) => ({
        currency,
        amount: sumDecimalAmounts(values),
      })),
  }
}

function formatBreakdownUsage(
  item: NonNullable<ProviderUsageSource['groups'][number]['breakdown']>[number],
): string {
  const parts: string[] = []
  if (item.requests !== undefined) {
    parts.push(`${formatCount(item.requests)} 次`)
  }
  if (
    item.inputTokens !== undefined ||
    item.outputTokens !== undefined ||
    item.cachedTokens !== undefined
  ) {
    parts.push(
      `${formatCompactCount(
        (item.inputTokens ?? 0) + (item.outputTokens ?? 0) + (item.cachedTokens ?? 0),
      )} Token`,
    )
  }
  if (item.costs?.length) {
    parts.push(item.costs.map((cost) => formatAmount(cost.currency, cost.amount)).join(' / '))
  }
  return parts.join(' · ') || '暂无明细'
}

function scopeLabel(scope: UsageSourceDescriptor['scope']): string {
  if (scope === 'api-key') return '当前 Key'
  if (scope === 'account') return '账户'
  if (scope === 'organization') return '组织'
  return '订阅'
}

function connectionLabel(connection: UsageSourceDescriptor['connection']): string {
  if (connection.kind === 'provider-key') return '使用活动推理 Key'
  if (connection.kind === 'billing-key') {
    return `独立管理凭据${connection.maskedValue ? ` · ${connection.maskedValue}` : ''}`
  }
  if (connection.kind === 'oauth') return 'OAuth 已连接'
  if (connection.kind === 'env') return '使用环境变量'
  return '未连接'
}

function errorCategoryLabel(
  category: NonNullable<ProviderUsageSource['error']>['category'],
): string {
  if (category === 'authentication') return '请检查凭据。'
  if (category === 'permission') return '当前凭据缺少所需权限。'
  if (category === 'plan') return '当前账户或套餐不支持此查询。'
  if (category === 'rate-limit') return '厂商接口当前限流。'
  if (category === 'network') return '暂时无法连接厂商接口。'
  if (category === 'invalid-response') return '厂商返回了无法识别的数据。'
  return '查询暂时失败。'
}
