import type {
  AgentExecution,
  ApprovalRequest,
  Attachment,
  LocalContextReference,
  Input,
  Item,
  Message,
  PlanApproval,
  SubagentProjection,
  Thread,
  ThreadSnapshot,
  Turn,
} from '@pidex/shared/thread'
import type { EventEnvelope, RpcResult } from '@pidex/agent-protocol'

export type ThreadEventEnvelopeLike = EventEnvelope

type ProtocolThreadHistoryPage = RpcResult<'thread/history/read'>
export type PendingHookTrustInteraction = Extract<
  RpcResult<'interaction/listPending'>['interactions'][number],
  { kind: 'hookTrust' }
>

export type ThreadStreamPosition = ProtocolThreadHistoryPage['streamPosition']

export type ThreadTurnBundle = ProtocolThreadHistoryPage['turns'][number]

/** Renderer-facing history page with an optional queue for snapshot adapters. */
export type CanonicalThreadPage = Omit<ProtocolThreadHistoryPage, 'queue'> & {
  queue?: ProtocolThreadHistoryPage['queue']
  pendingHookTrusts?: readonly PendingHookTrustInteraction[]
}

export type ThreadHistoryPageLike = CanonicalThreadPage

export interface CanonicalQueueState {
  version: number
  pauseReason: 'interrupted' | 'turn_failed' | null
  turnIds: string[]
  inputIds: string[]
}

/**
 * 派生索引：按 turn 分组的 items/agents/approvals，以及按 subagentRunId 分组的
 * agent id。选择器据此只遍历 turn，而不是每帧全量重分组。非协议、非持久化
 * 字段；所有实体写入都必须经过本文件的 upsert/remove 辅助函数，批量装载
 * （历史页、reconcile）之后统一重建。
 */
export interface CanonicalTurnGroups {
  itemsByTurnId: Map<string, Item[]>
  agentsByTurnId: Map<string, AgentExecution[]>
  approvalsByTurnId: Map<string, ApprovalRequest[]>
  agentIdsBySubagentRunId: Map<string, string[]>
}

export interface CanonicalThreadState {
  thread: Thread
  pendingPlanApproval: PlanApproval | null
  turnOrder: string[]
  turnsById: Map<string, Turn>
  inputsById: Map<string, Input>
  messagesById: Map<string, Message>
  agentsById: Map<string, AgentExecution>
  itemsById: Map<string, Item>
  approvalsById: Map<string, ApprovalRequest>
  hookTrustsById: Map<string, PendingHookTrustInteraction>
  attachmentsById: Map<string, Attachment>
  contextReferencesById: Map<string, LocalContextReference>
  subagentsByTaskId: Map<string, SubagentProjection>
  groups: CanonicalTurnGroups
  queue: CanonicalQueueState
  history: {
    olderCursor: string | null
    hasOlder: boolean
    loadingOlder: boolean
    generation: number
  }
  stream: {
    streamId: string
    appliedSequence: number
    appliedEventIds: Set<string>
  }
}

export type ThreadConversationScope =
  | { type: 'main' }
  | { type: 'subagent'; runId: string }
  | { type: 'side-chat'; inheritedThroughTurnId: string | null }

export interface VisibleTurnEntry {
  id: string
  turn: Turn
  userInputs: Input[]
  agents: AgentExecution[]
  items: Item[]
  approvals: ApprovalRequest[]
  attachments: Attachment[]
  contextReferences: LocalContextReference[]
}

export type RenderItem = Item

export type RenderContentBlock =
  | { kind: 'assistant'; id: string; items: Array<Extract<Item, { type: 'text' }>> }
  | { kind: 'process'; id: string; items: RenderItem[] }
  | { kind: 'plan'; id: string; item: Extract<Item, { type: 'plan' }> }
  | { kind: 'execution-plan'; id: string; item: Extract<Item, { type: 'execution-plan' }> }
  | { kind: 'patch'; id: string; item: Extract<Item, { type: 'patch' }> }
  | { kind: 'post'; id: string; item: RenderItem }

export type RenderBlocker =
  | { kind: 'approval'; id: string; createdAt: number; approval: ApprovalRequest }
  | {
      kind: 'question'
      id: string
      createdAt: number
      question: Extract<Item, { type: 'question' }>
    }

export interface RenderTurnEntry extends VisibleTurnEntry {
  userItems: Input[]
  processItems: RenderItem[]
  assistantResultItems: Array<Extract<Item, { type: 'text' }>>
  postAssistantItems: RenderItem[]
  patchItems: Array<Extract<Item, { type: 'patch' }>>
  planItem: Extract<Item, { type: 'plan' }> | null
  executionPlanItems: Array<Extract<Item, { type: 'execution-plan' }>>
  contentBlocks: RenderContentBlock[]
  blockers: RenderBlocker[]
  systemItems: RenderItem[]
}

export function pageFromThreadSnapshot(
  snapshot: ThreadSnapshot,
  streamPosition: ThreadStreamPosition = { streamId: 'snapshot', sequence: 0 },
): CanonicalThreadPage {
  return {
    thread: snapshot.thread,
    pendingPlanApproval: snapshot.pendingPlanApproval,
    subagents: [...snapshot.subagents],
    turns: snapshot.turns.map((turn) => ({
      turn,
      inputs: snapshot.inputs.filter((input) => input.turnId === turn.id),
      messages: snapshot.messages.filter((message) => message.turnId === turn.id),
      agents: snapshot.agents.filter((agent) => agent.turnId === turn.id),
      items: snapshot.items.filter((item) => item.turnId === turn.id),
      approvals: snapshot.approvals.filter((approval) => approval.turnId === turn.id),
      attachments: [],
      contextReferences: (snapshot.contextReferences ?? []).filter((reference) =>
        snapshot.inputs.some(
          (input) => input.turnId === turn.id && input.contextReferenceIds?.includes(reference.id),
        ),
      ),
    })),
    queue: snapshot.queue
      ? {
          version: snapshot.queue.version,
          pauseReason: snapshot.queue.pauseReason,
          turns: snapshot.turns.filter((turn) => turn.status === 'queued'),
          inputs: snapshot.inputs.filter((input) => input.state === 'queued'),
        }
      : undefined,
    olderCursor: null,
    hasOlder: false,
    streamPosition,
  }
}

