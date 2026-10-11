import { describe, expect, test } from 'bun:test'

import { LruCache } from '../src/features/syntax/LruCache.js'

describe('syntax LRU cache', () => {
  test('evicts the least recently used entry at capacity', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('one', 1)
    cache.set('two', 2)
    expect(cache.get('one')).toBe(1)

    cache.set('three', 3)

    expect(cache.peek('one')).toBe(1)
    expect(cache.peek('two')).toBeUndefined()
    expect(cache.peek('three')).toBe(3)
    expect(cache.size).toBe(2)
  })

  test('rejects a non-positive capacity', () => {
    expect(() => new LruCache(0)).toThrow()
  })

  test('evicts old entries when their combined weight exceeds the budget', () => {
    const cache = new LruCache<string, string>(10, {
      maxWeight: 5,
      weigh: (key) => key.length,
    })

    cache.set('aaa', 'first')
    cache.set('bbb', 'second')

    expect(cache.get('aaa')).toBeUndefined()
    expect(cache.get('bbb')).toBe('second')
    expect(cache.weight).toBe(3)
  })

  test('does not retain a single entry larger than the weight budget', () => {
    const cache = new LruCache<string, string>(10, {
      maxWeight: 2,
      weigh: (key) => key.length,
    })

    cache.set('oversized', 'value')

    expect(cache.size).toBe(0)
    expect(cache.weight).toBe(0)
  })
})
