import type React from 'react'
import { FileCode2, Package, Plus, RefreshCw, Server } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type {
  DesktopInstalledSkill,
  DesktopMcpRuntimeServerStatus,
  DesktopMcpServerListItem,
  McpReloadResult,
  SaveDesktopMcpServerOptions,
} from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'

import { SearchInput } from '../../../components/ui/SearchInput.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import {
  mergePluginCatalog,
  pluginStatusLabel,
  type PluginCatalogItem,
} from '../../plugins/PluginCatalog.js'
import { PluginDetailsDialog } from '../../plugins/PluginDetailsDialog.js'
import { PluginIcon } from '../../plugins/PluginIcon.js'
import { usePluginCatalog } from '../../plugins/UsePluginCatalog.js'
import {
  BuiltinSkillIcon,
  getBuiltinSkillPresentation,
  isBuiltinSkill,
  skillScopeLabel,
} from '../../plugins/BuiltinSkillPresentation.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { AGENT_LIVE_EVENT_FILTERS } from '../../../services/desktop-client/EventSubscriptionFilters.js'
import { SettingsContentArea } from '../SettingsContentArea.js'
import { ExtensionManagementRow } from './ExtensionManagementRow.js'
import { McpEditorDialog } from './McpEditorDialog.js'
import {
  clearPluginDetailsDeepLink,
  resolvePluginDetailsDeepLink,
} from './PluginDetailsDeepLink.js'
import { SkillDetailsDialog } from './SkillDetailsDialog.js'
import { listRuntimeSkills, setRuntimeSkillEnabled } from './SkillClientAdapter.js'
import { errorMessageOr as errorMessageOf } from '@pidex/shared/errors'

