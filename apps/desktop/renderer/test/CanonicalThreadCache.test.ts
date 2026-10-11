import { describe, expect, test } from 'bun:test'
import type { CanonicalThreadState } from '@pidex/session-view'

import { createCanonicalThreadCache } from '../src/features/session/state/CanonicalThreadCache.js'

function state(threadId: string): CanonicalThreadState {
  return {
    thread: { id: threadId },
  } as unknown as CanonicalThreadState
}

describe('canonical thread cache', () => {
  test('keeps four recently used threads and evicts the least recently used', () => {
    let timestamp = 0
    const cache = createCanonicalThreadCache({
      capacity: 4,
      now: () => timestamp,
      ttlMs: 1_000,
    })
    for (const threadId of ['a', 'b', 'c', 'd']) {
      timestamp += 1
      cache.set(state(threadId))
    }
    expect(cache.get('a')?.thread.id).toBe('a')
    timestamp += 1
    cache.set(state('e'))

    expect(cache.get('b')).toBeNull()
    expect(cache.get('a')?.thread.id).toBe('a')
    expect(cache.size()).toBe(4)
  })

  test('expires entries after the ttl and supports precise invalidation', () => {
    let timestamp = 0
    const cache = createCanonicalThreadCache({
      now: () => timestamp,
      ttlMs: 100,
    })
    cache.set(state('a'))
    timestamp = 99
    expect(cache.get('a')?.thread.id).toBe('a')
    timestamp = 198
    expect(cache.get('a')?.thread.id).toBe('a')
    cache.invalidate('a')
    expect(cache.get('a')).toBeNull()

    cache.set(state('b'))
    timestamp = 298
    expect(cache.get('b')).toBeNull()
    expect(cache.size()).toBe(0)
  })
})
