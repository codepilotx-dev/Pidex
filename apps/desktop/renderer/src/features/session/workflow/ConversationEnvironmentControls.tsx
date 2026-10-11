import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { GitFork, Play, RefreshCw, X } from 'lucide-react'
import type { LocalEnvironmentActionMetadata, ManagedWorktree } from '@pidex/agent-protocol'

import {
  subscribeProjectCatalogChanges,
  notifyProjectCatalogChanged,
} from '../../projects/ProjectCatalogEvents.js'
import { GlobalErrorModal } from '../../../components/GlobalErrorModal.js'
import { Spinner } from '../../../components/ui/Spinner.js'
import { Button } from '../../../components/ui/Button.js'

import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import {
  commandMenuActionStore,
  registerCommandMenuActions,
  type CommandMenuActionRegistration,
} from '../../search/CommandMenuActionStore.js'
import { environmentDomainClient } from '../../../services/desktop-client/EnvironmentDomainClient.js'
import { loadDesktopTerminalClient } from '../../../services/desktop-client/index.js'
import { transferConversationUiStateForHandoff } from '../../layout/tabs/ConversationUiState.js'
import { listTerminalActions, runTerminalAction } from './actions/TerminalActionController.js'
import {
  HANDOFF_PROGRESS_STEPS,
  completedHandoffStepCount,
  resumePendingHandoff,
  runHandoff,
  type HandoffOperation,
} from './handoff/HandoffController.js'

type Props = {
  threadId: string
  workspacePath: string
  terminalProfileId: string | null
  gitAvailable: boolean
  onNavigateTarget: (threadId: string) => void
  onOpenEnvironmentSettings: () => void
  onOpenWorktreeSettings: (projectId: string) => void
  onTransferAuxiliaryState: (targetThreadId: string) => void
}

export type GitEnvironmentSnapshot = {
  actions: readonly LocalEnvironmentActionMetadata[]
  worktrees: readonly ManagedWorktree[]
  projectId: string | null
}

export type GitEnvironmentLoaders = {
  listActions: (threadId: string) => Promise<readonly LocalEnvironmentActionMetadata[]>
  projectForThread: (threadId: string) => Promise<string | null>
  listWorktrees: (projectId: string) => Promise<readonly ManagedWorktree[]>
}

export type GitEnvironmentProjectionResult =
  | { status: 'not-git' }
  | { status: 'loaded'; snapshot: GitEnvironmentSnapshot; warning?: string }
  | { status: 'stale' }
  | { status: 'failed'; error: string }

/**
 * 仅在 gitAvailable 时加载 Git 环境（actions/worktrees/projectId），并在
 * 返回前用 isCurrent 双校验拒绝迟到结果。非 Git 是受支持状态：不调用任何
 * Git RPC，也绝不因迟到错误向上抛给调用方。
 */
export async function loadGitEnvironmentProjection(
  gitAvailable: boolean,
  threadId: string,
  loaders: GitEnvironmentLoaders,
  isCurrent: () => boolean,
): Promise<GitEnvironmentProjectionResult> {
  if (!gitAvailable) return { status: 'not-git' }
  try {
    const actions = await loaders.listActions(threadId)
    let projectId: string | null = null
    let worktrees: readonly ManagedWorktree[] = []
    let warning: string | undefined
    try {
      projectId = await loaders.projectForThread(threadId)
      worktrees = projectId ? await loaders.listWorktrees(projectId) : []
    } catch (cause) {
      warning = message(cause)
    }
    if (!isCurrent()) return { status: 'stale' }
    return {
      status: 'loaded',
      snapshot: { actions, worktrees, projectId },
      ...(warning ? { warning } : {}),
    }
  } catch (cause) {
    if (!isCurrent()) return { status: 'stale' }
    return { status: 'failed', error: message(cause) }
  }
}

