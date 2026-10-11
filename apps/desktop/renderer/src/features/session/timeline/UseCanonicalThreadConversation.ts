import React from 'react'
import type { EventEnvelope } from '@pidex/agent-protocol'
import {
  createRenderTurnEntriesSelector,
  type CanonicalThreadState,
  type PendingHookTrustInteraction,
  type RenderTurnEntry,
  type ThreadConversationScope,
  type ThreadHistoryPageLike,
} from '@pidex/session-view'

import { desktopClient } from '../../../services/desktop-client/index.js'
import { AGENT_LIVE_EVENT_FILTERS } from '../../../services/desktop-client/EventSubscriptionFilters.js'
import { canonicalThreadCache } from '../state/CanonicalThreadCache.js'
import { installStreamingPerfHarness } from '../state/StreamingPerfHarness.js'
import { CanonicalThreadIngestionCoordinator } from './CanonicalThreadIngestionCoordinator.js'
import { loadOlderThreadDirectory } from './LoadOlderThreadDirectory.js'

const INITIAL_TURN_PAGE_SIZE = 10
const MAIN_CONVERSATION_SCOPE = { type: 'main' } as const
const EMPTY_RENDER_TURNS = Object.freeze([]) as unknown as RenderTurnEntry[]

export type CanonicalThreadConversation = {
  state: CanonicalThreadState | null
  turns: RenderTurnEntry[]
  loading: boolean
  loadingOlder: boolean
  error: string | null
  hasOlder: boolean
  loadOlder: (beforeCommit?: () => () => void) => Promise<void>
  loadAllOlder: (beforeCommit?: () => () => void) => Promise<void>
  loadingDirectory: boolean
  directoryError: string | null
  reload: () => Promise<void>
}

export function selectVisibleCanonicalState(
  state: CanonicalThreadState | null,
  threadId: string | null,
): CanonicalThreadState | null {
  return state?.thread.id === threadId ? state : null
}

export function isCurrentCanonicalThreadRequest(
  activeThreadId: string | null,
  currentGeneration: number,
  requestedThreadId: string,
  requestGeneration: number,
): boolean {
  return activeThreadId === requestedThreadId && currentGeneration === requestGeneration
}

const TERMINAL_TURN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'turn/completed',
  'turn/failed',
  'turn/interrupted',
])

export function isTerminalTurnEnvelope(envelope: EventEnvelope): boolean {
  return TERMINAL_TURN_EVENT_TYPES.has(envelope.type)
}

export function hasTerminalTurnEvent(envelopes: readonly EventEnvelope[]): boolean {
  return envelopes.some(isTerminalTurnEnvelope)
}

export type DeliverCanonicalBatchOptions = {
  coordinator: CanonicalThreadIngestionCoordinator
  readLatest: () => Promise<ThreadHistoryPageLike | null>
  isCurrent: () => boolean
  onReconciliationError?: (cause: unknown) => void
}

/**
 * 先 deliverBatch，再检查同一批是否含终态 turn 事件（turn/completed、
 * turn/failed、turn/interrupted 任一个或多个）。含终态时只读取一次最新
 * 历史并 rehydrate 当前 coordinator，且用 threadId + generation 双校验拒绝
 * 旧结果；对账失败保留实时投影，仅通过 onReconciliationError 做安全诊断，
 * 不设置页面错误、不清空时间线、不循环重连。
 * @returns 是否对终态批次执行了对账读取。
 */
export async function deliverCanonicalBatch(
  envelopes: readonly EventEnvelope[],
  options: DeliverCanonicalBatchOptions,
): Promise<boolean> {
  if (!options.isCurrent()) return false
  await options.coordinator.deliverBatch(envelopes)
  if (!hasTerminalTurnEvent(envelopes)) return false
  if (!options.isCurrent()) return false
  try {
    const replacement = await options.readLatest()
    if (!replacement || !options.isCurrent()) return false
    options.coordinator.rehydrate(replacement)
  } catch (cause) {
    if (!options.isCurrent()) return false
    options.onReconciliationError?.(cause)
  }
  return true
}

