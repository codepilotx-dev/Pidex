import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  QuestionAnswerForm,
  parseAskUserQuestions,
} from '../src/features/session/approvals/AskUserQuestionApproval.js'
import { InlineApprovalCard } from '../src/features/session/approvals/InlineApprovalCard.js'
import { PlanApprovalCard } from '../src/features/session/approvals/PlanApprovalCard.js'

test('question form keeps strict tool input parsing and never falls back to a plan answer mapping', () => {
  const oneOption = {
    id: 'implement',
    header: '计划',
    question: '实施此计划？',
    options: [{ label: '是，实施此计划', description: '' }],
    multiSelect: false,
  }
  expect(parseAskUserQuestions({ questions: [oneOption] })).toBeNull()
  const question = {
    id: 'scope',
    header: '范围',
    question: '应该覆盖哪些客户端？',
    options: [
      { label: '仅桌面端', description: '集中完成桌面交互。' },
      { label: '桌面端与 CLI', description: '同时设计共享能力和两端入口。' },
    ],
    multiSelect: false,
  }
  const html = renderToStaticMarkup(
    <QuestionAnswerForm
      requestId="question-1"
      questions={[question]}
      identity="子代理"
      disabledReason="只能由父任务继续"
      onSubmit={() => {}}
      onReject={() => {}}
    />,
  )
  expect(html).toContain('data-variant="question"')
  expect(html).toContain('应该覆盖哪些客户端？')
  expect(html).toContain('只能由父任务继续')
  expect(html).toContain('<fieldset class="request-card-content" disabled="">')
  expect(html).toContain('request-card-marker')
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

test('plan review is an action card, not a questionnaire', () => {
  const html = renderToStaticMarkup(
    <PlanApprovalCard
      approval={{
        id: 'approval',
        threadId: 'thread',
        turnId: 'turn',
        planItemId: 'turn-1:plan',
        version: 1,
        status: 'pending',
        title: '实施计划',
        markdown: '# 计划',
        nextTurnId: null,
        createdAt: 1,
        resolvedAt: null,
      }}
      disabledReason="只能由父任务继续"
      onRespond={async () => {}}
    />,
  )
  expect(html).toContain('data-variant="plan"')
  expect(html).toContain('计划已准备好')
  expect(html).toContain('修改计划')
  expect(html).toContain('开始实施')
  expect(html).toContain('退出 Plan')
  expect(html).not.toContain('radiogroup')
  expect(html).not.toContain('跳过')
  expect(html).not.toContain('继续规划')
})
