import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand/react'

export const CODE_WRAP_STORAGE_KEY = 'pidex.syntax.wrap-v1'

function readStored(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(CODE_WRAP_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * 换行偏好是跨组件共享的应用偏好：Zustand 只承载可订阅的布尔值，
 * localStorage 持久化与跨窗口 StorageEvent 同步继续由本模块负责。
 */
export const codeWrapStore = createStore<{ wrapped: boolean }>(() => ({ wrapped: readStored() }))

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== CODE_WRAP_STORAGE_KEY) return
    codeWrapStore.setState({ wrapped: event.newValue === 'true' })
  })
}

export function readCodeWrapPreference(): boolean {
  return codeWrapStore.getState().wrapped
}

export function setCodeWrapPreference(nextValue: boolean): void {
  codeWrapStore.setState({ wrapped: nextValue })
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CODE_WRAP_STORAGE_KEY, String(nextValue))
    } catch {
      // Keep the in-memory preference when storage is unavailable or full.
    }
  }
}

export function useCodeWrapPreference(): readonly [boolean, (nextValue: boolean) => void] {
  const wrapped = useStore(codeWrapStore, (state) => state.wrapped)
  return [wrapped, setCodeWrapPreference] as const
}

export function subscribeCodeWrapPreference(listener: () => void): () => void {
  return codeWrapStore.subscribe(listener)
}
