import type React from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AlertOctagon,
  ArrowLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Settings,
  ChevronDown,
  Plus,
  Server,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'

import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { SkeletonBlock, SkeletonRegion } from '../../components/ui/Skeleton.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import type { DesktopSkillCatalogItem, DesktopSkillOwnerFilter } from '../../../shared/Types.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { useDesktopLayoutOutletContext } from '../layout/shell/DesktopLayoutOutletContext.js'
import { preparePluginPrompt } from './PluginPrompt.js'
import { usePluginDetails } from './UsePluginDetails.js'
import { CatalogDetailsView } from './CatalogDetailsView.js'
import { PluginCatalogCard } from './PluginCatalogCard.js'
import { SkillCatalogCard } from './SkillCatalogCard.js'
import {
  catalogBrowseParams,
  catalogDetailsParams,
  parseCatalogLocation,
  type CatalogDetailsTarget,
} from './CatalogDetailsDeepLink.js'
import {
  filterPluginCatalog,
  groupMarketplacePlugins,
  mergePluginCatalog,
  pluginPrimaryAction,
  type PluginCatalogItem,
} from './PluginCatalog.js'
import { groupSkillsForDisplay } from './SkillCatalog.js'
import { usePluginCatalog } from './UsePluginCatalog.js'
import { cx } from '../../utils/Cx.js'
import {
  DETAILS_BREADCRUMB_CLASS,
  DETAILS_BREADCRUMB_CURRENT_CLASS,
  FORCED_COLORS_SURFACE_CLASS,
} from './CatalogClassNames.js'

const catalogScrollPositions = new Map<string, number>()

const SKILLS_SH_API_DOCS_URL = 'https://www.skills.sh/docs/api#authentication'

/* 空态卡片：面板表面 + 居中内容。 */
const PLUGINS_EMPTY_BASE =
  'tw:grid tw:min-h-0 tw:min-w-0 tw:place-items-center tw:gap-3 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4 tw:py-7 tw:text-center tw:text-app-text-meta tw:shadow-none'

/* 读取失败提示条：危险色表面 + 图标/正文/动作三栏。 */
const PLUGINS_CALLOUT_BASE =
  'tw:flex tw:min-w-0 tw:items-start tw:gap-3 tw:rounded-container tw:border tw:border-app-danger-border tw:bg-app-danger-subtle tw:p-4 tw:shadow-none tw:@max-[479px]/plugins-page:items-stretch tw:@max-[479px]/plugins-page:flex-wrap'

const DIRECTORY_OPTIONS = [
  { value: 'public', label: '公开' },
  { value: 'personal', label: '个人' },
] as const

const SKILL_OWNER_OPTIONS: ReadonlyArray<{ value: DesktopSkillOwnerFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'official', label: '官方' },
  { value: 'community', label: '社区' },
]

