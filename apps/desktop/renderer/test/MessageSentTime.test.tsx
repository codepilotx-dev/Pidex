import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  formatMessageSentTime,
  MessageSentTime,
} from '../src/features/session/timeline/MessageSentTime.js'

test('message time uses local day boundaries and retains the historical instant', () => {
  const now = new Date(2026, 9, 15, 12).getTime()
  const sameDay = new Date(2026, 9, 15, 9, 5).getTime()
  expect(formatMessageSentTime(sameDay, now)).toBe(
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(sameDay),
  )
  const previousDay = new Date(2026, 9, 14, 9, 5).getTime()
  expect(formatMessageSentTime(previousDay, now)).toBe(
    new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      weekday: 'long',
    }).format(previousDay),
  )
  const old = new Date(2025, 3, 2, 9, 5).getTime()
  expect(formatMessageSentTime(old, now)).toBe(
    new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    }).format(old),
  )
  expect(renderToStaticMarkup(<MessageSentTime sentAt={old} />)).toContain(
    new Date(old).toISOString(),
  )
  expect(renderToStaticMarkup(<MessageSentTime sentAt={NaN} />)).toBe('')
})
