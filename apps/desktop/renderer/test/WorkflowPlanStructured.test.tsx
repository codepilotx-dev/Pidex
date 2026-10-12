import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PlanApproval, StructuredPlan } from '@pidex/shared/thread'
import { PlanApprovalCard } from '../src/features/session/approvals/PlanApprovalCard'

import {
  StructuredPlanView,
  WorkflowPlanCard,
  createPlanDockRequest,
  planCardPresentation,
  planTitleFromSummary,
} from '../src/features/session/workflow/WorkflowPlanCard'
import {
  getWorkbenchTabDefinition,
  type WorkbenchTabRenderContext,
} from '../src/features/layout/tabs/WorkbenchTabRegistry'

const structuredPlan = (overrides: Partial<StructuredPlan> = {}): StructuredPlan => ({
  title: '结构化计划交付',
  summary: '把最终方案升级为 submit_plan 提交。',
  changes: [
    { area: '共享契约', items: ['新增 StructuredPlanSchema', '派生 Markdown'] },
    { area: '桌面展示', items: ['按章节渲染'] },
  ],
  interfaceChanges: ['新增 plan.structured.v1 capability'],
  tests: ['Agent 聚焦测试'],
  assumptions: [],
  ...overrides,
})

const approval = (overrides: Partial<PlanApproval> = {}): PlanApproval => ({
  id: 'approval',
  threadId: 'thread',
  turnId: 'turn',
  planItemId: 'turn-1:plan',
  version: 1,
  status: 'pending',
  title: 'Plan 流程与交互重设计',
  markdown: '# 计划',
  nextTurnId: null,
  createdAt: 1,
  resolvedAt: null,
  ...overrides,
})

const renderCard = (structured?: StructuredPlan) =>
  renderToStaticMarkup(
    <WorkflowPlanCard
      planItemId="turn-1:plan"
      summary={'# 历史方案\n\n旧 Markdown 正文'}
      structured={structured}
      streaming={false}
      isDocked={false}
      onOpenInRightDock={() => undefined}
    />,
  )

