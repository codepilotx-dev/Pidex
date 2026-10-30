import {
  sessionModelSelections,
  useSessionModelSelection,
  type SessionModelSelection,
} from './SessionModelSelectionStore.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { toUserErrorMessage } from '../../../utils/Errors.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ThreadCreationSurface } from '@pidex/shared/thread'
import type {
  DesktopComposerAttachment,
  DesktopContextUsage,
  DesktopSessionCatalogStatus,
  DesktopPermissionDecision,
  DesktopPermissionConfig,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopQueuedFollowUp,
  DesktopQueuePauseReason,
  DesktopSessionEvent,
  DesktopSessionMetadataPatch,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopUserMessageInput,
  DesktopGoalSubmission,
  DesktopWorkflowEvent,
  DesktopWorkspace,
  LocalRouterMode,
  ModelProviderID,
} from '../../../../shared/Types.js'
import type { Message, SessionListItem, SessionViewState } from '../../../UiTypes.js'
import { sessionViewFallbackTitle } from '../../../UiTypes.js'
import {
  activateSession,
  archiveSessionsAction,
  createSessionForWorkspaceAction,
  decidePermissionAction,
  interruptSessionAction,
  renameSessionAction,
  setSessionLocalRouterModeAction,
  setSessionGrillModeActiveAction,
  setSessionPermissionModeAction,
  setSessionPlanModeActiveAction,
  submitSessionMessageAction,
  updateSessionMetadataAction,
  type CloseSessionResult,
  type ArchiveSessionsResult,
  type SessionActionContext,
  type SessionSettingsSnapshot,
} from './SessionActions.js'
import { appendUniqueWorkflowEvent, dedupeWorkflowEvents } from '../workflow/WorkflowEventDedup.js'
import { mergeSessionStoreSnapshotView } from './SessionStoreMerge.js'
import { deriveWorkflowViewPatch } from '../workflow/WorkflowViewPatch.js'
import {
  applySessionView,
  createEmptySessionView,
  setSessionView,
  type SessionViewStateSetters,
  type UpdateSessionView,
} from './SessionViewState.js'
import {
  createSessionDisplayStore,
  useSessionDisplayField,
  type SessionDisplayStore,
} from './SessionDisplayStore.js'
import { sortSessionsByRecency } from './SessionSorting.js'
import type { ComposerDraftContentSnapshot, ComposerDraftKey } from '../composer/ComposerTypes.js'
import {
  composerDraftStore,
  resolveActivatedSessionComposerInput,
} from '../composer/ComposerDraftStore.js'

export type UseSessionStateOptions = {
  permissionMode: DesktopPermissionMode
  permissionConfig: DesktopPermissionConfig
  planModeActive: boolean
  grillModeActive: boolean
  localRouterMode: LocalRouterMode
  providerID: ModelProviderID
  providerBaseURL: string
  model: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  installPidexDependencies: boolean
  enableMemory: boolean
  rustSearchAndDiffKernels: boolean
  onError: (message: string) => void
  onDiffForActive: (patch: string) => void
  onRefreshActiveWorkspace: (sessionId: string) => void
  onOpenDrawerPermissions: () => void
}

export type SessionInputBinding = {
  store: SessionDisplayStore
  replace: (value: string) => void
}

