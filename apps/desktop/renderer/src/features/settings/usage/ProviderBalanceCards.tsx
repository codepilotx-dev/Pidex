import type React from 'react'
import { formatAmount, type ProviderBalance } from '../../../utils/UsageFormatters.js'

/**
 * 账户余额卡片：用量页与供应商连接页共用同一套 `.provider-balances` 样式和金额格式化，
 * 未知余额不渲染为 0，只在上游确认存在余额时展示。
 */
export function ProviderBalanceCards({
  balances,
}: {
  balances: readonly ProviderBalance[]
}): React.ReactNode {
  if (balances.length === 0) return null
  return (
    <div aria-label="账户余额" className="provider-balances" role="group">
      {balances.map((balance) => (
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
  )
}
