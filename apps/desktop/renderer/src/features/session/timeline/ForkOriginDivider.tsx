import React from 'react'
import { Link } from 'react-router-dom'
import { GitFork } from 'lucide-react'
import { APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'

export type ForkOriginDividerProps = {
  sourceThreadId: string
}

export function ForkOriginDivider({ sourceThreadId }: ForkOriginDividerProps): React.ReactNode {
  return (
    <div className="canonical-fork-origin-divider">
      <Link
        to={`/threads/${encodeURIComponent(sourceThreadId)}`}
        className="canonical-fork-origin-divider__link"
      >
        <GitFork
          size="var(--inline-icon-size, 1em)"
          strokeWidth={APP_ICON_STROKE_WIDTH}
          aria-hidden="true"
        />
        <span>从聊天中继续</span>
      </Link>
    </div>
  )
}
