import type { ReactNode } from 'react'
import { createStore, type StoreApi } from 'zustand/vanilla'

export type WorkspaceHeaderSlot = 'left' | 'center' | 'right'
export type WorkspaceHeaderAlign = 'start' | 'center' | 'end'

export type WorkspaceHeaderItemRegistration = {
  id: string
  routeScope: string
  slot: WorkspaceHeaderSlot
  align: WorkspaceHeaderAlign
  order: number
  node: ReactNode
}

export type WorkspaceHeaderItemSnapshot = WorkspaceHeaderItemRegistration & {
  sequence: number
  token: symbol
}

export type WorkspaceHeaderState = {
  items: readonly WorkspaceHeaderItemSnapshot[]
}

export type WorkspaceHeaderActions = {
  register: (item: WorkspaceHeaderItemRegistration, token?: symbol) => () => void
  update: (token: symbol, item: WorkspaceHeaderItemRegistration) => void
}

export type WorkspaceHeaderStore = StoreApi<WorkspaceHeaderState> & WorkspaceHeaderActions

function itemKey(item: Pick<WorkspaceHeaderItemRegistration, 'id' | 'routeScope'>): string {
  return `${item.routeScope}\u0000${item.id}`
}

export function createWorkspaceHeaderStore(): WorkspaceHeaderStore {
  const store = createStore<WorkspaceHeaderState>()(() => ({ items: [] }))
  /** 注册条目按 key 索引；symbol token 用于识别过期清理，不进入订阅快照。 */
  const entries = new Map<string, WorkspaceHeaderItemSnapshot>()
  let nextSequence = 0

  const publish = (): void => {
    store.setState({ items: [...entries.values()] })
  }

  return Object.assign(store, {
    register: (item, suppliedToken) => {
      const key = itemKey(item)
      const token = suppliedToken ?? Symbol(item.id)
      const previous = entries.get(key)
      if (previous && previous.token !== token && import.meta.env.DEV) {
        console.warn(`Duplicate workspace header item: ${item.routeScope}/${item.id}`)
      }
      entries.set(key, { ...item, sequence: nextSequence++, token })
      publish()

      return () => {
        if (entries.get(key)?.token !== token) return
        entries.delete(key)
        publish()
      }
    },
    update: (token, item) => {
      const nextKey = itemKey(item)
      const currentEntry = [...entries.entries()].find(([, value]) => value.token === token)
      if (!currentEntry) return
      const [currentKey, current] = currentEntry
      const conflict = entries.get(nextKey)
      if (conflict && conflict.token !== token && import.meta.env.DEV) {
        console.warn(`Duplicate workspace header item: ${item.routeScope}/${item.id}`)
      }
      if (currentKey !== nextKey) entries.delete(currentKey)
      entries.set(nextKey, { ...item, sequence: current.sequence, token })
      publish()
    },
  })
}

export const workspaceHeaderStore = createWorkspaceHeaderStore()

export function sortWorkspaceHeaderItems(
  items: readonly WorkspaceHeaderItemSnapshot[],
): WorkspaceHeaderItemSnapshot[] {
  return [...items].sort(
    (left, right) => left.order - right.order || left.sequence - right.sequence,
  )
}

export function selectWorkspaceHeaderItems(
  snapshot: readonly WorkspaceHeaderItemSnapshot[],
  routeScope: string,
  slot?: WorkspaceHeaderSlot,
): WorkspaceHeaderItemSnapshot[] {
  return sortWorkspaceHeaderItems(
    snapshot.filter(
      (item) => item.routeScope === routeScope && (slot === undefined || item.slot === slot),
    ),
  )
}
