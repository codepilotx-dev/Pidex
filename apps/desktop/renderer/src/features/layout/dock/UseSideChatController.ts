import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopComposerAttachment,
  DesktopPermissionMode,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopUserMessageInput,
  ModelProviderID,
} from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { sessionModelSelections } from '../../session/state/SessionModelSelectionStore.js'
import { forgetThreadScrollState } from '../../session/conversation/UseThreadScrollController.js'
import type {
  ComposerDeliveryIntent,
  ComposerDraftContentSnapshot,
  ComposerDraftKey,
} from '../../session/composer/ComposerTypes.js'
import type { WorkbenchTabDescriptor } from './RightDockState.js'

type SideChatTab = Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>

type Draft = {
  input: string
  attachments: DesktopComposerAttachment[]
}

export type SideChatComposerSettings = {
  permissionMode: DesktopPermissionMode
  planModeActive: boolean
  providerID: ModelProviderID
  providerBaseURL?: string
  model: string
  selectedModelPreset: string
  thinkingMode: DesktopThinkingMode
  variant?: string
}

type PendingClose = {
  tabs: SideChatTab[]
  resolve: (closed: boolean) => void
}

const SKIP_CLOSE_CONFIRMATION_KEY = 'side-chat.skip-close-confirmation'

export function reusePendingSideChatCreation<T>(
  pending: Map<string, Promise<T>>,
  key: string,
  create: () => Promise<T>,
): Promise<T> {
  const existing = pending.get(key)
  if (existing) return existing
  const request = Promise.resolve()
    .then(create)
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key)
    })
  pending.set(key, request)
  return request
}

