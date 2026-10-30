import type { ThreadContextState } from '@pidex/shared/thread'
import { matchPermissionPreset, permissionConfigForPreset } from '@pidex/shared/thread'
import type {
  ApprovalRequest,
  Input,
  Item,
  PermissionConfig,
  Project,
  QuestionItem,
  ThreadListItem,
  ThreadSnapshot,
  ThreadWorkspace,
  Turn,
} from '@pidex/shared/thread'
import type { AgentNotification } from './AgentRpcClient.js'
import { collaborationModeFromPlanModeActive } from '../shims/core/agent/SessionContract.js'
import type {
  DesktopAgentEvent,
  DesktopContextUsage,
  DesktopPermissionMode,
  DesktopQueuedFollowUp,
  DesktopQueuePauseReason,
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionListItem,
  DesktopSessionSnapshot,
  DesktopSessionStatus,
  DesktopToolLogEntry,
  DesktopWorkspace,
} from '../../shared/Types.js'

export const AGENT_QUESTION_REQUEST_ID_PREFIX = 'question:'

export function agentQuestionRequestId(questionId: string): string {
  return `${AGENT_QUESTION_REQUEST_ID_PREFIX}${questionId}`
}

export function agentQuestionIdFromRequestId(requestId: string): string | null {
  return requestId.startsWith(AGENT_QUESTION_REQUEST_ID_PREFIX)
    ? requestId.slice(AGENT_QUESTION_REQUEST_ID_PREFIX.length)
    : null
}

/** Generates the stored config from the shared preset catalog; custom keeps `current`. */
export function desktopPermissionModeToPermissionConfig(
  mode: DesktopPermissionMode | undefined,
  current?: PermissionConfig,
): PermissionConfig {
  return permissionConfigForPreset(mode ?? 'default', current)
}

export function agentTurnStatusToDesktopStatus(
  status: Turn['status'] | ThreadListItem['latestTurnStatus'] | null | undefined,
): DesktopSessionStatus {
  if (!status) return 'idle'
  if (status === 'queued') return 'queued'
  if (status === 'running') return 'running'
  if (status.startsWith('waiting-')) return 'waiting'
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'error'
  if (status === 'interrupted' || status === 'stopped') return 'interrupted'
  if (status === 'cancelled') return 'cancelled'
  return 'idle'
}

export function agentThreadListItemToDesktop(
  thread: ThreadListItem,
  project?: Project | null,
): DesktopSessionListItem {
  const workspace = threadWorkspaceToDesktopWorkspace(thread.workspace, project)
  const standalone = thread.projectID === null
  const planModeActive = thread.settings.taskMode === 'plan'
  const grillModeActive = thread.settings.taskMode === 'grill'
  return {
    id: thread.id,
    projectId: thread.projectID,
    workflowId: thread.workflowId ?? thread.sessionGroupId ?? null,
    executionEnvironment: thread.executionEnvironment ?? null,
    sessionGroupId: thread.sessionGroupId ?? null,
    sessionName: thread.title || null,
    customTitle: null,
    aiTitle: null,
    preview: thread.preview ?? null,
    firstPrompt: thread.firstUserMessage ?? thread.preview,
    workspaceName: workspace.name,
    workspacePath: workspace.path,
    gitBranch: thread.gitBranch,
    creationSurface: thread.creationSurface,
    storageSource: thread.storageSource,
    hasScheduledRun: thread.hasScheduledRun,
    isScheduledSession: thread.isScheduledSession,
    isFork: thread.isFork,
    standalone,
    archivedAt: isoOrNull(thread.archivedAt),
    permissionMode: permissionModeFromPermissionConfig(thread.settings.permissionConfig),
    collaborationMode: collaborationModeFromPlanModeActive(planModeActive),
    planModeActive,
    grillModeActive,
    model: null,
    reviewModel: null,
    thinkingMode: 'default',
    hasSystemPrompt: false,
    hasAppendSystemPrompt: false,
    additionalDirectoryCount: 0,
    status: agentTurnStatusToDesktopStatus(thread.latestTurnStatus),
    unreadAt: isoOrNull(thread.unreadAt),
    latestTurnStatus: thread.latestTurnStatus,
    pendingPlanApproval: thread.pendingPlanApproval === true,
    lastMessageAt: isoOrNull(thread.updatedAt),
    createdAt: iso(thread.createdAt),
  }
}

export function agentThreadListItemToDesktopSnapshot(
  thread: ThreadListItem,
  project?: Project | null,
): DesktopSessionSnapshot {
  const item = agentThreadListItemToDesktop(thread, project)
  return {
    item,
    workspace: threadWorkspaceToDesktopWorkspace(thread.workspace, project),
    settings: {
      permissionConfig: thread.settings.permissionConfig,
      collaborationMode: item.collaborationMode,
      planModeActive: item.planModeActive,
      grillModeActive: item.grillModeActive,
      thinkingMode: 'default',
      sessionName: item.sessionName ?? undefined,
      additionalDirectories: [],
    },
    view: { messages: [], toolLog: [], pendingPermissions: [], contextUsage: null },
    events: [],
    eventModelVersion: 1,
    workflowEvents: [],
    reviewComments: [],
    updatedAt: item.lastMessageAt ?? item.createdAt,
  }
}

