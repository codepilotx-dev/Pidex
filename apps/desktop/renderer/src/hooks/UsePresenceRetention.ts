import { useRef } from 'react'

/**
 * Keeps a lazy presence owner mounted after its first open cycle.
 * The owner may then finish its own close animation before removing its portal.
 */
export function useEverOpened(open: boolean): boolean {
  const everOpenedRef = useRef(open)
  if (open) everOpenedRef.current = true
  return everOpenedRef.current
}

/**
 * Retains the latest payload while a presence owner completes its exit cycle.
 */
export function useLastNonNull<T>(value: T | null | undefined): T | null {
  const lastValueRef = useRef<T | null>(value ?? null)
  if (value != null) lastValueRef.current = value
  return lastValueRef.current
}
