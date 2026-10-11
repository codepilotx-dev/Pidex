import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopAuthSession, DesktopAuthTarget } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'

type Options = {
  target: DesktopAuthTarget | null
  onComplete?: () => void | Promise<void>
  onError?: (message: string) => void
}

export function useAuthSession({ target, onComplete, onError }: Options) {
  const [session, setSession] = useState<DesktopAuthSession | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const sessionRef = useRef<DesktopAuthSession | null>(null)
  const callbacks = useRef({ onComplete, onError })
  callbacks.current = { onComplete, onError }

  const fail = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    setBusy(false)
    callbacks.current.onError?.(message)
  }, [])

  const applySession = useCallback(async (next: DesktopAuthSession) => {
    const previousPromptID = sessionRef.current?.prompt?.id
    sessionRef.current = next
    setSession(next)

    if (next.status === 'waiting') {
      setBusy(false)

      if (next.prompt?.id !== previousPromptID) {
        setValue(next.prompt?.type === 'select' ? (next.prompt.options?.[0]?.id ?? '') : '')
      }
      return
    }

    if (next.status === 'complete') {
      setBusy(false)
      setValue('')
      await callbacks.current.onComplete?.()
      return
    }
    if (next.status === 'failed' || next.status === 'expired') {
      setBusy(false)
      callbacks.current.onError?.(next.error ?? '授权未完成，请重试。')
      return
    }
    if (next.status === 'cancelled') setBusy(false)
  }, [])

  const start = useCallback(async () => {
    if (!target) return
    sessionRef.current = null
    setSession(null)
    setBusy(true)
    setValue('')
    try {
      await applySession(await desktopClient.startAuthSession(target))
    } catch (error) {
      fail(error)
    }
  }, [applySession, fail, target])

  const respond = useCallback(async () => {
    if (!session?.prompt || !value.trim()) return
    setBusy(true)
    try {
      await applySession(
        await desktopClient.respondAuthSession(session.id, session.prompt.id, value),
      )
      setValue('')
    } catch (error) {
      fail(error)
    }
  }, [applySession, fail, session, value])

  const cancel = useCallback(async () => {
    const current = session
    sessionRef.current = null
    setSession(null)
    setValue('')
    setBusy(false)
    if (!current || !['running', 'waiting'].includes(current.status)) return
    try {
      await desktopClient.cancelAuthSession(current.id)
    } catch {
      // Closing a dialog is best-effort; the Agent also expires sessions.
    }
  }, [session])

  useEffect(
    () => () => {
      const current = sessionRef.current
      if (current && ['running', 'waiting'].includes(current.status)) {
        void desktopClient.cancelAuthSession(current.id).catch(() => {})
      }
    },
    [],
  )

  useEffect(() => {
    if (!session || !['running', 'waiting'].includes(session.status)) return
    let disposed = false
    const timer = setInterval(() => {
      void desktopClient
        .getAuthSessionStatus(session.id)
        .then((next) => {
          if (!disposed) void applySession(next)
        })
        .catch((error) => {
          if (!disposed) fail(error)
        })
    }, 1_000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [applySession, fail, session])

  return {
    busy,
    cancel,
    respond,
    session,
    setValue,
    start,
    value,
  }
}
