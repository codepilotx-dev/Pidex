import type React from 'react'
import { InfoTooltip } from '../../../components/ui/Tooltip.js'
import { formatAmount, type ProviderBalance } from '../../../utils/UsageFormatters.js'

/**
 * 账户余额卡片：用量页与供应商连接页共用同一套 `.provider-balances` 样式和金额格式化，
 * 未知余额不渲染为 0，只在上游确认存在余额时展示。
 */
export function ProviderBalanceCards({
  balances,
  compact = false,
  accountName,
}: {
  balances: readonly ProviderBalance[]
  compact?: boolean
  accountName?: string
}): React.ReactNode {
  if (balances.length === 0) return null
  return (
    <div aria-label="账户余额" className="provider-balances" role="group">
      {balances.map((balance) =>
        compact ? (
          <div
            className="provider-balance-card tw:flex tw:flex-wrap tw:items-baseline tw:justify-between tw:gap-x-4 tw:gap-y-2"
            key={balance.currency}
          >
            {accountName ? (
              <h4 className="tw:m-0 tw:shrink-0 tw:type-row-title">{accountName}</h4>
            ) : null}
            <div className="tw:flex tw:flex-wrap tw:items-baseline tw:justify-end tw:gap-x-2 tw:gap-y-1 tw:type-body">
              <span>账户余额</span>
              <strong className="tw:tabular-nums">
                {formatAmount(balance.currency, balance.total)}
              </strong>
              {balance.components?.length ? (
                <InfoTooltip
                  ariaLabel="余额明细"
                  content={<span>
                    （含{balance.components.map((component, index) => (
                      <span key={component.label}>
                        {index > 0 ? ' ' : ''}{component.label}{' '}
                        <strong className="tw:tabular-nums">{formatAmount(balance.currency, component.amount)}</strong>
                      </span>
                    ))}）
                  </span>}
                />
              ) : null}
            </div>
          </div>
        ) : (
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
        ),
      )}
    </div>
  )
}