export function agentThreadSnapshotToDesktop(
  snapshot: ThreadSnapshot,
  project?: Project | null,
): DesktopSessionSnapshot {
  const latestTurn = latestDisplayTurn(snapshot.turns)
  const latestModel = [...snapshot.turns].reverse().find((turn) => turn.status !== 'queued')?.model
  const variant = latestModel?.variant
  const thinkingMode =
    variant === 'enabled'
      ? 'enabled'
      : variant === 'adaptive'
        ? 'adaptive'
        : variant === 'disabled'
          ? 'disabled'
          : 'default'
  const latestInput = snapshot.inputs.at(-1) ?? null
  const workspace = threadWorkspaceToDesktopWorkspace(snapshot.thread.workspace, project)
  const standalone = snapshot.thread.projectID === null
  const planModeActive = snapshot.thread.settings.taskMode === 'plan'
  const grillModeActive = snapshot.thread.settings.taskMode === 'grill'
  const events = snapshotEvents(snapshot)
  const latestMessage = events
    .slice()
    .reverse()
    .find(
      (e) =>
        (e.type === 'message' || e.type === 'assistant_delta') &&
        typeof e.content === 'string' &&
        e.content.trim(),
    )
  const preview =
    latestMessage?.content?.slice(0, 180) ?? latestInput?.content?.slice(0, 180) ?? null
  const item: DesktopSessionListItem = {
    id: snapshot.thread.id,
    projectId: snapshot.thread.projectID,
    workflowId: snapshot.thread.workflowId ?? snapshot.thread.sessionGroupId ?? null,
    executionEnvironment: snapshot.thread.executionEnvironment ?? null,
    sessionGroupId: snapshot.thread.sessionGroupId ?? null,
    sessionName: snapshot.thread.title || null,
    customTitle: null,
    aiTitle: null,
    preview,
    firstPrompt: snapshot.inputs[0]?.content ?? null,
    workspaceName: workspace.name,
    workspacePath: workspace.path,
    gitBranch: snapshot.thread.gitBranch,
    creationSurface: snapshot.thread.creationSurface,
    hasScheduledRun: snapshot.thread.hasScheduledRun,
    isScheduledSession: snapshot.thread.isScheduledSession,
    isFork: snapshot.thread.isFork,
    standalone,
    archivedAt: isoOrNull(snapshot.thread.archivedAt),
    permissionMode: permissionModeFromPermissionConfig(snapshot.thread.settings.permissionConfig),
    collaborationMode: collaborationModeFromPlanModeActive(planModeActive),
    planModeActive,
    grillModeActive,
    providerID: latestModel?.providerID,
    model: latestModel?.id ?? null,
    reviewModel: null,
    thinkingMode,
    hasSystemPrompt: false,
    hasAppendSystemPrompt: false,
    additionalDirectoryCount: 0,
    status: agentTurnStatusToDesktopStatus(latestTurn?.status),
    latestTurnStatus: latestTurn?.status ?? null,
    pendingPlanApproval: snapshot.pendingPlanApproval?.status === 'pending',
    threadGoal: snapshot.goal,
    lastMessageAt: iso(snapshot.thread.updatedAt),
    createdAt: iso(snapshot.thread.createdAt),
  }
  return {
    item,
    workspace,
    settings: {
      permissionConfig: snapshot.thread.settings.permissionConfig,
      collaborationMode: item.collaborationMode,
      planModeActive,
      grillModeActive,
      providerID: latestModel?.providerID,
      model: latestModel?.id,
      variant,
      thinkingMode,
      sessionName: item.sessionName ?? undefined,
      additionalDirectories: [],
    },
    view: {
      messages: events
        .filter((event) => event.type === 'message' || event.type === 'assistant_delta')
        .map((event) => ({
          id: event.id,
          role: event.role ?? 'system',
          text: event.content ?? '',
          createdAt: event.createdAt,
          streaming: event.type === 'assistant_delta',
          metadata: event.metadata,
        })),
      toolLog: snapshot.items.flatMap(itemToToolLog),
      pendingPermissions: pendingPermissionRequests(events),
      contextUsage: contextStateUsage(
        snapshot.context,
        latestItemContextUsage(
          snapshot.items,
          latestTurn?.model.providerID ?? latestInput?.model.providerID,
          latestTurn?.model.id ?? latestInput?.model.id,
        ),
      ),
    },
    events,
    eventModelVersion: 1,
    workflowEvents: [],
    reviewComments: [],
    queuedFollowUps: agentQueuedFollowUpsToDesktop(snapshot),
    queuePauseReason: queuePauseReasonFromSnapshot(snapshot),
    queueVersion: queueVersionFromSnapshot(snapshot),
    updatedAt: iso(snapshot.thread.updatedAt),
  }
}

function latestDisplayTurn(turns: ThreadSnapshot['turns']): Turn | null {
  const active = turns
    .filter((turn) => turn.status === 'running' || turn.status.startsWith('waiting-'))
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))[0]
  if (active) return active
  return [...turns].reverse().find((turn) => turn.status !== 'queued') ?? turns.at(-1) ?? null
}

export function agentQueuedFollowUpsToDesktop(snapshot: ThreadSnapshot): DesktopQueuedFollowUp[] {
  const queuedInputs = new Map(
    snapshot.inputs
      .filter((input) => input.state === 'queued')
      .map((input) => [input.id, input] as const),
  )
  const orderedInputIds = snapshot.turns
    .filter((turn) => turn.status === 'queued')
    .sort(
      (left, right) =>
        (left.queuePosition ?? Number.MAX_SAFE_INTEGER) -
        (right.queuePosition ?? Number.MAX_SAFE_INTEGER),
    )
    .map((turn) => turn.sourceInputID)
  const seen = new Set(orderedInputIds)
  const remainingInputIds = [...queuedInputs.values()]
    .filter((input) => !seen.has(input.id))
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((input) => input.id)

  return [...orderedInputIds, ...remainingInputIds].flatMap((inputId) => {
    const input = queuedInputs.get(inputId)
    if (!input) return []
    return [
      {
        id: input.id,
        input: { text: input.content, ...(input.skills ? { skills: input.skills } : {}) },
        previewText: [
          ...(input.skills?.map((skill) => `$${skill.name}`) ?? []),
          input.content,
        ].join(' '),
        createdAt: iso(input.createdAt),
      },
    ]
  })
}

