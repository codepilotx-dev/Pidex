import { APP_ICON_SIZE, APP_ICON_SIZES } from './IconTokens.js'
import React from 'react'
import { Popover as Popover } from './floating/Popover.js'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '../../utils/Cx.js'
import { useLocale } from '../../features/i18n/LocaleProvider.js'
import type { AppLocale } from '../../features/i18n/Locale.js'

export type DatePickerProps = {
  value: string
  ariaLabel: string
  min?: string
  max?: string
  disabled?: boolean
  placeholder?: string
  className?: string
  onValueChange: (value: string) => void
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseDateValue(value: string | undefined): Date | null {
  if (!value) return null
  const match = DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day, 12)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null
}

export function formatDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12)
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12)
}

export function addCalendarMonths(date: Date, amount: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate()
  target.setDate(Math.min(date.getDate(), lastDay))
  return target
}

function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

function displayDate(value: string, locale: AppLocale): string {
  const date = parseDateValue(value)
  return date
    ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        date,
      )
    : value
}

function monthLabel(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(date)
}

function dayLabel(date: Date, today: string, selected: string, locale: AppLocale): string {
  const value = formatDateValue(date)
  const states = [
    value === today ? (locale === 'en-US' ? 'Today' : '今天') : '',
    value === selected ? (locale === 'en-US' ? 'Selected' : '已选择') : '',
  ].filter(Boolean)
  const label = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
  return states.length
    ? `${label}${locale === 'en-US' ? ', ' : '，'}${states.join(locale === 'en-US' ? ', ' : '，')}`
    : label
}

