import React from 'react'
import type { Item } from '@pidex/shared/thread'
import { useLiveItemTail } from '../state/UseLiveItemTail.js'
import { reasoningHeading } from './ReasoningPresentation.js'

export function ReasoningStatusHeading({
  item,
  threadId,
}: {
  item?: Item
  threadId?: string
}): React.ReactNode {
  const tail = useLiveItemTail(threadId, item?.id ?? '')
  return (
    <span>
      {item?.type === 'reasoning'
        ? (reasoningHeading(item.text + (tail ?? '')) ?? '正在思考')
        : '正在思考'}
    </span>
  )
}