function queuePauseReasonFromSnapshot(snapshot: ThreadSnapshot): DesktopQueuePauseReason | null {
  const value = record(record(snapshot).queue).pauseReason
  return value === 'interrupted' || value === 'turn_failed' ? value : null
}

function queueVersionFromSnapshot(snapshot: ThreadSnapshot): number | undefined {
  const value = record(record(snapshot).queue).version
  return typeof value === 'number' ? value : undefined
}

export function agentEventsFromNotification(notification: AgentNotification): DesktopAgentEvent[] {
  if (notification.method === 'heartbeat') return []
  const params = record(notification.params)
  const threadId = stringValue(params.threadId)
  if (!threadId) return []
  const createdAt = iso(eventTime(params))
  const base = { sessionId: threadId, createdAt }

  if (notification.method === 'turn/completed') return [{ ...base, type: 'done' }]
  if (notification.method === 'turn/failed') {
    return [{ ...base, type: 'error', message: stringValue(params.message) || 'Agent turn failed' }]
  }
  if (notification.method === 'turn/interrupted') {
    return [{ ...base, type: 'status', status: 'interrupted' }]
  }
  if (notification.method === 'turn/queued') return [{ ...base, type: 'status', status: 'queued' }]
  if (notification.method === 'turn/started')
    return [{ ...base, type: 'status', status: 'running' }]
  if (notification.method === 'turn/statusChanged') {
    const status = statusFromNotification(params)
    return status ? [{ ...base, type: 'status', status }] : []
  }
  if (
    notification.method === 'item/started' ||
    notification.method === 'item/completed' ||
    notification.method === 'item/agentMessage/phaseChanged'
  ) {
    return isItem(params.item) ? itemToAgentEvents(threadId, params.item) : []
  }
  if (notification.method === 'item/agentMessage/delta') {
    return [
      {
        ...base,
        type: 'partial_message',
        role: 'assistant',
        text: stringValue(params.delta),
        metadata: liveItemMetadata(params, 'text'),
      },
    ]
  }
  if (
    notification.method === 'reasoning/textDelta' ||
    notification.method === 'reasoning/summaryTextDelta'
  ) {
    return [
      {
        ...base,
        type: 'partial_message',
        role: 'assistant',
        text: stringValue(params.delta),
        metadata: liveItemMetadata(params, 'reasoning'),
      },
    ]
  }
  if (notification.method === 'plan/delta') {
    return [
      {
        ...base,
        type: 'proposed_plan',
        text: stringValue(params.delta),
        streaming: true,
        metadata: liveItemMetadata(params, 'plan'),
      },
    ]
  }
  if (notification.method === 'tool/callStarted') {
    const item = record(params.item)
    return [
      {
        ...base,
        type: 'tool_start',
        toolName: stringValue(item.tool) || stringValue(params.tool),
        toolUseId:
          stringValue(item.callID) ||
          stringValue(item.id) ||
          stringValue(params.itemId) ||
          stringValue(params.callID),
        summary:
          stringValue(item.title) || stringValue(params.inputSummary) || stringValue(params.title),
        metadata: { itemId: stringValue(item.id) || stringValue(params.itemId) },
      },
    ]
  }
  if (notification.method === 'tool/outputDelta') {
    return [
      {
        ...base,
        type: 'tool_output_delta',
        toolName: stringValue(params.tool) || 'tool',
        toolUseId: stringValue(params.callID) || stringValue(params.itemId),
        delta: stringValue(params.delta),
        metadata: { itemId: stringValue(params.itemId) },
      },
    ]
  }
  if (notification.method === 'tool/callCompleted' || notification.method === 'tool/error') {
    const item = record(params.item)
    const error = record(params.error)
    return [
      {
        ...base,
        type: 'tool_result',
        toolName: stringValue(item.tool) || stringValue(params.tool),
        toolUseId:
          stringValue(item.callID) ||
          stringValue(item.id) ||
          stringValue(params.itemId) ||
          stringValue(params.callID),
        summary:
          stringValue(item.error) ||
          stringValue(item.output) ||
          stringValue(error.message) ||
          stringValue(params.output) ||
          stringValue(params.message) ||
          stringValue(item.title),
        isError: notification.method === 'tool/error' || item.state === 'error',
        metadata: { itemId: stringValue(item.id) || stringValue(params.itemId) },
      },
    ]
  }
  if (notification.method === 'approval/requested') {
    return [{ ...base, type: 'permission_request', request: approvalParamsToRequest(params) }]
  }
  if (notification.method === 'mcp/elicitationRequested') {
    return [
      {
        ...base,
        type: 'permission_request',
        request: {
          requestId: String(params.interactionId),
          toolUseId: String(params.toolCallId),
          toolName: 'McpElicitation',
          input: { serverName: params.server, request: params.request },
          description: 'MCP 请求输入',
          requestKind: 'tool',
        },
      },
    ]
  }
  if (notification.method === 'permission/requested') {
    return [{ ...base, type: 'permission_request', request: permissionParamsToRequest(params) }]
  }
  if (notification.method === 'question/requested') {
    return [{ ...base, type: 'permission_request', request: questionParamsToRequest(params) }]
  }
  return []
}

