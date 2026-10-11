import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ExecutionPlanItem } from '@pidex/shared/thread'

import {
  ComposerChangeSummary,
  executionPlanStepPosition,
  findLatestExecutionPlan,
} from '../src/features/session/composer/ComposerChangeSummary'
import { ExecutionPlanCard } from '../src/features/session/workflow/ExecutionPlanCard'

describe('ExecutionPlanCard', () => {
  test('changed-file preview uses a feature-owned native row', async () => {
    const [componentSource, stylesheet] = await Promise.all([
      Bun.file(
        new URL('../src/features/session/composer/ComposerChangeSummary.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/primitives/session.css', import.meta.url)).text(),
    ])

    // 只校验原生按钮、统计感知的 aria-label 与自有 class，不依赖源码缩进换行。
    expect(componentSource).toMatch(
      /<button\b[\s\S]{0,400}?aria-label=\{[\s\S]{0,120}?statsAvailable/,
    )
    expect(componentSource).toMatch(
      /<button\b[\s\S]{0,400}?className="composer-change-summary__file-row"/,
    )
    expect(componentSource).not.toMatch(/<Button\b[\s\S]{0,400}?statsAvailable/)
    // 该行样式现在按语义类名声明在 primitives/session.css。
    expect(stylesheet).toContain('.composer-change-summary__file-row {')
    expect(stylesheet).not.toContain('.composer-change-summary__file-row.ui-button')
  })

  test('shows the compact current-turn checklist without the former card chrome', () => {
    const item = executionPlanItem()

    const html = renderToStaticMarkup(<ExecutionPlanCard item={item} />)

    expect(html).toContain('更新协议')
    expect(html).toContain('接入时间线')
    expect(html).toContain('运行验证')
    expect(html).toContain('lucide-circle-check')
    expect(html).toContain('lucide-loader-circle')
    expect(html).toContain('lucide-circle')
    expect(html).not.toContain('execution-plan-card__step-index')
    expect(html).toContain('aria-label="第 1 步，更新协议，已完成"')
    expect(html).toContain('aria-label="第 2 步，接入时间线，进行中"')
    expect(html).toContain('aria-label="第 3 步，运行验证，待处理"')
    expect(html).not.toContain('execution-plan-card__header')
    expect(html).not.toContain('先完成协议，再接入界面。')
    expect(html).not.toContain('<small')
    expect(html).not.toContain('<button')
  })

  test('derives the current one-based step with lifecycle fallbacks', () => {
    expect(executionPlanStepPosition(executionPlanItem())).toBe(2)
    expect(
      executionPlanStepPosition(
        executionPlanItem({
          status: 'completed',
          steps: [
            { step: '更新协议', status: 'completed' },
            { step: '接入界面', status: 'completed' },
          ],
        }),
      ),
    ).toBe(2)
    expect(
      executionPlanStepPosition(
        executionPlanItem({
          steps: [
            { step: '更新协议', status: 'completed' },
            { step: '接入界面', status: 'pending' },
          ],
        }),
      ),
    ).toBe(2)
    expect(executionPlanStepPosition(executionPlanItem({ steps: [] }))).toBe(0)
  })

  test('keeps the most recent execution plan across retry turns', () => {
    const plan = executionPlanItem({ status: 'interrupted' })

    expect(
      findLatestExecutionPlan([
        { executionPlanItems: [plan] },
        { executionPlanItems: [] },
        { executionPlanItems: [] },
      ]),
    ).toBe(plan)
    expect(
      findLatestExecutionPlan([
        { executionPlanItems: [plan] },
        {
          executionPlanItems: [
            executionPlanItem({
              id: 'turn-2:execution-plan',
              turnId: 'turn-2',
            }),
          ],
        },
      ])?.turnId,
    ).toBe('turn-2')
  })

  test('combines plan progress and file changes with status-aware icons', () => {
    const streamingHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active
        additions={279}
        canReturnToBottom
        changedFiles={changedFiles(5, 279, 155)}
        deletions={155}
        executionPlan={executionPlanItem({ status: 'interrupted' })}
        failed={false}
        onOpenReview={() => undefined}
        onOpenReviewFile={() => undefined}
        onReturnToBottom={() => undefined}
      />,
    )
    const progressedHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active
        additions={0}
        canReturnToBottom={false}
        changedFiles={[]}
        deletions={0}
        executionPlan={executionPlanItem({
          steps: [
            { step: '更新协议', status: 'completed' },
            { step: '接入时间线', status: 'completed' },
            { step: '运行验证', status: 'in_progress' },
          ],
        })}
        failed={false}
        onOpenReview={() => undefined}
        onOpenReviewFile={() => undefined}
        onReturnToBottom={() => undefined}
      />,
    )
    const completedHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active={false}
        additions={0}
        canReturnToBottom
        changedFiles={[]}
        deletions={0}
        executionPlan={executionPlanItem({ status: 'completed' })}
        failed={false}
        onOpenReview={() => undefined}
        onOpenReviewFile={() => undefined}
        onReturnToBottom={() => undefined}
      />,
    )
    const interruptedHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active={false}
        additions={0}
        canReturnToBottom
        changedFiles={[]}
        deletions={0}
        executionPlan={executionPlanItem({ status: 'interrupted' })}
        failed={false}
        onOpenReview={() => undefined}
        onOpenReviewFile={() => undefined}
        onReturnToBottom={() => undefined}
      />,
    )
    const completedWithFilesHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active={false}
        additions={2}
        canReturnToBottom={false}
        changedFiles={changedFiles(1, 2, 0)}
        deletions={0}
        executionPlan={executionPlanItem({ status: 'completed' })}
        failed={false}
        onOpenReview={() => undefined}
        onOpenReviewFile={() => undefined}
        onReturnToBottom={() => undefined}
      />,
    )
    const failedHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active={false}
        additions={0}
        canReturnToBottom={false}
        changedFiles={[]}
        deletions={0}
        executionPlan={executionPlanItem({ status: 'interrupted' })}
        failed
        onOpenReview={() => undefined}
        onOpenReviewFile={() => undefined}
        onReturnToBottom={() => undefined}
      />,
    )
    const emptyPlanHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active
        additions={0}
        canReturnToBottom={false}
        changedFiles={[]}
        deletions={0}
        executionPlan={executionPlanItem({ steps: [] })}
        failed={false}
        onOpenReview={() => undefined}
        onOpenReviewFile={() => undefined}
        onReturnToBottom={() => undefined}
      />,
    )
    const fileOnlyHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active={false}
        additions={12}
        canReturnToBottom
        changedFiles={changedFiles(1, 12, 3)}
        deletions={3}
        executionPlan={null}
        failed={false}
        onOpenReview={() => undefined}
        onOpenReviewFile={() => undefined}
        onReturnToBottom={() => undefined}
      />,
    )
    const fileOnlyAtBottomHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active={false}
        additions={12}
        canReturnToBottom={false}
        changedFiles={changedFiles(1, 12, 3)}
        deletions={3}
        executionPlan={null}
        failed={false}
        onOpenReview={() => undefined}
        onOpenReviewFile={() => undefined}
        onReturnToBottom={() => undefined}
      />,
    )
    const unavailableDiffHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active={false}
        additions={null}
        canReturnToBottom={false}
        changedFiles={[{ path: 'src/file-1.ts', additions: null, deletions: null }]}
        deletions={null}
        executionPlan={null}
        failed={false}
        onOpenReview={() => undefined}
        onOpenReviewFile={() => undefined}
        onReturnToBottom={() => undefined}
      />,
    )

    expect(streamingHtml).toContain('第 2 / 3 步')
    expect(streamingHtml).toContain('5 个文件已更改')
    expect(streamingHtml).toContain('+279')
    expect(streamingHtml).toContain('-155')
    expect(streamingHtml).toContain('composer-change-summary__diff')
    expect(streamingHtml).toContain('composer-change-summary__separator')
    expect(streamingHtml).toContain('aria-label="执行计划进行中，已完成 1 / 3 步"')
    expect(streamingHtml).toContain('data-progress="33.33"')
    expect(streamingHtml).toContain('lucide-loader-circle')
    expect(streamingHtml).toContain('composer-change-summary__thinking-dots')
    expect(streamingHtml).toContain('composer-change-summary__down-arrow')
    expect(streamingHtml).toContain('data-running="true"')
    expect(progressedHtml).toContain('data-progress="66.67"')
    expect(progressedHtml).not.toContain('composer-change-summary__return')
    expect(progressedHtml).not.toContain('composer-change-summary__return-presence')
    expect(streamingHtml).toContain('<button')
    expect(streamingHtml.match(/<button/g)).toHaveLength(3)
    expect(streamingHtml).toContain('composer-change-summary__plan')
    expect(streamingHtml).toContain('composer-change-summary__changes')
    expect(streamingHtml).not.toMatch(
      /class="[^"]*ui-button[^"]*composer-change-summary__(?:plan|changes)/,
    )
    expect(streamingHtml).toContain('composer-change-summary__return-presence')
    expect(streamingHtml).toContain('composer-change-summary__return')
    expect(streamingHtml).toContain('aria-label="回到底部"')
    expect(streamingHtml).toContain('aria-expanded="false"')
    expect(streamingHtml).toContain('aria-controls=')
    expect(streamingHtml).toContain('aria-hidden="true"')
    expect(streamingHtml).toContain('hidden=')
    expect(streamingHtml).toContain(
      'aria-label="打开审阅面板，5 个文件已更改，新增 279 行，删除 155 行"',
    )
    expect(unavailableDiffHtml).toContain(
      'aria-label="打开审阅面板，1 个文件已更改，增删行数统计暂不可用"',
    )
    expect(unavailableDiffHtml).not.toContain('composer-change-summary__diff')
    expect(streamingHtml).not.toContain('composer-change-summary__chevron')
    expect(completedHtml).toContain('aria-label="执行计划已完成，已完成 3 / 3 步"')
    expect(completedHtml).toContain('data-progress="100"')
    expect(completedHtml).toContain('已全部完成')
    expect(completedHtml).toContain('lucide-check')
    expect(completedHtml).not.toContain('composer-change-summary__thinking-dots')
    expect(completedHtml).not.toContain('data-running="true"')
    expect(completedHtml).not.toContain('composer-change-summary__separator')
    expect(completedHtml).toContain('composer-change-summary__down-arrow')
    expect(completedHtml.match(/<button/g)).toHaveLength(2)
    expect(completedWithFilesHtml).toContain('已全部完成')
    expect(completedWithFilesHtml).toContain('1 个文件已更改')
    expect(completedWithFilesHtml).toContain('composer-change-summary__separator')
    expect(completedWithFilesHtml).not.toMatch(
      /class="[^"]*ui-button[^"]*composer-change-summary__(?:plan|changes)/,
    )
    expect(interruptedHtml).toContain('aria-label="执行计划已中断，已完成 1 / 3 步"')
    expect(interruptedHtml).toContain('执行已中断')
    expect(interruptedHtml).toContain('data-progress="33.33"')
    expect(interruptedHtml).toContain('composer-change-summary__plan-progress-ring')
    expect(interruptedHtml).toContain('composer-change-summary__return')
    expect(interruptedHtml).toContain('composer-change-summary__down-arrow')
    expect(failedHtml).toContain('aria-label="执行计划出错，已完成 1 / 3 步"')
    expect(failedHtml).toContain('执行出错')
    expect(failedHtml).toContain('lucide-circle-x')
    expect(failedHtml).not.toContain('composer-change-summary__plan-progress-ring')
    expect(failedHtml).not.toContain('composer-change-summary__return')
    expect(emptyPlanHtml).toContain('data-progress="0"')
    expect(emptyPlanHtml).not.toContain('NaN')
    expect(emptyPlanHtml).not.toContain('Infinity')
    expect(fileOnlyHtml).toContain('1 个文件已更改')
    expect(fileOnlyHtml).toContain('<button')
    expect(fileOnlyHtml.match(/<button/g)).toHaveLength(2)
    expect(fileOnlyHtml).not.toContain('composer-change-summary__plan')
    expect(fileOnlyHtml).not.toContain('composer-change-summary__separator')
    expect(fileOnlyHtml).toContain('composer-change-summary__diff')
    expect(fileOnlyHtml).toContain('aria-expanded="false"')
    expect(fileOnlyHtml).toContain('aria-controls=')
    expect(fileOnlyHtml).toContain('composer-change-summary__return')
    expect(fileOnlyAtBottomHtml.match(/<button/g)).toHaveLength(1)
    expect(fileOnlyAtBottomHtml).not.toContain('composer-change-summary__return')
    expect(fileOnlyAtBottomHtml).not.toContain('composer-change-summary__return-presence')
  })
})

function executionPlanItem(overrides: Partial<ExecutionPlanItem> = {}): ExecutionPlanItem {
  return {
    id: 'turn-1:execution-plan',
    messageID: 'turn-1',
    turnId: 'turn-1',
    agentId: 'agent-1',
    type: 'execution-plan',
    explanation: '先完成协议，再接入界面。',
    steps: [
      { step: '更新协议', status: 'completed' },
      { step: '接入时间线', status: 'in_progress' },
      { step: '运行验证', status: 'pending' },
    ],
    status: 'streaming',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function changedFiles(count: number, additions: number, deletions: number) {
  return Array.from({ length: count }, (_, index) => ({
    path: `src/file-${index + 1}.ts`,
    additions: index === 0 ? additions : 0,
    deletions: index === 0 ? deletions : 0,
  }))
}
