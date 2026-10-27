import { Link2, Server, Settings } from 'lucide-react'
import type React from 'react'
import type { ModelProviderID } from '../../../shared/Types.js'
import { Button } from '../../components/ui/Button.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { ProviderIcon } from './ProviderIcon.js'

export type ProviderCatalogItem = {
  id: ModelProviderID
  name: string
  logoURL?: string
  source: string
  modelCount: number
  current: boolean
  canAddConnection: boolean
  connectionDisabled?: boolean
}

export type ProviderCatalogProps = {
  providers: readonly ProviderCatalogItem[]
  onSelect: (providerId: ModelProviderID) => void
  onAddConnection: (providerId: ModelProviderID) => void
  onManageConnection: (providerId: ModelProviderID) => void
}

export function ProviderCatalog({
  providers,
  onSelect,
  onAddConnection,
  onManageConnection,
}: ProviderCatalogProps): React.ReactNode {
  const configuredProviders = providers.filter((p) => !p.canAddConnection)
  const unconfiguredProviders = providers.filter((p) => p.canAddConnection)

  const groups = [
    { id: 'configured', label: '已配置', items: configuredProviders },
    { id: 'unconfigured', label: '未配置', items: unconfiguredProviders },
  ].filter((group) => group.items.length > 0)

  return (
    <section className="model-center-catalog tw:grid tw:min-w-0 tw:gap-4" aria-label="供应商市场">
      {providers.length === 0 ? (
        <div className="tw:grid tw:min-h-[220px] tw:place-content-center tw:gap-2 tw:text-center tw:text-app-text-soft tw:type-body-sm">
          <strong>暂无可用供应商</strong>
          <span>请刷新供应商目录后重试。</span>
        </div>
      ) : (
        <div className="model-center-catalog-groups tw:grid tw:gap-6">
          {groups.map((group) => (
            <section
              className="model-center-catalog-group tw:grid tw:min-w-0 tw:gap-3"
              key={group.id}
            >
              <header className="model-center-catalog-group-header tw:flex tw:items-center tw:gap-3">
                <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">{group.label}</h2>
              </header>
              <div className="model-center-catalog-list tw:grid tw:grid-cols-2 tw:min-w-0 tw:gap-x-7 tw:gap-y-4 tw:@max-[580px]:grid-cols-1">
                {group.items.map((provider) => {
                  const actionLabel = provider.connectionDisabled
                    ? '不可用'
                    : provider.canAddConnection
                      ? '连接'
                      : '查看'
                  const actionTitle = provider.connectionDisabled
                    ? '不可用'
                    : `${actionLabel} ${provider.name}`
                  return (
                    <article
                      className="provider-card tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:min-w-0 tw:items-center tw:gap-3 tw:rounded-item tw:border-0 tw:bg-transparent tw:p-3 tw:shadow-none tw:transition-[background-color] tw:duration-state tw:ease-standard tw:hover:bg-app-hover tw:data-[unavailable=true]:opacity-68"
                      data-current={provider.current || undefined}
                      data-unavailable={provider.connectionDisabled || undefined}
                      key={provider.id}
                    >
                      <button
                        aria-label={`查看 ${provider.name}`}
                        className="provider-card-main tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-3 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus"
                        type="button"
                        onClick={() => onSelect(provider.id)}
                      >
                        <span className="provider-card-logo settings-management-row-icon">
                          <ProviderIcon
                            fallback={
                              <Server
                                aria-hidden
                                size={APP_ICON_SIZE}
                                strokeWidth={APP_ICON_STROKE_WIDTH}
                              />
                            }
                            imageClassName="tw:object-contain tw:[.dark-theme_&]:invert tw:[.dark-theme_&]:hue-rotate-180"
                            logoURL={provider.logoURL}
                            providerID={provider.id}
                          />
                        </span>
                        <span className="tw:grid tw:min-w-0 tw:gap-1">
                          <strong
                            className="tw:overflow-hidden tw:text-app-text tw:type-row-title tw:text-ellipsis tw:whitespace-nowrap"
                            title={provider.name}
                          >
                            {provider.name}
                          </strong>
                          <span className="tw:min-w-0 tw:overflow-hidden tw:text-app-text-meta tw:type-body-sm tw:text-ellipsis tw:whitespace-nowrap">
                            {provider.modelCount} 个模型
                          </span>
                        </span>
                      </button>
                      <Tooltip content={actionTitle}>
                        <span className="tw:inline-flex">
                          <Button
                            aria-label={actionTitle}
                            color="ghostSecondary"
                            disabled={provider.connectionDisabled}
                            isIconOnly
                            size="toolbar"
                            title={actionTitle}
                            onClick={() =>
                              provider.canAddConnection
                                ? onAddConnection(provider.id)
                                : onManageConnection(provider.id)
                            }
                          >
                            {provider.canAddConnection ? (
                              <Link2
                                aria-hidden
                                size={APP_ICON_SIZE}
                                strokeWidth={APP_ICON_STROKE_WIDTH}
                              />
                            ) : (
                              <Settings
                                aria-hidden
                                size={APP_ICON_SIZE}
                                strokeWidth={APP_ICON_STROKE_WIDTH}
                              />
                            )}
                          </Button>
                        </span>
                      </Tooltip>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
