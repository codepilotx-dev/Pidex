import { describe, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const conversationPage = read('../src/features/session/conversation/ConversationPage.tsx')
const sideChatPanel = read('../src/features/session/conversation/SideChatThreadPanel.tsx')
const subagentPanel = read('../src/features/session/subagents/SubagentThreadPanel.tsx')
const questionForm = read('../src/features/session/approvals/AskUserQuestionApproval.tsx')
const inlineApproval = read('../src/features/session/approvals/InlineApprovalCard.tsx')

/**
 * 主聊天、侧边聊天与子 Agent 必须复用同一份 Plan 交互实现：审阅动作来自
 * 共享 PlanApprovalCard，澄清提问走共享 AskUserQuestionApproval；调用方只传
 * 所属 Turn 的 canonical taskMode 与响应 Hook，不各自实现一套 Plan UI。
 */
describe('Plan 交互在主聊天、侧边聊天与子 Agent 间复用', () => {
  test('主聊天与侧边聊天用同一份审阅卡片与响应 Hook', () => {
    for (const source of [conversationPage, sideChatPanel]) {
      expectSourceContains(source, "import { PlanApprovalCard } from '../approvals/PlanApprovalCard.js'")
      expectSourceContains(source, "import { usePlanApprovalResponse } from '../approvals/UsePlanApprovalResponse.js'")
      expectSourceContains(source, '<PlanApprovalCard')
      expectSourceContains(source, 'onRespond={planApproval.respond}')
      expectSourceContains(source, 'freshAvailable={planApproval.freshAvailable}')
      expectSourceContains(source, 'usePlanApprovalResponse(')
      // 已移除的计划专用选择题答案映射不得回归。
      expectSourceNotContains(source, 'planResponseFromDraft')
      expectSourceNotContains(source, '继续规划')
    }
    expectSourceContains(conversationPage, 'onOpenPlan={onOpenPlanInRightDock}')
    expectSourceContains(sideChatPanel, 'onOpenPlan={onOpenPlan}')
  })

  test('两端都从所属 Turn 的 canonical taskMode 分流澄清提问', () => {
    expectSourceContains(
      conversationPage,
      'const taskMode = canonicalConversation.state?.thread.settings.taskMode',
    )
    expectSourceContains(conversationPage, '<InlineApprovalCard')
    expectSourceContains(conversationPage, 'taskMode={taskMode}')
    expectSourceContains(
      sideChatPanel,
      "conversation.state ? conversation.state.thread.settings.taskMode : 'chat'",
    )
    expectSourceContains(sideChatPanel, '<InlineApprovalCard')
    // 组件层只认 taskMode，不再靠 plan 专用 variant 分支。
    expectSourceContains(inlineApproval, "taskMode?: 'chat' | 'plan' | 'grill'")
    expectSourceContains(inlineApproval, 'taskMode={taskMode}')
    expectSourceContains(questionForm, "taskMode?: 'chat' | 'plan' | 'grill'")
    expectSourceContains(questionForm, 'initialPlanQuestionState')
    expectSourceNotContains(questionForm, "variant === 'plan'")
  })

  test('子 Agent 计划保持只读，不开放实施或新聊天入口', () => {
    expectSourceContains(subagentPanel, '<PlanApprovalCard')
    expectSourceContains(subagentPanel, '此子智能体没有计划续跑入口')
    expectSourceContains(subagentPanel, '此子智能体不支持计划操作。')
    expectSourceNotContains(subagentPanel, 'freshAvailable')
    expectSourceNotContains(subagentPanel, 'onOpenPlan={')
    expectSourceNotContains(subagentPanel, 'usePlanApprovalResponse')
  })
})
