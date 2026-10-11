import type React from 'react'
import { createContext, useContext, useMemo } from 'react'
import { workspaceHeaderStore, type WorkspaceHeaderStore } from './WorkspaceHeaderStore.js'

type WorkspaceHeaderContextValue = {
  routeScope: string
  store: WorkspaceHeaderStore
}

const WorkspaceHeaderContext = createContext<WorkspaceHeaderContextValue | null>(null)

export type WorkspaceHeaderProviderProps = {
  children: React.ReactNode
  routeScope: string
}

export function WorkspaceHeaderProvider({
  children,
  routeScope,
}: WorkspaceHeaderProviderProps): React.ReactNode {
  const value = useMemo(() => ({ routeScope, store: workspaceHeaderStore }), [routeScope])

  return <WorkspaceHeaderContext.Provider value={value}>{children}</WorkspaceHeaderContext.Provider>
}

export function useWorkspaceHeaderContext(): WorkspaceHeaderContextValue {
  const context = useContext(WorkspaceHeaderContext)
  if (!context) {
    throw new Error('WorkspaceHeaderProvider is required.')
  }
  return context
}