export function createCanonicalThreadState(page: CanonicalThreadPage): CanonicalThreadState {
  return hydrateLatestThreadPage(emptyState(page.thread), page)
}

export function reconcileLatestThreadPage(
  cached: CanonicalThreadState,
  page: CanonicalThreadPage,
): CanonicalThreadState {
  const fresh = createCanonicalThreadState(page)
  fresh.history.generation = cached.history.generation + 1
  if (
    cached.thread.id !== page.thread.id ||
    cached.stream.streamId !== page.streamPosition.streamId
  ) {
    return fresh
  }

  const refreshedTurnIds = new Set([
    ...page.turns.map((bundle) => bundle.turn.id),
    ...(page.queue?.turns.map((turn) => turn.id) ?? []),
  ])
  const cachedQueuedTurnIds = new Set(cached.queue.turnIds)
  const preservedTurnIds = cached.turnOrder.filter(
    (turnId) =>
      !refreshedTurnIds.has(turnId) &&
      !cachedQueuedTurnIds.has(turnId) &&
      cached.turnsById.has(turnId),
  )
  if (preservedTurnIds.length === 0) return fresh

  const preservedTurnIdSet = new Set(preservedTurnIds)
  for (const turnId of preservedTurnIds) {
    const turn = cached.turnsById.get(turnId)
    if (turn) fresh.turnsById.set(turnId, turn)
  }
  copyEntitiesForTurns(cached.inputsById, fresh.inputsById, preservedTurnIdSet)
  copyEntitiesForTurns(cached.messagesById, fresh.messagesById, preservedTurnIdSet)
  copyEntitiesForTurns(cached.agentsById, fresh.agentsById, preservedTurnIdSet)
  copyEntitiesForTurns(cached.itemsById, fresh.itemsById, preservedTurnIdSet)
  copyEntitiesForTurns(cached.approvalsById, fresh.approvalsById, preservedTurnIdSet)

  const preservedAttachmentIds = new Set<string>()
  for (const input of fresh.inputsById.values()) {
    if (!input.turnId || !preservedTurnIdSet.has(input.turnId)) continue
    for (const attachmentId of input.attachmentIds ?? []) {
      preservedAttachmentIds.add(attachmentId)
    }
  }
  for (const attachmentId of preservedAttachmentIds) {
    if (fresh.attachmentsById.has(attachmentId)) continue
    const attachment = cached.attachmentsById.get(attachmentId)
    if (attachment) fresh.attachmentsById.set(attachmentId, attachment)
  }

  const preservedReferenceIds = new Set<string>()
  for (const input of fresh.inputsById.values()) {
    if (!input.turnId || !preservedTurnIdSet.has(input.turnId)) continue
    for (const referenceId of input.contextReferenceIds ?? []) {
      preservedReferenceIds.add(referenceId)
    }
  }
  for (const referenceId of preservedReferenceIds) {
    if (fresh.contextReferencesById.has(referenceId)) continue
    const reference = cached.contextReferencesById.get(referenceId)
    if (reference) fresh.contextReferencesById.set(referenceId, reference)
  }

  fresh.turnOrder = unique([...preservedTurnIds, ...fresh.turnOrder])
  fresh.history = {
    ...fresh.history,
    olderCursor: cached.history.olderCursor,
    hasOlder: cached.history.hasOlder,
  }
  rebuildTurnGroups(fresh)
  return fresh
}

export function hydrateLatestThreadPage(
  _state: CanonicalThreadState,
  page: CanonicalThreadPage,
): CanonicalThreadState {
  const next = emptyState(page.thread)
  next.pendingPlanApproval = page.pendingPlanApproval ?? null
  mergePageEntities(next, page, 'replace')
  next.subagentsByTaskId = mapBy(page.subagents, (projection) => projection.task.id)
  reconcileSubagentItems(next)
  next.hookTrustsById = mapBy(
    page.pendingHookTrusts ?? [],
    (interaction) => interaction.interactionId,
  )
  reconcileSubagentItems(next)
  rebuildTurnGroups(next)
  next.history = {
    olderCursor: page.olderCursor,
    hasOlder: page.hasOlder,
    loadingOlder: false,
    generation: _state.history.generation + 1,
  }
  next.stream = {
    streamId: page.streamPosition.streamId,
    appliedSequence: page.streamPosition.sequence,
    appliedEventIds: new Set(),
  }
  return next
}

export function prependOlderThreadPage(
  state: CanonicalThreadState,
  page: CanonicalThreadPage,
): CanonicalThreadState {
  if (page.thread.id !== state.thread.id) return state
  const next = cloneState(state)
  mergePageEntities(next, page, 'prepend')
  for (const projection of page.subagents) {
    next.subagentsByTaskId.set(projection.task.id, projection)
  }
  reconcileSubagentItems(next)
  rebuildTurnGroups(next)
  next.history = {
    ...next.history,
    olderCursor: page.olderCursor,
    hasOlder: page.hasOlder,
    loadingOlder: false,
  }
  // The read fence belongs to this historical page, which intentionally omits
  // newer active turns. Advancing the live cursor here could make a concurrent
  // durable event look already applied and silently drop it.
  return next
}

export function applyThreadEnvelope(
  state: CanonicalThreadState,
  envelope: ThreadEventEnvelopeLike,
): CanonicalThreadState {
  return applyThreadEnvelopes(state, [envelope])
}

export function applyThreadEnvelopes(
  state: CanonicalThreadState,
  envelopes: readonly ThreadEventEnvelopeLike[],
): CanonicalThreadState {
  let next: CanonicalThreadState | null = null

  for (const envelope of envelopes) {
    const current = next ?? state
    if (envelope.threadId && envelope.threadId !== current.thread.id) continue
    if (envelope.streamId !== current.stream.streamId) continue
    if (envelope.durability === 'durable' && envelope.sequence <= current.stream.appliedSequence)
      continue
    if (envelope.durability === 'live') {
      if (envelope.afterSequence < current.stream.appliedSequence) continue
      if (current.stream.appliedEventIds.has(envelope.eventId)) continue
    }

    next ??= cloneState(state)
    if (envelope.durability === 'durable') {
      next.stream.appliedSequence = envelope.sequence
    } else {
      rememberLiveEvent(next.stream.appliedEventIds, envelope.eventId)
    }
    applyEnvelopePayload(next, envelope)
  }

  return next ?? state
}

