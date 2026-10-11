import { deriveWorkflowSessionState } from '../../../../shared/WorkflowReducer.js'
import type { DesktopPermissionRequest, DesktopWorkflowEvent } from '../../../../shared/Types.js'
import type { SessionViewState, ToolLogEntry } from '../../../UiTypes.js'
import { dedupeWorkflowEvents } from './WorkflowEventDedup.js'

export type WorkflowViewPatch = Pick<
  SessionViewState,
  'workflowEvents' | 'pendingPermissions' | 'toolLog'
>

export function deriveWorkflowViewPatch(
  workflowEvents: DesktopWorkflowEvent[],
  currentView: SessionViewState,
  threadId?: string | null,
): WorkflowViewPatch {
  const uniqueWorkflowEvents = dedupeWorkflowEvents(workflowEvents)
  const derived = deriveWorkflowSessionState(uniqueWorkflowEvents, threadId)
  const hasPermissionEvents = uniqueWorkflowEvents.some(
    (event) => isThreadItemEvent(event, threadId) && event.item.type === 'permission_request',
  )
  const hasToolEvents = uniqueWorkflowEvents.some(
    (event) =>
      isThreadItemEvent(event, threadId) &&
      (event.item.type === 'tool_call' || event.item.type === 'tool_result'),
  )

  // Compute completed permission request IDs directly from workflow events,
  // so this logic does not depend on the core package's return value.
  const completedPermissionRequestIds = new Set<string>(
    uniqueWorkflowEvents
      .filter(
        (event): event is ThreadItemEvent =>
          isThreadItemEvent(event, threadId) &&
          event.item.type === 'permission_request' &&
          event.item.status !== 'in_progress',
      )
      .map((event) => event.item.request!.requestId),
  )

  // Merge pending permissions: prefer workflow-derived results for items that
  // have completed permission_request events in the workflow; keep any real
  // pending requests from currentView that are NOT yet resolved in workflow.
  const mergedPending = hasPermissionEvents
    ? mergePendingPermissions(
        currentView.pendingPermissions,
        derived.pendingPermissions,
        completedPermissionRequestIds,
      )
    : currentView.pendingPermissions

  return {
    workflowEvents: uniqueWorkflowEvents,
    pendingPermissions: mergedPending,
    toolLog: hasToolEvents
      ? workflowToolRunsToToolLog(derived.toolRuns, currentView.toolLog)
      : currentView.toolLog,
  }
}

/**
 * Merge real pending permissions from currentView with workflow-derived ones.
 *
 * - Any request that appears in `completedIds` (workflow has a completed
 *   permission_request or decision event) is dropped.
 * - Any request from `derived` (still in_progress in workflow) is kept.
 * - Any request in `currentView` that is NOT in `completedIds` is kept
 *   (it may be a real pending request not yet reflected in workflow events).
 */
function mergePendingPermissions(
  currentPending: DesktopPermissionRequest[],
  derivedPending: DesktopPermissionRequest[],
  completedIds: Set<string>,
): DesktopPermissionRequest[] {
  const seen = new Set<string>()
  const result: DesktopPermissionRequest[] = []

  // First, add derived pending (in_progress in workflow)
  for (const req of derivedPending) {
    if (!seen.has(req.requestId)) {
      seen.add(req.requestId)
      result.push(req)
    }
  }

  // Then, keep current pending requests that are not completed in workflow
  for (const req of currentPending) {
    if (!seen.has(req.requestId) && !completedIds.has(req.requestId)) {
      seen.add(req.requestId)
      result.push(req)
    }
  }

  return result
}

function workflowToolRunsToToolLog(
  toolRuns: ReturnType<typeof deriveWorkflowSessionState>['toolRuns'],
  currentToolLog: ToolLogEntry[],
): ToolLogEntry[] {
  const expandedById = new Map(currentToolLog.map((entry) => [entry.id, entry.expanded] as const))
  const chronologicalEntries: ToolLogEntry[] = []

  for (const run of toolRuns) {
    if (run.callContent) {
      const id = workflowToolLogId('start', run.toolUseId)
      chronologicalEntries.push({
        id,
        toolName: run.toolName,
        summary: run.callContent,
        kind: 'start',
        expanded: expandedById.get(id) ?? false,
        createdAt: formatToolLogTime(run.callCreatedAt),
      })
    }
    if (run.resultContent) {
      const id = workflowToolLogId('result', run.toolUseId)
      chronologicalEntries.push({
        id,
        toolName: run.toolName,
        summary: run.resultContent,
        kind: 'result',
        isError: run.isError,
        expanded: expandedById.get(id) ?? run.isError,
        createdAt: formatToolLogTime(run.resultCreatedAt ?? run.callCreatedAt),
      })
    }
  }

  return chronologicalEntries.reverse()
}

function workflowToolLogId(kind: 'start' | 'result', toolUseId: string): string {
  return `workflow-tool-${kind}-${toolUseId}`
}

function formatToolLogTime(value: string | undefined): string {
  if (!value) return new Date().toLocaleTimeString()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString()
}

type ThreadItemEvent = DesktopWorkflowEvent & {
  type: 'item.started' | 'item.updated' | 'item.completed'
  item: {
    type: string
    status?: string
    request?: { requestId: string }
    toolName?: string
  }
}

function isThreadItemEvent(
  event: DesktopWorkflowEvent,
  threadId: string | null | undefined,
): event is ThreadItemEvent {
  return isThreadEvent(event, threadId) && 'item' in event
}

function isThreadEvent(event: DesktopWorkflowEvent, threadId: string | null | undefined): boolean {
  return !threadId || event.threadId === threadId
}
