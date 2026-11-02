import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopThreadGoal } from '../shared/Types.js'
import { RightDockGoalPanel } from '../src/features/layout/dock/RightDockPanels.js'
import { getWorkbenchTabDefinition } from '../src/features/layout/tabs/WorkbenchTabRegistry.js'

const TEST_GOAL: DesktopThreadGoal = {
  id: 'goal-1',
  threadId: 'thread-1',
  objective: '一直说你不好，直到我停止',
  status: 'active',
  tokenBudget: 50_000,
  tokensUsed: 120,
  timeUsedSeconds: 30,
  version: 1,
  createdAt: Date.now() - 10_000,
  updatedAt: Date.now() - 10_000,
}

const noop = async (): Promise<void> => {}

describe('RightDockGoalPanel & WorkbenchTabRegistry', () => {
  test('WorkbenchTabRegistry 中 goal 标签的标题和名称为“编辑目标”', () => {
    const def = getWorkbenchTabDefinition('goal')
    expect(def).toBeDefined()
    expect(def?.label).toBe('编辑目标')
    expect(def?.getTitle({ id: 'goal', kind: 'goal' })).toBe('编辑目标')
  })

  test('RightDockGoalPanel 渲染正文编辑与独立的追加预算操作', () => {
    const html = renderToStaticMarkup(
      <RightDockGoalPanel
        goal={TEST_GOAL}
        onSaveGoal={noop}
        onAppendBudget={noop}
        onRemoveBudgetLimit={noop}
      />,
    )

    expect(html).toContain('aria-label="编辑目标"')
    expect(html).toContain('right-dock-goal-panel')
    expect(html).toContain('刚刚更新')
    // 正文与预算分开：总额只读展示，追加输入表示新增量。
    expect(html).not.toContain('id="dock-goal-token-budget"')
    expect(html).toContain('aria-label="追加 Token 预算"')
    expect(html).toContain('追加预算')
    expect(html).toContain('取消预算上限')
    expect(html).toContain('预算：120 / 5万')
    expect(html).toContain('aria-label="撤销未保存的修改"')
    expect(html).toContain('保存')
    expect(html).toContain('一直说你不好，直到我停止')
    expect(html).toContain('aria-label="目标内容"')
  })

  test('不限额与已完成目标不提供追加预算操作', () => {
    const unlimited = renderToStaticMarkup(
      <RightDockGoalPanel
        goal={{ ...TEST_GOAL, tokenBudget: null }}
        onSaveGoal={noop}
        onAppendBudget={noop}
        onRemoveBudgetLimit={noop}
      />,
    )
    expect(unlimited).toContain('预算：不限额')
    expect(unlimited).not.toContain('aria-label="追加 Token 预算"')

    const completed = renderToStaticMarkup(
      <RightDockGoalPanel
        goal={{ ...TEST_GOAL, status: 'complete', completedAt: Date.now() }}
        onSaveGoal={noop}
        onAppendBudget={noop}
        onRemoveBudgetLimit={noop}
      />,
    )
    expect(completed).toContain('预算：120 / 5万')
    expect(completed).not.toContain('aria-label="追加 Token 预算"')
    expect(completed).not.toContain('取消预算上限')
  })
})