function snapshotEvents(snapshot: ThreadSnapshot): DesktopSessionEvent[] {
  const inputEvents = snapshot.inputs
    .filter((input) => input.state !== 'cancelled' && input.state !== 'queued')
    .map(inputToSessionEvent)
  const itemEvents = snapshot.items.flatMap((item) => itemToSessionEvents(snapshot.thread.id, item))
  const approvalEvents = snapshot.approvals
    .filter((approval) => approval.status === 'pending')
    .map((approval) => ({
      id: approval.id,
      sessionId: snapshot.thread.id,
      type: 'permission_request',
      content: approval.reason,
      createdAt: iso(approval.createdAt),
      metadata: { request: approvalToRequest(approval), agentId: approval.agentId },
    }))
  return [...inputEvents, ...itemEvents, ...approvalEvents].sort(
    (left, right) => timestampOf(left.createdAt) - timestampOf(right.createdAt),
  )
}

function inputToSessionEvent(input: Input): DesktopSessionEvent {
  return {
    id: input.id,
    sessionId: input.threadId,
    type: 'message',
    role: 'user',
    content: [...(input.skills?.map((skill) => `$${skill.name}`) ?? []), input.content]
      .filter(Boolean)
      .join('\n\n'),
    createdAt: iso(input.createdAt),
    metadata: {
      inputID: input.id,
      turnId: input.turnId,
      state: input.state,
      delivery: input.delivery,
    },
  }
}

function itemToSessionEvents(threadId: string, item: Item): DesktopSessionEvent[] {
  if (item.type === 'text' || item.type === 'reasoning') {
    if (!item.text.trim()) return []
    return [
      {
        id: item.id,
        sessionId: threadId,
        type: item.status === 'streaming' ? 'assistant_delta' : 'message',
        role: 'assistant',
        content: item.text,
        createdAt: iso(item.createdAt),
        metadata: {
          itemId: item.id,
          turnId: item.turnId,
          agentId: item.agentId,
          ...(item.type === 'reasoning' ? { kind: 'reasoning' } : {}),
        },
      },
    ]
  }
  if (item.type === 'tool') return toolToSessionEvents(threadId, item)
  if (item.type === 'activity') return activityToSessionEvents(threadId, item)
  if (item.type === 'plan') {
    return [
      {
        id: item.id,
        sessionId: threadId,
        type: 'proposed_plan',
        role: 'assistant',
        content: item.markdown,
        createdAt: iso(item.createdAt),
        metadata: {
          itemId: item.id,
          turnId: item.turnId,
          agentId: item.agentId,
          title: item.title,
          status: item.status,
          streaming: item.status === 'streaming',
        },
      },
    ]
  }
  if (item.type === 'question' && item.status === 'pending') {
    return [
      {
        id: item.id,
        sessionId: threadId,
        type: 'permission_request',
        content: item.prompt,
        createdAt: iso(item.createdAt),
        metadata: { request: questionToRequest(item, threadId), agentId: item.agentId },
      },
    ]
  }
  if (item.type === 'patch') {
    return [
      {
        id: item.id,
        sessionId: threadId,
        type: 'file_patch',
        content: `已编辑 ${item.files.length} 个文件`,
        createdAt: iso(item.createdAt),
        metadata: {
          files: item.files,
          patch: item.files
            .map((file) => file.patch)
            .filter(Boolean)
            .join('\n'),
          additions: item.totalAdditions,
          deletions: item.totalDeletions,
          turnScoped: true,
          agentId: item.agentId,
        },
      },
    ]
  }
  return []
}

function toolToSessionEvents(
  threadId: string,
  item: Extract<Item, { type: 'tool' }>,
): DesktopSessionEvent[] {
  const events: DesktopSessionEvent[] = [
    {
      id: `${item.id}:call`,
      sessionId: threadId,
      type: 'tool_call',
      content: item.command ?? item.title,
      createdAt: iso(item.startedAt ?? item.createdAt),
      metadata: {
        toolName: item.tool,
        toolUseId: item.callID,
        input: item.input,
        command: item.command,
        agentId: item.agentId,
      },
    },
  ]
  if (item.state === 'waiting-permission') {
    events.push({
      id: `${item.id}:permission`,
      sessionId: threadId,
      type: 'permission_request',
      content: item.title,
      createdAt: iso(item.createdAt),
      metadata: { request: toolToRequest(item), agentId: item.agentId },
    })
  }
  if (!['pending', 'running', 'waiting-permission'].includes(item.state)) {
    events.push({
      id: `${item.id}:result`,
      sessionId: threadId,
      type: 'tool_result',
      content: item.error ?? item.output ?? item.title,
      createdAt: iso(item.finishedAt ?? item.createdAt),
      metadata: {
        toolName: item.tool,
        toolUseId: item.callID,
        isError: item.state === 'error',
        output: item.output,
        error: item.error,
        agentId: item.agentId,
      },
    })
  }
  return events
}

