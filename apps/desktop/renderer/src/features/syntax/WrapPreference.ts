import { useSyncExternalStore } from 'react'

export const CODE_WRAP_STORAGE_KEY = 'pidex.syntax.wrap-v1'

let memoryValue: boolean | undefined
const listeners = new Set<() => void>()

export function readCodeWrapPreference(): boolean {
  if (memoryValue !== undefined) return memoryValue
  if (typeof window === 'undefined') return false

  try {
    memoryValue = window.localStorage.getItem(CODE_WRAP_STORAGE_KEY) === 'true'
  } catch {
    memoryValue = false
  }
  return memoryValue
}

export function setCodeWrapPreference(nextValue: boolean): void {
  memoryValue = nextValue
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CODE_WRAP_STORAGE_KEY, String(nextValue))
    } catch {
      // Keep the in-memory preference when storage is unavailable or full.
    }
  }
  listeners.forEach((listener) => listener())
}

export function useCodeWrapPreference(): readonly [boolean, (nextValue: boolean) => void] {
  const value = useSyncExternalStore(
    subscribeCodeWrapPreference,
    readCodeWrapPreference,
    () => false,
  )
  return [value, setCodeWrapPreference] as const
}

export function subscribeCodeWrapPreference(listener: () => void): () => void {
  listeners.add(listener)
  if (typeof window === 'undefined') {
    return () => listeners.delete(listener)
  }

  const handleStorage = (event: StorageEvent): void => {
    if (event.key !== CODE_WRAP_STORAGE_KEY) return
    memoryValue = event.newValue === 'true'
    listener()
  }
  window.addEventListener('storage', handleStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
  }
}