export function useCanonicalThreadConversation(
  threadId: string | null,
  scope: ThreadConversationScope = MAIN_CONVERSATION_SCOPE,
): CanonicalThreadConversation {
  const [loadingOlderThreadId, setLoadingOlderThreadId] = React.useState<string | null>(null)
  const historyRequestRef = React.useRef<object | null>(null)
  const [directoryState, setDirectoryState] = React.useState<{
    threadId: string | null
    loading: boolean
    error: string | null
  }>({ threadId: null, loading: false, error: null })
  const [errorState, setErrorState] = React.useState<{
    threadId: string
    message: string
  } | null>(null)
  const activeThreadIdRef = React.useRef(threadId)
  const generationRef = React.useRef(0)
  const unsubscribeRef = React.useRef<(() => void) | null>(null)
  const renderTurnEntriesSelector = React.useMemo(() => createRenderTurnEntriesSelector(), [])
  const coordinator = React.useMemo(() => {
    if (!threadId) return null
    return new CanonicalThreadIngestionCoordinator({
      threadId,
      initialState: canonicalThreadCache.get(threadId),
      onCommit: (next) => canonicalThreadCache.set(next),
    })
  }, [threadId])
  const subscribeToProjection = React.useCallback(
    (listener: () => void) => coordinator?.subscribe(listener) ?? (() => undefined),
    [coordinator],
  )
  const getProjectionSnapshot = React.useCallback(
    () => coordinator?.getSnapshot() ?? null,
    [coordinator],
  )
  const state = React.useSyncExternalStore(
    subscribeToProjection,
    getProjectionSnapshot,
    getProjectionSnapshot,
  )

  activeThreadIdRef.current = threadId

  const readLatest = React.useCallback(async (): Promise<ThreadHistoryPageLike | null> => {
    if (!threadId) return null
    const page = await desktopClient.readThreadHistoryPage({
      threadId,
      limit: INITIAL_TURN_PAGE_SIZE,
    })
    // Read pending interactions after the history fence. This ordering avoids
    // reintroducing a hook that resolved before the returned stream position.
    const pending = await desktopClient.listPendingAgentInteractions({
      threadId,
      limit: 500,
    })
    return {
      ...page,
      pendingHookTrusts: pending.interactions.filter(
        (interaction): interaction is PendingHookTrustInteraction =>
          interaction.kind === 'hookTrust',
      ),
    }
  }, [threadId])

  const reload = React.useCallback(async (): Promise<void> => {
    const generation = ++generationRef.current
    const requestedThreadId = threadId
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    setLoadingOlderThreadId(null)
    historyRequestRef.current = null
    setDirectoryState({ threadId: requestedThreadId, loading: false, error: null })
    if (!requestedThreadId || !coordinator) {
      setErrorState(null)
      return
    }

    setErrorState(null)
    const isCurrent = (): boolean =>
      isCurrentCanonicalThreadRequest(
        activeThreadIdRef.current,
        generationRef.current,
        requestedThreadId,
        generation,
      )
    const rehydrate = async (cause?: unknown): Promise<number | undefined> => {
      if (!isCurrent()) return undefined
      if (cause !== undefined) {
        console.error('会话事件消费失败，正在从历史记录对账。')
      }
      try {
        const replacement = await readLatest()
        if (!replacement || !isCurrent()) return undefined
        coordinator.rehydrate(replacement)
        setErrorState(null)
        return replacement.streamPosition.sequence
      } catch (error) {
        if (!isCurrent()) return undefined
        setErrorState({
          threadId: requestedThreadId,
          message: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }

    try {
      const page = await readLatest()
      if (!page || !isCurrent()) return
      coordinator.rehydrate(page)
      const unsubscribe = desktopClient.subscribeAgentEventEnvelopes(
        {
          threadId: requestedThreadId,
          after: page.streamPosition.sequence,
          liveEventTypes: AGENT_LIVE_EVENT_FILTERS.canonical,
          onCursorExpired: () => rehydrate(),
          onDeliveryError: (error) => rehydrate(error),
        },
        async (envelopes: readonly EventEnvelope[]) => {
          if (!isCurrent()) {
            throw new Error('会话已切换，拒绝确认旧订阅事件。')
          }
          await deliverCanonicalBatch(envelopes, {
            coordinator,
            readLatest,
            isCurrent,
            onReconciliationError: () => {
              console.error('终态事件对账失败，保留实时投影。')
            },
          })
        },
      )
      if (!isCurrent()) {
        unsubscribe()
        return
      }
      unsubscribeRef.current = unsubscribe
    } catch (cause) {
      if (!isCurrent()) return
      setErrorState({
        threadId: requestedThreadId,
        message: cause instanceof Error ? cause.message : String(cause),
      })
      canonicalThreadCache.invalidate(requestedThreadId)
    }
  }, [coordinator, readLatest, threadId])

  React.useEffect(() => {
    void reload()
    return () => {
      // The coordinator is a render-owned projection store with no external
      // resources. StrictMode replays this cleanup, so only stop the transport
      // work owned by this effect and let the memoized store follow render life.
      generationRef.current += 1
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
      // 切换会话或卸载前提交已入队 delta：既不把尾部缓冲留在旧会话，也不让
      // 等待提交的批次悬空。
      coordinator?.dispose()
    }
  }, [coordinator, reload])

  React.useEffect(() => {
    if (!coordinator) return
    // 仅在 DEV / performance 构建里暴露流式注入钩子；生产构建为空实现。
    return installStreamingPerfHarness(coordinator)
  }, [coordinator])

  const loadOlder = React.useCallback(
    async (beforeCommit?: () => () => void): Promise<void> => {
      const current = coordinator?.getSnapshot() ?? null
      const cursor = current?.history.olderCursor
      const requestedThreadId = threadId
      const generation = generationRef.current
      if (
        !requestedThreadId ||
        !coordinator ||
        !current ||
        current.thread.id !== requestedThreadId ||
        !current.history.hasOlder ||
        !cursor ||
        historyRequestRef.current !== null
      ) {
        return
      }
      setLoadingOlderThreadId(requestedThreadId)
      const request = {}
      historyRequestRef.current = request
      try {
        const page = await desktopClient.readThreadHistoryPage({
          threadId: requestedThreadId,
          before: cursor,
          limit: INITIAL_TURN_PAGE_SIZE,
        })
        if (
          !isCurrentCanonicalThreadRequest(
            activeThreadIdRef.current,
            generationRef.current,
            requestedThreadId,
            generation,
          )
        ) {
          return
        }
        const restore = beforeCommit?.()
        coordinator.prependOlder(page)
        restore?.()
      } catch (cause) {
        if (
          !isCurrentCanonicalThreadRequest(
            activeThreadIdRef.current,
            generationRef.current,
            requestedThreadId,
            generation,
          )
        ) {
          return
        }
        setErrorState({
          threadId: requestedThreadId,
          message: cause instanceof Error ? cause.message : String(cause),
        })
      } finally {
        if (historyRequestRef.current === request) {
          historyRequestRef.current = null
          setLoadingOlderThreadId((currentThreadId) =>
            currentThreadId === requestedThreadId ? null : currentThreadId,
          )
        }
      }
    },
    [coordinator, threadId],
  )

  const loadAllOlder = React.useCallback(
    async (beforeCommit?: () => () => void): Promise<void> => {
      const initial = coordinator?.getSnapshot()
      if (!threadId || !coordinator || !initial?.history.hasOlder || historyRequestRef.current)
        return
      const requestedThreadId = threadId
      const generation = generationRef.current
      const request = {}
      historyRequestRef.current = request
      setDirectoryState({ threadId, loading: true, error: null })
      const getCurrent = () =>
        isCurrentCanonicalThreadRequest(
          activeThreadIdRef.current,
          generationRef.current,
          requestedThreadId,
          generation,
        )
          ? coordinator.getSnapshot()
          : null
      try {
        const page = await loadOlderThreadDirectory({
          initial,
          getCurrent,
          readPage: (before) =>
            desktopClient.readThreadHistoryPage({ threadId: requestedThreadId, before, limit: 50 }),
        })
        if (page && getCurrent()) {
          const restore = beforeCommit?.()
          coordinator.prependOlderDirectory(page)
          restore?.()
        }
      } catch {
        if (getCurrent())
          setDirectoryState({
            threadId: requestedThreadId,
            loading: false,
            error: '更早的消息加载失败，请重试。',
          })
      } finally {
        if (historyRequestRef.current === request) {
          historyRequestRef.current = null
          if (getCurrent()) setDirectoryState((current) => ({ ...current, loading: false }))
        }
      }
    },
    [coordinator, threadId],
  )

  const visibleError = errorState?.threadId === threadId ? errorState.message : null
  const visibleState = visibleError ? null : selectVisibleCanonicalState(state, threadId)
  const visibleLoading = Boolean(threadId && !visibleState && !visibleError)
  const visibleLoadingOlder = Boolean(threadId && loadingOlderThreadId === threadId)
  const turns = React.useMemo(
    () => (visibleState ? renderTurnEntriesSelector(visibleState, scope) : EMPTY_RENDER_TURNS),
    [renderTurnEntriesSelector, scope, visibleState],
  )

  return {
    state: visibleState,
    turns,
    loading: visibleLoading,
    loadingOlder: visibleLoadingOlder,
    error: visibleError,
    hasOlder: Boolean(visibleState?.history.hasOlder),
    loadOlder,
    loadAllOlder,
    loadingDirectory: directoryState.threadId === threadId && directoryState.loading,
    directoryError: directoryState.threadId === threadId ? directoryState.error : null,
    reload,
  }
}