export type UseSessionStateResult = {
  modelSelection: SessionModelSelection | null
  modelSelectionLoading: boolean
  modelSelectionError: string | null
  setModelSelection: (selection: SessionModelSelection) => void
  reloadModelSelection: () => void
  sessionId: string | null
  sessionsHydrated: boolean
  catalogStatus: DesktopSessionCatalogStatus
  sessions: SessionListItem[]
  sessionFallbackTitles: Record<string, string>
  sessionStatus: DesktopSessionStatus
  messages: Message[]
  events: DesktopSessionEvent[]
  workflowEvents: DesktopWorkflowEvent[]
  pendingPermissionSessionIds: ReadonlySet<string>
  contextUsage: DesktopContextUsage | null
  queuedFollowUps: DesktopQueuedFollowUp[]
  queuePauseReason: DesktopQueuePauseReason | null
  activeSessionItem: SessionListItem | null
  permissionMode: DesktopPermissionMode
  planModeActive: boolean
  grillModeActive: boolean
  localRouterMode: LocalRouterMode
  inputBinding: SessionInputBinding
  setInput: (value: string) => void
  composerAttachments: DesktopComposerAttachment[]
  setComposerAttachments: (
    value:
      | DesktopComposerAttachment[]
      | ((current: DesktopComposerAttachment[]) => DesktopComposerAttachment[]),
  ) => void
  appendComposerAttachmentsForDraft: (
    draftKey: ComposerDraftKey,
    attachments: DesktopComposerAttachment[],
  ) => void
  removeComposerAttachmentForDraft: (draftKey: ComposerDraftKey, attachmentId: string) => void
  clearComposerDraftIfUnchanged: (
    draftKey: ComposerDraftKey,
    snapshot: ComposerDraftContentSnapshot,
  ) => boolean
  activateSessionById: (targetSessionId: string | null) => DesktopWorkspace | null
  createSessionForWorkspace: (
    target?: DesktopWorkspace | null,
    initialSessionName?: string,
    projectlessPrompt?: string,
    creationSurface?: ThreadCreationSurface,
  ) => Promise<string | null>
  submitToSession: (
    targetSessionId: string,
    value: DesktopUserMessageInput,
    options?: {
      delivery?: 'default' | 'follow-up'
      inputId?: string
      goal?: DesktopGoalSubmission
      propagateError?: boolean
    },
  ) => Promise<'sent' | 'queued' | 'steered' | null>
  interrupt: () => Promise<void>
  decidePermission: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
    decisionExtras?: Pick<
      DesktopPermissionDecision,
      'grantScope' | 'computerGrant' | 'grantOptionId'
    >,
  ) => Promise<void>
  updateSessionMetadata: (
    targetSessionId: string,
    patch: DesktopSessionMetadataPatch,
  ) => Promise<CloseSessionResult | null>
  archiveSessions: (targetSessionIds: readonly string[]) => Promise<ArchiveSessionsResult>
  renameSession: (targetSessionId: string, title: string) => Promise<SessionListItem | null>
  setSessionPermissionMode: (
    targetSessionId: string,
    mode: DesktopPermissionMode,
  ) => Promise<SessionListItem | null>
  setSessionPlanModeActive: (
    targetSessionId: string,
    active: boolean,
  ) => Promise<SessionListItem | null>
  setSessionGrillModeActive: (
    targetSessionId: string,
    active: boolean,
  ) => Promise<SessionListItem | null>
  setSessionLocalRouterMode: (
    targetSessionId: string,
    mode: LocalRouterMode,
  ) => Promise<SessionListItem | null>
}

