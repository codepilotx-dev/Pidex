import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarOccurrence } from '@pidex/shared/calendar'
import { desktopClient } from '../../services/desktop-client/index.js'
import { filterCalendarOccurrences, type CalendarFilter } from './CalendarDates.js'

export type { CalendarFilter } from './CalendarDates.js'

export function useCalendarController(query: string, filter: CalendarFilter) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [rawOccurrences, setRawOccurrences] = useState<readonly CalendarOccurrence[]>([])
  const [range, setRange] = useState<{ from: number; to: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const setVisibleRange = useCallback((next: { from: number; to: number }): void => {
    setRange((current) => (current?.from === next.from && current.to === next.to ? current : next))
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const current = ++sequence.current
    setLoading(true)
    setError(null)
    try {
      const capabilities = await desktopClient.getRuntimeCapabilities()
      const available = capabilities.includes('calendar.manage.v1')
      if (current !== sequence.current) return
      setSupported(available)
      if (!available || !range) {
        setLoading(false)
        return
      }
      const result = await desktopClient.listCalendarOccurrences({
        ...range,
        timeZone,
      })
      if (current !== sequence.current) return
      setRawOccurrences(result.occurrences)
      setTruncated(result.truncated)
      setHasLoaded(true)
      setLoading(false)
    } catch (cause) {
      if (current !== sequence.current) return
      setLoading(false)
      setError(cause instanceof Error ? cause.message : '无法载入任务日历')
    }
  }, [range, timeZone])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(
    () =>
      desktopClient.subscribeAgentEventEnvelopes({ liveEventTypes: [] }, (events) => {
        if (
          events.some(
            (event) =>
              event.type === 'automation/changed' ||
              event.type === 'automation/runChanged' ||
              event.type === 'scheduled-task/changed' ||
              event.type === 'schedule-plan/changed',
          )
        )
          void refresh()
      }),
    [refresh],
  )

  return {
    supported,
    hasLoaded,
    initialLoading: loading && !hasLoaded,
    refreshing: loading && hasLoaded,
    error,
    truncated,
    occurrences: useMemo(
      () => filterCalendarOccurrences(rawOccurrences, query, filter),
      [filter, query, rawOccurrences],
    ),
    refresh,
    setRange: setVisibleRange,
  }
}
