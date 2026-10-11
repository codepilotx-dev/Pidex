import React from 'react'

import { usePrefersReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'

export type DisclosureContentProps = {
  id: string
  expanded: boolean
  children: React.ReactNode
  className?: string
  contentClassName?: string
  mountPolicy?: 'always' | 'until-exit'
  role?: React.AriaRole
  'aria-labelledby'?: string
}

export function DisclosureContent({
  id,
  expanded,
  children,
  className,
  contentClassName,
  mountPolicy = 'always',
  role,
  'aria-labelledby': ariaLabelledBy,
}: DisclosureContentProps): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const expandedRef = React.useRef(expanded)
  const [retained, setRetained] = React.useState(() => mountPolicy === 'always' || expanded)

  expandedRef.current = expanded

  React.useEffect(() => {
    if (mountPolicy === 'always') {
      setRetained(true)
      return
    }
    if (expanded) {
      setRetained(true)
      return
    }
    if (reducedMotion) {
      setRetained(false)
      return
    }
  }, [expanded, mountPolicy, reducedMotion])

  const renderContent = mountPolicy === 'always' || expanded || retained

  return (
    <div
      aria-hidden={!expanded}
      aria-labelledby={ariaLabelledBy}
      className={joinClassNames(
        'ui-disclosure-content tw:grid tw:min-w-0 tw:grid-rows-[1fr] tw:transition-[grid-template-rows] tw:duration-disclosure tw:ease-disclosure tw:data-[expanded=false]:grid-rows-[0fr] tw:data-[expanded=false]:pointer-events-none',
        className,
      )}
      data-expanded={expanded ? 'true' : 'false'}
      data-mount-policy={mountPolicy}
      id={id}
      inert={!expanded ? true : undefined}
      onTransitionEnd={(event) => {
        completeExit(event, expandedRef, mountPolicy, setRetained)
      }}
      role={role}
    >
      <div className="ui-disclosure-content__clip tw:min-w-0 tw:min-h-0 tw:overflow-hidden">
        {renderContent ? (
          <div
            className={joinClassNames('ui-disclosure-content__body tw:min-w-0', contentClassName)}
          >
            {children}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function completeExit(
  event: React.TransitionEvent<HTMLDivElement>,
  expandedRef: React.RefObject<boolean>,
  mountPolicy: DisclosureContentProps['mountPolicy'],
  setRetained: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  if (
    event.currentTarget !== event.target ||
    event.propertyName !== 'grid-template-rows' ||
    expandedRef.current ||
    mountPolicy !== 'until-exit'
  ) {
    return
  }
  setRetained(false)
}
