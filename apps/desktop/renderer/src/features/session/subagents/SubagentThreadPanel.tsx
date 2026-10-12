import React from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  Circle,
  LoaderCircle,
  RotateCcw,
  Send,
  Square,
  X,
} from 'lucide-react'
import type {
  ApprovalRequest,
  Item,
  SubagentRun,
  SubagentTask,
  ThreadSnapshot,
} from '@pidex/shared/thread'
import {
  createCanonicalThreadState,
  pageFromThreadSnapshot,
  selectRenderTurnEntries,
} from '@pidex/session-view'
import type { VirtualizerHandle } from 'virtua'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { Textarea } from '../../../components/ui/Textarea.js'
import { Button } from '../../../components/ui/Button.js'

import { desktopClient } from '../../../services/desktop-client/index.js'
import { approvalToRequest } from '../../../services/AgentThreadAdapter.js'
import {
  InlineApprovalCard,
  type InlineApprovalCardProps,
} from '../approvals/InlineApprovalCard.js'
import { PlanApprovalCard } from '../approvals/PlanApprovalCard.js'
import { selectCanonicalConversationAuxiliaryState } from '../conversation/CanonicalConversationSelectors.js'
import {
  CanonicalConversationTurn,
  useTimelineDisclosureState,
} from '../timeline/CanonicalThreadView.js'
import { SessionTimelineView } from '../timeline/SessionTimelineView.js'
import { normalizePatchActionError } from '../timeline/PatchActionError.js'
import { subagentStatusLabel } from './SubagentStatusLabel.js'

export interface SubagentThreadCapabilities {
  canFollowup?: boolean
  canStop: boolean
  canRetry: boolean
  canRespondToApprovals: boolean
  canRespondToQuestions: boolean
  canRespondToPlan?: boolean
  canApplyWorktree: boolean
  canDiscardWorktree: boolean
  canRestoreWorkspace: boolean
}

export interface SubagentThreadCallbacks {
  onFollowup?: (message: string) => Promise<void>
  onSend?: (message: string) => Promise<void>
  onPatchApplied?: () => Promise<void>
  onStop?: (task: SubagentTask, run: SubagentRun) => void
  onRetry?: (task: SubagentTask, run: SubagentRun) => void
  onApplyWorktree?: (task: SubagentTask, run: SubagentRun) => void
  onDiscardWorktree?: (task: SubagentTask, run: SubagentRun) => void
  onRestoreWorkspace?: (task: SubagentTask, run: SubagentRun) => void
  onOpenSubagent?: (item: Extract<Item, { type: 'subagent' }>) => void
  onOpenPatchReview?: (path?: string) => void
  onRequestRespond?: InlineApprovalCardProps['onDecide']
  onInterrupt?: () => Promise<void>
}

export interface SubagentThreadPanelProps {
  task: SubagentTask
  run: SubagentRun
  snapshot: ThreadSnapshot
  capabilities: SubagentThreadCapabilities
  callbacks: SubagentThreadCallbacks
  onBackToParent?: () => void
}