export function useSessionState(options: UseSessionStateOptions): UseSessionStateResult {
  const {
    permissionMode,
    permissionConfig,
    planModeActive,
    grillModeActive,
    localRouterMode,
    providerID,
    providerBaseURL,
    model,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    installPidexDependencies,
    enableMemory,
    rustSearchAndDiffKernels,
    onError,
    onOpenDrawerPermissions,
  } = options

  /**
   * 会话展示状态进入按窗口实例创建的 Zustand Store：消费者可按字段订阅，
   * 跨会话的 per-session view 缓存仍留在 refs，只投影活动会话字段。
   */
  const [displayStore] = useState<SessionDisplayStore>(createSessionDisplayStore)
  const sessionId = useSessionDisplayField(displayStore, (state) => state.sessionId)
  const setSessionId = displayStore.setSessionId
  const modelSelectionState = useSessionModelSelection(sessionId)
  const reloadModelSelection = useCallback(() => {
    void sessionModelSelections
      .load(sessionId)
      .catch((error) => onErrorRef.current(toUserErrorMessage(error)))
  }, [sessionId])
  useEffect(() => {
    reloadModelSelection()
  }, [reloadModelSelection])
  const setModelSelection = useCallback(
    (selection: SessionModelSelection) => {
      sessionModelSelections.set(sessionId, selection)
      // 一级页切换模型立即记住；已有任务保持任务级隔离。
      // 只有最后一次选择保存失败时才提示，中间失败不覆盖更新的选择。
      void sessionModelSelections
        .persistRecent(sessionId, selection)
        .catch((error) => onErrorRef.current(toUserErrorMessage(error)))
    },
    [sessionId],
  )
  const sessionsHydrated = useSessionDisplayField(displayStore, (state) => state.sessionsHydrated)
  const catalogStatus = useSessionDisplayField(displayStore, (state) => state.catalogStatus)
  const sessions = useSessionDisplayField(displayStore, (state) => state.sessions)
  const sessionFallbackTitles = useSessionDisplayField(
    displayStore,
    (state) => state.sessionFallbackTitles,
  )
  const sessionStatus = useSessionDisplayField(displayStore, (state) => state.sessionStatus)
  const messages = useSessionDisplayField(displayStore, (state) => state.messages)
  const events = useSessionDisplayField(displayStore, (state) => state.events)
  const workflowEvents = useSessionDisplayField(displayStore, (state) => state.workflowEvents)
  const pendingPermissionSessionIds = useSessionDisplayField(
    displayStore,
    (state) => state.pendingPermissionSessionIds,
  )
  const contextUsage = useSessionDisplayField(displayStore, (state) => state.contextUsage)
  const queuedFollowUps = useSessionDisplayField(displayStore, (state) => state.queuedFollowUps)
  const queuePauseReason = useSessionDisplayField(displayStore, (state) => state.queuePauseReason)
  const composerAttachments = useSessionDisplayField(
    displayStore,
    (state) => state.composerAttachments,
  )
  const setSessionsHydrated = displayStore.setSessionsHydrated
  const setCatalogStatus = displayStore.setCatalogStatus
  const setSessions = displayStore.setSessions
  const setSessionFallbackTitles = displayStore.setSessionFallbackTitles
  const setSessionStatus = displayStore.setSessionStatus
  const setPendingPermissionSessionIds = displayStore.setPendingPermissionSessionIds
  const setQueuedFollowUps = displayStore.setQueuedFollowUps
  const setQueuePauseReason = displayStore.setQueuePauseReason
  const setInput = displayStore.setInput
  const setComposerAttachments = displayStore.setComposerAttachments
  const activeSessionItem = useMemo(
    () => sessions.find((session) => session.id === sessionId) ?? null,
    [sessions, sessionId],
  )
  const effectivePermissionMode = activeSessionItem?.permissionMode ?? permissionMode
  const effectivePlanModeActive = activeSessionItem?.planModeActive ?? planModeActive
  const effectiveGrillModeActive = activeSessionItem?.grillModeActive ?? grillModeActive
  const effectiveLocalRouterMode = activeSessionItem?.id.startsWith('browser-mock-')
    ? (activeSessionItem.localRouterMode ?? localRouterMode)
    : 'off'

  const activeSessionIdRef = useRef<string | null>(null)
  const sessionsRef = useRef<SessionListItem[]>([])
  const sessionStatusRef = useRef<DesktopSessionStatus>('idle')
  const sessionViewsRef = useRef<Record<string, SessionViewState>>({})
  const sessionWorkspacesRef = useRef<Record<string, DesktopWorkspace>>({})
  const inputBySessionRef = useRef<Record<string, string>>({})
  const attachmentsBySessionRef = useRef<Record<string, DesktopComposerAttachment[]>>({})
  const queueStateBySessionRef = useRef<
    Record<
      string,
      {
        items: DesktopQueuedFollowUp[]
        pauseReason: DesktopQueuePauseReason | null
      }
    >
  >({})
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onOpenDrawerPermissionsRef = useRef(onOpenDrawerPermissions)
  onOpenDrawerPermissionsRef.current = onOpenDrawerPermissions

  const viewSetters = useMemo<SessionViewStateSetters>(
    () => ({
      setEvents: displayStore.setEvents,
      setWorkflowEvents: displayStore.setWorkflowEvents,
      setMessages: displayStore.setMessages,
      setContextUsage: displayStore.setContextUsage,
    }),
    [displayStore],
  )
  const actionContext = useMemo<SessionActionContext>(
    () => ({
      activeSessionIdRef,
      sessionsRef,
      sessionViewsRef,
      sessionWorkspacesRef,
      onErrorRef,
      viewSetters,
      setSessions,
      setSessionId,
      setSessionStatus,
    }),
    [viewSetters, setSessions, setSessionId, setSessionStatus],
  )

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    sessionStatusRef.current = sessionStatus
  }, [sessionStatus])

  const setScopedInput = useCallback((value: string): void => {
    const key = activeSessionIdRef.current ?? HOME_INPUT_KEY
    inputBySessionRef.current = {
      ...inputBySessionRef.current,
      [key]: value,
    }
    setInput(value)
  }, [setInput])

  const inputBinding = useMemo<SessionInputBinding>(
    () => ({
      store: displayStore,
      replace: setScopedInput,
    }),
    [displayStore, setScopedInput],
  )

  const setScopedComposerAttachments = useCallback(
    (
      value:
        | DesktopComposerAttachment[]
        | ((current: DesktopComposerAttachment[]) => DesktopComposerAttachment[]),
    ): void => {
      const key = activeSessionIdRef.current ?? HOME_INPUT_KEY
      const current = attachmentsBySessionRef.current[key] ?? []
      const next = typeof value === 'function' ? value(current) : value
      attachmentsBySessionRef.current = {
        ...attachmentsBySessionRef.current,
        [key]: next,
      }
      setComposerAttachments(next)
    },
    [setComposerAttachments],
  )

  const appendComposerAttachmentsForDraft = useCallback(
    (draftKey: ComposerDraftKey, nextAttachments: DesktopComposerAttachment[]): void => {
      if (nextAttachments.length === 0) return
      const key = composerDraftStorageKey(draftKey)
      const current = attachmentsBySessionRef.current[key] ?? []
      const existingIds = new Set(current.map((attachment) => attachment.id))
      const next = [
        ...current,
        ...nextAttachments.filter((attachment) => !existingIds.has(attachment.id)),
      ]
      attachmentsBySessionRef.current = {
        ...attachmentsBySessionRef.current,
        [key]: next,
      }
      if (isActiveComposerDraftKey(draftKey, activeSessionIdRef.current)) {
        setComposerAttachments(next)
      }
    },
    [setComposerAttachments],
  )

  const removeComposerAttachmentForDraft = useCallback(
    (draftKey: ComposerDraftKey, attachmentId: string): void => {
      const key = composerDraftStorageKey(draftKey)
      const current = attachmentsBySessionRef.current[key] ?? []
      const next = current.filter((attachment) => attachment.id !== attachmentId)
      attachmentsBySessionRef.current = {
        ...attachmentsBySessionRef.current,
        [key]: next,
      }
      if (isActiveComposerDraftKey(draftKey, activeSessionIdRef.current)) {
        setComposerAttachments(next)
      }
    },
    [setComposerAttachments],
  )

  const clearComposerDraftIfUnchanged = useCallback(
    (draftKey: ComposerDraftKey, snapshot: ComposerDraftContentSnapshot): boolean => {
      const key = composerDraftStorageKey(draftKey)
      const currentInput = inputBySessionRef.current[key] ?? ''
      const currentAttachments = attachmentsBySessionRef.current[key] ?? []
      if (
        currentInput !== snapshot.text ||
        !sameAttachmentIds(currentAttachments, snapshot.attachments)
      ) {
        return false
      }
      inputBySessionRef.current = {
        ...inputBySessionRef.current,
        [key]: '',
      }
      attachmentsBySessionRef.current = {
        ...attachmentsBySessionRef.current,
        [key]: [],
      }
      if (isActiveComposerDraftKey(draftKey, activeSessionIdRef.current)) {
        setInput('')
        setComposerAttachments([])
      }
      return true
    },
    [setInput, setComposerAttachments],
  )

  const syncPendingPermissionSessionIds = useCallback((): void => {
    const next = buildPendingPermissionSessionIds(sessionViewsRef.current)
    setPendingPermissionSessionIds((current) => (sameSessionIdSet(current, next) ? current : next))
  }, [setPendingPermissionSessionIds])

  const updateSessionView = useCallback<UpdateSessionView>(
    (targetSessionId, updater) => {
      const nextView = updater(sessionViewsRef.current[targetSessionId] ?? createEmptySessionView())
      setSessionView(sessionViewsRef, targetSessionId, nextView)
      if (targetSessionId === activeSessionIdRef.current) {
        applySessionView(nextView, viewSetters)
      }
      syncPendingPermissionSessionIds()
      setSessionFallbackTitles((current) =>
        updateSessionFallbackTitle(
          current,
          targetSessionId,
          sessionViewsRef.current[targetSessionId],
        ),
      )
    },
    [syncPendingPermissionSessionIds, viewSetters, setSessionFallbackTitles],
  )

  const handleWorkflowEvent = useCallback(
    (event: DesktopWorkflowEvent): void => {
      if (!sessionsRef.current.some((session) => session.id === event.threadId)) {
        return
      }
      const shouldOpenPermissions =
        event.threadId === activeSessionIdRef.current &&
        'item' in event &&
        event.item.type === 'permission_request' &&
        event.item.status === 'in_progress'
      updateSessionView(event.threadId, (view) => ({
        ...view,
        ...deriveWorkflowViewPatch(
          appendUniqueWorkflowEvent(view.workflowEvents, event),
          view,
          event.threadId,
        ),
      }))
      if (shouldOpenPermissions) {
        onOpenDrawerPermissionsRef.current()
      }
    },
    [updateSessionView],
  )

  useEffect(() => {
    const unsubscribeWorkflow = desktopClient.onWorkflowEvent(handleWorkflowEvent)
    return () => {
      unsubscribeWorkflow()
    }
  }, [handleWorkflowEvent])

  useEffect(() => {
    const unsubscribe = desktopClient.onSessionStoreChange((change) => {
      const nextSessions = sortSessionsByRecency(change.sessions.map((snapshot) => snapshot.item))
      const nextViews = { ...sessionViewsRef.current }
      const nextWorkspaces = { ...sessionWorkspacesRef.current }
      const nextQueueStates = { ...queueStateBySessionRef.current }
      for (const snapshot of change.sessions) {
        const snapshotView = mergeSessionStoreSnapshotView(nextViews[snapshot.item.id], snapshot)
        nextViews[snapshot.item.id] = {
          ...snapshotView,
          ...deriveWorkflowViewPatch(snapshotView.workflowEvents, snapshotView, snapshot.item.id),
        }
        nextWorkspaces[snapshot.item.id] = snapshot.workspace
        nextQueueStates[snapshot.item.id] = {
          items: snapshot.queuedFollowUps ?? [],
          pauseReason: snapshot.queuePauseReason ?? null,
        }
      }
      const knownIds = new Set(change.sessions.map((snapshot) => snapshot.item.id))
      for (const id of Object.keys(nextViews)) {
        if (!knownIds.has(id)) {
          delete nextViews[id]
        }
      }
      for (const id of Object.keys(nextWorkspaces)) {
        if (!knownIds.has(id)) {
          delete nextWorkspaces[id]
        }
      }
      for (const id of Object.keys(nextQueueStates)) {
        if (!knownIds.has(id)) {
          delete nextQueueStates[id]
        }
      }
      sessionViewsRef.current = nextViews
      sessionWorkspacesRef.current = nextWorkspaces
      queueStateBySessionRef.current = nextQueueStates
      sessionsRef.current = nextSessions
      setPendingPermissionSessionIds(
        change.pendingInteractionThreadIds
          ? new Set(change.pendingInteractionThreadIds)
          : buildPendingPermissionSessionIds(nextViews),
      )
      setSessions(nextSessions)
      setSessionFallbackTitles(buildSessionFallbackTitles(nextViews))

      const currentId = activeSessionIdRef.current
      if (!currentId) return
      const currentSession = nextSessions.find((session) => session.id === currentId)
      if (!currentSession || currentSession.archivedAt) {
        activeSessionIdRef.current = null
        setSessionId(null)
        setSessionStatus('idle')
        setQueuedFollowUps([])
        setQueuePauseReason(null)
        applySessionView(createEmptySessionView(), viewSetters)
        setInput(inputBySessionRef.current[HOME_INPUT_KEY] ?? '')
        setComposerAttachments(attachmentsBySessionRef.current[HOME_INPUT_KEY] ?? [])
        return
      }
      setSessionStatus(currentSession.status)
      const currentQueueState = nextQueueStates[currentId]
      setQueuedFollowUps(currentQueueState?.items ?? [])
      setQueuePauseReason(currentQueueState?.pauseReason ?? null)
      applySessionView(nextViews[currentId] ?? createEmptySessionView(), viewSetters)
    })
    return () => {
      unsubscribe()
    }
  }, [viewSetters, setSessions, setSessionId, setSessionStatus, setSessionsHydrated, setCatalogStatus, setSessionFallbackTitles, setPendingPermissionSessionIds, setQueuedFollowUps, setQueuePauseReason, setInput, setComposerAttachments])

  useEffect(() => {
    const unsubscribe = desktopClient.onReconciliationError?.((error) => {
      onErrorRef.current(toUserErrorMessage(error, 'thread-read'))
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    async function hydrateSessions(): Promise<void> {
      try {
        const sessionSnapshots = await desktopClient.listSessions()
        const nextCatalogStatus = await desktopClient.getSessionCatalogStatus()
        if (disposed) return

        setCatalogStatus(nextCatalogStatus)

        const nextSessions = sortSessionsByRecency(
          sessionSnapshots.map((snapshot) => snapshot.item),
        )
        const nextViews: Record<string, SessionViewState> = {}
        const nextWorkspaces: Record<string, DesktopWorkspace> = {}
        const nextQueueStates: typeof queueStateBySessionRef.current = {}
        for (const snapshot of sessionSnapshots) {
          const snapshotView: SessionViewState = {
            ...snapshot.view,
            eventModelVersion: snapshot.eventModelVersion,
            events: snapshot.events ?? [],
            workflowEvents: dedupeWorkflowEvents(snapshot.workflowEvents ?? []),
            contextUsage: snapshot.view.contextUsage ?? null,
            selectedFile: null,
          }
          nextViews[snapshot.item.id] = {
            ...snapshotView,
            ...deriveWorkflowViewPatch(snapshotView.workflowEvents, snapshotView, snapshot.item.id),
          }
          nextWorkspaces[snapshot.item.id] = snapshot.workspace
          nextQueueStates[snapshot.item.id] = {
            items: snapshot.queuedFollowUps ?? [],
            pauseReason: snapshot.queuePauseReason ?? null,
          }
        }

        sessionViewsRef.current = nextViews
        sessionWorkspacesRef.current = nextWorkspaces
        queueStateBySessionRef.current = nextQueueStates
        sessionsRef.current = nextSessions
        setPendingPermissionSessionIds(buildPendingPermissionSessionIds(nextViews))
        setSessions(nextSessions)
        setSessionFallbackTitles(buildSessionFallbackTitles(nextViews))

        activeSessionIdRef.current = null
        setSessionId(null)
        setSessionStatus('idle')
        setQueuedFollowUps([])
        setQueuePauseReason(null)
        applySessionView(createEmptySessionView(), viewSetters)
        setInput(inputBySessionRef.current[HOME_INPUT_KEY] ?? '')
        setComposerAttachments(attachmentsBySessionRef.current[HOME_INPUT_KEY] ?? [])
        setSessionsHydrated(true)
      } catch (error) {
        setCatalogStatus({
          state: 'unavailable',
        })
        onErrorRef.current(toUserErrorMessage(error, 'thread-read'))
        setSessionsHydrated(true)
      }
    }
    void hydrateSessions()
    return () => {
      disposed = true
    }
  }, [viewSetters, setSessions, setSessionId, setSessionStatus, setSessionsHydrated, setCatalogStatus, setSessionFallbackTitles, setPendingPermissionSessionIds, setQueuedFollowUps, setQueuePauseReason, setInput, setComposerAttachments])

  const settingsSnapshot = useMemo<SessionSettingsSnapshot>(
    () => ({
      permissionMode: effectivePermissionMode,
      permissionConfig,
      planModeActive: effectivePlanModeActive,
      grillModeActive: effectiveGrillModeActive,
      localRouterMode: effectiveLocalRouterMode,
      providerID,
      providerBaseURL,
      model,
      sessionName,
      thinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
      installPidexDependencies,
      enableMemory,
      rustSearchAndDiffKernels,
    }),
    [
      additionalDirectories,
      appendSystemPrompt,
      installPidexDependencies,
      enableMemory,
      rustSearchAndDiffKernels,
      model,
      effectiveLocalRouterMode,
      effectivePermissionMode,
      permissionConfig,
      effectivePlanModeActive,
      providerBaseURL,
      providerID,
      sessionName,
      systemPrompt,
      thinkingMode,
    ],
  )

  const createSessionForWorkspace = useCallback(
    async (
      target: DesktopWorkspace | null,
      initialSessionName?: string,
      projectlessPrompt?: string,
      creationSurface?: ThreadCreationSurface,
    ): Promise<string | null> => {
      const selection = await sessionModelSelections.load(null)
      const nextSessionId = await createSessionForWorkspaceAction(
        actionContext,
        {
          ...settingsSnapshot,
          ...selection,
          providerBaseURL: '',
          ...(creationSurface ? { creationSurface } : {}),
        },
        target,
        initialSessionName,
        projectlessPrompt,
        { propagateError: true },
      )
      if (!nextSessionId) return null
      sessionModelSelections.set(nextSessionId, selection)

      const homeInput = inputBySessionRef.current[HOME_INPUT_KEY] ?? ''
      const homeAttachments = attachmentsBySessionRef.current[HOME_INPUT_KEY] ?? []
      const { [HOME_INPUT_KEY]: _homeInput, ...remainingInputs } = inputBySessionRef.current
      const { [HOME_INPUT_KEY]: _homeAttachments, ...remainingAttachments } =
        attachmentsBySessionRef.current
      inputBySessionRef.current = {
        ...remainingInputs,
        [nextSessionId]: homeInput,
      }
      attachmentsBySessionRef.current = {
        ...remainingAttachments,
        [nextSessionId]: homeAttachments,
      }
      return nextSessionId
    },
    [actionContext, settingsSnapshot],
  )

  const activateSessionById = useCallback(
    (targetSessionId: string | null): DesktopWorkspace | null => {
      if (!targetSessionId) {
        activateSession(actionContext, null)
        setSessionStatus('idle')
        setQueuedFollowUps([])
        setQueuePauseReason(null)
        applySessionView(createEmptySessionView(), viewSetters)
        setInput(inputBySessionRef.current[HOME_INPUT_KEY] ?? '')
        setComposerAttachments(attachmentsBySessionRef.current[HOME_INPUT_KEY] ?? [])
        return null
      }

      const targetSession = sessionsRef.current.find((session) => session.id === targetSessionId)
      if (!targetSession) {
        return null
      }

      activateSession(actionContext, targetSessionId)
      setSessionStatus(targetSession.status)
      const queueState = queueStateBySessionRef.current[targetSessionId]
      setQueuedFollowUps(queueState?.items ?? [])
      setQueuePauseReason(queueState?.pauseReason ?? null)
      applySessionView(
        sessionViewsRef.current[targetSessionId] ?? createEmptySessionView(),
        viewSetters,
      )
      const currentInput = inputBySessionRef.current[targetSessionId]
      const nextInput = resolveActivatedSessionComposerInput(
        currentInput,
        composerDraftStore.peek(`session:${targetSessionId}`)?.document.text,
      )
      if (nextInput !== currentInput) {
        inputBySessionRef.current = {
          ...inputBySessionRef.current,
          [targetSessionId]: nextInput,
        }
      }
      setInput(nextInput)
      setComposerAttachments(attachmentsBySessionRef.current[targetSessionId] ?? [])
      if (targetSession.standalone) {
        return null
      }
      return (
        sessionWorkspacesRef.current[targetSessionId] ?? {
          name: targetSession.workspaceName,
          path: targetSession.workspacePath,
        }
      )
    },
    [actionContext, viewSetters, setSessionStatus, setQueuedFollowUps, setQueuePauseReason, setInput, setComposerAttachments],
  )

  const submitToSession = useCallback(
    async (
      targetSessionId: string,
      value: DesktopUserMessageInput,
      options?: {
        delivery?: 'default' | 'follow-up'
        inputId?: string
        goal?: DesktopGoalSubmission
        propagateError?: boolean
      },
    ): Promise<'sent' | 'queued' | 'steered' | null> => {
      const targetStatus =
        sessionsRef.current.find((session) => session.id === targetSessionId)?.status ??
        (activeSessionIdRef.current === targetSessionId ? sessionStatusRef.current : 'idle')
      let selection: SessionModelSelection
      try {
        selection = await sessionModelSelections.load(targetSessionId)
        if (!selection.providerID || !selection.model) throw new Error('请先选择会话模型')
      } catch (error) {
        onErrorRef.current(toUserErrorMessage(error))
        if (options?.propagateError) throw error
        return null
      }
      return submitSessionMessageAction(
        onErrorRef,
        targetSessionId,
        value,
        Boolean(
          targetSessionId &&
          (value.text.trim() ||
            (value.attachments?.length ?? 0) > 0 ||
            value.skillInvocation ||
            value.skills?.length),
        ),
        { ...settingsSnapshot, ...selection, providerBaseURL: '' },
        {
          sessionStatus: targetStatus,
          delivery: options?.delivery,
          inputId: options?.inputId,
          propagateError: options?.propagateError,
          goal: options?.goal,
        },
      )
    },
    [settingsSnapshot],
  )

  const interrupt = useCallback(async (): Promise<void> => {
    await interruptSessionAction(onErrorRef, sessionId)
  }, [sessionId])

  const decidePermission = useCallback(
    async (
      request: DesktopPermissionRequest,
      behavior: 'allow' | 'deny',
      alwaysAllow = false,
      updatedInput?: Record<string, unknown>,
      decisionExtras?: Pick<
        DesktopPermissionDecision,
        'grantScope' | 'computerGrant' | 'grantOptionId'
      >,
    ): Promise<void> => {
      await decidePermissionAction(
        onErrorRef,
        sessionId,
        request,
        behavior,
        alwaysAllow,
        updatedInput,
        decisionExtras,
      )
    },
    [sessionId],
  )

  const updateSessionMetadata = useCallback(
    async (
      targetSessionId: string,
      patch: DesktopSessionMetadataPatch,
    ): Promise<CloseSessionResult | null> =>
      updateSessionMetadataAction(actionContext, sessions, targetSessionId, patch),
    [actionContext, sessions],
  )

  const archiveSessions = useCallback(
    async (targetSessionIds: readonly string[]): Promise<ArchiveSessionsResult> =>
      archiveSessionsAction(actionContext, sessions, targetSessionIds),
    [actionContext, sessions],
  )

  const renameSession = useCallback(
    async (targetSessionId: string, title: string): Promise<SessionListItem | null> =>
      renameSessionAction(actionContext, targetSessionId, title),
    [actionContext],
  )

  const setSessionPermissionMode = useCallback(
    async (targetSessionId: string, mode: DesktopPermissionMode): Promise<SessionListItem | null> =>
      setSessionPermissionModeAction(actionContext, sessions, targetSessionId, mode),
    [actionContext, sessions],
  )

  const setSessionPlanModeActive = useCallback(
    async (targetSessionId: string, active: boolean): Promise<SessionListItem | null> =>
      setSessionPlanModeActiveAction(actionContext, sessions, targetSessionId, active),
    [actionContext, sessions],
  )

  const setSessionGrillModeActive = useCallback(
    async (targetSessionId: string, active: boolean): Promise<SessionListItem | null> =>
      setSessionGrillModeActiveAction(actionContext, sessions, targetSessionId, active),
    [actionContext, sessions],
  )

  const setSessionLocalRouterMode = useCallback(
    async (targetSessionId: string, mode: LocalRouterMode): Promise<SessionListItem | null> =>
      setSessionLocalRouterModeAction(actionContext, sessions, targetSessionId, mode),
    [actionContext, sessions],
  )

  return {
    modelSelection: modelSelectionState.selection,
    modelSelectionLoading: modelSelectionState.loading,
    modelSelectionError: modelSelectionState.error,
    setModelSelection,
    reloadModelSelection,
    sessionId,
    sessionsHydrated,
    catalogStatus,
    sessions,
    sessionFallbackTitles,
    sessionStatus,
    messages,
    events,
    workflowEvents,
    pendingPermissionSessionIds,
    contextUsage,
    queuedFollowUps,
    queuePauseReason,
    activeSessionItem,
    permissionMode: effectivePermissionMode,
    planModeActive: effectivePlanModeActive,
    grillModeActive: effectiveGrillModeActive,
    localRouterMode: effectiveLocalRouterMode,
    inputBinding,
    setInput: setScopedInput,
    composerAttachments,
    setComposerAttachments: setScopedComposerAttachments,
    appendComposerAttachmentsForDraft,
    removeComposerAttachmentForDraft,
    clearComposerDraftIfUnchanged,
    activateSessionById,
    createSessionForWorkspace,
    submitToSession,
    interrupt,
    decidePermission,
    updateSessionMetadata,
    archiveSessions,
    renameSession,
    setSessionPermissionMode,
    setSessionPlanModeActive,
    setSessionGrillModeActive,
    setSessionLocalRouterMode,
  }
}

const HOME_INPUT_KEY = '__home__'

function composerDraftStorageKey(draftKey: ComposerDraftKey): string {
  return draftKey === 'home' ? HOME_INPUT_KEY : draftKey.slice('session:'.length)
}

function isActiveComposerDraftKey(
  draftKey: ComposerDraftKey,
  activeSessionId: string | null,
): boolean {
  return draftKey === (activeSessionId ? `session:${activeSessionId}` : 'home')
}

function sameAttachmentIds(
  left: DesktopComposerAttachment[],
  right: DesktopComposerAttachment[],
): boolean {
  return (
    left.length === right.length &&
    left.every((attachment, index) => attachment.id === right[index]?.id)
  )
}

function buildSessionFallbackTitles(
  views: Record<string, SessionViewState>,
): Record<string, string> {
  const titles: Record<string, string> = {}
  for (const [sessionId, view] of Object.entries(views)) {
    const title = sessionViewFallbackTitle(view)
    if (title) {
      titles[sessionId] = title
    }
  }
  return titles
}

function buildPendingPermissionSessionIds(views: Record<string, SessionViewState>): Set<string> {
  const ids = new Set<string>()
  for (const [sessionId, view] of Object.entries(views)) {
    if (view.pendingPermissions.length > 0) {
      ids.add(sessionId)
    }
  }
  return ids
}

function sameSessionIdSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false
  for (const id of left) {
    if (!right.has(id)) return false
  }
  return true
}

function updateSessionFallbackTitle(
  current: Record<string, string>,
  sessionId: string,
  view: SessionViewState | undefined,
): Record<string, string> {
  const title = view ? sessionViewFallbackTitle(view) : null
  if (title) {
    if (current[sessionId] === title) return current
    return { ...current, [sessionId]: title }
  }
  if (!(sessionId in current)) return current
  const next = { ...current }
  delete next[sessionId]
  return next
}
