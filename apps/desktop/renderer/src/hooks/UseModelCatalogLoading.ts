import { useSyncExternalStore } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()
let pendingModelCatalogRequests = 0

function emitModelCatalogLoadingChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  return pendingModelCatalogRequests > 0
}

export function useModelCatalogLoading(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export async function withModelCatalogLoading<T>(operation: () => Promise<T>): Promise<T> {
  pendingModelCatalogRequests += 1
  emitModelCatalogLoadingChange()
  try {
    return await operation()
  } finally {
    pendingModelCatalogRequests = Math.max(0, pendingModelCatalogRequests - 1)
    emitModelCatalogLoadingChange()
  }
}
