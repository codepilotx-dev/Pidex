import { Children, cloneElement, forwardRef } from 'react'
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react'
import { cx } from '../../../utils/Cx.js'

type SidebarRowLeadingMode = 'icon' | 'spacer' | 'none'
type SidebarRowIndent = 'none' | 'session'
type SidebarRowLayout = 'flex' | 'grid'

type Props = HTMLAttributes<HTMLElement> & {
  active?: boolean
  as?: 'div' | 'li'
  asChild?: boolean
  className?: string
  indent?: SidebarRowIndent
  labelClassName?: string
  layout: SidebarRowLayout
  leading?: ReactNode
  leadingMode?: SidebarRowLeadingMode
  trailing?: ReactNode
  children: ReactNode
}

export const SidebarRow = forwardRef<HTMLElement, Props>(function SidebarRow(
  {
    active = false,
    as = 'div',
    asChild = false,
    children,
    className,
    indent = 'none',
    labelClassName,
    layout,
    leading,
    leadingMode = leading ? 'icon' : 'spacer',
    trailing,
    ...rowProps
  },
  ref,
): ReactNode {
  const rowClassName = cx(
    'sidebar-row',
    `sidebar-row--${layout}`,
    active ? 'active' : undefined,
    active ? 'selected' : undefined,
    indent === 'session' ? 'sidebar-row--session' : undefined,
    leadingMode === 'none' ? 'sidebar-row--no-leading' : undefined,
    // Row shell: 30px row, 8px gutter, 10px radius, 2px column gap between the
    // leading slot, the label and the trailing slot.
    'tw:relative tw:grid tw:w-full tw:box-border tw:min-h-[var(--sidebar-row-height,30px)] tw:items-center tw:gap-x-2 tw:rounded-md tw:px-2 tw:text-left tw:text-app-text tw:type-body tw:no-underline tw:select-none tw:cursor-pointer tw:outline-none tw:transition-colors tw:duration-feedback tw:ease-out',
    leadingMode === 'none'
      ? trailing != null
        ? 'tw:grid-cols-[minmax(0,1fr)_auto]'
        : 'tw:grid-cols-1'
      : 'tw:grid-cols-[var(--sidebar-row-columns)]',
    active ? 'tw:bg-app-selected' : 'tw:bg-transparent',
    'tw:hover:bg-app-hover',
    className,
  )
  // Selection is also published as a data attribute so descendants can react with
  // Tailwind `group-data-[selected=true]:*` instead of targeting the `selected` class.
  const rowAttributes = active ? { ...rowProps, 'data-selected': 'true' } : rowProps

  if (asChild) {
    const child = Children.only(children) as ReactElement<{
      className?: string
      children?: ReactNode
      ref?: Ref<HTMLElement>
    }>

    return cloneElement(
      child,
      {
        ...rowAttributes,
        className: cx(rowClassName, child.props.className),
        ref,
      },
      renderRowContent({
        children: child.props.children,
        labelClassName,
        layout,
        leading,
        leadingMode,
        trailing,
      }),
    )
  }

  const Component = as
  return (
    <Component
      className={rowClassName}
      ref={ref as Ref<HTMLDivElement> & Ref<HTMLLIElement>}
      {...rowAttributes}
    >
      {renderRowContent({
        children,
        labelClassName,
        layout,
        leading,
        leadingMode,
        trailing,
      })}
    </Component>
  )
})

function renderRowContent({
  children,
  labelClassName,
  layout,
  leading,
  leadingMode,
  trailing,
}: {
  children: ReactNode
  labelClassName?: string
  layout: SidebarRowLayout
  leading?: ReactNode
  leadingMode: SidebarRowLeadingMode
  trailing?: ReactNode
}): ReactNode {
  const hasLeading =
    leadingMode === 'icon' ? leading !== undefined && leading !== null : leadingMode === 'spacer'
  const hasTrailing = trailing !== undefined && trailing !== null

  return (
    <>
      {hasLeading ? (
        <span
          aria-hidden={leadingMode === 'spacer' ? true : undefined}
          className={cx(
            'sidebar-row-leading tw:flex tw:min-w-0 tw:items-center',
            leadingMode === 'icon'
              ? 'sidebar-item-icon tw:w-6 tw:shrink-0 tw:grow-0 tw:basis-6 tw:justify-center'
              : 'sidebar-row-leading-spacer tw:size-6 tw:w-6 tw:min-w-6 tw:shrink-0 tw:grow-0 tw:basis-6 tw:justify-center',
          )}
        >
          {leadingMode === 'icon' ? leading : null}
        </span>
      ) : null}
      <span
        className={cx(
          'sidebar-row-main tw:flex tw:w-full tw:min-w-0 tw:items-center',
          labelClassName,
        )}
      >
        {children}
      </span>
      {hasTrailing ? (
        <span className="sidebar-row-trailing tw:flex tw:w-full tw:min-w-0 tw:items-center tw:justify-end">
          {trailing}
        </span>
      ) : null}
    </>
  )
}

export function SidebarEmptyRow({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }): ReactNode {
  return (
    <div
      {...props}
      className={cx(
        'sidebar-row',
        'sidebar-row--flex',
        'sidebar-empty-row',
        'tw:type-body-sm tw:text-app-text-soft',
        'tw:grid tw:w-full tw:box-border tw:min-h-[var(--sidebar-row-height,30px)] tw:items-center tw:rounded-md tw:px-2 tw:py-1',
        // The empty row keeps the shared row grid (3-column template), matching
        // the former `.sidebar-row--flex` shell.
        'tw:grid-cols-[var(--sidebar-row-columns)] tw:gap-x-2',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="sidebar-row-leading sidebar-row-leading-spacer tw:flex tw:size-6 tw:w-6 tw:min-w-6 tw:shrink-0 tw:grow-0 tw:basis-6 tw:items-center tw:justify-center"
      />
      <p className="sidebar-empty tw:m-0 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text-soft">
        {children}
      </p>
    </div>
  )
}
