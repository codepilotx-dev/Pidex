import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Popover as Popover } from '../../components/ui/floating/Popover.js'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlarmClock,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { Automation, AutomationRun } from '@pidex/shared/automation'
import type { CalendarOccurrence } from '@pidex/shared/calendar'
import type { ScheduledTask, ScheduledTaskDefinition } from '@pidex/shared/scheduled-task'
import { Button } from '../../components/ui/Button.js'

import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { SkeletonBlock, SkeletonRegion } from '../../components/ui/Skeleton.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { composerDraftStore } from '../session/composer/ComposerDraftStore.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { resolveRecentNewThreadModel } from '../models/RecentNewThreadModel.js'
import { AutomationDetailPanel } from './AutomationDetailPanel.js'
import { AutomationCalendar } from './AutomationCalendar.js'
import { TaskSchedulePanel } from './TaskSchedulePanel.js'
import { ScheduledTaskDetailPanel, taskDefinition } from './ScheduledTaskDetailPanel.js'
import {
  AUTOMATION_TEMPLATES,
  automationScheduleSummary,
  automationToDraft,
  defaultAutomationDraft,
  formatAutomationRelativeTime,
  formatAutomationTime,
  hasActiveAutomationRun,
  isCompletedAutomation,
  runStatusLabel,
  runTriggerLabel,
  type AutomationFilter,
  type AutomationTemplate,
  type AutomationTemplateId,
} from './AutomationModel.js'
import {
  AutomationControllerContext,
  AutomationControllerProvider,
  useSharedAutomationController,
} from './AutomationControllerProvider.js'
import { useCalendarController } from './UseCalendarController.js'

export type AutomationTab = 'calendar' | 'runs'

export const TAB_OPTIONS = [
  { value: 'calendar', label: '日历' },
  { value: 'runs', label: '执行记录' },
] as const

type ConfirmState = { kind: 'delete'; automation: Automation } | null
const FILTER_OPTIONS: Array<{ value: AutomationFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '已开启' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
]

export function AutomationView(): React.ReactNode {
  const controller = useContext(AutomationControllerContext)
  return controller ? (
    <AutomationViewContent />
  ) : (
    <AutomationControllerProvider enabled>
      <AutomationViewContent />
    </AutomationControllerProvider>
  )
}

