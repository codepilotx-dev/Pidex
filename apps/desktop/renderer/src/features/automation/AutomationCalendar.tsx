import { APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { CalendarOccurrence } from '@pidex/shared/calendar'
import { Popover as Popover } from '../../components/ui/floating/Popover.js'
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, MessageSquare, Play } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import {
  addCalendarMonths,
  formatDateValue,
  parseDateValue,
} from '../../components/ui/DatePicker.js'

import { Spinner } from '../../components/ui/Spinner.js'
import { cx } from '../../utils/Cx.js'
import {
  calendarDates,
  calendarStatusLabel as statusLabel,
  calendarOccurrencesByDate,
  type CalendarDateCell,
} from './CalendarDates.js'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

const MONTH_LABELS = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
] as const

export type CalendarStatusKind = 'info' | 'warning' | 'accent' | 'success' | 'danger'

type Props = {
  occurrences: readonly CalendarOccurrence[]
  refreshing?: boolean
  refreshError?: string | null
  truncated?: boolean
  highlightProposalId?: string
  selectedDate?: string
  defaultSelectedDate?: string
  onSelectedDateChange?: (value: string) => void
  onVisibleRangeChange?: (range: { from: number; to: number }) => void
  onRefresh?: () => void
  onOccurrenceSelect: (occurrence: CalendarOccurrence) => void
  onRunOccurrence?: (occurrence: CalendarOccurrence) => void
  onOpenThread?: (threadId: string) => void
}

