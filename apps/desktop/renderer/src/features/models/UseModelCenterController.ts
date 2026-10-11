import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  DesktopApiKeySummary,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
} from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import {
  providerManagementStore,
  useProviderManagementSnapshot,
  type ProviderManagementSnapshot,
} from '../provider-management/index.js'

type Options = {
  onInitialProviderState: (state: DesktopModelProviderState) => void
  onError: (message: string) => void
}

export type ModelCenterInitialLoadState = 'loading' | 'ready' | 'error'

export type ModelCenterController = {
  initialLoadState: ModelCenterInitialLoadState
  providers: DesktopModelProviderSummary[]
  providerState: DesktopModelProviderState | null
  apiKeys: DesktopApiKeySummary[]
  snapshot: ProviderManagementSnapshot
  setProviderState: Dispatch<SetStateAction<DesktopModelProviderState | null>>
  setApiKeys: Dispatch<SetStateAction<DesktopApiKeySummary[]>>
  refreshProviderContext: () => Promise<{
    providerState: DesktopModelProviderState
  }>
  refreshAllProviderData: () => Promise<ProviderManagementSnapshot>
}

export function useModelCenterController({
  onInitialProviderState,
  onError,
}: Options): ModelCenterController {
  const snapshot = useProviderManagementSnapshot()
  const [providerState, setProviderState] = useState<DesktopModelProviderState | null>(
    snapshot.currentProviderState,
  )
  const [apiKeys, setApiKeys] = useState<DesktopApiKeySummary[]>([...snapshot.apiKeys])
  const initialStateHandler = useRef(onInitialProviderState)
  const errorHandler = useRef(onError)
  const initialStateApplied = useRef(false)

  useEffect(() => {
    initialStateHandler.current = onInitialProviderState
    errorHandler.current = onError
  }, [onError, onInitialProviderState])

  useEffect(() => {
    if (snapshot.currentProviderState) {
      setProviderState(snapshot.currentProviderState)
      if (!initialStateApplied.current) {
        initialStateApplied.current = true
        initialStateHandler.current(snapshot.currentProviderState)
      }
    }
    setApiKeys([...snapshot.apiKeys])
  }, [snapshot.apiKeys, snapshot.currentProviderState])

  useEffect(() => {
    if (snapshot.error) errorHandler.current(snapshot.error)
  }, [snapshot.error])

  const refreshProviderContext = useCallback(async () => {
    const nextSnapshot = await providerManagementStore.refresh()
    const nextState = nextSnapshot.currentProviderState
    if (!nextState) {
      throw new Error('当前供应商状态暂时无法加载。')
    }
    setProviderState(nextState)
    setApiKeys([...nextSnapshot.apiKeys])
    return {
      providerState: nextState,
    }
  }, [])

  const refreshAllProviderData = useCallback(async () => {
    const nextSnapshot = await providerManagementStore.refreshAllProviderData()
    if (nextSnapshot.currentProviderState) {
      setProviderState(nextSnapshot.currentProviderState)
    }
    setApiKeys([...nextSnapshot.apiKeys])
    return nextSnapshot
  }, [])

  const initialLoadState: ModelCenterInitialLoadState = !snapshot.loaded
    ? 'loading'
    : snapshot.error && snapshot.providers.length === 0
      ? 'error'
      : 'ready'

  return {
    initialLoadState,
    providers: [...snapshot.providers],
    providerState,
    apiKeys,
    snapshot,
    setProviderState,
    setApiKeys,
    refreshProviderContext,
    refreshAllProviderData,
  }
}
