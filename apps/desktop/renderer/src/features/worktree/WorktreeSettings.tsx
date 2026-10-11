import React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { ManagedWorktree, RpcResult } from '@pidex/agent-protocol'
import { Button } from '../../components/ui/Button.js'
import { environmentDomainClient } from '../../services/desktop-client/EnvironmentDomainClient.js'
import { SettingsContentArea } from '../settings/SettingsContentArea.js'
import { SettingsSection } from '../settings/SettingsSection.js'

import { WorktreePreferences } from './WorktreePreferences.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { Select } from '../../components/ui/Select.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import type { DesktopWorkspace } from '../../../shared/Types.js'
const EnvironmentProjects = React.lazy(() =>
  import('../settings/local-environment/LocalEnvironmentProjectSettings.js').then((module) => ({
    default: module.LocalEnvironmentProjectSettings,
  })),
)

type Props = { onError: (message: string) => void; onNotice?: (message: string) => void }
type Mutation = { operation: RpcResult<'worktree/create'>['operation']; worktree: ManagedWorktree }
type MutationOutcome =
  { kind: 'mutation'; value: Mutation } | { kind: 'mutation-error'; error: unknown }

export function WorktreeSettings({ onError, onNotice }: Props): React.ReactNode {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const projectId = params.get('projectId') ?? ''
  const client = React.useMemo(() => environmentDomainClient(), [])
  const [entries, setEntries] = React.useState<RpcResult<'worktree/settings/list'>['worktrees']>([])
  const worktrees = entries.map((entry) => entry.worktree)
  const [projects, setProjects] = React.useState<DesktopWorkspace[]>([])
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const mutationActive = React.useRef(false)
  React.useEffect(() => {
    void desktopClient
      .listProjects()
      .then(setProjects)
      .catch((cause) => onError(message(cause)))
  }, [onError])
  const tab = params.get('tab') === 'environments' ? 'environments' : 'general'
  const tabs = (
    <SegmentedControl
      ariaLabel="工作树设置"
      semantics="tabs"
      value={tab}
      options={[
        { value: 'general', label: '常规' },
        { value: 'environments', label: '环境' },
      ]}
      onChange={(value) =>
        setParams((current) => {
          current.set('tab', value)
          return current
        })
      }
    />
  )
  const [branchName, setBranchName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [operation, setOperation] = React.useState<Mutation['operation'] | null>(null)
  const [output, setOutput] = React.useState('')

  const refresh = React.useCallback(async () => {
    setEntries((await client.listWorktreeSettings(projectId || undefined)).worktrees)
  }, [client, projectId])
  React.useEffect(() => {
    void refresh().catch((cause) => onError(message(cause)))
  }, [onError, refresh])

  const track = async (operationId: string, mutationPromise: Promise<Mutation>) => {
    setOutput('')
    let cursor = 0
    let current: Mutation['operation'] | null = null
    const mutationOutcome: Promise<MutationOutcome> = mutationPromise.then(
      (value) => ({ kind: 'mutation', value }),
      (error) => ({ kind: 'mutation-error', error }),
    )
    let mutationPending = true
    while (!current || current.status === 'pending' || current.status === 'running') {
      const statusOutcome = client.worktreeOperationStatus(operationId, cursor).then(
        (value) => ({ kind: 'status' as const, value }),
        (error) => ({ kind: 'status-error' as const, error }),
      )
      const outcome = mutationPending
        ? await Promise.race([mutationOutcome, statusOutcome])
        : await statusOutcome
      if (outcome.kind === 'mutation-error') throw outcome.error
      if (outcome.kind === 'mutation') {
        mutationPending = false
        current = outcome.value.operation
        setOperation(current)
        if (current.status !== 'pending' && current.status !== 'running') break
        continue
      }
      if (outcome.kind === 'status') {
        current = outcome.value.operation
        cursor = outcome.value.output.cursor
        setOperation(current)
        if (outcome.value.output.data)
          setOutput((previous) => `${previous}${outcome.value.output.data}`.slice(-65_536))
      } else if (current) throw outcome.error
      const settled = mutationPending
        ? await Promise.race([
            mutationOutcome,
            new Promise<{ kind: 'retry' }>((resolve) =>
              setTimeout(() => resolve({ kind: 'retry' }), 100),
            ),
          ])
        : { kind: 'retry' as const }
      if (settled.kind === 'mutation-error') throw settled.error
      if (settled.kind === 'mutation') {
        mutationPending = false
        current = settled.value.operation
        setOperation(current)
        if (current.status !== 'pending' && current.status !== 'running') break
      }
    }
    if (mutationPending) {
      const settled = await mutationOutcome
      if (settled.kind === 'mutation-error') throw settled.error
      current = settled.value.operation
      setOperation(current)
    }
    try {
      const finalStatus = await client.worktreeOperationStatus(operationId, cursor)
      current = finalStatus.operation
      setOperation(current)
      if (finalStatus.output.data)
        setOutput((previous) => `${previous}${finalStatus.output.data}`.slice(-65_536))
    } catch {
      // Mutation result remains authoritative when the volatile output tail is unavailable.
    }
    await refresh()
    if (current.status === 'failed') throw new Error(current.errorCode ?? 'Worktree 操作失败')
    onNotice?.(
      current.warnings.length
        ? `Worktree 操作已完成；${current.warnings.join('；')}`
        : 'Worktree 操作已完成。',
    )
  }

  const mutate = async (action: (operationId: string) => Promise<Mutation>) => {
    if (mutationActive.current) return
    mutationActive.current = true
    setBusy(true)
    const operationId = crypto.randomUUID()
    try {
      await track(operationId, action(operationId))
    } catch (cause) {
      onError(message(cause))
    } finally {
      mutationActive.current = false
      setBusy(false)
      await refresh().catch((cause) => onError(message(cause)))
    }
  }

  if (tab === 'environments')
    return (
      <SettingsContentArea>
        <div className="settings-content-inner tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
          {!params.get('projectId') && !params.get('threadId') ? (
            <>
              <h2 className="tw:m-0 tw:mb-3 tw:type-title-xl tw:text-app-text">Worktrees</h2>
              <p className="tw:m-0 tw:mb-6 tw:type-body-sm tw:text-app-text-soft">
                本地环境用于设置项目工作树及启动操作。
              </p>
              <div className="tw:mb-8">{tabs}</div>
            </>
          ) : null}
          <React.Suspense fallback={<p>正在加载环境设置…</p>}>
            <EnvironmentProjects onError={onError} onNotice={onNotice} />
          </React.Suspense>
        </div>
      </SettingsContentArea>
    )
  return (
    <SettingsContentArea>
      <div className="settings-content-inner tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <h2 className="tw:m-0 tw:mb-6 tw:type-title-xl tw:text-app-text">Worktrees</h2>
        <div className="tw:mb-8">{tabs}</div>
        <WorktreePreferences onError={onError} />
        <div className="tw:my-6 tw:flex tw:items-center tw:gap-2">
          <Select
            ariaLabel="项目筛选"
            value={projectId}
            options={[
              { value: '', label: '全部项目' },
              ...projects.flatMap((project) =>
                project.projectId ? [{ value: project.projectId, label: project.name }] : [],
              ),
            ]}
            onValueChange={(value) =>
              setParams((current) => {
                if (value) current.set('projectId', value)
                else current.delete('projectId')
                return current
              })
            }
          />
          <Button
            color="secondary"
            disabled={busy}
            onClick={() => void refresh().catch((cause) => onError(message(cause)))}
          >
            刷新
          </Button>
        </div>
        {projectId ? (
          <SettingsSection
            title="创建 Worktree"
            description="Working-tree 模式会安全捕获 staged、unstaged 与 untracked 修改。"
          >
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:p-3">
              <input
                aria-label="起始分支"
                className="confirmation-dialog-input tw:min-w-56"
                placeholder="已有分支名称"
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
              />
              <Button
                color="primary"
                disabled={busy || !branchName.trim()}
                onClick={() =>
                  void mutate((operationId) =>
                    client.createWorktree({
                      projectId,
                      startingState: { type: 'branch', branchName: branchName.trim() },
                      operationId,
                    }),
                  )
                }
              >
                从分支创建
              </Button>
              <Button
                color="primary"
                disabled={busy}
                onClick={() =>
                  void mutate((operationId) =>
                    client.createWorktree({
                      projectId,
                      startingState: { type: 'working-tree' },
                      operationId,
                    }),
                  )
                }
              >
                从当前 Working Tree 创建
              </Button>
              <Button color="secondary" disabled={busy} onClick={() => void refresh()}>
                刷新
              </Button>
            </div>
          </SettingsSection>
        ) : null}
        <SettingsSection
          title="托管 Worktrees"
          description="永久、活跃或仍有关联任务的 Worktree 不会被自动清理。"
        >
          <div className="tw:grid tw:gap-2 tw:p-3">
            {worktrees.length ? (
              [...new Set(entries.map((entry) => entry.worktree.projectId))].map((projectId) => (
                <section key={projectId}>
                  <h3 className="tw:type-row-title tw:text-app-text tw:break-words">
                    {projects.find((project) => project.projectId === projectId)?.name ?? projectId}
                  </h3>
                  {entries
                    .filter((entry) => entry.worktree.projectId === projectId)
                    .map(({ worktree, path, conversations }) => (
                      <article
                        className="settings-card tw:grid tw:gap-2 tw:p-3 tw:overflow-hidden tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none"
                        key={worktree.id}
                      >
                        <div className="tw:flex tw:items-center tw:justify-between tw:gap-3">
                          <div>
                            <strong className="tw:type-row-title">
                              {worktree.branchName ?? 'Detached worktree'}
                            </strong>
                            <p className="tw:m-0 tw:type-caption tw:text-app-text-meta tw:break-words">
                              {path}
                            </p>
                            <div className="tw:type-caption tw:text-app-text-soft">
                              {worktree.status} · setup {worktree.setupStatus}
                            </div>
                          </div>
                          <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
                            <Button
                              color="secondary"
                              disabled={
                                busy ||
                                !['ready', 'ready-with-setup-error'].includes(worktree.status)
                              }
                              onClick={() => {
                                if (mutationActive.current) return
                                mutationActive.current = true
                                setBusy(true)
                                void client
                                  .newChatInWorktree(worktree.id)
                                  .then(({ threadId }) =>
                                    navigate('/threads/' + encodeURIComponent(threadId)),
                                  )
                                  .catch((cause) => onError(message(cause)))
                                  .finally(() => {
                                    mutationActive.current = false
                                    setBusy(false)
                                  })
                              }}
                            >
                              在此工作树中新建聊天
                            </Button>
                            {worktree.status === 'ready-with-setup-error' ? (
                              <>
                                <Button
                                  color="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void mutate((operationId) =>
                                      client.retryWorktreeSetup(worktree.id, operationId),
                                    )
                                  }
                                >
                                  重试 Setup
                                </Button>
                                <Button
                                  color="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void mutate((operationId) =>
                                      client.continueWorktreeWithoutSetup(worktree.id, operationId),
                                    )
                                  }
                                >
                                  跳过并继续
                                </Button>
                              </>
                            ) : null}
                            <Button
                              color="primary"
                              disabled={busy}
                              onClick={() =>
                                void mutate((operationId) =>
                                  client.setWorktreePermanent(
                                    worktree.id,
                                    !worktree.permanent,
                                    operationId,
                                  ),
                                )
                              }
                            >
                              {worktree.permanent ? '取消永久保留' : '永久保留'}
                            </Button>
                            {worktree.status === 'cleaned' ? (
                              <Button
                                color="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void mutate((operationId) =>
                                    client.restoreWorktree(worktree.id, operationId),
                                  )
                                }
                              >
                                恢复
                              </Button>
                            ) : worktree.status === 'restore-conflict' ? (
                              <span className="tw:type-caption tw:text-app-danger">
                                恢复冲突，已保留工作树和快照，请手动处理
                              </span>
                            ) : (
                              <Button
                                color="danger"
                                disabled={
                                  busy ||
                                  worktree.pinned ||
                                  conversations.some((thread) => thread.active || thread.pinned)
                                }
                                onClick={() => setDeleting(worktree.id)}
                              >
                                删除
                              </Button>
                            )}
                          </div>
                        </div>
                        {conversations.length ? (
                          <div className="tw:grid tw:gap-1">
                            <span className="tw:type-caption tw:text-app-text-meta">关联聊天</span>
                            {conversations.map((thread) => (
                              <a
                                key={thread.id}
                                className="tw:type-body-sm tw:text-app-text tw:truncate tw:rounded-item tw:px-2 tw:py-1 tw:hover:bg-app-hover tw:focus-visible:outline-app-focus"
                                href={'/threads/' + thread.id}
                                onClick={(event) => {
                                  event.preventDefault()
                                  navigate('/threads/' + thread.id)
                                }}
                              >
                                {thread.title || '无标题聊天'}
                                {thread.archived ? ' · 已归档' : ''}
                                {thread.pinned ? ' · 已置顶' : ''}
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    ))}
                </section>
              ))
            ) : (
              <p className="settings-empty-copy">暂无托管 Worktree。</p>
            )}
          </div>
        </SettingsSection>
        {operation ? (
          <SettingsSection
            title="操作进度"
            description={`${operation.kind} · ${operation.step} · ${operation.status}`}
          >
            {operation.warnings.length ? (
              <ul
                className="tw:type-caption tw:grid tw:gap-1 tw:px-3 tw:pt-3 tw:text-app-text-soft"
                role="status"
              >
                {operation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <pre className="tw:type-code tw:max-h-64 tw:overflow-auto tw:whitespace-pre-wrap tw:p-3">
              {output || '等待输出…'}
            </pre>
          </SettingsSection>
        ) : null}
        <ConfirmationDialog
          open={deleting !== null}
          title="删除工作树？"
          description="关联聊天会先归档；工作树创建快照后删除，可稍后恢复。运行中或置顶的聊天会阻止删除。"
          actionLabel="删除"
          tone="danger"
          actionDisabled={busy}
          onCancel={() => {
            if (!busy) setDeleting(null)
          }}
          onAction={() => {
            const id = deleting
            setDeleting(null)
            if (id) void mutate((operationId) => client.deleteWorktreeFromSettings(id, operationId))
          }}
        />
      </div>
    </SettingsContentArea>
  )
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Worktree 操作失败。'
}
