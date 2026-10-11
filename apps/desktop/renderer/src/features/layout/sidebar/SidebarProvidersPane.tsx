import type React from 'react'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BrainCircuit } from 'lucide-react'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import {
  projectProviderDirectory,
  updateModelCenterSearchParams,
  type ProviderCatalogFilter,
  type ProviderConnectionStatus,
} from '../../models/ModelCenterState.js'
import { ProviderIcon } from '../../models/ProviderIcon.js'
import { useProviderManagementSnapshot } from '../../provider-management/index.js'
import { SidebarEmptyRow, SidebarRow } from './SidebarRow.js'

const FILTERS: ReadonlyArray<{ value: ProviderCatalogFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'configured', label: '已配置' },
  { value: 'unconfigured', label: '未配置' },
]

const CONNECTION_STATUS_LABELS: Record<ProviderConnectionStatus, string> = {
  'stored-key': '已保存 Key',
  oauth: 'OAuth',
  environment: '环境变量',
  configured: '已配置',
  unconfigured: '未配置',
}

/**
 * 侧栏供应商面板：复用供应商 store 与目录投影函数，
 * 只负责搜索、筛选和选择；搜索与筛选保持本地状态，不写入 URL、不影响默认聊天模型。
 */
export function SidebarProvidersPane(): React.ReactNode {
  const { t } = useLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const snapshot = useProviderManagementSnapshot()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ProviderCatalogFilter>('all')
  const onProvidersRoute = location.pathname === '/providers'
  const selectedProviderId = onProvidersRoute ? searchParams.get('provider') : null

  const items = useMemo(
    () =>
      projectProviderDirectory(
        [...snapshot.providers].sort((left, right) =>
          left.displayName.localeCompare(right.displayName, 'zh-CN', {
            numeric: true,
            sensitivity: 'base',
          }),
        ),
        {
          query,
          filter,
          currentProviderId: snapshot.currentProviderState?.selectedProviderID,
          currentProviderState: snapshot.currentProviderState,
          apiKeys: snapshot.apiKeys,
          credentials: snapshot.credentials,
        },
      ),
    [filter, query, snapshot],
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
    <div className="sidebar-providers-pane tw:flex tw:h-full tw:min-h-0 tw:flex-col">
      <div className="sidebar-pane-heading tw:flex tw:min-h-9 tw:shrink-0 tw:items-center tw:justify-between tw:px-3">
        <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">{t('供应商')}</h2>
      </div>
      <div className="sidebar-pane-filters tw:flex tw:flex-col tw:gap-2 tw:p-2">
        <SearchInput
          aria-label={t('搜索供应商')}
          onChange={setQuery}
          placeholder={t('搜索供应商名称或 ID')}
          value={query}
        />
        <SegmentedControl<ProviderCatalogFilter>
          ariaLabel={t('供应商筛选')}
          onChange={setFilter}
          options={FILTERS.map((option) => ({ ...option, label: t(option.label) }))}
          value={filter}
        />
      </div>
      <ScrollArea className="sidebar-providers-scroll tw:min-h-0 tw:flex-1 tw:p-2">
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
          <SidebarEmptyRow>{t('没有匹配的供应商')}</SidebarEmptyRow>
        ) : (
          items.map((item) => {
            const provider = item.provider
            const selected = provider.providerID === selectedProviderId
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
                  <span className="sidebar-provider-status tw:shrink-0 tw:text-app-text-meta tw:type-caption">
                    {t(CONNECTION_STATUS_LABELS[item.connectionStatus])}
                  </span>
                </button>
              </SidebarRow>
            )
          })
        )}
      </ScrollArea>
    </div>
  )
}