export function SubagentThreadPanel({
  task,
  run,
  snapshot,
  capabilities,
  callbacks,
  onBackToParent,
}: SubagentThreadPanelProps): React.ReactNode {
  const [message, setMessage] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [sendError, setSendError] = React.useState<string | null>(null)
  const submitFollowup = async (steering = false) => {
    if (!message.trim() || sending || !callbacks.onFollowup) return
    setSending(true)
    setSendError(null)
    try {
      await (steering ? callbacks.onSend! : callbacks.onFollowup)(message)
      setMessage('')
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const listRef = React.useRef<VirtualizerHandle | null>(null)
  const disclosureState = useTimelineDisclosureState(task.childThreadId)
  const canonicalState = React.useMemo(
    () => createCanonicalThreadState(pageFromThreadSnapshot(snapshot)),
    [snapshot],
  )
  const canonicalTurns = React.useMemo(
    () => selectRenderTurnEntries(canonicalState, { type: 'subagent', runId: run.id }),
    [canonicalState, run.id],
  )
  const pendingRequests = React.useMemo(
    () => selectCanonicalConversationAuxiliaryState(canonicalState).pendingPermissions,
    [canonicalState],
  )
  const pendingRequest = pendingRequests[0]
  const canRespond =
    Boolean(callbacks.onRequestRespond) &&
    isActiveRun(run) &&
    (pendingRequest?.toolName === 'AskUserQuestion'
      ? capabilities.canRespondToQuestions
      : capabilities.canRespondToApprovals)
  const viewBlocked = pendingRequests.length > 0
  const blocked = isBlockedRun(run) || viewBlocked
  const canStop = capabilities.canStop && Boolean(callbacks.onStop) && isActiveRun(run)
  const canRetry = capabilities.canRetry && Boolean(callbacks.onRetry) && isTerminalRun(run)
  const scrollStorageKey = `pidex.subagent.scroll.${task.childThreadId}`
  const initialScrollOffset = React.useMemo(() => {
    try {
      const stored = Number(window.sessionStorage.getItem(scrollStorageKey) ?? 0)
      return Number.isFinite(stored) ? stored : 0
    } catch {
      return 0
    }
  }, [scrollStorageKey])
  const persistScroll = React.useCallback(
    (scrollTop: number): void => {
      try {
        window.sessionStorage.setItem(scrollStorageKey, String(scrollTop))
      } catch {
        // Session storage can be unavailable; scrolling remains functional.
      }
    },
    [scrollStorageKey],
  )
  const renderTurn = React.useCallback(
    (turn: (typeof canonicalTurns)[number]) => (
      <div
        className="session-turn-row canonical-turn-row tw:mx-auto tw:w-full tw:min-w-0"
        data-component="conversation-turn"
        key={turn.id}
      >
        <CanonicalConversationTurn
          disclosureState={disclosureState}
          entry={turn}
          onApplyPatch={async (itemId, action, expectedVersion) => {
            try {
              await desktopClient.applyThreadPatch({
                threadId: task.childThreadId,
                itemId,
                action,
                expectedVersion,
              })
              await callbacks.onPatchApplied?.()
            } catch (error) {
              throw normalizePatchActionError(error, action)
            }
          }}
          onOpenPatchReview={callbacks.onOpenPatchReview}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={(taskId) => {
            const item = snapshot.items.find(
              (candidate): candidate is Extract<Item, { type: 'subagent' }> =>
                candidate.type === 'subagent' && candidate.subagentTaskId === taskId,
            )
            if (item) callbacks.onOpenSubagent?.(item)
          }}
          dockedPlanItemId={null}
          readThreadPatchDiff={desktopClient.readThreadPatchDiff}
          threadId={task.childThreadId}
        />
      </div>
    ),
    [callbacks, disclosureState, snapshot.items, task.childThreadId],
  )

  return (
    <section
      aria-label={`${task.displayName} 子智能体线程`}
      className="subagent-thread-panel tw:grid tw:h-full tw:min-h-0 tw:min-w-0 tw:grid-rows-[auto_minmax(0,1fr)] tw:bg-app-panel tw:text-app-text tw:[container-type:inline-size]"
      data-blocked={blocked || undefined}
      data-status={run.status}
    >
      <header className="subagent-thread-panel__header tw:flex tw:min-h-[58px] tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-app-border-subtle tw:bg-app-raised tw:px-4 tw:py-3">
        <div className="subagent-thread-panel__identity tw:flex tw:min-w-0 tw:items-center tw:gap-3">
          {onBackToParent ? (
            <Button
              isIconOnly
              className="subagent-thread-panel__back tw:flex-none"
              color="ghostSecondary"
              size="toolbar"
              title="返回父对话"
              onClick={onBackToParent}
            >
              <ArrowLeft size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          ) : null}
          <span
            className="subagent-thread-panel__avatar tw:inline-flex tw:size-[30px] tw:flex-none tw:items-center tw:justify-center tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:text-app-text"
            aria-hidden="true"
          >
            <Bot data-icon-kind="artwork" size={14} strokeWidth={2} />
          </span>
          <div className="subagent-thread-panel__title-block tw:min-w-0">
            <h2 className="tw:m-0 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text tw:type-row-title tw:tracking-normal">
              {task.displayName}
            </h2>
          </div>
        </div>
        <div className="subagent-thread-panel__run-actions tw:flex tw:items-center tw:gap-1">
          <StatusBadge status={run.status} />
          {capabilities.canApplyWorktree && callbacks.onApplyWorktree ? (
            <Button
              isIconOnly
              aria-label="应用子智能体变更"
              color="ghostSecondary"
              size="toolbar"
              title="应用子智能体变更"
              onClick={() => callbacks.onApplyWorktree?.(task, run)}
            >
              <Check size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          ) : null}
          {capabilities.canDiscardWorktree && callbacks.onDiscardWorktree ? (
            <Button
              isIconOnly
              aria-label="丢弃子智能体工作树"
              color="danger"
              size="toolbar"
              title="丢弃子智能体工作树"
              onClick={() => callbacks.onDiscardWorktree?.(task, run)}
            >
              <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          ) : null}
          {capabilities.canRestoreWorkspace && callbacks.onRestoreWorkspace ? (
            <Button
              isIconOnly
              aria-label="恢复子智能体共享变更"
              color="ghostSecondary"
              size="toolbar"
              title="恢复共享变更"
              onClick={() => callbacks.onRestoreWorkspace?.(task, run)}
            >
              <RotateCcw size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          ) : null}
          {canRetry ? (
            <Button
              isIconOnly
              aria-label="重试子智能体"
              color="ghostSecondary"
              size="toolbar"
              title="重试"
              onClick={() => callbacks.onRetry?.(task, run)}
            >
              <RotateCcw size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          ) : null}
          {canStop ? (
            <Button
              isIconOnly
              aria-label="停止子智能体"
              color="danger"
              size="toolbar"
              title="停止此子智能体及全部后代"
              onClick={() => callbacks.onStop?.(task, run)}
            >
              <Square size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          ) : null}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="subagent-thread-panel__scroll-region tw:min-h-0 tw:overflow-auto tw:[scrollbar-gutter:stable]"
      >
        <div className="subagent-thread-panel__transcript tw:mx-auto tw:grid tw:w-[min(760px,calc(100%-28px))] tw:min-w-0 tw:gap-4 tw:px-0 tw:pt-5 tw:pb-7">
          <div className="tw:text-app-text-meta tw:type-caption" role="status">
            第 {task.depth ?? 1} 层{task.waitingForDescendants ? ' · 等待后代结算' : ''}
            {task.queuedFollowups ? ` · ${task.queuedFollowups} 条后续任务已接纳` : ''}
          </div>
          {run.queueReason ? (
            <div
              className="subagent-thread-panel__notice tw:flex tw:items-center tw:gap-2 tw:rounded-lg tw:px-3 tw:py-2 tw:bg-app-editor tw:text-app-text-meta tw:type-body-sm"
              role="status"
            >
              <LoaderCircle className="tw:animate-spin" size={APP_ICON_SIZE} />
              {queueReasonLabel(run.queueReason)}
            </div>
          ) : null}

          {canonicalTurns.length > 0 ? (
            <div className="subagent-thread-panel__timeline tw:grid tw:gap-4">
              {typeof document === 'undefined' ? (
                canonicalTurns.map(renderTurn)
              ) : (
                <SessionTimelineView
                  count={canonicalTurns.length}
                  initialScrollOffset={initialScrollOffset}
                  items={canonicalTurns}
                  listRef={listRef}
                  onScroll={persistScroll}
                  renderItem={renderTurn}
                  scrollRef={scrollRef}
                  scrollToBottom={isActiveRun(run)}
                  sessionKey={task.childThreadId}
                />
              )}
            </div>
          ) : (
            <div
              className="subagent-thread-panel__empty tw:py-7 tw:text-center tw:text-app-text-meta tw:type-body"
              role="status"
            >
              {run.status === 'queued' || run.status === 'preparing'
                ? '等待开始执行'
                : '暂无运行记录'}
            </div>
          )}

          {pendingRequest ? (
            <InlineApprovalCard
              key={pendingRequest.requestId}
              request={pendingRequest}
              identity={task.displayName}
              disabledReason={canRespond ? undefined : '此子智能体当前不可操作，请通过父任务继续。'}
              onDecide={
                callbacks.onRequestRespond ??
                (() => Promise.reject(new Error('此子智能体当前不可操作。')))
              }
              onInterrupt={canStop ? callbacks.onInterrupt : undefined}
            />
          ) : snapshot.pendingPlanApproval ? (
            <PlanApprovalCard
              approval={snapshot.pendingPlanApproval}
              identity={task.displayName}
              disabledReason="此子智能体没有计划续跑入口，请返回父任务处理。"
              onRespond={() => Promise.reject(new Error('此子智能体不支持计划操作。'))}
            />
          ) : null}

          {blocked ? <BlockedNotice run={run} viewBlocked={viewBlocked} /> : null}
          {run.error ? (
            <div
              className="subagent-thread-panel__error tw:flex tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:border-app-danger-border tw:bg-app-danger-subtle tw:px-3 tw:py-2 tw:text-app-danger-fg tw:type-body-sm"
              role="alert"
            >
              <AlertCircle size={APP_ICON_SIZE} />
              <span>{run.error}</span>
            </div>
          ) : null}
          {run.result ? <RunResult result={run.result} /> : null}
          {task.notices
            ?.filter((notice) => notice.kind === 'report')
            .map((notice) => (
              <p key={notice.id} className="tw:text-app-text-meta tw:type-body-sm">
                已向父代理报告：{notice.message}
              </p>
            ))}
          {capabilities.canFollowup && callbacks.onFollowup ? (
            <form
              className="tw:grid tw:gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void submitFollowup()
              }}
            >
              <Textarea
                aria-label="子智能体后续任务"
                placeholder="排队提交后续任务，不打断当前工作"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={sending}
              />
              <div className="tw:flex tw:gap-2">
                <Button type="submit" disabled={sending || !message.trim()}>
                  <Send size={APP_ICON_SIZE} />
                  排队后续任务
                </Button>
                {callbacks.onSend ? (
                  <Button
                    type="button"
                    disabled={sending || !message.trim()}
                    onClick={() => void submitFollowup(true)}
                  >
                    补充当前要求
                  </Button>
                ) : null}
              </div>
              {sendError ? <p role="alert">{sendError}</p> : null}
            </form>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function BlockedNotice({
  run,
  viewBlocked,
}: {
  run: SubagentRun
  viewBlocked: boolean
}): React.ReactNode {
  const label =
    run.status === 'waiting-permission'
      ? '等待审批后继续'
      : run.status === 'waiting-question'
        ? '等待回答后继续'
        : viewBlocked
          ? '此子智能体正在等待你的操作'
          : '此子智能体已阻塞'
  return (
    <div
      className="subagent-thread-panel__blocked tw:flex tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:border-app-warning-border tw:bg-app-warning-subtle tw:px-3 tw:py-2 tw:text-app-warning-fg tw:type-body-sm"
      role="status"
    >
      <AlertCircle size={APP_ICON_SIZE} />
      <span>{label}</span>
    </div>
  )
}

function RunResult({ result }: { result: NonNullable<SubagentRun['result']> }): React.ReactNode {
  return (
    <article
      className="subagent-thread-panel__result tw:grid tw:gap-3 tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-3"
      data-outcome={result.outcome}
    >
      <header className="tw:flex tw:items-center tw:gap-2">
        {result.outcome === 'succeeded' ? (
          <Check className="tw:text-app-success" size={APP_ICON_SIZES.sm} />
        ) : (
          <AlertCircle size={APP_ICON_SIZE} />
        )}
        <strong>{result.summary}</strong>
      </header>
      {result.findings.length > 0 ? (
        <ul className="tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0">
          {result.findings.map((finding, index) => (
            <li
              className="tw:grid tw:gap-1 tw:border-t tw:border-app-border-subtle tw:pt-2"
              key={`${finding.title}:${index}`}
            >
              <strong>{finding.title}</strong>
              <span className="tw:text-app-text-meta tw:type-body">{finding.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

function StatusBadge({ status }: { status: SubagentRun['status'] }): React.ReactNode {
  return (
    <span
      className="subagent-thread-panel__status-badge tw:flex tw:flex-none tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-editor tw:px-2 tw:py-1 tw:text-app-text-meta tw:type-caption tw:data-[status=completed]:border-app-success-border tw:data-[status=completed]:bg-app-success-subtle tw:data-[status=completed]:text-app-success-fg tw:data-[status=failed]:border-app-danger-border tw:data-[status=failed]:bg-app-danger-subtle tw:data-[status=failed]:text-app-danger-fg tw:data-[status=interrupted]:border-app-danger-border tw:data-[status=interrupted]:bg-app-danger-subtle tw:data-[status=interrupted]:text-app-danger-fg"
      data-status={status}
    >
      {isActiveRunStatus(status) ? (
        <LoaderCircle className="tw:animate-spin" size={APP_ICON_SIZES.sm} />
      ) : status === 'completed' ? (
        <Check size={APP_ICON_SIZES.sm} />
      ) : status === 'failed' ? (
        <X size={APP_ICON_SIZES.sm} />
      ) : (
        <Circle size={APP_ICON_SIZES.sm} />
      )}
      {subagentStatusLabel(status)}
    </span>
  )
}

function queueReasonLabel(reason: NonNullable<SubagentRun['queueReason']>): string {
  if (reason === 'parent-limit') return '等待同一父智能体释放并发名额'
  if (reason === 'global-limit') return '等待全局并发名额'
  return '等待共享工作区写入锁'
}

function isBlockedRun(run: SubagentRun): boolean {
  return (
    run.status === 'waiting-permission' ||
    run.status === 'waiting-question' ||
    run.result?.outcome === 'blocked'
  )
}

function isActiveRun(run: SubagentRun): boolean {
  return (
    isActiveRunStatus(run.status) ||
    run.status === 'waiting-permission' ||
    run.status === 'waiting-question'
  )
}

function isActiveRunStatus(status: SubagentRun['status']): boolean {
  return (
    status === 'queued' || status === 'preparing' || status === 'running' || status === 'steering'
  )
}

function isTerminalRun(run: SubagentRun): boolean {
  return (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'stopped' ||
    run.status === 'interrupted'
  )
}
