import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  type RefObject,
  type CSSProperties,
} from 'react'

export type FloatingAnchor = Pick<HTMLElement, 'getBoundingClientRect'> & {
  contains?: (target: Node | null) => boolean
}

export type FloatingPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end'
  | 'auto'

export type FloatingCollisionPadding =
  number | Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>
export function computeFloatingPosition({
  anchorRect,
  contentWidth,
  contentHeight,
  viewportWidth,
  viewportHeight,
  placement = 'bottom-start',
  offset = 6,
  collisionPadding = 8,
  avoidCollisions = true,
}: {
  anchorRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>
  contentWidth: number
  contentHeight: number
  viewportWidth: number
  viewportHeight: number
  placement?: FloatingPlacement
  offset?: number
  collisionPadding?: FloatingCollisionPadding
  avoidCollisions?: boolean
}): FloatingCoordinates {
  const padding =
    typeof collisionPadding === 'number'
      ? {
          top: collisionPadding,
          right: collisionPadding,
          bottom: collisionPadding,
          left: collisionPadding,
        }
      : { top: 8, right: 8, bottom: 8, left: 8, ...collisionPadding }
  let [side, align = 'center'] = (placement === 'auto' ? 'bottom-start' : placement).split('-')
  if (avoidCollisions) {
    const available = {
      top: anchorRect.top - offset - padding.top,
      bottom: viewportHeight - anchorRect.bottom - offset - padding.bottom,
      left: anchorRect.left - offset - padding.left,
      right: viewportWidth - anchorRect.right - offset - padding.right,
    }
    const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const
    const current = side as keyof typeof opposite
    const length = side === 'top' || side === 'bottom' ? contentHeight : contentWidth
    if (available[current] < length && available[opposite[current]] >= length)
      side = opposite[current]
  }
  let top =
    side === 'top'
      ? anchorRect.top - contentHeight - offset
      : side === 'bottom'
        ? anchorRect.bottom + offset
        : align === 'start'
          ? anchorRect.top
          : align === 'end'
            ? anchorRect.bottom - contentHeight
            : anchorRect.top + (anchorRect.height - contentHeight) / 2
  let left =
    side === 'left'
      ? anchorRect.left - contentWidth - offset
      : side === 'right'
        ? anchorRect.right + offset
        : align === 'start'
          ? anchorRect.left
          : align === 'end'
            ? anchorRect.right - contentWidth
            : anchorRect.left + (anchorRect.width - contentWidth) / 2
  if (avoidCollisions) {
    top = Math.max(padding.top, Math.min(top, viewportHeight - contentHeight - padding.bottom))
    left = Math.max(padding.left, Math.min(left, viewportWidth - contentWidth - padding.right))
  }
  return {
    top: Math.round(top),
    left: Math.round(left),
    actualPlacement: (side + (align === 'center' ? '' : '-' + align)) as FloatingPlacement,
  }
}

export interface UseFloatingPositionOptions {
  /** 触发器或锚点元素 Ref 或 DOM 对象 */
  anchor: RefObject<FloatingAnchor | null> | FloatingAnchor | null
  /** 浮层内容元素 Ref */
  contentRef: RefObject<HTMLElement | null>
  /** 是否处于展开状态 */
  isOpen: boolean
  /** 预期对齐方位，默认 'bottom-start' */
  placement?: FloatingPlacement
  /** 锚点与浮层之间的垂直/水平间距（px），默认 6 */
  offset?: number
  /** 距离视口边界的安全内边距（px），默认 8 */
  collisionPadding?: FloatingCollisionPadding
  avoidCollisions?: boolean
  /** 是否使用 fixed 定位（用于 Portal 挂载到 body），默认 true */
  portal?: boolean
}

export interface FloatingCoordinates {
  top: number
  left: number
  actualPlacement: FloatingPlacement
}

export function useFloatingPosition({
  anchor,
  contentRef,
  isOpen,
  placement = 'bottom-start',
  offset = 6,
  collisionPadding = 8,
  avoidCollisions = true,
  portal = true,
}: UseFloatingPositionOptions) {
  const [coords, setCoords] = useState<FloatingCoordinates | null>(null)

  const getAnchorElement = useCallback((): FloatingAnchor | null => {
    if (!anchor) return null
    if ('current' in anchor) {
      return anchor.current
    }
    return anchor
  }, [anchor])

  const updatePosition = useCallback(() => {
    const anchorEl = getAnchorElement()
    const contentEl = contentRef.current
    if (!anchorEl || !contentEl || !isOpen) return

    const computed = computeFloatingPosition({
      anchorRect: anchorEl.getBoundingClientRect(),
      contentWidth: contentEl.offsetWidth || 200,
      contentHeight: contentEl.offsetHeight || 180,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      placement,
      offset,
      collisionPadding,
      avoidCollisions,
    })
    let { top, left } = computed
    // 非 Portal 模式下转换为相对 offsetParent 的坐标
    if (!portal) {
      const offsetParent = contentEl.offsetParent as HTMLElement | null
      if (offsetParent) {
        const parentRect = offsetParent.getBoundingClientRect()
        top = top - parentRect.top
        left = left - parentRect.left
      }
    }

    const nextTop = Math.round(top)
    const nextLeft = Math.round(left)
    const nextPlacement = computed.actualPlacement

    setCoords((prev) => {
      if (
        prev &&
        prev.top === nextTop &&
        prev.left === nextLeft &&
        prev.actualPlacement === nextPlacement
      ) {
        return prev
      }
      return {
        top: nextTop,
        left: nextLeft,
        actualPlacement: nextPlacement,
      }
    })
  }, [
    getAnchorElement,
    contentRef,
    isOpen,
    placement,
    offset,
    collisionPadding,
    avoidCollisions,
    portal,
  ])

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition()
    } else {
      setCoords(null)
    }
  }, [isOpen, updatePosition])

  // 监听窗口尺寸变化、全局滚动以及内容尺寸动态变更
  useEffect(() => {
    if (!isOpen) return

    const handleScrollOrResize = () => {
      updatePosition()
    }

    window.addEventListener('resize', handleScrollOrResize)
    window.addEventListener('scroll', handleScrollOrResize, true)

    const contentEl = contentRef.current
    const anchorEl = getAnchorElement()
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        updatePosition()
      })
      if (contentEl) ro.observe(contentEl)
      if (anchorEl instanceof Element) ro.observe(anchorEl)
    }

    return () => {
      window.removeEventListener('resize', handleScrollOrResize)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      ro?.disconnect()
    }
  }, [isOpen, updatePosition, getAnchorElement, contentRef])

  const floatingStyle: CSSProperties = {
    margin: 0,
    inset: 'auto',
    position: portal ? 'fixed' : 'absolute',
    top: coords ? `${coords.top}px` : '-9999px',
    left: coords ? `${coords.left}px` : '-9999px',
    opacity: coords ? 1 : 0,
    pointerEvents: coords ? 'auto' : 'none',
  }

  return {
    coords,
    floatingStyle,
    updatePosition,
  }
}
