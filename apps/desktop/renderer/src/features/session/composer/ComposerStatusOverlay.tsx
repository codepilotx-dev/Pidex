import type React from 'react'
import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import {
  criticalQuotaWindows,
  formatCount,
  formatResetTime,
  protocolProviderId,
  quotaRemainingPercent,
  sourceForProvider,
  type ProviderQuotaWindow,
  type ProviderUsageSource,
} from '../../../utils/UsageFormatters.js'
import type { DesktopContextUsage, ModelProviderID } from '../../../../shared/Types.js'
import { ContextUsageStatusPanel } from './ContextUsagePanel.js'

type Props = {
  onClose: () => void
  routedSessionId: string | null
  contextUsage: DesktopContextUsage | null
  selectedProviderID?: ModelProviderID
}

/*
 * `composer-status-bar-fill` keeps its scaleX/transform-origin/transition in
 * `src/styles/features/_composer-status.scss`: the animation contract in
 * `scripts/CheckStyleContracts.ts` pins that rule to a transform-only,
 * compositor-safe transition.
 */
const SECTION_CLASS = 'composer-status-section tw:min-w-0'
const HEADER_CLASS =
  'composer-status-header tw:flex tw:min-h-10 tw:items-center tw:justify-between tw:gap-3 tw:px-3 tw:pb-1 tw:pt-2'

function renderQuotaRow(quota: ProviderQuotaWindow): React.ReactNode {
  const percent = quotaRemainingPercent(quota)
  return (
    <div className="composer-status-quota-row tw:[&+&]:mt-2" key={quota.id}>
      <div className="composer-status-label tw:mb-1 tw:text-app-text-meta tw:type-label tw:[&>svg]:size-[var(--inline-icon-size,1em)]">
        {quota.label}
      </div>
      <div className="composer-status-bar-track tw:my-1 tw:h-1.5 tw:overflow-hidden tw:rounded-indicator tw:bg-app-border">
        <div
          className="composer-status-bar-fill"
          style={{ '--usage-ratio': percent / 100 } as React.CSSProperties}
        />
      </div>
      <div className="composer-status-bar-meta tw:flex tw:items-center tw:justify-between tw:type-caption">
        <span className="composer-status-bar-percent tw:text-app-text tw:type-label">
          {quota.state === 'unlimited' ? '无限' : `${percent}%`}
        </span>
        <span className="composer-status-bar-detail tw:text-app-text-meta">
          {quota.remaining !== undefined
            ? `剩余 ${formatCount(quota.remaining)} ${quota.unit === 'tokens' ? 'Token' : '额度'}`
            : ''}
          {quota.resetsAt !== undefined ? ` · ${formatResetTime(quota.resetsAt)}` : ''}
        </span>
      </div>
    </div>
  )
}

export function ComposerStatusOverlay({
  onClose,
  routedSessionId,
  contextUsage,
  selectedProviderID,
}: Props): React.ReactNode {
  const [usageSource, setUsageSource] = useState<ProviderUsageSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedProviderID) {
      setUsageSource(null)
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setUsageSource(null)

    desktopClient
      .queryProviderUsage({
        range: '7d',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        providerIds: [protocolProviderId(selectedProviderID)],
      })
      .then((result) => {
        if (!cancelled) {
          const source = sourceForProvider(result.sources, selectedProviderID) ?? null
          setUsageSource(source)
          setLoading(false)
          setError(source?.error?.message ?? null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedProviderID])

  const quotas = criticalQuotaWindows(usageSource, 3)
  const showQuotaSection =
    Boolean(selectedProviderID) && (loading || Boolean(error) || quotas.length > 0)

  return (
    <section
      aria-label="状态与用量"
      className="composer-status tw:w-full tw:min-w-0"
      data-composer-utility-item="status"
    >
      <div className={HEADER_CLASS}>
        <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
          <Gauge
            aria-hidden="true"
            className="tw:shrink-0 tw:text-app-text-meta"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
          <span className="tw:text-app-text-meta tw:type-label">状态与用量</span>
        </span>
        <Button color="ghostSecondary" size="composerSm" title="关闭状态与用量" onClick={onClose}>
          关闭
        </Button>
      </div>

      <div className="composer-status-content tw:grid tw:gap-3 tw:px-3 tw:pb-3">
        {/* Session ID */}
        <div
          className={`${SECTION_CLASS} composer-status-field tw:flex tw:min-w-0 tw:items-center tw:gap-3`}
        >
          <div className="composer-status-label tw:w-[7.5rem] tw:shrink-0 tw:text-app-text-meta tw:type-label tw:[&>svg]:size-[var(--inline-icon-size,1em)]">
            会话 ID
          </div>
          <div className="composer-status-value tw:min-w-0 tw:flex-1 tw:break-all tw:text-app-text tw:type-code">
            {routedSessionId ?? '尚未创建会话'}
          </div>
        </div>

        {/* Context Usage */}
        {contextUsage ? (
          <div className={SECTION_CLASS}>
            <ContextUsageStatusPanel contextUsage={contextUsage} />
          </div>
        ) : null}

        {/* Quota section */}
        {showQuotaSection ? (
          <div className={SECTION_CLASS}>
            {loading ? (
              <div className="composer-status-empty tw:py-2 tw:text-app-text-meta tw:type-secondary">
                正在查询用量...
              </div>
            ) : error ? (
              <div className="composer-status-empty composer-status-empty-error tw:py-2 tw:text-app-danger tw:type-secondary">
                {error}
              </div>
            ) : quotas.length > 0 ? (
              quotas.map(renderQuotaRow)
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
