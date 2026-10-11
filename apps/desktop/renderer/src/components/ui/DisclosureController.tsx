import * as React from 'react'
import { DisclosureContent } from './DisclosureContent'

export type DisclosureControllerProps = {
  defaultExpanded?: boolean
  children: React.ReactNode
  renderTrigger: (state: {
    expanded: boolean
    contentId: string
    toggle: () => void
  }) => React.ReactNode
  contentClassName?: string
  mountPolicy?: 'always' | 'until-exit'
}

export const DisclosureController = React.memo(function DisclosureController({
  defaultExpanded = false,
  children,
  renderTrigger,
  contentClassName,
  mountPolicy = 'always',
}: DisclosureControllerProps): React.ReactNode {
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const contentId = React.useId()
  const toggle = React.useCallback(() => setExpanded((current) => !current), [])

  return (
    <>
      {renderTrigger({ expanded, contentId, toggle })}
      <DisclosureContent
        contentClassName={contentClassName}
        expanded={expanded}
        id={contentId}
        mountPolicy={mountPolicy}
      >
        {children}
      </DisclosureContent>
    </>
  )
})
