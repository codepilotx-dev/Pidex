import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  QuestionAnswerForm,
  parseAskUserQuestions,
} from '../src/features/session/approvals/AskUserQuestionApproval.js'
import { InlineApprovalCard } from '../src/features/session/approvals/InlineApprovalCard.js'
import { planResponseFromDraft } from '../src/features/session/approvals/PlanApprovalCard.js'

test('plan adapter can reuse one-option form without relaxing tool input parsing', () => {
  const question = {
    id: 'implement',
    header: '计划',
    question: '实施此计划？',
    options: [{ label: '是，实施此计划', description: '' }],
    multiSelect: false,
  }
  expect(parseAskUserQuestions({ questions: [question] })).toBeNull()
  const html = renderToStaticMarkup(
    <QuestionAnswerForm
      requestId="plan-1"
      questions={[question]}
      variant="plan"
      identity="子代理"
      disabledReason="只能由父任务继续"
      onSubmit={() => {}}
      onReject={() => {}}
    />,
  )
  expect(html).toContain('data-variant="plan"')
  expect(html).toContain('是，实施此计划')
  expect(html).toContain('只能由父任务继续')
  expect(html).toContain('<fieldset class="request-card-content" disabled="">')
  expect(html).toContain('request-card-marker')
  expect(html).not.toContain('1 of 1')
  expect(html).not.toContain('提交')
})

test('permissions use independent allow/deny actions and preserve read-only command details', () => {
  const html = renderToStaticMarkup(
    <InlineApprovalCard
      request={{
        requestId: 'approval-1',
        toolName: 'Bash',
        input: { command: 'bun test' },
        description: '验证修改',
        autoReviewFallbackReason: '需要人工确认',
      }}
      disabledReason="父任务控制"
      onDecide={() => {}}
    />,
  )
  expect(html).toContain('允许一次')
  expect(html).toContain('拒绝')
  expect(html).toContain('bun test')
  expect(html).toContain('验证修改')
  expect(html).toContain('需要人工确认')
  expect(html).toContain('disabled=""')
  expect(html).not.toContain('radiogroup')
  expect(html).not.toContain('<textarea')
})

test('plan response uses explicit draft choice, never interprets feedback as execution', () => {
  expect(
    planResponseFromDraft({ selected: ['在当前聊天实施'], custom: '', answered: true }),
  ).toEqual({ action: 'implement' })
  expect(planResponseFromDraft({ selected: [], custom: '是，实施此计划', answered: true })).toEqual(
    { action: 'feedback', feedback: '是，实施此计划' },
  )
  expect(() =>
    planResponseFromDraft({ selected: ['在当前聊天实施'], custom: '', answered: false }),
  ).toThrow()
  expect(() => planResponseFromDraft(undefined)).toThrow()
})
