import type { CanonicalThreadState } from '@pidex/session-view'
import type { Item, Turn } from '@pidex/shared/thread'

import type {
  DesktopContextUsage,
  DesktopPermissionRequest,
  DesktopQueuedFollowUp,
  DesktopQueuePauseReason,
  DesktopSessionStatus,
} from '../../../../shared/Types.js'
import {
  agentTurnStatusToDesktopStatus,
  approvalToRequest,
  latestItemContextUsage,
  questionToRequest,
  toolToRequest,
} from '../../../services/AgentThreadAdapter.js'
import { sessionTitleFromContent } from '../../../UiTypes.js'
import { desktopUserMessageInputToPreviewText } from '../../../../shared/DesktopUserMessage.js'

export type SourceLink = {
  label: string
  url: string
}

export type CanonicalConversationAuxiliaryState = {
  hasConversationMessages: boolean
  pendingPermissions: DesktopPermissionRequest[]
  contextUsage: DesktopContextUsage | null
  queuedFollowUps: DesktopQueuedFollowUp[]
  queuePauseReason: DesktopQueuePauseReason | null
  sessionStatus: DesktopSessionStatus | null
  sourceLinks: SourceLink[]
  fallbackTitle: string | null
}

const completedResultSourceLinks = new WeakMap<object, SourceLink[]>()

/**
 * Raw lifecycle status of the turn the canonical projection currently reports:
 * the newest active turn, otherwise the newest turn that is not waiting in the
 * queue. Returns `null` when the projection holds no usable turn yet.
 */
export function selectCanonicalLatestTurnStatus(
  state: CanonicalThreadState | null,
): Turn['status'] | null {
  if (!state) return null
  const queueTurnIds = new Set(state.queue.turnIds)
  const activeTurn = [...state.turnsById.values()]
    .filter(
      (turn) =>
        !queueTurnIds.has(turn.id) &&
        (turn.status === 'running' || turn.status.startsWith('waiting-')),
    )
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))[0]
  if (activeTurn) return activeTurn.status
  const latestTurn = [...state.turnOrder]
    .reverse()
    .map((id) => state.turnsById.get(id))
    .find((turn) => turn && !queueTurnIds.has(turn.id))
  return latestTurn?.status ?? null
}

export type CanonicalSessionLifecycle = {
  status: DesktopSessionStatus
  latestTurnStatus: Turn['status']
}

/**
 * Lifecycle published to list surfaces such as the sidebar, which cannot read
 * the canonical projection for every session. Unlike
 * `selectCanonicalSessionStatus`, a thread whose only turns are still waiting in
 * the queue reports `queued`, and a projection that holds no turn information at
 * all returns `null` so the caller keeps its catalog value instead of guessing.
 */
export function selectCanonicalSessionLifecycle(
  state: CanonicalThreadState | null,
): CanonicalSessionLifecycle | null {
  const latestTurnStatus = selectCanonicalLatestTurnStatus(state)
  if (latestTurnStatus) {
    return {
      status: agentTurnStatusToDesktopStatus(latestTurnStatus),
      latestTurnStatus,
    }
  }
  if (state && state.queue.turnIds.length > 0) {
    return {
      status: agentTurnStatusToDesktopStatus('queued'),
      latestTurnStatus: 'queued',
    }
  }
  return null
}

export function selectCanonicalSessionStatus(
  state: CanonicalThreadState | null,
): DesktopSessionStatus | null {
  if (!state) return null
  return agentTurnStatusToDesktopStatus(selectCanonicalLatestTurnStatus(state) ?? undefined)
}

export function selectCanonicalConversationAuxiliaryState(
  state: CanonicalThreadState | null,
): CanonicalConversationAuxiliaryState {
  if (!state) {
    return {
      hasConversationMessages: false,
      pendingPermissions: [],
      contextUsage: null,
      queuedFollowUps: [],
      queuePauseReason: null,
      sessionStatus: null,
      sourceLinks: [],
      fallbackTitle: null,
    }
  }

  const inputs = [...state.inputsById.values()].sort(compareCreatedAt)
  const items = [...state.itemsById.values()].sort(compareCreatedAt)
  return {
    hasConversationMessages:
      inputs.length > 0 ||
      items.some((item) => item.type === 'text' && item.text.trim().length > 0),
    pendingPermissions: selectPendingPermissions(state),
    contextUsage: latestItemContextUsage(items),
    queuedFollowUps: selectQueuedFollowUps(state),
    queuePauseReason: state.queue.pauseReason,
    sessionStatus: selectCanonicalSessionStatus(state),
    sourceLinks: extractCanonicalSourceLinks(items),
    fallbackTitle: fallbackTitleFromInput(inputs[0]?.content),
  }
}

