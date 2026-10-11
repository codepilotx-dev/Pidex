import { Link2, Server, KeyRound, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react'
import type React from 'react'
import type { ModelProviderID } from '../../../shared/Types.js'
import { Button } from '../../components/ui/Button.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'
import { ProviderIcon } from './ProviderIcon.js'
import type { ProviderCatalogFilter } from './ModelCenterState.js'

export type ProviderCatalogStatusTone = 'positive' | 'warning' | 'danger' | 'neutral'

export type ProviderCatalogItem = {
  id: ModelProviderID
  name: string
  logoURL?: string
  source: string
  modelCount: number
  current: boolean
  canAddConnection: boolean
  connectionDisabled?: boolean
  keyCount?: number
  hasOAuth?: boolean
  healthTone?: 'healthy' | 'warning' | 'neutral'
  status: {
    label: string
    tone: ProviderCatalogStatusTone
  }
}

export type ProviderCatalogProps = {
  providers: readonly ProviderCatalogItem[]
  query: string
  onQueryChange: (query: string) => void
  filter?: ProviderCatalogFilter
  onFilterChange?: (filter: ProviderCatalogFilter) => void
  onSelect: (providerId: ModelProviderID) => void
  onAddConnection: (providerId: ModelProviderID) => void
  onManageConnection: (providerId: ModelProviderID) => void
}

/* 供应商卡片上的状态徽章：胶囊形、按 `data-tone` 选择状态族配色。 */
const PROVIDER_CARD_BADGE_CLASS =
  'provider-card-badge tw:min-w-0 tw:overflow-hidden tw:rounded-full tw:px-2 tw:py-1 tw:type-caption tw:text-ellipsis tw:whitespace-nowrap tw:data-[tone=info]:bg-app-accent-subtle tw:data-[tone=info]:text-app-accent-fg tw:data-[tone=neutral]:bg-app-editor tw:data-[tone=neutral]:text-app-text-soft tw:data-[tone=positive]:bg-app-success-subtle tw:data-[tone=positive]:text-app-success tw:data-[tone=warning]:bg-app-danger-subtle tw:data-[tone=warning]:text-app-danger tw:data-[tone=danger]:bg-app-danger-subtle tw:data-[tone=danger]:text-app-danger'

/* 供应商标识槽内的远端图片：等比缩放，暗色主题反相以保持品牌图形可读。 */
const PROVIDER_CARD_LOGO_IMAGE_CLASS =
  'tw:object-contain tw:[.dark-theme_&]:invert tw:[.dark-theme_&]:hue-rotate-180'

export function ProviderCatalog({
  providers,
  query,
  onQueryChange,
  filter = 'all',
  onFilterChange,
  onSelect,
  onAddConnection,
  onManageConnection,
}: ProviderCatalogProps): React.ReactNode {
  return (
    <section className="model-center-catalog tw:grid tw:min-w-0 tw:gap-4" aria-label="供应商目录">
      <div className="model-center-catalog-toolbar settings-management-toolbar tw:flex tw:min-w-0 tw:items-center tw:justify-start tw:gap-3 tw:@max-[900px]:items-stretch">
        <SearchInput
          aria-label="搜索 Provider"
          className="model-center-catalog-search tw:min-w-0 tw:w-[min(360px,100%)] tw:flex-1 tw:@max-[720px]:w-full"
          onChange={onQueryChange}
          placeholder="搜索供应商名称、ID 或模型"
          value={query}
        />
        {onFilterChange ? (
          <SegmentedControl<ProviderCatalogFilter>
            ariaLabel="供应商筛选"
            className="model-center-catalog-filter tw:@max-[900px]:self-start"
            onChange={onFilterChange}
            options={[
              { value: 'all', label: '全部' },
              { value: 'configured', label: '已配置' },
              { value: 'unconfigured', label: '未配置' },
            ]}
            value={filter}
          />
        ) : null}
        <span className="model-center-catalog-count tw:flex-none tw:rounded-full tw:bg-app-editor tw:px-2 tw:py-1 tw:text-app-text-meta tw:type-caption tw:whitespace-nowrap tw:@max-[900px]:self-start">
          {providers.length} 个
        </span>
      </div>

      {providers.length === 0 ? (
        <div className="model-center-catalog-empty tw:grid tw:min-h-[220px] tw:content-center tw:place-items-center tw:gap-2 tw:rounded-xl tw:border tw:border-dashed tw:border-app-border tw:bg-app-panel tw:p-7 tw:text-center tw:text-app-text-soft tw:shadow-none tw:[&>svg]:mb-1 tw:[&>svg]:text-app-text-meta tw:[&>strong]:text-app-text tw:[&>strong]:type-title-sm tw:[&>span]:type-body-sm">
          <Server aria-hidden size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <strong>没有匹配的供应商</strong>
          <span>尝试调整搜索关键词或筛选条件。</span>
        </div>
      ) : (
        <div className="model-center-catalog-list settings-management-list tw:grid tw:@max-[900px]:grid-cols-1">
          {providers.map((provider) => {
            const hasKeys = (provider.keyCount ?? 0) > 0
            return (
              <article
                className="provider-card settings-management-row tw:data-[unavailable=true]:opacity-68"
                data-current={provider.current || undefined}
                data-unavailable={provider.connectionDisabled || undefined}
                key={provider.id}
              >
                <button
                  aria-current={provider.current ? 'page' : undefined}
                  className="provider-card-main settings-management-row-main tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-[color-mix(in_srgb,var(--cpx-sys-color-accent)_72%,transparent)] tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-soft)] tw:@max-[720px]:grid-cols-[auto_minmax(0,1fr)]"
                  type="button"
                  onClick={() => onSelect(provider.id)}
                >
                  <span className="provider-card-logo settings-management-row-icon">
                    {provider.logoURL ? (
                      <ProviderIcon
                        fallback={
                          <Server aria-hidden size={14} data-icon-kind="artwork" strokeWidth={2} />
                        }
                        imageClassName={PROVIDER_CARD_LOGO_IMAGE_CLASS}
                        logoURL={provider.logoURL}
                      />
                    ) : (
                      <Server aria-hidden size={14} data-icon-kind="artwork" strokeWidth={2} />
                    )}
                  </span>
                  <span className="provider-card-copy settings-management-row-copy">
                    <span className="provider-card-heading tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                      <strong className="settings-management-row-title" title={provider.name}>
                        {provider.name}
                      </strong>
                      {provider.current ? (
                        <span className="provider-card-current tw:rounded-full tw:bg-app-accent-subtle tw:px-2 tw:py-1 tw:text-app-accent-fg tw:type-label tw:whitespace-nowrap">
                          当前
                        </span>
                      ) : null}
                    </span>
                    <span className="provider-card-meta settings-management-row-description tw:flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-app-text-meta tw:type-caption">
                      <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                        {provider.modelCount} 个模型
                      </span>
                      {hasKeys ? (
                        <span className={PROVIDER_CARD_BADGE_CLASS} data-tone="info">
                          {provider.keyCount} 个 Key
                        </span>
                      ) : provider.hasOAuth ? (
                        <span className={PROVIDER_CARD_BADGE_CLASS} data-tone="info">
                          OAuth 已连接
                        </span>
                      ) : (
                        <span
                          className={PROVIDER_CARD_BADGE_CLASS}
                          data-tone={provider.status.tone}
                        >
                          {provider.status.label}
                        </span>
                      )}
                    </span>
                  </span>
                  {provider.healthTone === 'healthy' ? (
                    <span
                      className="provider-card-health-indicator tw:ml-auto tw:inline-flex tw:items-center tw:justify-center tw:pr-2 tw:data-[tone=healthy]:text-app-success tw:data-[tone=warning]:text-app-warning"
                      data-tone="healthy"
                      title="凭据健康"
                    >
                      <CheckCircle2 size={APP_ICON_SIZES.sm} aria-hidden />
                    </span>
                  ) : provider.healthTone === 'warning' ? (
                    <span
                      className="provider-card-health-indicator tw:ml-auto tw:inline-flex tw:items-center tw:justify-center tw:pr-2 tw:data-[tone=healthy]:text-app-success tw:data-[tone=warning]:text-app-warning"
                      data-tone="warning"
                      title="凭据异常"
                    >
                      <AlertTriangle size={APP_ICON_SIZES.sm} aria-hidden />
                    </span>
                  ) : null}
                </button>
                <span className="settings-management-row-actions">
                  <Button
                    color="secondary"
                    className="provider-card-connection-action tw:flex-none tw:self-center"
                    disabled={provider.connectionDisabled}
                    onClick={() =>
                      provider.canAddConnection
                        ? onAddConnection(provider.id)
                        : onManageConnection(provider.id)
                    }
                  >
                    <Link2 aria-hidden size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    {provider.connectionDisabled
                      ? '不可用'
                      : provider.canAddConnection
                        ? '连接'
                        : '查看'}
                  </Button>
                </span>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
