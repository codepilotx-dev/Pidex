import type React from 'react'
import { useMemo, useState } from 'react'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { SearchHeading } from '../../../components/ui/SearchHeading.js'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BrainCircuit, Plus, Store } from 'lucide-react'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import {
  isConfiguredProviderDirectoryItem,
  projectProviderDirectory,
  updateModelCenterSearchParams,
} from '../../models/ModelCenterState.js'
import { ProviderIcon } from '../../models/ProviderIcon.js'
import { useProviderManagementSnapshot } from '../../provider-management/index.js'
import { SidebarEmptyRow, SidebarRow } from './SidebarRow.js'

export function SidebarProvidersPane(): React.ReactNode {
  const { t } = useLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const snapshot = useProviderManagementSnapshot()
  const [query, setQuery] = useState('')
  const onProvidersRoute = location.pathname === '/providers'
  const selectedProviderId = onProvidersRoute ? searchParams.get('provider') : null
  const creatingProvider = onProvidersRoute && searchParams.get('newProvider') === '1'
  const onMarketRoute = onProvidersRoute && !selectedProviderId && !creatingProvider
  const items = useMemo(
    () =>
      projectProviderDirectory(snapshot.providers, {
        query,
        currentProviderId: snapshot.currentProviderState?.selectedProviderID,
        currentProviderState: snapshot.currentProviderState,
        apiKeys: snapshot.apiKeys,
        credentials: snapshot.credentials,
      }).sort((left, right) =>
        left.provider.displayName.localeCompare(right.provider.displayName, 'zh-CN', {
          numeric: true,
          sensitivity: 'base',
        }),
      ),
    [snapshot, query],
  )

  function selectProvider(providerId: string): void {
    const next = updateModelCenterSearchParams(
      onProvidersRoute ? searchParams : new URLSearchParams(),
      { providerId, section: 'connection' },
    )
    navigate(`/providers?${next.toString()}`)
  }

  const loading = !snapshot.loaded && snapshot.loading
  const error = snapshot.error && snapshot.providers.length === 0 ? snapshot.error : null

  return (
    <div className="sidebar-providers-pane tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:py-2">
      <header className="sidebar-pane-heading tw:flex tw:min-h-9 tw:shrink-0 tw:items-center tw:justify-between tw:gap-2 tw:px-3">
        <SearchHeading
          title={<h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">{t('供应商')}</h2>}
          search={
            <SearchInput
              variant="outlined"
              aria-label={t('搜索供应商')}
              placeholder={t('搜索供应商')}
              value={query}
              onChange={setQuery}
            />
          }
        />
      </header>
      <div className="tw:flex tw:shrink-0 tw:flex-col tw:sidebar-row-gap tw:p-2">
        <SidebarRow
          active={onMarketRoute}
          asChild
          layout="flex"
          leading={<Store aria-hidden size={APP_ICON_SIZE} />}
        >
          <button
            type="button"
            aria-current={onMarketRoute ? 'page' : undefined}
            onClick={() => navigate('/providers')}
          >
            {t('市场')}
          </button>
        </SidebarRow>
        <SidebarRow
          active={creatingProvider}
          asChild
          layout="flex"
          leading={<Plus aria-hidden size={APP_ICON_SIZE} />}
        >
          <button
            type="button"
            aria-current={creatingProvider ? 'page' : undefined}
            onClick={() => navigate('/providers?newProvider=1')}
          >
            {t('新建供应商')}
          </button>
        </SidebarRow>
      </div>
      <ScrollArea
        className="sidebar-providers-scroll tw:min-h-0 tw:flex-1 tw:px-2 tw:pb-2 tw:pt-0"
        contentClassName="tw:flex tw:flex-col tw:gap-4"
      >
        {loading ? (
          <SidebarEmptyRow role="status">{t('正在加载供应商…')}</SidebarEmptyRow>
        ) : error ? (
          <div
            className="sidebar-pane-error tw:p-2 tw:text-app-text-soft tw:type-body-sm"
            role="status"
          >
            {error}
          </div>
        ) : items.length === 0 ? (
          <SidebarEmptyRow>{t('暂无供应商')}</SidebarEmptyRow>
        ) : (
          [true, false].map((configured) => (
            <div key={String(configured)} className="tw:flex tw:flex-col tw:sidebar-row-gap">
              <h3 className="tw:m-0 tw:flex tw:min-h-[var(--sidebar-row-height)] tw:items-center tw:px-2 tw:text-app-text-meta tw:type-body">
                {t(configured ? '已配置' : '未配置')}
              </h3>
              {items
                .filter((item) => isConfiguredProviderDirectoryItem(item) === configured)
                .map(({ provider }) => {
                  const selected = !creatingProvider && provider.providerID === selectedProviderId
                  return (
                    <SidebarRow
                      active={selected}
                      asChild
                      className="sidebar-nav-link tw:type-row-title tw:focus-visible:outline-2 tw:focus-visible:outline-offset-0 tw:focus-visible:outline-app-focus"
                      key={provider.providerID}
                      labelClassName="sidebar-item-label tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
                      layout="flex"
                      leading={
                        <span className="tw:flex tw:size-4 tw:shrink-0 tw:items-center tw:justify-center">
                          <ProviderIcon
                            fallback={<BrainCircuit aria-hidden size={APP_ICON_SIZE} />}
                            imageClassName="tw:object-contain tw:[.dark-theme_&]:invert tw:[.dark-theme_&]:hue-rotate-180"
                            logoURL={provider.logoURL}
                          />
                        </span>
                      }
                    >
                      <button
                        aria-current={selected ? 'page' : undefined}
                        onClick={() => selectProvider(provider.providerID)}
                        type="button"
                      >
                        <span className="sidebar-provider-name tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                          {provider.displayName}
                        </span>
                      </button>
                    </SidebarRow>
                  )
                })}
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  )
}