export function selectVisibleTurnEntries(
  state: CanonicalThreadState,
  scope: ThreadConversationScope = { type: 'main' },
): VisibleTurnEntry[] {
  const queueTurnIds = new Set(state.queue.turnIds)
  // inputs 每个 turn 至多一条，按 turn 分组的代价与 turn 数同阶，无需单独索引。
  const inputsByTurnId = groupSortedByTurn(state.inputsById.values())
  const allowedAgentIds =
    scope.type === 'subagent'
      ? new Set(state.groups.agentIdsBySubagentRunId.get(scope.runId) ?? [])
      : null
  const agentsByTurnId = state.groups.agentsByTurnId
  const itemsByTurnId = state.groups.itemsByTurnId
  const approvalsByTurnId = state.groups.approvalsByTurnId

  const entries: VisibleTurnEntry[] = []
  const inheritedBoundaryIndex =
    scope.type === 'side-chat' && scope.inheritedThroughTurnId !== null
      ? state.turnOrder.indexOf(scope.inheritedThroughTurnId)
      : -1
  const visibleTurnOrder =
    inheritedBoundaryIndex >= 0
      ? state.turnOrder.slice(inheritedBoundaryIndex + 1)
      : state.turnOrder
  for (const turnId of visibleTurnOrder) {
    const turn = state.turnsById.get(turnId)
    if (!turn || queueTurnIds.has(turnId)) continue
    const userInputs = inputsByTurnId.get(turnId) ?? []
    const agents = agentsByTurnId.get(turnId) ?? []
    const items = filterItemsByAllowedAgents(itemsByTurnId.get(turnId) ?? [], allowedAgentIds)
    const approvals = filterApprovalsByAllowedAgents(
      approvalsByTurnId.get(turnId) ?? [],
      allowedAgentIds,
    )
    if (allowedAgentIds && agents.length === 0 && items.length === 0 && approvals.length === 0)
      continue
    const attachmentIds = new Set(userInputs.flatMap((input) => input.attachmentIds ?? []))
    const contextReferenceIds = new Set(
      userInputs.flatMap((input) => input.contextReferenceIds ?? []),
    )
    entries.push({
      id: turn.id,
      turn,
      userInputs,
      agents,
      items,
      approvals,
      attachments: [...attachmentIds]
        .map((attachmentId) => state.attachmentsById.get(attachmentId))
        .filter((attachment): attachment is Attachment => attachment !== undefined),
      contextReferences: [...contextReferenceIds]
        .map((referenceId) => state.contextReferencesById.get(referenceId))
        .filter((reference): reference is LocalContextReference => reference !== undefined),
    })
  }
  return entries
}

function filterItemsByAllowedAgents(
  items: readonly Item[],
  allowedAgentIds: ReadonlySet<string> | null,
): Item[] {
  if (!allowedAgentIds) return items as Item[]
  return items.filter((item) => allowedAgentIds.has(item.agentId))
}

function filterApprovalsByAllowedAgents(
  approvals: readonly ApprovalRequest[],
  allowedAgentIds: ReadonlySet<string> | null,
): ApprovalRequest[] {
  if (!allowedAgentIds) return approvals as ApprovalRequest[]
  return approvals.filter((approval) => allowedAgentIds.has(approval.agentId))
}

export function selectRenderTurnEntries(
  state: CanonicalThreadState,
  scope: ThreadConversationScope = { type: 'main' },
): RenderTurnEntry[] {
  return selectVisibleTurnEntries(state, scope).map(buildRenderTurnEntry)
}

export type RenderTurnEntriesSelector = (
  state: CanonicalThreadState,
  scope?: ThreadConversationScope,
) => RenderTurnEntry[]

export function createRenderTurnEntriesSelector(): RenderTurnEntriesSelector {
  let cacheKey = ''
  let previousEntries: RenderTurnEntry[] = []
  let previousByTurnId = new Map<string, RenderTurnEntry>()

  return (
    state: CanonicalThreadState,
    scope: ThreadConversationScope = { type: 'main' },
  ): RenderTurnEntry[] => {
    const scopeCacheKey =
      scope.type === 'main'
        ? 'main'
        : scope.type === 'subagent'
          ? `subagent:${scope.runId}`
          : `side-chat:${scope.inheritedThroughTurnId ?? 'none'}`
    const nextCacheKey = `${state.thread.id}:${scopeCacheKey}`
    if (nextCacheKey !== cacheKey) {
      cacheKey = nextCacheKey
      previousEntries = []
      previousByTurnId = new Map()
    }

    const visibleEntries = selectVisibleTurnEntries(state, scope)
    const nextEntries = visibleEntries.map((entry) => {
      const previous = previousByTurnId.get(entry.id)
      return previous && hasSameVisibleSources(previous, entry)
        ? previous
        : buildRenderTurnEntry(entry)
    })
    const result = sameReferences(previousEntries, nextEntries) ? previousEntries : nextEntries
    previousEntries = result
    previousByTurnId = new Map(result.map((entry) => [entry.id, entry]))
    return result
  }
}

