import React from 'react'
import type { PlanApproval } from '@pidex/shared/thread'
import { QuestionAnswerForm } from './AskUserQuestionApproval.js'
import type { AskUserQuestion, QuestionState } from './AskUserQuestionModel.js'
import { Button } from '../../../components/ui/Button.js'

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
  onContinue?: () => void
  freshAvailable?: boolean
}

const PLAN_QUESTION_ID = 'implement-plan'
const IMPLEMENT_LABEL = '在当前聊天实施'
const IMPLEMENT_FRESH_LABEL = '在新聊天中实施'
const PLAN_QUESTION: AskUserQuestion = {
  id: PLAN_QUESTION_ID,
  header: '计划',
  question: '实施此计划？',
  options: [{ label: IMPLEMENT_LABEL, description: '' }],
  multiSelect: false,
}

export function planResponseFromDraft(state: QuestionState | undefined): PlanApprovalResponse {
  const feedback = state?.custom.trim()
  if (feedback) return { action: 'feedback', feedback }
  if (state?.answered && state.selected.length === 1 && state.selected[0] === IMPLEMENT_FRESH_LABEL)
    return { action: 'implementFresh' }
  if (state?.answered && state.selected.length === 1 && state.selected[0] === IMPLEMENT_LABEL) {
    return { action: 'implement' }
  }
  throw new Error('请选择实施计划或填写修改意见。')
}

export function PlanApprovalCard({
  approval,
  identity,
  disabledReason,
  onRespond,
  onContinue,
  freshAvailable = false,
}: PlanApprovalCardProps): React.ReactNode {
  const close = () => onRespond({ action: 'close' })
  return (
    <div>
      <QuestionAnswerForm
        requestId={`${approval.id}:${approval.version}`}
        input={{ threadId: approval.threadId, version: approval.version }}
        questions={[
          {
            ...PLAN_QUESTION,
            options: [
              ...PLAN_QUESTION.options,
              ...(freshAvailable
                ? [
                    {
                      label: IMPLEMENT_FRESH_LABEL,
                      description: '保留原规划历史，以空上下文开始实施',
                    },
                  ]
                : []),
            ],
          },
        ]}
        variant="plan"
        identity={identity}
        disabledReason={disabledReason}
        dismissLabel="继续规划"
        closeLabel="关闭计划"
        closeError="关闭计划失败，请重试。"
        onInterrupt={close}
        onReject={onContinue ?? close}
        onSubmit={(_input, states) => onRespond(planResponseFromDraft(states[PLAN_QUESTION_ID]))}
      />
      <div className="tw:flex tw:justify-end tw:gap-2 tw:py-2">
        {!freshAvailable ? (
          <Button disabled title="当前 Agent 尚未提供新聊天实施能力">
            在新聊天中实施
          </Button>
        ) : null}
        <Button onClick={onContinue}>继续规划</Button>
      </div>
    </div>
  )
}
