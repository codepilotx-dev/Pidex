import { useEffect, useState } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'

export type SubagentsAvailability = 'loading' | 'available' | 'unavailable'

/** 运行期能力检查：目录 tab 只在该 Agent 声明 subagents.v1 时可打开。 */
export function useSubagentsAvailability(): SubagentsAvailability {
  const [availability, setAvailability] = useState<SubagentsAvailability>('loading')
  useEffect(() => {
    let disposed = false
    void desktopClient
      .getRuntimeCapabilities()
      .then((capabilities) => {
        if (!disposed) {
          setAvailability(capabilities.includes('subagents.v1') ? 'available' : 'unavailable')
        }
      })
      .catch(() => {
        if (!disposed) setAvailability('unavailable')
      })
    return () => {
      disposed = true
    }
  }, [])
  return availability
}
