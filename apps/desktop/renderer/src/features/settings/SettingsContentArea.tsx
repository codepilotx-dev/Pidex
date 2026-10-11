import type React from 'react'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import { cx } from '../../utils/Cx.js'

type Props = {
  children: React.ReactNode
  className?: string
}

export function SettingsContentArea({ children, className = '' }: Props): React.ReactNode {
  return (
    <ScrollArea
      className={cx(
        'settings-content-scroll-area tw:min-h-0 tw:w-full tw:min-w-0 tw:flex-1 tw:overflow-x-hidden tw:overscroll-contain tw:bg-app-canvas',
        className,
      )}
      contentClassName="settings-content-scroll-content tw:min-h-full"
    >
      {children}
    </ScrollArea>
  )
}
