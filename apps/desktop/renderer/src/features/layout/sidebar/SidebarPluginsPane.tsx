import type React from 'react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Plug } from 'lucide-react'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { SearchHeading } from '../../../components/ui/SearchHeading.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { Button } from '../../../components/ui/Button.js'
import { PluginActionsMenu } from '../../plugins/PluginActionsMenu.js'
import { PluginIcon } from '../../plugins/PluginIcon.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import {
  filterPluginCatalog,
  mergePluginCatalog,
  pluginStatusLabel,
  type PluginCatalogItem,
} from '../../plugins/PluginCatalog.js'
import { catalogBrowseParams, type CatalogTab } from '../../plugins/CatalogDetailsDeepLink.js'
import { usePluginCatalog } from '../../plugins/UsePluginCatalog.js'
import { SidebarEmptyRow, SidebarRow } from './SidebarRow.js'

const CATALOG_TABS: ReadonlyArray<{ value: CatalogTab; label: string }> = [
  { value: 'plugins', label: '插件' },
  { value: 'skills', label: '技能' },
]

export function SidebarPluginsPane({
  workspacePath,
}: {
  workspacePath: string | null
}): React.ReactNode {
  const { t } = useLocale()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const tab: CatalogTab = searchParams.get('tab') === 'skills' ? 'skills' : 'plugins'
  const { plugins, error, loading, refresh, setEnabled } = usePluginCatalog(workspacePath)
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})

  const items = useMemo(() => mergePluginCatalog(plugins), [plugins])
  const visibleItems = useMemo(
    () =>
      filterPluginCatalog(
        items.filter((item) => item.installed && item.enabled),
        query,
        'all',
        'all',
      ),
    [items, query],
  )

  function browse(nextTab: CatalogTab): void {
    navigate(`/plugins?${catalogBrowseParams(searchParams, nextTab).toString()}`)
  }

  function openPlugin(item: PluginCatalogItem): void {
    const next = catalogBrowseParams(searchParams, 'plugins')
    next.set('plugin', item.id)
    navigate(`/plugins?${next.toString()}`)
  }

  async function togglePlugin(item: PluginCatalogItem, checked?: boolean): Promise<void> {
    if (
      busyIds.has(item.id) ||
      item.actionKind !== 'toggle-plugin' ||
      (item.status !== 'enabled' && item.status !== 'disabled')
    )
      return
    setBusyIds((current) => new Set(current).add(item.id))
    setActionErrors((current) => ({ ...current, [item.id]: '' }))
    try {
      await setEnabled(item.id, checked ?? !item.enabled)
    } catch (cause) {
      setActionErrors((current) => ({
        ...current,
        [item.id]: cause instanceof Error ? cause.message : t('无法更新插件状态'),
      }))
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  return (
    <div className="sidebar-plugins-pane tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:py-2">
      <header className="sidebar-pane-heading tw:flex tw:min-h-9 tw:shrink-0 tw:items-center tw:justify-between tw:px-3">
        <SearchHeading
          title={<h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">{t('自定义')}</h2>}
          search={
            <SearchInput
              variant="outlined"
              aria-label={t('搜索已安装插件')}
              placeholder={t('搜索已安装插件')}
              value={query}
              onChange={setQuery}
            />
          }
        />
      </header>
      <div className="tw:flex tw:flex-col tw:sidebar-row-gap tw:p-2">
        {CATALOG_TABS.map((option) => (
          <SidebarRow
            asChild
            key={option.value}
            active={
              tab === option.value && !searchParams.has('plugin') && !searchParams.has('skill')
            }
            layout="flex"
            leading={
              option.value === 'plugins' ? (
                <Plug size={APP_ICON_SIZE} />
              ) : (
                <Box size={APP_ICON_SIZE} />
              )
            }
          >
            <button
              type="button"
              aria-current={
                tab === option.value && !searchParams.has('plugin') && !searchParams.has('skill')
                  ? 'page'
                  : undefined
              }
              onClick={() => browse(option.value)}
            >
              {t(option.label)}
            </button>
          </SidebarRow>
        ))}
      </div>
      <h3 className="tw:m-0 tw:flex tw:min-h-[var(--sidebar-row-height)] tw:shrink-0 tw:items-center tw:px-4 tw:text-app-text-meta tw:type-body">
        {t('已安装')}
      </h3>
      <ScrollArea
        className="sidebar-scheduled-scroll tw:min-h-0 tw:flex-1 tw:px-2 tw:pb-2 tw:pt-0"
        contentClassName="tw:flex tw:flex-col tw:sidebar-row-gap"
      >
        {loading ? (
          <SidebarEmptyRow role="status">{t('正在加载插件…')}</SidebarEmptyRow>
        ) : error && visibleItems.length === 0 ? (
          <div
            className="sidebar-pane-error tw:p-2 tw:text-app-text-soft tw:type-body-sm"
            role="status"
          >
            {error}
            <Button color="secondary" size="toolbar" onClick={refresh}>
              {t('重试')}
            </Button>
          </div>
        ) : visibleItems.length === 0 ? (
          <SidebarEmptyRow role="status">
            {t(query.trim() ? '没有匹配的插件' : '暂无已安装插件')}
          </SidebarEmptyRow>
        ) : (
          visibleItems.map((item) => (
            <div key={item.id}>
              <SidebarRow
                active={searchParams.get('plugin') === item.id}
                className="sidebar-nav-link tw:group tw:active:bg-app-active tw:type-row-title"
                labelClassName="sidebar-item-label tw:min-w-0"
                layout="flex"
                leading={
                  <span
                    className={
                      item.status === 'disabled'
                        ? 'tw:size-4 tw:opacity-60'
                        : item.status === 'unavailable' || item.status === 'error'
                          ? 'tw:size-4 tw:opacity-40'
                          : 'tw:size-4'
                    }
                  >
                    <PluginIcon
                      plugin={{ ...item, workspacePath }}
                      name={item.iconName}
                      logoSource={item.logoSource}
                      logoDarkSource={item.logoDarkSource}
                    />
                  </span>
                }
                trailing={
                  <span className="tw:relative tw:z-1 tw:inline-flex tw:opacity-0 tw:pointer-events-none tw:group-hover:opacity-100 tw:group-hover:pointer-events-auto tw:group-has-[:focus-visible]:opacity-100 tw:group-has-[:focus-visible]:pointer-events-auto tw:has-[[data-state=open]]:opacity-100 tw:has-[[data-state=open]]:pointer-events-auto">
                    <PluginActionsMenu
                      item={item}
                      busy={busyIds.has(item.id)}
                      onOpenDetails={() => openPlugin(item)}
                      onPrimaryAction={
                        item.actionKind === 'toggle-plugin'
                          ? (plugin, _trigger, checked) => {
                              void togglePlugin(plugin, checked)
                            }
                          : undefined
                      }
                    />
                  </span>
                }
              >
                <button
                  type="button"
                  className="tw:absolute tw:inset-0 tw:rounded-item tw:border-0 tw:bg-transparent tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
                  title={`${item.name} · ${t(pluginStatusLabel(item))}`}
                  aria-label={`${item.name} · ${t(pluginStatusLabel(item))}`}
                  aria-current={searchParams.get('plugin') === item.id ? 'page' : undefined}
                  onClick={() => openPlugin(item)}
                />
                <span
                  className={
                    item.status === 'disabled'
                      ? 'tw:truncate tw:opacity-60'
                      : item.status === 'unavailable' || item.status === 'error'
                        ? 'tw:truncate tw:text-app-text-soft'
                        : 'tw:truncate'
                  }
                >
                  {item.name}
                </span>
              </SidebarRow>
              {actionErrors[item.id] ? (
                <p role="status" className="tw:m-0 tw:px-2 tw:text-app-danger tw:type-body-sm">
                  {actionErrors[item.id]}
                </p>
              ) : null}
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  )
}
