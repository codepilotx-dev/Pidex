import { Server } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import type { ModelProviderID } from '../../../shared/Types.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { ProviderIcon } from './ProviderIcon.js'

export const PROVIDER_DETAIL_TABS = ['connection', 'models'] as const
export type ProviderDetailTab = (typeof PROVIDER_DETAIL_TABS)[number]
export type ProviderDetailStatusTone = 'positive' | 'warning' | 'danger' | 'neutral'

export type ProviderDetailIdentity = {
  id: ModelProviderID
  name: string
  logoURL?: string
  description?: string
  status: {
    label: string
    tone: ProviderDetailStatusTone
  }
}

export type ProviderDetailProps = {
  provider: ProviderDetailIdentity
  activeTab: ProviderDetailTab
  onTabChange: (tab: ProviderDetailTab) => void
  onBack?: () => void
  actions?: React.ReactNode
  feedback?: React.ReactNode
  children: React.ReactNode
}

const TAB_OPTIONS: ReadonlyArray<{ value: ProviderDetailTab; label: string }> = [
  { value: 'connection', label: '连接与凭据' },
  { value: 'models', label: '模型与测速' },
]

export function ProviderDetail({
  provider,
  activeTab,
  onTabChange,
  actions,
  feedback,
  children,
}: ProviderDetailProps): React.ReactNode {
  const panelId = useId()

  return (
    <section
      className="model-center-provider-detail tw:grid tw:min-w-0 tw:gap-3"
      aria-label={`${provider.name} 详情`}
    >
      <header className="model-center-provider-detail-header tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-4 tw:p-0 tw:@max-[720px]:flex-col tw:@max-[720px]:items-stretch">
        <div className="model-center-provider-identity tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-3 tw:@max-[720px]:w-full">
          {provider.logoURL ? (
            <ProviderIcon
              className="model-center-provider-identity-logo tw:inline-flex tw:size-3.5 tw:shrink-0 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-md tw:bg-app-editor tw:text-app-text-soft"
              fallback={<Server aria-hidden size={14} data-icon-kind="artwork" strokeWidth={2} />}
              logoURL={provider.logoURL}
            />
          ) : (
            <span className="model-center-provider-identity-logo tw:inline-flex tw:size-3.5 tw:shrink-0 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-md tw:bg-app-editor tw:text-app-text-soft">
              <Server aria-hidden size={14} data-icon-kind="artwork" strokeWidth={2} />
            </span>
          )}
          <div className="model-center-provider-identity-copy tw:grid tw:min-w-0 tw:gap-1">
            <div className="model-center-provider-identity-heading tw:flex tw:min-w-0 tw:items-center tw:gap-2">
              <h2 className="tw:m-0 tw:min-w-0 tw:overflow-hidden tw:text-app-text tw:type-title-xl tw:text-ellipsis tw:whitespace-nowrap">
                {provider.name}
              </h2>
              <span
                className="model-center-provider-status tw:inline-flex tw:items-center tw:gap-1 tw:text-app-text-soft tw:type-caption tw:whitespace-nowrap tw:data-[tone=positive]:text-app-success tw:data-[tone=healthy]:text-app-success tw:data-[tone=success]:text-app-success tw:data-[tone=warning]:text-app-danger tw:data-[tone=danger]:text-app-danger"
                data-tone={provider.status.tone}
              >
                {provider.status.label}
              </span>
            </div>
            <p className="tw:m-0 tw:overflow-hidden tw:text-app-text-meta tw:type-caption tw:text-ellipsis tw:whitespace-nowrap">
              {provider.description ?? provider.id}
            </p>
          </div>
        </div>

        {actions ? (
          <div className="model-center-provider-context-actions tw:inline-flex tw:shrink-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:@max-[720px]:w-full tw:@max-[720px]:justify-start tw:@max-[720px]:[&>*]:flex-auto">
            {actions}
          </div>
        ) : null}
      </header>

      <div className="model-center-provider-tab-bar tw:flex tw:items-center tw:py-1">
        <SegmentedControl<ProviderDetailTab>
          ariaLabel="供应商详情功能切换"
          className="model-center-provider-segmented-tabs"
          getPanelId={(tab) => `${panelId}-panel-${tab}`}
          getTabId={(tab) => `${panelId}-tab-${tab}`}
          onChange={onTabChange}
          options={TAB_OPTIONS}
          overflowMode="fit"
          semantics="tabs"
          value={activeTab}
        />
      </div>

      {feedback ? (
        <div
          className="model-center-provider-feedback tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-4 tw:py-3 tw:text-app-text-soft tw:type-body-sm"
          role="status"
        >
          {feedback}
        </div>
      ) : null}

      <div
        aria-labelledby={`${panelId}-tab-${activeTab}`}
        className="model-center-provider-panel tw:grid tw:min-w-0 tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus tw:forced-colors:focus-visible:shadow-none tw:forced-colors:focus-visible:outline-2 tw:forced-colors:focus-visible:outline-offset-[-2px] tw:forced-colors:focus-visible:outline-[color:Highlight]"
        id={`${panelId}-panel-${activeTab}`}
        role="tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  )
}
