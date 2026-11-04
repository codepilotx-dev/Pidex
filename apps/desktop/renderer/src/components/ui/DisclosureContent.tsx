import React from 'react'

import { usePrefersReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'

const DisclosureExpandedContext = React.createContext<boolean | null>(null)

/**
 * 读取最近的 DisclosureContent 及其祖先的展开状态。
 * 不在折叠区域内（例如独立渲染）时返回 null，由调用方自行决定默认行为。
 */
export function useDisclosureContentExpanded(): boolean | null {
  return React.useContext(DisclosureExpandedContext)
}

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
  // 嵌套折叠区域的可见性取多层合取：任意一层收起都应视为内容不可见。
  const ancestorExpanded = React.useContext(DisclosureExpandedContext)
  const visibleExpanded = expanded && (ancestorExpanded ?? true)

  return (
    <DisclosureExpandedContext.Provider value={visibleExpanded}>
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
    </DisclosureExpandedContext.Provider>
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
