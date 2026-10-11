import type React from 'react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Blocks, Search } from 'lucide-react'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { Input } from '../../../components/ui/Input.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import {
  PLUGIN_CATALOG_DESCRIPTORS,
  filterPluginCatalog,
  mergePluginCatalog,
  pluginStatusLabel,
  type PluginStatusFilter,
} from '../../plugins/PluginCatalog.js'
import { catalogBrowseParams, type CatalogTab } from '../../plugins/CatalogDetailsDeepLink.js'
import { useMiniMaxCli } from '../../plugins/UseMiniMaxCli.js'
import { usePluginCatalog } from '../../plugins/UsePluginCatalog.js'
import { SidebarEmptyRow, SidebarRow } from './SidebarRow.js'

const CATALOG_TABS: ReadonlyArray<{ value: CatalogTab; label: string }> = [
  { value: 'plugins', label: '插件' },
  { value: 'skills', label: '技能' },
]

const STATUS_FILTERS: ReadonlyArray<{ value: PluginStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已禁用' },
]

/**
 * 侧栏插件面板：复用现有插件目录与过滤函数，目录只加载一次，
 * 查询、分类、状态通过 URL 参数与 /plugins 页面共享。
 */
export function SidebarPluginsPane({
  workspacePath,
}: {
  workspacePath: string | null
}): React.ReactNode {
  const { t } = useLocale()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const tab: CatalogTab = searchParams.get('tab') === 'skills' ? 'skills' : 'plugins'
  const status = (searchParams.get('status') as PluginStatusFilter | null) ?? 'all'
  const { plugins, error, loading } = usePluginCatalog(workspacePath)
  const miniMaxCli = useMiniMaxCli()

  const items = useMemo(
    () =>
      mergePluginCatalog(PLUGIN_CATALOG_DESCRIPTORS, plugins, error, {
        status: miniMaxCli.status,
        loading: miniMaxCli.loading,
        unsupported: miniMaxCli.unsupported,
        error: miniMaxCli.error,
      }),
    [
      error,
      miniMaxCli.error,
      miniMaxCli.loading,
      miniMaxCli.status,
      miniMaxCli.unsupported,
      plugins,
    ],
  )
  const visibleItems = useMemo(
    () => filterPluginCatalog(items, query, 'all', status),
    [items, query, status],
  )

  function updateParams(patch: {
    q?: string
    status?: PluginStatusFilter
    tab?: CatalogTab
  }): void {
    const next = catalogBrowseParams(searchParams, patch.tab ?? tab)
    if (patch.q !== undefined) {
      if (patch.q) next.set('q', patch.q)
      else next.delete('q')
    }
    if (patch.status !== undefined) {
      if (patch.status === 'all') next.delete('status')
      else next.set('status', patch.status)
    }
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="sidebar-plugins-pane tw:flex tw:h-full tw:min-h-0 tw:flex-col">
      <div className="sidebar-pane-heading tw:flex tw:min-h-9 tw:shrink-0 tw:items-center tw:justify-between tw:px-3">
        <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">{t('插件')}</h2>
      </div>
      <div className="sidebar-pane-filters tw:flex tw:flex-col tw:gap-2 tw:p-2">
        <Input
          aria-label={t('搜索插件')}
          placeholder={t('搜索插件与技能')}
          size="sm"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            updateParams({ q: event.target.value })
          }}
        />
        <SegmentedControl
          ariaLabel={t('目录类型')}
          options={CATALOG_TABS.map((option) => ({ ...option, label: t(option.label) }))}
          value={tab}
          onChange={(next) => updateParams({ tab: next })}
        />
        <SegmentedControl
          ariaLabel={t('插件状态')}
          options={STATUS_FILTERS.map((option) => ({ ...option, label: t(option.label) }))}
          value={status}
          onChange={(next) => updateParams({ status: next })}
        />
      </div>
      <ScrollArea className="sidebar-scheduled-scroll tw:min-h-0 tw:flex-1 tw:p-2">
        {loading ? (
          <SidebarEmptyRow role="status">{t('正在加载插件…')}</SidebarEmptyRow>
        ) : error ? (
          <div
            className="sidebar-pane-error tw:p-2 tw:text-app-text-soft tw:type-body-sm"
            role="status"
          >
            {error}
          </div>
        ) : visibleItems.length === 0 ? (
          <SidebarEmptyRow>{t('没有匹配的插件')}</SidebarEmptyRow>
        ) : (
          visibleItems.map((item) => (
            <SidebarRow
              asChild
              className="sidebar-nav-link tw:type-row-title tw:focus-visible:outline-2 tw:focus-visible:outline-offset-0 tw:focus-visible:outline-app-focus"
              key={item.id}
              labelClassName="sidebar-item-label tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
              layout="flex"
              leading={<Blocks size={APP_ICON_SIZE} />}
            >
              <button
                onClick={() => {
                  const next = catalogBrowseParams(searchParams, 'plugins')
                  next.set('plugin', item.id)
                  navigate(`/plugins?${next.toString()}`)
                }}
                type="button"
              >
                <span className="sidebar-plugin-name tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                  {item.name}
                </span>
                <span className="sidebar-plugin-status tw:shrink-0 tw:text-app-text-meta tw:type-caption">
                  {t(pluginStatusLabel(item))}
                </span>
              </button>
            </SidebarRow>
          ))
        )}
      </ScrollArea>
    </div>
  )
}