export function PluginsView(): React.ReactNode {
  const { workspacePath } = useDesktopLayoutOutletContext()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useMemo(() => parseCatalogLocation(searchParams), [searchParams])
  const { tab, target } = location
  const pluginQuery = searchParams.get('q') ?? ''
  const pluginDirectory = searchParams.get('directory') === 'personal' ? 'personal' : 'public'
  const selectedSection = searchParams.get('section')
  const [addOpen, setAddOpen] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  function updateBrowse(key: string, value: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        if (key !== 'section') next.delete('section')
        if (key === 'directory') next.delete('category')
        return next
      },
      { replace: key === 'q' },
    )
  }
  const setPluginQuery = (value: string) => updateBrowse('q', value)
  const [skillQuery, setSkillQuery] = useState('')
  const [skillOwner, setSkillOwner] = useState<DesktopSkillOwnerFilter>('official')
  const [announcement, setAnnouncement] = useState('')
  const [busyPluginIds, setBusyPluginIds] = useState<Set<string>>(() => new Set())
  const [pluginErrors, setPluginErrors] = useState<Record<string, string>>({})
  const [removingPlugin, setRemovingPlugin] = useState<PluginCatalogItem | null>(null)
  const [skills, setSkills] = useState<DesktopSkillCatalogItem[] | undefined>()
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [skillsReloadKey, setSkillsReloadKey] = useState(0)
  const [installingSkillIds, setInstallingSkillIds] = useState<Set<string>>(() => new Set())
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const backButtonRef = useRef<HTMLButtonElement | null>(null)
  const scrollRegionRef = useRef<HTMLElement | null>(null)
  const lastTargetRef = useRef<CatalogDetailsTarget | null>(null)
  const {
    plugins,
    sections,
    error: pluginLoadError,
    loading: pluginsLoading,
    refresh: refreshPlugins,
    setEnabled: setPluginEnabled,
  } = usePluginCatalog(workspacePath)

  useEffect(() => {
    if (!location.invalid) return
    setSearchParams(catalogBrowseParams(searchParams, tab), { replace: true })
  }, [location.invalid, searchParams, setSearchParams, tab])

  useEffect(() => {
    if (tab !== 'skills') return
    let cancelled = false
    setSkillsLoading(true)
    setSkillsError(null)
    desktopClient
      .listSkillsCatalog({
        query: skillQuery,
        owner: skillOwner,
        view: 'trending',
        page: 0,
        perPage: 24,
      })
      .then((result) => {
        if (!cancelled) setSkills(result.skills)
      })
      .catch((error) => {
        if (!cancelled) {
          setSkills([])
          setSkillsError(error instanceof Error ? error.message : '技能目录加载失败。')
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [skillOwner, skillQuery, skillsReloadKey, tab])

  const pluginItems = useMemo(
    () => mergePluginCatalog(plugins, workspacePath),
    [plugins, workspacePath],
  )
  const directoryPlugins = pluginItems.filter((item) =>
    pluginDirectory === 'public'
      ? item.inMarketplace
      : item.installed || item.source === 'workspace' || item.source === 'personal',
  )
  const visiblePlugins = filterPluginCatalog(directoryPlugins, pluginQuery, 'all', 'all')
  const pluginGroups: Array<{ id: string; label: string; items: PluginCatalogItem[] }> = (() => {
    if (pluginDirectory === 'personal')
      return (
        [
          ['bundled', '自带插件'],
          ['installed', '已安装'],
          ['workspace', '项目插件'],
          ['personal', '个人插件'],
        ] as const
      )
        .map(([id, label]) => ({
          id,
          label,
          items: visiblePlugins.filter((item) => item.source === id),
        }))
        .filter((group) => group.items.length)
    if (pluginQuery) return [{ id: 'results', label: '插件', items: visiblePlugins }]
    const groups = groupMarketplacePlugins(visiblePlugins, sections)
    if (selectedSection) return groups.filter((group) => group.id === selectedSection)
    return groups.filter((group) => group.items.length)
  })()
  const skillGroups = useMemo(() => groupSkillsForDisplay(skills ?? []), [skills])
  const selectedPlugin =
    target?.kind === 'plugin' ? (pluginItems.find((item) => item.id === target.id) ?? null) : null
  const selectedSkill =
    target?.kind === 'skill' ? (skills?.find((item) => item.id === target.id) ?? null) : null
  const selectedPluginDetailsKey = selectedPlugin
    ? `${workspacePath ?? ''}\u0000${selectedPlugin.id}`
    : null

  const selectedDetails = usePluginDetails(selectedPlugin, workspacePath)

  useEffect(() => {
    if (target) {
      lastTargetRef.current = target
      window.requestAnimationFrame(() => backButtonRef.current?.focus())
      return
    }
    const previousTarget = lastTargetRef.current
    if (!previousTarget) return
    lastTargetRef.current = null
    window.requestAnimationFrame(() => {
      const selector = `[data-catalog-item-id="${previousTarget.kind}:${CSS.escape(previousTarget.id)}"]`
      const item = document.querySelector<HTMLButtonElement>(selector)
      if (item) item.focus({ preventScroll: true })
      else searchInputRef.current?.focus({ preventScroll: true })
    })
  }, [target])

  useEffect(() => {
    if (!target || location.invalid) return
    const targetLoaded = target.kind === 'plugin' ? plugins !== undefined : skills !== undefined
    const targetExists = target.kind === 'plugin' ? selectedPlugin !== null : selectedSkill !== null
    if (targetLoaded && !targetExists) {
      setSearchParams(catalogBrowseParams(searchParams, tab), { replace: true })
    }
  }, [
    location.invalid,
    searchParams,
    selectedPlugin,
    selectedSkill,
    setSearchParams,
    skills,
    plugins,
    tab,
    target,
  ])

  function openDetails(nextTarget: CatalogDetailsTarget): void {
    setSearchParams(catalogDetailsParams(searchParams, nextTarget))
  }

  function closeDetails(): void {
    setSearchParams(catalogBrowseParams(searchParams, tab))
  }

  async function runPluginAction(
    item: PluginCatalogItem,
    trigger: HTMLButtonElement,
    checked?: boolean,
  ): Promise<void> {
    if (busyPluginIds.has(item.id)) return
    const action = pluginPrimaryAction(item)
    if (!action || action.disabled) return
    setPluginErrors((current) => ({ ...current, [item.id]: '' }))
    if (action.kind === 'open-external') {
      if (!item.externalURL) return
      try {
        await desktopClient.openExternalURL(item.externalURL)
      } catch (error) {
        setPluginErrors((current) => ({
          ...current,
          [item.id]: error instanceof Error ? error.message : '无法打开安装说明。',
        }))
      }
      return
    }
    setBusyPluginIds((current) => new Set(current).add(item.id))
    try {
      if (action.kind === 'install') {
        await desktopClient.installPlugin(item.id)
        setAnnouncement(`${item.name}已安装。`)
        refreshPlugins()
        selectedDetails.retry()
      } else if (action.kind === 'toggle-plugin') {
        const result = await setPluginEnabled(item.id, checked ?? !action.checked)
        setAnnouncement(`${item.name}已${result.enabled ? '启用' : '禁用'}。`)
      }
      window.requestAnimationFrame(() => trigger.isConnected && trigger.focus())
    } catch (error) {
      const message = error instanceof Error ? error.message : `${item.name}状态更新失败。`
      setPluginErrors((current) => ({ ...current, [item.id]: message }))
      setAnnouncement(message)
    } finally {
      setBusyPluginIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  async function installSkill(skill: DesktopSkillCatalogItem): Promise<void> {
    if (skill.installed || installingSkillIds.has(skill.id)) return
    setInstallingSkillIds((current) => new Set(current).add(skill.id))
    setSkillsError(null)
    try {
      const result = await desktopClient.installSkill({
        id: skill.id,
        installUrl: skill.installUrl,
      })
      setSkills((current) =>
        current?.map((item) =>
          item.id === result.id ? { ...item, installed: result.installed } : item,
        ),
      )
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : '技能安装失败。')
    } finally {
      setInstallingSkillIds((current) => {
        const next = new Set(current)
        next.delete(skill.id)
        return next
      })
    }
  }

  const activeLoading = tab === 'plugins' ? pluginsLoading : skillsLoading
  const browseScrollKey = JSON.stringify([
    workspacePath,
    tab,
    pluginDirectory,
    pluginQuery,
    selectedSection,
    skillQuery,
    skillOwner,
  ])
  useLayoutEffect(() => {
    const element = scrollRegionRef.current
    if (target || activeLoading || !element) return
    element.scrollTop = catalogScrollPositions.get(browseScrollKey) ?? 0
    return () => {
      catalogScrollPositions.delete(browseScrollKey)
      catalogScrollPositions.set(browseScrollKey, element.scrollTop)
      if (catalogScrollPositions.size > 32)
        catalogScrollPositions.delete(catalogScrollPositions.keys().next().value!)
    }
  }, [browseScrollKey, target, activeLoading])

  async function uninstallPlugin(): Promise<void> {
    if (!removingPlugin || busyPluginIds.has(removingPlugin.id)) return
    const item = removingPlugin
    setBusyPluginIds((current) => new Set(current).add(item.id))
    try {
      await desktopClient.uninstallPlugin(item.id)
      setAnnouncement(`${item.name}已移除。`)
      setRemovingPlugin(null)
      selectedDetails.retry()
      refreshPlugins()
    } catch (error) {
      const message = error instanceof Error ? error.message : '插件移除失败。'
      setPluginErrors((current) => ({ ...current, [item.id]: message }))
      setAnnouncement(message)
      setRemovingPlugin(null)
    } finally {
      setBusyPluginIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  async function tryPluginPrompt(prompt: string): Promise<void> {
    const item = selectedPlugin
    if (!item || busyPluginIds.has(item.id)) return
    setBusyPluginIds((current) => new Set(current).add(item.id))
    setPluginErrors((current) => ({ ...current, [item.id]: '' }))
    try {
      await preparePluginPrompt(item, prompt)
      refreshPlugins()
      navigate('/new')
    } catch (cause) {
      setPluginErrors((current) => ({
        ...current,
        [item.id]: cause instanceof Error ? cause.message : '插件准备失败，请重试。',
      }))
    } finally {
      setBusyPluginIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  const headerSearch = (
    <SearchInput
      aria-label={tab === 'plugins' ? '搜索插件' : '搜索技能'}
      className="plugins-header-search"
      onChange={tab === 'plugins' ? setPluginQuery : setSkillQuery}
      placeholder={tab === 'plugins' ? '搜索插件' : '搜索技能'}
      ref={searchInputRef}
      shape="pill"
      size="md"
      value={tab === 'plugins' ? pluginQuery : skillQuery}
      variant="outlined"
    />
  )

  const headerActions = (
    <div className="plugins-header-actions tw:flex tw:min-w-0 tw:items-center tw:gap-2">
      <Button
        aria-busy={activeLoading}
        disabled={activeLoading}
        isIconOnly
        onClick={() => {
          if (tab === 'plugins') {
            refreshPlugins()
          } else {
            setSkillsReloadKey((value) => value + 1)
          }
        }}
        shape="pill"
        size="md"
        title={`刷新${tab === 'plugins' ? '插件' : '技能'}目录`}
        variant="ghost"
      >
        <RefreshCw aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </Button>
      <Button
        isIconOnly
        onClick={() => navigate('/settings/plugins')}
        shape="pill"
        size="md"
        title="管理插件设置"
        variant="ghost"
      >
        <Settings aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </Button>
      {tab === 'plugins' ? (
        <PopoverMenu
          align="end"
          open={addOpen}
          onOpenChange={setAddOpen}
          size="md"
          trigger={
            <Button color="primary" shape="pill" size="md">
              添加
              <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} />
            </Button>
          }
        >
          <PopoverItem
            icon={<Plus aria-hidden="true" size={APP_ICON_SIZE} />}
            onClick={() => {
              setAddOpen(false)
              void desktopClient
                .openExternalURL('https://github.com/codepilotx-dev/Pidex-Plugins#创建插件')
                .catch((cause) =>
                  setAddError(cause instanceof Error ? cause.message : '无法打开作者指南。'),
                )
            }}
          >
            创建插件
          </PopoverItem>
          <PopoverItem
            icon={<Server aria-hidden="true" size={APP_ICON_SIZE} />}
            onClick={() => {
              setAddOpen(false)
              navigate('/settings/plugins?tab=mcps&create=mcp')
            }}
          >
            创建自定义 MCP 服务器
          </PopoverItem>
        </PopoverMenu>
      ) : null}
    </div>
  )

  return (
    <>
      {target ? (
        <main className="plugins-details-page tw:h-full tw:w-full tw:min-w-0 tw:overflow-auto tw:bg-app-canvas tw:p-5 tw:@container/plugins-page">
          <div className="tw:mx-auto tw:min-w-0 tw:w-[min(var(--page-content-max-width),100%)] tw:pb-8">
            <div className="tw:mb-4 tw:flex tw:min-w-0 tw:items-center">
              {target.kind === 'plugin' ? (
                <div className={cx('plugins-detail-breadcrumb', DETAILS_BREADCRUMB_CLASS)}>
                  <Button
                    color="ghostSecondary"
                    onClick={closeDetails}
                    ref={backButtonRef}
                    size="toolbar"
                  >
                    插件
                  </Button>
                  <ChevronRight
                    aria-hidden="true"
                    size={APP_ICON_SIZES.sm}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                  <span className={DETAILS_BREADCRUMB_CURRENT_CLASS}>
                    {selectedPlugin?.name ?? target.id}
                  </span>
                </div>
              ) : (
                <Button
                  color="ghostSecondary"
                  onClick={closeDetails}
                  ref={backButtonRef}
                  size="toolbar"
                >
                  <ArrowLeft
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                  返回{tab === 'plugins' ? '插件' : '技能'}
                </Button>
              )}
            </div>
            {selectedPlugin ? (
              <CatalogDetailsView
                busy={busyPluginIds.has(selectedPlugin.id)}
                details={selectedDetails.details}
                detailsError={selectedDetails.error}
                onRetryDetails={selectedDetails.retry}
                error={pluginErrors[selectedPlugin.id]}
                item={selectedPlugin}
                kind="plugin"
                key={selectedPluginDetailsKey}
                workspacePath={workspacePath}
                onPrimaryAction={(item, trigger, checked) =>
                  void runPluginAction(item, trigger, checked)
                }
                onTryPrompt={(prompt) => void tryPluginPrompt(prompt)}
                onUninstall={
                  selectedPlugin.canUninstall ? () => setRemovingPlugin(selectedPlugin) : undefined
                }
              />
            ) : selectedSkill ? (
              <CatalogDetailsView
                installing={installingSkillIds.has(selectedSkill.id)}
                item={selectedSkill}
                kind="skill"
                onInstall={(item) => void installSkill(item)}
                onOpenSource={(item) => item.url && void desktopClient.openExternalURL(item.url)}
              />
            ) : (
              <div className="catalog-details-view tw:grid tw:mx-auto tw:w-[min(var(--page-content-max-width),100%)] tw:gap-7">
                <CatalogSkeleton label={`正在加载${tab === 'plugins' ? '插件' : '技能'}详情`} />
              </div>
            )}
          </div>
        </main>
      ) : (
        <PrimaryPageLayout
          actions={headerActions}
          className="plugins-primary-page tw:@container/plugins-page"
          search={headerSearch}
          scrollContainerRef={scrollRegionRef}
          title={tab === 'plugins' ? '插件' : '技能'}
          description={
            tab === 'plugins' ? '在常用工具中扩展 Pidex 的能力。' : '查找并添加可复用的工作流指令。'
          }
        >
          <div aria-live="polite" className="plugins-sr-status tw:sr-only">
            {announcement}
          </div>
          {addError ? (
            <CatalogCallout
              title="无法打开作者指南"
              message={addError}
              onRetry={() => {
                setAddError(null)
                void desktopClient
                  .openExternalURL('https://github.com/codepilotx-dev/Pidex-Plugins#创建插件')
                  .catch((cause) =>
                    setAddError(cause instanceof Error ? cause.message : '打开失败。'),
                  )
              }}
            />
          ) : null}
          {tab === 'plugins' ? (
            <PluginDirectory
              onUninstall={setRemovingPlugin}
              busyPluginIds={busyPluginIds}
              clearFilters={() => {
                setSearchParams((current) => {
                  const next = new URLSearchParams(current)
                  next.delete('q')
                  next.delete('category')
                  next.delete('section')
                  return next
                })
              }}
              groups={pluginGroups}
              loadError={pluginLoadError}
              loading={pluginsLoading}
              onOpenDetails={(item) => openDetails({ kind: 'plugin', id: item.id, tab: 'plugins' })}
              onPrimaryAction={(item, trigger, checked) =>
                void runPluginAction(item, trigger, checked)
              }
              pluginErrors={pluginErrors}
              directory={pluginDirectory}
              setDirectory={(value) => updateBrowse('directory', value)}
              section={selectedSection}
              openSection={(value) => updateBrowse('section', value)}
              query={pluginQuery}
              refresh={refreshPlugins}
              total={pluginGroups.reduce((total, group) => total + group.items.length, 0)}
            />
          ) : (
            <SkillDirectory
              clearFilters={() => {
                setSkillQuery('')
                setSkillOwner('official')
              }}
              error={skillsError}
              groups={skillGroups}
              installingSkillIds={installingSkillIds}
              loading={skillsLoading}
              onInstall={(item) => void installSkill(item)}
              onOpenDetails={(item) => openDetails({ kind: 'skill', id: item.id, tab: 'skills' })}
              query={skillQuery}
              refresh={() => setSkillsReloadKey((value) => value + 1)}
              setSkillOwner={setSkillOwner}
              skillOwner={skillOwner}
              skillsLoaded={skills !== undefined}
            />
          )}
        </PrimaryPageLayout>
      )}
      <ConfirmationDialog
        actionDisabled={!!removingPlugin && busyPluginIds.has(removingPlugin.id)}
        actionLabel="移除插件"
        description={`将移除 ${removingPlugin?.name ?? '插件'} 的下载文件，之后可以重新安装。`}
        onAction={() => void uninstallPlugin()}
        onCancel={() => setRemovingPlugin(null)}
        open={removingPlugin !== null}
        title="移除插件？"
        tone="danger"
      />
    </>
  )
}

type PluginDirectoryProps = {
  onUninstall: (item: PluginCatalogItem) => void
  busyPluginIds: Set<string>
  clearFilters: () => void
  groups: Array<{ id: string; label: string; items: PluginCatalogItem[] }>
  loadError: string | null
  loading: boolean
  onOpenDetails: (item: PluginCatalogItem) => void
  onPrimaryAction: (item: PluginCatalogItem, trigger: HTMLButtonElement, checked?: boolean) => void
  directory: 'public' | 'personal'
  setDirectory: (value: string) => void
  section: string | null
  openSection: (value: string) => void
  pluginErrors: Record<string, string>
  query: string
  refresh: () => void
  total: number
}

function PluginDirectory(props: PluginDirectoryProps): React.ReactNode {
  return (
    <div className="plugins-panel tw:grid tw:min-w-0 tw:shrink-0 tw:gap-8" id="plugins-panel">
      <div className="plugins-directory-navigation tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:@max-[479px]/plugins-page:items-stretch">
        <SegmentedControl
          ariaLabel="插件来源"
          onChange={props.setDirectory}
          options={DIRECTORY_OPTIONS}
          overflowMode="fit"
          shape="pill"
          size="md"
          value={props.directory}
        />
      </div>

      {props.section ? (
        <Button color="ghostSecondary" onClick={() => props.openSection('')}>
          返回全部栏目
        </Button>
      ) : null}
      {props.loadError ? (
        <CatalogCallout
          message={props.loadError}
          onRetry={props.refresh}
          title="插件目录刷新失败"
        />
      ) : null}

      {props.loading && props.total === 0 ? (
        <CatalogSkeleton label="正在加载插件目录" />
      ) : props.total === 0 && props.loadError ? null : props.total === 0 ? (
        <CatalogEmpty
          actionLabel="清除筛选"
          message={props.query ? `没有找到与“${props.query}”匹配的插件。` : '清除来源筛选后再试。'}
          onAction={props.clearFilters}
          title={props.query ? '没有匹配的插件' : '当前筛选没有结果'}
        />
      ) : (
        <div className="plugins-source-groups tw:grid tw:min-w-0 tw:gap-8">
          {props.groups.map((group) => (
            <section className="plugins-source-group tw:grid tw:min-w-0 tw:gap-3" key={group.id}>
              <header className="plugins-section-heading tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3">
                <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">
                  {props.directory === 'public' && !props.query && !props.section ? (
                    <button
                      className="tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-1 tw:rounded-control tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
                      type="button"
                      onClick={() => props.openSection(group.id)}
                    >
                      {group.label}
                      <ChevronRight aria-hidden="true" size={APP_ICON_SIZE} />
                    </button>
                  ) : (
                    group.label
                  )}
                </h2>
                <span className="plugins-sr-status tw:sr-only">共 {group.items.length} 项</span>
              </header>
              <ul className="plugins-catalog-grid tw:m-0 tw:grid tw:grid-cols-2 tw:min-w-0 tw:list-none tw:gap-x-7 tw:gap-y-4 tw:p-0 tw:@max-[580px]/plugins-page:grid-cols-1">
                {(props.directory === 'public' && !props.section && !props.query
                  ? group.items.slice(0, 8)
                  : group.items
                ).map((item) => (
                  <PluginCatalogCard
                    busy={props.busyPluginIds.has(item.id)}
                    error={props.pluginErrors[item.id]}
                    item={item}
                    key={item.id}
                    onOpenDetails={(plugin) => props.onOpenDetails(plugin)}
                    onPrimaryAction={props.onPrimaryAction}
                    onUninstall={props.onUninstall}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

type SkillDirectoryProps = {
  clearFilters: () => void
  error: string | null
  groups: ReturnType<typeof groupSkillsForDisplay>
  installingSkillIds: Set<string>
  loading: boolean
  onInstall: (item: DesktopSkillCatalogItem) => void
  onOpenDetails: (item: DesktopSkillCatalogItem) => void
  query: string
  refresh: () => void
  setSkillOwner: (value: DesktopSkillOwnerFilter) => void
  skillOwner: DesktopSkillOwnerFilter
  skillsLoaded: boolean
}

function SkillDirectory(props: SkillDirectoryProps): React.ReactNode {
  const total = props.groups.installed.length + props.groups.recommended.length
  return (
    <div
      aria-busy={props.loading || undefined}
      className="plugins-panel tw:grid tw:min-w-0 tw:shrink-0 tw:gap-8"
      id="skills-panel"
    >
      <div className="plugins-directory-navigation tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:@max-[479px]/plugins-page:items-stretch">
        <SegmentedControl
          ariaLabel="技能来源"
          onChange={props.setSkillOwner}
          options={SKILL_OWNER_OPTIONS}
          overflowMode="fit"
          shape="pill"
          size="md"
          value={props.skillOwner}
        />
      </div>
      {props.error && total > 0 ? (
        <CatalogCallout message={props.error} onRetry={props.refresh} title="技能目录刷新失败" />
      ) : null}
      {props.error && total === 0 ? (
        <div className={cx('plugins-empty', PLUGINS_EMPTY_BASE)}>
          <AlertOctagon aria-hidden="true" size={APP_ICON_SIZE} />
          <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">技能目录暂不可用</h2>
          <p className="tw:m-0 tw:text-app-text-meta tw:type-body-sm tw:wrap-anywhere">
            {props.error}
          </p>
          <ol className="plugins-empty-steps tw:m-0 tw:grid tw:list-decimal tw:gap-1 tw:pl-5 tw:text-left tw:type-body-sm">
            <li>在 Vercel 项目中启用 OIDC Federation。</li>
            <li>用该项目提供的 VERCEL_OIDC_TOKEN 启动 Pidex。</li>
            <li>重启应用后重新加载 skills.sh 技能目录。</li>
          </ol>
          <div className="plugins-empty-actions tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-center tw:gap-2">
            <Button color="secondary" onClick={props.refresh}>
              重试
            </Button>
            <Button
              color="secondary"
              onClick={() => void desktopClient.openExternalURL('https://skills.sh')}
            >
              打开 skills.sh
            </Button>
            <Button
              color="secondary"
              onClick={() => void desktopClient.openExternalURL(SKILLS_SH_API_DOCS_URL)}
            >
              查看配置文档
            </Button>
          </div>
        </div>
      ) : props.loading && !props.skillsLoaded ? (
        <CatalogSkeleton label="正在加载 skills.sh 技能目录" />
      ) : total === 0 ? (
        <CatalogEmpty
          actionLabel={props.query || props.skillOwner !== 'official' ? '清除筛选' : undefined}
          message={props.query ? `没有匹配“${props.query}”的技能。` : '当前来源没有可展示的技能。'}
          onAction={props.query || props.skillOwner !== 'official' ? props.clearFilters : undefined}
          title={props.query ? '没有匹配的技能' : '目录为空'}
        />
      ) : (
        <div className="plugins-source-groups tw:grid tw:min-w-0 tw:gap-8">
          {props.groups.installed.length > 0 ? (
            <SkillSection
              id="installed-skills-title"
              installingSkillIds={props.installingSkillIds}
              items={props.groups.installed}
              onInstall={props.onInstall}
              onOpenDetails={props.onOpenDetails}
              title="已添加"
            />
          ) : null}
          {props.groups.recommended.length > 0 ? (
            <SkillSection
              id="recommended-skills-title"
              installingSkillIds={props.installingSkillIds}
              items={props.groups.recommended}
              onInstall={props.onInstall}
              onOpenDetails={props.onOpenDetails}
              title="推荐"
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

function SkillSection({
  id,
  installingSkillIds,
  items,
  onInstall,
  onOpenDetails,
  title,
}: {
  id: string
  installingSkillIds: Set<string>
  items: DesktopSkillCatalogItem[]
  onInstall: (item: DesktopSkillCatalogItem) => void
  onOpenDetails: (item: DesktopSkillCatalogItem) => void
  title: string
}): React.ReactNode {
  return (
    <section aria-labelledby={id} className="plugins-source-group tw:grid tw:min-w-0 tw:gap-3">
      <header className="plugins-section-heading tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3">
        <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm" id={id}>
          {title}
        </h2>
        <span className="plugins-sr-status tw:sr-only">共 {items.length} 项</span>
      </header>
      <ul className="plugins-catalog-grid tw:m-0 tw:grid tw:grid-cols-2 tw:min-w-0 tw:list-none tw:gap-x-7 tw:gap-y-4 tw:p-0 tw:@max-[580px]/plugins-page:grid-cols-1">
        {items.map((item) => (
          <SkillCatalogCard
            installing={installingSkillIds.has(item.id)}
            key={item.id}
            onInstall={onInstall}
            onOpenDetails={(skill) => onOpenDetails(skill)}
            skill={item}
          />
        ))}
      </ul>
    </section>
  )
}

function CatalogCallout({
  message,
  onRetry,
  title,
}: {
  message: string
  onRetry: () => void
  title: string
}): React.ReactNode {
  return (
    <div
      className={cx(
        'plugins-callout',
        PLUGINS_CALLOUT_BASE,
        FORCED_COLORS_SURFACE_CLASS,
        'tw:forced-colors:border-double',
      )}
      data-tone="danger"
      role="status"
    >
      <AlertOctagon
        aria-hidden="true"
        className="tw:shrink-0 tw:text-app-danger"
        size={APP_ICON_SIZE}
      />
      <div className="tw:grid tw:min-w-0 tw:flex-auto tw:gap-1">
        <strong>{title}</strong>
        <p className="tw:m-0 tw:text-app-text-meta tw:type-body-sm tw:wrap-anywhere">{message}</p>
      </div>
      <Button color="secondary" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}

function CatalogSkeleton({ label }: { label: string }): React.ReactNode {
  return (
    <SkeletonRegion
      className="plugins-catalog-grid plugins-skeleton-grid tw:m-0 tw:grid tw:grid-cols-2 tw:min-w-0 tw:list-none tw:gap-x-7 tw:gap-y-4 tw:p-0 tw:@max-[580px]/plugins-page:grid-cols-1"
      label={label}
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <SkeletonBlock
          className={cx(
            'plugins-skeleton tw:min-h-[60px] tw:rounded-container tw:border tw:border-app-border-subtle',
            FORCED_COLORS_SURFACE_CLASS,
          )}
          key={index}
        />
      ))}
    </SkeletonRegion>
  )
}

function CatalogEmpty({
  actionLabel,
  message,
  onAction,
  title,
}: {
  actionLabel?: string
  message: string
  onAction?: () => void
  title: string
}): React.ReactNode {
  return (
    <div className={cx('plugins-empty', PLUGINS_EMPTY_BASE)}>
      <Clock aria-hidden="true" size={APP_ICON_SIZE} />
      <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">{title}</h2>
      <p className="tw:m-0 tw:text-app-text-meta tw:type-body-sm tw:wrap-anywhere">{message}</p>
      {actionLabel && onAction ? (
        <Button color="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