function activityToSessionEvents(
  threadId: string,
  item: Extract<Item, { type: 'activity' }>,
): DesktopSessionEvent[] {
  return (item.commands ?? []).flatMap((command, index) => {
    const toolUseId = `${item.id}:${index}`
    const events: DesktopSessionEvent[] = [
      {
        id: `${toolUseId}:call`,
        sessionId: threadId,
        type: 'tool_call',
        content: command.command,
        createdAt: iso(item.createdAt),
        metadata: {
          toolName: item.activity === 'build' ? 'Shell' : item.title,
          toolUseId,
          activity: item.activity,
          title: item.title,
          agentId: item.agentId,
        },
      },
    ]
    if (command.status !== 'running')
      events.push({
        id: `${toolUseId}:result`,
        sessionId: threadId,
        type: 'tool_result',
        content: command.output,
        createdAt: iso(item.createdAt),
        metadata: {
          toolUseId,
          isError: command.status === 'error',
          truncated: command.truncated,
          agentId: item.agentId,
        },
      })
    return events
  })
}

function itemToAgentEvents(threadId: string, item: Item): DesktopAgentEvent[] {
  const createdAt = iso(item.createdAt)
  if (item.type === 'text' || item.type === 'reasoning') {
    const message = {
      type: item.status === 'streaming' ? 'partial_message' : 'message',
      sessionId: threadId,
      role: 'assistant',
      text: item.text,
      createdAt,
      metadata: { itemId: item.id, turnId: item.turnId, agentId: item.agentId, kind: item.type },
    }
    if (item.type !== 'text' || item.status !== 'completed') return [message]
    const usage = itemContextUsage(item)
    return usage
      ? [message, { type: 'context_usage', sessionId: threadId, usage, createdAt }]
      : [message]
  }
  if (item.type === 'tool') {
    const start = {
      type: 'tool_start',
      sessionId: threadId,
      toolName: item.tool,
      toolUseId: item.callID,
      summary: item.title,
      createdAt: iso(item.startedAt ?? item.createdAt),
      metadata: { itemId: item.id },
    }
    if (['pending', 'running', 'waiting-permission'].includes(item.state)) return [start]
    return [
      start,
      {
        type: 'tool_result',
        sessionId: threadId,
        toolName: item.tool,
        toolUseId: item.callID,
        summary: item.error ?? item.output ?? item.title,
        isError: item.state === 'error',
        createdAt: iso(item.finishedAt ?? item.createdAt),
        metadata: { itemId: item.id },
      },
    ]
  }
  if (item.type === 'plan')
    return [
      {
        type: 'proposed_plan',
        sessionId: threadId,
        text: item.markdown,
        streaming: item.status === 'streaming',
        createdAt,
        metadata: { itemId: item.id, turnId: item.turnId, agentId: item.agentId, kind: 'plan' },
      },
    ]
  if (item.type === 'patch')
    return item.files.map((file) => ({
      type: 'diff',
      sessionId: threadId,
      filePath: file.path,
      patch: file.patch ?? '',
      createdAt,
      metadata: { additions: file.additions, deletions: file.deletions, turnScoped: true },
    }))
  if (item.type === 'question' && item.status === 'pending')
    return [
      {
        type: 'permission_request',
        sessionId: threadId,
        request: questionToRequest(item, threadId),
        createdAt,
      },
    ]
  return []
}

export function contextStateUsage(
  state: ThreadContextState | null | undefined,
  fallback: DesktopContextUsage | null,
): DesktopContextUsage | null {
  if (!state?.budget)
    return state?.operation
      ? { ...(fallback ?? { usedTokens: 0 }), compactionOperation: state.operation }
      : fallback
  const budget = state.budget
  const usedPercent = Math.min(100, (budget.usedTokens / budget.contextWindowTokens) * 100)
  return {
    ...fallback,
    usedTokens: budget.usedTokens,
    contextWindow: budget.contextWindowTokens,
    remainingTokens: Math.max(0, budget.contextWindowTokens - budget.usedTokens),
    usedPercent,
    remainingPercent: 100 - usedPercent,
    percentUsed: usedPercent,
    budget,
    ...(state.operation ? { compactionOperation: state.operation } : {}),
  }
}

export function itemContextUsage(
  item: Item,
  fallbackProvider?: string,
  fallbackModel?: string,
): DesktopContextUsage | null {
  if (item.type !== 'text' || !item.usage) return null
  const value = item.usage
  const input = nonNegativeNumber(value.input) ?? 0
  const cacheRead = nonNegativeNumber(value.cacheRead) ?? 0
  const cacheWrite = nonNegativeNumber(value.cacheWrite) ?? 0
  const output = nonNegativeNumber(value.output) ?? 0
  const reasoning = nonNegativeNumber(value.reasoning) ?? 0
  const contextWindow = positiveNumber(value.contextWindow)
  if (!contextWindow) return null

  const usedTokens = input + cacheRead + cacheWrite
  const usedPercent = Math.min(100, Math.max(0, (usedTokens / contextWindow) * 100))
  const provider = stringValue(value.provider) || fallbackProvider
  const model = stringValue(value.model) || fallbackModel

  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    usedTokens,
    totalTokens: usedTokens + output,
    contextWindow,
    remainingTokens: Math.max(0, contextWindow - usedTokens),
    usedPercent,
    remainingPercent: 100 - usedPercent,
    percentUsed: usedPercent,
    promptCacheReadTokens: cacheRead,
    promptCacheWriteTokens: cacheWrite,
    promptUncachedTokens: input,
    reasoningTokens: reasoning,
    ...(value.breakdown?.length ? { breakdown: value.breakdown } : {}),
  }
}

export function latestItemContextUsage(
  items: readonly Item[],
  fallbackProvider?: string,
  fallbackModel?: string,
): DesktopContextUsage | null {
  const usage = latestRawItemContextUsage(items, fallbackProvider, fallbackModel)
  if (!usage) return null
  const averageCacheHitRate = averagePromptCacheHitRate(items)
  return averageCacheHitRate === null ? usage : { ...usage, averageCacheHitRate }
}

