import React from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { ProtocolCapability } from '@pidex/agent-protocol'

export function useQuestionSkipCapability(requestId: string, enabled: boolean): boolean {
  return useApprovalCapability(requestId, enabled, 'interaction.questionSkip.v1')
}

export function useApprovalCapability(
  requestId: string,
  enabled: boolean,
  capability: ProtocolCapability,
): boolean {
  const [available, setAvailable] = React.useState(false)
  React.useEffect(() => {
    let active = true
    setAvailable(false)
    if (enabled)
      void desktopClient
        .getRuntimeCapabilities()
        .then((capabilities) => {
          if (active) setAvailable(capabilities.includes(capability))
        })
        .catch(() => {
          if (active) setAvailable(false)
        })
    return () => {
      active = false
    }
  }, [requestId, enabled, capability])
  return available
}
