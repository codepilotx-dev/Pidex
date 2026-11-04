import { useMemo } from 'react'
import React from 'react'
import { Download, RefreshCw, RotateCcw } from 'lucide-react'
import type { ToolingID, ToolingPreference, ToolingStatus } from '@pidex/agent-protocol'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { Button } from '../../components/ui/Button.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import {
  useDesktopSettingsDraftActions,
  useDesktopSettingsDraftValue,
  useDesktopSettingsDraftDirty,
  useDesktopSettingsDraftSaving,
} from './UseDesktopSettings.js'
import { errorMessageOr as errorMessage } from '@pidex/shared/errors'

type Props = {
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

const TOOL_IDS: readonly ToolingID[] = ['nodejs', 'python', 'git-bash', 'ripgrep']

const TOOL_LABELS: Record<ToolingID, string> = {
  nodejs: 'Node.js',
  python: 'Python',
  'git-bash': 'Git Bash',
  ripgrep: 'ripgrep',
}

const TOOL_DESCRIPTIONS: Record<ToolingID, string> = {
  nodejs: '提供 node、npm、npx 和 corepack。',
  python: '提供 python 和 pip。',
  'git-bash': '用于执行 Bash 命令，仅识别 Git for Windows 的 Git Bash。',
  ripgrep: '用于 Glob 和 Grep 文件搜索。',
}

const PHASE_LABELS: Record<ToolingStatus['phase'], string> = {
  idle: '未安装',
  detecting: '正在检测',
  downloading: '正在下载',
  installing: '正在安装',
  ready: '可用',
  error: '失败',
  'cleanup-pending': '等待清理',
}

const SOURCE_OPTIONS: readonly { value: ToolingPreference; label: string }[] = [
  { value: 'managed', label: '内置' },
  { value: 'system', label: '本机' },
]

export function WorkspaceDependenciesSettings({ onError, onNotice }: Props): React.ReactNode {
  const subscribedDraftActions = useDesktopSettingsDraftActions()
  const subscribedInstallPidexDependencies = useDesktopSettingsDraftValue(
    'installPidexDependencies',
  )
  const subscribedWorkspaceDependenciesMigrated = useDesktopSettingsDraftValue(
    'workspaceDependenciesMigrated',
  )
  const subscribedDraftDirty = useDesktopSettingsDraftDirty()
  const subscribedDraftSaving = useDesktopSettingsDraftSaving()
  const { draft } = useMemo(
    () => ({
      draft: {
        ...subscribedDraftActions,
        values: {
          installPidexDependencies: subscribedInstallPidexDependencies,
          workspaceDependenciesMigrated: subscribedWorkspaceDependenciesMigrated,
        },
        dirty: subscribedDraftDirty,
        saving: subscribedDraftSaving,
      },
    }),
    [
      subscribedDraftActions,
      subscribedInstallPidexDependencies,
      subscribedWorkspaceDependenciesMigrated,
      subscribedDraftDirty,
      subscribedDraftSaving,
    ],
  )
  const legacyManagedPreference = draft.values.installPidexDependencies
  const migrationComplete = draft.values.workspaceDependenciesMigrated
  const [statuses, setStatuses] = React.useState<readonly ToolingStatus[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [busyTools, setBusyTools] = React.useState<ReadonlySet<ToolingID>>(() => new Set())
  const migrationStarted = React.useRef(false)

  const setToolBusy = React.useCallback((id: ToolingID, busy: boolean): void => {
    setBusyTools((current) => {
      const next = new Set(current)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const replaceStatus = React.useCallback((next: ToolingStatus): void => {
    setStatuses((current) => {
      const existing = current.findIndex((status) => status.id === next.id)
      if (existing < 0) return [...current, next]
      const copy = [...current]
      copy[existing] = next
      return copy
    })
  }, [])

  const completeMigration = React.useCallback(async (): Promise<void> => {
    draft.setValue('workspaceDependenciesMigrated', true)
    await draft.save()
  }, [draft])

  const refresh = React.useCallback(async (): Promise<void> => {
    try {
      setStatuses(await desktopClient.listTooling())
    } catch (error) {
      onError(errorMessage(error, '无法读取工作空间依赖项状态。'))
    } finally {
      setLoading(false)
    }
  }, [onError])

  const rescan = async (): Promise<void> => {
    if (refreshing || busyTools.size > 0) return
    setRefreshing(true)
    try {
      setStatuses(await desktopClient.refreshTooling())
      onNotice?.('工作空间依赖项状态已更新。')
    } catch (error) {
      onError(errorMessage(error, '无法重新扫描工作空间依赖项。'))
    } finally {
      setRefreshing(false)
    }
  }

  React.useEffect(() => {
    let active = true
    void desktopClient
      .listTooling()
      .then(async (next) => {
        if (!active) return
        setStatuses(next)
        if (!migrationComplete && !migrationStarted.current) {
          migrationStarted.current = true
          const preference: ToolingPreference = legacyManagedPreference ? 'managed' : 'system'
          const migrated = [
            await desktopClient.setToolingPreference('nodejs', preference),
            await desktopClient.setToolingPreference('python', preference),
          ]
          if (!active) return
          for (const status of migrated) replaceStatus(status)
          await completeMigration()
        }
      })
      .catch((error) => {
        migrationStarted.current = false
        if (active) {
          onError(errorMessage(error, '无法读取或迁移工作空间依赖项状态。'))
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const unsubscribe = desktopClient.onToolingUpdated((status) => {
      if (active) replaceStatus(status)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [legacyManagedPreference, migrationComplete, onError, completeMigration, replaceStatus])

  const changePreference = async (
    status: ToolingStatus,
    preference: ToolingPreference,
  ): Promise<void> => {
    if (preference === status.preference || busyTools.has(status.id) || refreshing) {
      return
    }
    if (
      preference === 'system' &&
      status.managed.installed &&
      !window.confirm(`切换到本机会删除 Pidex 内置的 ${TOOL_LABELS[status.id]}。确认继续吗？`)
    ) {
      return
    }

    setToolBusy(status.id, true)
    try {
      replaceStatus(await desktopClient.setToolingPreference(status.id, preference))
      onNotice?.(
        `${TOOL_LABELS[status.id]} 已切换为${preference === 'managed' ? '内置' : '本机'}。`,
      )
    } catch (error) {
      onError(errorMessage(error, `无法切换 ${TOOL_LABELS[status.id]} 来源。`))
      await refresh()
    } finally {
      setToolBusy(status.id, false)
    }
  }

  const install = async (status: ToolingStatus): Promise<void> => {
    if (busyTools.has(status.id) || refreshing) return
    setToolBusy(status.id, true)
    try {
      replaceStatus(await desktopClient.installTooling(status.id, status.managed.installed))
      onNotice?.(`${TOOL_LABELS[status.id]} 内置版已安装。`)
    } catch (error) {
      onError(errorMessage(error, `${TOOL_LABELS[status.id]} 安装失败。`))
      await refresh()
    } finally {
      setToolBusy(status.id, false)
    }
  }

  if (loading && statuses.length === 0) {
    return (
      <SettingsContentArea>
        <div className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
          <WorkspaceDependenciesHeader
            disabled
            refreshing={refreshing}
            onRefresh={() => void rescan()}
          />
          <SettingsSection title="运行环境">
            <SettingsRow title="正在读取依赖项状态…" />
          </SettingsSection>
        </div>
      </SettingsContentArea>
    )
  }

  return (
    <SettingsContentArea>
      <div className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <WorkspaceDependenciesHeader
          disabled={refreshing || busyTools.size > 0}
          refreshing={refreshing}
          onRefresh={() => void rescan()}
        />
        {TOOL_IDS.map((id) => {
          const status = statuses.find((item) => item.id === id)
          return status ? (
            <DependencySection
              busy={busyTools.has(id) || refreshing}
              key={id}
              onInstall={() => void install(status)}
              onPreferenceChange={(preference) => void changePreference(status, preference)}
              status={status}
            />
          ) : null
        })}
      </div>
    </SettingsContentArea>
  )
}

function WorkspaceDependenciesHeader({
  disabled,
  onRefresh,
  refreshing,
}: {
  disabled: boolean
  onRefresh: () => void
  refreshing: boolean
}): React.ReactNode {
  return (
    <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
      <div className="settings-section-header">
        <h2 className="settings-page-title tw:m-0 tw:type-page-title tw:text-app-text">
          工作空间依赖项
        </h2>
        <Button
          color="primary"
          disabled={disabled}
          onClick={onRefresh}
          title={refreshing ? '正在扫描工作空间依赖项' : '重新扫描'}
          type="button"
        >
          <RefreshCw size={APP_ICON_SIZE} />
          {refreshing ? '扫描中…' : '重新扫描'}
        </Button>
      </div>
      <p className="settings-page-desc tw:m-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm">
        四项运行环境彼此独立；内置版只在首次使用或手动安装时下载，不会打包进应用。
      </p>
    </div>
  )
}

function DependencySection({
  busy,
  onInstall,
  onPreferenceChange,
  status,
}: {
  busy: boolean
  onInstall: () => void
  onPreferenceChange: (preference: ToolingPreference) => void
  status: ToolingStatus
}): React.ReactNode {
  const installing = status.phase === 'downloading' || status.phase === 'installing'
  const activeLabel =
    status.activeSource === 'managed'
      ? '内置'
      : status.activeSource === 'system'
        ? '本机'
        : '不可用'

  return (
    <SettingsSection title={TOOL_LABELS[status.id]} description={TOOL_DESCRIPTIONS[status.id]}>
      <SettingsRow
        title="来源"
        description={
          status.preference === 'system' && !status.system.available
            ? '未检测到有效的本机版本；当前不会回退到内置版。'
            : '内置版按需下载；本机版仅使用通过校验的系统工具。'
        }
        control={
          <SegmentedControl
            ariaLabel={`${TOOL_LABELS[status.id]} 来源`}
            className="settings-segmented-control"
            onChange={(value) => {
              if (!busy) onPreferenceChange(value)
            }}
            options={SOURCE_OPTIONS}
            value={status.preference}
          />
        }
      />
      <SettingsRow
        title="当前状态"
        description={status.error?.message ?? progressDescription(status)}
        control={<span className="settings-row-status">{PHASE_LABELS[status.phase]}</span>}
      />
      <SettingsRow
        title="实际来源"
        description={resolvedPath(status)}
        control={<span className="settings-row-status">{activeLabel}</span>}
      />
      <SettingsRow
        title="版本"
        description={`固定版本：${status.pinnedVersion}；内置：${
          status.managed.version ?? '未安装'
        }；本机：${status.system.version ?? '未检测到'}`}
      />
      {status.preference === 'managed' ? (
        <SettingsRow
          title={status.managed.installed ? '重新安装内置版' : '安装内置版'}
          description={
            status.managed.installed
              ? '重新下载并校验固定版本；失败时保留当前有效安装。'
              : '首次使用时也会自动安装代码内固定的版本。'
          }
          control={
            <Button color="primary" disabled={busy || installing} onClick={onInstall} type="button">
              {status.managed.installed ? (
                <RotateCcw size={APP_ICON_SIZE} />
              ) : (
                <Download size={APP_ICON_SIZE} />
              )}
              {installing ? '处理中…' : status.managed.installed ? '重新安装' : '安装内置版'}
            </Button>
          }
        />
      ) : null}
    </SettingsSection>
  )
}

function progressDescription(status: ToolingStatus): string {
  const progress = status.progress
  if (!progress) {
    if (status.phase === 'cleanup-pending') {
      return '文件正在使用，Pidex 会在下次启动时继续清理。'
    }
    return status.phase === 'idle' ? '尚未解析可用版本。' : '依赖项状态已更新。'
  }
  const received = formatBytes(progress.receivedBytes)
  return progress.totalBytes === undefined
    ? `已下载 ${received}`
    : `已下载 ${received} / ${formatBytes(progress.totalBytes)}`
}

function resolvedPath(status: ToolingStatus): string {
  if (status.activeSource === 'system') {
    return status.system.path ?? '本机路径不可用'
  }
  if (status.activeSource === 'managed') {
    return `Pidex 托管目录 · ${status.id}/${status.managed.version ?? status.pinnedVersion}`
  }
  return '没有可执行文件路径'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
}