function selectQueuedFollowUps(state: CanonicalThreadState): DesktopQueuedFollowUp[] {
  const orderedInputIds: string[] = []
  const seen = new Set<string>()
  for (const turnId of state.queue.turnIds) {
    const sourceInputId = state.turnsById.get(turnId)?.sourceInputID
    if (!sourceInputId || seen.has(sourceInputId)) continue
    seen.add(sourceInputId)
    orderedInputIds.push(sourceInputId)
  }
  for (const inputId of state.queue.inputIds) {
    if (seen.has(inputId)) continue
    seen.add(inputId)
    orderedInputIds.push(inputId)
  }
  return orderedInputIds.flatMap((inputId) => {
    const input = state.inputsById.get(inputId)
    if (!input) return []
    return [
      {
        id: input.id,
        input: { text: input.content, ...(input.skills ? { skills: input.skills } : {}) },
        previewText: input.skills?.length
          ? desktopUserMessageInputToPreviewText({ text: input.content, skills: input.skills })
          : input.content,
        createdAt: new Date(input.createdAt).toISOString(),
      },
    ]
  })
}

function selectPendingPermissions(state: CanonicalThreadState): DesktopPermissionRequest[] {
  const requests = new Map<
    string,
    { createdAt: number; priority: number; request: DesktopPermissionRequest }
  >()
  const add = (request: DesktopPermissionRequest, createdAt: number, priority: number): void => {
    const key = request.toolUseId || request.requestId
    const current = requests.get(key)
    if (!current || priority > current.priority) {
      requests.set(key, { createdAt, priority, request })
    }
  }

  for (const item of state.itemsById.values()) {
    if (item.type === 'question' && item.status === 'pending') {
      add(questionToRequest(item, state.thread.id), item.createdAt, 2)
    } else if (item.type === 'tool' && item.state === 'waiting-permission') {
      add(toolToRequest(item), item.createdAt, 1)
    }
  }
  for (const approval of state.approvalsById.values()) {
    if (approval.status === 'pending') {
      add(approvalToRequest(approval), approval.createdAt, 3)
    }
  }
  for (const interaction of state.hookTrustsById.values()) {
    add(
      {
        requestId: interaction.interactionId,
        toolName: 'HookTrust',
        toolUseId: interaction.interactionId,
        input: {
          configPath: interaction.configPath,
          configSha256: interaction.sha256,
          hook: interaction.hook,
        },
        description: `项目 Hook“${interaction.hook.name}”请求信任，是否允许？`,
        requestKind: 'tool',
      },
      interaction.createdAt,
      4,
    )
  }

  return [...requests.values()]
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((entry) => entry.request)
}

function extractCanonicalSourceLinks(items: readonly Item[]): SourceLink[] {
  const byUrl = new Map<string, SourceLink>()
  for (const item of items) {
    if (item.type !== 'text' || item.placement !== 'result' || item.status !== 'completed') {
      continue
    }
    let links = completedResultSourceLinks.get(item)
    if (!links) {
      links = extractLinksFromText(item.text)
      completedResultSourceLinks.set(item, links)
    }
    for (const source of links) {
      addSourceLink(byUrl, source)
    }
  }
  return [...byUrl.values()]
}

function fallbackTitleFromInput(content: string | undefined): string | null {
  return sessionTitleFromContent(content)
}

function compareCreatedAt(left: { createdAt: number }, right: { createdAt: number }): number {
  return left.createdAt - right.createdAt
}

function addSourceLink(byUrl: Map<string, SourceLink>, source: SourceLink): void {
  if (isLocalURL(source.url) || byUrl.has(source.url)) return
  byUrl.set(source.url, {
    label: truncateToWidth(source.label || source.url, 42),
    url: source.url,
  })
}

function extractLinksFromText(text: string): SourceLink[] {
  const links: SourceLink[] = []
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu
  for (const match of text.matchAll(markdownLinkPattern)) {
    const label = match[1]?.trim()
    const url = normalizeSourceURL(match[2] ?? '')
    if (url) links.push({ label: label || sourceLabelFromURL(url), url })
  }
  const bareUrlPattern = /https?:\/\/[^\s<>)\]]+/gu
  for (const match of text.matchAll(bareUrlPattern)) {
    const url = normalizeSourceURL(match[0] ?? '')
    if (url) links.push({ label: sourceLabelFromURL(url), url })
  }
  return links
}

function normalizeSourceURL(value: string): string | null {
  const normalized = value.trim().replace(/[.,;:!?]+$/u, '')
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    return null
  }
  try {
    return new URL(normalized).toString()
  } catch {
    return null
  }
}

function sourceLabelFromURL(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/$/u, '')
    return path ? `${parsed.hostname}${path}` : parsed.hostname
  } catch {
    return url
  }
}

function isLocalURL(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

function truncateToWidth(text: string, max: number): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(1, max - 1))}…`
}
