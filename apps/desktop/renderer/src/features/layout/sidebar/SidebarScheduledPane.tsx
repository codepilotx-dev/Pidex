import { useShallow } from 'zustand/react/shallow'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Calendar, ChevronDown, ChevronRight, History, Plus } from 'lucide-react'
import { useSharedAutomationController } from '../../automation/AutomationControllerProvider.js'
import { formatAutomationTime, runStatusLabel } from '../../automation/AutomationModel.js'
import { TAB_OPTIONS, type AutomationTab } from '../../automation/AutomationView.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { SearchHeading } from '../../../components/ui/SearchHeading.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'

import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { Button } from '../../../components/ui/Button.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { SidebarEmptyRow, SidebarRow } from '../../../components/ui/SidebarRow.js'
import { useLocale } from '../../i18n/LocaleProvider.js'

const TAB_ICONS: Record<AutomationTab, typeof Calendar> = {
  calendar: Calendar,
  runs: History,
}

export function SidebarScheduledPane(): ReactNode {
  const controller = useSharedAutomationController(
    useShallow((state) => ({
      setQuery: state.setQuery,
      runs: state.runs,
      query: state.query,
      cancelDraft: state.cancelDraft,
      filter: state.filter,
      setFilter: state.setFilter,
      supported: state.supported,
      loading: state.loading,
      error: state.error,
      refresh: state.refresh,
      filteredAutomations: state.filteredAutomations,
      markRunRead: state.markRunRead,
    })),
  )
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { t } = useLocale()
  const onAutomationsRoute = location.pathname === '/automations'
  const tab: AutomationTab =
    onAutomationsRoute && searchParams.get('tab') === 'runs' ? 'runs' : 'calendar'
  const selectedId = onAutomationsRoute ? searchParams.get('automationId') : null
  const selectedRunId = onAutomationsRoute ? searchParams.get('automationRunId') : null
  const hasDetailTarget =
    Boolean(selectedId) ||
    Boolean(selectedRunId) ||
    Boolean(searchParams.get('scheduledTaskId')) ||
    searchParams.get('automationMode') === 'create' ||
    searchParams.get('scheduledTaskMode') === 'create'
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [runLimits, setRunLimits] = useState<Record<string, number>>({})

  function browse(nextTab: AutomationTab): void {
    controller.setQuery('')
    if (nextTab === 'calendar') {
      navigate('/automations')
    } else {
      navigate('/automations?tab=runs')
    }
  }

  const runsByTask = useMemo(() => {
    const groups = new Map<string, (typeof controller.runs)[number][]>()
    for (const run of controller.runs) {
      const runs = groups.get(run.automationId) ?? []
      runs.push(run)
      groups.set(run.automationId, runs)
    }
    for (const runs of groups.values()) runs.sort((a, b) => b.createdAt - a.createdAt)
    return groups
  }, [controller.runs])

  return (
    <div className="sidebar-scheduled-pane tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:py-2">
      <header className="sidebar-pane-heading tw:flex tw:min-h-9 tw:shrink-0 tw:items-center tw:justify-between tw:gap-2 tw:px-3">
        <SearchHeading
          title={<h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">{t('已安排')}</h2>}
          search={
            <SearchInput
              variant="outlined"
              aria-label={t('搜索已安排任务')}
              placeholder={t('搜索已安排任务')}
              value={controller.query}
              onChange={controller.setQuery}
            />
          }
        />
        <Button
          asChild
          isIconOnly
          color="ghostSecondary"
          size="toolbar"
          aria-label={t('新建任务')}
          title={t('新建任务')}
        >
          <Link onClick={controller.cancelDraft} to="/automations?automationMode=create">
            <Plus aria-hidden size={APP_ICON_SIZE} />
          </Link>
        </Button>
      </header>
      <div className="tw:flex tw:flex-col tw:sidebar-row-gap tw:p-2">
        {TAB_OPTIONS.map((option) => {
          const Icon = TAB_ICONS[option.value]
          const active = onAutomationsRoute && tab === option.value && !hasDetailTarget
          return (
            <SidebarRow
              active={active}
              asChild
              key={option.value}
              layout="flex"
              leading={<Icon aria-hidden size={APP_ICON_SIZE} />}
            >
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => browse(option.value)}
              >
                {t(option.label)}
              </button>
            </SidebarRow>
          )
        })}
      </div>
      <div className="sidebar-pane-filters tw:flex tw:flex-col tw:gap-2 tw:px-2 tw:pb-2">
        <SegmentedControl
          ariaLabel={t('任务状态')}
          options={[
            { value: 'all', label: t('全部') },
            { value: 'active', label: t('已开启') },
            { value: 'paused', label: t('已暂停') },
          ]}
          value={controller.filter === 'completed' ? 'all' : controller.filter}
          onChange={controller.setFilter}
        />
      </div>
      <ScrollArea
        className="sidebar-scheduled-scroll tw:min-h-0 tw:flex-1 tw:p-2"
        contentClassName="tw:flex tw:flex-col tw:sidebar-row-gap"
      >
        {controller.supported === false ? (
          <SidebarEmptyRow>{t('当前连接不支持已安排任务')}</SidebarEmptyRow>
        ) : controller.loading ? (
          <SidebarEmptyRow role="status">{t('正在加载任务…')}</SidebarEmptyRow>
        ) : controller.error ? (
          <div
            className="sidebar-pane-error tw:p-2 tw:text-app-text-soft tw:type-body-sm"
            role="alert"
          >
            <p>{controller.error}</p>
            <Button size="compact" onClick={() => void controller.refresh()}>
              {t('重试')}
            </Button>
          </div>
        ) : controller.filteredAutomations.length === 0 ? (
          <SidebarEmptyRow>{t('暂无匹配任务')}</SidebarEmptyRow>
        ) : (
          controller.filteredAutomations.map((task) => {
            const open = expanded.has(task.id)
            const runs = runsByTask.get(task.id) ?? []
            const limit = runLimits[task.id] ?? 5
            return (
              <section
                key={task.id}
                className="sidebar-scheduled-task tw:flex tw:flex-col tw:sidebar-row-gap"
              >
                <div className="sidebar-scheduled-task-heading tw:flex tw:min-w-0 tw:items-center">
                  <Button
                    isIconOnly
                    title={`${t('执行记录')}：${task.name}`}
                    aria-expanded={open}
                    aria-label={`${t('执行记录')}：${task.name}`}
                    size="icon"
                    color="ghost"
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current)
                        if (next.has(task.id)) next.delete(task.id)
                        else next.add(task.id)
                        return next
                      })
                    }
                  >
                    {open ? (
                      <ChevronDown size={APP_ICON_SIZE} />
                    ) : (
                      <ChevronRight size={APP_ICON_SIZE} />
                    )}
                  </Button>
                  <SidebarRow
                    asChild
                    layout="flex"
                    leadingMode="none"
                    active={location.pathname === '/automations' && selectedId === task.id}
                    className="tw:min-w-0 tw:grow tw:shrink tw:basis-auto"
                    labelClassName="tw:truncate"
                    title={task.name}
                    trailing={task.status === 'paused' ? t('已暂停') : undefined}
                  >
                    <Link to={`/automations?automationId=${encodeURIComponent(task.id)}`}>
                      {task.name}
                    </Link>
                  </SidebarRow>
                </div>
                {open ? (
                  <div className="sidebar-scheduled-runs tw:flex tw:flex-col tw:sidebar-row-gap tw:pl-6">
                    {runs.length === 0 ? (
                      <SidebarEmptyRow>{t('暂无执行记录')}</SidebarEmptyRow>
                    ) : (
                      runs.slice(0, limit).map((run) => (
                        <SidebarRow
                          asChild
                          layout="flex"
                          leadingMode="none"
                          key={run.id}
                          active={selectedRunId === run.id && selectedId === task.id}
                          labelClassName="tw:truncate"
                        >
                          <Link
                            onClick={() => void controller.markRunRead(run.id)}
                            to={
                              run.threadId
                                ? `/threads/${encodeURIComponent(run.threadId)}`
                                : `/automations?tab=runs&automationId=${encodeURIComponent(task.id)}&automationRunId=${encodeURIComponent(run.id)}`
                            }
                          >
                            {t(runStatusLabel(run.status))} · {formatAutomationTime(run.createdAt)}
                          </Link>
                        </SidebarRow>
                      ))
                    )}
                    {runs.length > limit ? (
                      <Button
                        size="compact"
                        onClick={() =>
                          setRunLimits((current) => ({ ...current, [task.id]: limit + 5 }))
                        }
                      >
                        {t('显示更多')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            )
          })
        )}
      </ScrollArea>
    </div>
  )
}
