import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand/react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderCog,
  GitBranch,
  GitFork,
  Settings2,
} from 'lucide-react'
import type { DesktopWorkspace } from '../../../../shared/Types.js'
import {
  APP_ICON_SIZE,
  APP_ICON_SIZES,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import { Popover } from '../../../components/ui/floating/Popover.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { SidebarRow } from '../../../components/ui/SidebarRow.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { cx } from '../../../utils/Cx.js'
import {
  environmentDomainClient,
  type EnvironmentDomainClient,
} from '../../../services/desktop-client/EnvironmentDomainClient.js'
import { composerDraftStore } from './ComposerDraftStore.js'
import type { ComposerDraftKey, ComposerLaunchSettings } from './ComposerTypes.js'
import { BranchOptionRow } from './BranchSelectPopover.js'
import {
  composerLaunchProjectKey,
  isComposerLaunchGitWorkspace,
  readComposerLaunchSettings,
  resolveComposerLaunchBranch,
} from './ComposerLaunch.js'
import {
  selectComposerProjectEnvironment,
  selectedComposerEnvironmentId,
  type ComposerEnvironmentCatalog,
} from './ComposerEnvironmentSelection.js'

type ComposerLaunchCapabilities = Awaited<
  ReturnType<EnvironmentDomainClient['sessionCreationCapabilities']>
>

type Props = {
  draftKey: ComposerDraftKey
  workspace: DesktopWorkspace | null
  currentBranchName: string
  /** 跳转已有项目环境设置页；由上层提供导航，保持菜单可独立渲染。 */
  onOpenEnvironmentSettings?: (projectId: string) => void
}

type View = 'settings' | 'branch' | 'environment'

const CONTENT_CLASS =
  'popover-surface popover tw:z-popover tw:grid tw:w-[min(320px,calc(100vw-16px))] tw:max-h-[min(480px,calc(100vh-96px))] tw:gap-1 tw:overflow-hidden tw:p-1.5 tw:text-app-text'
const NOTE_CLASS = 'tw:m-0 tw:px-2 tw:pb-1 tw:text-app-text-meta tw:type-caption'
const DIVIDER_CLASS = 'tw:my-1 tw:h-px tw:w-full tw:bg-app-border-subtle'
const LIST_CLASS =
  'branch-popover-list-scroll tw:grid tw:max-h-[min(260px,calc(100vh-220px))] tw:gap-px tw:overflow-y-auto tw:overscroll-contain'

/**
 * 首页发起前的执行位置设置：新建工作树开关、待使用分支与项目环境。
 * 分支与开关只写入草稿，发送时才通过会话创建链路生效。
 */
export function ComposerLaunchSettingsPopover({
  draftKey,
  workspace,
  currentBranchName,
  onOpenEnvironmentSettings,
}: Props): React.ReactNode {
  // 浏览器预览与桌面主进程都只需在打开菜单后建立一次环境域连接。
  const clientRef = useRef<EnvironmentDomainClient | null>(null)
  const ensureClient = useCallback((): EnvironmentDomainClient => {
    clientRef.current ??= environmentDomainClient()
    return clientRef.current
  }, [])
  const draft = useStore(composerDraftStore.store, (state) => state.drafts[draftKey])
  const projectKey = composerLaunchProjectKey(workspace)
  const projectId = workspace?.projectId ?? null
  const settings = readComposerLaunchSettings(
    draft ?? composerDraftStore.get(draftKey),
    projectKey,
  )
  const gitAvailable = isComposerLaunchGitWorkspace(workspace)
  const pendingBranch = resolveComposerLaunchBranch(settings, workspace)
  const branchOptions = useMemo(() => {
    const values = new Set<string>()
    for (const branch of workspace?.branches ?? []) {
      if (branch.trim()) values.add(branch)
    }
    if (currentBranchName && currentBranchName !== '未检测到 Git 分支') {
      values.add(currentBranchName)
    }
    return [...values]
  }, [currentBranchName, workspace?.branches])

  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('settings')
  const [branchSearch, setBranchSearch] = useState('')
  const [capabilities, setCapabilities] = useState<ComposerLaunchCapabilities | null>(null)
  const [environmentCatalog, setEnvironmentCatalog] = useState<ComposerEnvironmentCatalog | null>(
    null,
  )
  const [environmentLoading, setEnvironmentLoading] = useState(false)
  const [environmentError, setEnvironmentError] = useState<string | null>(null)
  const environmentRequestRef = useRef(0)

  const updateSettings = useCallback(
    (next: ComposerLaunchSettings): void => {
      if (!projectKey) return
      composerDraftStore.setLaunchSettings(draftKey, projectKey, next)
    },
    [draftKey, projectKey],
  )

  useEffect(() => {
    if (!open) return
    let active = true
    void ensureClient().sessionCreationCapabilities().then(
      (value) => {
        if (active) setCapabilities(value)
      },
      () => {
        if (active) setCapabilities({ explicitExecution: false, environments: false })
      },
    )
    return () => {
      active = false
    }
  }, [ensureClient, open])

  const reloadEnvironments = useCallback(async (): Promise<void> => {
    if (!projectId || !capabilities?.environments) return
    const request = ++environmentRequestRef.current
    setEnvironmentLoading(true)
    try {
      const catalog = await ensureClient().listProjectEnvironments(projectId)
      if (request !== environmentRequestRef.current) return
      setEnvironmentCatalog(catalog)
      setEnvironmentError(null)
    } catch (cause) {
      if (request !== environmentRequestRef.current) return
      setEnvironmentCatalog(null)
      setEnvironmentError(cause instanceof Error ? cause.message : '环境不可用')
    } finally {
      if (request === environmentRequestRef.current) setEnvironmentLoading(false)
    }
  }, [capabilities?.environments, ensureClient, projectId])

  useEffect(() => {
    setEnvironmentCatalog(null)
    setEnvironmentError(null)
    environmentRequestRef.current += 1
  }, [projectId])

  useEffect(() => {
    if (!open || view !== 'environment') return
    void reloadEnvironments()
  }, [open, view, reloadEnvironments])

  useEffect(() => {
    if (!open) {
      setView('settings')
      setBranchSearch('')
    }
  }, [open])

  const explicitExecutionSupported = capabilities?.explicitExecution === true
  const branchDisabledReason = !projectKey
    ? '请先选择项目'
    : !gitAvailable
      ? '当前项目不是 Git 仓库'
      : !capabilities
        ? '正在检查 Agent 能力…'
        : !explicitExecutionSupported
          ? '当前 Agent 不支持指定执行位置，沿用项目默认设置'
          : branchOptions.length === 0
            ? '当前项目没有可用分支'
            : null
  const worktreeDisabledReason = !projectKey
    ? '请先选择项目'
    : !gitAvailable
      ? '当前项目不是 Git 仓库'
      : !capabilities
        ? '正在检查 Agent 能力…'
        : !explicitExecutionSupported
          ? '当前 Agent 不支持指定执行位置'
          : !pendingBranch
            ? '请先选择分支'
            : null
  const environmentDisabledReason = !projectId
    ? '当前项目暂不支持环境设置'
    : !capabilities
      ? '正在检查 Agent 能力…'
      : !capabilities.environments
        ? '当前 Agent 不支持多环境设置'
        : null
  // 只列出已保存的有效环境；默认项回退到列表首项。
  const selectableEnvironments = useMemo<ComposerEnvironmentCatalog | null>(
    () =>
      environmentCatalog
        ? {
            ...environmentCatalog,
            environments: environmentCatalog.environments.filter(
              (environment) => environment.exists && !environment.invalid,
            ),
          }
        : null,
    [environmentCatalog],
  )
  const selectedEnvironmentId = selectedComposerEnvironmentId(selectableEnvironments)
  const selectedEnvironment =
    selectableEnvironments?.environments.find((item) => item.id === selectedEnvironmentId) ?? null
  const environmentValue = environmentError
    ? '不可用'
    : environmentLoading && !environmentCatalog
      ? '加载中…'
      : (selectedEnvironment?.name ?? '暂无环境')

  const visibleBranches = useMemo(() => {
    const keyword = branchSearch.trim().toLowerCase()
    if (!keyword) return branchOptions
    return branchOptions.filter((branch) => branch.toLowerCase().includes(keyword))
  }, [branchOptions, branchSearch])

  async function selectEnvironment(environmentId: string): Promise<void> {
    if (!projectId) return
    try {
      const catalog = await selectComposerProjectEnvironment({
        client: ensureClient(),
        projectId,
        environmentId,
      })
      setEnvironmentCatalog(catalog)
      setEnvironmentError(null)
      setView('settings')
    } catch (cause) {
      setEnvironmentError(cause instanceof Error ? cause.message : '环境切换失败')
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip content="配置本地环境" side="top" disabled={open}>
        <Popover.Trigger asChild>
          <Button
            isIconOnly
            active={open}
            aria-label="配置本地环境"
            color={open ? 'ghostActive' : 'ghostSecondary'}
            size="composer"
            onClick={() => setView('settings')}
          >
            <Settings2 size={APP_ICON_SIZE} />
          </Button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          align="end"
          className={CONTENT_CLASS}
          collisionPadding={8}
          side="top"
          sideOffset={6}
          variant="unstyled"
          aria-label="配置本地环境"
          onEscapeKeyDown={(event) => {
            if (view === 'settings') return
            event.preventDefault()
            setView('settings')
          }}
        >
          {view === 'settings' ? (
            <>
              <div className="popover-header tw:px-2 tw:pt-1 tw:pb-0.5">配置本地环境</div>
              <SidebarRow
                className="popover-item"
                leading={
                  <span className="popover-item-icon">
                    <GitFork size={APP_ICON_SIZE} />
                  </span>
                }
                trailing={
                  <ToggleSwitch
                    ariaLabel="新建工作树"
                    checked={settings.createWorktree}
                    disabled={worktreeDisabledReason !== null}
                    onChange={(checked) =>
                      updateSettings({ ...settings, createWorktree: checked })
                    }
                  />
                }
              >
                <span className="popover-item-label">新建工作树</span>
              </SidebarRow>
              <p className={NOTE_CLASS}>
                {worktreeDisabledReason ??
                  (settings.createWorktree
                    ? `从 ${pendingBranch ?? '所选分支'} 创建托管工作树，不复制本地未提交修改。`
                    : '关闭时使用项目本地目录。')}
              </p>
              <div className={DIVIDER_CLASS} />
              <SidebarRow
                asChild
                className="popover-item"
                leading={
                  <span className="popover-item-icon">
                    <GitBranch size={APP_ICON_SIZE} />
                  </span>
                }
                trailing={
                  <ChevronRight
                    aria-hidden="true"
                    className="popover-item-arrow"
                    size={APP_ICON_SIZES.sm}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                }
              >
                <button
                  type="button"
                  disabled={branchDisabledReason !== null}
                  onClick={() => {
                    setBranchSearch('')
                    setView('branch')
                  }}
                >
                  <span className="popover-item-label tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2">
                    <span className="tw:text-app-text-soft">分支</span>
                    <span className="tw:min-w-0 tw:truncate" title={pendingBranch ?? undefined}>
                      {pendingBranch ?? '未选择'}
                    </span>
                  </span>
                </button>
              </SidebarRow>
              <p className={NOTE_CLASS}>
                {branchDisabledReason ?? '选择只更新草稿，发送时才生效。'}
              </p>
              <SidebarRow
                asChild
                className="popover-item"
                leading={
                  <span className="popover-item-icon">
                    <FolderCog size={APP_ICON_SIZE} />
                  </span>
                }
                trailing={
                  <ChevronRight
                    aria-hidden="true"
                    className="popover-item-arrow"
                    size={APP_ICON_SIZES.sm}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                }
              >
                <button
                  type="button"
                  disabled={environmentDisabledReason !== null}
                  onClick={() => setView('environment')}
                >
                  <span className="popover-item-label tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2">
                    <span className="tw:text-app-text-soft">环境</span>
                    <span className="tw:min-w-0 tw:truncate" title={environmentValue}>
                      {environmentValue}
                    </span>
                  </span>
                </button>
              </SidebarRow>
              <p className={NOTE_CLASS}>
                {environmentDisabledReason ??
                  '沿用项目默认环境；切换后其他界面同步刷新。'}
              </p>
              <div className={DIVIDER_CLASS} />
              <SidebarRow
                asChild
                className="popover-item"
                leading={
                  <span className="popover-item-icon">
                    <Settings2 size={APP_ICON_SIZE} />
                  </span>
                }
              >
                <button
                  type="button"
                  disabled={!projectId || !onOpenEnvironmentSettings}
                  onClick={() => {
                    if (!projectId || !onOpenEnvironmentSettings) return
                    setOpen(false)
                    onOpenEnvironmentSettings(projectId)
                  }}
                >
                  <span className="popover-item-label">管理环境…</span>
                </button>
              </SidebarRow>
            </>
          ) : null}

          {view === 'branch' ? (
            <>
              <SubViewHeader title="分支" onBack={() => setView('settings')} />
              <div className="tw:px-2 tw:pb-1">
                <SearchInput
                  aria-label="搜索分支"
                  autoFocus
                  placeholder="搜索分支"
                  size="sm"
                  value={branchSearch}
                  variant="compact"
                  onChange={setBranchSearch}
                />
              </div>
              {visibleBranches.length ? (
                <div className={LIST_CLASS}>
                  {visibleBranches.map((branch) => (
                    <BranchOptionRow
                      key={branch}
                      branch={branch}
                      selected={branch === pendingBranch}
                      onSelect={() => {
                        updateSettings({ ...settings, branch })
                        setView('settings')
                      }}
                    />
                  ))}
                </div>
              ) : (
                <p className={cx(NOTE_CLASS, 'tw:py-3 tw:text-center')}>
                  {branchOptions.length ? '无匹配分支' : '当前项目没有可用分支'}
                </p>
              )}
            </>
          ) : null}

          {view === 'environment' ? (
            <>
              <SubViewHeader title="环境" onBack={() => setView('settings')} />
              {environmentError ? (
                <div className="tw:grid tw:gap-1 tw:px-2 tw:pb-1">
                  <p className={cx(NOTE_CLASS, 'tw:px-0 tw:pb-0 tw:text-app-danger')}>
                    {environmentError}
                  </p>
                  <Button
                    color="ghostSecondary"
                    size="toolbar"
                    onClick={() => void reloadEnvironments()}
                  >
                    重试
                  </Button>
                </div>
              ) : selectableEnvironments?.environments.length ? (
                <div className={LIST_CLASS}>
                  {selectableEnvironments?.environments.map((environment) => {
                    const selected = environment.id === selectedEnvironmentId
                    return (
                      <SidebarRow
                        asChild
                        active={selected}
                        className="popover-item"
                        key={environment.id}
                        leading={
                          <span className="popover-item-icon">
                            <FolderCog size={APP_ICON_SIZE} />
                          </span>
                        }
                        trailing={
                          selected ? (
                            <Check
                              className="popover-item-check"
                              size={APP_ICON_SIZES.sm}
                              strokeWidth={APP_ICON_STROKE_WIDTH}
                            />
                          ) : null
                        }
                      >
                        <button
                          aria-pressed={selected}
                          type="button"
                          onClick={() => void selectEnvironment(environment.id)}
                        >
                          <span className="popover-item-label tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:items-start">
                            <span className="tw:min-w-0 tw:max-w-full tw:truncate">
                              {environment.name}
                            </span>
                            <small className="tw:min-w-0 tw:max-w-full tw:truncate tw:type-caption tw:text-app-text-meta">
                              {environment.inherited ? '继承 · ' : ''}
                              {environment.path.split(/[\\/]/).pop()}
                            </small>
                          </span>
                        </button>
                      </SidebarRow>
                    )
                  })}
                </div>
              ) : (
                <p className={cx(NOTE_CLASS, 'tw:py-3 tw:text-center')}>
                  {environmentLoading ? '正在加载环境…' : '项目暂无环境，可在设置中创建。'}
                </p>
              )}
            </>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function SubViewHeader({
  title,
  onBack,
}: {
  title: string
  onBack: () => void
}): React.ReactNode {
  return (
    <div className="tw:flex tw:items-center tw:gap-1 tw:px-1 tw:pb-1">
      <Button
        isIconOnly
        aria-label="返回"
        color="ghostSecondary"
        size="toolbar"
        onClick={onBack}
      >
        <ChevronLeft size={APP_ICON_SIZE} />
      </Button>
      <span className="popover-header tw:p-0">{title}</span>
    </div>
  )
}
