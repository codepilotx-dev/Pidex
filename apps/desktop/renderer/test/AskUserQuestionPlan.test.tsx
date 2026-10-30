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
  taskMode: 'chat' | 'plan' | 'grill',
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

test('only explicit recommendations are preselected', () => {
  expect(initialPlanQuestionState()).toEqual({ selected: [], custom: '', answered: false })
  expect(hasQuestionAnswer(initialPlanQuestionState())).toBe(false)
  expect(initialQuestionState(clientQuestion).selected).toEqual(['desktop'])
  expect(initialQuestionState(phaseQuestion).selected).toEqual([])

  const html = render([clientQuestion, phaseQuestion], 'plan')
  expect((html.match(/aria-checked="true"/gu) ?? []).length).toBe(1)
  expect((html.match(/aria-checked="false"/gu) ?? []).length).toBe(1)
  expect(html).toContain('需要你确认')
  expect(html).toContain('推荐')
})

test('questions without a recommendation require an explicit answer before advancing', () => {
  const html = render([phaseQuestion, clientQuestion], 'plan')
  expect(html).toContain('1 / 2')
  expect(html).toContain('自己回答')
  expect(buttonWithLabel(html, '下一题')).toContain('disabled')
  expect(html).toContain('停止本轮')
  // 跳过代表暂定假设，Plan 与 Grill 都允许。
  expect(buttonWithLabel(html, '跳过')).not.toContain('disabled')
})

test('plan last question submits and marks question navigation state', () => {
  const html = render([clientQuestion, phaseQuestion], 'plan')
  // 推荐项只是预选，仍需用户确认后才算已答。
  expect(html).toContain('第 1 题（待答）')
  expect(html).toContain('第 2 题（待答）')
  expect((html.match(/data-answered="false"/gu) ?? []).length).toBe(2)
})

test('plan text-only questions render the input without an empty option list', () => {
  const html = render([textQuestion], 'plan')
  expect(html).not.toContain('radiogroup')
  expect(html).toContain('自定义回答')
  expect(html).toContain('提交回答')
  expect(html).not.toContain('自己回答')
})

test('chat, plan and grill share the same question card', () => {
  for (const taskMode of ['chat', 'plan', 'grill'] as const) {
    const html = render([clientQuestion, phaseQuestion], taskMode)
    expect((html.match(/aria-checked="true"/gu) ?? []).length).toBe(1)
    expect(html).toContain('1 / 2')
    expect(html).toContain('跳过当前问题')
    expect(html).toContain('需要你确认')
  }
  expect(render([clientQuestion], 'chat')).toContain('>拒绝')
  expect(render([clientQuestion], 'grill')).toContain('停止本轮')
})
