import React from 'react'
import { CirclePlus, LoaderCircle } from 'lucide-react'
import type { VirtualizerHandle } from 'virtua'
import type {
  DesktopPermissionMode,
  DesktopModelSelection,
  DesktopSessionStatus,
} from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'
import { APP_ICON_STROKE_WIDTH, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { WorkbenchTabDescriptor } from '../../layout/dock/RightDockState.js'
import { InlineApprovalCard } from '../approvals/InlineApprovalCard.js'
import { PlanApprovalCard } from '../approvals/PlanApprovalCard.js'
import { usePlanApprovalResponse } from '../approvals/UsePlanApprovalResponse.js'
import type { OpenPlanInDockRequest } from '../workflow/WorkflowPlanCard.js'
import { CanonicalThreadView } from '../timeline/CanonicalThreadView.js'
import type { ThreadTimelineNavigationHandle } from '../timeline/SessionTimelineView.js'
import { useCanonicalThreadConversation } from '../timeline/UseCanonicalThreadConversation.js'
import { selectCanonicalConversationAuxiliaryState } from './CanonicalConversationSelectors.js'
import {
  ConversationItemContext,
  type ConversationItemContextValue,
} from '../timeline/ConversationItemContext.js'
import { ThreadComposerDock } from './ThreadComposerDock.js'
import { ThreadScrollLayout } from './ThreadScrollLayout.js'

type SideChatTab = Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>

export type SideChatComposerRenderContext = {
  hasVisibleMessages: boolean
  status: DesktopSessionStatus
  planModeActive?: boolean
}

export function SideChatThreadPanel({
  active,
  creating,
  focusVersion,
  tab,
  onOpenPatchReview,
  onOpenPlan,
  onRecreate,
  onStateChange,
  itemContext,
  onInteractionError,
  permissionMode,
  modelSelection,
  renderComposer,
}: {
  active: boolean
  creating: boolean
  focusVersion: number
  tab: SideChatTab
  onOpenPatchReview?: (path?: string) => void
  onOpenPlan?: (request: OpenPlanInDockRequest) => void
  onRecreate: (tab: SideChatTab) => void
  onStateChange: (threadId: string, count: number, status: DesktopSessionStatus) => void
  itemContext: (status: DesktopSessionStatus) => ConversationItemContextValue
  onInteractionError: (message: string) => void
  permissionMode: DesktopPermissionMode
  modelSelection?: Pick<DesktopModelSelection, 'providerID' | 'model' | 'variant'>
  renderComposer: (tab: SideChatTab, context: SideChatComposerRenderContext) => React.ReactNode
}): React.ReactNode {
  const surfaceRef = React.useRef<HTMLDivElement | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const footerRef = React.useRef<HTMLElement | null>(null)
  const listRef = React.useRef<VirtualizerHandle | null>(null)
  const navigationRef = React.useRef<ThreadTimelineNavigationHandle | null>(null)
  const scope = React.useMemo(
    () => ({
      type: 'side-chat' as const,
      inheritedThroughTurnId: tab.inheritedThroughTurnId,
    }),
    [tab.inheritedThroughTurnId],
  )
  const conversation = useCanonicalThreadConversation(tab.threadId, scope)
  const pendingPlanApproval = conversation.state?.pendingPlanApproval
  const planApproval = usePlanApprovalResponse(
    pendingPlanApproval,
    conversation.reload,
    modelSelection,
  )
  const auxiliary = React.useMemo(
    () => selectCanonicalConversationAuxiliaryState(conversation.state),
    [conversation.state],
  )
  const visibleTurnCount = conversation.turns.length
  const expired = Boolean(
    conversation.error && /(?:THREAD_NOT_FOUND|找不到|不存在|not found)/iu.test(conversation.error),
  )
  const status = deriveSideChatStatus(conversation.turns.at(-1)?.turn.status)

  React.useEffect(() => {
    onStateChange(tab.threadId, visibleTurnCount, status)
  }, [onStateChange, status, tab.threadId, visibleTurnCount])

  React.useEffect(() => {
    if (!active) return
    const editor = surfaceRef.current?.querySelector<HTMLElement>(
      'textarea, [contenteditable="true"]',
    )
    editor?.focus()
  }, [active, focusVersion])

  const composer = renderComposer(tab, {
    hasVisibleMessages: visibleTurnCount > 0,
    status,
    planModeActive: conversation.state
      ? conversation.state.thread.settings.taskMode === 'plan'
      : undefined,
  })

  return (
    <section
      aria-label={tab.title}
      className="right-dock-side-chat tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-col tw:bg-app-dock"
      data-side-chat-thread-id={tab.threadId}
    >
      <ThreadScrollLayout
        className="right-dock-side-chat__timeline tw:min-h-0 tw:flex-1"
        footer={
          !creating && !expired ? (
            <ThreadComposerDock ref={surfaceRef}>
              {auxiliary.pendingPermissions[0] ? (
                <InlineApprovalCard
                  onInterrupt={() => desktopClient.interruptSession(tab.threadId)}
                  currentPermissionMode={permissionMode}
                  request={auxiliary.pendingPermissions[0]}
                  onDecide={(
                    request,
                    behavior,
                    alwaysAllow = false,
                    updatedInput,
                    decisionExtras,
                  ) => {
                    return desktopClient
                      .respondToPermission(tab.threadId, request.requestId, {
                        behavior,
                        ...(behavior === 'deny' ? { message: '在桌面端界面中拒绝' } : {}),
                        alwaysAllow,
                        ...(updatedInput ? { updatedInput } : {}),
                        ...decisionExtras,
                      })
                      .catch((error) => {
                        onInteractionError(error instanceof Error ? error.message : String(error))
                        throw error
                      })
                  }}
                />
              ) : pendingPlanApproval ? (
                <PlanApprovalCard
                  approval={pendingPlanApproval}
                  disabledReason={planApproval.disabledReason}
                  onRespond={planApproval.respond}
                />
              ) : (
                composer
              )}
            </ThreadComposerDock>
          ) : null
        }
        footerRef={footerRef}
        scrollRef={scrollRef}
      >
        {creating ? (
          <div
            className="right-dock-side-chat__empty tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:px-6 tw:py-8 tw:text-center tw:text-app-text-soft tw:type-body"
            role="status"
          >
            <LoaderCircle size={APP_ICON_SIZES.lg} className="canonical-spin" aria-hidden="true" />
            <strong>正在启动侧边聊天</strong>
          </div>
        ) : expired ? (
          <div
            className="right-dock-side-chat__empty tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:px-6 tw:py-8 tw:text-center tw:text-app-text-soft tw:type-body"
            role="status"
          >
            <CirclePlus size={APP_ICON_SIZES.lg} aria-hidden="true" />
            <strong>侧边聊天已过期</strong>
            <span>此临时侧边聊天已不可用；请新建一个侧边聊天以继续。</span>
            <Button color="primary" onClick={() => onRecreate(tab)}>
              开始新的侧边聊天
            </Button>
          </div>
        ) : conversation.loading && visibleTurnCount === 0 ? (
          <div
            className="right-dock-side-chat__empty tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:px-6 tw:py-8 tw:text-center tw:text-app-text-soft tw:type-body"
            role="status"
          >
            <LoaderCircle size={APP_ICON_SIZES.lg} className="canonical-spin" aria-hidden="true" />
            <strong>正在启动侧边聊天</strong>
          </div>
        ) : visibleTurnCount === 0 && !conversation.error ? (
          <div
            className="right-dock-side-chat__empty tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:px-6 tw:py-8 tw:text-center tw:text-app-text-soft tw:type-body"
            role="status"
          >
            <span className="right-dock-side-chat__empty-icon">
              <CirclePlus
                aria-hidden="true"
                size={APP_ICON_SIZES.lg}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </span>
            <strong>侧边聊天</strong>
            <span>侧边聊天是临时聊天，关闭应用后会消失。</span>
          </div>
        ) : (
          <ConversationItemContext.Provider value={itemContext(status)}>
            <CanonicalThreadView
              active={status === 'running' || status === 'waiting'}
              error={conversation.error}
              hasOlder={conversation.hasOlder}
              listRef={listRef}
              loading={conversation.loading}
              loadingOlder={conversation.loadingOlder}
              navigationRef={navigationRef}
              onCanReturnToBottomChange={() => undefined}
              onLoadOlder={conversation.loadOlder}
              onOpenPatchReview={onOpenPatchReview}
              onOpenPlanInRightDock={(request) => onOpenPlan?.(request)}
              onOpenSubagent={() => undefined}
              onReload={conversation.reload}
              readThreadPatchDiff={desktopClient.readThreadPatchDiff}
              rightDockPlanEventId={null}
              scrollRef={scrollRef}
              threadId={tab.threadId}
              turns={conversation.turns}
            />
          </ConversationItemContext.Provider>
        )}
      </ThreadScrollLayout>
    </section>
  )
}

function deriveSideChatStatus(
  status:
    | 'queued'
    | 'running'
    | 'waiting-permission'
    | 'waiting-question'
    | 'waiting-subagents'
    | 'completed'
    | 'failed'
    | 'stopped'
    | 'interrupted'
    | 'cancelled'
    | undefined,
): DesktopSessionStatus {
  if (status === 'queued') return 'queued'
  if (status === 'running') return 'running'
  if (status?.startsWith('waiting-')) return 'waiting'
  return 'idle'
}