describe('WorkflowPlanCard structured plans', () => {
  test('审阅卡片只呈现阅读入口与真实动作，不再复用选择题答案映射', () => {
    const unsupported = renderToStaticMarkup(
      <PlanApprovalCard approval={approval()} onRespond={async () => {}} />,
    )
    expect(unsupported).toContain('计划已准备好')
    expect(unsupported).toContain('Plan 流程与交互重设计')
    expect(unsupported).toContain('修改计划')
    expect(unsupported).toContain('开始实施')
    expect(unsupported).toContain('退出 Plan')
    // 未协商新聊天能力时不出现更多实施方式入口，也不再有“继续规划”。
    expect(unsupported).not.toContain('更多实施方式')
    expect(unsupported).not.toContain('继续规划')
    expect(unsupported).not.toContain('radiogroup')

    const supported = renderToStaticMarkup(
      <PlanApprovalCard approval={approval()} onRespond={async () => {}} freshAvailable />,
    )
    expect(supported).toContain('更多实施方式')
  })

  test('计划卡片携带聊天与计划项身份，供右栏绑定 canonical projection', () => {
    const withView = renderToStaticMarkup(
      <PlanApprovalCard
        approval={approval()}
        onRespond={async () => {}}
        onOpenPlan={() => undefined}
      />,
    )
    expect(withView).toContain('查看全文')

    const withoutView = renderToStaticMarkup(
      <PlanApprovalCard approval={approval()} onRespond={async () => {}} />,
    )
    expect(withoutView).not.toContain('查看全文')
  })

  test('计划卡片区分生成中、待审阅与历史计划', () => {
    expect(
      planCardPresentation({ streaming: true, isDocked: false }),
    ).toMatchObject({ label: '正在形成计划', showOpenInRightDock: false })
    expect(
      planCardPresentation({ streaming: false, isDocked: false, isPendingReview: true }),
    ).toMatchObject({ label: '计划 · 待审阅', showOpenInRightDock: true })
    expect(
      planCardPresentation({ streaming: false, isDocked: false, isLatest: false }),
    ).toMatchObject({ label: '历史计划', showOpenInRightDock: false })
  })

  test('按固定语义顺序渲染结构化章节并隐藏空章节', () => {
    const html = renderCard(structuredPlan())

    expect(html).toContain('结构化计划交付')
    expect(html).toContain('把最终方案升级为 submit_plan 提交。')
    expect(html).toContain('实现变更')
    expect(html).toContain('共享契约')
    expect(html).toContain('新增 StructuredPlanSchema')
    expect(html).toContain('桌面展示')
    expect(html).toContain('接口变化')
    expect(html).toContain('新增 plan.structured.v1 capability')
    expect(html).toContain('测试')
    expect(html).toContain('Agent 聚焦测试')
    // 空的假设章节不渲染，也不回退到历史 Markdown。
    expect(html).not.toContain('假设')
    expect(html).not.toContain('旧 Markdown 正文')

    const order = ['实现变更', '接口变化', '测试'].map((heading) => html.indexOf(heading))
    expect(order).toEqual([...order].sort((left, right) => left - right))
  })

  test('Markdown 历史计划继续原样展示', () => {
    const html = renderCard()
    expect(html).toContain('历史方案')
    expect(html).toContain('旧 Markdown 正文')
    expect(html).not.toContain('workflow-plan-structured')
  })

  test('docked 模式使用结构化标题，且标题解析兼容派生 Markdown', () => {
    const docked = renderToStaticMarkup(
      <WorkflowPlanCard
        planItemId="turn-1:plan"
        summary="# 派生标题"
        structured={structuredPlan()}
        streaming={false}
        isDocked
        onOpenInRightDock={() => undefined}
      />,
    )
    expect(docked).toContain('结构化计划交付')
    expect(planTitleFromSummary('# 派生标题')).toBe('派生标题')
  })

  test('结构化视图只渲染内容，不引入自由组件或样式入口', () => {
    const html = renderToStaticMarkup(<StructuredPlanView plan={structuredPlan()} />)
    expect(html).toContain('workflow-plan-structured__list')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })

  test('右侧计划标签在没有 canonical 投影时渲染打开时携带的正文', () => {
    const tab = {
      id: 'plan:turn-1:plan',
      kind: 'plan',
      planItemId: 'turn-1:plan',
      threadId: '',
      title: '结构化计划交付',
      content: '# 结构化计划交付\n\n右侧计划正文',
    } as const
    const definition = getWorkbenchTabDefinition(tab)
    const html = renderToStaticMarkup(
      definition.render(tab, {
        planContentByEventId: {},
      } as unknown as WorkbenchTabRenderContext),
    )

    expect(html).toContain('右侧计划正文')
    expect(html).toContain('复制计划')
    expect(html).toContain('导出 PLAN.md')
    expect(html).not.toContain('暂无计划')
    expect(html).not.toContain('有新版计划')
  })

  test('计划未生成完成时不可在右侧打开，也不渲染打开入口', () => {
    const streaming = renderToStaticMarkup(
      <WorkflowPlanCard
        planItemId="turn-2:plan"
        summary="# 正在写的计划"
        streaming
        isDocked={false}
        onOpenInRightDock={() => undefined}
      />,
    )
    expect(streaming).not.toContain('在右侧打开计划')
    expect(streaming).toContain('正在形成计划')

    // 打开请求本身携带可打开性，供唯一的打开入口拒绝半成品。
    expect(
      createPlanDockRequest({
        planItemId: 'turn-2:plan',
        threadId: 'thread',
        title: '正在写的计划',
        content: '# 正在写的计划',
        streaming: true,
      }),
    ).toMatchObject({ openable: false })
    expect(
      createPlanDockRequest({
        planItemId: 'turn-2:plan',
        threadId: 'thread',
        title: '计划',
        content: '# 计划',
        streaming: false,
      }),
    ).toMatchObject({ openable: true, planItemId: 'turn-2:plan', threadId: 'thread' })

    const completed = renderCard(structuredPlan())
    expect(completed).toContain('在右侧打开计划')
  })

  test('历史计划不再提供右栏打开入口，但保留阅读、复制与导出', () => {
    const historical = renderToStaticMarkup(
      <WorkflowPlanCard
        planItemId="turn-1:plan"
        summary="# 旧计划"
        streaming={false}
        isDocked={false}
        isLatest={false}
        onOpenInRightDock={() => undefined}
      />,
    )
    expect(historical).toContain('历史计划')
    expect(historical).not.toContain('在右侧打开计划')
    expect(historical).toContain('复制计划')
    expect(historical).toContain('导出计划')
    expect(historical).toContain('展开计划')
  })

  test('计划生成完成后展示复制、导出与底部展开操作，流式期间隐藏', () => {
    const completed = renderCard(structuredPlan())
    expect(completed).toContain('复制计划')
    expect(completed).toContain('导出计划')
    expect(completed).toContain('展开计划')

    const streaming = renderToStaticMarkup(
      <WorkflowPlanCard
        planItemId="turn-3:plan"
        summary="# 正在写的计划"
        streaming
        isDocked={false}
        onOpenInRightDock={() => undefined}
      />,
    )
    expect(streaming).not.toContain('复制计划')
    expect(streaming).not.toContain('导出计划')
    expect(streaming).not.toContain('展开计划')
  })
})
