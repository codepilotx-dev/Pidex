import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { CalendarOccurrence } from '@pidex/shared/calendar'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AutomationCalendar,
  defaultTimeStringForDate,
  parseDateTimeToTimestamp,
} from '../src/features/automation/AutomationCalendar.js'
import {
  calendarDates,
  calendarOccurrencesByDate,
  filterCalendarOccurrences,
} from '../src/features/automation/CalendarDates.js'

describe('automation calendar compact month & residing agenda', () => {
  test('builds a Monday-first 6 × 7 month and groups occurrences in time order', () => {
    const dates = calendarDates(new Date(2026, 8, 18), new Date(2026, 8, 5))

    expect(dates).toHaveLength(42)
    expect(dates[0]).toMatchObject({
      value: '2026-08-31',
      currentMonth: false,
    })
    expect(dates[5]).toMatchObject({ value: '2026-09-05', today: true })
    expect(dates[41]).toMatchObject({
      value: '2026-10-11',
      currentMonth: false,
    })

    const occurrences = [
      occurrence('later', new Date(2026, 8, 5, 16).getTime()),
      occurrence('earlier', new Date(2026, 8, 5, 9).getTime()),
    ]
    expect(
      calendarOccurrencesByDate(occurrences)
        .get('2026-09-05')
        ?.map((item) => item.id),
    ).toEqual(['earlier', 'later'])
  })

  test('filters the loaded range locally by source, execution, and title', () => {
    const planned = occurrence('Review API', new Date(2026, 8, 5, 9).getTime())
    const automation = {
      ...occurrence('Daily cleanup', new Date(2026, 8, 5, 10).getTime()),
      source: { kind: 'automation' as const, id: 'automation:cleanup' },
      definitionKind: 'recurring' as const,
    }
    const execution = {
      ...planned,
      id: 'run:review',
      runId: 'run:review',
      status: 'completed' as const,
    }
    const occurrences = [planned, automation, execution]

    expect(filterCalendarOccurrences(occurrences, '', 'scheduled-task')).toEqual([planned])
    expect(filterCalendarOccurrences(occurrences, '', 'automation')).toEqual([automation])
    expect(filterCalendarOccurrences(occurrences, '', 'execution')).toEqual([execution])
    expect(filterCalendarOccurrences(occurrences, 'review', 'all')).toEqual([planned, execution])
  })

  test('renders 42 Monday-first gridcells, max 4 status dots per date, and +N overflow', () => {
    const occurrences = Array.from({ length: 6 }, (_, index) =>
      occurrence(`task-${index}`, new Date(2026, 8, 5, 9 + index).getTime()),
    )
    const html = renderToStaticMarkup(
      createElement(AutomationCalendar, {
        defaultSelectedDate: '2026-09-05',
        occurrences,
        onOccurrenceSelect: () => {},
      }),
    )

    expect(html.match(/role="gridcell"/g)).toHaveLength(42)
    // 4 visible dots + 1 overflow "+2"
    expect(html).toContain('+2')
    expect(html).toContain('2026年9月5日 星期六，6 项任务')

    // Regression assertions: no view mode switcher, no popup agenda
    expect(html).not.toContain('automation-calendar__view-segmented')
    expect(html).not.toContain('automation-calendar__focus-popover')
    expect(html).not.toContain('automation-agenda')
    expect(html).not.toContain('收起当日议程')
    expect(html).not.toContain('automation-calendar__week-stream')
    expect(html).not.toContain('automation-calendar__day-timeline')
  })

  test('renders residing agenda for selected date with chronological tasks, meta, and actions', () => {
    const occAfternoon = occurrence('下午审查', new Date(2026, 8, 5, 14, 0).getTime())
    const occMorning = occurrence('早间同步', new Date(2026, 8, 5, 9, 30).getTime())
    const occOtherDay = occurrence('明日任务', new Date(2026, 8, 6, 10, 0).getTime())

    const html = renderToStaticMarkup(
      createElement(AutomationCalendar, {
        selectedDate: '2026-09-05',
        occurrences: [occAfternoon, occMorning, occOtherDay],
        onOccurrenceSelect: () => {},
      }),
    )

    expect(html).toContain('automation-calendar__residing-agenda')
    expect(html).toContain('2026年9月5日 星期六')
    expect(html).toContain('2 项任务')

    const morningIndex = html.indexOf('早间同步')
    const afternoonIndex = html.indexOf('下午审查')
    expect(morningIndex).toBeGreaterThan(0)
    expect(afternoonIndex).toBeGreaterThan(morningIndex)
    expect(html).not.toContain('明日任务')
    expect(html).toContain('09:30')
    expect(html).toContain('14:00')
    expect(html).toContain('计划任务')
  })

  test('renders empty state with calendar icon and text when selected date has no occurrences', () => {
    const html = renderToStaticMarkup(
      createElement(AutomationCalendar, {
        selectedDate: '2026-09-05',
        occurrences: [],
        onOccurrenceSelect: () => {},
      }),
    )

    expect(html).toContain('当日暂无任务')
    expect(html).toContain('automation-calendar__agenda-empty-icon')
    expect(html).not.toContain('添加任务')
  })

  test('combines quick create title, date, and time into correct timestamp', () => {
    const dateValue = '2026-09-05'
    const defaultTime = defaultTimeStringForDate(dateValue)
    expect(defaultTime).toBe('09:00')

    const customTime = '14:30'
    const timestamp = parseDateTimeToTimestamp(dateValue, customTime)
    expect(timestamp).toBe(new Date(2026, 8, 5, 14, 30).getTime())
  })

  test('renders month dropdown trigger, monthly tasks button, and [上个月] [今天] [下个月] navigation order', () => {
    const occurrences = [
      occurrence('task-1', new Date(2026, 8, 5, 10).getTime()),
      occurrence('task-2', new Date(2026, 8, 12, 14).getTime()),
      occurrence('other-month-task', new Date(2026, 9, 1, 9).getTime()),
    ]
    const html = renderToStaticMarkup(
      createElement(AutomationCalendar, {
        defaultSelectedDate: '2026-09-05',
        occurrences,
        onOccurrenceSelect: () => {},
      }),
    )

    // Month dropdown trigger
    expect(html).toContain('automation-calendar__month-trigger')
    expect(html).toContain('2026年9月')

    // Monthly tasks button with secondary compact style
    expect(html).toContain('automation-calendar__tasks-trigger')
    expect(html).toContain('data-color="secondary"')
    expect(html).toContain('data-size="compact"')
    expect(html).toContain('2 项任务')

    // Navigation buttons order: [上个月] -> [今天] -> [下个月]
    const prevIndex = html.indexOf('aria-label="上个月"')
    const todayIndex = html.indexOf('>今天</button>')
    const nextIndex = html.indexOf('aria-label="下个月"')

    expect(prevIndex).toBeGreaterThan(0)
    expect(todayIndex).toBeGreaterThan(prevIndex)
    expect(nextIndex).toBeGreaterThan(todayIndex)

    // Navigation buttons are compact uniform height. Slice to the end of the
    // opening tag: the utility class list is long, so a fixed window would
    // depend on how many classes a button happens to carry.
    const openTagAt = (index: number) => html.slice(index, html.indexOf('>', index) + 1)
    const prevSnippet = openTagAt(prevIndex)
    expect(prevSnippet).toContain('data-size="compact"')
    expect(prevSnippet).toContain('data-uniform="true"')
    const nextSnippet = openTagAt(nextIndex)
    expect(nextSnippet).toContain('data-size="compact"')
    expect(nextSnippet).toContain('data-uniform="true"')

    // Toolbar and title-group use flex-end baseline alignment
    // （原 `automation-calendar.scss` 规则已迁到组件 utility）。
    const calendarSource = readFileSync(
      new URL('../src/features/automation/AutomationCalendar.tsx', import.meta.url),
      'utf8',
    )
    const classAttrOf = (classAnchor: string) =>
      calendarSource.match(new RegExp(`className="${classAnchor}([^"]*)"`))?.[1] ?? ''
    const toolbarClass = classAttrOf('automation-calendar__toolbar')
    expect(toolbarClass).toContain('tw:flex')
    expect(toolbarClass).toContain('tw:items-end')
    const titleGroupClass = classAttrOf('automation-calendar__title-group')
    expect(titleGroupClass).toContain('tw:flex')
    expect(titleGroupClass).toContain('tw:items-end')
  })
})

function occurrence(id: string, scheduledFor: number): CalendarOccurrence {
  return {
    id,
    source: { kind: 'scheduled-task', id: `task:${id}` },
    definitionKind: 'one-off',
    title: id,
    scheduledFor,
    status: 'scheduled',
    runId: null,
    threadId: null,
    proposalId: null,
  }
}