export function DatePicker({
  value,
  ariaLabel,
  min,
  max,
  disabled = false,
  placeholder = '选择日期',
  className,
  onValueChange,
}: DatePickerProps): React.ReactNode {
  const { locale, t } = useLocale()
  const today = React.useMemo(() => new Date(), [])
  const todayValue = formatDateValue(today)
  const selectedDate = parseDateValue(value)
  const [open, setOpen] = React.useState(false)
  const [visibleMonth, setVisibleMonth] = React.useState(() => startOfMonth(selectedDate ?? today))
  const [focusedDate, setFocusedDate] = React.useState(() => selectedDate ?? today)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const calendarRef = React.useRef<HTMLDivElement | null>(null)
  const minDate = parseDateValue(min)
  const maxDate = parseDateValue(max)

  function clampToRange(date: Date): Date {
    const dateValue = formatDateValue(date)
    if (minDate && dateValue < formatDateValue(minDate)) return minDate
    if (maxDate && dateValue > formatDateValue(maxDate)) return maxDate
    return date
  }

  React.useEffect(() => {
    if (!selectedDate || open) return
    setVisibleMonth(startOfMonth(selectedDate))
    setFocusedDate(selectedDate)
  }, [open, value])

  const calendarStart = addDays(visibleMonth, -mondayIndex(visibleMonth))
  const calendarDates = Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index))

  function isUnavailable(date: Date): boolean {
    const dateValue = formatDateValue(date)
    return Boolean(
      (minDate && dateValue < formatDateValue(minDate)) ||
      (maxDate && dateValue > formatDateValue(maxDate)),
    )
  }

  function focusDay(date: Date): void {
    const focusableDate = clampToRange(date)
    setFocusedDate(focusableDate)
    setVisibleMonth(startOfMonth(focusableDate))
    requestAnimationFrame(() => {
      calendarRef.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${formatDateValue(focusableDate)}"]`)
        ?.focus()
    })
  }

  function chooseDate(date: Date): void {
    if (isUnavailable(date)) return
    onValueChange(formatDateValue(date))
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function handleDayKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, date: Date): void {
    let nextDate: Date | null = null
    switch (event.key) {
      case 'ArrowLeft':
        nextDate = addDays(date, -1)
        break
      case 'ArrowRight':
        nextDate = addDays(date, 1)
        break
      case 'ArrowUp':
        nextDate = addDays(date, -7)
        break
      case 'ArrowDown':
        nextDate = addDays(date, 7)
        break
      case 'Home':
        nextDate = addDays(date, -mondayIndex(date))
        break
      case 'End':
        nextDate = addDays(date, 6 - mondayIndex(date))
        break
      case 'PageUp':
        nextDate = addCalendarMonths(date, event.shiftKey ? -12 : -1)
        break
      case 'PageDown':
        nextDate = addCalendarMonths(date, event.shiftKey ? 12 : 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        chooseDate(date)
        return
      case 'Escape':
        event.preventDefault()
        setOpen(false)
        requestAnimationFrame(() => triggerRef.current?.focus())
        return
      default:
        return
    }
    event.preventDefault()
    if (nextDate) focusDay(nextDate)
  }

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) {
      const initialDate = clampToRange(selectedDate ?? today)
      setVisibleMonth(startOfMonth(initialDate))
      setFocusedDate(initialDate)
      requestAnimationFrame(() => focusDay(initialDate))
    }
  }

  function navigateMonth(amount: number): void {
    focusDay(addCalendarMonths(focusedDate, amount))
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          aria-label={ariaLabel}
          className={cx(
            'ui-date-picker-trigger tw:inline-flex tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-control-gap tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-control tw:px-control-inline tw:py-control-block tw:text-app-text tw:outline-none tw:transition-[background-color,border-color] tw:duration-feedback tw:ease-standard tw:enabled:hover:border-app-border-strong tw:focus-visible:border-app-focus tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-1 tw:disabled:cursor-default tw:disabled:text-app-text-disabled tw:disabled:opacity-55',
            className,
          )}
          disabled={disabled}
          type="button"
        >
          <CalendarDays
            size={APP_ICON_SIZE}
            aria-hidden="true"
            className="ui-date-picker-trigger-icon tw:size-icon tw:shrink-0 tw:text-app-text-soft"
          />
          <span
            className={cx(
              'ui-date-picker-value tw:min-w-0 tw:flex-auto tw:overflow-hidden tw:text-left tw:text-ellipsis tw:whitespace-nowrap',
              !value && 'ui-date-picker-value--placeholder tw:text-app-text-meta',
            )}
          >
            {value ? displayDate(value, locale) : t(placeholder)}
          </span>
          <ChevronDown
            size={APP_ICON_SIZES.sm}
            aria-hidden="true"
            className="ui-date-picker-chevron tw:size-icon-sm tw:shrink-0 tw:text-app-text-soft"
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          size="lg"
          align="start"
          aria-label={`${t(ariaLabel)} ${t('日历')}`}
          className="popover-surface ui-date-picker-content tw:z-popover tw:p-3"
          collisionPadding={8}
          sideOffset={4}
          onEscapeKeyDown={() => requestAnimationFrame(() => triggerRef.current?.focus())}
        >
          <div className="ui-date-picker-header tw:mb-2 tw:flex tw:items-center tw:justify-between">
            <button
              aria-label={t('上个月')}
              className="ui-date-picker-nav tw:inline-grid tw:size-7 tw:cursor-pointer tw:place-items-center tw:rounded-control tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text tw:outline-none tw:hover:bg-app-hover tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-1"
              type="button"
              onClick={() => navigateMonth(-1)}
            >
              <ChevronLeft size={APP_ICON_SIZE} aria-hidden="true" className="tw:size-icon" />
            </button>
            <div
              aria-live="polite"
              className="ui-date-picker-month tw:text-app-text tw:type-title-sm"
            >
              {monthLabel(visibleMonth, locale)}
            </div>
            <button
              aria-label={t('下个月')}
              className="ui-date-picker-nav tw:inline-grid tw:size-7 tw:cursor-pointer tw:place-items-center tw:rounded-control tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text tw:outline-none tw:hover:bg-app-hover tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-1"
              type="button"
              onClick={() => navigateMonth(1)}
            >
              <ChevronRight size={APP_ICON_SIZES.sm} aria-hidden="true" className="tw:size-icon" />
            </button>
          </div>
          <div
            ref={calendarRef}
            aria-label={monthLabel(visibleMonth, locale)}
            className="ui-date-picker-grid"
            role="grid"
          >
            <div className="ui-date-picker-weekdays tw:grid tw:grid-cols-7" role="row">
              {WEEKDAYS.map((weekday) => (
                <span
                  aria-label={
                    locale === 'en-US'
                      ? [
                          'Monday',
                          'Tuesday',
                          'Wednesday',
                          'Thursday',
                          'Friday',
                          'Saturday',
                          'Sunday',
                        ][WEEKDAYS.indexOf(weekday)]
                      : `星期${weekday}`
                  }
                  className="ui-date-picker-weekday tw:grid tw:h-6 tw:place-items-center tw:text-app-text-meta tw:type-label"
                  key={weekday}
                  role="columnheader"
                >
                  {locale === 'en-US'
                    ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'][WEEKDAYS.indexOf(weekday)]
                    : weekday}
                </span>
              ))}
            </div>
            <div className="ui-date-picker-days tw:grid tw:grid-cols-7" role="rowgroup">
              {Array.from({ length: 6 }, (_, weekIndex) => (
                <div className="ui-date-picker-week tw:contents" key={weekIndex} role="row">
                  {calendarDates.slice(weekIndex * 7, weekIndex * 7 + 7).map((date) => {
                    const dateValue = formatDateValue(date)
                    const unavailable = isUnavailable(date)
                    const selected = dateValue === value
                    const currentMonth = date.getMonth() === visibleMonth.getMonth()
                    const focused = dateValue === formatDateValue(focusedDate)
                    return (
                      <button
                        aria-current={dateValue === todayValue ? 'date' : undefined}
                        aria-label={dayLabel(date, todayValue, value, locale)}
                        aria-selected={selected}
                        className={cx(
                          'ui-date-picker-day tw:relative tw:grid tw:cursor-pointer tw:aspect-square tw:place-items-center tw:rounded-control tw:border-0 tw:bg-transparent tw:p-0 tw:type-control tw:outline-none tw:aria-selected:bg-app-accent tw:enabled:hover:bg-app-hover tw:disabled:cursor-default tw:disabled:line-through tw:disabled:opacity-55 tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-1',
                          // The SCSS gave disabled > selected > outside > base precedence for the
                          // day text colour. Tailwind emits variant utilities in a fixed order that
                          // cannot reproduce it, so the winning tone is picked here instead.
                          unavailable
                            ? 'tw:text-app-text-disabled'
                            : selected
                              ? 'tw:text-app-on-accent'
                              : currentMonth
                                ? 'tw:text-app-text'
                                : 'tw:text-app-text-meta',
                        )}
                        data-date={dateValue}
                        data-outside={!currentMonth || undefined}
                        disabled={unavailable}
                        key={dateValue}
                        role="gridcell"
                        tabIndex={focused ? 0 : -1}
                        type="button"
                        onClick={() => chooseDate(date)}
                        onFocus={() => setFocusedDate(date)}
                        onKeyDown={(event) => handleDayKeyDown(event, date)}
                      >
                        <span>{date.getDate()}</span>
                        {dateValue === todayValue ? (
                          <span className="ui-date-picker-state tw:absolute tw:right-1 tw:bottom-0 tw:type-caption">
                            {locale === 'en-US' ? 'Today' : '今'}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="ui-date-picker-footer tw:mt-2 tw:flex tw:items-center tw:justify-between tw:gap-2 tw:border-t tw:border-app-border-subtle tw:pt-2">
            <button
              className="ui-date-picker-footer-action tw:min-h-7 tw:cursor-pointer tw:rounded-control tw:border-0 tw:bg-transparent tw:px-2 tw:py-1 tw:text-app-text tw:type-control tw:outline-none tw:enabled:hover:bg-app-hover tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-1 tw:disabled:cursor-default tw:disabled:text-app-text-disabled"
              disabled={isUnavailable(today)}
              type="button"
              onClick={() => chooseDate(today)}
            >
              {t('今天')}
            </button>
            <button
              className="ui-date-picker-footer-action tw:min-h-7 tw:cursor-pointer tw:rounded-control tw:border-0 tw:bg-transparent tw:px-2 tw:py-1 tw:text-app-text tw:type-control tw:outline-none tw:enabled:hover:bg-app-hover tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-1 tw:disabled:cursor-default tw:disabled:text-app-text-disabled"
              disabled={!value}
              type="button"
              onClick={() => {
                onValueChange('')
                setOpen(false)
                requestAnimationFrame(() => triggerRef.current?.focus())
              }}
            >
              {t('清除日期')}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
