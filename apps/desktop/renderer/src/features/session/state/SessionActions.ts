import { sessionModelSelections } from './SessionModelSelectionStore.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { toUserErrorMessage, type ErrorContext } from '../../../utils/Errors.js'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ThreadCreationSurface } from '@pidex/shared/thread'
import type {
  DesktopModelSelection,
  DesktopPermissionDecision,
  LocalRouterMode,
  ModelProviderID,
  DesktopPermissionMode,
  DesktopPermissionConfig,
  DesktopPermissionRequest,
  DesktopSessionMetadataPatch,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopUserMessageInput,
  DesktopGoalSubmission,
  DesktopWorkspace,
} from '../../../../shared/Types.js'
import type { SessionListItem, SessionViewState } from '../../../UiTypes.js'
import {
  normalizeOptionalText,
  parseAdditionalDirectories,
} from '../../settings/SettingsStorage.js'
import {
  applySessionView,
  createEmptySessionView,
  setSessionView,
  type SessionViewStateSetters,
} from './SessionViewState.js'
import { sortSessionsByRecency } from './SessionSorting.js'
import { canonicalThreadCache } from './CanonicalThreadCache.js'
import {
  readPreferredSessionGroupId,
  writePreferredSessionGroupId,
} from '../../session-groups/SessionGroupPreference.js'

export type SessionSettingsSnapshot = {
  permissionMode: DesktopPermissionMode
  permissionConfig: DesktopPermissionConfig
  planModeActive: boolean
  localRouterMode: LocalRouterMode
  providerID: ModelProviderID
  providerBaseURL: string
  model: string
  sessionName: string
  variant?: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  installPidexDependencies: boolean
  enableMemory: boolean
  rustSearchAndDiffKernels: boolean
  creationSurface?: ThreadCreationSurface
}

export type SessionActionContext = {
  activeSessionIdRef: MutableRefObject<string | null>
  sessionsRef: MutableRefObject<SessionListItem[]>
  sessionViewsRef: MutableRefObject<Record<string, SessionViewState>>
  sessionWorkspacesRef: MutableRefObject<Record<string, DesktopWorkspace>>
  onErrorRef: MutableRefObject<(message: string) => void>
  viewSetters: SessionViewStateSetters
  setSessions: Dispatch<SetStateAction<SessionListItem[]>>
  setSessionId: Dispatch<SetStateAction<string | null>>
  setSessionStatus: Dispatch<SetStateAction<DesktopSessionStatus>>
}

export type CloseSessionResult = {
  nextActiveSession: SessionListItem | null
  nextWorkspace: DesktopWorkspace | null
}

export type ArchiveSessionsResult = CloseSessionResult & {
  failedSessionIds: string[]
  succeededSessionIds: string[]
}

export function activateSession(context: SessionActionContext, nextSessionId: string | null): void {
  const unreadAt = nextSessionId
    ? context.sessionsRef.current.find((session) => session.id === nextSessionId)?.unreadAt
    : null
  if (nextSessionId && unreadAt) {
    markSessionReadThrough(context, nextSessionId, unreadAt)
  }
  if (context.activeSessionIdRef.current === nextSessionId) {
    return
  }
  context.activeSessionIdRef.current = nextSessionId
  context.setSessionId(nextSessionId)
  void desktopClient.setActiveSession(nextSessionId).catch((error) => {
    context.onErrorRef.current(errorMessageOf(error))
  })
}

export function markSessionReadThrough(
  context: SessionActionContext,
  sessionId: string,
  readThroughAt: string,
): void {
  const shouldClearLocalUnread = context.sessionsRef.current.some(
    (session) =>
      session.id === sessionId &&
      session.unreadAt != null &&
      Date.parse(session.unreadAt) <= Date.parse(readThroughAt),
  )
  if (shouldClearLocalUnread) {
    context.sessionsRef.current = context.sessionsRef.current.map((session) =>
      session.id === sessionId &&
      session.unreadAt &&
      Date.parse(session.unreadAt) <= Date.parse(readThroughAt)
        ? { ...session, unreadAt: null }
        : session,
    )
    context.setSessions((current) =>
      current.map((session) =>
        session.id === sessionId &&
        session.unreadAt &&
        Date.parse(session.unreadAt) <= Date.parse(readThroughAt)
          ? { ...session, unreadAt: null }
          : session,
      ),
    )
  }
  void desktopClient.markSessionRead(sessionId, readThroughAt).catch((error) => {
    context.onErrorRef.current(errorMessageOf(error))
  })
}

