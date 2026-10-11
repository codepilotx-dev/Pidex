export class LruCache<Key, Value> {
  readonly #capacity: number
  readonly #maxWeight: number
  readonly #weigh: (key: Key, value: Value) => number
  readonly #entries = new Map<Key, Value>()
  readonly #weights = new Map<Key, number>()
  #weight = 0

  constructor(
    capacity: number,
    options: {
      maxWeight?: number
      weigh?: (key: Key, value: Value) => number
    } = {},
  ) {
    this.#capacity = Math.max(1, Math.floor(capacity))
    this.#maxWeight = Math.max(1, options.maxWeight ?? Number.MAX_SAFE_INTEGER)
    this.#weigh = options.weigh ?? (() => 1)
  }

  get(key: Key): Value | undefined {
    const value = this.#entries.get(key)
    if (value === undefined) return undefined
    this.#entries.delete(key)
    this.#entries.set(key, value)
    return value
  }

  set(key: Key, value: Value): void {
    const previousWeight = this.#weights.get(key) ?? 0
    this.#entries.delete(key)
    this.#weights.delete(key)
    this.#weight -= previousWeight

    const weight = Math.max(0, this.#weigh(key, value))
    if (weight > this.#maxWeight) return
    this.#entries.set(key, value)
    this.#weights.set(key, weight)
    this.#weight += weight
    while (this.#entries.size > this.#capacity || this.#weight > this.#maxWeight) {
      const oldestKey = this.#entries.keys().next().value as Key | undefined
      if (oldestKey === undefined) break
      this.#entries.delete(oldestKey)
      this.#weight -= this.#weights.get(oldestKey) ?? 0
      this.#weights.delete(oldestKey)
    }
  }

  clear(): void {
    this.#entries.clear()
    this.#weights.clear()
    this.#weight = 0
  }

  get size(): number {
    return this.#entries.size
  }

  get weight(): number {
    return this.#weight
  }
}
