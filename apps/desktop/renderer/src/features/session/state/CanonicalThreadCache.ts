import type { CanonicalThreadState } from '@pidex/session-view'

export const CANONICAL_THREAD_CACHE_CAPACITY = 4
export const CANONICAL_THREAD_CACHE_TTL_MS = 10 * 60 * 1_000

export type CanonicalThreadCacheEntry = {
  threadId: string
  state: CanonicalThreadState
  lastAccessAt: number
}

export type CanonicalThreadCache = {
  clear(): void
  get(threadId: string): CanonicalThreadState | null
  invalidate(threadId: string): void
  set(state: CanonicalThreadState): void
  size(): number
}

export function createCanonicalThreadCache(
  options: {
    capacity?: number
    now?: () => number
    ttlMs?: number
  } = {},
): CanonicalThreadCache {
  const capacity = Math.max(1, Math.floor(options.capacity ?? CANONICAL_THREAD_CACHE_CAPACITY))
  const now = options.now ?? Date.now
  const ttlMs = Math.max(0, options.ttlMs ?? CANONICAL_THREAD_CACHE_TTL_MS)
  const entries = new Map<string, CanonicalThreadCacheEntry>()

  function removeExpired(timestamp: number): void {
    for (const [threadId, entry] of entries) {
      if (timestamp - entry.lastAccessAt >= ttlMs) entries.delete(threadId)
    }
  }

  return {
    clear(): void {
      entries.clear()
    },
    get(threadId: string): CanonicalThreadState | null {
      const timestamp = now()
      const entry = entries.get(threadId)
      if (!entry) {
        removeExpired(timestamp)
        return null
      }
      if (timestamp - entry.lastAccessAt >= ttlMs) {
        entries.delete(threadId)
        return null
      }
      entry.lastAccessAt = timestamp
      entries.delete(threadId)
      entries.set(threadId, entry)
      return entry.state
    },
    invalidate(threadId: string): void {
      entries.delete(threadId)
    },
    set(state: CanonicalThreadState): void {
      const timestamp = now()
      removeExpired(timestamp)
      const entry: CanonicalThreadCacheEntry = {
        threadId: state.thread.id,
        state,
        lastAccessAt: timestamp,
      }
      entries.delete(entry.threadId)
      entries.set(entry.threadId, entry)
      while (entries.size > capacity) {
        const oldestThreadId = entries.keys().next().value
        if (oldestThreadId === undefined) break
        entries.delete(oldestThreadId)
      }
    },
    size(): number {
      removeExpired(now())
      return entries.size
    },
  }
}

export const canonicalThreadCache = createCanonicalThreadCache()