export type PluginsSettingsPageProps = {
  workspacePath: string | null
  onUseSkill: (skill: DesktopInstalledSkill) => void
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

type Tab = 'plugins' | 'mcps' | 'skills'
type McpOAuthAttempt = {
  attemptId: string
  expiresAt: number
}

const VALID_TABS = new Set<Tab>(['plugins', 'mcps', 'skills'])

export function PluginsSettingsPage({
  workspacePath,
  onUseSkill,
  onError,
  onNotice,
}: PluginsSettingsPageProps): React.ReactNode {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const requestedTab = parseTab(searchParams.get('tab'))
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)

  const {
    plugins,
    error: pluginLoadError,
    loading: pluginsLoading,
    refresh: refreshPlugins,
    setEnabled: setPluginEnabled,
  } = usePluginCatalog(workspacePath)
  const [optimisticPluginEnabled, setOptimisticPluginEnabled] = useState<Record<string, boolean>>(
    {},
  )
  const [busyPluginIds, setBusyPluginIds] = useState<Set<string>>(() => new Set())
  const [pluginErrors, setPluginErrors] = useState<Record<string, string>>({})
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null)
  const [pluginDialogOpen, setPluginDialogOpen] = useState(false)
  const [pluginDialogTrigger, setPluginDialogTrigger] = useState<HTMLElement | null>(null)

  const [skills, setSkills] = useState<DesktopInstalledSkill[] | undefined>()
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [busySkillPaths, setBusySkillPaths] = useState<Set<string>>(() => new Set())
  const [selectedSkill, setSelectedSkill] = useState<DesktopInstalledSkill | null>(null)
  const [skillDialogOpen, setSkillDialogOpen] = useState(false)
  const [skillDialogTrigger, setSkillDialogTrigger] = useState<HTMLElement | null>(null)

  const [servers, setServers] = useState<DesktopMcpServerListItem[] | undefined>()
  // Host-managed servers (node_repl) are never user config, so they are shown
  // read-only from runtime status instead of the editable declaration list.
  const [hostServers, setHostServers] = useState<DesktopMcpRuntimeServerStatus[]>([])
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [mcpStatus, setMcpStatus] = useState<string | null>(null)
  const [busyMcpKeys, setBusyMcpKeys] = useState<Set<string>>(() => new Set())
  const [busyMcpAuthKeys, setBusyMcpAuthKeys] = useState<Set<string>>(() => new Set())
  const [mcpOAuthAttempts, setMcpOAuthAttempts] = useState<Record<string, McpOAuthAttempt>>({})
  const [selectedServer, setSelectedServer] = useState<DesktopMcpServerListItem | null>(null)
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false)
  useEffect(() => {
    if (searchParams.get('create') !== 'mcp') return
    setSelectedServer(null)
    setMcpDialogOpen(true)
    setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('create'); return next }, { replace: true })
  }, [searchParams, setSearchParams])
  const [mcpDialogTrigger, setMcpDialogTrigger] = useState<HTMLElement | null>(null)
  const [serverPendingRemoval, setServerPendingRemoval] = useState<DesktopMcpServerListItem | null>(
    null,
  )

  const pluginItems = useMemo(
    () =>
      mergePluginCatalog(
        plugins
          ?.filter((plugin) => plugin.installed)
          .map((plugin) => ({
            ...plugin,
            enabled: optimisticPluginEnabled[plugin.id] ?? plugin.enabled,
          })),
      ),
    [plugins, optimisticPluginEnabled],
  )

  const tabOptions = useMemo(() => {
    const options: Array<{ value: Tab; label: React.ReactNode }> = []
    if (pluginItems.length > 0) {
      options.push({
        value: 'plugins',
        label: (
          <>
            插件 <span aria-hidden="true">{pluginItems.length}</span>
          </>
        ),
      })
    }
    options.push({
      value: 'mcps',
      label: (
        <>
          MCP <span aria-hidden="true">{servers?.length ?? 0}</span>
        </>
      ),
    })
    if (skills === undefined || skills.length > 0 || skillsError) {
      options.push({
        value: 'skills',
        label: (
          <>
            技能 <span aria-hidden="true">{skills?.length ?? '…'}</span>
          </>
        ),
      })
    }
    return options
  }, [pluginItems.length, servers?.length, skills, skillsError])

  const availableTabs = useMemo(
    () => new Set(tabOptions.map((option) => option.value)),
    [tabOptions],
  )
  const tab = availableTabs.has(requestedTab) ? requestedTab : (tabOptions[0]?.value ?? 'mcps')
  const requestedPluginId = searchParams.get('plugin')
  const requestedSkillPath = searchParams.get('skill')
  const detailDeepLink = useMemo(
    () => resolvePluginDetailsDeepLink(searchParams, pluginItems, skills ?? []),
    [pluginItems, searchParams, skills],
  )

  function clearDetailsDeepLink(): void {
    setSearchParams((current) => clearPluginDetailsDeepLink(current), { replace: true })
  }

  function closeDeepLinkedDetails(kind: 'plugin' | 'skill'): void {
    const activeLink = resolvePluginDetailsDeepLink(searchParams, pluginItems, skills ?? [])
    if (activeLink?.kind !== kind) return
    if (activeLink.from) {
      navigate(activeLink.from)
      return
    }
    clearDetailsDeepLink()
  }

  function handlePluginDialogOpenChange(open: boolean): void {
    setPluginDialogOpen(open)
    if (!open) closeDeepLinkedDetails('plugin')
  }

  function handleSkillDialogOpenChange(open: boolean): void {
    setSkillDialogOpen(open)
    if (!open) closeDeepLinkedDetails('skill')
  }

  useEffect(() => {
    if (tab === requestedTab && searchParams.get('tab') === requestedTab) return
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('tab', tab)
        return next
      },
      { replace: true },
    )
  }, [requestedTab, searchParams, setSearchParams, tab])

  useEffect(() => {
    if (!requestedPluginId && !requestedSkillPath) return
    if (requestedPluginId && requestedSkillPath) {
      clearDetailsDeepLink()
      return
    }

    const targetTab: Tab = requestedPluginId ? 'plugins' : 'skills'
    if (tab !== targetTab) {
      clearDetailsDeepLink()
      return
    }
    const catalogReady = requestedPluginId ? !pluginsLoading : skills !== undefined
    if (!catalogReady) return
    if (!detailDeepLink) {
      clearDetailsDeepLink()
      return
    }

    if (detailDeepLink.kind === 'plugin') {
      setSelectedPluginId(detailDeepLink.item.id)
      setPluginDialogTrigger(null)
      setPluginDialogOpen(true)
      return
    }
    setSelectedSkill(detailDeepLink.skill)
    setSkillDialogTrigger(null)
    setSkillDialogOpen(true)
  }, [detailDeepLink, pluginsLoading, requestedPluginId, requestedSkillPath, skills, tab])

  useEffect(() => {
    setMcpOAuthAttempts({})
    void loadSkills(false)
    void loadServers()
    // Initial data should be loaded once for the current workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath])

  useEffect(() => {
    return desktopClient.subscribeAgentEventEnvelopes(
      {
        liveEventTypes: AGENT_LIVE_EVENT_FILTERS.mcp,
      },
      async (events) => {
        if (events.some((event) => event.type === 'mcp/updated')) await loadServers()
      },
    )
    // Reconcile the currently selected workspace whenever the Agent catalog changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath])

  useEffect(() => {
    const attempts = Object.entries(mcpOAuthAttempts)
    if (!attempts.length) return
    let cancelled = false
    const timer = window.setInterval(() => {
      void Promise.all(
        attempts.map(async ([key, attempt]) => {
          if (Date.now() >= attempt.expiresAt) {
            if (!cancelled) {
              setMcpOAuthAttempts((current) => withoutRecordKey(current, key))
              setMcpError('MCP OAuth 授权已过期，请重试。')
            }
            return
          }
          try {
            const status = await desktopClient.getMcpOAuthStatus(attempt.attemptId)
            if (cancelled || status.state === 'pending') return
            setMcpOAuthAttempts((current) => withoutRecordKey(current, key))
            if (status.state === 'completed') {
              onNotice?.('MCP OAuth 登录成功。')
              await reloadMcpConfiguration()
              await loadServers()
              return
            }
            const message =
              status.error?.message ??
              (status.state === 'expired'
                ? 'MCP OAuth 授权已过期，请重试。'
                : 'MCP OAuth 登录失败。')
            setMcpError(message)
            onError(message)
          } catch (error) {
            if (cancelled) return
            const message = errorMessageOf(error, 'MCP OAuth 状态读取失败。')
            setMcpOAuthAttempts((current) => withoutRecordKey(current, key))
            setMcpError(message)
            onError(message)
          }
        }),
      )
    }, 1_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [mcpOAuthAttempts, onError, onNotice, workspacePath])

  useEffect(() => {
    if (pluginLoadError) onError(pluginLoadError)
  }, [onError, pluginLoadError])

  useEffect(() => {
    function focusSearch(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  async function loadSkills(forceReload: boolean): Promise<void> {
    setSkillsError(null)
    try {
      const result = await listRuntimeSkills(workspacePath, forceReload)
      if (result.state === 'unavailable') {
        setSkills([])
        setSkillsError(result.error)
        return
      }
      setSkills([...result.data])
      if (result.state === 'stale') setSkillsError(result.error)
    } catch (error) {
      const message = errorMessageOf(error, '技能列表读取失败。')
      setSkills([])
      setSkillsError(message)
      onError(message)
    }
  }

  async function loadServers(): Promise<void> {
    setMcpError(null)
    try {
      const [declarations, runtime] = await Promise.all([
        desktopClient.listMcpServers(workspacePath ?? undefined),
        desktopClient.getMcpRuntimeStatus(workspacePath ?? undefined),
      ])
      const statuses = new Map(
        runtime.servers.map((status) => [`${status.scope}:${status.name}`, status]),
      )
      setHostServers(runtime.servers.filter((status) => status.managedBy === 'host'))
      setServers(
        declarations.map((server) => ({
          ...server,
          runtime: statuses.get(mcpKey(server)),
        })),
      )
    } catch (error) {
      const message = errorMessageOf(error, 'MCP server 读取失败。')
      setServers([])
      setHostServers([])
      setMcpError(message)
      onError(message)
    }
  }

  async function refreshCurrentTab(): Promise<void> {
    if (tab === 'plugins') refreshPlugins()
    if (tab === 'skills') await loadSkills(true)
    if (tab === 'mcps') await loadServers()
  }

  function selectTab(nextTab: Tab): void {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('tab', nextTab)
      return next
    })
  }

  async function togglePlugin(item: PluginCatalogItem, enabled: boolean): Promise<void> {
    if (!item.installed || busyPluginIds.has(item.id)) return
    setBusyPluginIds((current) => new Set(current).add(item.id))
    setPluginErrors((current) => ({ ...current, [item.id]: '' }))
    setOptimisticPluginEnabled((current) => ({
      ...current,
      [item.id]: enabled,
    }))
    try {
      await setPluginEnabled(item.id, enabled)
      onNotice?.(`${item.name} 已${enabled ? '启用' : '禁用'}。`)
    } catch (error) {
      const message = errorMessageOf(error, `${item.name} 状态更新失败。`)
      setPluginErrors((current) => ({ ...current, [item.id]: message }))
      onError(message)
    } finally {
      setOptimisticPluginEnabled((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      setBusyPluginIds((current) => without(current, item.id))
    }
  }

  async function toggleSkill(skill: DesktopInstalledSkill, enabled: boolean): Promise<void> {
    if (busySkillPaths.has(skill.path)) return
    const previous = skills
    setBusySkillPaths((current) => new Set(current).add(skill.path))
    setSkills((current) =>
      current?.map((item) => (item.path === skill.path ? { ...item, enabled } : item)),
    )
    try {
      const updated = await setRuntimeSkillEnabled(skill.path, enabled)
      setSkills((current) => current?.map((item) => (item.path === updated.path ? updated : item)))
      setSelectedSkill((current) =>
        current?.path === skill.path ? { ...current, enabled } : current,
      )
      onNotice?.(`${skill.name} 已${enabled ? '启用' : '禁用'}，将在下一轮任务生效。`)
    } catch (error) {
      setSkills(previous)
      const message = errorMessageOf(error, `${skill.name} 状态更新失败。`)
      onError(message)
      if (looksLikeMissingResource(error)) void loadSkills(true)
    } finally {
      setBusySkillPaths((current) => without(current, skill.path))
    }
  }

  async function toggleServer(server: DesktopMcpServerListItem, enabled: boolean): Promise<void> {
    const key = mcpKey(server)
    if (!server.editable || busyMcpKeys.has(key)) return
    const previous = servers
    setBusyMcpKeys((current) => new Set(current).add(key))
    setServers((current) =>
      current?.map((item) => (mcpKey(item) === key ? { ...item, enabled } : item)),
    )
    try {
      setServers(
        await desktopClient.setMcpServerEnabled(
          server.name,
          server.scope,
          enabled,
          workspacePath ?? undefined,
        ),
      )
    } catch (error) {
      setServers(previous)
      const message = errorMessageOf(error, `${server.name} 状态更新失败。`)
      setMcpError(message)
      onError(message)
      return
    } finally {
      setBusyMcpKeys((current) => without(current, key))
    }
    await reloadMcpConfiguration()
    await loadServers()
  }

  async function saveServer(options: SaveDesktopMcpServerOptions): Promise<void> {
    const key = `${options.scope}:${options.name}`
    setBusyMcpKeys((current) => new Set(current).add(key))
    setMcpError(null)
    try {
      setServers(
        await desktopClient.saveMcpServer({
          ...options,
          ...(workspacePath ? { workspacePath } : {}),
        }),
      )
      setMcpDialogOpen(false)
      await reloadMcpConfiguration()
      await loadServers()
    } catch (error) {
      const message = errorMessageOf(error, 'MCP server 保存失败。')
      setMcpError(message)
      onError(message)
    } finally {
      setBusyMcpKeys((current) => without(current, key))
    }
  }

  async function removeServer(server: DesktopMcpServerListItem): Promise<void> {
    if (!server.removable) return
    const key = mcpKey(server)
    setBusyMcpKeys((current) => new Set(current).add(key))
    setMcpError(null)
    try {
      setServers(
        await desktopClient.removeMcpServer(server.name, server.scope, workspacePath ?? undefined),
      )
      setServerPendingRemoval(null)
      await reloadMcpConfiguration()
      await loadServers()
    } catch (error) {
      const message = errorMessageOf(error, 'MCP server 删除失败。')
      setMcpError(message)
      onError(message)
    } finally {
      setBusyMcpKeys((current) => without(current, key))
    }
  }

  async function reloadMcpConfiguration(): Promise<void> {
    try {
      const result = await desktopClient.reloadMcpConfiguration(workspacePath ?? undefined)
      const message = reloadStatusText(result)
      setMcpStatus(message)
      onNotice?.(message)
    } catch {
      setMcpStatus('配置已保存；当前会话未能立即刷新，将在下次启动时生效。')
    }
  }

  async function startMcpOAuth(server: DesktopMcpServerListItem): Promise<void> {
    const key = mcpKey(server)
    if (busyMcpAuthKeys.has(key) || mcpOAuthAttempts[key]) return
    setBusyMcpAuthKeys((current) => new Set(current).add(key))
    setMcpError(null)
    try {
      const attempt = await desktopClient.startMcpOAuth(
        server.name,
        server.scope,
        workspacePath ?? undefined,
      )
      setMcpOAuthAttempts((current) => ({
        ...current,
        [key]: {
          attemptId: attempt.attemptId,
          expiresAt: attempt.expiresAt,
        },
      }))
      await desktopClient.openExternalURL(attempt.authorizationUrl)
      onNotice?.('已打开 MCP OAuth 授权页面，正在等待授权完成。')
    } catch (error) {
      const message = errorMessageOf(error, '无法启动 MCP OAuth 登录。')
      setMcpError(message)
      onError(message)
    } finally {
      setBusyMcpAuthKeys((current) => without(current, key))
    }
  }

  async function logoutMcpOAuth(server: DesktopMcpServerListItem): Promise<void> {
    const key = mcpKey(server)
    if (busyMcpAuthKeys.has(key)) return
    setBusyMcpAuthKeys((current) => new Set(current).add(key))
    setMcpError(null)
    try {
      await desktopClient.logoutMcpOAuth(server.name, server.scope, workspacePath ?? undefined)
      onNotice?.(`${server.name} 已退出 OAuth 登录。`)
      await reloadMcpConfiguration()
      await loadServers()
    } catch (error) {
      const message = errorMessageOf(error, 'MCP OAuth 退出失败。')
      setMcpError(message)
      onError(message)
    } finally {
      setBusyMcpAuthKeys((current) => without(current, key))
    }
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visiblePlugins = pluginItems.filter((item) =>
    matchesQuery(normalizedQuery, item.name, item.description),
  )
  const visibleSkills = (skills ?? []).filter((skill) =>
    matchesQuery(
      normalizedQuery,
      skill.name,
      skill.description,
      skill.shortDescription,
      skillScopeLabel(skill.scope),
    ),
  )
  const visibleServers = (servers ?? []).filter((server) =>
    matchesQuery(
      normalizedQuery,
      server.name,
      server.summary,
      server.type,
      server.scope,
      server.runtime?.state,
      server.runtime?.auth.source,
    ),
  )
  const selectedPlugin = selectedPluginId
    ? (pluginItems.find((item) => item.id === selectedPluginId) ?? null)
    : null
  const tabError = tab === 'plugins' ? pluginLoadError : tab === 'skills' ? skillsError : mcpError
  const loading =
    tab === 'plugins'
      ? pluginsLoading
      : tab === 'skills'
        ? skills === undefined
        : servers === undefined

  return (
    <SettingsContentArea className="plugins-settings-page">
      <div className="settings-content-inner plugins-settings-content tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <header className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-page-title tw:text-app-text">
            插件
          </h2>
          <p className="settings-page-desc tw:m-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm">
            管理插件、技能和 MCP
          </p>
        </header>

        <div className="settings-management-toolbar plugins-settings-toolbar">
          <SegmentedControl
            ariaLabel="管理扩展"
            value={tab}
            options={tabOptions}
            onChange={selectTab}
            semantics="tabs"
            getTabId={(value) => `plugins-settings-tab-${value}`}
            getPanelId={(value) => `plugins-settings-panel-${value}`}
          />
          <div className="settings-management-toolbar-actions plugins-settings-toolbar-actions">
            <SearchInput
              ref={searchRef}
              aria-label={searchPlaceholder(tab)}
              className="tw:w-72 tw:max-w-full tw:max-[1023px]:w-full"
              placeholder={searchPlaceholder(tab)}
              value={query}
              onChange={setQuery}
            />
            <Button
              isIconOnly
              color="ghostSecondary"
              size="toolbar"
              title={`刷新${tabLabel(tab)}`}
              onClick={() => void refreshCurrentTab()}
            >
              <RefreshCw
                aria-hidden="true"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </Button>
            {tab === 'mcps' ? (
              <Button
                color="primary"
                onClick={(event) => {
                  setSelectedServer(null)
                  setMcpDialogTrigger(event.currentTarget)
                  setMcpDialogOpen(true)
                }}
              >
                <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                新增
              </Button>
            ) : null}
          </div>
        </div>

        {tabError ? (
          <div
            className="tw:type-body-sm tw:mb-4 tw:flex tw:items-center tw:justify-between tw:gap-3 tw:border tw:border-app-border tw:bg-app-panel tw:px-3 tw:py-2 tw:text-app-danger"
            role="alert"
          >
            <span>{tabError}</span>
            <Button color="secondary" onClick={() => void refreshCurrentTab()}>
              重试
            </Button>
          </div>
        ) : null}
        {tab === 'mcps' && mcpStatus ? (
          <p className="tw:type-body-sm tw:mt-0 tw:mb-4 tw:text-app-text-soft" role="status">
            {mcpStatus}
          </p>
        ) : null}

        <section
          aria-labelledby={`plugins-settings-tab-${tab}`}
          className="settings-management-list plugins-settings-list"
          id={`plugins-settings-panel-${tab}`}
          role="tabpanel"
        >
          {loading ? (
            <LoadingRows />
          ) : tab === 'plugins' ? (
            visiblePlugins.length ? (
              visiblePlugins.map((item) => (
                <ExtensionManagementRow
                  key={item.id}
                  title={item.name}
                  description={pluginErrors[item.id] || item.description}
                  icon={
                    <PluginIcon
                      plugin={{ ...item, workspacePath }}
                      logoDarkSource={item.logoDarkSource}
                      logoSource={item.logoSource}
                      name={item.iconName}
                    />
                  }
                  metadata={pluginStatusLabel(item)}
                  dimmed={item.status === 'disabled'}
                  onActivate={(trigger) => {
                    setSelectedPluginId(item.id)
                    setPluginDialogTrigger(trigger)
                    setPluginDialogOpen(true)
                  }}
                  actions={
                    item.status === 'enabled' || item.status === 'disabled' ? (
                      <ToggleSwitch
                        ariaLabel={item.name}
                        checked={item.status === 'enabled'}
                        disabled={busyPluginIds.has(item.id)}
                        onChange={(enabled) => void togglePlugin(item, enabled)}
                      />
                    ) : item.category === 'manageable' ? (
                      <Button color="secondary" onClick={refreshPlugins}>
                        重试
                      </Button>
                    ) : null
                  }
                />
              ))
            ) : (
              <EmptyState label="没有匹配的插件。" />
            )
          ) : tab === 'skills' ? (
            visibleSkills.length ? (
              visibleSkills.map((skill) => (
                <ExtensionManagementRow
                  key={skill.path}
                  title={skill.name}
                  description={skill.shortDescription || skill.description || '未提供技能说明。'}
                  icon={
                    getBuiltinSkillPresentation(skill) ? (
                      <BuiltinSkillIcon size={14} skill={skill} />
                    ) : (
                      <FileCode2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    )
                  }
                  metadata={skillScopeLabel(skill.scope)}
                  dimmed={!skill.enabled}
                  onActivate={(trigger) => {
                    setSelectedSkill(skill)
                    setSkillDialogTrigger(trigger)
                    setSkillDialogOpen(true)
                  }}
                  actions={
                    <ToggleSwitch
                      ariaLabel={skill.name}
                      checked={skill.enabled}
                      disabled={busySkillPaths.has(skill.path)}
                      onChange={(enabled) => void toggleSkill(skill, enabled)}
                    />
                  }
                />
              ))
            ) : (
              <EmptyState label={query ? '没有匹配的技能。' : '当前范围内没有技能。'} />
            )
          ) : hostServers.length || visibleServers.length ? (
            <>
              {hostServers.map((status) => (
                <ExtensionManagementRow
                  key={`host:${status.name}`}
                  title={status.name}
                  description="由 Computer Use 插件启用，宿主提供，不可编辑。"
                  icon={<Server size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
                  metadata={
                    <HostManagedMcpBadge state={status.state} toolCount={status.toolCount} />
                  }
                  dimmed={status.state !== 'connected'}
                />
              ))}
              {visibleServers.map((server) => (
                <ExtensionManagementRow
                  key={mcpKey(server)}
                  title={server.name}
                  description={
                    server.runtime?.error?.message || server.summary || '未提供命令或 URL。'
                  }
                  icon={<Server size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
                  metadata={mcpMetadata(server)}
                  dimmed={!server.enabled || !server.effective}
                  onActivate={(trigger) => {
                    setSelectedServer(server)
                    setMcpDialogTrigger(trigger)
                    setMcpDialogOpen(true)
                  }}
                  actions={
                    <>
                      {mcpAuthAction(
                        server,
                        mcpOAuthAttempts[mcpKey(server)],
                        busyMcpAuthKeys.has(mcpKey(server)),
                        {
                          login: () => void startMcpOAuth(server),
                          logout: () => void logoutMcpOAuth(server),
                        },
                      )}
                      <ToggleSwitch
                        ariaLabel={server.name}
                        checked={server.enabled}
                        disabled={!server.editable || busyMcpKeys.has(mcpKey(server))}
                        onChange={(enabled) => void toggleServer(server, enabled)}
                      />
                    </>
                  }
                />
              ))}
            </>
          ) : (
            <EmptyState label={query ? '没有匹配的 MCP server。' : '暂无 MCP server。'} />
          )}
        </section>
      </div>

      <PluginDetailsDialog
        workspacePath={workspacePath}
        onChanged={refreshPlugins}
        item={selectedPlugin}
        open={pluginDialogOpen}
        busy={selectedPlugin ? busyPluginIds.has(selectedPlugin.id) : false}
        error={selectedPlugin ? pluginErrors[selectedPlugin.id] : null}
        restoreFocusElement={pluginDialogTrigger}
        onOpenChange={handlePluginDialogOpenChange}
        onPrimaryAction={(item, trigger, checked) => {
          if (checked !== undefined && (item.status === 'enabled' || item.status === 'disabled')) {
            void togglePlugin(item, checked).finally(() => {
              window.requestAnimationFrame(() => {
                if (trigger.isConnected) trigger.focus()
              })
            })
          }
        }}
      />
      <SkillDetailsDialog
        workspacePath={workspacePath}
        skill={selectedSkill}
        open={skillDialogOpen}
        restoreFocusElement={skillDialogTrigger}
        onOpenChange={handleSkillDialogOpenChange}
        onOpenSkill={(skill) => {
          if (isBuiltinSkill(skill)) return
          void desktopClient.openPathWithDefaultTarget(skill.path).catch((error) => {
            onError(errorMessageOf(error, '无法打开技能文件。'))
          })
        }}
        onUseSkill={(skill) => {
          setSkillDialogOpen(false)
          onUseSkill(skill)
        }}
        onError={onError}
      />
      <McpEditorDialog
        open={mcpDialogOpen}
        server={selectedServer}
        busy={selectedServer ? busyMcpKeys.has(mcpKey(selectedServer)) : busyMcpKeys.size > 0}
        restoreFocusElement={mcpDialogTrigger}
        onOpenChange={setMcpDialogOpen}
        onSave={saveServer}
        workspaceAvailable={Boolean(workspacePath)}
        onRemove={(server) => {
          setMcpDialogOpen(false)
          setServerPendingRemoval(server)
        }}
        onOpenDocumentation={() => {
          void desktopClient.openExternalURL(
            'https://learn.chatgpt.com/docs/extend/mcp?surface=app',
          )
        }}
        onError={(message) => {
          setMcpError(message)
          onError(message)
        }}
      />
      <ConfirmationDialog
        open={Boolean(serverPendingRemoval)}
        title="删除 MCP server？"
        description={
          serverPendingRemoval
            ? `将删除“${serverPendingRemoval.name}”的配置。此操作无法撤销。`
            : undefined
        }
        actionLabel="删除"
        tone="danger"
        actionDisabled={
          serverPendingRemoval ? busyMcpKeys.has(mcpKey(serverPendingRemoval)) : false
        }
        onCancel={() => setServerPendingRemoval(null)}
        onAction={() => {
          if (serverPendingRemoval) void removeServer(serverPendingRemoval)
        }}
      />
    </SettingsContentArea>
  )
}

function LoadingRows(): React.ReactNode {
  return (
    <div aria-label="正在加载" className="settings-management-loading" role="status">
      {[0, 1, 2, 3].map((index) => (
        <div
          aria-hidden="true"
          className="settings-management-loading-row tw:animate-pulse tw:motion-reduce:animate-none"
          key={index}
        />
      ))}
    </div>
  )
}

function EmptyState({ label }: { label: string }): React.ReactNode {
  return (
    <div className="settings-management-empty">
      <span className="tw:grid tw:justify-items-center tw:gap-3">
        <Package aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        {label}
      </span>
    </div>
  )
}

function parseTab(value: string | null): Tab {
  return value && VALID_TABS.has(value as Tab) ? (value as Tab) : 'plugins'
}

function tabLabel(tab: Tab): string {
  if (tab === 'mcps') return 'MCP'
  if (tab === 'skills') return '技能'
  return '插件'
}

function searchPlaceholder(tab: Tab): string {
  return `搜索${tabLabel(tab)}`
}

function matchesQuery(query: string, ...values: Array<string | undefined>): boolean {
  if (!query) return true
  return values.some((value) => value?.toLocaleLowerCase().includes(query))
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  )
}

function without(values: Set<string>, value: string): Set<string> {
  const next = new Set(values)
  next.delete(value)
  return next
}

function mcpKey(server: DesktopMcpServerListItem): string {
  return `${server.scope}:${server.name}`
}

function reloadStatusText(result: McpReloadResult): string {
  const parts: string[] = []
  if (result.added.length) parts.push(`新增 ${result.added.length} 个连接`)
  if (result.replaced.length) parts.push(`替换 ${result.replaced.length} 个连接`)
  if (result.removed.length) parts.push(`移除 ${result.removed.length} 个连接`)
  if (result.unchanged.length) parts.push(`${result.unchanged.length} 个连接未变化`)
  if (result.failed.length) parts.push(`${result.failed.length} 个连接失败`)
  return parts.join('；') || '配置已保存，将在下一轮任务生效'
}

function mcpMetadata(server: DesktopMcpServerListItem): React.ReactNode {
  const source = server.scope === 'local' ? '工作区' : '用户'
  if (!server.effective) {
    return (
      <span className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-1.5 tw:max-[640px]:justify-start">
        <span>
          {source} · {server.type}
        </span>
        {server.diagnosticContext ? <DiagnosticContextBadge /> : null}
        <StatusBadge state="shadowed" label="被工作区配置覆盖" />
      </span>
    )
  }
  const runtime = server.runtime
  if (!runtime) {
    return (
      <span className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-1.5 tw:max-[640px]:justify-start">
        <span>
          {source} · {server.type}
        </span>
        {server.diagnosticContext ? <DiagnosticContextBadge /> : null}
      </span>
    )
  }
  const status: Record<typeof runtime.state, string> = {
    connected: '已连接',
    starting: '正在连接',
    needs_auth: '需要认证',
    failed: '连接失败',
    disabled: '已禁用',
    shadowed: '被覆盖',
  }
  const counts =
    runtime.state === 'connected'
      ? `${runtime.toolCount} 工具 · ${runtime.resourceCount} 资源 · ${runtime.promptCount} Prompt`
      : null
  return (
    <span className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-1.5 tw:max-[640px]:justify-start">
      <span>
        {source} · {server.type}
      </span>
      {server.diagnosticContext ? <DiagnosticContextBadge /> : null}
      {runtime.auth.source !== 'none' ? <AuthSourceBadge source={runtime.auth.source} /> : null}
      <StatusBadge state={runtime.state} label={status[runtime.state]} />
      {counts ? <span>{counts}</span> : null}
    </span>
  )
}

function AuthSourceBadge({ source }: { source: 'environment' | 'oauth' }): React.ReactNode {
  return (
    <span className="tw:type-caption tw:inline-flex tw:bg-app-panel tw:px-2 tw:py-0.5 tw:text-app-text-soft">
      {source === 'oauth' ? 'OAuth' : '环境凭据'}
    </span>
  )
}

function mcpAuthAction(
  server: DesktopMcpServerListItem,
  attempt: McpOAuthAttempt | undefined,
  busy: boolean,
  actions: { login: () => void; logout: () => void },
): React.ReactNode {
  if (!server.effective || !server.enabled || !server.runtime) return null
  if (attempt) {
    return (
      <Button color="primary" disabled loading title="等待 OAuth 授权">
        等待授权
      </Button>
    )
  }
  if (server.runtime.auth.canLogout) {
    return (
      <Button color="danger" disabled={busy} loading={busy} onClick={actions.logout}>
        退出登录
      </Button>
    )
  }
  if (server.runtime.auth.canLogin) {
    return (
      <Button color="primary" disabled={busy} loading={busy} onClick={actions.login}>
        登录
      </Button>
    )
  }
  return null
}

function withoutRecordKey<T>(values: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...next } = values
  return next
}

/** Read-only status for a host-managed server such as node_repl. */
function HostManagedMcpBadge({
  state,
  toolCount,
}: {
  state: DesktopMcpRuntimeServerStatus['state']
  toolCount: number
}): React.ReactNode {
  const label: Record<typeof state, string> = {
    connected: '已连接',
    starting: '正在启动',
    needs_auth: '需要认证',
    failed: '不可用',
    disabled: '已禁用',
    shadowed: '被覆盖',
  }
  return (
    <span className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-1.5 tw:max-[640px]:justify-start">
      <span className="tw:type-caption tw:inline-flex tw:bg-app-panel tw:px-2 tw:py-0.5 tw:text-app-text-soft">
        宿主提供
      </span>
      <StatusBadge state={state} label={label[state]} />
      {state === 'connected' ? <span>{toolCount} 工具</span> : null}
    </span>
  )
}

function DiagnosticContextBadge(): React.ReactNode {
  return (
    <span className="tw:type-caption tw:inline-flex tw:bg-app-panel tw:px-2 tw:py-0.5 tw:text-app-text-soft">
      会话诊断
    </span>
  )
}

function StatusBadge({
  state,
  label,
}: {
  state: NonNullable<DesktopMcpServerListItem['runtime']>['state']
  label: string
}): React.ReactNode {
  const tone =
    state === 'connected'
      ? 'tw:bg-app-success/15 tw:text-app-success'
      : state === 'failed' || state === 'needs_auth'
        ? 'tw:bg-app-danger/15 tw:text-app-danger'
        : 'tw:bg-app-panel tw:text-app-text-soft'
  return <span className={`tw:type-caption tw:inline-flex tw:px-2 tw:py-0.5 ${tone}`}>{label}</span>
}

function looksLikeMissingResource(error: unknown): boolean {
  const message = errorMessageOf(error, '').toLocaleLowerCase()
  return message.includes('not found') || message.includes('不存在')
}
