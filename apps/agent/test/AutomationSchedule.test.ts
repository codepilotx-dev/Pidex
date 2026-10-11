import { describe, expect, test } from 'bun:test'
import { AgentError } from '../src/Domain'
import {
  automationOccurrencesBetween,
  canonicalizeAutomationSchedule,
  nextAutomationOccurrence,
  previewAutomationSchedule,
} from '../src/automation/Schedule'

describe('automation schedule', () => {
  test('规范化预设和 custom RRULE', () => {
    expect(canonicalizeAutomationSchedule({ mode: 'hourly', intervalMinutes: 30 })).toBe(
      'FREQ=MINUTELY;INTERVAL=30;BYSECOND=0',
    )
    expect(
      canonicalizeAutomationSchedule({
        mode: 'weekly',
        weekdays: ['FR', 'MO', 'FR'],
        time: '09:15',
      }),
    ).toBe('FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=15;BYSECOND=0')
    expect(
      canonicalizeAutomationSchedule({ mode: 'custom', rrule: 'freq=daily;byhour=8;byminute=5' }),
    ).toContain('FREQ=DAILY')
  })

  test('IANA 时区在 DST 切换后仍保持墙上时间', () => {
    const schedule = { mode: 'daily', time: '09:00' } as const
    const before = nextAutomationOccurrence(
      schedule,
      'America/New_York',
      Date.parse('2026-03-07T15:00:00Z'),
    )
    const after = nextAutomationOccurrence(schedule, 'America/New_York', before!)
    expect(new Date(before!).toISOString()).toBe('2026-03-08T13:00:00.000Z')
    expect(new Date(after!).toISOString()).toBe('2026-03-09T13:00:00.000Z')
  })

  test('按闭区间投影日历 occurrence，并限制返回数量', () => {
    const occurrences = automationOccurrencesBetween(
      { mode: 'daily', time: '09:00' },
      'Asia/Shanghai',
      Date.parse('2026-09-01T00:00:00+08:00'),
      Date.parse('2026-09-05T23:59:59+08:00'),
      3,
    )
    expect(occurrences.map((value) => new Date(value).toISOString())).toEqual([
      '2026-09-01T01:00:00.000Z',
      '2026-09-02T01:00:00.000Z',
      '2026-09-03T01:00:00.000Z',
    ])
  })

  test('拒绝有限规则与无效时区', () => {
    expect(() =>
      previewAutomationSchedule(
        { mode: 'custom', rrule: 'FREQ=DAILY;COUNT=2' },
        'Asia/Shanghai',
        0,
      ),
    ).toThrow(AgentError)
    try {
      previewAutomationSchedule({ mode: 'daily', time: '09:00' }, 'Mars/Olympus', 0)
    } catch (cause) {
      expect(cause).toBeInstanceOf(AgentError)
      expect((cause as AgentError).code).toBe('INVALID_REQUEST')
    }
  })
})
