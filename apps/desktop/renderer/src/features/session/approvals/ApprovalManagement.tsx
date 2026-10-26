import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, X } from 'lucide-react'
import type { RpcResult } from '@pidex/agent-protocol'
import type { PermissionRule, PermissionRuleEffect } from '@pidex/shared/thread'
import type { DesktopSessionSnapshot } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { Button } from '../../../components/ui/Button.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import { RequestCard } from './RequestCard.js'
import { useApprovalCapability } from './UseQuestionSkipCapability.js'
import { ApprovalRuleEditor } from './ApprovalRuleEditor.js'
import {
  APPROVAL_RULE_EFFECT_TABS,
  approvalRuleEditorValuesFromRule,
  approvalRuleMatchSummary,
  approvalRuleScopeDescription,
  applyApprovalRuleRevoke,
  applyApprovalRuleUpsert,
  buildApprovalRuleInput,
  canEditApprovalRule,
  countApprovalRulesByEffect,
  createApprovalRuleEditorValues,
  filterApprovalRules,
  isApprovalRuleVersionConflict,
  type ApprovalRuleEditorValues,
} from './ApprovalRulesModel.js'
import { cx } from '../../../utils/Cx.js'

type ReviewState = RpcResult<'approval/reviewState'>
const dismissedNudges = new Set<string>()

const RISK_LABELS: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '灾难级风险',
}
const AUTH_LABELS: Record<string, string> = {
  unknown: '授权未知',
  low: '授权弱',
  medium: '授权中',
  high: '授权明确',
}
const STATUS_LABELS: Record<string, string> = {
  completed: '审查完成',
  cached: '低风险放行',
  unavailable: '审查不可用',
  timeout: '审查超时',
  circuit_open: '本轮已中断',
}

export function useApprovalReviewState(threadId: string | null | undefined, busy: boolean) {
  const supported = useApprovalCapability(threadId ?? '', !!threadId, 'approval.retry.v1')
  const [state, setState] = React.useState<ReviewState>({ manualAllows: 0, denials: [], reviews: [] })
  React.useEffect(() => {
    let active = true
    setState({ manualAllows: 0, denials: [], reviews: [] })
    if (supported && threadId)
      void desktopClient
        .approvalReviewState(threadId)
        .then((result) => {
          if (active) setState(result)
        })
        .catch(() => {})
    return () => {
      active = false
    }
  }, [threadId, busy, supported])
  return { supported, state }
}

export function AutoReviewNudge({
  threadId,
  enabled,
  onEnable,
}: {
  threadId: string
  enabled: boolean
  onEnable: () => void | Promise<void>
}) {
  const [dismissed, setDismissed] = React.useState(() => dismissedNudges.has(threadId))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  if (!enabled || dismissed) return null
  const close = () => {
    dismissedNudges.add(threadId)
    setDismissed(true)
  }
  return (
    <RequestCard
      title="启用自动审查？"
      variant="permission"
      description={
        <>
          <p className="inline-approval-target tw:m-0 tw:px-2 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere">
            你已成功允许三次操作。可以由 Guardian 审查后续操作；关闭此提示会保留人工审批。
          </p>
          {error ? <p role="alert">{error}</p> : null}
        </>
      }
      actions={
        <div className="inline-approval-actions tw:ml-auto tw:flex tw:shrink-0 tw:flex-wrap tw:items-center tw:gap-2">
          <Button color="secondary" disabled={busy} onClick={close}>
            保持人工审批
          </Button>
          <Button
            color="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError('')
              void Promise.resolve()
                .then(onEnable)
                .then(close)
                .catch(() => setError('启用失败，请重试。'))
                .finally(() => setBusy(false))
            }}
          >
            启用自动审查
          </Button>
        </div>
      }
    >
      {null}
    </RequestCard>
  )
}

type ApprovalRuleEditorState = {
  mode: 'create' | 'edit'
  id?: string
  expectedVersion?: string
  values: ApprovalRuleEditorValues
}

