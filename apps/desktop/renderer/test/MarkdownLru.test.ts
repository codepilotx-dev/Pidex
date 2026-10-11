import { describe, expect, test } from 'bun:test'
import { LruCache } from '../src/features/markdown/Lru.js'

describe('markdown LRU byte budget', () => {
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

  test('does not retain a single entry larger than the byte budget', () => {
    const cache = new LruCache<string, string>(10, {
      maxWeight: 2,
      weigh: (key) => key.length,
    })

    cache.set('oversized', 'value')

    expect(cache.size).toBe(0)
    expect(cache.weight).toBe(0)
  })
})
