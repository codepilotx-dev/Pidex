import * as React from 'react'
import { createStore } from 'zustand/vanilla'

export type KeyedDisclosureStore = {
  getSnapshot: (key: string) => boolean
  getExpandedKeys: () => readonly string[]
  /** 聚合订阅的快照：展开集合本身，引用变化即代表有键变化。 */
  getVersion: () => ReadonlySet<string>
  subscribe: (key: string, listener: () => void) => () => void
  subscribeAll: (listener: () => void) => () => void
  setExpanded: (key: string, expanded: boolean) => void
  replace: (expandedKeys: Iterable<string>) => void
  flush: () => void
  destroy: () => void
}

export type KeyedDisclosureStoreOptions = {
  initialExpandedKeys: Iterable<string>
  persist?: (expandedKeys: readonly string[]) => void
  persistDelayMs?: number
  maxExpandedKeys?: number
}

const lifecycleStores = new Set<KeyedDisclosureStore>()
let lifecycleListening = false

function flushLifecycleStores(): void {
  for (const store of lifecycleStores) store.flush()
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden') flushLifecycleStores()
}

function ensureLifecycleListeners(): void {
  if (lifecycleListening || typeof window === 'undefined' || typeof document === 'undefined') return
  window.addEventListener('pagehide', flushLifecycleStores)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  lifecycleListening = true
}

function releaseLifecycleListeners(): void {
  if (
    !lifecycleListening ||
    lifecycleStores.size > 0 ||
    typeof window === 'undefined' ||
    typeof document === 'undefined'
  )
    return
  window.removeEventListener('pagehide', flushLifecycleStores)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  lifecycleListening = false
}

export function createKeyedDisclosureStore({
  initialExpandedKeys,
  persist,
  persistDelayMs = 200,
  maxExpandedKeys,
}: KeyedDisclosureStoreOptions): KeyedDisclosureStore {
  /** 展开集合是唯一可订阅状态；按键订阅与聚合版本号由 Zustand 的 setState 驱动。 */
  const stateStore = createStore<{ expandedKeys: ReadonlySet<string> }>()(() => ({
    expandedKeys: new Set(initialExpandedKeys),
  }))
  const keyListeners = new Map<string, Set<() => void>>()
  let persistTimer: number | null = null
  let persistPending = false
  let destroyed = false

  const expandedSet = (): ReadonlySet<string> => stateStore.getState().expandedKeys

  const normalizedExpandedKeys = (): readonly string[] => {
    const keys = [...expandedSet()]
    return maxExpandedKeys == null ? keys : keys.slice(-maxExpandedKeys)
  }

  const flush = (): void => {
    if (persistTimer != null) {
      globalThis.clearTimeout(persistTimer)
      persistTimer = null
    }
    if (!persistPending || !persist) return
    persistPending = false
    persist(normalizedExpandedKeys())
  }

  const schedulePersist = (): void => {
    if (!persist) return
    persistPending = true
    if (persistTimer != null) globalThis.clearTimeout(persistTimer)
    persistTimer = globalThis.setTimeout(flush, persistDelayMs)
  }

  const notifyKey = (key: string): void => {
    for (const listener of keyListeners.get(key) ?? []) listener()
  }

  const store: KeyedDisclosureStore = {
    getSnapshot: (key) => expandedSet().has(key),
    getExpandedKeys: normalizedExpandedKeys,
    getVersion: () => expandedSet(),
    subscribe: (key, listener) => {
      const bucket = keyListeners.get(key) ?? new Set<() => void>()
      bucket.add(listener)
      keyListeners.set(key, bucket)
      return () => {
        bucket.delete(listener)
        if (bucket.size === 0) keyListeners.delete(key)
      }
    },
    subscribeAll: (listener) => stateStore.subscribe(listener),
    setExpanded: (key, expanded) => {
      const current = expandedSet()
      if (destroyed || current.has(key) === expanded) return
      const next = new Set(current)
      if (expanded) next.add(key)
      else next.delete(key)
      stateStore.setState({
        expandedKeys:
          maxExpandedKeys != null && next.size > maxExpandedKeys
            ? new Set([...next].slice(-maxExpandedKeys))
            : next,
      })
      notifyKey(key)
      schedulePersist()
    },
    replace: (nextExpandedKeys) => {
      if (destroyed) return
      const current = expandedSet()
      const next = new Set(nextExpandedKeys)
      const changedKeys = new Set<string>()
      for (const key of current) {
        if (!next.has(key)) changedKeys.add(key)
      }
      for (const key of next) {
        if (!current.has(key)) changedKeys.add(key)
      }
      if (changedKeys.size === 0) return
      stateStore.setState({ expandedKeys: next })
      for (const key of changedKeys) notifyKey(key)
    },
    flush,
    destroy: () => {
      if (destroyed) return
      flush()
      destroyed = true
      keyListeners.clear()
      lifecycleStores.delete(store)
      releaseLifecycleListeners()
    },
  }

  if (persist) {
    lifecycleStores.add(store)
    ensureLifecycleListeners()
  }
  return store
}

export function useDisclosureExpanded(store: KeyedDisclosureStore, key: string): boolean {
  const subscribe = React.useCallback(
    (listener: () => void) => store.subscribe(key, listener),
    [key, store],
  )
  const getSnapshot = React.useCallback(() => store.getSnapshot(key), [key, store])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
