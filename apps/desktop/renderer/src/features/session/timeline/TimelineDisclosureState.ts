import {
  createKeyedDisclosureStore,
  type KeyedDisclosureStore,
} from '../../../components/ui/KeyedDisclosureStore.js'
import { isRecord } from '@pidex/shared/guards'

const STORAGE_PREFIX = 'conversation.timeline-disclosures.v1.'
const MAX_EXPANDED_IDS = 1_000

type TimelineDisclosureSnapshotV1 = {
  schemaVersion: 1
  expandedIds: string[]
}

type TimelineDisclosureStoreEntry = {
  cleanupTimer: ReturnType<typeof setTimeout> | null
  consumers: number
  store: KeyedDisclosureStore
}

const storesByStorage = new WeakMap<Storage, Map<string, TimelineDisclosureStoreEntry>>()
const entriesByStore = new WeakMap<
  KeyedDisclosureStore,
  {
    storage: Storage
    threadId: string
    entry: TimelineDisclosureStoreEntry
  }
>()

export function getTimelineDisclosureStore(threadId: string): KeyedDisclosureStore {
  const storage = window.localStorage
  let stores = storesByStorage.get(storage)
  if (!stores) {
    stores = new Map()
    storesByStorage.set(storage, stores)
  }
  const existing = stores.get(threadId)
  if (existing) return existing.store

  const store = createKeyedDisclosureStore({
    initialExpandedKeys: readTimelineDisclosureState(storage, threadId),
    maxExpandedKeys: MAX_EXPANDED_IDS,
    persist: (expandedIds) => {
      const snapshot: TimelineDisclosureSnapshotV1 = {
        schemaVersion: 1,
        expandedIds: [...expandedIds],
      }
      try {
        storage.setItem(storageKey(threadId), JSON.stringify(snapshot))
      } catch {
        /* Storage can be disabled or full; the in-memory state remains authoritative. */
      }
    },
  })
  const entry: TimelineDisclosureStoreEntry = {
    cleanupTimer: null,
    consumers: 0,
    store,
  }
  stores.set(threadId, entry)
  entriesByStore.set(store, { storage, threadId, entry })
  return store
}

export function retainTimelineDisclosureStore(threadId: string): KeyedDisclosureStore {
  const store = getTimelineDisclosureStore(threadId)
  const record = entriesByStore.get(store)
  if (!record) return store
  if (record.entry.cleanupTimer != null) {
    clearTimeout(record.entry.cleanupTimer)
    record.entry.cleanupTimer = null
  }
  record.entry.consumers += 1
  return store
}

export function releaseTimelineDisclosureStore(store: KeyedDisclosureStore): void {
  const record = entriesByStore.get(store)
  if (!record || record.entry.consumers === 0) return
  record.entry.consumers -= 1
  if (record.entry.consumers > 0 || record.entry.cleanupTimer != null) return

  record.entry.cleanupTimer = setTimeout(() => {
    record.entry.cleanupTimer = null
    if (record.entry.consumers > 0) return
    const stores = storesByStorage.get(record.storage)
    if (stores?.get(record.threadId) !== record.entry) return
    record.entry.store.flush()
    record.entry.store.destroy()
    stores.delete(record.threadId)
    entriesByStore.delete(record.entry.store)
  }, 0)
}

export function loadTimelineDisclosureState(threadId: string): Set<string> {
  return new Set(getTimelineDisclosureStore(threadId).getExpandedKeys())
}

export function setTimelineDisclosureExpanded(
  threadId: string,
  disclosureId: string,
  expanded: boolean,
): Set<string> {
  const store = getTimelineDisclosureStore(threadId)
  if (expanded && store.getSnapshot(disclosureId)) {
    // Preserve the v1 helper's recency semantics without affecting the UI toggle path.
    store.setExpanded(disclosureId, false)
  }
  store.setExpanded(disclosureId, expanded)
  return new Set(store.getExpandedKeys())
}

function readTimelineDisclosureState(storage: Storage, threadId: string): Set<string> {
  try {
    const raw = storage.getItem(storageKey(threadId))
    if (!raw) return new Set()
    const snapshot = parseSnapshot(JSON.parse(raw))
    return snapshot ? new Set(snapshot.expandedIds) : new Set()
  } catch {
    return new Set()
  }
}

function parseSnapshot(value: unknown): TimelineDisclosureSnapshotV1 | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (
    !Array.isArray(value.expandedIds) ||
    value.expandedIds.some((entry) => typeof entry !== 'string' || entry.length === 0)
  )
    return null

  const expandedIds = [...new Set(value.expandedIds)]
  return {
    schemaVersion: 1,
    expandedIds: expandedIds.slice(-MAX_EXPANDED_IDS),
  }
}

function storageKey(threadId: string): string {
  return STORAGE_PREFIX + threadId
}