export function buildRenderTurnEntry(entry: VisibleTurnEntry): RenderTurnEntry {
  const processItems: Item[] = []
  const assistantResultItems: Array<Extract<Item, { type: 'text' }>> = []
  const postAssistantItems: Item[] = []
  const patchItems: Array<Extract<Item, { type: 'patch' }>> = []
  const executionPlanItems: Array<Extract<Item, { type: 'execution-plan' }>> = []
  const contentBlocks: RenderContentBlock[] = []
  let planItem: Extract<Item, { type: 'plan' }> | null = null
  const lastProcessItemIndex = findLastProcessItemIndex(entry.items)
  const assistantResultIndex = findAssistantResultIndex(entry.items, lastProcessItemIndex)

  for (const [itemIndex, item] of entry.items.entries()) {
    if (item.type === 'text') {
      if (!item.text.trim()) continue
      if (itemIndex === assistantResultIndex) {
        assistantResultItems.push(item)
        const previous = contentBlocks.at(-1)
        if (previous?.kind === 'assistant') previous.items.push(item)
        else contentBlocks.push({ kind: 'assistant', id: `assistant:${item.id}`, items: [item] })
      } else {
        processItems.push(item)
        appendProcessBlock(contentBlocks, item)
      }
    } else if (item.type === 'patch') {
      patchItems.push(item)
      contentBlocks.push({ kind: 'patch', id: `patch:${item.id}`, item })
    } else if (item.type === 'plan') {
      planItem = item
      contentBlocks.push({ kind: 'plan', id: `plan:${item.id}`, item })
    } else if (item.type === 'execution-plan') {
      executionPlanItems.push(item)
      contentBlocks.push({ kind: 'execution-plan', id: `execution-plan:${item.id}`, item })
    } else if (isContextCompressionActivity(item)) {
      postAssistantItems.push(item)
    } else if (item.type === 'question' && item.status !== 'pending') {
      postAssistantItems.push(item)
      contentBlocks.push({ kind: 'post', id: `post:${item.id}`, item })
    } else if (item.type !== 'question') {
      processItems.push(item)
      appendProcessBlock(contentBlocks, item)
    }
  }
  for (const item of postAssistantItems) {
    if (isContextCompressionActivity(item)) {
      contentBlocks.push({ kind: 'post', id: `post:${item.id}`, item })
    }
  }

  const blockers: RenderBlocker[] = [
    ...entry.approvals
      .filter((approval) => approval.status === 'pending')
      .map((approval): RenderBlocker => ({
        kind: 'approval',
        id: `approval:${approval.id}`,
        createdAt: approval.createdAt,
        approval,
      })),
    ...entry.items
      .filter(
        (item): item is Extract<Item, { type: 'question' }> =>
          item.type === 'question' && item.status === 'pending',
      )
      .map((question): RenderBlocker => ({
        kind: 'question',
        id: `question:${question.id}`,
        createdAt: question.createdAt,
        question,
      })),
  ].sort(compareCreated)

  return {
    ...entry,
    userItems: entry.userInputs,
    processItems,
    assistantResultItems,
    postAssistantItems,
    patchItems,
    planItem,
    executionPlanItems,
    contentBlocks,
    blockers,
    systemItems: [],
  }
}

function findLastProcessItemIndex(items: readonly Item[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!item) continue
    if (isContextCompressionActivity(item)) continue
    if (item.type === 'text') {
      if (item.placement === 'process' && item.text.trim()) return index
      continue
    }
    if (
      item.type !== 'patch' &&
      item.type !== 'plan' &&
      item.type !== 'execution-plan' &&
      item.type !== 'question'
    ) {
      return index
    }
  }
  return -1
}

function isContextCompressionActivity(item: Item): item is Extract<Item, { type: 'activity' }> {
  return item.type === 'activity' && item.activity === 'context-compression'
}

function findAssistantResultIndex(items: readonly Item[], lastProcessItemIndex: number): number {
  for (let index = items.length - 1; index > lastProcessItemIndex; index -= 1) {
    const item = items[index]
    if (item?.type === 'text' && item.placement === 'result' && item.text.trim()) {
      return index
    }
  }
  return -1
}

function appendProcessBlock(blocks: RenderContentBlock[], item: RenderItem): void {
  const previous = blocks.at(-1)
  if (previous?.kind === 'process') previous.items.push(item)
  else blocks.push({ kind: 'process', id: `process:${item.id}`, items: [item] })
}

