import { useEffect, useState } from 'react'
import type { RpcResult } from '@pidex/agent-protocol'
import { desktopClient } from '../../../services/desktop-client/index.js'

export function useComputerState() {
  const [state, setState] = useState<RpcResult<'computer/state'> | null>(null)
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    let disposed = false
    let unsubscribe = () => {}
    void desktopClient
      .getRuntimeCapabilities()
      .then(async (capabilities) => {
        if (disposed || !capabilities.includes('computer.use.v1')) return
        setSupported(true)
        unsubscribe = desktopClient.onComputerChanged((next) => {
          if (!disposed) setState(next)
        })
        const next = await desktopClient.getComputerState()
        if (!disposed) setState(next)
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])
  return { state, supported }
}
