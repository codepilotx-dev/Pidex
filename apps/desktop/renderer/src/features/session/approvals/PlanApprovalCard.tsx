import React from 'react'
import type { PlanApproval } from '@pidex/shared/thread'
import { ChevronDown } from 'lucide-react'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import { Dropdown } from '../../../components/ui/Dropdown.js'
import { Dropdown as DropdownMenu } from '../../../components/ui/floating/Dropdown.js'
import { RequestCard } from './RequestCard.js'
import type { OpenPlanInDockRequest } from '../workflow/WorkflowPlanCard.js'

export type PlanApprovalResponse =
  | { action: 'implement' }
  | { action: 'implementFresh' }
  | { action: 'feedback'; feedback: string }
  | { action: 'close' }

export type PlanApprovalCardProps = {
  approval: PlanApproval
  identity?: string
  disabledReason?: string
  onRespond: (response: PlanApprovalResponse) => Promise<void>
  /** 在右栏打开待审阅计划正文；缺省时不显示“查看全文”。 */
  onOpenPlan?: (plan: OpenPlanInDockRequest) => void
  freshAvailable?: boolean
}

const FEEDBACK_PLACEHOLDER = '例如：先完成提问交互，计划侧栏放到下一阶段……'

/**
 * 计划审阅动作与澄清选择题分开：这里只呈现阅读入口和四个真实动作，
 * 不再复用 Plan 专用的选择题答案映射。
 */
export function PlanApprovalCard({
  approval,
  identity,
  disabledReason,
  onRespond,
  onOpenPlan,
  freshAvailable = false,
}: PlanApprovalCardProps): React.ReactNode {
  const [editingFeedback, setEditingFeedback] = React.useState(false)
  const [feedback, setFeedback] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<PlanApprovalResponse['action'] | null>(null)
  const feedbackId = React.useId()
  const feedbackRef = React.useRef<HTMLTextAreaElement | null>(null)
  const disabled = busy !== null || Boolean(disabledReason)

  // 计划版本变化代表旧审批已失效：清掉提示与提交态，避免把旧动作带到新计划上。
  React.useEffect(() => {
    setBusy(null)
    setError(null)
    setEditingFeedback(false)
  }, [approval.id, approval.version])

  React.useEffect(() => {
    if (editingFeedback) feedbackRef.current?.focus()
  }, [editingFeedback])

  async function act(build: () => PlanApprovalResponse): Promise<void> {
    if (disabled) return
    const response = build()
    setBusy(response.action)
    setError(null)
    try {
      await onRespond(response)
    } catch {
      // 失败保留反馈草稿与阅读位置，只就地提示。
      setError('操作失败，请重试。')
      setBusy(null)
    }
  }

  // Escape 只退出反馈编辑，不关闭计划、不切模式、不发送。
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!editingFeedback || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    setEditingFeedback(false)
  }

  const plan: OpenPlanInDockRequest = {
    planItemId: approval.planItemId,
    threadId: approval.threadId,
    title: approval.title,
    content: approval.markdown,
    openable: true,
  }

  return (
    <div className="plan-approval-card tw:w-full" onKeyDown={handleKeyDown}>
      <RequestCard
        variant="plan"
        title="计划已准备好"
        identity={identity}
        disabledReason={disabledReason}
        error={error}
        navigation={
          onOpenPlan ? (
            <Button
              variant="text"
              color="text"
              disabled={disabled}
              onClick={() => onOpenPlan(plan)}
            >
              查看全文
            </Button>
          ) : undefined
        }
      >
        <p className="plan-approval-title tw:m-0 tw:px-1 tw:type-row-title tw:wrap-anywhere">
          {approval.title}
        </p>
        {editingFeedback ? null : (
          <div className="plan-approval-actions tw:flex tw:flex-col tw:items-stretch tw:gap-2 tw:px-1 tw:pt-2">
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              <Button color="secondary" disabled={disabled} onClick={() => setEditingFeedback(true)}>
                修改计划
              </Button>
              <div className="tw:ml-auto tw:inline-flex tw:items-center">
                <Button
                  color="primary"
                  disabled={disabled}
                  loading={busy === 'implement'}
                  loadingText="正在开始实施…"
                  onClick={() => void act(() => ({ action: 'implement' }))}
                >
                  开始实施
                </Button>
                {freshAvailable ? (
                  <Dropdown
                    size="md"
                    align="end"
                    trigger={
                      <Button
                        color="primary"
                        isIconOnly
                        aria-label="更多实施方式"
                        disabled={disabled}
                      >
                        <ChevronDown size={APP_ICON_SIZES.sm} />
                      </Button>
                    }
                  >
                    <DropdownMenu.Item
                      className="popover-item"
                      disabled={disabled}
                      onSelect={() => void act(() => ({ action: 'implementFresh' }))}
                    >
                      在新聊天中实施
                    </DropdownMenu.Item>
                  </Dropdown>
                ) : null}
              </div>
            </div>
            <div className="tw:flex tw:items-center">
              <Button
                variant="text"
                color="text"
                disabled={disabled}
                loading={busy === 'close'}
                loadingText="正在退出 Plan…"
                onClick={() => void act(() => ({ action: 'close' }))}
              >
                退出 Plan
              </Button>
            </div>
          </div>
        )}
        {editingFeedback ? (
          <div className="plan-approval-feedback tw:grid tw:gap-2 tw:px-1 tw:pt-2">
            <label className="tw:text-app-text-soft tw:type-label" htmlFor={feedbackId}>
              你希望怎样调整？
            </label>
            <textarea
              id={feedbackId}
              ref={feedbackRef}
              className="plan-approval-feedback-input tw:block tw:w-full tw:min-w-0 tw:min-h-[4.5em] tw:resize-none tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-control tw:p-2 tw:text-app-text tw:type-body tw:outline-none tw:placeholder:text-app-text-meta tw:focus-visible:border-app-accent"
              disabled={disabled}
              placeholder={FEEDBACK_PLACEHOLDER}
              rows={3}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
            <div className="tw:flex tw:items-center tw:justify-end tw:gap-2">
              <Button
                color="secondary"
                disabled={disabled}
                onClick={() => setEditingFeedback(false)}
              >
                取消修改
              </Button>
              <Button
                color="primary"
                disabled={disabled || !feedback.trim()}
                loading={busy === 'feedback'}
                loadingText="正在提交修改意见…"
                onClick={() =>
                  void act(() => ({ action: 'feedback', feedback: feedback.trim() }))
                }
              >
                发送修改意见
              </Button>
            </div>
          </div>
        ) : null}
      </RequestCard>
    </div>
  )
}