export async function createSessionForWorkspaceAction(
  context: SessionActionContext,
  settings: SessionSettingsSnapshot,
  target: DesktopWorkspace | null,
  initialSessionName?: string,
  projectlessPrompt?: string,
  options?: { propagateError?: boolean },
): Promise<string | null> {
  try {
    const preferredSessionGroupId = readPreferredSessionGroupId()
    let workflowId: string | undefined
    if (preferredSessionGroupId) {
      const groups = await desktopClient.listSessionGroups().catch(() => [])
      if (groups.some((group) => group.id === preferredSessionGroupId))
        workflowId = preferredSessionGroupId
    }
    if (preferredSessionGroupId && !workflowId) writePreferredSessionGroupId(null)
    const session = await desktopClient.createSession({
      projectId: target?.projectId,
      workspacePath: target?.path,
      workflowId,
      creationSurface: settings.creationSurface,
      projectlessPrompt: target ? undefined : projectlessPrompt,
      localRouterMode: settings.localRouterMode,
      permissionConfig: settings.permissionConfig,
      planModeActive: settings.planModeActive,
      providerID: settings.providerID,
      providerBaseURL: normalizeOptionalText(settings.providerBaseURL),
      model: normalizeOptionalText(settings.model),
      sessionName: initialSessionName ?? normalizeOptionalText(settings.sessionName),
      thinkingMode: settings.thinkingMode,
      systemPrompt: normalizeOptionalText(settings.systemPrompt),
      appendSystemPrompt: normalizeOptionalText(settings.appendSystemPrompt),
      additionalDirectories: parseAdditionalDirectories(settings.additionalDirectories),
      installPidexDependencies: settings.installPidexDependencies,
      enableMemory: settings.enableMemory,
      rustSearchAndDiffKernels: settings.rustSearchAndDiffKernels,
    })
    const workspace = session.workspace
    const nextView = {
      ...(context.sessionViewsRef.current[session.sessionId] ?? createEmptySessionView()),
      eventModelVersion: 1 as const,
    }
    context.sessionWorkspacesRef.current = {
      ...context.sessionWorkspacesRef.current,
      [session.sessionId]: workspace,
    }
    setSessionView(context.sessionViewsRef, session.sessionId, nextView)
    activateSession(context, session.sessionId)
    context.setSessionStatus('idle')
    applySessionView(nextView, context.viewSetters)
    const now = new Date()
    context.setSessions((current) =>
      sortSessionsByRecency([
        {
          id: session.sessionId,
          sessionName: initialSessionName ?? normalizeOptionalText(settings.sessionName) ?? null,
          aiTitle: null,
          workspaceName: workspace.name,
          workspacePath: workspace.path,
          standalone: session.standalone,
          permissionMode: settings.permissionMode,
          planModeActive: settings.planModeActive,
          localRouterMode: settings.localRouterMode,
          model: normalizeOptionalText(settings.model) ?? null,
          thinkingMode: settings.thinkingMode,
          hasSystemPrompt: Boolean(normalizeOptionalText(settings.systemPrompt)),
          hasAppendSystemPrompt: Boolean(normalizeOptionalText(settings.appendSystemPrompt)),
          additionalDirectoryCount: parseAdditionalDirectories(settings.additionalDirectories)
            .length,
          status: 'idle',
          lastMessageAt: now.toISOString(),
          createdAt: now.toISOString(),
        },
        ...current,
      ]),
    )
    return session.sessionId
  } catch (error) {
    context.onErrorRef.current(errorMessageOf(error, 'thread-create'))
    if (options?.propagateError) throw error
    return null
  }
}