function applyEnvelopePayload(
  state: CanonicalThreadState,
  envelope: ThreadEventEnvelopeLike,
): void {
  switch (envelope.type) {
    case 'thread/created':
    case 'thread/updated':
      state.thread = envelope.payload.thread
      return
    case 'thread/settings/updated':
      state.thread = { ...state.thread, settings: envelope.payload.settings }
      if (envelope.payload.settings.taskMode === 'chat') state.pendingPlanApproval = null
      return
    case 'turn/queued':
      state.pendingPlanApproval = null
      upsertTurn(state, envelope.payload.turn)
      state.inputsById.set(envelope.payload.input.id, envelope.payload.input)
      if (!state.queue.turnIds.includes(envelope.payload.turn.id))
        state.queue.turnIds.push(envelope.payload.turn.id)
      return
    case 'turn/started':
      state.pendingPlanApproval = null
      upsertTurn(state, envelope.payload.turn)
      state.inputsById.set(envelope.payload.input.id, envelope.payload.input)
      state.queue.turnIds = state.queue.turnIds.filter((id) => id !== envelope.payload.turn.id)
      return
    case 'turn/completed':
    case 'turn/failed':
    case 'turn/interrupted':
      upsertTurn(state, envelope.payload.turn)
      for (const item of state.itemsById.values()) {
        if (
          item.type === 'question' &&
          item.turnId === envelope.payload.turn.id &&
          item.status === 'pending'
        ) {
          upsertItem(state, { ...item, status: 'cancelled' })
        }
      }
      state.queue.turnIds = state.queue.turnIds.filter((id) => id !== envelope.payload.turn.id)
      return
    case 'turn/statusChanged': {
      const turn = state.turnsById.get(envelope.payload.turnId)
      if (turn) state.turnsById.set(turn.id, { ...turn, status: envelope.payload.status })
      return
    }
    case 'agent/upserted':
      upsertAgent(state, envelope.payload.agent)
      return
    case 'subagent/created':
    case 'subagent/updated':
    case 'subagent/workspaceUpdated':
      state.subagentsByTaskId.set(envelope.payload.projection.task.id, envelope.payload.projection)
      reconcileSubagentItems(state)
      return
    case 'item/started':
    case 'item/completed':
      upsertItem(state, envelope.payload.item)
      return
    case 'item/agentMessage/delta':
      appendItemDelta(
        state,
        envelope.payload.itemId,
        envelope.payload.delta,
        'text',
        envelope.payload,
        envelope.occurredAt,
      )
      return
    case 'reasoning/textDelta':
    case 'reasoning/summaryTextDelta':
      appendItemDelta(
        state,
        envelope.payload.itemId,
        envelope.payload.delta,
        'reasoning',
        envelope.payload,
        envelope.occurredAt,
      )
      return
    case 'reasoning/summaryPartAdded':
      return
    case 'plan/delta':
      appendItemDelta(
        state,
        envelope.payload.itemId,
        envelope.payload.delta,
        'plan',
        envelope.payload,
        envelope.occurredAt,
      )
      return
    case 'turn/plan/updated':
      upsertItem(state, envelope.payload.item)
      return
    case 'tool/callStarted':
    case 'tool/callCompleted':
    case 'tool/error':
      upsertItem(state, envelope.payload.item)
      return
    case 'tool/outputDelta':
      appendItemDelta(
        state,
        envelope.payload.itemId,
        envelope.payload.delta,
        'tool',
        envelope.payload,
        envelope.occurredAt,
      )
      return
    case 'approval/requested':
      upsertApproval(state, approvalFromPayload(envelope.payload))
      return
    case 'mcp/elicitationRequested': {
      const payload = envelope.payload
      upsertApproval(state, {
        id: payload.interactionId,
        threadId: payload.threadId,
        turnId: payload.turnId,
        agentId: payload.agentId,
        toolCallID: payload.toolCallId,
        tool: 'McpElicitation',
        command: null,
        cwd: null,
        paths: [],
        requestedPermissions: {},
        review: null,
        risk: 'medium',
        reason: String(payload.request.message ?? 'MCP 请求输入'),
        status: 'pending',
        createdAt: payload.createdAt,
        input: { serverName: payload.server, request: payload.request },
        toolIdentity: { server: payload.server, tool: payload.tool },
      })
      return
    }
    case 'permission/requested':
      upsertApproval(state, permissionFromPayload(envelope.payload))
      return
    case 'hook/trust/requested':
      state.hookTrustsById.set(envelope.payload.interactionId, envelope.payload)
      return
    case 'hook/trust/resolved':
      state.hookTrustsById.delete(envelope.payload.interactionId)
      return
    case 'approval/cancelled': {
      const approval = state.approvalsById.get(envelope.payload.interactionId)
      if (approval) upsertApproval(state, { ...approval, status: 'cancelled' })
      return
    }
    case 'question/requested': {
      const item = questionFromPayload(envelope.payload)
      upsertItem(state, item)
      return
    }
    case 'interaction/resolved': {
      // Newer events carry the interaction identifier so the pending approval
      // can be closed precisely; historical events without it keep waiting for
      // snapshot reconciliation instead of guessing which request to close.
      if (typeof envelope.payload.interactionId !== 'string') return
      const question = state.itemsById.get(envelope.payload.interactionId)
      if (question?.type === 'question' && envelope.payload.result.kind === 'question') {
        const result = envelope.payload.result
        const firstAnswer =
          result.status === 'answered'
            ? (result.answers.find((answer) => answer.questionId === question.questions?.[0]?.id) ??
              result.answers[0])
            : undefined
        upsertItem(state, {
          ...question,
          status: result.status,
          ...(result.status === 'answered'
            ? {
                answers: result.answers,
                answer:
                  firstAnswer?.text ??
                  firstAnswer?.choiceIds
                    .map((id) => question.choices.find((choice) => choice.id === id)?.label ?? id)
                    .join(', ') ??
                  null,
              }
            : {}),
        })
        return
      }
      if (envelope.payload.result?.kind === 'hookTrust') {
        state.hookTrustsById.delete(envelope.payload.interactionId)
        return
      }
      const approval = state.approvalsById.get(envelope.payload.interactionId)
      if (!approval) return
      const result = envelope.payload.result
      if (result.kind === 'mcp-elicitation') {
        upsertApproval(state, {
          ...approval,
          status:
            result.action === 'accept'
              ? 'allowed'
              : result.action === 'cancel'
                ? 'cancelled'
                : 'denied',
        })
        return
      }
      if (result?.kind !== 'approval' && result?.kind !== 'permission') return
      const status =
        result.kind === 'approval'
          ? result.decision === 'allow-once'
            ? 'allowed'
            : 'denied'
          : result.decision === 'grant'
            ? 'allowed'
            : 'denied'
      upsertApproval(state, { ...approval, status })
      return
    }
    case 'context/compacted':
      projectContextCompaction(state, envelope)
      return
    case 'queue/updated':
      if (envelope.payload.action === 'added') state.pendingPlanApproval = null
      applyQueueUpdate(state, envelope.payload)
      return
    default:
      return
  }
}

function projectContextCompaction(
  state: CanonicalThreadState,
  envelope: Extract<ThreadEventEnvelopeLike, { type: 'context/compacted' }>,
): void {
  const turnId =
    envelope.turnId && state.turnsById.has(envelope.turnId)
      ? envelope.turnId
      : state.turnOrder.at(-1)
  if (!turnId) return
  const turn = state.turnsById.get(turnId)
  if (!turn) return

  const latestAgent = [...state.agentsById.values()]
    .filter((agent) => agent.turnId === turnId)
    .sort(compareCreated)
    .at(-1)
  const itemId = `activity:context-compression:${envelope.payload.compactionId}`
  const detailParts = [
    `消息 ${envelope.payload.beforeCount} → ${envelope.payload.afterCount}`,
    `Token ${envelope.payload.beforeTokens} → ${envelope.payload.afterTokens}`,
  ]
  if (envelope.payload.trigger) detailParts.push(`触发方式：${envelope.payload.trigger}`)
  if (envelope.payload.afterTokensSource) {
    detailParts.push(`压缩后用量来源：${envelope.payload.afterTokensSource}`)
  }
  upsertItem(state, {
    id: itemId,
    messageID: itemId,
    turnId,
    agentId: latestAgent?.id ?? turn.rootAgentId,
    type: 'activity',
    activity: 'context-compression',
    title: '上下文已压缩',
    detail: detailParts.join('；'),
    status: 'completed',
    createdAt: envelope.occurredAt,
  })
}

export type ItemDeltaKind = 'text' | 'reasoning' | 'plan' | 'tool'

/**
 * live delta 是否会被当前投影接受。`appendItemDelta` 与流式尾部缓冲共用这一
 * 判据，避免"尾部显示了投影最终会丢弃的文本"。
 */
export function canApplyItemDelta(
  state: CanonicalThreadState,
  itemId: string,
  kind: ItemDeltaKind,
): boolean {
  const existing = state.itemsById.get(itemId)
  if (!existing) {
    // 缺失时只有能新建条目的 delta 才会被接受；tool delta 需要先有 tool item。
    return kind === 'text' || kind === 'reasoning' || kind === 'plan'
  }
  if (
    (existing.type === 'text' || existing.type === 'reasoning') &&
    existing.status !== 'streaming'
  )
    return false
  if (existing.type === 'tool' && existing.state !== 'running') return false
  if (existing.type === 'plan' && existing.status !== 'streaming') return false
  if (kind === 'text') return existing.type === 'text'
  if (kind === 'reasoning') return existing.type === 'reasoning'
  if (kind === 'plan') return existing.type === 'plan'
  return existing.type === 'tool'
}

