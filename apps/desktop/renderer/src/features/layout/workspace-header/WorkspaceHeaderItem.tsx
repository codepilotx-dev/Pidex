import type React from 'react'
import { useLayoutEffect, useMemo } from 'react'
import { useWorkspaceHeaderContext } from './WorkspaceHeaderProvider.js'
import type { WorkspaceHeaderAlign, WorkspaceHeaderSlot } from './WorkspaceHeaderStore.js'

export type WorkspaceHeaderItemProps = {
  align?: WorkspaceHeaderAlign
  children: React.ReactNode
  id: string
  order?: number
  slot: WorkspaceHeaderSlot
}

export function WorkspaceHeaderItem({
  align = 'start',
  children,
  id,
  order = 0,
  slot,
}: WorkspaceHeaderItemProps): null {
  const { routeScope, store } = useWorkspaceHeaderContext()
  const token = useMemo(() => Symbol(id), [id, routeScope])
  const item = useMemo(
    () => ({
      id,
      routeScope,
      slot,
      align,
      order,
      node: children,
    }),
    [align, children, id, order, routeScope, slot],
  )

  useLayoutEffect(() => store.register(item, token), [id, routeScope, store, token])
  useLayoutEffect(() => store.update(token, item), [item, store, token])

  return null
}
