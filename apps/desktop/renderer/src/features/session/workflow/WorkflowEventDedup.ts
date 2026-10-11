import type { DesktopWorkflowEvent } from '../../../../shared/Types.js'

const MAX_WORKFLOW_EVENTS = 100

export function workflowEventKey(event: DesktopWorkflowEvent): string {
  if (event.eventId) return `event:${event.eventId}`
  const turnId = 'turnId' in event ? event.turnId : 'thread'
  const itemId = 'item' in event ? event.item.id : 'no-item'
  return ['fallback', event.threadId, turnId, event.type, event.createdAt, itemId].join(':')
}

export function appendUniqueWorkflowEvent(
  events: DesktopWorkflowEvent[],
  event: DesktopWorkflowEvent,
): DesktopWorkflowEvent[] {
  const key = workflowEventKey(event)
  if (events.some((existing) => workflowEventKey(existing) === key)) {
    return events
  }
  return [...events, event].slice(-MAX_WORKFLOW_EVENTS)
}

export function dedupeWorkflowEvents(events: DesktopWorkflowEvent[]): DesktopWorkflowEvent[] {
  const seen = new Set<string>()
  const uniqueEvents: DesktopWorkflowEvent[] = []
  for (const event of events) {
    const key = workflowEventKey(event)
    if (seen.has(key)) continue
    seen.add(key)
    uniqueEvents.push(event)
  }
  return uniqueEvents
}