function appendItemDelta(
  state: CanonicalThreadState,
  itemId: string,
  delta: string,
  kind: ItemDeltaKind,
  identity: { turnId: string; agentId: string },
  occurredAt: number,
): void {
  if (!canApplyItemDelta(state, itemId, kind)) return
  const existing = state.itemsById.get(itemId)
  if (!existing) {
    const base = {
      id: itemId,
      messageID: itemId,
      turnId: identity.turnId,
      agentId: identity.agentId,
      createdAt: occurredAt,
    }
    if (kind === 'text')
      upsertItem(state, {
        ...base,
        type: 'text',
        placement: 'result',
        text: delta,
        status: 'streaming',
      })
    else if (kind === 'reasoning')
      upsertItem(state, { ...base, type: 'reasoning', text: delta, status: 'streaming' })
    else if (kind === 'plan')
      upsertItem(state, {
        ...base,
        type: 'plan',
        title: '计划',
        markdown: delta,
        status: 'streaming',
      })
    return
  }
  if (kind === 'text' && existing.type === 'text')
    upsertItem(state, { ...existing, text: existing.text + delta, status: 'streaming' })
  else if (kind === 'reasoning' && existing.type === 'reasoning')
    upsertItem(state, { ...existing, text: existing.text + delta, status: 'streaming' })
  else if (kind === 'plan' && existing.type === 'plan')
    upsertItem(state, { ...existing, markdown: existing.markdown + delta, status: 'streaming' })
  else if (kind === 'tool' && existing.type === 'tool')
    upsertItem(state, { ...existing, output: (existing.output ?? '') + delta, state: 'running' })
}

function approvalFromPayload(payload: {
  grantOptions?: ApprovalRequest['grantOptions']
  toolIdentity?: ApprovalRequest['toolIdentity']
  input?: ApprovalRequest['input']
  interactionId: string
  threadId: string
  turnId: string
  agentId: string
  toolCallId: string
  tool: string
  command?: string
  cwd?: string
  computerApp?: ApprovalRequest['computerApp']
  affectedPaths?: readonly { path: string; operation: 'create' | 'update' }[]
  reviewSummary?: {
    fileCount: number
    hunkCount: number
    additions: number
    deletions: number
  }
  requestedPermissions: ApprovalRequest['requestedPermissions']
  risk: ApprovalRequest['risk']
  reason: string
  createdAt: number
}): ApprovalRequest {
  const affectedPaths =
    payload.affectedPaths === undefined
      ? undefined
      : payload.affectedPaths.map((affected) => ({ ...affected }))
  return {
    id: payload.interactionId,
    ...(payload.grantOptions ? { grantOptions: payload.grantOptions } : {}),
    ...(payload.toolIdentity ? { toolIdentity: payload.toolIdentity } : {}),
    ...(payload.input ? { input: payload.input } : {}),
    threadId: payload.threadId,
    turnId: payload.turnId,
    agentId: payload.agentId,
    toolCallID: payload.toolCallId,
    tool: payload.tool,
    command: payload.command ?? null,
    cwd: payload.cwd ?? null,
    paths: affectedPaths
      ? affectedPaths.map(({ path }) => path)
      : [
          ...(payload.requestedPermissions.writePaths ?? []),
          ...(payload.requestedPermissions.readPaths ?? []),
        ],
    ...(affectedPaths ? { affectedPaths } : {}),
    ...(payload.reviewSummary ? { reviewSummary: { ...payload.reviewSummary } } : {}),
    ...(payload.computerApp ? { computerApp: { ...payload.computerApp } } : {}),
    requestedPermissions: payload.requestedPermissions,
    review: null,
    risk: payload.risk,
    reason: payload.reason,
    status: 'pending',
    createdAt: payload.createdAt,
  }
}

function permissionFromPayload(payload: {
  interactionId: string
  threadId: string
  turnId: string
  agentId: string
  toolCallId: string
  tool: string
  reason: string
  requestedPermissions: ApprovalRequest['requestedPermissions']
  requestedScope: 'tool-call' | 'turn' | 'session'
  allowedScopes: ReadonlyArray<'tool-call' | 'turn' | 'session'>
  risk?: 'low' | 'medium' | 'high' | 'critical'
  createdAt: number
}): ApprovalRequest {
  // The dynamic permission card displays every requested read path, write
  // path and network domain so the user can review the full grant surface.
  const paths = [
    ...(payload.requestedPermissions.readPaths ?? []),
    ...(payload.requestedPermissions.writePaths ?? []),
    ...(payload.requestedPermissions.networkDomains ?? []),
  ]
  return {
    id: payload.interactionId,
    threadId: payload.threadId,
    turnId: payload.turnId,
    agentId: payload.agentId,
    toolCallID: payload.toolCallId,
    tool: payload.tool,
    command: null,
    cwd: null,
    paths,
    requestedPermissions: payload.requestedPermissions,
    review: null,
    risk: payload.risk ?? 'high',
    reason: payload.reason,
    status: 'pending',
    createdAt: payload.createdAt,
    permissionGrant: {
      requestedScope: payload.requestedScope,
      allowedScopes: [...payload.allowedScopes],
    },
  }
}

function questionFromPayload(payload: {
  version?: number
  interactionId: string
  turnId: string
  agentId: string
  questions: NonNullable<Extract<Item, { type: 'question' }>['questions']>
  toolCallId?: string
  createdAt: number
}): Extract<Item, { type: 'question' }> {
  const first = payload.questions[0]
  return {
    id: payload.interactionId,
    messageID: payload.interactionId,
    turnId: payload.turnId,
    agentId: payload.agentId,
    type: 'question',
    ...(payload.version !== undefined ? { version: payload.version } : {}),
    prompt: first?.prompt ?? '需要你的选择',
    choices: first?.choices ?? [],
    questions: payload.questions,
    ...(payload.toolCallId ? { toolCallId: payload.toolCallId } : {}),
    status: 'pending',
    answer: null,
    createdAt: payload.createdAt,
  }
}