/** 非 Git 或请求期间 Git 变为不可用时，不得恢复 pending handoff。 */
export function shouldResumePendingHandoff(
  gitAvailable: boolean,
  threadId: string,
  workspacePath: string,
  resumedThreadId: string | null,
): boolean {
  return gitAvailable && Boolean(threadId) && Boolean(workspacePath) && resumedThreadId !== threadId
}

const stepLabel: Record<(typeof HANDOFF_PROGRESS_STEPS)[number], string> = {
  preflight: '预检查',
  'stop-source': '停止源任务',
  'prepare-destination': '准备目标',
  'capture-source': '捕获源修改',
  'release-branch': '释放分支',
  'checkout-destination': '签出目标',
  'apply-source-changes': '应用源修改',
  'fork-conversation': '派生对话',
  'transfer-core-state': '迁移核心状态',
  'await-client-transfer': '迁移界面状态',
  'archive-source': '归档源任务',
  complete: '完成',
}

export function ConversationEnvironmentControls({
  threadId,
  workspacePath,
  terminalProfileId,
  gitAvailable,
  onNavigateTarget,
  onOpenEnvironmentSettings,
  onOpenWorktreeSettings,
  onTransferAuxiliaryState,
}: Props): React.ReactNode {
  const client = React.useMemo(() => environmentDomainClient(), [])
  const [actions, setActions] = React.useState<readonly LocalEnvironmentActionMetadata[]>([])
  const [worktrees, setWorktrees] = React.useState<readonly ManagedWorktree[]>([])
  const [projectId, setProjectId] = React.useState<string | null>(null)
  const [environmentCatalog, setEnvironmentCatalog] = React.useState<Awaited<
    ReturnType<typeof client.listProjectEnvironments>
  > | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [handoff, setHandoff] = React.useState<HandoffOperation | null>(null)
  const [handoffOpen, setHandoffOpen] = React.useState(false)
  const resumedThreadRef = React.useRef<string | null>(null)
  const callbacksRef = React.useRef({ onNavigateTarget, onTransferAuxiliaryState })
  callbacksRef.current = { onNavigateTarget, onTransferAuxiliaryState }
  const { onCloseAutoFocus } = useDialogFocusRestore(handoffOpen)
  const gitAvailableRef = React.useRef(gitAvailable)
  gitAvailableRef.current = gitAvailable
  const refreshGenerationRef = React.useRef(0)

  const clearGitEnvironment = React.useCallback((): void => {
    setActions([])
    setWorktrees([])
    setProjectId(null)
    setError(null)
    setNotice(null)
    setHandoff(null)
    setHandoffOpen(false)
    setLoading(false)
    setBusy(false)
  }, [])

  const refresh = React.useCallback(async () => {
    const generation = ++refreshGenerationRef.current
    if (!gitAvailableRef.current) {
      try {
        const localProjectId = await client.projectForThread(threadId)
        const localActions = localProjectId ? await listTerminalActions(client, threadId) : []
        if (generation !== refreshGenerationRef.current) return
        setProjectId(localProjectId)
        setActions(localActions)
      } catch (cause) {
        if (generation === refreshGenerationRef.current) setError(message(cause))
      } finally {
        if (generation === refreshGenerationRef.current) setLoading(false)
      }
      return
    }
    setLoading(true)
    setError(null)
    const result = await loadGitEnvironmentProjection(
      gitAvailableRef.current,
      threadId,
      {
        listActions: (targetThreadId) => listTerminalActions(client, targetThreadId),
        projectForThread: (targetThreadId) => client.projectForThread(targetThreadId),
        listWorktrees: (targetProjectId) =>
          client.listWorktrees(targetProjectId).then((value) => value.worktrees),
      },
      () => generation === refreshGenerationRef.current,
    )
    if (result.status === 'stale') return
    if (result.status === 'not-git') {
      setLoading(false)
      return
    }
    if (result.status === 'failed') {
      setError(result.error)
      setLoading(false)
      return
    }
    setError(result.warning ?? null)
    setActions(result.snapshot.actions)
    setProjectId(result.snapshot.projectId)
    setWorktrees(result.snapshot.worktrees)
    setLoading(false)
  }, [client, threadId])

  React.useEffect(() => {
    if (!projectId) {
      setEnvironmentCatalog(null)
      return
    }
    let active = true
    const reload = () => {
      void client
        .listProjectEnvironments(projectId)
        .then((value) => {
          if (active) setEnvironmentCatalog(value)
        })
        .catch((cause) => {
          if (active) setError(message(cause))
        })
    }
    reload()
    const unsubscribe = subscribeProjectCatalogChanges(reload)
    return () => {
      active = false
      unsubscribe()
    }
  }, [client, projectId])
  const switchEnvironment = React.useCallback(
    async (environmentId: string) => {
      if (!projectId || busy) return
      setBusy(true)
      try {
        await client.selectProjectEnvironment(projectId, environmentId)
        setEnvironmentCatalog(await client.listProjectEnvironments(projectId))
        await refresh()
        notifyProjectCatalogChanged()
      } catch (cause) {
        setError(message(cause))
      } finally {
        setBusy(false)
      }
    },
    [client, projectId, busy, refresh],
  )

  React.useEffect(() => {
    const reload = () => {
      void refresh()
    }
    const unsubscribe = subscribeProjectCatalogChanges(reload)
    window.addEventListener('focus', reload)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', reload)
    }
  }, [refresh])

  React.useEffect(() => {
    if (gitAvailable) {
      void refresh()
      return
    }
    // Git status 尚未成功或已确认非 Git：不调用 Git 环境 RPC，清空既有
    // actions/worktrees/遗留错误，并让在途请求的迟到结果失效。
    refreshGenerationRef.current += 1
    resumedThreadRef.current = null
    clearGitEnvironment()
    void refresh()
  }, [clearGitEnvironment, gitAvailable, refresh])

  React.useEffect(() => {
    if (
      !shouldResumePendingHandoff(
        gitAvailableRef.current,
        threadId,
        workspacePath,
        resumedThreadRef.current,
      )
    )
      return
    resumedThreadRef.current = threadId
    let cancelled = false
    setBusy(true)
    void loadDesktopTerminalClient()
      .then((terminal) =>
        resumePendingHandoff({
          sourceThreadId: threadId,
          sourceWorkspacePath: workspacePath,
          destination: { kind: 'local' },
          client,
          terminal,
          onProgress: (operation) => {
            if (cancelled) return
            setHandoff(operation)
            setHandoffOpen(true)
          },
          transferUiState: (transferInput) =>
            transferUiState(transferInput, callbacksRef.current.onTransferAuxiliaryState),
        }),
      )
      .then((result) => {
        if (!result || cancelled) return
        setNotice(handoffWarningMessage(result))
        callbacksRef.current.onNavigateTarget(result.targetThreadId)
      })
      .catch((cause) => {
        if (!cancelled) setError(message(cause))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [client, gitAvailable, threadId, workspacePath])

  const executeAction = React.useCallback(
    async (action: LocalEnvironmentActionMetadata) => {
      setBusy(true)
      setError(null)
      try {
        await runTerminalAction({
          terminal: await loadDesktopTerminalClient(),
          threadId,
          action,
          profileId: terminalProfileId,
        })
      } catch (cause) {
        setError(message(cause))
      } finally {
        setBusy(false)
      }
    },
    [terminalProfileId, threadId],
  )

  const start = React.useCallback(
    async (destination: { kind: 'local' } | { kind: 'worktree'; worktreeId: string }) => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const result = await runHandoff({
          sourceThreadId: threadId,
          sourceWorkspacePath: workspacePath,
          destination,
          client,
          terminal: await loadDesktopTerminalClient(),
          onProgress: setHandoff,
          transferUiState: (transferInput) =>
            transferUiState(transferInput, onTransferAuxiliaryState),
        })
        setNotice(handoffWarningMessage(result))
        onNavigateTarget(result.targetThreadId)
      } catch (cause) {
        setError(message(cause))
      } finally {
        setBusy(false)
      }
    },
    [client, onNavigateTarget, onTransferAuxiliaryState, threadId, workspacePath],
  )

  const createWorktree = React.useCallback(async () => {
    if (!projectId) return
    setBusy(true)
    setError(null)
    try {
      await client.createWorktree({
        projectId,
        startingState: { type: 'working-tree' },
        operationId: crypto.randomUUID(),
      })
      await refresh()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }, [client, projectId, refresh])

  const commandActions = React.useMemo<CommandMenuActionRegistration[]>(() => {
    const registrations: CommandMenuActionRegistration[] = actions.map((action, index) => ({
      id: `environment.action.${threadId}.${index}.${action.name}`,
      group: 'workspace-actions',
      label: action.name,
      description: '在当前任务的集成终端中运行',
      keywords: ['action', '环境', '终端', action.name],
      icon: action.icon || <Play aria-hidden="true" size={APP_ICON_SIZE} />,
      order: 100 + index,
      availability: busy || action.availability !== 'available' ? 'disabled' : 'available',
      disabledReason: busy
        ? '另一项工作区操作正在进行中'
        : action.availability === 'unsupported-platform'
          ? '当前平台不支持此操作'
          : undefined,
      execute: () => executeAction(action),
    }))

    registrations.push(
      ...(environmentCatalog?.environments
        .filter((environment) => environment.exists)
        .map((environment, index) => ({
          id: `environment.choice.${threadId}.${environment.id}`,
          group: 'workspace-actions' as const,
          label: environment.name,
          keywords: ['环境', environment.name],
          selected: environment.id === environmentCatalog.selectedEnvironmentId,
          order: 200 + index,
          availability:
            busy || environment.invalid ? ('disabled' as const) : ('available' as const),
          execute: () => switchEnvironment(environment.id),
        })) ?? []),
    )

    if (loading && actions.length === 0) {
      registrations.push({
        id: `environment.action.${threadId}.loading`,
        group: 'workspace-actions',
        label: '正在加载工作区操作…',
        keywords: ['action', '环境'],
        order: 90,
        availability: 'loading',
        execute: () => undefined,
      })
    }

    registrations.push({
      id: `environment.handoff.${threadId}`,
      group: 'task-transfer',
      label: '移交当前任务…',
      description: '将任务、工作区修改和界面状态迁移到其他环境',
      keywords: ['handoff', '移交', '迁移', 'local', 'worktree'],
      icon: <GitFork aria-hidden="true" size={APP_ICON_SIZE} />,
      order: 500,
      availability: busy || !gitAvailable ? 'disabled' : 'available',
      disabledReason: busy
        ? '另一项工作区操作正在进行中'
        : !gitAvailable
          ? '仅 Git 项目可用'
          : undefined,
      execute: () => setHandoffOpen(true),
    })

    return registrations
  }, [
    actions,
    busy,
    executeAction,
    gitAvailable,
    loading,
    threadId,
    environmentCatalog,
    switchEnvironment,
  ])

  React.useEffect(() => {
    return registerCommandMenuActions(commandMenuActionStore, commandActions)
  }, [commandActions])

  const readyWorktrees = worktrees.filter(
    (worktree) =>
      worktree.status === 'ready' ||
      (worktree.status === 'ready-with-setup-error' && worktree.continuedWithoutSetup),
  )

  return (
    <>
      <Dialog.Root open={handoffOpen} onOpenChange={setHandoffOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
          <Dialog.Content
            className="ui-dialog-surface ui-dialog-surface--centered permission-modal tw:grid tw:w-[min(38rem,100%)] tw:gap-4 tw:p-6"
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <header className="tw:flex tw:items-start tw:justify-between tw:gap-4">
              <div className="tw:grid tw:gap-1">
                <Dialog.Title asChild>
                  <h2 className="tw:m-0 tw:type-title-md tw:text-app-text">移交当前任务</h2>
                </Dialog.Title>
                <Dialog.Description className="tw:m-0 tw:type-body-sm tw:text-app-text-soft">
                  移交会停止并归档当前任务，再把修改和界面状态迁移到目标环境。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button
                  isIconOnly
                  color="ghostSecondary"
                  disabled={busy}
                  size="toolbar"
                  title="关闭移交对话框"
                >
                  <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </Button>
              </Dialog.Close>
            </header>

            {handoff && busy ? (
              <div
                className="tw:grid tw:min-h-24 tw:place-content-center tw:gap-2 tw:text-center"
                role="status"
              >
                <Spinner className="tw:mx-auto" size="medium" />
                <strong className="tw:type-control tw:text-app-text">
                  {stepLabel[handoff.step]}
                </strong>
                <span className="tw:type-caption tw:text-app-text-soft">
                  {completedHandoffStepCount(handoff)}/{HANDOFF_PROGRESS_STEPS.length}
                </span>
              </div>
            ) : (
              <div className="tw:grid tw:gap-2">
                {!gitAvailable ? (
                  <p className="tw:m-0 tw:type-body-sm tw:text-app-text-soft">仅 Git 项目可用。</p>
                ) : null}
                <Button
                  color="secondary"
                  disabled={busy || !gitAvailable}
                  onClick={() => void start({ kind: 'local' })}
                >
                  移交到 Local
                </Button>
                {readyWorktrees.map((worktree) => (
                  <Button
                    color="secondary"
                    disabled={busy}
                    key={worktree.id}
                    onClick={() => void start({ kind: 'worktree', worktreeId: worktree.id })}
                  >
                    移交到 {worktree.branchName ?? worktree.id.slice(0, 8)}
                  </Button>
                ))}
                <Button
                  color="secondary"
                  disabled={!projectId || busy || !gitAvailable}
                  onClick={() => void createWorktree()}
                >
                  新建托管工作树…
                </Button>
              </div>
            )}

            <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
              <Button
                color="ghostSecondary"
                onClick={() => {
                  setHandoffOpen(false)
                  onOpenEnvironmentSettings()
                }}
              >
                配置 Local environment…
              </Button>
              <Button
                color="ghostSecondary"
                disabled={!projectId || !gitAvailable}
                onClick={() => {
                  if (!projectId) return
                  setHandoffOpen(false)
                  onOpenWorktreeSettings(projectId)
                }}
              >
                管理 Worktrees…
              </Button>
              <Button color="ghostSecondary" disabled={busy} onClick={() => void refresh()}>
                <RefreshCw aria-hidden="true" size={APP_ICON_SIZE} />
                刷新
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <GlobalErrorModal message={error} onDismiss={() => setError(null)} />
      <GlobalErrorModal message={notice} tone="status" onDismiss={() => setNotice(null)} />
    </>
  )
}

function handoffWarningMessage(result: {
  warning: 'LOCAL_STORAGE_UNAVAILABLE' | null
  warnings: readonly string[]
}): string | null {
  const warnings = [...(result.warning ? ['部分本地界面状态未能复制。'] : []), ...result.warnings]
  return warnings.length ? `任务已移交；${warnings.join('；')}` : null
}

function transferUiState(
  transferInput: Parameters<typeof transferConversationUiStateForHandoff>[0],
  onTransferAuxiliaryState: (targetThreadId: string) => void,
) {
  const result = transferConversationUiStateForHandoff(transferInput)
  try {
    onTransferAuxiliaryState(transferInput.targetThreadId)
  } catch {
    return { transferred: result.transferred, warning: 'LOCAL_STORAGE_UNAVAILABLE' as const }
  }
  return result
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败，请重试。'
}
