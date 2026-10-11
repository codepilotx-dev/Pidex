import type { ReactNode } from 'react'

export type CommandMenuActionGroup = 'workspace-actions' | 'task-transfer'
export type CommandMenuActionAvailability = 'available' | 'disabled' | 'loading'

export type CommandMenuActionRegistration = {
  id: string
  group: CommandMenuActionGroup
  label: string
  description?: string
  keywords: readonly string[]
  icon?: ReactNode
  selected?: boolean
  order: number
  availability: CommandMenuActionAvailability
  disabledReason?: string
  execute: () => void | Promise<void>
}

export type CommandMenuActionSnapshot = CommandMenuActionRegistration & {
  sequence: number
  token: symbol
}

export type CommandMenuActionStore = {
  getSnapshot: () => readonly CommandMenuActionSnapshot[]
  getServerSnapshot: () => readonly CommandMenuActionSnapshot[]
  subscribe: (listener: () => void) => () => void
  register: (action: CommandMenuActionRegistration, token?: symbol) => () => void
  update: (token: symbol, action: CommandMenuActionRegistration) => void
}

export function createCommandMenuActionStore(): CommandMenuActionStore {
  const entries = new Map<symbol, CommandMenuActionSnapshot>()
  const listeners = new Set<() => void>()
  let snapshot: readonly CommandMenuActionSnapshot[] = []
  let nextSequence = 0

  const publish = (): void => {
    snapshot = [...entries.values()].sort(
      (left, right) => left.order - right.order || left.sequence - right.sequence,
    )
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    register: (action, suppliedToken) => {
      const token = suppliedToken ?? Symbol(action.id)
      const conflicting = [...entries.values()].find((entry) => entry.id === action.id)
      if (conflicting && conflicting.token !== token && import.meta.env.DEV) {
        console.warn(`Duplicate command menu action: ${action.id}`)
      }
      entries.set(token, { ...action, sequence: nextSequence, token })
      nextSequence += 1
      publish()
      return () => {
        if (!entries.delete(token)) return
        publish()
      }
    },
    update: (token, action) => {
      const current = entries.get(token)
      if (!current) return
      entries.set(token, { ...action, sequence: current.sequence, token })
      publish()
    },
  }
}

export function filterCommandMenuActions(
  actions: readonly CommandMenuActionSnapshot[],
  query: string,
): CommandMenuActionSnapshot[] {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return [...actions]
  return actions.filter((action) =>
    [action.label, action.description ?? '', action.disabledReason ?? '', ...action.keywords]
      .join(' ')
      .toLocaleLowerCase()
      .includes(keyword),
  )
}

export function registerCommandMenuActions(
  store: CommandMenuActionStore,
  actions: readonly CommandMenuActionRegistration[],
): () => void {
  let active = true
  const unregister = actions.map((action) =>
    store.register({
      ...action,
      execute: () => (active ? action.execute() : undefined),
    }),
  )
  return () => {
    active = false
    for (const dispose of unregister) dispose()
  }
}

export const commandMenuActionStore = createCommandMenuActionStore()