function applyQueueUpdate(
  state: CanonicalThreadState,
  payload: {
    turns?: readonly Turn[]
    inputs?: readonly Input[]
    version?: number
    pauseReason?: 'interrupted' | 'turn_failed' | null
  },
): void {
  if (payload.turns) {
    state.queue.turnIds = payload.turns.map((turn) => turn.id)
    for (const turn of payload.turns) upsertTurn(state, turn)
  }
  if (payload.inputs) {
    state.queue.inputIds = payload.inputs.map((input) => input.id)
    for (const input of payload.inputs) state.inputsById.set(input.id, input)
  }
  if (payload.version !== undefined) state.queue.version = payload.version
  if (payload.pauseReason !== undefined) state.queue.pauseReason = payload.pauseReason
}

function reconcileSubagentItems(state: CanonicalThreadState): void {
  const descendants = (threadId: string): SubagentProjection[] =>
    [...state.subagentsByTaskId.values()]
      .filter((entry) => entry.task.parentThreadId === threadId)
      .flatMap((entry) => [entry, ...descendants(entry.task.childThreadId)])
  for (const item of state.itemsById.values()) {
    if (item.type !== 'subagent') continue
    const projection = state.subagentsByTaskId.get(item.subagentTaskId)
    if (!projection) continue
    const children = descendants(projection.task.childThreadId)
    const run = projection.currentRun
    upsertItem(state, {
      ...item,
      ...(projection.task.notices?.filter((notice) => notice.kind === 'report').at(-1)
        ? {
            latestReport: projection.task.notices
              .filter((notice) => notice.kind === 'report')
              .at(-1)!.message,
          }
        : {}),
      depth: projection.task.depth ?? 1,
      waitingForDescendants: projection.task.waitingForDescendants ?? false,
      descendantCount: children.length,
      activeDescendantCount: children.filter(
        (entry) =>
          entry.currentRun &&
          !['completed', 'failed', 'stopped', 'interrupted'].includes(entry.currentRun.status),
      ).length,
      runId: run?.id ?? item.runId,
      childThreadId: projection.task.childThreadId,
      displayName: projection.task.displayName,
      profile: projection.task.profile,
      task: projection.task.task,
      status: run?.status ?? item.status,
      queueReason: run?.queueReason ?? item.queueReason,
      result: run?.result ?? item.result,
    })
  }
}

function mergePageEntities(
  state: CanonicalThreadState,
  page: CanonicalThreadPage,
  mode: 'replace' | 'prepend',
): void {
  const pageTurnIds: string[] = []
  for (const bundle of page.turns) {
    pageTurnIds.push(bundle.turn.id)
    state.turnsById.set(bundle.turn.id, bundle.turn)
    for (const input of bundle.inputs) state.inputsById.set(input.id, input)
    for (const message of bundle.messages) state.messagesById.set(message.id, message)
    for (const agent of bundle.agents) state.agentsById.set(agent.id, agent)
    for (const item of bundle.items) state.itemsById.set(item.id, item)
    for (const approval of bundle.approvals) state.approvalsById.set(approval.id, approval)
    for (const attachment of bundle.attachments ?? [])
      state.attachmentsById.set(attachment.id, attachment)
    for (const reference of bundle.contextReferences ?? []) {
      state.contextReferencesById.set(reference.id, reference)
    }
  }
  state.turnOrder =
    mode === 'replace' ? unique(pageTurnIds) : unique([...pageTurnIds, ...state.turnOrder])
  if (page.queue) {
    state.queue = {
      version: page.queue.version,
      pauseReason: page.queue.pauseReason,
      turnIds: page.queue.turns.map((turn) => turn.id),
      inputIds: page.queue.inputs.map((input) => input.id),
    }
    for (const turn of page.queue.turns) state.turnsById.set(turn.id, turn)
    for (const input of page.queue.inputs) state.inputsById.set(input.id, input)
  }
}

function upsertTurn(state: CanonicalThreadState, turn: Turn): void {
  state.turnsById.set(turn.id, turn)
  if (!state.turnOrder.includes(turn.id)) state.turnOrder.push(turn.id)
}

function emptyState(thread: Thread): CanonicalThreadState {
  return {
    thread,
    pendingPlanApproval: null,
    turnOrder: [],
    turnsById: new Map(),
    inputsById: new Map(),
    messagesById: new Map(),
    agentsById: new Map(),
    itemsById: new Map(),
    approvalsById: new Map(),
    hookTrustsById: new Map(),
    attachmentsById: new Map(),
    contextReferencesById: new Map(),
    subagentsByTaskId: new Map(),
    groups: createEmptyTurnGroups(),
    queue: { version: 0, pauseReason: null, turnIds: [], inputIds: [] },
    history: { olderCursor: null, hasOlder: false, loadingOlder: false, generation: 0 },
    stream: { streamId: '', appliedSequence: 0, appliedEventIds: new Set() },
  }
}

function cloneState(state: CanonicalThreadState): CanonicalThreadState {
  return {
    ...state,
    turnsById: new Map(state.turnsById),
    inputsById: new Map(state.inputsById),
    messagesById: new Map(state.messagesById),
    agentsById: new Map(state.agentsById),
    itemsById: new Map(state.itemsById),
    approvalsById: new Map(state.approvalsById),
    hookTrustsById: new Map(state.hookTrustsById),
    attachmentsById: new Map(state.attachmentsById),
    contextReferencesById: new Map(state.contextReferencesById),
    subagentsByTaskId: new Map(state.subagentsByTaskId),
    groups: copyTurnGroups(state.groups),
    queue: {
      ...state.queue,
      turnIds: [...state.queue.turnIds],
      inputIds: [...state.queue.inputIds],
    },
    history: { ...state.history },
    stream: { ...state.stream, appliedEventIds: new Set(state.stream.appliedEventIds) },
  }
}

const MAX_RECENT_LIVE_EVENT_IDS = 2_048

function rememberLiveEvent(eventIds: Set<string>, eventId: string): void {
  eventIds.add(eventId)
  while (eventIds.size > MAX_RECENT_LIVE_EVENT_IDS) {
    const oldestEventId = eventIds.values().next().value
    if (oldestEventId === undefined) break
    eventIds.delete(oldestEventId)
  }
}

function mapBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  return new Map(values.map((value) => [key(value), value]))
}

