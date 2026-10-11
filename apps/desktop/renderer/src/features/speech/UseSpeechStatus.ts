import { useCallback, useEffect, useState } from 'react'
import type { DesktopSpeechStatus } from '../../services/desktop-client/index.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { errorMessageOf as errorMessage } from '@pidex/shared/errors'

export type SpeechStatusState = {
  status: DesktopSpeechStatus | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  install: (force?: boolean) => Promise<void>
}

export function useSpeechStatus(): SpeechStatusState {
  const [status, setStatus] = useState<DesktopSpeechStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await desktopClient.getSpeechStatus())
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  const install = useCallback(async (force = false) => {
    setLoading(true)
    try {
      setStatus(await desktopClient.installSpeech(force))
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    let unsubscribe = () => {}
    void Promise.resolve()
      .then(() => {
        if (!active) return
        unsubscribe = desktopClient.onSpeechStatusUpdated((next) => {
          if (!active) return
          setStatus(next)
          setError(null)
          setLoading(false)
        })
        return desktopClient.getSpeechStatus()
      })
      .then(
        (next) => {
          if (!active || !next) return
          setStatus(next)
          setError(null)
          setLoading(false)
        },
        (cause) => {
          if (!active) return
          setError(errorMessage(cause))
          setLoading(false)
        },
      )
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return { status, loading, error, refresh, install }
}