function latestRawItemContextUsage(
  items: readonly Item[],
  fallbackProvider?: string,
  fallbackModel?: string,
): DesktopContextUsage | null {
  let compactedTokens: number | undefined
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (
      item?.type === 'activity' &&
      item.activity === 'context-compression' &&
      item.status === 'completed'
    ) {
      compactedTokens ??= nonNegativeNumber(item.contextTokens) ?? undefined
    }
    if (!item || item.type !== 'text' || item.status !== 'completed') continue
    const usage = itemContextUsage(item, fallbackProvider, fallbackModel)
    if (!usage) continue
    if (compactedTokens === undefined) return usage
    const usedPercent = Math.min(100, (compactedTokens / usage.contextWindow) * 100)
    return {
      provider: usage.provider,
      model: usage.model,
      contextWindow: usage.contextWindow,
      usedTokens: compactedTokens,
      totalTokens: compactedTokens,
      remainingTokens: Math.max(0, usage.contextWindow - compactedTokens),
      usedPercent,
      percentUsed: usedPercent,
      remainingPercent: 100 - usedPercent,
    }
  }
  return null
}

/**
 * 会话级缓存命中率：累计 cacheRead 除以累计 prompt 侧 token。
 * 与单条 message 的口径不同，它跨所有请求，避免只看最后一条造成误判。
 */
export function averagePromptCacheHitRate(items: readonly Item[]): number | null {
  let cacheReadTokens = 0
  let promptTokens = 0
  for (const item of items) {
    if (item.type !== 'text' || !item.usage) continue
    const input = nonNegativeNumber(item.usage.input) ?? 0
    const cacheRead = nonNegativeNumber(item.usage.cacheRead) ?? 0
    const cacheWrite = nonNegativeNumber(item.usage.cacheWrite) ?? 0
    const current = input + cacheRead + cacheWrite
    if (current <= 0) continue
    cacheReadTokens += cacheRead
    promptTokens += current
  }
  return promptTokens > 0 ? cacheReadTokens / promptTokens : null
}

function itemToToolLog(item: Item): DesktopToolLogEntry[] {
  if (item.type === 'activity') {
    return (item.commands ?? []).flatMap((command, index) => [
      {
        id: `${item.id}:${index}:start`,
        kind: 'start',
        toolName: item.activity === 'build' ? 'Shell' : item.title,
        summary: command.command,
        createdAt: iso(item.createdAt),
      },
      ...(command.status === 'running'
        ? []
        : [
            {
              id: `${item.id}:${index}:result`,
              kind: 'result',
              toolName: item.title,
              summary: command.output,
              output: command.output,
              isError: command.status === 'error',
              createdAt: iso(item.createdAt),
            },
          ]),
    ])
  }
  if (item.type !== 'tool') return []
  return [
    {
      id: `${item.id}:start`,
      kind: 'start',
      toolName: item.tool,
      summary: item.title,
      input: item.input,
      createdAt: iso(item.startedAt ?? item.createdAt),
    },
    ...(['pending', 'running', 'waiting-permission'].includes(item.state)
      ? []
      : [
          {
            id: `${item.id}:result`,
            kind: 'result',
            toolName: item.tool,
            summary: item.error ?? item.output ?? item.title,
            output: item.output,
            error: item.error ?? undefined,
            isError: item.state === 'error',
            createdAt: iso(item.finishedAt ?? item.createdAt),
          },
        ]),
  ]
}

export function toolToRequest(item: Extract<Item, { type: 'tool' }>): DesktopPermissionRequest {
  return {
    requestId: item.id,
    toolName: item.tool,
    toolUseId: item.callID,
    input: record(item.input),
    description: item.title,
    requestKind: item.command ? 'shell-command' : 'tool',
  }
}

export function approvalToRequest(approval: ApprovalRequest): DesktopPermissionRequest {
  const permissionGrant = approval.permissionGrant
    ? {
        requestedPermissions: {
          readPaths: [...(approval.requestedPermissions.readPaths ?? [])],
          writePaths: [...(approval.requestedPermissions.writePaths ?? [])],
          networkDomains: [...(approval.requestedPermissions.networkDomains ?? [])],
        },
        requestedScope: approval.permissionGrant.requestedScope,
        allowedScopes: [...approval.permissionGrant.allowedScopes],
      }
    : undefined
  return {
    requestId: approval.id,
    ...(approval.grantOptions ? { grantOptions: approval.grantOptions } : {}),
    ...(approval.toolIdentity
      ? { toolIdentity: approval.toolIdentity, toolInput: approval.input }
      : {}),
    toolName: approval.tool,
    toolUseId: approval.toolCallID,
    input: {
      ...(approval.input ?? {}),
      threadId: approval.threadId,
      command: approval.command,
      paths: approval.paths,
      risk: approval.risk,
      ...(approval.affectedPaths ? { affectedPaths: approval.affectedPaths } : {}),
      ...(approval.reviewSummary ? { reviewSummary: approval.reviewSummary } : {}),
    },
    description: approval.reason,
    requestKind: permissionGrant ? 'permission-grant' : approval.command ? 'shell-command' : 'tool',
    ...(permissionGrant ? { permissionGrant } : {}),
    ...(approval.computerApp ? { computerApp: { ...approval.computerApp } } : {}),
    ...(approval.guardian ? { guardian: approval.guardian } : {}),
    ...(approval.autoReviewFallbackReason
      ? { autoReviewFallbackReason: approval.autoReviewFallbackReason }
      : {}),
  }
}

