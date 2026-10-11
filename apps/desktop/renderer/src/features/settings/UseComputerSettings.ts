import { useEffect, useState } from 'react'
import type { RpcResult } from '@pidex/agent-protocol'
import { desktopClient } from '../../services/desktop-client/index.js'

const emptyState: RpcResult<'computer/state'> = {
  enabled: false,
  available: false,
  ownerThreadId: null,
  ownerTurnId: null,
  targetName: null,
  busy: false,
  permissions: [],
}

export function useComputerSettings() {
  const [state, setState] = useState<RpcResult<'computer/state'>>(emptyState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    void desktopClient
      .getComputerState()
      .then((next) => {
        if (!disposed) setState(next)
      })
      .catch(() => {
        if (!disposed) setError('电脑控制状态暂时不可用')
      })
    const dispose = desktopClient.onComputerChanged((next) => setState(next))
    return () => {
      disposed = true
      dispose()
    }
  }, [])

  async function update(
    input: Parameters<typeof desktopClient.configureComputer>[0],
  ): Promise<void> {
    setBusy(true)
    setError('')
    try {
      setState(await desktopClient.configureComputer(input))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '电脑控制设置未保存')
    } finally {
      setBusy(false)
    }
  }

  return { state, busy, error, update }
}
