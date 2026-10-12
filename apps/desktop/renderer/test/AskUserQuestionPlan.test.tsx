import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionAnswerForm } from '../src/features/session/approvals/AskUserQuestionApproval.js'
import {
  hasQuestionAnswer,
  initialPlanQuestionState,
  initialQuestionState,
  type AskUserQuestion,
} from '../src/features/session/approvals/AskUserQuestionModel.js'

const clientQuestion: AskUserQuestion = {
  id: 'scope',
  header: '范围',
  question: '计划应覆盖哪些客户端？',
  options: [
    {
      id: 'desktop',
      label: '仅桌面端',
      description: '本次集中完成桌面交互。',
      recommended: true,
    },
    {
      id: 'both',
      label: '桌面端与 CLI',
      description: '同时设计共享能力和两端入口。',
    },
  ],
  multiSelect: false,
}

const phaseQuestion: AskUserQuestion = {
  id: 'phase',
  header: '阶段',
  question: '先完成哪一部分？',
  options: [
    { id: 'ask', label: '提问交互' },
    { id: 'dock', label: '计划侧栏' },
  ],
  multiSelect: false,
}

const textQuestion: AskUserQuestion = {
  id: 'free',
  header: '补充',
  question: '还有其他约束吗？',
  options: [],
  multiSelect: false,
}

const render = (
  questions: AskUserQuestion[],
  taskMode: 'chat' | 'plan',
  extra: Record<string, unknown> = {},
) =>
  renderToStaticMarkup(
    <QuestionAnswerForm
      requestId={`ask-${taskMode}`}
      input={{ threadId: 'thread-1', version: 1 }}
      questions={questions}
      taskMode={taskMode}
      supportsQuestionSkip
      onSubmit={() => {}}
      onReject={() => {}}
      onInterrupt={() => {}}
      {...extra}
    />,
  )

const buttonWithLabel = (html: string, label: string): string =>
  html.match(new RegExp(`<button[^>]*>${label}`))?.[0] ?? ''

test('plan clarifications start with no answer and keep recommendation separate', () => {
  expect(initialPlanQuestionState()).toEqual({ selected: [], custom: '', answered: false })
  expect(hasQuestionAnswer(initialPlanQuestionState())).toBe(false)
  // Chat 提问仍预选首项，Plan 不预选。
  expect(initialQuestionState(clientQuestion).selected).toEqual(['desktop'])

  const html = render([clientQuestion, phaseQuestion], 'plan')
  expect(html).not.toContain('aria-checked="true"')
  expect((html.match(/aria-checked="false"/gu) ?? []).length).toBe(2)
  expect(html).toContain('需要你确认')
  expect(html).toContain('推荐')
})

test('plan clarifications require an explicit answer before advancing', () => {
  const html = render([clientQuestion, phaseQuestion], 'plan')
  expect(html).toContain('1 / 2')
  expect(html).toContain('自己回答')
  expect(buttonWithLabel(html, '下一题')).toContain('disabled')
  // 结束等待只能通过明确动作，没有跳过。
  expect(html).toContain('停止本轮')
  expect(html).not.toContain('>跳过<')
  expect(html).not.toContain('跳过当前问题')
})

test('plan last question submits and marks question navigation state', () => {
  const html = render([clientQuestion, phaseQuestion], 'plan')
  expect(html).toContain('第 1 题（待答）')
  expect(html).toContain('第 2 题（待答）')
  expect(html).toContain('data-answered="false"')
})

test('plan text-only questions render the input without an empty option list', () => {
  const html = render([textQuestion], 'plan')
  expect(html).not.toContain('radiogroup')
  expect(html).toContain('自定义回答')
  expect(html).toContain('提交回答')
  expect(html).not.toContain('自己回答')
})

test('chat questions keep first-option selection, pagination and skip semantics', () => {
  const html = render([clientQuestion, phaseQuestion], 'chat')
  expect((html.match(/aria-checked="true"/gu) ?? []).length).toBe(1)
  expect(html).toContain('1 of 2')
  expect(html).toContain('跳过当前问题')
  expect(html).not.toContain('停止本轮')
  expect(html).not.toContain('需要你确认')
})