function AutomationViewContent(): React.ReactNode {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const tab: AutomationTab = params.get('tab') === 'runs' ? 'runs' : 'calendar'
  const selectedId = params.get('automationId')
  const creating = params.get('automationMode') === 'create'
  const scheduledTaskId = params.get('scheduledTaskId')
  const creatingScheduledTask = params.get('scheduledTaskMode') === 'create'
  const controller = useSharedAutomationController()
  const calendar = useCalendarController(controller.query, 'all')
  const [scheduledTask, setScheduledTask] = useState<ScheduledTask | null>(null)
  const [scheduledTaskLoading, setScheduledTaskLoading] = useState(false)
  const [planningPluginDisabled, setPlanningPluginDisabled] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const anchorRectRef = useRef<DOMRect | null>(null)
  const [scheduledTaskUnsaved, setScheduledTaskUnsaved] = useState(false)
  const [pendingExit, setPendingExit] = useState<'close' | null>(null)
  const createButtonRef = useRef<HTMLButtonElement | null>(null)
  const detailOpen =
    creating || creatingScheduledTask || Boolean(selectedId) || Boolean(scheduledTaskId)
  const surfaceOpen = detailOpen
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [resolvedModel, setResolvedModel] = useState<Automation['model'] | null>(null)
  useEffect(() => {
    let active = true
    // 自动化只使用统一解析出的有效最近模型：记录失效时回退首个可用模型，
    // 不读取任意历史任务模型，也不接受未经验证的配置记录。
    void resolveRecentNewThreadModel()
      .then((resolved) => {
        if (!active) return
        setResolvedModel(
          resolved
            ? ({
                providerID: resolved.providerID,
                id: resolved.id,
                ...(resolved.variant ? { variant: resolved.variant } : {}),
              } as Automation['model'])
            : null,
        )
      })
      .catch(() => {
        if (active) setResolvedModel(null)
      })
    return () => {
      active = false
    }
  }, [])
  const draftModel = useMemo<Automation['model']>(
    () => resolvedModel ?? ({ providerID: '', id: '' } as Automation['model']),
    [resolvedModel],
  )
  const hasDraftModel = Boolean(draftModel.providerID && draftModel.id)
  const selectedDate = params.get('date') ?? localDateValue(new Date())
  const scheduledTaskDraft = useMemo<ScheduledTaskDefinition>(() => {
    return taskDefinition({
      ...defaultAutomationDraft({
        projectId: controller.projects[0]?.projectId ?? null,
        model: draftModel,
      }),
      scheduledFor: scheduledTimeForDate(selectedDate),
    })
  }, [controller.projects, draftModel, selectedDate])
  const visibleSuggestions = useMemo(() => {
    if (controller.filter !== 'all') return []
    const needle = controller.query.trim().toLocaleLowerCase()
    return AUTOMATION_TEMPLATES.filter(
      (template) =>
        !controller.automations.some(
          (automation) =>
            automation.name === template.name && automation.prompt === template.prompt,
        ),
    ).filter((template) => {
      if (!needle) return true
      return [
        template.name,
        template.description,
        template.prompt,
        automationScheduleSummary(template.schedule),
      ]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle)
    })
  }, [controller.automations, controller.filter, controller.query])
  const showInitialEmpty =
    controller.filter === 'all' &&
    controller.query.trim() === '' &&
    controller.automations.length === 0

  useEffect(() => {
    if (!creating || controller.draft || controller.loading || !hasDraftModel) return
    controller.beginCreate(
      defaultAutomationDraft({
        projectId: controller.projects[0]?.projectId ?? null,
        model: draftModel,
      }),
    )
  }, [controller, creating, draftModel, hasDraftModel])

  useEffect(() => {
    let active = true
    setScheduledTask(null)
    setScheduledTaskLoading(Boolean(scheduledTaskId))
    if (!scheduledTaskId) {
      return
    }
    void desktopClient
      .readScheduledTask({ id: scheduledTaskId })
      .then((result) => {
        if (active) setScheduledTask(result.scheduledTask)
      })
      .catch(() => {
        if (active) setScheduledTask(null)
      })
      .finally(() => {
        if (active) setScheduledTaskLoading(false)
      })
    return () => {
      active = false
    }
  }, [scheduledTaskId])

  const detailAnchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const target =
            returnFocusRef.current?.closest<HTMLElement>('[data-calendar-date]') ??
            returnFocusRef.current ??
            document.querySelector<HTMLElement>(`[data-calendar-date="${selectedDate}"]`)
          const rect =
            anchorRectRef.current ??
            target?.getBoundingClientRect() ??
            new DOMRect(window.innerWidth - 32, 72, 0, 0)
          anchorRectRef.current = rect
          const width = Math.min(360, window.innerWidth - 16)
          const height = Math.min(560, window.innerHeight - 60)
          const preferred =
            rect.right + 12 + width <= window.innerWidth - 16
              ? rect.right + 12
              : rect.left - width - 12
          const left = Math.max(16, Math.min(preferred, window.innerWidth - width - 16))
          const top = Math.max(44, Math.min(rect.top, window.innerHeight - height - 16))
          return new DOMRect(left, top, 0, 0)
        },
      },
    }),
    [selectedDate],
  )

  useEffect(() => {
    const resize = () => {
      anchorRectRef.current = null
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    if (!surfaceOpen) return
    const target = returnFocusRef.current
    target?.setAttribute('data-automation-focus-open', '')
    return () => target?.removeAttribute('data-automation-focus-open')
  }, [surfaceOpen])

  useEffect(() => {
    setPendingExit(null)
  }, [selectedId, scheduledTaskId, creating, creatingScheduledTask])

  useEffect(() => {
    if (controller.saveState === 'saved') setPendingExit(null)
  }, [controller.saveState])

  useEffect(() => {
    if (!detailOpen) return
    const root = surfaceRef.current
    if (root && !root.contains(document.activeElement)) {
      root
        .querySelector<HTMLElement>(
          '.automation-detail button, .automation-detail input, .automation-state button',
        )
        ?.focus({ preventScroll: true })
    }
  }, [detailOpen, scheduledTaskLoading, controller.loading])

  function rememberFocus(): void {
    anchorRectRef.current = null
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  function restoreFocus(): void {
    const target = returnFocusRef.current
    returnFocusRef.current = null
    window.requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLElement>(`[data-calendar-date="${selectedDate}"]`)
      if (target?.isConnected) target.focus()
      else fallback?.focus()
    })
  }
  function openManualCreate(): void {
    openScheduledTask(selectedDate)
  }
  function openCreate(template?: AutomationTemplateId): void {
    if (!hasDraftModel) {
      // 没有可用模型时不允许硬编码兜底，先让用户完成模型选择。
      navigate('/setup')
      return
    }
    rememberFocus()
    if (!template) returnFocusRef.current = createButtonRef.current
    controller.beginCreate(
      defaultAutomationDraft({
        projectId: controller.projects[0]?.projectId ?? null,
        model: draftModel,
        template,
      }),
    )
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('automationId')
      next.delete('scheduledTaskId')
      next.delete('scheduledTaskMode')
      next.set('automationMode', 'create')
      return next
    })
  }
  async function planThroughChat(enablePlugin = false): Promise<void> {
    const plugin = (await desktopClient.listPlugins()).plugins.find(
      (item) => item.id === 'task-planning',
    )
    if (plugin && !plugin.enabled && !enablePlugin) {
      setPlanningPluginDisabled(true)
      return
    }
    if (plugin && !plugin.enabled) await desktopClient.setPluginEnabled(plugin.id, true)
    const skills = await desktopClient.listRuntimeSkills(undefined, { forceReload: true })
    const planning =
      skills.state === 'ready'
        ? skills.data?.find((skill) => skill.name === 'task-planning')
        : undefined
    if (planning)
      composerDraftStore.setSkillInvocation('home', { name: planning.name, path: planning.path })
    composerDraftStore.prefillTextIfEmpty(
      'home',
      '请帮我规划任务。先确认规划一天、一周、一月还是一年，再生成可编辑的日程草案供我确认。',
    )
    navigate('/new')
  }
  function openScheduledTask(targetDate?: string, trigger?: HTMLElement | null): void {
    if (!hasDraftModel) {
      navigate('/setup')
      return
    }
    rememberFocus()
    if (trigger) returnFocusRef.current = trigger
    if (!targetDate) {
      returnFocusRef.current = createButtonRef.current
    }
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('automationId')
      next.delete('automationMode')
      next.delete('scheduledTaskId')
      next.set('scheduledTaskMode', 'create')
      if (targetDate) {
        next.set('date', targetDate)
      }
      return next
    })
  }
  function selectAutomation(id: string): void {
    rememberFocus()
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('automationMode')
      next.delete('scheduledTaskId')
      next.delete('scheduledTaskMode')
      next.set('automationId', id)
      return next
    })
  }
  function selectOccurrence(occurrence: CalendarOccurrence): void {
    rememberFocus()
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('automationId')
      next.delete('automationMode')
      next.delete('scheduledTaskId')
      next.delete('scheduledTaskMode')
      next.set('date', localDateValue(new Date(occurrence.scheduledFor)))
      next.delete('taskId'); next.delete('occurrenceId')
      next.set(
        occurrence.source.kind === 'task-schedule'
          ? 'taskId'
          : occurrence.source.kind === 'automation'
            ? 'automationId'
            : 'scheduledTaskId',
        occurrence.source.id,
      )
      return next
    })
  }
  function closeDetail(force = false): void {
    const automationUnsaved =
      Boolean(controller.draft) &&
      (creating ||
        shouldConfirmDiscard(controller.saveState, controller.draftError) ||
        Boolean(
          controller.selected &&
          JSON.stringify(controller.draft) !==
            JSON.stringify(automationToDraft(controller.selected)),
        ))
    if (
      !force &&
      (creatingScheduledTask || scheduledTaskId ? scheduledTaskUnsaved : automationUnsaved)
    ) {
      setPendingExit('close')
      return
    }
    setPendingExit(null)
    clearDetail()
  }
  function clearDetail(): void {
    setScheduledTaskUnsaved(false)
    controller.cancelDraft()
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('automationMode')
      next.delete('automationId')
      next.delete('scheduledTaskId')
      next.delete('scheduledTaskMode')
      return next
    })
  }

  function pageSettled(): void {
    const root = surfaceRef.current
    if (!root) return
    root
      .querySelector<HTMLElement>(
        '.automation-detail button, .automation-detail input, .automation-state button',
      )
      ?.focus({ preventScroll: true })
  }

  const createActions = (
    <PopoverMenu
      align="end"
      open={createMenuOpen}
      size="md"
      onOpenChange={setCreateMenuOpen}
      trigger={
        <Button ref={createButtonRef} color="primary">
          <Plus aria-hidden="true" size={APP_ICON_SIZE} />
          <span>创建</span>
          <ChevronDown aria-hidden="true" size={APP_ICON_SIZES.sm} />
        </Button>
      }
    >
      <PopoverItem
        icon={<MessageCircle size={APP_ICON_SIZE} />}
        onClick={() => void planThroughChat()}
      >
        使用 CPX 创建
      </PopoverItem>
      <PopoverItem icon={<Settings size={APP_ICON_SIZE} />} onClick={() => openManualCreate()}>
        手动设置
      </PopoverItem>
    </PopoverMenu>
  )

  return (
    <>
      <PrimaryPageLayout
        className="automation-primary-page"
        actions={createActions}
        title={tab === 'runs' ? '执行记录' : '任务日历'}
        description={
          tab === 'runs'
            ? '查看计划任务与自动化的历史执行状态与运行结果。'
            : '规划任务、安排执行，并在同一日历查看运行结果。'
        }
        bodyClassName="automation-view tw:min-h-120 tw:max-[48rem]:min-h-128 tw:text-app-text"
        expandableSearch
        search={
          <SearchInput
            variant="outlined"
            aria-label={tab === 'runs' ? '搜索执行记录' : '搜索已安排任务'}
            placeholder={tab === 'runs' ? '搜索执行记录' : '搜索已安排任务'}
            value={controller.query}
            onChange={controller.setQuery}
          />
        }
      >
        <TaskSchedulePanel query={controller.query} />
        {controller.supported === false ? (
          <StatePanel
            title="当前 Agent 不支持自动化"
            description="更新并重启 Agent 后，即可创建本地计划任务。"
          />
        ) : tab === 'runs' ? (
          <AutomationRunsList
            runs={controller.runs}
            automations={controller.automations}
            loading={controller.loading}
            query={controller.query}
            onClearQuery={() => controller.setQuery('')}
            onOpenThread={(id) => navigate(`/threads/${encodeURIComponent(id)}`)}
          />
        ) : calendar.supported === false && controller.error && !controller.automations.length ? (
          <StatePanel
            title="无法载入自动化"
            description={controller.error}
            action={
              <Button color="secondary" onClick={() => void controller.refresh()}>
                重试
              </Button>
            }
          />
        ) : calendar.supported !== false ? (
          <div className="automation-page-stage tw:grid tw:flex-auto tw:min-w-0 tw:grid-cols-[minmax(0,1fr)]">
            <main
              className="automation-page-content tw:flex tw:min-h-0 tw:min-w-0 tw:flex-col"
              id="automation-calendar-panel"
              role="tabpanel"
              aria-labelledby="automation-calendar-tab"
            >
              {calendar.initialLoading ? (
                <SkeletonRegion
                  className="automation-loading tw:grid tw:content-start tw:gap-3 tw:p-4 tw:[&>*]:min-h-8"
                  label="正在载入任务日历"
                >
                  <SkeletonBlock />
                  <SkeletonBlock />
                  <SkeletonBlock />
                </SkeletonRegion>
              ) : calendar.error && !calendar.hasLoaded ? (
                <StatePanel
                  title="无法载入任务日历"
                  description={calendar.error}
                  action={
                    <Button color="secondary" onClick={() => void calendar.refresh()}>
                      重试
                    </Button>
                  }
                />
              ) : (
                <AutomationCalendar
                  occurrences={calendar.occurrences}
                  refreshing={calendar.refreshing}
                  refreshError={calendar.error}
                  truncated={calendar.truncated}
                  {...(params.get('proposalId')
                    ? { highlightProposalId: params.get('proposalId')! }
                    : {})}
                  selectedDate={selectedDate}
                  onSelectedDateChange={(date) =>
                    setParams((current) => {
                      const next = new URLSearchParams(current)
                      next.set('date', date)
                      return next
                    })
                  }
                  onVisibleRangeChange={calendar.setRange}
                  onRefresh={() => void calendar.refresh()}
                  onOccurrenceSelect={(occurrence) => selectOccurrence(occurrence)}
                  onRunOccurrence={(occurrence) => {
                    if (occurrence.source.kind === 'automation') {
                      void controller.runNow(occurrence.source.id)
                    }
                  }}
                  onOpenThread={(id) => navigate(`/threads/${encodeURIComponent(id)}`)}
                />
              )}
            </main>
          </div>
        ) : (
          <div className="automation-page-stage tw:grid tw:flex-auto tw:min-w-0 tw:grid-cols-[minmax(0,1fr)]">
            <main
              className="automation-page-content tw:flex tw:min-h-0 tw:min-w-0 tw:flex-col"
              id={`automation-${controller.filter}-panel`}
              role="tabpanel"
              aria-labelledby={`automation-${controller.filter}-tab`}
            >
              {controller.loading ? (
                <SkeletonRegion
                  className="automation-loading tw:grid tw:content-start tw:gap-3 tw:p-4 tw:[&>*]:min-h-8"
                  label="正在载入自动化"
                >
                  <SkeletonBlock />
                  <SkeletonBlock />
                  <SkeletonBlock />
                </SkeletonRegion>
              ) : (
                <>
                  {showInitialEmpty ? <AutomationEmptyState /> : null}
                  {controller.filteredAutomations.length ? (
                    <ul
                      className="automation-list tw:m-0 tw:list-none tw:p-0"
                      aria-label="自动化列表"
                    >
                      {controller.filteredAutomations.map((item) => (
                        <AutomationRow
                          key={item.id}
                          automation={item}
                          selected={item.id === selectedId}
                          runs={controller.runs.filter((run) => run.automationId === item.id)}
                          targetLabel={controller.targetLabel(item)}
                          menuOpen={rowMenuId === item.id}
                          onMenuOpenChange={(open) => setRowMenuId(open ? item.id : null)}
                          onSelect={() => selectAutomation(item.id)}
                          onRun={() => void controller.runNow(item.id)}
                          onPause={() => void controller.setPaused(item, item.status !== 'paused')}
                          onDelete={() => setConfirm({ kind: 'delete', automation: item })}
                        />
                      ))}
                    </ul>
                  ) : null}
                  {visibleSuggestions.length ? (
                    <AutomationSuggestions
                      divided={controller.filteredAutomations.length > 0}
                      suggestions={visibleSuggestions}
                      onCreate={openCreate}
                    />
                  ) : null}
                  {!showInitialEmpty &&
                  !controller.filteredAutomations.length &&
                  !visibleSuggestions.length ? (
                    <div
                      className="automation-filter-empty tw:grid tw:min-h-[calc(var(--cpx-sys-space-8)*7)] tw:place-content-center tw:justify-items-center tw:gap-3 tw:p-8 tw:text-center tw:type-body-sm tw:text-app-text-meta"
                      role="status"
                    >
                      <span>未找到已安排任务</span>
                      <Button
                        color="secondary"
                        size="compact"
                        onClick={() => {
                          controller.setQuery('')
                          controller.setFilter('all')
                        }}
                      >
                        清除搜索和筛选
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </main>
          </div>
        )}
      </PrimaryPageLayout>

      <Popover.Root open={surfaceOpen}>
        <Popover.Anchor virtualRef={detailAnchor} />
        <Popover.Portal>
          <div>
            <div
              className="ui-dialog-backdrop permission-modal-backdrop automation-calendar__focus-backdrop tw:pointer-events-auto tw:p-0 tw:animate-none tw:transition-none tw:backdrop-blur-none tw:forced-colors:bg-transparent"
              data-state="open"
              aria-hidden="true"
              onClick={() => closeDetail(true)}
            />
            <Popover.Content
              size="lg"
              ref={surfaceRef}
              className="popover-surface ui-dialog-surface automation-focus-shell tw:z-modal tw:grid tw:max-h-[min(35rem,calc(100vh-60px),var(--popover-available-height))] tw:overflow-hidden tw:rounded-floating tw:animate-none tw:transition-none tw:backdrop-blur-none tw:text-app-text tw:forced-colors:border tw:forced-colors:border-[CanvasText]"
              side="bottom"
              align="start"
              sideOffset={0}
              avoidCollisions={false}
              collisionPadding={{ top: 44, right: 16, bottom: 16, left: 16 }}
              aria-label={
                creatingScheduledTask
                  ? '创建计划任务'
                  : scheduledTaskId
                    ? '计划任务详情'
                    : creating
                      ? '创建自动化'
                      : '自动化详情'
              }
              aria-describedby={undefined}
              onInteractOutside={(event) => event.preventDefault()}
              onEscapeKeyDown={(event) => {
                event.preventDefault()
                closeDetail(true)
              }}
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                pageSettled()
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                anchorRectRef.current = null
                restoreFocus()
              }}
            >
              <div className="automation-focus-dialog tw:grid tw:min-h-0 tw:min-w-0 tw:max-h-[min(35rem,calc(100vh-60px),var(--popover-available-height))] tw:grid-cols-[minmax(0,1fr)]">
                {(creating || controller.selected) && controller.draft ? (
                  <AutomationDetailPanel
                    creating={creating}
                    controller={controller}
                    exitPending={pendingExit}
                    onClose={() => closeDetail(pendingExit === 'close')}
                    onCreated={(id) =>
                      setParams((current) => {
                        const next = new URLSearchParams(current)
                        next.delete('automationMode')
                        next.set('automationId', id)
                        return next
                      })
                    }
                    onOpenThread={(id) => navigate(`/threads/${encodeURIComponent(id)}`)}
                  />
                ) : creatingScheduledTask || scheduledTask ? (
                  <ScheduledTaskDetailPanel
                    creating={creatingScheduledTask}
                    task={scheduledTask}
                    initialDraft={scheduledTaskDraft}
                    projects={controller.projects}
                    sessions={controller.sessions}
                    exitPending={pendingExit}
                    onClose={() => closeDetail(pendingExit === 'close')}
                    onUnsavedChange={setScheduledTaskUnsaved}
                    onChanged={(task) => {
                      setPendingExit(null)
                      setScheduledTask(task)
                      setParams((current) => {
                        const next = new URLSearchParams(current)
                        next.delete('scheduledTaskMode')
                        next.set('scheduledTaskId', task.id)
                        return next
                      })
                      void calendar.refresh()
                    }}
                    onAutomationCreated={(id) => {
                      setPendingExit(null)
                      setParams((current) => {
                        const next = new URLSearchParams(current)
                        next.delete('scheduledTaskMode')
                        next.set('automationId', id)
                        return next
                      })
                      void calendar.refresh()
                      void controller.refresh()
                    }}
                    onDeleted={() => {
                      closeDetail(true)
                      void calendar.refresh()
                    }}
                    onOpenThread={(id) => navigate(`/threads/${encodeURIComponent(id)}`)}
                  />
                ) : (
                  <StatePanel
                    title={
                      controller.loading || scheduledTaskLoading ? '正在载入任务详情' : '未找到任务'
                    }
                    description=""
                    action={
                      <Button color="ghostSecondary" onClick={() => closeDetail(true)}>
                        关闭
                      </Button>
                    }
                  />
                )}
              </div>
            </Popover.Content>
          </div>
        </Popover.Portal>
      </Popover.Root>

      <ConfirmationDialog
        open={confirm?.kind === 'delete'}
        title="删除自动化？"
        description="未来的计划运行会停止；已经开始的运行不会被强制中断，历史记录仍会保留。"
        actionLabel="删除"
        tone="danger"
        onCancel={() => setConfirm(null)}
        onAction={() => {
          if (confirm?.kind !== 'delete') return
          void controller.remove(confirm.automation).then(() => {
            setConfirm(null)
            if (selectedId === confirm.automation.id) closeDetail(true)
          })
        }}
      />
      <ConfirmationDialog
        open={planningPluginDisabled}
        title="启用任务规划插件？"
        description="规划任务需要 task-planning 插件生成可编辑的日程草案。"
        actionLabel="启用并继续"
        onCancel={() => setPlanningPluginDisabled(false)}
        onAction={() => {
          setPlanningPluginDisabled(false)
          void planThroughChat(true)
        }}
      />
    </>
  )
}

function AutomationRunsList({
  runs,
  automations,
  loading,
  query,
  onClearQuery,
  onOpenThread,
}: {
  runs: readonly AutomationRun[]
  automations: readonly Automation[]
  loading: boolean
  query: string
  onClearQuery: () => void
  onOpenThread: (threadId: string) => void
}): React.ReactNode {
  const automationNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of automations) {
      map.set(item.id, item.name)
    }
    return map
  }, [automations])

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      const aTime = a.completedAt ?? a.startedAt ?? a.createdAt
      const bTime = b.completedAt ?? b.startedAt ?? b.createdAt
      return bTime - aTime
    })
  }, [runs])

  const needle = query.trim().toLocaleLowerCase()
  const filteredRuns = useMemo(() => {
    if (!needle) return sortedRuns
    return sortedRuns.filter((run) => {
      const taskName = (automationNameMap.get(run.automationId) ?? '').toLocaleLowerCase()
      const status = runStatusLabel(run.status).toLocaleLowerCase()
      const trigger = runTriggerLabel(run.trigger).toLocaleLowerCase()
      return taskName.includes(needle) || status.includes(needle) || trigger.includes(needle)
    })
  }, [sortedRuns, needle, automationNameMap])

  return (
    <div className="automation-page-stage tw:grid tw:flex-auto tw:min-w-0 tw:grid-cols-[minmax(0,1fr)]">
      <main
        className="automation-page-content tw:flex tw:min-h-0 tw:min-w-0 tw:flex-col"
        id="automation-runs-panel"
        role="tabpanel"
        aria-labelledby="automation-runs-tab"
      >
        {loading && !runs.length ? (
          <SkeletonRegion
            className="automation-loading tw:grid tw:content-start tw:gap-3 tw:p-4 tw:[&>*]:min-h-8"
            label="正在载入执行记录"
          >
            <SkeletonBlock />
            <SkeletonBlock />
            <SkeletonBlock />
          </SkeletonRegion>
        ) : !sortedRuns.length ? (
          <div
            className="automation-empty-state tw:flex tw:min-h-[calc(var(--cpx-sys-space-8)*6)] tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:text-center tw:text-app-text-soft"
            role="status"
          >
            <CalendarClock size={APP_ICON_SIZES.lg} aria-hidden="true" />
            <h2 className="tw:m-0 tw:type-title-sm tw:text-app-text">暂无执行记录</h2>
            <p className="tw:m-0 tw:type-body">
              任务在计划时间或手动触发运行后，执行记录会显示在这里。
            </p>
          </div>
        ) : !filteredRuns.length ? (
          <div
            className="automation-filter-empty tw:grid tw:min-h-[calc(var(--cpx-sys-space-8)*7)] tw:place-content-center tw:justify-items-center tw:gap-3 tw:p-8 tw:text-center tw:type-body-sm tw:text-app-text-meta"
            role="status"
          >
            <span>未找到匹配的执行记录</span>
            <Button color="secondary" size="compact" onClick={onClearQuery}>
              清除搜索
            </Button>
          </div>
        ) : (
          <div className="automation-runs-page-container tw:flex tw:w-full tw:max-w-[56rem] tw:box-border tw:flex-col tw:px-6 tw:py-4">
            <ol
              className="automation-runs-page-list tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-2 tw:p-0"
              aria-label="执行记录列表"
            >
              {filteredRuns.map((run) => {
                const taskName = automationNameMap.get(run.automationId) ?? '已安排任务'
                const time = formatAutomationTime(run.completedAt ?? run.startedAt ?? run.createdAt)
                const hasThread = Boolean(run.threadId)
                return (
                  <li
                    key={run.id}
                    className="automation-runs-page-item tw:group tw:list-none"
                    data-status={run.status}
                  >
                    <button
                      type="button"
                      className="automation-runs-page-button tw:flex tw:w-full tw:cursor-pointer tw:items-center tw:justify-between tw:gap-4 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:px-4 tw:py-3 tw:text-left tw:text-app-text tw:transition-[background-color,border-color] tw:duration-feedback tw:ease-standard tw:enabled:hover:border-app-border-subtle tw:enabled:hover:bg-app-hover tw:disabled:cursor-default tw:disabled:opacity-85"
                      disabled={!hasThread}
                      onClick={() => {
                        if (run.threadId) onOpenThread(run.threadId)
                      }}
                    >
                      <div className="automation-runs-page-info tw:flex tw:min-w-0 tw:flex-1 tw:items-center">
                        <div className="automation-runs-page-topline tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-3">
                          <span
                            className="automation-run-status tw:inline-flex tw:items-center tw:gap-2 tw:type-label"
                            data-status={run.status}
                          >
                            <span
                              className="automation-status-dot tw:size-2 tw:shrink-0 tw:rounded-full tw:bg-app-info tw:group-data-[status=completed]:bg-app-success tw:group-data-[status=failed]:bg-app-danger tw:group-data-[status=interrupted]:bg-app-danger"
                              aria-hidden="true"
                            />
                            <span>{runStatusLabel(run.status)}</span>
                          </span>
                          <strong className="automation-runs-page-name tw:max-w-80 tw:truncate tw:type-label tw:text-app-text">
                            {taskName}
                          </strong>
                          <span className="automation-runs-page-trigger tw:whitespace-nowrap tw:rounded-container tw:bg-app-underlay tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-meta">
                            {runTriggerLabel(run.trigger)}
                          </span>
                        </div>
                      </div>
                      <div className="automation-runs-page-meta tw:flex tw:shrink-0 tw:items-center tw:gap-3">
                        <time className="automation-runs-page-time tw:whitespace-nowrap tw:type-caption tw:text-app-text-meta">
                          {time}
                        </time>
                        {hasThread ? (
                          <span
                            className="automation-runs-page-link tw:flex tw:items-center tw:text-app-text-meta tw:group-hover:text-app-accent-fg"
                            aria-label="查看对话"
                          >
                            <ArrowUpRight size={APP_ICON_SIZES.sm} aria-hidden="true" />
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </main>
    </div>
  )
}

function AutomationRow({
  automation,
  selected,
  runs,
  targetLabel,
  menuOpen,
  onMenuOpenChange,
  onSelect,
  onRun,
  onPause,
  onDelete,
}: {
  automation: Automation
  selected: boolean
  runs: readonly AutomationRun[]
  targetLabel: string
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onSelect: () => void
  onRun: () => void
  onPause: () => void
  onDelete: () => void
}): React.ReactNode {
  const unread = runs.some(
    (run) => !run.readAt && ['completed', 'failed', 'interrupted'].includes(run.status),
  )
  const activeRun = hasActiveAutomationRun(automation.id, runs)
  const completed = isCompletedAutomation(automation, runs)
  const rowStatus = activeRun
    ? 'running'
    : automation.status === 'paused'
      ? 'paused'
      : completed
        ? 'completed'
        : 'active'
  return (
    <li
      className="tw:group tw:relative tw:grid tw:grid-cols-[minmax(0,1fr)_var(--cpx-sys-space-8)] tw:items-center tw:rounded-container tw:transition-[background,opacity] tw:duration-feedback tw:ease-standard tw:hover:bg-app-hover tw:focus-within:bg-app-hover tw:data-[selected=true]:bg-app-selected tw:data-[status=paused]:not-data-[selected=true]:opacity-60 tw:data-[status=paused]:hover:opacity-100 tw:data-[status=paused]:focus-within:opacity-100"
      data-selected={selected || undefined}
      data-status={rowStatus}
    >
      <button
        className="automation-row tw:grid tw:w-full tw:min-w-0 tw:cursor-pointer tw:grid-cols-[var(--cpx-sys-space-5)_minmax(0,1fr)_9rem] tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:p-2 tw:text-left tw:text-inherit tw:focus-visible:outline-none tw:max-[48rem]:grid-cols-[var(--cpx-sys-space-5)_minmax(0,1fr)]"
        type="button"
        onClick={onSelect}
      >
        <span
          className="automation-row-icon tw:flex tw:items-center tw:justify-center tw:text-app-text-soft"
          aria-hidden="true"
        >
          {activeRun ? (
            <LoaderCircle className="tw:animate-spin" size={APP_ICON_SIZE} />
          ) : automation.status === 'paused' ? (
            <Pause size={APP_ICON_SIZE} />
          ) : completed ? (
            <CheckCircle2 size={APP_ICON_SIZE} />
          ) : (
            <Play size={APP_ICON_SIZE} />
          )}
        </span>
        <span className="automation-row-content tw:grid tw:min-w-0 tw:gap-1">
          <span className="automation-row-title tw:flex tw:items-center tw:gap-2 tw:type-row-title">
            <strong className="tw:truncate">{automation.name}</strong>
            {unread ? (
              <span
                className="automation-unread tw:size-2 tw:shrink-0 tw:rounded-full tw:bg-app-info"
                aria-label="有未读运行结果"
              />
            ) : null}
          </span>
          <span className="automation-row-summary tw:truncate tw:type-body-sm tw:text-app-text-soft">
            {automationScheduleSummary(automation.schedule)}
            <span aria-hidden="true"> · </span>
            {targetLabel}
          </span>
        </span>
        <span className="automation-row-status tw:shrink-0 tw:truncate tw:text-right tw:type-caption tw:text-app-text-meta tw:group-hover:opacity-0 tw:group-focus-within:opacity-0 tw:max-[48rem]:hidden">
          {activeRun
            ? '正在运行'
            : automation.status === 'paused'
              ? '已暂停'
              : completed
                ? '已完成'
                : `下次运行 ${formatAutomationRelativeTime(automation.nextRunAt)}`}
        </span>
      </button>
      <PopoverMenu
        align="end"
        open={menuOpen}
        size="sm"
        onOpenChange={onMenuOpenChange}
        trigger={
          <Button
            isIconOnly
            className="automation-row-menu tw:justify-self-center tw:opacity-0 tw:group-hover:opacity-100 tw:group-focus-within:opacity-100 tw:focus-visible:opacity-100"
            color="ghostSecondary"
            size="toolbar"
            title={`${automation.name} 操作`}
          >
            <MoreHorizontal aria-hidden="true" size={APP_ICON_SIZE} />
          </Button>
        }
      >
        <PopoverItem icon={<Play size={APP_ICON_SIZE} />} onClick={onRun}>
          立即运行
        </PopoverItem>
        <PopoverItem
          icon={
            automation.status === 'paused' ? (
              <Play size={APP_ICON_SIZE} />
            ) : (
              <Pause size={APP_ICON_SIZE} />
            )
          }
          onClick={onPause}
        >
          {automation.status === 'paused' ? '恢复' : '暂停'}
        </PopoverItem>
        <PopoverItem icon={<Trash2 size={APP_ICON_SIZE} />} onClick={onDelete}>
          删除
        </PopoverItem>
      </PopoverMenu>
    </li>
  )
}

function AutomationEmptyState(): React.ReactNode {
  return (
    <div
      className="automation-empty-state tw:flex tw:min-h-[calc(var(--cpx-sys-space-8)*6)] tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:text-center tw:text-app-text-soft"
      role="status"
    >
      <CalendarClock size={APP_ICON_SIZES.lg} aria-hidden="true" />
      <h2 className="tw:m-0 tw:type-title-sm tw:text-app-text">暂无已安排任务</h2>
      <p className="tw:m-0 tw:type-body">创建任务后，它们会按状态显示在这里。</p>
    </div>
  )
}

function AutomationSuggestions({
  divided,
  suggestions,
  onCreate,
}: {
  divided: boolean
  suggestions: readonly AutomationTemplate[]
  onCreate: (template: AutomationTemplateId) => void
}): React.ReactNode {
  return (
    <section
      className="automation-suggestions tw:border-t tw:border-app-border-subtle tw:pt-3 tw:data-[divided=true]:mt-3"
      data-divided={divided || undefined}
    >
      <h2 className="tw:m-0 tw:type-title-sm tw:text-app-text">建议</h2>
      <ul
        className="tw:m-0 tw:grid tw:list-none tw:gap-1.25 tw:px-0 tw:pt-2 tw:pb-0"
        aria-label="自动化建议"
      >
        {suggestions.map((item) => (
          <li
            className="tw:group tw:rounded-container tw:p-1.25 tw:hover:bg-app-hover tw:focus-within:bg-app-hover"
            key={item.id}
            data-tone={item.tone}
          >
            <button
              className="tw:grid tw:w-full tw:cursor-pointer tw:grid-cols-[var(--cpx-sys-space-5)_minmax(0,1fr)] tw:items-start tw:gap-3 tw:border-0 tw:bg-transparent tw:text-left tw:text-app-text"
              type="button"
              onClick={() => onCreate(item.id)}
            >
              <span
                className="automation-suggestion-icon tw:flex tw:items-center tw:justify-center tw:pt-1 tw:group-data-[tone=info]:text-app-info-fg tw:group-data-[tone=skill]:text-app-skill-fg tw:group-data-[tone=success]:text-app-success-fg"
                aria-hidden="true"
              >
                {item.id === 'daily-brief' ? (
                  <AlarmClock size={APP_ICON_SIZE} />
                ) : item.id === 'weekly-review' ? (
                  <CalendarClock size={APP_ICON_SIZE} />
                ) : (
                  <FileSearch size={APP_ICON_SIZE} />
                )}
              </span>
              <span className="automation-suggestion-content tw:grid tw:min-w-0 tw:gap-1">
                <span className="automation-suggestion-title tw:flex tw:min-w-0 tw:items-baseline tw:gap-2">
                  <strong className="tw:type-label">{item.name}</strong>
                  <span className="tw:type-body-sm tw:text-app-text-soft">
                    {automationScheduleSummary(item.schedule)}
                  </span>
                </span>
                <small className="tw:truncate tw:type-body-sm tw:text-app-text-soft">
                  {item.description}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function StatePanel({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}): React.ReactNode {
  return (
    <div
      className="automation-state tw:grid tw:min-h-0 tw:place-content-center tw:justify-items-center tw:gap-3 tw:p-8 tw:text-center"
      role="status"
    >
      <h2 className="tw:m-0 tw:type-title-sm tw:text-app-text">{title}</h2>
      <p className="tw:m-0 tw:type-body-sm tw:text-app-text-soft">{description}</p>
      {action}
    </div>
  )
}

function shouldConfirmDiscard(saveState: string, draftError: string | null): boolean {
  return Boolean(draftError) || saveState === 'failed' || saveState === 'conflict'
}

function localDateValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function scheduledTimeForDate(value: string): number {
  const date = new Date(`${value}T09:00`)
  const now = new Date()
  if (localDateValue(now) !== value) return date.getTime()
  if (date.getTime() > now.getTime()) return date.getTime()
  const next = new Date(now)
  next.setMinutes(0, 0, 0)
  next.setHours(next.getHours() + 1)
  return next.getTime()
}
