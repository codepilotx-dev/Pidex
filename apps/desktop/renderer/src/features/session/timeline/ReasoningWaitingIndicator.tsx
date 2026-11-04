import React from 'react'
import { LoaderCircle } from 'lucide-react'
import type { Item } from '@pidex/shared/thread'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { useLiveItemTail } from '../state/UseLiveItemTail.js'

export function ReasoningWaitingIndicator({
  item,
  threadId,
}: {
  item?: Item
  threadId?: string
}): React.ReactNode {
  const reasoning = item?.type === 'reasoning' && item.status === 'streaming' ? item : undefined
  const tail = useLiveItemTail(threadId, reasoning?.id ?? '')
  if (reasoning && (reasoning.text + tail).trim()) return null
  return (
    <div className="canonical-turn__thinking" role="status" aria-live="polite">
      <LoaderCircle size={APP_ICON_SIZES.sm} className="canonical-spin" aria-hidden="true" />
      <span>正在思考</span>
    </div>
  )
}
