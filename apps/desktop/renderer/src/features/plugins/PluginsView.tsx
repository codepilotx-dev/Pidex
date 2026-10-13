import type React from 'react'
import type { PluginDetails } from '@pidex/agent-protocol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertOctagon, ArrowLeft, ChevronRight, Clock, RefreshCw, Settings2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'

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
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { useDesktopLayoutOutletContext } from '../layout/shell/DesktopLayoutOutletContext.js'
import { composerDraftStore } from '../session/composer/ComposerDraftStore.js'
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
  PLUGIN_CATALOG_DESCRIPTORS,
  filterPluginCatalog,
  groupPluginCatalogBySource,
  mergePluginCatalog,
  pluginPrimaryAction,
  type PluginCatalogItem,
  type PluginCategoryFilter,
} from './PluginCatalog.js'
import { groupSkillsForDisplay } from './SkillCatalog.js'
import { usePluginCatalog } from './UsePluginCatalog.js'
import { useMiniMaxCli } from './UseMiniMaxCli.js'
import { cx } from '../../utils/Cx.js'
import {
  DETAILS_BREADCRUMB_CLASS,
  DETAILS_BREADCRUMB_CURRENT_CLASS,
  FORCED_COLORS_FOCUS_CLASS,
  FORCED_COLORS_SURFACE_CLASS,
} from './CatalogClassNames.js'

const SKILLS_SH_API_DOCS_URL = 'https://www.skills.sh/docs/api#authentication'

/* 空态卡片：面板表面 + 居中内容。 */
const PLUGINS_EMPTY_BASE =
  'tw:grid tw:min-h-0 tw:min-w-0 tw:place-items-center tw:gap-3 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4 tw:py-7 tw:text-center tw:text-app-text-meta tw:shadow-none'

/* 读取失败提示条：危险色表面 + 图标/正文/动作三栏。 */
const PLUGINS_CALLOUT_BASE =
  'tw:flex tw:min-w-0 tw:items-start tw:gap-3 tw:rounded-container tw:border tw:border-app-danger-border tw:bg-app-danger-subtle tw:p-4 tw:shadow-none tw:@max-[479px]/plugins-page:items-stretch tw:@max-[479px]/plugins-page:flex-wrap'