export async function submitSessionMessageAction(
  onErrorRef: MutableRefObject<(message: string) => void>,
  sessionId: string | null,
  input: DesktopUserMessageInput,
  canSubmit: boolean,
  settings: SessionSettingsSnapshot,
  options?: {
    sessionStatus?: DesktopSessionStatus
    delivery?: 'default' | 'follow-up'
    inputId?: string
    goal?: DesktopGoalSubmission
    propagateError?: boolean
  },
): Promise<'sent' | 'queued' | 'steered' | null> {
  if (!canSubmit || !sessionId) return null
  const delivery = options?.goal
    ? 'start'
    : resolveSessionMessageDelivery(options?.sessionStatus, options?.delivery)
  const modelSelection: DesktopModelSelection = {
    variant: settings.variant,
    providerID: settings.providerID,
    providerBaseURL: normalizeOptionalText(settings.providerBaseURL),
    model: normalizeOptionalText(settings.model),
    localRouterMode: settings.localRouterMode === 'off' ? undefined : settings.localRouterMode,
  }
  try {
    if (delivery === 'follow-up') {
      return await desktopClient.submitSessionFollowUp(
        sessionId,
        input,
        'follow-up',
        options?.inputId,
        modelSelection,
      )
    }
    if (delivery === 'steer') {
      return await desktopClient.submitSessionFollowUp(
        sessionId,
        input,
        'steer',
        options?.inputId,
        modelSelection,
      )
    }
    await desktopClient.sendUserMessage(
      sessionId,
      input,
      modelSelection,
      options?.inputId,
      options?.goal,
    )
    return 'sent'
  } catch (error) {
    onErrorRef.current(errorMessageOf(error, 'thread-send'))
    if (options?.propagateError) throw error
    return null
  }
}

export function resolveSessionMessageDelivery(
  sessionStatus: DesktopSessionStatus | undefined,
  intent: 'default' | 'follow-up' | undefined,
): 'start' | 'steer' | 'follow-up' {
  if (intent === 'follow-up') return 'follow-up'
  return sessionStatus === 'running' || sessionStatus === 'waiting' ? 'steer' : 'start'
}

export async function interruptSessionAction(
  onErrorRef: MutableRefObject<(message: string) => void>,
  sessionId: string | null,
): Promise<void> {
  if (!sessionId) return
  try {
    await desktopClient.interruptSession(sessionId)
  } catch (error) {
    onErrorRef.current(errorMessageOf(error))
    throw error
  }
}

export async function decidePermissionAction(
  onErrorRef: MutableRefObject<(message: string) => void>,
  sessionId: string | null,
  request: DesktopPermissionRequest,
  behavior: 'allow' | 'deny',
  alwaysAllow = false,
  updatedInput?: Record<string, unknown>,
  decisionExtras?: Pick<
    DesktopPermissionDecision,
    'grantScope' | 'computerGrant' | 'grantOptionId'
  >,
): Promise<void> {
  if (!sessionId) return
  try {
    await desktopClient.respondToPermission(sessionId, request.requestId, {
      behavior,
      message: behavior === 'deny' ? '在桌面端界面中拒绝' : undefined,
      alwaysAllow,
      updatedInput,
      ...decisionExtras,
    })
  } catch (error) {
    // 不在 RPC 成功前乐观移除请求卡片：成功后由 interaction/resolved 事件与
    // 刷新后的 snapshot 清理；失败或已被其他客户端处理时保留卡片供重试。
    onErrorRef.current(errorMessageOf(error))
    throw error
  }
}

