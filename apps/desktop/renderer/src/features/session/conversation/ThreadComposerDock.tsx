import type React from 'react'
import { forwardRef } from 'react'

import { ComposerFrame } from '../composer/ComposerSurface.js'

type ThreadComposerDockProps = {
  children: React.ReactNode
  style?: React.CSSProperties
}

/** Shared thread composer shell used by the main conversation and side chats. */
export const ThreadComposerDock = forwardRef<HTMLDivElement, ThreadComposerDockProps>(
  function ThreadComposerDock({ children, style }, ref) {
    return (
      <div
        className="chat-composer workflow-page__composer tw:relative tw:flex tw:w-full tw:flex-none tw:justify-center tw:p-0 tw:pointer-events-none tw:[&_.composer]:w-full tw:[&_.inline-approval-card]:w-full tw:[&_.inline-approval-card]:pointer-events-auto tw:[&_.inline-approval-card]:z-composer tw:[&_.workflow-composer-card]:w-full"
        data-component="thread-composer-dock"
      >
        <ComposerFrame
          ref={ref}
          className="workflow-page__composer-inner tw:pointer-events-auto tw:[&_.inline-approval-card]:w-full tw:[&_.inline-approval-card]:max-w-none tw:[&_.workflow-composer-card]:w-full tw:[&_.workflow-composer-card]:max-w-none"
          style={style}
        >
          {children}
        </ComposerFrame>
      </div>
    )
  },
)