const CATEGORY_OPTIONS: ReadonlyArray<{ value: PluginCategoryFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'included', label: 'Featured' },
  { value: 'manageable', label: '可管理' },
  { value: 'external', label: '外部' },
]

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
  const [pluginQuery, setPluginQuery] = useState('')
  const [skillQuery, setSkillQuery] = useState('')
  const [pluginCategory, setPluginCategory] = useState<PluginCategoryFilter>('all')
  const [skillOwner, setSkillOwner] = useState<DesktopSkillOwnerFilter>('official')
  const [announcement, setAnnouncement] = useState('')
  const [busyPluginIds, setBusyPluginIds] = useState<Set<string>>(() => new Set())
  const [pluginErrors, setPluginErrors] = useState<Record<string, string>>({})
  const [confirmMiniMaxUninstall, setConfirmMiniMaxUninstall] = useState(false)
  const [pluginDetails, setPluginDetails] = useState<Record<string, PluginDetails | null>>({})
  const pluginDetailsRequestsRef = useRef(new Set<string>())
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
    error: pluginLoadError,
    loading: pluginsLoading,
    refresh: refreshPlugins,
    setEnabled: setPluginEnabled,
  } = usePluginCatalog(workspacePath)
  const miniMaxCli = useMiniMaxCli()

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
    () =>
      mergePluginCatalog(PLUGIN_CATALOG_DESCRIPTORS, plugins, pluginLoadError, {
        status: miniMaxCli.status,
        loading: miniMaxCli.loading,
        unsupported: miniMaxCli.unsupported,
        error: miniMaxCli.error,
      }),
    [
      miniMaxCli.error,
      miniMaxCli.loading,
      miniMaxCli.status,
      miniMaxCli.unsupported,
      plugins,
      pluginLoadError,
    ],
  )
  const visiblePlugins = useMemo(
    () => filterPluginCatalog(pluginItems, pluginQuery, pluginCategory, 'all'),
    [pluginCategory, pluginItems, pluginQuery],
  )
  const pluginGroups = useMemo(() => groupPluginCatalogBySource(visiblePlugins), [visiblePlugins])
  const skillGroups = useMemo(() => groupSkillsForDisplay(skills ?? []), [skills])
  const selectedPlugin =
    target?.kind === 'plugin' ? (pluginItems.find((item) => item.id === target.id) ?? null) : null
  const selectedSkill =
    target?.kind === 'skill' ? (skills?.find((item) => item.id === target.id) ?? null) : null
  const selectedPluginDetailsKey = selectedPlugin
    ? `${workspacePath ?? ''}\u0000${selectedPlugin.id}`
    : null

  useEffect(() => {
    if (
      !selectedPlugin ||
      !selectedPluginDetailsKey ||
      Object.hasOwn(pluginDetails, selectedPluginDetailsKey) ||
      pluginDetailsRequestsRef.current.has(selectedPluginDetailsKey)
    )
      return
    let cancelled = false
    pluginDetailsRequestsRef.current.add(selectedPluginDetailsKey)
    desktopClient
      .getPluginDetails(selectedPlugin.id, workspacePath)
      .then((details) => {
        if (!cancelled) {
          setPluginDetails((current) => ({ ...current, [selectedPluginDetailsKey]: details }))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPluginDetails((current) => ({ ...current, [selectedPluginDetailsKey]: null }))
        }
      })
      .finally(() => {
        pluginDetailsRequestsRef.current.delete(selectedPluginDetailsKey)
      })
    return () => {
      cancelled = true
    }
  }, [pluginDetails, selectedPlugin, selectedPluginDetailsKey, workspacePath])

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
      if (item) item.focus()
      else searchInputRef.current?.focus()
    })
  }, [target])

  useEffect(() => {
    if (!target || location.invalid) return
    const targetLoaded = target.kind === 'plugin' || skills !== undefined
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
    tab,
    target,
  ])

  function openDetails(nextTarget: CatalogDetailsTarget): void {
    setSearchParams(catalogDetailsParams(searchParams, nextTarget))
    scrollRegionRef.current?.scrollTo({ top: 0 })
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
    if (action.kind === 'install-minimax' || action.kind === 'update-minimax') {
      setBusyPluginIds((current) => new Set(current).add(item.id))
      try {
        const result = await miniMaxCli.install()
        setAnnouncement(
          `MiniMax CLI ${action.kind === 'update-minimax' ? '更新' : '安装'}完成，当前版本 ${result.installedVersion ?? '可用'}。`,
        )
        window.requestAnimationFrame(() => trigger.isConnected && trigger.focus())
      } catch (error) {
        const message = error instanceof Error ? error.message : 'MiniMax CLI 安装失败。'
        setPluginErrors((current) => ({ ...current, [item.id]: message }))
        setAnnouncement(message)
      } finally {
        setBusyPluginIds((current) => {
          const next = new Set(current)
          next.delete(item.id)
          return next
        })
      }
      return
    }
    if (action.kind !== 'toggle-plugin') return
    if (!item.installed || (item.status !== 'enabled' && item.status !== 'disabled')) return
    setBusyPluginIds((current) => new Set(current).add(item.id))
    try {
      const result = await setPluginEnabled(item.id, checked ?? !action.checked)
      setAnnouncement(`${item.name}已${result.enabled ? '启用' : '禁用'}。`)
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

  const activeLoading = tab === 'plugins' ? pluginsLoading || miniMaxCli.loading : skillsLoading

  async function uninstallMiniMaxCli(): Promise<void> {
    try {
      await miniMaxCli.uninstall()
      setAnnouncement('MiniMax CLI 已卸载，保存的登录信息也已删除。')
      setConfirmMiniMaxUninstall(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MiniMax CLI 卸载失败。'
      setPluginErrors((current) => ({ ...current, minimax: message }))
      setAnnouncement(message)
    }
  }

  function tryPluginPrompt(prompt: string): void {
    const text = selectedPlugin
      ? `[@${selectedPlugin.name.replace(/([\\[\]])/gu, '\\$1')}](plugin://${selectedPlugin.id}) ${prompt}`
      : prompt
    composerDraftStore.prefillTextIfEmpty('home', text)
    navigate('/new')
  }

  return (
    <>
      {target ? (
        <WorkspaceHeaderItem align="start" id="plugins.navigation" order={0} slot="left">
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
        </WorkspaceHeaderItem>
      ) : null}

      {!target ? (
        <WorkspaceHeaderItem align="end" id="plugins.actions" order={100} slot="right">
          <div className="plugins-header-actions tw:flex tw:min-w-0 tw:items-center tw:gap-2">
            <Button
              isIconOnly
              aria-busy={activeLoading}
              color="ghostSecondary"
              disabled={activeLoading}
              onClick={() => {
                if (tab === 'plugins') {
                  refreshPlugins()
                  miniMaxCli.refresh()
                } else {
                  setSkillsReloadKey((value) => value + 1)
                }
              }}
              size="toolbar"
              title={`刷新${tab === 'plugins' ? '插件' : '技能'}目录`}
            >
              <RefreshCw
                aria-hidden="true"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </Button>
            <Button
              isIconOnly
              color="ghostSecondary"
              onClick={() => navigate('/settings/plugins')}
              size="toolbar"
              title="管理插件设置"
            >
              <Settings2
                aria-hidden="true"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </Button>
          </div>
        </WorkspaceHeaderItem>
      ) : null}

      {target ? (
        <main className="plugins-details-page tw:h-full tw:w-full tw:min-w-0 tw:overflow-auto tw:bg-app-canvas tw:p-5 tw:@container/plugins-page">
          {selectedPlugin ? (
            <CatalogDetailsView
              busy={busyPluginIds.has(selectedPlugin.id)}
              details={
                selectedPluginDetailsKey ? (pluginDetails[selectedPluginDetailsKey] ?? null) : null
              }
              error={pluginErrors[selectedPlugin.id]}
              item={selectedPlugin}
              kind="plugin"
              key={selectedPluginDetailsKey}
              workspacePath={workspacePath}
              onPrimaryAction={(item, trigger, checked) =>
                void runPluginAction(item, trigger, checked)
              }
              onTryPrompt={tryPluginPrompt}
              onUninstall={
                selectedPlugin.id === 'minimax' ? () => setConfirmMiniMaxUninstall(true) : undefined
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
        </main>
      ) : (
        <PrimaryPageLayout
          className="plugins-primary-page tw:@container/plugins-page"
          scrollContainerRef={scrollRegionRef}
          title={tab === 'plugins' ? '插件' : '技能'}
          description={
            tab === 'plugins'
              ? '在常用工具中扩展 Pidex 的能力。'
              : '查找并添加可复用的工作流指令。'
          }
          search={
            <SearchInput
              aria-label={tab === 'plugins' ? '搜索插件' : '搜索技能'}
              onChange={tab === 'plugins' ? setPluginQuery : setSkillQuery}
              placeholder={tab === 'plugins' ? '搜索插件' : '搜索技能'}
              ref={searchInputRef}
              value={tab === 'plugins' ? pluginQuery : skillQuery}
            />
          }
        >
          <div aria-live="polite" className="plugins-sr-status tw:sr-only">
            {announcement}
          </div>
          {tab === 'plugins' ? (
            <PluginDirectory
              busyPluginIds={busyPluginIds}
              clearFilters={() => {
                setPluginQuery('')
                setPluginCategory('all')
              }}
              groups={pluginGroups}
              loadError={pluginLoadError}
              loading={pluginsLoading}
              onOpenDetails={(item) =>
                openDetails({ kind: 'plugin', id: item.id, tab: 'plugins' })
              }
              onPrimaryAction={(item, trigger, checked) =>
                void runPluginAction(item, trigger, checked)
              }
              pluginErrors={pluginErrors}
              pluginCategory={pluginCategory}
              query={pluginQuery}
              refresh={refreshPlugins}
              setPluginCategory={setPluginCategory}
              total={visiblePlugins.length}
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
        actionDisabled={miniMaxCli.busy}
        actionLabel="卸载并删除登录信息"
        description="将卸载系统中的 MiniMax CLI，并删除它保存的 API Key 或 OAuth 登录信息。"
        onAction={() => void uninstallMiniMaxCli()}
        onCancel={() => setConfirmMiniMaxUninstall(false)}
        open={confirmMiniMaxUninstall}
        title="卸载 MiniMax CLI？"
        tone="danger"
      />
    </>
  )
}

type PluginDirectoryProps = {
  busyPluginIds: Set<string>
  clearFilters: () => void
  groups: ReturnType<typeof groupPluginCatalogBySource>
  loadError: string | null
  loading: boolean
  onOpenDetails: (item: PluginCatalogItem) => void
  onPrimaryAction: (item: PluginCatalogItem, trigger: HTMLButtonElement, checked?: boolean) => void
  pluginCategory: PluginCategoryFilter
  pluginErrors: Record<string, string>
  query: string
  refresh: () => void
  setPluginCategory: (value: PluginCategoryFilter) => void
  total: number
}

function PluginDirectory(props: PluginDirectoryProps): React.ReactNode {
  return (
    <div className="plugins-panel tw:grid tw:min-w-0 tw:gap-8" id="plugins-panel">
      <div className="plugins-directory-navigation tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:@max-[479px]/plugins-page:items-stretch">
        <SegmentedControl
          ariaLabel="插件来源"
          onChange={props.setPluginCategory}
          options={CATEGORY_OPTIONS}
          overflowMode="fit"
          value={props.pluginCategory}
        />
      </div>

      {props.loadError ? (
        <CatalogCallout
          message={props.loadError}
          onRetry={props.refresh}
          title="无法读取可管理插件状态"
        />
      ) : null}

      {props.loading ? (
        <CatalogSkeleton label="正在加载插件目录" />
      ) : props.total === 0 ? (
        <CatalogEmpty
          actionLabel="清除筛选"
          message={props.query ? `没有找到与“${props.query}”匹配的插件。` : '清除来源筛选后再试。'}
          onAction={props.clearFilters}
          title={props.query ? '没有匹配的插件' : '当前筛选没有结果'}
        />
      ) : (
        <div className="plugins-source-groups tw:grid tw:min-w-0 tw:gap-8">
          {props.groups.map((group) => (
            <section
              className="plugins-source-group tw:grid tw:min-w-0 tw:gap-3"
              key={group.category}
            >
              <header className="plugins-section-heading tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3">
                <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">{group.label}</h2>
                <span className="plugins-sr-status tw:sr-only">共 {group.items.length} 项</span>
              </header>
              <ul className="plugins-catalog-grid tw:m-0 tw:grid tw:grid-cols-2 tw:min-w-0 tw:list-none tw:gap-x-7 tw:gap-y-4 tw:p-0 tw:@max-[580px]/plugins-page:grid-cols-1">
                {group.items.map((item) => (
                  <PluginCatalogCard
                    busy={props.busyPluginIds.has(item.id)}
                    error={props.pluginErrors[item.id]}
                    item={item}
                    key={item.id}
                    onOpenDetails={(plugin) => props.onOpenDetails(plugin)}
                    onPrimaryAction={props.onPrimaryAction}
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
      className="plugins-panel tw:grid tw:min-w-0 tw:gap-8"
      id="skills-panel"
    >
      <div className="plugins-directory-navigation tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:@max-[479px]/plugins-page:items-stretch">
        <SegmentedControl
          ariaLabel="技能来源"
          onChange={props.setSkillOwner}
          options={SKILL_OWNER_OPTIONS}
          overflowMode="fit"
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