export function useSideChatController({
  activeTab,
  initialSettings,
  sourceThreadId,
  openRightDockTab,
  removeWorkbenchTab,
  replaceWorkbenchTab,
  onError,
}: {
  activeTab: SideChatTab | null
  initialSettings: SideChatComposerSettings
  sourceThreadId: string | null
  openRightDockTab: (tab: WorkbenchTabDescriptor) => void
  removeWorkbenchTab: (tabId: WorkbenchTabDescriptor['id']) => void
  replaceWorkbenchTab: (
    previousTabId: WorkbenchTabDescriptor['id'],
    tab: WorkbenchTabDescriptor,
  ) => void
  onError: (message: string) => void
}) {
  const [sideChatInput, setSideChatInput] = useState('')
  const [sideChatFocusVersion, setSideChatFocusVersion] = useState(0)
  const [sideChatAttachments, setSideChatAttachments] = useState<DesktopComposerAttachment[]>([])
  const [sideChatTabsVersion, setSideChatTabsVersion] = useState(0)
  const [sideChatSupported, setSideChatSupported] = useState(false)
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false)
  const [skipCloseConfirmation, setSkipCloseConfirmation] = useState(false)
  const draftsRef = useRef(new Map<string, Draft>())
  const tabsBySourceRef = useRef(new Map<string, SideChatTab[]>())
  const nextIndexBySourceRef = useRef(new Map<string, number>())
  const visibleTurnCountsRef = useRef(new Map<string, number>())
  const statusesRef = useRef(new Map<string, DesktopSessionStatus>())
  const settingsRef = useRef(new Map<string, SideChatComposerSettings>())
  const initialSettingsRef = useRef(initialSettings)
  const modelLoadsRef = useRef(new Map<string, Promise<SideChatComposerSettings>>())
  const creatingTabIdsRef = useRef(new Set<string>())
  const pendingCreationsRef = useRef(new Map<string, Promise<SideChatTab | null>>())
  const cancelledCreatingTabIdsRef = useRef(new Set<string>())
  const activeComposerKeyRef = useRef<string | null>(null)
  const pendingCloseRef = useRef<PendingClose | null>(null)
  const skipCloseForRunRef = useRef(false)
  const inputRef = useRef(sideChatInput)
  const attachmentsRef = useRef(sideChatAttachments)
  inputRef.current = sideChatInput
  attachmentsRef.current = sideChatAttachments

  useEffect(() => {
    // 只有当前侧边聊天的模型选择变化才需要重算标签；其他会话的更新不触发重渲染。
    let previous = sideChatSelectionSignature(tabsBySourceRef.current)
    return sessionModelSelections.subscribe(() => {
      const next = sideChatSelectionSignature(tabsBySourceRef.current)
      if (next === previous) return
      previous = next
      setSideChatTabsVersion((version) => version + 1)
    })
  }, [])

  const readSideChatSettings = useCallback(
    (tabId: string): SideChatComposerSettings | undefined => {
      const settings = settingsRef.current.get(tabId)
      const selection = sessionModelSelections.getSnapshot(
        tabId.slice('side-chat:'.length),
      ).selection
      return settings && selection
        ? { ...settings, ...selection, variant: selection.variant }
        : settings
    },
    [],
  )

  const loadSideChatSettings = useCallback(
    (tabId: string): Promise<SideChatComposerSettings> => {
      const existing = readSideChatSettings(tabId)
      if (existing) return Promise.resolve(existing)
      const loading = modelLoadsRef.current.get(tabId)
      if (loading) return loading
      const threadId = tabId.slice('side-chat:'.length)
      const request = sessionModelSelections
        .load(threadId)
        .then((selection) => {
          const restored = {
            ...initialSettingsRef.current,
            ...selection,
            variant: selection.variant,
            providerBaseURL: undefined,
            selectedModelPreset: '',
          }
          if (modelLoadsRef.current.get(tabId) === request) {
            settingsRef.current.set(tabId, restored)
          }
          return restored
        })
        .finally(() => {
          if (modelLoadsRef.current.get(tabId) === request) {
            modelLoadsRef.current.delete(tabId)
            setSideChatTabsVersion((version) => version + 1)
          }
        })
      modelLoadsRef.current.set(tabId, request)
      return request
    },
    [readSideChatSettings],
  )

  useEffect(() => {
    if (!activeTab || creatingTabIdsRef.current.has(activeTab.id)) return
    void loadSideChatSettings(activeTab.id).catch((error) => {
      onError(error instanceof Error ? error.message : String(error))
    })
  }, [activeTab?.id, loadSideChatSettings, onError])

  useEffect(() => {
    void desktopClient
      .getRuntimeCapabilities()
      .then((capabilities) => {
        setSideChatSupported(capabilities.includes('thread.side-chat.v1'))
      })
      .catch(() => setSideChatSupported(false))
  }, [])

  const activeComposerKey = activeTab?.id ?? null
  useEffect(() => {
    const previousKey = activeComposerKeyRef.current
    if (previousKey === activeComposerKey) return
    if (previousKey) {
      draftsRef.current.set(previousKey, {
        input: inputRef.current,
        attachments: attachmentsRef.current,
      })
    }
    const nextDraft = activeComposerKey ? draftsRef.current.get(activeComposerKey) : undefined
    activeComposerKeyRef.current = activeComposerKey
    inputRef.current = nextDraft?.input ?? ''
    attachmentsRef.current = nextDraft?.attachments ?? []
    setSideChatInput(inputRef.current)
    setSideChatAttachments(attachmentsRef.current)
  }, [activeComposerKey])

  const sideChatTabsForSource = useMemo(
    () => (sourceThreadId ? [...(tabsBySourceRef.current.get(sourceThreadId) ?? [])] : []),
    [sideChatTabsVersion, sourceThreadId],
  )

  const createSideChatRequest = useCallback(
    async (referenceText?: string): Promise<SideChatTab | null> => {
      if (!sourceThreadId) {
        onError('请先打开一个任务，再创建侧边聊天。')
        return null
      }
      if (!sideChatSupported) {
        onError('当前 Agent 不支持侧边聊天，请更新并重启 Pidex。')
        return null
      }
      let creationSettings = { ...initialSettings }
      try {
        const selection = await sessionModelSelections.load(sourceThreadId)
        creationSettings = {
          ...creationSettings,
          ...selection,
          variant: selection.variant,
          providerBaseURL: undefined,
          selectedModelPreset: '',
        }
        if (!creationSettings.model || !creationSettings.providerID) {
          throw new Error('请先为当前会话配置模型，再创建侧边聊天。')
        }
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error))
        return null
      }
      const nextIndex = nextIndexBySourceRef.current.get(sourceThreadId) ?? 1
      nextIndexBySourceRef.current.set(sourceThreadId, nextIndex + 1)
      const title = nextIndex === 1 ? '侧边聊天' : `侧边聊天 ${nextIndex}`
      const pendingThreadId = `loading:${crypto.randomUUID()}`
      const pendingTab: SideChatTab = {
        id: `side-chat:${pendingThreadId}`,
        kind: 'side-chat',
        threadId: pendingThreadId,
        sourceThreadId,
        inheritedThroughTurnId: null,
        title,
      }
      creatingTabIdsRef.current.add(pendingTab.id)
      settingsRef.current.set(pendingTab.id, creationSettings)
      openRightDockTab(pendingTab)
      setSideChatTabsVersion((version) => version + 1)
      try {
        const result = await desktopClient.createSideChat({
          sourceThreadId,
          ...(referenceText?.trim() ? { referenceText: referenceText.trim() } : {}),
        })
        const descriptor = result.sideChat
        const tab: SideChatTab = {
          id: `side-chat:${descriptor.threadId}`,
          kind: 'side-chat',
          threadId: descriptor.threadId,
          sourceThreadId: descriptor.sourceThreadId,
          inheritedThroughTurnId: descriptor.inheritedThroughTurnId,
          title,
        }
        creatingTabIdsRef.current.delete(pendingTab.id)
        if (cancelledCreatingTabIdsRef.current.delete(pendingTab.id)) {
          settingsRef.current.delete(pendingTab.id)
          await desktopClient.discardSideChat({ threadId: descriptor.threadId })
          return null
        }
        const pendingSettings = settingsRef.current.get(pendingTab.id)
        settingsRef.current.delete(pendingTab.id)
        settingsRef.current.set(tab.id, pendingSettings ?? creationSettings)
        sessionModelSelections.set(tab.threadId, pendingSettings ?? creationSettings)
        const current = tabsBySourceRef.current.get(sourceThreadId) ?? []
        tabsBySourceRef.current.set(sourceThreadId, [...current, tab])
        draftsRef.current.set(tab.id, { input: '', attachments: [] })
        setSideChatTabsVersion((version) => version + 1)
        replaceWorkbenchTab(pendingTab.id, tab)
        setSideChatFocusVersion((version) => version + 1)
        return tab
      } catch (error) {
        creatingTabIdsRef.current.delete(pendingTab.id)
        settingsRef.current.delete(pendingTab.id)
        removeWorkbenchTab(pendingTab.id)
        setSideChatTabsVersion((version) => version + 1)
        onError(error instanceof Error ? error.message : String(error))
        return null
      }
    },
    [
      initialSettings,
      onError,
      openRightDockTab,
      removeWorkbenchTab,
      replaceWorkbenchTab,
      sideChatSupported,
      sourceThreadId,
    ],
  )

  const createSideChat = useCallback(
    (referenceText?: string): Promise<SideChatTab | null> =>
      reusePendingSideChatCreation(
        pendingCreationsRef.current,
        JSON.stringify([sourceThreadId, referenceText?.trim() ?? '']),
        () => createSideChatRequest(referenceText),
      ),
    [createSideChatRequest, sourceThreadId],
  )

  const handleAppendSideChatText = useCallback(
    (text: string): void => {
      if (!text.trim()) return
      void createSideChat(text)
    },
    [createSideChat],
  )

  const sideChatSubmitToSession = useCallback(
    async (
      sessionId: string,
      value: DesktopUserMessageInput,
      options?: {
        delivery?: ComposerDeliveryIntent
        inputId?: string
        propagateError?: boolean
      },
    ): Promise<'sent' | 'queued'> => {
      const tabId = `side-chat:${sessionId}`
      const settings = { ...(await loadSideChatSettings(tabId)) }
      if (!settings.providerID || !settings.model) throw new Error('请先选择侧边聊天模型')
      const provider = await desktopClient.getModelProviderState(settings.providerID)
      const model = {
        providerID: settings.providerID,
        model: settings.model,
        ...(settings.variant ? { variant: settings.variant } : {}),
        ...(provider.baseURL ? { providerBaseURL: provider.baseURL } : {}),
      }
      if (options?.delivery === 'follow-up') {
        const outcome = await desktopClient.submitSessionFollowUp(
          sessionId,
          value,
          'follow-up',
          options.inputId,
          model,
        )
        return outcome === 'queued' ? 'queued' : 'sent'
      }
      const status = statusesRef.current.get(sessionId) ?? 'idle'
      if (status === 'running' || status === 'waiting') {
        await desktopClient.submitSessionFollowUp(
          sessionId,
          value,
          'steer',
          options?.inputId,
          model,
        )
        return 'sent'
      }
      await desktopClient.sendUserMessage(sessionId, value, model, options?.inputId)
      return 'sent'
    },
    [loadSideChatSettings],
  )

  const discardTabs = useCallback(
    async (tabs: readonly SideChatTab[]): Promise<boolean> => {
      try {
        for (const tab of tabs) {
          if (creatingTabIdsRef.current.delete(tab.id)) {
            cancelledCreatingTabIdsRef.current.add(tab.id)
            settingsRef.current.delete(tab.id)
            removeWorkbenchTab(tab.id)
            continue
          }
          await desktopClient.discardSideChat({ threadId: tab.threadId })
          forgetThreadScrollState(tab.threadId)
          draftsRef.current.delete(tab.id)
          visibleTurnCountsRef.current.delete(tab.threadId)
          statusesRef.current.delete(tab.threadId)
          settingsRef.current.delete(tab.id)
          modelLoadsRef.current.delete(tab.id)
          sessionModelSelections.delete(tab.threadId)
          const sourceTabs = tabsBySourceRef.current.get(tab.sourceThreadId) ?? []
          tabsBySourceRef.current.set(
            tab.sourceThreadId,
            sourceTabs.filter((candidate) => candidate.id !== tab.id),
          )
          removeWorkbenchTab(tab.id)
        }
        setSideChatTabsVersion((version) => version + 1)
        return true
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error))
        return false
      }
    },
    [onError, removeWorkbenchTab],
  )

  const requestCloseSideChatTabs = useCallback(
    async (tabs: readonly SideChatTab[]): Promise<boolean> => {
      if (tabs.length === 0) return true
      let skip = skipCloseForRunRef.current
      try {
        skip = skip || window.localStorage.getItem(SKIP_CLOSE_CONFIRMATION_KEY) === 'true'
      } catch {
        // Storage is optional; the dialog remains enabled for this run.
      }
      const hasVisibleMessages = tabs.some(
        (tab) => (visibleTurnCountsRef.current.get(tab.threadId) ?? 0) > 0,
      )
      if (skip || !hasVisibleMessages) return discardTabs(tabs)
      return new Promise<boolean>((resolve) => {
        pendingCloseRef.current = { tabs: [...tabs], resolve }
        setSkipCloseConfirmation(false)
        setCloseConfirmationOpen(true)
      })
    },
    [discardTabs],
  )

  const confirmSideChatClose = useCallback((): void => {
    const pending = pendingCloseRef.current
    if (!pending) return
    pendingCloseRef.current = null
    setCloseConfirmationOpen(false)
    if (skipCloseConfirmation) {
      skipCloseForRunRef.current = true
      try {
        window.localStorage.setItem(SKIP_CLOSE_CONFIRMATION_KEY, 'true')
      } catch {
        // The current close still proceeds when storage is unavailable.
      }
    }
    void discardTabs(pending.tabs).then(pending.resolve)
  }, [discardTabs, skipCloseConfirmation])

  const cancelSideChatClose = useCallback((): void => {
    const pending = pendingCloseRef.current
    pendingCloseRef.current = null
    setCloseConfirmationOpen(false)
    pending?.resolve(false)
  }, [])

  const reportSideChatState = useCallback(
    (threadId: string, count: number, status: DesktopSessionStatus): void => {
      visibleTurnCountsRef.current.set(threadId, count)
      statusesRef.current.set(threadId, status)
    },
    [],
  )

  const getSideChatSettings = useCallback(
    (tabId: SideChatTab['id']): SideChatComposerSettings =>
      readSideChatSettings(tabId) ?? {
        ...initialSettingsRef.current,
        providerID: '',
        providerBaseURL: undefined,
        model: '',
        selectedModelPreset: '',
        thinkingMode: 'default',
        variant: undefined,
      },
    [readSideChatSettings],
  )

  const updateSideChatSettings = useCallback(
    (tabId: SideChatTab['id'], patch: Partial<SideChatComposerSettings>): void => {
      const current = readSideChatSettings(tabId)
      if (!current) {
        onError('侧边聊天模型尚未加载，请稍后重试。')
        return
      }
      const next = {
        ...current,
        ...patch,
      }
      settingsRef.current.set(tabId, next)
      if (!creatingTabIdsRef.current.has(tabId)) {
        sessionModelSelections.set(tabId.slice('side-chat:'.length), next)
      }
      setSideChatTabsVersion((version) => version + 1)
    },
    [onError, readSideChatSettings],
  )

  const isSideChatModelLoading = (tabId: SideChatTab['id']): boolean =>
    !settingsRef.current.has(tabId) &&
    !sessionModelSelections.getSnapshot(tabId.slice('side-chat:'.length)).error

  const getSideChatModelError = (tabId: SideChatTab['id']): string | null =>
    settingsRef.current.has(tabId)
      ? null
      : sessionModelSelections.getSnapshot(tabId.slice('side-chat:'.length)).error

  const reloadSideChatModel = (tabId: SideChatTab['id']): void => {
    void loadSideChatSettings(tabId).catch((error) => {
      onError(error instanceof Error ? error.message : String(error))
    })
    setSideChatTabsVersion((version) => version + 1)
  }

  const isCreatingSideChat = useCallback(
    (tabId: SideChatTab['id']): boolean => creatingTabIdsRef.current.has(tabId),
    [],
  )

  const appendSideComposerAttachmentsForDraft = useCallback(
    (draftKey: ComposerDraftKey, nextAttachments: DesktopComposerAttachment[]): void => {
      if (nextAttachments.length === 0) return
      const current =
        activeComposerKeyRef.current === draftKey
          ? attachmentsRef.current
          : (draftsRef.current.get(draftKey)?.attachments ?? [])
      const existingIds = new Set(current.map((attachment) => attachment.id))
      const next = [
        ...current,
        ...nextAttachments.filter((attachment) => !existingIds.has(attachment.id)),
      ]
      draftsRef.current.set(draftKey, {
        input:
          activeComposerKeyRef.current === draftKey
            ? inputRef.current
            : (draftsRef.current.get(draftKey)?.input ?? ''),
        attachments: next,
      })
      if (activeComposerKeyRef.current === draftKey) {
        attachmentsRef.current = next
        setSideChatAttachments(next)
      }
    },
    [],
  )

  const removeSideComposerAttachmentForDraft = useCallback(
    (draftKey: ComposerDraftKey, attachmentId: string): void => {
      const current =
        activeComposerKeyRef.current === draftKey
          ? attachmentsRef.current
          : (draftsRef.current.get(draftKey)?.attachments ?? [])
      const next = current.filter((attachment) => attachment.id !== attachmentId)
      draftsRef.current.set(draftKey, {
        input:
          activeComposerKeyRef.current === draftKey
            ? inputRef.current
            : (draftsRef.current.get(draftKey)?.input ?? ''),
        attachments: next,
      })
      if (activeComposerKeyRef.current === draftKey) {
        attachmentsRef.current = next
        setSideChatAttachments(next)
      }
    },
    [],
  )

  const clearSideComposerDraftIfUnchanged = useCallback(
    (draftKey: ComposerDraftKey, snapshot: ComposerDraftContentSnapshot): boolean => {
      const current =
        activeComposerKeyRef.current === draftKey
          ? { input: inputRef.current, attachments: attachmentsRef.current }
          : (draftsRef.current.get(draftKey) ?? { input: '', attachments: [] })
      if (
        current.input !== snapshot.text ||
        !sameAttachmentIds(current.attachments, snapshot.attachments)
      ) {
        return false
      }
      draftsRef.current.set(draftKey, { input: '', attachments: [] })
      if (activeComposerKeyRef.current === draftKey) {
        inputRef.current = ''
        attachmentsRef.current = []
        setSideChatInput('')
        setSideChatAttachments([])
      }
      return true
    },
    [],
  )

  return {
    activeSideChatTab: activeTab,
    sideChatSupported,
    sideChatTabsForSource,
    sideChatInput,
    setSideChatInput,
    sideChatFocusVersion,
    sideChatAttachments,
    setSideChatAttachments,
    createSideChat,
    handleAppendSideChatText,
    sideChatSubmitToSession,
    requestCloseSideChatTabs,
    reportSideChatState,
    getSideChatSettings,
    updateSideChatSettings,
    isSideChatModelLoading,
    getSideChatModelError,
    reloadSideChatModel,
    isCreatingSideChat,
    closeConfirmationOpen,
    skipCloseConfirmation,
    setSkipCloseConfirmation,
    confirmSideChatClose,
    cancelSideChatClose,
    appendSideComposerAttachmentsForDraft,
    removeSideComposerAttachmentForDraft,
    clearSideComposerDraftIfUnchanged,
  }
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

/**
 * 侧边聊天标签只关心自身会话的模型选择；用签名比较过滤掉其他会话的更新，
 * 避免每一条模型选择广播都让整个侧边聊天面板重渲染。
 */
function sideChatSelectionSignature(tabsBySource: Map<string, SideChatTab[]>): string {
  const parts: string[] = []
  for (const tabs of tabsBySource.values()) {
    for (const tab of tabs) {
      const threadId = tab.threadId
      const state = sessionModelSelections.getSnapshot(threadId)
      parts.push(
        `${threadId}\u0000${state.selection?.providerID ?? ''}\u0000${state.selection?.model ?? ''}\u0000${state.selection?.variant ?? ''}\u0000${state.loading}\u0000${state.error ?? ''}`,
      )
    }
  }
  return parts.join('\u0001')
}
