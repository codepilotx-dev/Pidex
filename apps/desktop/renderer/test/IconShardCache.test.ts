import { describe, expect, test } from 'bun:test'
import { loadCachedIconShard } from '../src/features/layout/material-icons/IconShardCache.js'

describe('icon shard cache', () => {
  test('discards a failed load so a later render can try again', async () => {
    const cache = new Map<number, Promise<void>>()
    let attempts = 0

    await loadCachedIconShard(cache, 9, async () => {
      attempts += 1
      throw new Error('temporary module fetch failure')
    })

    expect(cache.has(9)).toBe(false)

    await loadCachedIconShard(cache, 9, async () => {
      attempts += 1
    })

    expect(attempts).toBe(2)
    expect(cache.has(9)).toBe(true)
  })
})