function copyEntitiesForTurns<T extends { id: string; turnId: string | null }>(
  source: ReadonlyMap<string, T>,
  target: Map<string, T>,
  turnIds: ReadonlySet<string>,
): void {
  for (const entity of source.values()) {
    if (entity.turnId && turnIds.has(entity.turnId)) target.set(entity.id, entity)
  }
}

function appendGrouped<T>(groups: Map<string, T[]>, turnId: string, value: T): void {
  const values = groups.get(turnId)
  if (values) values.push(value)
  else groups.set(turnId, [value])
}

function sortGrouped<T>(groups: Map<string, T[]>, compare: (left: T, right: T) => number): void {
  for (const values of groups.values()) values.sort(compare)
}

function createEmptyTurnGroups(): CanonicalTurnGroups {
  return {
    itemsByTurnId: new Map(),
    agentsByTurnId: new Map(),
    approvalsByTurnId: new Map(),
    agentIdsBySubagentRunId: new Map(),
  }
}

function copyTurnGroups(groups: CanonicalTurnGroups): CanonicalTurnGroups {
  return {
    itemsByTurnId: new Map(groups.itemsByTurnId),
    agentsByTurnId: new Map(groups.agentsByTurnId),
    approvalsByTurnId: new Map(groups.approvalsByTurnId),
    agentIdsBySubagentRunId: new Map(groups.agentIdsBySubagentRunId),
  }
}

/** 从实体表整体重建分组索引。只用于历史页装载与 reconcile 等批量路径。 */
function rebuildTurnGroups(state: CanonicalThreadState): void {
  const groups = createEmptyTurnGroups()
  for (const item of state.itemsById.values()) {
    if (item.turnId) appendGrouped(groups.itemsByTurnId, item.turnId, item)
  }
  sortGrouped(groups.itemsByTurnId, compareOrdinal)
  for (const agent of state.agentsById.values()) {
    if (agent.turnId) appendGrouped(groups.agentsByTurnId, agent.turnId, agent)
    if (agent.subagentRunId) {
      appendGrouped(groups.agentIdsBySubagentRunId, agent.subagentRunId, agent.id)
    }
  }
  sortGrouped(groups.agentsByTurnId, compareCreated)
  for (const approval of state.approvalsById.values()) {
    if (approval.turnId) appendGrouped(groups.approvalsByTurnId, approval.turnId, approval)
  }
  sortGrouped(groups.approvalsByTurnId, compareCreated)
  state.groups = groups
}

/**
 * 单实体写入：只重排受影响 turn 的数组，未变更 turn 的数组保持逐元素一致，
 * 因此按 turn 的渲染缓存仍然命中。
 */
function upsertGrouped<T extends { id: string; turnId: string | null; createdAt: number }>(
  groups: Map<string, T[]>,
  previous: T | undefined,
  next: T,
  compare: (left: T, right: T) => number,
): void {
  const affectedTurnIds = new Set<string>()
  if (previous?.turnId) affectedTurnIds.add(previous.turnId)
  if (next.turnId) affectedTurnIds.add(next.turnId)
  for (const turnId of affectedTurnIds) {
    const current = groups.get(turnId)
    const remaining = current
      ? current.filter((value) => value !== previous && value.id !== next.id)
      : []
    if (next.turnId === turnId) insertSortedGrouped(remaining, next, compare)
    if (remaining.length > 0) groups.set(turnId, remaining)
    else groups.delete(turnId)
  }
}

function insertSortedGrouped<T>(
  values: T[],
  value: T,
  compare: (left: T, right: T) => number,
): void {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (compare(values[middle]!, value) <= 0) low = middle + 1
    else high = middle
  }
  values.splice(low, 0, value)
}

function upsertItem(state: CanonicalThreadState, item: Item): void {
  const previous = state.itemsById.get(item.id)
  state.itemsById.set(item.id, item)
  upsertGrouped(state.groups.itemsByTurnId, previous, item, compareOrdinal)
}

function upsertAgent(state: CanonicalThreadState, agent: AgentExecution): void {
  const previous = state.agentsById.get(agent.id)
  state.agentsById.set(agent.id, agent)
  upsertGrouped(state.groups.agentsByTurnId, previous, agent, compareCreated)
  if (previous?.subagentRunId && previous.subagentRunId !== agent.subagentRunId) {
    removeGroupedId(state.groups.agentIdsBySubagentRunId, previous.subagentRunId, agent.id)
  }
  if (agent.subagentRunId) {
    const ids = state.groups.agentIdsBySubagentRunId.get(agent.subagentRunId)
    if (ids) {
      if (!ids.includes(agent.id)) ids.push(agent.id)
    } else {
      state.groups.agentIdsBySubagentRunId.set(agent.subagentRunId, [agent.id])
    }
  }
}

function upsertApproval(state: CanonicalThreadState, approval: ApprovalRequest): void {
  const previous = state.approvalsById.get(approval.id)
  state.approvalsById.set(approval.id, approval)
  upsertGrouped(state.groups.approvalsByTurnId, previous, approval, compareCreated)
}

function removeGroupedId(groups: Map<string, string[]>, key: string, id: string): void {
  const ids = groups.get(key)
  if (!ids) return
  const next = ids.filter((value) => value !== id)
  if (next.length > 0) groups.set(key, next)
  else groups.delete(key)
}

function groupSortedByTurn<T extends { turnId: string | null; id: string; createdAt: number }>(
  values: Iterable<T>,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const value of values) {
    if (value.turnId) appendGrouped(grouped, value.turnId, value)
  }
  sortGrouped(grouped, compareCreated)
  return grouped
}

function hasSameVisibleSources(previous: RenderTurnEntry, next: VisibleTurnEntry): boolean {
  return (
    previous.turn === next.turn &&
    sameReferences(previous.userInputs, next.userInputs) &&
    sameReferences(previous.agents, next.agents) &&
    sameReferences(previous.items, next.items) &&
    sameReferences(previous.approvals, next.approvals) &&
    sameReferences(previous.attachments, next.attachments)
  )
}

function sameReferences<T>(previous: readonly T[], next: readonly T[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index])
}

function compareCreated(
  left: { id: string; createdAt: number },
  right: { id: string; createdAt: number },
): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
}

function compareOrdinal(left: Item, right: Item): number {
  if (left.ordinal !== undefined && right.ordinal !== undefined && left.ordinal !== right.ordinal) {
    return left.ordinal - right.ordinal
  }
  return compareCreated(left, right)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
