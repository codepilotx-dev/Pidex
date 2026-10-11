import type { MiniMaxCliStatus } from '@pidex/agent-protocol'
import { useCallback, useEffect, useState } from 'react'
import { desktopClient } from '../../services/desktop-client/index.js'

type CodedError = Error & { code?: string }

const unsupported = (cause: unknown) =>
  cause instanceof Error &&
  ((cause as CodedError).code === 'AGENT_OPERATION_UNSUPPORTED' ||
    cause.message.includes('AGENT_OPERATION_UNSUPPORTED'))

export type MiniMaxCliState = {
  status: MiniMaxCliStatus | undefined
  loading: boolean
  busy: boolean
  unsupported: boolean
  error: string | null
  refresh: () => void
  install: () => Promise<MiniMaxCliStatus>
  uninstall: () => Promise<MiniMaxCliStatus>
}

export function useMiniMaxCli(): MiniMaxCliState {
  const [status, setStatus] = useState<MiniMaxCliStatus | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [isUnsupported, setUnsupported] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(null)
    desktopClient
      .getMiniMaxCliStatus(reloadKey > 0)
      .then((result) => {
        if (cancelled) return
        setStatus(result)
        setUnsupported(false)
      })
      .catch((cause) => {
        if (cancelled) return
        if (unsupported(cause)) {
          setUnsupported(true)
          setStatus(undefined)
          return
        }
        setError(cause instanceof Error ? cause.message : 'MiniMax CLI 状态读取失败。')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(
    () =>
      desktopClient.onMiniMaxCliUpdated((next) => {
        setStatus(next)
        setError(null)
      }),
    [],
  )

  const install = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await desktopClient.installMiniMaxCli()
      setStatus(next)
      return next
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'MiniMax CLI 安装失败。'
      setError(message)
      throw cause
    } finally {
      setBusy(false)
    }
  }, [])

  const uninstall = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await desktopClient.uninstallMiniMaxCli()
      setStatus(next)
      return next
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'MiniMax CLI 卸载失败。'
      setError(message)
      throw cause
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    status,
    loading: status === undefined && error === null && !isUnsupported,
    busy,
    unsupported: isUnsupported,
    error,
    refresh: () => setReloadKey((current) => current + 1),
    install,
    uninstall,
  }
}