export async function closeSessionAction(
  context: SessionActionContext,
  sessions: SessionListItem[],
  targetSessionId: string,
): Promise<CloseSessionResult | null> {
  try {
    await desktopClient.disposeSession(targetSessionId)
  } catch (error) {
    context.onErrorRef.current(errorMessageOf(error))
    return null
  }
  sessionModelSelections.delete(targetSessionId)
  canonicalThreadCache.invalidate(targetSessionId)

  const remaining = sessions.filter((session) => session.id !== targetSessionId)
  const { [targetSessionId]: _removedSessionView, ...remainingSessionViews } =
    context.sessionViewsRef.current
  const { [targetSessionId]: _removedWorkspace, ...remainingSessionWorkspaces } =
    context.sessionWorkspacesRef.current
  context.sessionViewsRef.current = remainingSessionViews
  context.sessionWorkspacesRef.current = remainingSessionWorkspaces
  context.setSessions(remaining)

  if (targetSessionId !== context.activeSessionIdRef.current) {
    return { nextActiveSession: null, nextWorkspace: null }
  }

  const next = remaining[0]
  activateSession(context, next?.id ?? null)
  context.setSessionStatus(next?.status ?? 'idle')
  if (next) {
    applySessionView(
      context.sessionViewsRef.current[next.id] ?? createEmptySessionView(),
      context.viewSetters,
    )
    const nextWorkspace = remainingSessionWorkspaces[next.id] ?? {
      name: next.workspaceName,
      path: next.workspacePath,
      isStandalone: next.standalone,
    }
    return {
      nextActiveSession: next,
      nextWorkspace: next.standalone ? null : nextWorkspace,
    }
  }
  applySessionView(createEmptySessionView(), context.viewSetters)
  return { nextActiveSession: null, nextWorkspace: null }
}

export async function updateSessionMetadataAction(
  context: SessionActionContext,
  sessions: SessionListItem[],
  targetSessionId: string,
  patch: DesktopSessionMetadataPatch,
): Promise<CloseSessionResult | null> {
  let updatedSession: SessionListItem | null = null
  try {
    const snapshot = await desktopClient.updateSessionMetadata(targetSessionId, patch)
    updatedSession = snapshot.item
  } catch (error) {
    context.onErrorRef.current(errorMessageOf(error))
    return null
  }

  const updatedSessions = sortSessionsByRecency(
    sessions.map((session) => (session.id === targetSessionId ? updatedSession! : session)),
  )
  context.setSessions(updatedSessions)
  if (updatedSession.archivedAt) {
    canonicalThreadCache.invalidate(targetSessionId)
  }

  const archivedActiveSession =
    targetSessionId === context.activeSessionIdRef.current && updatedSession.archivedAt
  if (!archivedActiveSession) {
    return { nextActiveSession: null, nextWorkspace: null }
  }

  const next = updatedSessions.find((session) => !session.archivedAt) ?? null
  activateSession(context, next?.id ?? null)
  context.setSessionStatus(next?.status ?? 'idle')
  if (next) {
    applySessionView(
      context.sessionViewsRef.current[next.id] ?? createEmptySessionView(),
      context.viewSetters,
    )
    const nextWorkspace = context.sessionWorkspacesRef.current[next.id] ?? {
      name: next.workspaceName,
      path: next.workspacePath,
      isStandalone: next.standalone,
    }
    return {
      nextActiveSession: next,
      nextWorkspace: next.standalone ? null : nextWorkspace,
    }
  }

  applySessionView(createEmptySessionView(), context.viewSetters)
  return { nextActiveSession: null, nextWorkspace: null }
}

export async function renameSessionAction(
  context: SessionActionContext,
  targetSessionId: string,
  title: string,
): Promise<SessionListItem | null> {
  const normalizedTitle = title.trim()
  if (!normalizedTitle) return null
  try {
    const snapshot = await desktopClient.renameSession(targetSessionId, normalizedTitle)
    context.setSessions((current) =>
      current.map((session) => (session.id === targetSessionId ? snapshot.item : session)),
    )
    return snapshot.item
  } catch (error) {
    context.onErrorRef.current(errorMessageOf(error))
    return null
  }
}

