import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Automation, AutomationRun } from '@pidex/shared/automation'
import {
  AUTOMATION_TEMPLATES,
  defaultAutomationDraft,
  isCompletedAutomation,
} from '../src/features/automation/AutomationModel.js'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

const viewSource = readFileSync(
  new URL('../src/features/automation/AutomationView.tsx', import.meta.url),
  'utf8',
)
const detailSource = readFileSync(
  new URL('../src/features/automation/AutomationDetailPanel.tsx', import.meta.url),
  'utf8',
)
const calendarSource = readFileSync(
  new URL('../src/features/automation/AutomationCalendar.tsx', import.meta.url),
  'utf8',
)

describe('AutomationView primary page hierarchy', () => {
  test('uses the shared primary page with Codex status navigation', () => {
    expectSourceContains(viewSource, '<PrimaryPageLayout')
    expectSourceContains(viewSource, 'search={')
    expectSourceContains(viewSource, "{ value: 'all', label: '全部' }")
    expectSourceContains(viewSource, "{ value: 'active', label: '已开启' }")
    expectSourceContains(viewSource, "{ value: 'paused', label: '已暂停' }")
    expectSourceContains(viewSource, "{ value: 'completed', label: '已完成' }")
    expectSourceNotContains(viewSource, "label: '计划任务'")
    expectSourceNotContains(viewSource, "label: '运行收件箱'")
    expectSourceNotContains(viewSource, 'automation-header-meta')
    expectSourceNotContains(viewSource, 'automation-workbench')
    expectSourceNotContains(viewSource, '安排第一项自动化')
    expectSourceContains(viewSource, '暂无已安排任务')
    expectSourceContains(viewSource, '创建任务后，它们会按状态显示在这里。')
    expectSourceContains(viewSource, '未找到已安排任务')
    expectSourceContains(viewSource, '<AutomationSuggestions')
    expectSourceContains(viewSource, "controller.filter === 'all'")
    expectSourceContains(viewSource, "controller.query.trim() === ''")
    expectSourceContains(viewSource, 'controller.automations.length === 0')
    expectSourceContains(viewSource, 'showInitialEmpty ? <AutomationEmptyState /> : null')
  })

  test('keeps run history in the detail panel and chat creation prefilled', () => {
    const detailSource = readFileSync(
      new URL('../src/features/automation/AutomationDetailPanel.tsx', import.meta.url),
      'utf8',
    )
    expectSourceContains(detailSource, '<RunHistory')
    expectSourceContains(viewSource, 'composerDraftStore.prefillTextIfEmpty')
  })

  test('automation drafts use only the unified recent-model resolution', () => {
    // 自动化草稿只能来自统一解析结果，不能读取任意历史任务模型或未验证的最近记录。
    expectSourceContains(viewSource, 'resolveRecentNewThreadModel()')
    expectSourceContains(viewSource, 'hasDraftModel')
    expectSourceContains(viewSource, 'if (!hasDraftModel) {')
    expectSourceContains(viewSource, "navigate('/setup')")
    expectSourceNotContains(viewSource, 'getRecentNewThreadModel')
    expectSourceNotContains(
      viewSource,
      'controller.sessions.find(item => item.providerID && item.model)',
    )
    expectSourceNotContains(viewSource, 'hasDefaultModel')
  })

  test('derives completed tasks without treating an active run as completed', () => {
    const automation = {
      id: 'automation-1',
      status: 'active',
      nextRunAt: null,
    } as Automation
    expect(isCompletedAutomation(automation, [])).toBe(true)
    expect(
      isCompletedAutomation(automation, [
        {
          automationId: automation.id,
          status: 'running',
        } as AutomationRun,
      ]),
    ).toBe(false)
    expect(isCompletedAutomation({ ...automation, status: 'paused' }, [])).toBe(false)
  })

  test('keeps suggestion copy and created drafts on the same template source', () => {
    const weekly = AUTOMATION_TEMPLATES.find((item) => item.id === 'weekly-review')
    expect(weekly?.schedule).toEqual({
      mode: 'weekly',
      weekdays: ['FR'],
      time: '16:00',
    })
    const draft = defaultAutomationDraft({
      projectId: 'project-1',
      model: { providerID: 'openai', id: 'gpt-5' },
      template: 'weekly-review',
    })
    expect(draft.name).toBe(weekly?.name)
    expect(draft.prompt).toBe(weekly?.prompt)
    expect(draft.schedule).toEqual(weekly?.schedule)
  })

  test('keeps suggestion rhythm without extra button padding', () => {
    // 建议列表的节奏（外框分隔线、行内 gap、按钮无多余内边距）现在由
    // AutomationView.tsx 的 utility 类承担，断言随之改为源码契约。
    const sectionTag = viewSource.match(/className="automation-suggestions [^"]*"/)?.[0]
    const buttonTag = viewSource.match(
      /className="tw:grid tw:w-full tw:cursor-pointer tw:grid-cols-\[var\(--cpx-sys-space-5\)_minmax\(0,1fr\)\][^"]*"/,
    )?.[0]
    const headingTag = viewSource.match(/<h2 className="[^"]*">建议<\/h2>/)?.[0]

    expectSourceContains(sectionTag, 'tw:border-t tw:border-app-border-subtle tw:pt-3')
    expectSourceContains(buttonTag, 'tw:gap-3')
    expectSourceNotContains(buttonTag, 'tw:p-')
    expectSourceNotContains(buttonTag, 'tw:px-')
    expectSourceNotContains(buttonTag, 'tw:py-')
    expectSourceNotContains(headingTag, 'tw:p')
    expectSourceNotContains(headingTag, 'tw:border-b')
  })

  test('keeps detail header in single row and hides raw timezone text from execution time', () => {
    const scheduledTaskSource = readFileSync(
      new URL('../src/features/automation/ScheduledTaskDetailPanel.tsx', import.meta.url),
      'utf8',
    )
    // Header is single row with title group on left and action group on right
    expectSourceContains(detailSource, 'automation-detail-title-group')
    expectSourceContains(detailSource, 'automation-detail-header-actions')
    expectSourceContains(scheduledTaskSource, 'automation-detail-title-group')
    expectSourceContains(scheduledTaskSource, 'automation-detail-header-actions')

    // Execution time no longer displays raw timezone region hint
    expectSourceContains(scheduledTaskSource, 'role="group" aria-label="执行时间"')
    expectSourceContains(scheduledTaskSource, 'aria-label="执行日期"')
    expectSourceContains(scheduledTaskSource, 'aria-label="执行时刻"')
    expectSourceNotContains(scheduledTaskSource, 'type="datetime-local"')
    expectSourceNotContains(scheduledTaskSource, '<Field label="执行时间" hint={draft.timeZone}>')

    // Calendar selected day uses accent border instead of dull solid gray; the
    // selected state now rides on `aria-selected` variants in AutomationCalendar.tsx.
    expectSourceContains(calendarSource, 'tw:aria-selected:border-app-accent-fg')
    expectSourceContains(calendarSource, 'tw:aria-selected:outline-[1.5px]')
    expectSourceContains(calendarSource, 'tw:aria-selected:outline-app-accent-fg')
  })

  test('converges creation to top-right menu with CPX planning and manual settings', () => {
    expectSourceContains(viewSource, '使用 CPX 创建')
    expectSourceContains(viewSource, '手动设置')
    expectSourceContains(viewSource, 'openManualCreate')
    expectSourceContains(viewSource, 'scheduledFor: scheduledTimeForDate(selectedDate)')
    expectSourceNotContains(viewSource, 'onQuickCreate')
    expectSourceNotContains(viewSource, 'setQuickDraft')
  })

  test('mounts top-level header navigation for calendar and execution records and dedicated runs list', () => {
    expectSourceContains(viewSource, 'id="automation.navigation"')
    expectSourceContains(viewSource, "{ value: 'calendar', label: '日历' }")
    expectSourceContains(viewSource, "{ value: 'runs', label: '执行记录' }")
    expectSourceContains(viewSource, '<AutomationRunsList')
    expectSourceContains(viewSource, 'automation-runs-page-list')
    expectSourceContains(viewSource, 'automation-runs-page-item')
    expectSourceContains(viewSource, 'automation-runs-page-button')
  })
})