export function AutomationCalendar({
  occurrences,
  refreshing = false,
  refreshError = null,
  selectedDate,
  defaultSelectedDate,
  onSelectedDateChange,
  onVisibleRangeChange,
  onOccurrenceSelect,
  onRunOccurrence,
  onOpenThread,
}: Props): React.ReactNode {
  const today = useMemo(() => new Date(), [])
  const initialDate = parseDateValue(selectedDate ?? defaultSelectedDate) ?? today
  const [internalSelectedDate, setInternalSelectedDate] = useState(formatDateValue(initialDate))
  const activeDateValue = selectedDate ?? internalSelectedDate

  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1, 12),
  )
  const [focusedDate, setFocusedDate] = useState(initialDate)

  // Month picker popover state
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(() => visibleMonth.getFullYear())

  // Monthly tasks list popover state
  const [tasksPopoverOpen, setTasksPopoverOpen] = useState(false)

  useEffect(() => {
    if (monthPickerOpen) {
      setPickerYear(visibleMonth.getFullYear())
    }
  }, [monthPickerOpen, visibleMonth])

  const currentMonthOccurrences = useMemo(() => {
    const targetYear = visibleMonth.getFullYear()
    const targetMonth = visibleMonth.getMonth()
    return occurrences
      .filter((item) => {
        const d = new Date(item.scheduledFor)
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth
      })
      .slice()
      .sort((a, b) => a.scheduledFor - b.scheduledFor || a.title.localeCompare(b.title, 'zh-CN'))
  }, [occurrences, visibleMonth])

  const occurrencesByDate = useMemo(() => calendarOccurrencesByDate(occurrences), [occurrences])

  const monthCells = useMemo(() => calendarDates(visibleMonth, today), [visibleMonth, today])

  // Notify visible 42-day range
  useEffect(() => {
    if (!onVisibleRangeChange || monthCells.length === 0) return
    const first = monthCells[0].date
    const last = monthCells[monthCells.length - 1].date
    const from = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate(),
      0,
      0,
      0,
      0,
    ).getTime()
    const to = new Date(
      last.getFullYear(),
      last.getMonth(),
      last.getDate(),
      23,
      59,
      59,
      999,
    ).getTime()
    onVisibleRangeChange({ from, to })
  }, [monthCells, onVisibleRangeChange])

  // Sync selectedDate from prop
  useEffect(() => {
    if (!selectedDate) return
    const parsed = parseDateValue(selectedDate)
    if (!parsed) return
    setInternalSelectedDate(selectedDate)
    setFocusedDate(parsed)
    if (
      parsed.getFullYear() !== visibleMonth.getFullYear() ||
      parsed.getMonth() !== visibleMonth.getMonth()
    ) {
      setVisibleMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1, 12))
    }
  }, [selectedDate, visibleMonth])

  function selectDate(date: Date): void {
    const value = formatDateValue(date)
    setInternalSelectedDate(value)
    setFocusedDate(date)
    onSelectedDateChange?.(value)
    if (
      date.getFullYear() !== visibleMonth.getFullYear() ||
      date.getMonth() !== visibleMonth.getMonth()
    ) {
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12))
    }
  }

  function handleMonthChange(delta: number): void {
    const nextMonth = addCalendarMonths(visibleMonth, delta)
    setVisibleMonth(nextMonth)
    setFocusedDate(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1, 12))
  }

  function handleToday(): void {
    const now = new Date()
    selectDate(now)
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    let next: Date | null = null
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(focusedDate, -1)
        break
      case 'ArrowRight':
        next = addDays(focusedDate, 1)
        break
      case 'ArrowUp':
        next = addDays(focusedDate, -7)
        break
      case 'ArrowDown':
        next = addDays(focusedDate, 7)
        break
      case 'Home': {
        const dayOfWeek = (focusedDate.getDay() + 6) % 7
        next = addDays(focusedDate, -dayOfWeek)
        break
      }
      case 'End': {
        const dayOfWeek = (focusedDate.getDay() + 6) % 7
        next = addDays(focusedDate, 6 - dayOfWeek)
        break
      }
      case 'PageUp':
        next = addCalendarMonths(focusedDate, -1)
        break
      case 'PageDown':
        next = addCalendarMonths(focusedDate, 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        selectDate(focusedDate)
        return
      default:
        return
    }
    if (next) {
      event.preventDefault()
      setFocusedDate(next)
      if (
        next.getFullYear() !== visibleMonth.getFullYear() ||
        next.getMonth() !== visibleMonth.getMonth()
      ) {
        setVisibleMonth(new Date(next.getFullYear(), next.getMonth(), 1, 12))
      }
      const nextValue = formatDateValue(next)
      const target = document.querySelector<HTMLElement>(`[data-calendar-date="${nextValue}"]`)
      target?.focus()
    }
  }
  const selectedDateObj = useMemo(
    () => parseDateValue(activeDateValue) ?? initialDate,
    [activeDateValue, initialDate],
  )

  const selectedDayOccurrences = useMemo(
    () => occurrencesByDate.get(activeDateValue) ?? [],
    [occurrencesByDate, activeDateValue],
  )

  const sortedOccurrences = useMemo(() => {
    return [...selectedDayOccurrences].sort((a, b) => {
      if (a.scheduledFor !== b.scheduledFor) {
        return a.scheduledFor - b.scheduledFor
      }
      const titleComp = a.title.localeCompare(b.title)
      if (titleComp !== 0) return titleComp
      return a.id.localeCompare(b.id)
    })
  }, [selectedDayOccurrences])

  return (
    <div className="automation-calendar tw:flex tw:flex-auto tw:min-w-0 tw:flex-col tw:gap-4 tw:text-app-text">
      {/* Top Section: Month Toolbar */}
      <div className="automation-calendar__toolbar tw:flex tw:shrink-0 tw:items-end tw:justify-between tw:gap-3">
        <div className="automation-calendar__title-group tw:flex tw:min-w-0 tw:items-end tw:gap-2">
          {/* Month Picker Dropdown */}
          <Popover.Root open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="automation-calendar__month-trigger tw:-ml-2 tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-1 tw:rounded-control tw:border tw:border-transparent tw:bg-transparent tw:px-2 tw:py-0.5 tw:text-app-text tw:transition-[background-color,border-color] tw:duration-feedback tw:ease-standard tw:hover:border-app-border-subtle tw:hover:bg-app-hover tw:focus-visible:outline-none"
                aria-label={`选择年月，当前为 ${monthLabel(visibleMonth)}`}
              >
                <h2 className="automation-calendar__period tw:m-0 tw:whitespace-nowrap tw:type-title-md tw:text-app-text">
                  {monthLabel(visibleMonth)}
                </h2>
                <ChevronDown
                  size={APP_ICON_SIZES.sm}
                  aria-hidden="true"
                  className={cx(
                    'automation-calendar__month-trigger-icon tw:text-app-text-meta tw:transition-transform tw:duration-state tw:ease-standard',
                    monthPickerOpen && 'tw:rotate-180',
                  )}
                />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                size="md"
                className="popover-surface automation-calendar__month-picker-popover tw:flex tw:flex-col tw:gap-3 tw:p-3"
                side="bottom"
                align="start"
                sideOffset={6}
              >
                <div className="automation-calendar__year-nav tw:flex tw:items-center tw:justify-between tw:gap-2">
                  <Button
                    isIconOnly
                    size="iconSm"
                    color="ghost"
                    title="上一年"
                    aria-label="上一年"
                    onClick={() => setPickerYear((y) => y - 1)}
                  >
                    <ChevronLeft size={APP_ICON_SIZES.sm} />
                  </Button>
                  <span className="automation-calendar__year-label tw:type-label tw:text-app-text">
                    {pickerYear}年
                  </span>
                  <Button
                    isIconOnly
                    size="iconSm"
                    color="ghost"
                    title="下一年"
                    aria-label="下一年"
                    onClick={() => setPickerYear((y) => y + 1)}
                  >
                    <ChevronRight size={APP_ICON_SIZES.sm} />
                  </Button>
                </div>
                <div className="automation-calendar__month-grid tw:grid tw:grid-cols-3 tw:gap-2">
                  {MONTH_LABELS.map((name, index) => {
                    const isCurrent =
                      visibleMonth.getFullYear() === pickerYear && visibleMonth.getMonth() === index
                    return (
                      <button
                        key={name}
                        type="button"
                        className={cx(
                          'automation-calendar__month-grid-btn tw:flex tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-control tw:border tw:border-transparent tw:bg-transparent tw:px-1 tw:py-2 tw:type-label tw:text-app-text tw:transition-[background-color,color,border-color] tw:duration-feedback tw:ease-standard tw:hover:border-app-border-subtle tw:hover:bg-app-hover tw:focus-visible:outline-none',
                          isCurrent &&
                            'automation-calendar__month-grid-btn--active tw:bg-app-accent-fg tw:text-app-main tw:hover:bg-app-accent-fg tw:hover:text-app-main',
                        )}
                        onClick={() => {
                          const nextMonth = new Date(pickerYear, index, 1, 12)
                          setVisibleMonth(nextMonth)
                          setFocusedDate(nextMonth)
                          setMonthPickerOpen(false)
                        }}
                      >
                        {name}
                      </button>
                    )
                  })}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {/* Monthly Tasks Button & Popover */}
          <Popover.Root open={tasksPopoverOpen} onOpenChange={setTasksPopoverOpen}>
            <Popover.Trigger asChild>
              <Button
                color="secondary"
                size="compact"
                className="automation-calendar__tasks-trigger tw:shrink-0"
                aria-label={`查看当月任务列表，共 ${currentMonthOccurrences.length} 项`}
              >
                {currentMonthOccurrences.length} 项任务
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                size="md"
                className="popover-surface automation-calendar__tasks-popover tw:flex tw:max-h-88 tw:flex-col tw:gap-2 tw:p-3"
                side="bottom"
                align="start"
                sideOffset={6}
              >
                <div className="automation-calendar__tasks-popover-header tw:flex tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-app-border-subtle tw:pb-2">
                  <span className="automation-calendar__tasks-popover-title tw:m-0 tw:type-label tw:text-app-text">
                    {monthLabel(visibleMonth)}任务清单
                  </span>
                  <span className="automation-calendar__tasks-popover-count tw:type-caption tw:text-app-text-meta">
                    共 {currentMonthOccurrences.length} 项
                  </span>
                </div>
                <div
                  className="automation-calendar__tasks-popover-list tw:flex tw:max-h-68 tw:flex-col tw:gap-1 tw:overflow-y-auto"
                  role="list"
                >
                  {currentMonthOccurrences.length === 0 ? (
                    <div className="automation-calendar__tasks-popover-empty tw:py-4 tw:text-center tw:type-caption tw:text-app-text-meta">
                      当月暂无任务
                    </div>
                  ) : (
                    currentMonthOccurrences.map((occ) => {
                      const occDate = new Date(occ.scheduledFor)
                      const dateText = `${occDate.getMonth() + 1}月${occDate.getDate()}日`
                      const timeText = timeLabel(occ.scheduledFor)
                      return (
                        <button
                          key={occ.id}
                          type="button"
                          className="automation-calendar__tasks-popover-item tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-control tw:border tw:border-transparent tw:bg-transparent tw:p-2 tw:text-left tw:text-app-text tw:transition-[background-color,border-color] tw:duration-feedback tw:ease-standard tw:hover:border-app-border-subtle tw:hover:bg-app-hover tw:focus-visible:outline-none"
                          onClick={() => {
                            selectDate(occDate)
                            setTasksPopoverOpen(false)
                          }}
                        >
                          <span className="automation-calendar__tasks-popover-time tw:shrink-0 tw:whitespace-nowrap tw:tabular-nums tw:type-caption tw:text-app-text-soft">
                            {dateText} {timeText}
                          </span>
                          <span
                            className={calendarDotClass('automation-calendar__agenda-dot')}
                            data-status={occurrenceStatusKind(occ)}
                            aria-hidden="true"
                          />
                          <span className="automation-calendar__tasks-popover-item-title tw:min-w-0 tw:flex-1 tw:truncate tw:type-body-sm tw:text-app-text">
                            {occ.title}
                          </span>
                          <span className="automation-calendar__tasks-popover-source tw:shrink-0 tw:whitespace-nowrap tw:type-caption tw:text-app-text-meta">
                            {sourceLabel(occ)}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {refreshing ? (
            <span className="automation-calendar__sync-status tw:inline-flex tw:items-center tw:gap-1 tw:pb-0.5 tw:whitespace-nowrap tw:type-caption tw:text-app-text-meta">
              <Spinner size="small" />
              正在同步...
            </span>
          ) : refreshError ? (
            <span className="automation-calendar__sync-status automation-calendar__sync-status--error tw:inline-flex tw:items-center tw:gap-1 tw:pb-0.5 tw:whitespace-nowrap tw:type-caption tw:text-app-chart-red">
              同步失败
            </span>
          ) : null}
        </div>
        <div className="automation-calendar__nav tw:flex tw:shrink-0 tw:items-end tw:gap-1">
          <Button
            isIconOnly
            size="compact"
            color="ghost"
            title="上个月"
            aria-label="上个月"
            onClick={() => handleMonthChange(-1)}
          >
            <ChevronLeft size={APP_ICON_SIZES.sm} />
          </Button>
          <Button size="compact" color="secondary" onClick={handleToday}>
            今天
          </Button>
          <Button
            isIconOnly
            size="compact"
            color="ghost"
            title="下个月"
            aria-label="下个月"
            onClick={() => handleMonthChange(1)}
          >
            <ChevronRight size={APP_ICON_SIZES.sm} />
          </Button>
        </div>
      </div>

      {/* Compact Month Calendar Grid */}
      <div
        className="automation-calendar__month-view tw:flex tw:w-full tw:shrink-0 tw:flex-col"
        role="grid"
        aria-label="任务日历"
      >
        <div
          className="automation-calendar__weekdays tw:grid tw:grid-cols-7 tw:border-b tw:border-app-border-subtle tw:pb-2 tw:text-center"
          role="row"
        >
          {WEEKDAYS.map((name) => (
            <span
              key={name}
              className="automation-calendar__weekday tw:type-label tw:text-app-text-soft"
              role="columnheader"
            >
              {name}
            </span>
          ))}
        </div>
        <div
          className="automation-calendar__grid tw:grid tw:w-full tw:grid-cols-7 tw:gap-1 tw:pt-1"
          role="rowgroup"
          onKeyDown={handleGridKeyDown}
        >
          {Array.from({ length: Math.ceil(monthCells.length / 7) }, (_, week) => (
            <div key={week} role="row" className="tw:contents">
              {monthCells.slice(week * 7, week * 7 + 7).map((cell) => {
                const cellOccurrences = occurrencesByDate.get(cell.value) ?? []
                const visibleDots = cellOccurrences.slice(0, 4)
                const overflow = cellOccurrences.length - 4
                const isSelected = cell.value === activeDateValue
                const isFocused = isSameDate(cell.date, focusedDate)

                return (
                  <button
                    key={cell.value}
                    type="button"
                    role="gridcell"
                    className={cx(
                      'automation-calendar__day tw:flex tw:min-h-[calc(var(--cpx-sys-space-8)*2)] tw:cursor-pointer tw:flex-col tw:items-start tw:justify-start tw:rounded-control tw:border tw:border-app-border-subtle tw:bg-app-main tw:p-2 tw:text-left tw:text-app-text tw:transition-[background-color,border-color] tw:duration-feedback tw:ease-standard tw:hover:border-app-border tw:hover:bg-app-hover tw:focus-visible:outline-none',
                      isSelected &&
                        'tw:aria-selected:border-app-accent-fg tw:aria-selected:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent-fg)_8%,transparent)] tw:aria-selected:outline-solid tw:aria-selected:outline-[1.5px] tw:aria-selected:outline-offset-[-1px] tw:aria-selected:outline-app-accent-fg',
                      !cell.currentMonth && 'tw:data-[other-month]:text-app-text-meta',
                    )}
                    data-calendar-date={cell.value}
                    data-today={cell.today ? '' : undefined}
                    data-selected={isSelected ? '' : undefined}
                    data-other-month={!cell.currentMonth ? '' : undefined}
                    aria-selected={isSelected}
                    aria-label={dayLabel(cell.date, cellOccurrences.length)}
                    tabIndex={isFocused ? 0 : -1}
                    onClick={() => selectDate(cell.date)}
                  >
                    <span
                      className={cx(
                        'automation-calendar__day-num tw:text-[length:var(--cpx-sys-font-size-xs)] tw:type-weight-label tw:[line-height:var(--cpx-sys-line-height-none)]',
                        cell.today &&
                          'tw:inline-flex tw:h-6 tw:min-w-6 tw:items-center tw:justify-center tw:rounded-full tw:bg-app-accent-fg tw:px-1 tw:text-app-main',
                      )}
                    >
                      {cell.day}
                    </span>
                    <div
                      className="automation-calendar__dots tw:mt-2 tw:flex tw:min-h-2 tw:items-center tw:gap-1"
                      aria-hidden="true"
                    >
                      {visibleDots.map((occ, idx) => (
                        <span
                          key={occ.id || idx}
                          className={calendarDotClass('automation-calendar__dot')}
                          data-status={occurrenceStatusKind(occ)}
                        />
                      ))}
                      {overflow > 0 ? (
                        <span className="automation-calendar__dot-overflow tw:text-[length:var(--cpx-sys-font-size-xs)] tw:type-weight-body tw:[line-height:var(--cpx-sys-line-height-none)] tw:text-app-text-meta">
                          +{overflow}
                        </span>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Residing Agenda Below */}
      <section className="automation-calendar__residing-agenda tw:flex tw:flex-col tw:gap-3 tw:border-t tw:border-app-border-subtle tw:pt-4">
        <div className="automation-calendar__agenda-header tw:flex tw:shrink-0 tw:items-center tw:justify-between tw:gap-3">
          <div className="automation-calendar__agenda-title-group tw:flex tw:min-w-0 tw:items-center tw:gap-2">
            <h3 className="automation-calendar__agenda-title tw:m-0 tw:whitespace-nowrap tw:type-title-sm tw:text-app-text">
              {agendaDateHeading(selectedDateObj)}
            </h3>
            <span className="automation-calendar__agenda-count tw:whitespace-nowrap tw:type-caption tw:text-app-text-meta">
              {selectedDayOccurrences.length} 项任务
            </span>
          </div>
        </div>

        {/* Task List */}
        <div className="automation-calendar__agenda-list tw:flex tw:flex-col tw:gap-1">
          {sortedOccurrences.length === 0 ? (
            <div className="automation-calendar__agenda-empty tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:px-4 tw:py-6 tw:text-center">
              <Calendar
                className="automation-calendar__agenda-empty-icon tw:text-app-text-meta tw:opacity-70"
                size={APP_ICON_SIZES.lg}
                aria-hidden="true"
              />
              <p className="automation-calendar__agenda-empty-text tw:m-0 tw:type-body tw:text-app-text-meta">
                当日暂无任务
              </p>
            </div>
          ) : (
            sortedOccurrences.map((occurrence) => (
              <div
                key={occurrence.id}
                className="automation-calendar__agenda-item tw:group tw:flex tw:cursor-pointer tw:items-center tw:gap-3 tw:rounded-control tw:border tw:border-transparent tw:bg-app-main tw:px-3 tw:py-2 tw:transition-[background-color,border-color] tw:duration-feedback tw:ease-standard tw:hover:border-app-border-subtle tw:hover:bg-app-hover tw:focus-visible:outline-none"
                role="button"
                tabIndex={0}
                onClick={() => onOccurrenceSelect(occurrence)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOccurrenceSelect(occurrence)
                  }
                }}
              >
                <div className="automation-calendar__agenda-time tw:flex tw:w-16 tw:shrink-0 tw:items-center tw:gap-2">
                  <span className="automation-calendar__agenda-time-text tw:tabular-nums tw:type-label tw:text-app-text-soft">
                    {timeLabel(occurrence.scheduledFor)}
                    {occurrence.durationMinutes
                      ? `–${timeLabel(occurrence.scheduledFor + occurrence.durationMinutes * 60_000)}`
                      : ''}
                  </span>
                  <span
                    className={calendarDotClass('automation-calendar__agenda-dot')}
                    data-status={occurrenceStatusKind(occurrence)}
                  />
                </div>
                <div className="automation-calendar__agenda-main tw:flex tw:min-w-0 tw:flex-auto tw:items-center tw:gap-3">
                  <span className="automation-calendar__agenda-item-title tw:truncate tw:type-body tw:text-app-text">
                    {occurrence.title}
                  </span>
                  <span className="automation-calendar__agenda-item-meta tw:shrink-0 tw:whitespace-nowrap tw:type-caption tw:text-app-text-meta">
                    {sourceLabel(occurrence)} · {statusLabel(occurrence.status)}
                  </span>
                </div>
                <div className="automation-calendar__agenda-actions tw:invisible tw:flex tw:shrink-0 tw:items-center tw:gap-1 tw:opacity-0 tw:transition-opacity tw:duration-feedback tw:ease-standard tw:group-hover:visible tw:group-hover:opacity-100 tw:group-focus-visible:visible tw:group-focus-visible:opacity-100">
                  {occurrence.source.kind === 'automation' && onRunOccurrence ? (
                    <Button
                      isIconOnly
                      size="iconSm"
                      color="ghost"
                      title="立即运行"
                      aria-label="立即运行"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRunOccurrence(occurrence)
                      }}
                    >
                      <Play size={APP_ICON_SIZES.sm} />
                    </Button>
                  ) : null}
                  {occurrence.threadId && onOpenThread ? (
                    <Button
                      isIconOnly
                      size="iconSm"
                      color="ghost"
                      title="查看会话"
                      aria-label="查看会话"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenThread(occurrence.threadId!)
                      }}
                    >
                      <MessageSquare size={APP_ICON_SIZES.sm} />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

/*
 * 日程状态圆点共享同一组数据属性配色：底色取信息蓝，`data-status` 覆盖为对应图表色。
 */
function calendarDotClass(className: string): string {
  return [
    className,
    'tw:size-2 tw:shrink-0 tw:rounded-full',
    'tw:bg-app-chart-blue',
    'tw:data-[status=info]:bg-app-chart-blue tw:data-[status=warning]:bg-app-chart-yellow',
    'tw:data-[status=accent]:bg-app-chart-orange tw:data-[status=success]:bg-app-chart-green',
    'tw:data-[status=danger]:bg-app-chart-red',
  ].join(' ')
}

function isSameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12)
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
  }).format(date)
}

function agendaDateHeading(date: Date): string {
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(date)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`
}

function dayLabel(date: Date, count: number): string {
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(date)
  const dateText = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`
  return count ? `${dateText}，${count} 项任务` : `${dateText}，没有任务`
}

export function timeLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

export function sourceLabel(occurrence: CalendarOccurrence): string {
  if (occurrence.source.kind === 'task-schedule') return '任务安排'
  if (occurrence.source.kind === 'automation') return '自动化执行'
  return occurrence.definitionKind === 'recurring' ? '重复计划' : '计划任务'
}

export function occurrenceStatusKind(occurrence: CalendarOccurrence): CalendarStatusKind {
  if (occurrence.source.kind === 'automation') {
    if (occurrence.status === 'completed') return 'success'
    if (occurrence.status === 'failed' || occurrence.status === 'interrupted') {
      return 'danger'
    }
    if (
      occurrence.status === 'running' ||
      occurrence.status === 'preparing' ||
      occurrence.status === 'queued' ||
      occurrence.status === 'claimed'
    ) {
      return 'accent'
    }
    if (occurrence.status === 'paused') return 'warning'
    return 'info'
  }
  switch (occurrence.status) {
    case 'needs-plan':
    case 'awaiting-acceptance':
      return 'warning'
    case 'completed':
      return 'success'
    case 'failed':
    case 'interrupted':
      return 'danger'
    case 'running':
    case 'queued':
    case 'preparing':
    case 'claimed':
      return 'accent'
    case 'paused':
      return 'warning'
    case 'scheduled':
    default:
      return 'info'
  }
}

export function defaultTimeStringForDate(value: string): string {
  const ts = scheduledTimeForDate(value)
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function scheduledTimeForDate(value: string): number {
  const date = new Date(`${value}T09:00`)
  const now = new Date()
  const todayVal = formatDateValue(now)
  if (todayVal !== value) return date.getTime()
  if (date.getTime() > now.getTime()) return date.getTime()
  const next = new Date(now)
  next.setMinutes(0, 0, 0)
  next.setHours(next.getHours() + 1)
  return next.getTime()
}

export function parseDateTimeToTimestamp(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0)
  return date.getTime()
}
