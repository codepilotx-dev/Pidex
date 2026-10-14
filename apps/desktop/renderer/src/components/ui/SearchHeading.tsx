import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Button } from './Button.js'
import { APP_ICON_SIZE } from './IconTokens.js'
import type { SearchInputProps } from './SearchInput.js'
import { cx } from '../../utils/Cx.js'

export function SearchHeading({
  title,
  search,
}: {
  title: ReactNode
  search: ReactElement<SearchInputProps>
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const didOpen = useRef(false)

  useEffect(() => {
    if (expanded) {
      didOpen.current = true
      containerRef.current?.querySelector('input')?.focus()
    } else if (didOpen.current) {
      triggerRef.current?.focus()
    }
  }, [expanded])

  return (
    <div className="search-heading tw:relative tw:flex tw:min-h-9 tw:min-w-0 tw:flex-1 tw:items-center">
      <div className={cx('tw:min-w-0 tw:flex-1 tw:pe-10', expanded && 'tw:invisible')}>
        {title}
      </div>
      <div
        ref={containerRef}
        inert={!expanded}
        aria-hidden={!expanded}
        className={cx(
          'tw:absolute tw:right-0 tw:overflow-hidden tw:transition-[width] tw:duration-state tw:ease-standard tw:motion-reduce:transition-none tw:[&_.search-input]:w-full',
          expanded ? 'tw:w-full' : 'tw:w-9',
        )}
      >
        <div className={expanded ? 'tw:visible' : 'tw:invisible'}>
          {cloneElement(search, { onClose: () => setExpanded(false) })}
        </div>
      </div>
      <Button
        ref={triggerRef}
        isIconOnly
        aria-label={search.props['aria-label']}
        aria-expanded={expanded}
        title={search.props['aria-label']}
        color="ghostSecondary"
        size="toolbar"
        className={cx('tw:absolute tw:right-0', expanded && 'tw:invisible')}
        onClick={() => setExpanded(true)}
      >
        <Search aria-hidden size={APP_ICON_SIZE} />
      </Button>
    </div>
  )
}