function guardianFromParams(
  params: Record<string, unknown>,
): Pick<DesktopPermissionRequest, 'guardian' | 'autoReviewFallbackReason'> {
  const guardian =
    params.guardian && typeof params.guardian === 'object' && !Array.isArray(params.guardian)
      ? (params.guardian as DesktopPermissionRequest['guardian'])
      : undefined
  const fallbackReason = stringValue(params.autoReviewFallbackReason)
  return {
    ...(guardian ? { guardian } : {}),
    ...(fallbackReason ? { autoReviewFallbackReason: fallbackReason } : {}),
  }
}

function approvalParamsToRequest(params: Record<string, unknown>): DesktopPermissionRequest {
  const originalInput = record(params.input)
  const affectedPaths = Array.isArray(params.affectedPaths) ? params.affectedPaths : undefined
  const reviewSummary =
    params.reviewSummary &&
    typeof params.reviewSummary === 'object' &&
    !Array.isArray(params.reviewSummary)
      ? params.reviewSummary
      : undefined
  const paths = Array.isArray(params.paths) ? params.paths : undefined
  const command =
    stringValue(params.command) ||
    stringValue(originalInput.command) ||
    stringValue(originalInput.cmd)
  const cwd = stringValue(params.cwd) || stringValue(originalInput.cwd)
  const input = {
    ...(affectedPaths ? {} : originalInput),
    ...(Array.isArray(originalInput.approvalFileDiffs)
      ? { approvalFileDiffs: originalInput.approvalFileDiffs }
      : {}),
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    ...(paths ? { paths } : {}),
    ...(affectedPaths ? { affectedPaths } : {}),
    ...(reviewSummary ? { reviewSummary } : {}),
  }
  return {
    requestId: stringValue(params.interactionId) || stringValue(params.id),
    ...(Array.isArray(params.grantOptions)
      ? { grantOptions: params.grantOptions as DesktopPermissionRequest['grantOptions'] }
      : {}),
    ...(params.toolIdentity
      ? {
          toolIdentity: params.toolIdentity as DesktopPermissionRequest['toolIdentity'],
          toolInput: originalInput,
        }
      : {}),
    toolName: stringValue(params.tool) || 'tool',
    toolUseId:
      stringValue(params.toolCallId) ||
      stringValue(params.toolCallID) ||
      stringValue(params.itemId),
    input,
    ...(typeof record(params.computerApp).name === 'string'
      ? {
          computerApp: {
            name: String(record(params.computerApp).name),
            allowPersistentApproval: record(params.computerApp).allowPersistentApproval === true,
          },
        }
      : {}),
    description: stringValue(params.reason) || '需要批准工具调用',
    requestKind: command ? 'shell-command' : 'tool',
    ...guardianFromParams(params),
  }
}

function permissionParamsToRequest(params: Record<string, unknown>): DesktopPermissionRequest {
  const requested = record(params.requestedPermissions)
  const requestedPermissions = {
    readPaths: stringArray(requested.readPaths),
    writePaths: stringArray(requested.writePaths),
    networkDomains: stringArray(requested.networkDomains),
  }
  const rawRequestedScope = stringValue(params.requestedScope)
  const requestedScope: 'tool-call' | 'turn' | 'session' =
    rawRequestedScope === 'tool-call' ||
    rawRequestedScope === 'turn' ||
    rawRequestedScope === 'session'
      ? rawRequestedScope
      : 'tool-call'
  const allowedScopes = stringArray(params.allowedScopes).filter(
    (scope): scope is 'tool-call' | 'turn' | 'session' =>
      scope === 'tool-call' || scope === 'turn' || scope === 'session',
  )
  return {
    requestId: stringValue(params.interactionId) || stringValue(params.id),
    toolName: stringValue(params.tool) || 'tool',
    toolUseId:
      stringValue(params.toolCallId) ||
      stringValue(params.toolCallID) ||
      stringValue(params.itemId),
    input: {
      paths: [
        ...requestedPermissions.readPaths,
        ...requestedPermissions.writePaths,
        ...requestedPermissions.networkDomains,
      ],
      risk: riskValue(params.risk),
    },
    description: stringValue(params.reason) || '需要额外权限',
    requestKind: 'permission-grant',
    ...guardianFromParams(params),
    permissionGrant: {
      requestedPermissions,
      requestedScope,
      allowedScopes: allowedScopes.length > 0 ? allowedScopes : [requestedScope],
    },
  }
}

export function questionToRequest(question: QuestionItem, threadId = ''): DesktopPermissionRequest {
  return questionParamsToRequest({
    interactionId: question.id,
    threadId,
    version: question.version,
    questions: question.questions?.length
      ? question.questions
      : [
          {
            id: question.id,
            prompt: question.prompt,
            header: '问题',
            choices: question.choices,
          },
        ],
  })
}

