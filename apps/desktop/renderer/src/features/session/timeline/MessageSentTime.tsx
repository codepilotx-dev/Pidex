import React from 'react'

export function formatMessageSentTime(sentAt: number, now = Date.now()): string | null {
  if (!Number.isFinite(sentAt) || !Number.isFinite(new Date(sentAt).getTime())) return null
  const date = new Date(sentAt)
  const today = new Date(now)
  const days =
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
    86_400_000
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(days === 0
      ? {}
      : days < 0 && days > -7
        ? { weekday: 'long' }
        : { month: 'short', day: 'numeric' }),
  }).format(date)
}

export function MessageSentTime({ sentAt }: { sentAt: number }): React.ReactNode {
  const label = formatMessageSentTime(sentAt)
  return label === null ? null : (
    <time
      dateTime={new Date(sentAt).toISOString()}
      className="tw:shrink-0 tw:text-app-text-meta tw:type-caption"
    >
      {label}
    </time>
  )
}
