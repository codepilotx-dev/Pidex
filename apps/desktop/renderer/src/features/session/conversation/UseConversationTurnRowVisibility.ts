import React from 'react'

export type RegisterConversationTurnRow = (turnId: string, node: HTMLElement | null) => void

type TurnRowObserver = Pick<IntersectionObserver, 'observe' | 'unobserve'>

export type ConversationTurnVisibilityStore = {
  getSnapshot: () => ReadonlySet<string>
  subscribe: (listener: () => void) => () => void
}

class ConversationTurnVisibilityStoreImpl implements ConversationTurnVisibilityStore {
  #listeners = new Set<() => void>()
  #snapshot: ReadonlySet<string>

  constructor(initialSnapshot: ReadonlySet<string>) {
    this.#snapshot = initialSnapshot
  }

  getSnapshot = (): ReadonlySet<string> => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  publish(nextSnapshot: ReadonlySet<string>): void {
    const current = this.#snapshot
    if (current.size === nextSnapshot.size && [...current].every((id) => nextSnapshot.has(id))) {
      return
    }
    this.#snapshot = nextSnapshot
    for (const listener of this.#listeners) listener()
  }
}

export class ConversationTurnRowRegistry {
  readonly #rows = new Map<string, HTMLElement>()
  readonly #onUnregister: (turnId: string) => void
  #observer: TurnRowObserver | null = null

  constructor(onUnregister: (turnId: string) => void) {
    this.#onUnregister = onUnregister
  }

  setObserver(observer: TurnRowObserver | null): void {
    if (this.#observer === observer) return
    if (this.#observer) {
      for (const row of this.#rows.values()) this.#observer.unobserve(row)
    }
    this.#observer = observer
    if (observer) {
      for (const row of this.#rows.values()) observer.observe(row)
    }
  }

  register(turnId: string, node: HTMLElement | null, validIds: ReadonlySet<string>): void {
    const previous = this.#rows.get(turnId)
    if (previous === node) return
    if (previous) {
      this.#observer?.unobserve(previous)
      this.#rows.delete(turnId)
      this.#onUnregister(turnId)
    }
    if (!node || !validIds.has(turnId)) return
    this.#rows.set(turnId, node)
    this.#observer?.observe(node)
  }

  retain(validIds: ReadonlySet<string>): void {
    for (const [turnId, row] of this.#rows) {
      if (validIds.has(turnId)) continue
      this.#observer?.unobserve(row)
      this.#rows.delete(turnId)
      this.#onUnregister(turnId)
    }
  }
}

export function useConversationTurnRowVisibility(
  itemIds: readonly string[],
  scrollRef: React.RefObject<HTMLElement | null>,
): {
  registerTurnRow: RegisterConversationTurnRow
  visibilityStore: ConversationTurnVisibilityStore
} {
  const latestId = itemIds.at(-1) ?? null
  const itemIdsKey = itemIds.join('\0')
  const itemOrderRef = React.useRef(itemIds)
  const validIdsRef = React.useRef(new Set(itemIds))
  const visibleIdsRef = React.useRef(new Set<string>())
  const registryRef = React.useRef<ConversationTurnRowRegistry | null>(null)
  if (!registryRef.current) {
    registryRef.current = new ConversationTurnRowRegistry((turnId) => {
      visibleIdsRef.current.delete(turnId)
    })
  }
  const visibilityStoreRef = React.useRef<ConversationTurnVisibilityStoreImpl | null>(null)
  if (!visibilityStoreRef.current) {
    visibilityStoreRef.current = new ConversationTurnVisibilityStoreImpl(
      new Set(latestId ? [latestId] : []),
    )
  }

  itemOrderRef.current = itemIds
  validIdsRef.current = new Set(itemIds)

  const publishVisibleIds = React.useCallback((): void => {
    const itemOrder = itemOrderRef.current
    const visibleIds = visibleIdsRef.current
    const firstVisibleIndex = itemOrder.findIndex((id) => visibleIds.has(id))
    const nextVisibleIds =
      firstVisibleIndex < 0
        ? new Set(
            [...visibilityStoreRef.current!.getSnapshot()].filter((id) =>
              validIdsRef.current.has(id),
            ),
          )
        : new Set(
            itemOrder.slice(
              firstVisibleIndex,
              itemOrder.findLastIndex((id) => visibleIds.has(id)) + 1,
            ),
          )
    visibilityStoreRef.current!.publish(nextVisibleIds)
  }, [])

  const registerTurnRow = React.useCallback<RegisterConversationTurnRow>(
    (turnId, node) => {
      registryRef.current!.register(turnId, node, validIdsRef.current)
      publishVisibleIds()
    },
    [publishVisibleIds],
  )

  React.useLayoutEffect(() => {
    const validIds = new Set(itemIds)
    registryRef.current!.retain(validIds)
    publishVisibleIds()
  }, [itemIdsKey, publishVisibleIds])

  React.useLayoutEffect(() => {
    const root = scrollRef.current
    if (!root || itemIds.length === 0 || typeof IntersectionObserver === 'undefined') {
      registryRef.current!.setObserver(null)
      visibleIdsRef.current.clear()
      publishVisibleIds()
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const turnId = entry.target.getAttribute('data-input-navigation-id')
          if (!turnId || !validIdsRef.current.has(turnId)) continue
          if (entry.isIntersecting) visibleIdsRef.current.add(turnId)
          else visibleIdsRef.current.delete(turnId)
        }
        publishVisibleIds()
      },
      { root, rootMargin: '-16px 0px 0px 0px' },
    )
    registryRef.current!.setObserver(observer)

    return () => {
      registryRef.current!.setObserver(null)
      observer.disconnect()
      visibleIdsRef.current.clear()
    }
  }, [itemIdsKey, itemIds.length, publishVisibleIds, scrollRef])

  return {
    registerTurnRow,
    visibilityStore: visibilityStoreRef.current,
  }
}
