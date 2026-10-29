import type React from 'react'
import { cx } from '../../utils/Cx.js'
import './Skeleton.css'

export type SkeletonRegionProps = {
  label: string
  className?: string
  /** 区域内骨架块播放扫光；默认关闭，仅侧栏首屏等明确加载场景启用。 */
  shimmer?: boolean
  children: React.ReactNode
}

export type SkeletonBlockProps = {
  className?: string
  label?: string
  shimmer?: boolean
}

export function SkeletonRegion({
  label,
  className,
  shimmer,
  children,
}: SkeletonRegionProps): React.ReactNode {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cx('ui-skeleton-region tw:min-w-0', className)}
      data-shimmer={shimmer ? 'true' : undefined}
      role="status"
    >
      <span className="tw:sr-only">{label}</span>
      {children}
    </div>
  )
}

export function SkeletonBlock({
  className,
  label,
  shimmer,
}: SkeletonBlockProps): React.ReactNode {
  return (
    <span
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      className={cx(
        'ui-skeleton-block tw:relative tw:block tw:overflow-hidden tw:shadow-none',
        className,
      )}
      data-shimmer={shimmer ? 'true' : undefined}
      role={label ? 'status' : undefined}
    />
  )
}