/** Workspace roots the host actually resolved for this thread; nothing is persisted here. */
function sessionWorkspaceRoots(snapshot: DesktopSessionSnapshot | null): string[] {
  const roots = new Set<string>()
  const workspace = snapshot?.workspace
  if (workspace?.path) roots.add(workspace.path)
  for (const folder of workspace?.folders ?? []) {
    if (folder.path) roots.add(folder.path)
  }
  for (const directory of snapshot?.settings.additionalDirectories ?? []) {
    if (directory) roots.add(directory)
  }
  return [...roots]
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function ApprovalRulesDialog({
  threadId,
  open,
  onClose,
}: {
  threadId: string
  open: boolean
  onClose: () => void
}) {
  const supported = useApprovalCapability(threadId, Boolean(threadId) && open, 'permission.rules.v1')
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const [rules, setRules] = React.useState<PermissionRule[]>([])
  const [workspaceRoots, setWorkspaceRoots] = React.useState<string[]>([])
  const [isProjectChat, setIsProjectChat] = React.useState(false)
  const [tab, setTab] = React.useState<PermissionRuleEffect>('allow')
  const [query, setQuery] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [versionConflict, setVersionConflict] = React.useState(false)
  const [editor, setEditor] = React.useState<ApprovalRuleEditorState | null>(null)
  const [editorError, setEditorError] = React.useState<string | null>(null)
  const [pendingRevoke, setPendingRevoke] = React.useState<PermissionRule | null>(null)
  const loadGenerationRef = React.useRef(0)

  const loadRules = React.useCallback(async (): Promise<void> => {
    if (!threadId) return
    const generation = ++loadGenerationRef.current
    setLoading(true)
    setError('')
    setVersionConflict(false)
    try {
      const [listed, snapshot] = await Promise.all([
        desktopClient.listApprovalRules(threadId),
        desktopClient.getSession(threadId).catch(() => null),
      ])
      if (generation !== loadGenerationRef.current) return
      setRules([...listed.rules])
      setWorkspaceRoots(sessionWorkspaceRoots(snapshot))
      setIsProjectChat(Boolean(snapshot?.workspace.projectId))
      // A refresh after a version conflict must resync the open editor's expected version.
      setEditor((current) => {
        if (!current?.id) return current
        const refreshed = listed.rules.find((rule) => rule.id === current.id)
        return refreshed ? { ...current, expectedVersion: refreshed.version } : current
      })
    } catch (cause) {
      if (generation === loadGenerationRef.current)
        setError(errorMessage(cause, '审批规则暂时不可用。'))
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false)
    }
  }, [threadId])

  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setTab('allow')
    setEditor(null)
    setEditorError(null)
    setPendingRevoke(null)
    // Chat isolation: never show the previous chat's catalog while this one loads.
    // `error`/`versionConflict` also belong to the previous chat's requests.
    setRules([])
    setWorkspaceRoots([])
    setIsProjectChat(false)
    setVersionConflict(false)
    setError('')
    if (supported) void loadRules()
    return () => {
      loadGenerationRef.current += 1
    }
  }, [open, supported, loadRules])

  const visibleRules = React.useMemo(
    () => filterApprovalRules(rules, tab, query),
    [rules, tab, query],
  )
  const counts = React.useMemo(() => countApprovalRulesByEffect(rules), [rules])

  const openCreate = (): void => {
    setEditorError(null)
    // A new edit session starts clean; a conflict banner from an abandoned one would mislead.
    setVersionConflict(false)
    setEditor({ mode: 'create', values: createApprovalRuleEditorValues(tab) })
  }

  const openEdit = (rule: PermissionRule): void => {
    setEditorError(null)
    setVersionConflict(false)
    setEditor({
      mode: 'edit',
      id: rule.id,
      expectedVersion: rule.version,
      values: approvalRuleEditorValuesFromRule(rule),
    })
  }

  const saveRule = async (): Promise<void> => {
    if (!editor || busy) return
    const built = buildApprovalRuleInput(editor.values, {
      ...(editor.id ? { id: editor.id } : {}),
      isProjectChat,
    })
    if (!built.input) {
      setEditorError(built.error)
      return
    }
    setBusy(true)
    setEditorError(null)
    setError('')
    try {
      const result = await desktopClient.upsertApprovalRule({
        threadId,
        rule: built.input,
        ...(editor.expectedVersion ? { expectedVersion: editor.expectedVersion } : {}),
      })
      setRules((current) => applyApprovalRuleUpsert(current, result.rule))
      setTab(result.rule.effect)
      setEditor(null)
      setVersionConflict(false)
      await loadRules()
    } catch (cause) {
      if (isApprovalRuleVersionConflict(cause)) setVersionConflict(true)
      else setEditorError(errorMessage(cause, '保存审批规则失败，请重试。'))
    } finally {
      setBusy(false)
    }
  }

  const revokeRule = async (): Promise<void> => {
    if (!pendingRevoke || busy) return
    setBusy(true)
    setError('')
    try {
      await desktopClient.revokeApprovalRule(
        threadId,
        pendingRevoke.id,
        pendingRevoke.version,
      )
      setRules((current) => applyApprovalRuleRevoke(current, pendingRevoke.id))
      if (editor?.id === pendingRevoke.id) setEditor(null)
      setPendingRevoke(null)
      // User/project rules share the configuration layer's version.
      await loadRules()
    } catch (cause) {
      if (isApprovalRuleVersionConflict(cause)) setVersionConflict(true)
      else setError(errorMessage(cause, '撤销审批规则失败，请重试。'))
      setPendingRevoke(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--centered permission-modal confirmation-dialog tw:grid tw:max-h-[min(44rem,90vh)] tw:w-[min(48rem,100%)] tw:gap-3 tw:overflow-y-auto tw:p-5"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="confirmation-dialog-header tw:flex tw:items-start tw:justify-between tw:gap-3">
            <div className="tw:min-w-0 tw:flex-1">
              <Dialog.Title className="tw:m-0 tw:text-app-text tw:type-title-sm">
                审批规则
              </Dialog.Title>
              <Dialog.Description className="tw:m-0 tw:mt-1 tw:text-app-text-soft tw:type-body-sm">
                规则叠加在权限预设之上：拒绝优先于询问，询问优先于允许。聊天规则只影响当前聊天；
                用户和项目规则写入持久配置，需要你主动选择。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild disabled={busy}>
              <Button isIconOnly color="ghostSecondary" size="toolbar" title="关闭对话框">
                <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            </Dialog.Close>
          </header>

          {!supported ? (
            <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm" role="status">
              正在确认审批规则能力…当前 Agent 需要协商 permission.rules.v1 才能管理规则。
            </p>
          ) : (
            <>
              <SegmentedControl
                ariaLabel="审批规则效果"
                options={APPROVAL_RULE_EFFECT_TABS.map((entry) => ({
                  value: entry.value,
                  label: `${entry.label}（${counts[entry.value]}）`,
                }))}
                semantics="tabs"
                size="sm"
                value={tab}
                onChange={(value) => setTab(value as PermissionRuleEffect)}
              />
              <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                <SearchInput
                  aria-label="搜索审批规则"
                  className="tw:min-w-0 tw:flex-1"
                  onChange={setQuery}
                  placeholder="搜索工具、路径、命令、域名或服务器"
                  value={query}
                  variant="outlined"
                />
                <Button
                  color="secondary"
                  disabled={loading || busy}
                  size="md"
                  onClick={openCreate}
                >
                  添加规则
                </Button>
              </div>
              {versionConflict ? (
                <div
                  className="tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:rounded-control tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-2"
                  role="alert"
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className="tw:shrink-0 tw:text-app-warning"
                    size="var(--inline-icon-size, 1em)"
                  />
                  <span className="tw:min-w-0 tw:flex-1 tw:text-app-text-soft tw:type-body-sm">
                    规则已在其他位置更新，请刷新后重试。
                  </span>
                  <Button
                    color="secondary"
                    disabled={loading}
                    size="sm"
                    onClick={() => void loadRules()}
                  >
                    刷新规则
                  </Button>
                </div>
              ) : null}
              {error ? (
                <p className="tw:m-0 tw:text-app-danger tw:type-body-sm" role="alert">
                  {error}
                </p>
              ) : null}
              {editor ? (
                <ApprovalRuleEditor
                  busy={busy}
                  error={editorError}
                  isProjectChat={isProjectChat}
                  mode={editor.mode}
                  values={editor.values}
                  workspaceRoots={workspaceRoots}
                  onCancel={() => {
                    if (!busy) {
                      setEditor(null)
                      setEditorError(null)
                      // Abandoning the edit abandons its conflict too.
                      setVersionConflict(false)
                    }
                  }}
                  onChange={(values) => setEditor((current) => (current ? { ...current, values } : current))}
                  onSave={() => void saveRule()}
                />
              ) : null}
              <div
                className="tw:grid tw:max-h-[min(22rem,45vh)] tw:min-h-0 tw:gap-2 tw:overflow-y-auto"
                data-approval-rule-list={tab}
              >
                {loading ? (
                  <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm" role="status">
                    正在加载审批规则…
                  </p>
                ) : visibleRules.length ? (
                  visibleRules.map((rule) => (
                    <div
                      className={cx(
                        'tw:grid tw:min-w-0 tw:gap-1 tw:rounded-control tw:border tw:border-app-border-subtle tw:p-2',
                        rule.source === 'legacy' ? 'tw:bg-app-panel' : 'tw:bg-app-canvas',
                      )}
                      data-approval-rule-id={rule.id}
                      key={rule.id}
                    >
                      <div className="tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-3">
                        <div className="tw:grid tw:min-w-0 tw:gap-0.5">
                          <span className="tw:text-app-text tw:type-body-sm tw:wrap-anywhere">
                            {approvalRuleMatchSummary(rule.match)}
                          </span>
                          <span className="tw:text-app-text-meta tw:type-caption">
                            {approvalRuleScopeDescription(rule)}
                          </span>
                        </div>
                        <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-1">
                          {canEditApprovalRule(rule) ? (
                            <Button
                              color="ghostSecondary"
                              disabled={busy}
                              size="sm"
                              onClick={() => openEdit(rule)}
                            >
                              编辑
                            </Button>
                          ) : null}
                          <Button
                            color="ghostSecondary"
                            disabled={busy}
                            size="sm"
                            onClick={() => setPendingRevoke(rule)}
                          >
                            撤销
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm">
                    {query.trim() ? '没有匹配的规则。' : `暂无${tab === 'ask' ? '询问' : tab === 'deny' ? '拒绝' : '允许'}规则。`}
                  </p>
                )}
              </div>
            </>
          )}

          <ConfirmationDialog
            actionDisabled={busy}
            actionLabel="撤销规则"
            cancelLabel="取消"
            description={
              pendingRevoke ? (
                <>
                  <p className="tw:m-0">{approvalRuleMatchSummary(pendingRevoke.match)}</p>
                  <p className="tw:m-0 tw:mt-1">
                    撤销后规则立即失效；旧授权撤销只影响后续判定，不会删除历史会话。
                  </p>
                </>
              ) : null
            }
            open={pendingRevoke !== null}
            title="撤销审批规则？"
            tone="danger"
            onAction={() => void revokeRule()}
            onCancel={() => {
              if (!busy) setPendingRevoke(null)
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ApprovalRetryDialog({
  threadId,
  open,
  onClose,
}: {
  threadId: string
  open: boolean
  onClose: () => void
}) {
  const [state, setState] = React.useState<ReviewState>({ manualAllows: 0, denials: [], reviews: [] })
  const [selected, setSelected] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let active = true
    if (open) {
      setBusy(true)
      setError('')
      void desktopClient
        .approvalReviewState(threadId)
        .then((result) => {
          if (active) {
            setState(result)
            setSelected(result.denials[0]?.id ?? '')
          }
        })
        .catch(() => {
          if (active) setError('最近拒绝暂时不可用。')
        })
        .finally(() => {
          if (active) setBusy(false)
        })
    }
    return () => {
      active = false
    }
  }, [threadId, open])
  return (
    <ConfirmationDialog
      open={open}
      title="最近拒绝"
      actionLabel="授权一次并请求重试"
      actionDisabled={busy || !selected}
      onCancel={() => {
        if (!busy) onClose()
      }}
      onAction={() => {
        setBusy(true)
        setError('')
        void desktopClient
          .retryApproval(threadId, selected)
          .then(onClose)
          .catch(() => setError('请求重试失败，请重试。'))
          .finally(() => setBusy(false))
      }}
      description={
        <div className="request-card-content">
          <p>选择最近被自动审查拒绝的操作；授权仅匹配原工具、参数和范围，重试仍经过 Guardian。</p>
          <p className="tw:text-app-text-soft tw:type-body-sm">
            最近 {state.reviews.length} 次自动审查 · 人工允许累计 {state.manualAllows} 次 · 可重试拒绝{' '}
            {state.denials.length} 次
          </p>
          {error ? <p role="alert">{error}</p> : null}
          {!busy && !state.denials.length ? <p>当前聊天没有可重试的自动审查拒绝。</p> : null}
          {state.denials.map((denial) => (
            <button
              type="button"
              key={denial.id}
              role="radio"
              aria-checked={selected === denial.id}
              className={cx(
                'inline-approval-option tw:grid tw:w-full tw:gap-1 tw:rounded-lg tw:border tw:border-transparent tw:p-2 tw:text-left tw:text-app-text tw:type-body tw:focus-visible:shadow-[var(--cpx-sys-focus-ring)] tw:focus-visible:outline-none',
                selected === denial.id ? 'selected tw:bg-app-hover' : 'tw:bg-transparent',
              )}
              disabled={busy}
              onClick={() => setSelected(denial.id)}
            >
              <span>
                {denial.tool}：{denial.reason}
              </span>
              <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption">
                <span>{STATUS_LABELS[denial.guardian.status] ?? denial.guardian.status}</span>
                <span>{RISK_LABELS[denial.guardian.risk] ?? denial.guardian.risk}</span>
                <span>
                  {AUTH_LABELS[denial.guardian.userAuthorization] ??
                    denial.guardian.userAuthorization}
                </span>
                {denial.guardian.fallbackReason ? (
                  <span>回退：{denial.guardian.fallbackReason}</span>
                ) : null}
              </span>
              {denial.input ? (
                <pre className="inline-approval-command tw:block tw:w-full tw:min-w-0 tw:overflow-auto tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:type-code tw:whitespace-pre-wrap tw:break-all tw:max-h-[3lh]">
                  {JSON.stringify(denial.input, null, 2)}
                </pre>
              ) : null}
            </button>
          ))}
        </div>
      }
    />
  )
}
