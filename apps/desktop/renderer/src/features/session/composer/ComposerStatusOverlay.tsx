import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import type React from 'react'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { ChatInputDropdown } from './ChatInputDropdown.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { cx } from '../../../utils/Cx.js'
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
import { ContextUsagePanel } from './ContextUsagePanel.js'

type Props = {
  open: boolean
  onClose: () => void
  routedSessionId: string | null
  contextUsage: DesktopContextUsage | null
  selectedProviderID?: ModelProviderID
  side?: 'top' | 'bottom'
}

/*
 * `composer-status-bar-fill` keeps its scaleX/transform-origin/transition in
 * `src/styles/features/_composer-status.scss`: the animation contract in
 * `scripts/CheckStyleContracts.ts` pins that rule to a transform-only,
 * compositor-safe transition.
 */
const SECTION_CLASS = cx(
  'composer-status-section tw:px-4 tw:py-3',
  'tw:[&+&]:border-t tw:[&+&]:border-app-border',
)

function renderQuotaRow(quota: ProviderQuotaWindow): React.ReactNode {
  const percent = quotaRemainingPercent(quota)
  return (
    <div className="composer-status-quota-row tw:[&+&]:mt-2" key={quota.id}>
      <div className="composer-status-label tw:mb-1 tw:text-app-text-meta tw:type-label tw:[&>svg]:size-icon-sm">
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
  open,
  onClose,
  routedSessionId,
  contextUsage,
  selectedProviderID,
  side = 'top',
}: Props): React.ReactNode {
  const [usageSource, setUsageSource] = useState<ProviderUsageSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !selectedProviderID) return
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
  }, [open, selectedProviderID])

  const quotas = criticalQuotaWindows(usageSource, 3)

  return (
    <ChatInputDropdown open={open} onClose={onClose} side={side} size="lg">
      <div className="composer-status-content tw:p-0">
        {/* Header */}
        <div className="composer-status-header tw:flex tw:items-center tw:justify-between tw:border-b tw:border-app-border tw:px-4 tw:pt-3 tw:pb-2">
          <span className="composer-status-title tw:type-row-title">状态</span>
          <button
            className="composer-status-close tw:inline-flex tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-1 tw:text-app-text tw:hover:bg-app-hover"
            onClick={onClose}
            type="button"
            aria-label="关闭"
          >
            <X size={APP_ICON_SIZES.sm} />
          </button>
        </div>

        {/* Session ID */}
        <div className={SECTION_CLASS}>
          <div className="composer-status-label tw:mb-1 tw:text-app-text-meta tw:type-label tw:[&>svg]:size-icon-sm">
            会话 ID
          </div>
          <div className="composer-status-value tw:break-all tw:text-app-text tw:type-code">
            {routedSessionId ?? '尚未创建会话'}
          </div>
        </div>

        {/* Context Usage */}
        <div className={SECTION_CLASS}>
          <ContextUsagePanel contextUsage={contextUsage} />
        </div>

        {/* Quota section */}
        {selectedProviderID ? (
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
            ) : (
              <div className="composer-status-empty tw:py-2 tw:text-app-text-meta tw:type-secondary">
                当前提供商未返回用量数据
              </div>
            )}
          </div>
        ) : null}
      </div>
    </ChatInputDropdown>
  )
}
