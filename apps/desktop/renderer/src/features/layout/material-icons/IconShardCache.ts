export function loadCachedIconShard(
  cache: Map<number, Promise<void>>,
  shard: number,
  load: () => Promise<void>,
): Promise<void> {
  const cached = cache.get(shard)
  if (cached) return cached

  let pending: Promise<void>
  pending = load().catch(() => {
    if (cache.get(shard) === pending) cache.delete(shard)
  })
  cache.set(shard, pending)
  return pending
}