export async function archiveSessionsAction(
  context: SessionActionContext,
  sessions: SessionListItem[],
  targetSessionIds: readonly string[],
): Promise<ArchiveSessionsResult> {
  const uniqueIds = [...new Set(targetSessionIds)]
  const archivedAt = new Date().toISOString()
  const results = await Promise.allSettled(
    uniqueIds.map((sessionId) => desktopClient.updateSessionMetadata(sessionId, { archivedAt })),
  )
  const updatedById = new Map<string, SessionListItem>()
  const failedSessionIds: string[] = []
  for (const [index, result] of results.entries()) {
    const sessionId = uniqueIds[index]!
    if (result.status === 'fulfilled') {
      updatedById.set(sessionId, result.value.item)
    } else {
      failedSessionIds.push(sessionId)
    }
  }
  const succeededSessionIds = [...updatedById.keys()]
  for (const sessionId of succeededSessionIds) {
    canonicalThreadCache.invalidate(sessionId)
  }
  context.setSessions((current) =>
    sortSessionsByRecency(current.map((session) => updatedById.get(session.id) ?? session)),
  )
  const activeArchived = updatedById.has(context.activeSessionIdRef.current ?? '')
  if (!activeArchived) {
    return {
      failedSessionIds,
      succeededSessionIds,
      nextActiveSession: null,
      nextWorkspace: null,
    }
  }
  const next =
    sessions.find((session) => !updatedById.has(session.id) && !session.archivedAt) ?? null
  activateSession(context, next?.id ?? null)
  context.setSessionStatus(next?.status ?? 'idle')
  if (!next) {
    applySessionView(createEmptySessionView(), context.viewSetters)
    return {
      failedSessionIds,
      succeededSessionIds,
      nextActiveSession: null,
      nextWorkspace: null,
    }
  }
  applySessionView(
    context.sessionViewsRef.current[next.id] ?? createEmptySessionView(),
    context.viewSetters,
  )
  const nextWorkspace = context.sessionWorkspacesRef.current[next.id] ?? {
    name: next.workspaceName,
    path: next.workspacePath,
    isStandalone: next.standalone,
  }
  return {
    failedSessionIds,
    succeededSessionIds,
    nextActiveSession: next,
    nextWorkspace: next.standalone ? null : nextWorkspace,
  }
}

export async function setSessionPermissionModeAction(
  context: SessionActionContext,
  sessions: SessionListItem[],
  targetSessionId: string,
  mode: DesktopPermissionMode,
): Promise<SessionListItem | null> {
  try {
    const snapshot = await desktopClient.setSessionPermissionMode(targetSessionId, mode)
    const updatedItem = snapshot.item
    context.setSessions(
      sortSessionsByRecency(
        sessions.map((session) => (session.id === targetSessionId ? updatedItem : session)),
      ),
    )
    if (targetSessionId === context.activeSessionIdRef.current) {
      context.setSessionStatus(updatedItem.status)
    }
    return updatedItem
  } catch (error) {
    context.onErrorRef.current(errorMessageOf(error))
    return null
  }
}

export async function setSessionLocalRouterModeAction(
  context: SessionActionContext,
  sessions: SessionListItem[],
  targetSessionId: string,
  mode: LocalRouterMode,
): Promise<SessionListItem | null> {
  try {
    const snapshot = await desktopClient.setSessionLocalRouterMode(targetSessionId, mode)
    const updatedItem = snapshot.item
    context.setSessions(
      sortSessionsByRecency(
        sessions.map((session) => (session.id === targetSessionId ? updatedItem : session)),
      ),
    )
    if (targetSessionId === context.activeSessionIdRef.current) {
      context.setSessionStatus(updatedItem.status)
    }
    return updatedItem
  } catch (error) {
    context.onErrorRef.current(errorMessageOf(error))
    return null
  }
}

export async function setSessionPlanModeActiveAction(
  context: SessionActionContext,
  sessions: SessionListItem[],
  targetSessionId: string,
  active: boolean,
): Promise<SessionListItem | null> {
  try {
    const snapshot = await desktopClient.setSessionPlanModeActive(targetSessionId, active)
    const updatedItem = snapshot.item
    context.setSessions(
      sortSessionsByRecency(
        sessions.map((session) => (session.id === targetSessionId ? updatedItem : session)),
      ),
    )
    if (targetSessionId === context.activeSessionIdRef.current) {
      context.setSessionStatus(updatedItem.status)
    }
    return updatedItem
  } catch (error) {
    context.onErrorRef.current(errorMessageOf(error))
    return null
  }
}

function errorMessageOf(error: unknown, context?: ErrorContext): string {
  return toUserErrorMessage(error, context)
}
