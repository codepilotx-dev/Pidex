import * as React from 'react'

export type KeyedDisclosureStore = {
  getSnapshot: (key: string) => boolean
  getExpandedKeys: () => readonly string[]
  getVersion: () => number
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
  let expandedKeys = new Set(initialExpandedKeys)
  const listeners = new Map<string, Set<() => void>>()
  const allListeners = new Set<() => void>()
  let version = 0
  let persistTimer: number | null = null
  let persistPending = false
  let destroyed = false

  const normalizedExpandedKeys = (): readonly string[] => {
    const keys = [...expandedKeys]
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
    for (const listener of listeners.get(key) ?? []) listener()
  }

  const notifyAll = (): void => {
    version++
    for (const listener of allListeners) listener()
  }

  const store: KeyedDisclosureStore = {
    getSnapshot: (key) => expandedKeys.has(key),
    getExpandedKeys: normalizedExpandedKeys,
    getVersion: () => version,
    subscribe: (key, listener) => {
      const keyListeners = listeners.get(key) ?? new Set<() => void>()
      keyListeners.add(listener)
      listeners.set(key, keyListeners)
      return () => {
        keyListeners.delete(listener)
        if (keyListeners.size === 0) listeners.delete(key)
      }
    },
    subscribeAll: (listener) => {
      allListeners.add(listener)
      return () => allListeners.delete(listener)
    },
    setExpanded: (key, expanded) => {
      if (destroyed || expandedKeys.has(key) === expanded) return
      if (expanded) expandedKeys.add(key)
      else expandedKeys.delete(key)
      if (maxExpandedKeys != null && expandedKeys.size > maxExpandedKeys) {
        expandedKeys = new Set(normalizedExpandedKeys())
      }
      notifyKey(key)
      notifyAll()
      schedulePersist()
    },
    replace: (nextExpandedKeys) => {
      if (destroyed) return
      const next = new Set(nextExpandedKeys)
      const changedKeys = new Set<string>()
      for (const key of expandedKeys) {
        if (!next.has(key)) changedKeys.add(key)
      }
      for (const key of next) {
        if (!expandedKeys.has(key)) changedKeys.add(key)
      }
      if (changedKeys.size === 0) return
      expandedKeys = next
      for (const key of changedKeys) notifyKey(key)
      notifyAll()
    },
    flush,
    destroy: () => {
      if (destroyed) return
      flush()
      destroyed = true
      listeners.clear()
      allListeners.clear()
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
