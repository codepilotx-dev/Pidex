import { useStore } from 'zustand/react'
import { createStore } from 'zustand/vanilla'

type ModelCatalogLoadingState = {
  pendingRequests: number
}

/** 模型目录请求的共享加载计数；只保存可订阅的计数，请求本身由调用方持有。 */
export const modelCatalogLoadingStore = createStore<ModelCatalogLoadingState>()(() => ({
  pendingRequests: 0,
}))

export function useModelCatalogLoading(): boolean {
  return useStore(modelCatalogLoadingStore, (state) => state.pendingRequests > 0)
}

export async function withModelCatalogLoading<T>(operation: () => Promise<T>): Promise<T> {
  modelCatalogLoadingStore.setState((state) => ({ pendingRequests: state.pendingRequests + 1 }))
  try {
    return await operation()
  } finally {
    modelCatalogLoadingStore.setState((state) => ({
      pendingRequests: Math.max(0, state.pendingRequests - 1),
    }))
  }
}