function questionParamsToRequest(params: Record<string, unknown>): DesktopPermissionRequest {
  const rawQuestions = Array.isArray(params.questions) ? params.questions.map(record) : []
  const first = rawQuestions[0] ?? params
  const id = stringValue(params.interactionId) || stringValue(params.id)
  const question =
    stringValue(first.prompt) ||
    stringValue(first.question) ||
    stringValue(params.question) ||
    '需要你的确认'
  const mappedQuestions = (rawQuestions.length ? rawQuestions : [first]).map((candidate, index) => {
    const choices = Array.isArray(candidate.choices) ? candidate.choices.map(record) : []
    const options = questionOptions(
      choices.map((choice, choiceIndex) => ({
        id: stringValue(choice.id) || String(choiceIndex),
        label: stringValue(choice.label) || String(choice.value ?? ''),
        description: stringValue(choice.description),
        recommended: choice.recommended === true,
      })),
    )
    return {
      id: stringValue(candidate.id) || `${id}:${index}`,
      question: stringValue(candidate.prompt) || stringValue(candidate.question) || question,
      header: stringValue(candidate.header) || '问题',
      options,
      multiSelect: typeof candidate.maxAnswers === 'number' && candidate.maxAnswers > 1,
    }
  })
  const primary = mappedQuestions[0]!
  return {
    requestId: agentQuestionRequestId(id),
    toolName: 'AskUserQuestion',
    toolUseId: id,
    input: {
      threadId: params.threadId,
      version: params.version,
      question: primary.question,
      header: primary.header,
      options: primary.options,
      questions: mappedQuestions,
    },
    description: primary.question,
    requestKind: 'tool',
  }
}

function liveItemMetadata(
  params: Record<string, unknown>,
  kind: 'text' | 'reasoning' | 'plan',
): Record<string, unknown> {
  return {
    itemId: stringValue(params.itemId),
    turnId: stringValue(params.turnId),
    agentId: stringValue(params.agentId),
    kind,
  }
}

function questionOptions(
  choices: ReadonlyArray<{ id: string; label: string; description?: string; recommended: boolean }>,
) {
  return choices.map((choice) => ({ ...choice, description: choice.description ?? '' }))
}

function pendingPermissionRequests(events: DesktopSessionEvent[]): DesktopPermissionRequest[] {
  return events
    .filter((event) => event.type === 'permission_request')
    .map((event) => event.metadata?.request)
    .filter((request): request is DesktopPermissionRequest => Boolean(request))
}

function statusFromNotification(params: Record<string, unknown>): DesktopSessionStatus | null {
  const status = stringValue(params.status)
  if (status) return agentTurnStatusToDesktopStatus(status as Turn['status'])
  const state = stringValue(params.state)
  if (state === 'provider-error') return 'error'
  if (state) return 'running'
  return null
}

function isItem(value: unknown): value is Item {
  const item = record(value)
  return (
    typeof item.id === 'string' &&
    typeof item.turnId === 'string' &&
    typeof item.agentId === 'string' &&
    typeof item.type === 'string'
  )
}

function eventTime(params: Record<string, unknown>): number {
  if (typeof params.createdAt === 'number') return params.createdAt
  const item = record(params.item)
  if (typeof item.createdAt === 'number') return item.createdAt
  const turn = record(params.turn)
  if (typeof turn.finishedAt === 'number') return turn.finishedAt
  if (typeof params.finishedAt === 'number') return params.finishedAt
  return Date.now()
}

export function permissionModeFromPermissionConfig(
  config: PermissionConfig | undefined,
): DesktopPermissionMode {
  // Unknown configs stay custom; preset identity always comes from the shared catalog.
  return config ? matchPermissionPreset(config) : 'custom'
}

export function projectToDesktopWorkspace(
  project: Project | null | undefined,
  projectID: string | null,
): DesktopWorkspace {
  if (project) {
    const value = project as Project & {
      primaryFolderId?: string
      folders?: Array<{
        id: string
        name: string
        path: string
        role: 'primary' | 'secondary'
        availability: 'available' | 'missing'
        order: number
        createdAt: number
        updatedAt: number
      }>
      rootPath?: string
      settings?: {
        defaultModel: import('@pidex/shared').ModelRef | null
        instructions?: string
        version?: number
      }
    }
    const primaryFolder = value.folders?.find(
      (folder) => folder.id === value.primaryFolderId || folder.role === 'primary',
    )
    return {
      id: project.id,
      projectId: project.id,
      projectVersion: project.updatedAt,
      path: primaryFolder?.path ?? value.rootPath ?? '',
      name: project.name,
      branchName: null,
      lastOpenedAt: iso(project.lastOpenedAt),
      primaryFolderId: value.primaryFolderId ?? primaryFolder?.id,
      folders: value.folders,
      projectSettings: value.settings
        ? {
            defaultModel: value.settings.defaultModel,
            instructions: value.settings.instructions ?? '',
            executionEnvironment:
              value.settings.executionEnvironment === 'local' ? 'local' : 'auto',
            version: value.settings.version ?? 0,
          }
        : undefined,
    }
  }
  return { path: '', name: projectID ? `Project ${projectID}` : '未选择工作区', branchName: null }
}

function threadWorkspaceToDesktopWorkspace(
  workspace: ThreadWorkspace,
  project?: Project | null,
): DesktopWorkspace {
  if (workspace.kind === 'projectless') {
    return {
      path: workspace.cwd,
      name: project?.name ?? '无项目会话',
      ...(project ? { projectId: project.id } : {}),
      branchName: null,
    }
  }
  const current = projectToDesktopWorkspace(project, workspace.projectID)
  return {
    ...current,
    path: workspace.cwd,
    ...(project ? {} : { name: '无项目会话', isStandalone: true, projectId: undefined }),
  }
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function riskValue(value: unknown): 'low' | 'medium' | 'high' | 'critical' {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical'
    ? value
    : 'high'
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function positiveNumber(value: unknown): number | undefined {
  const number = nonNegativeNumber(value)
  return number && number > 0 ? number : undefined
}

function iso(value: number): string {
  return new Date(value).toISOString()
}

function isoOrNull(value: number | null | undefined): string | null {
  return value == null ? null : iso(value)
}

function timestampOf(value: string | undefined): number {
  return value ? Date.parse(value) || 0 : 0
}
