import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { PointerSensor, KeyboardSensor } from '@dnd-kit/react'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import { SortableKeyboardPlugin } from '@dnd-kit/dom/sortable'
import { cx } from '../../../utils/Cx.js'
import { useSidebarDragList, type SidebarRegisteredItem } from './SidebarDragContext.js'

export const SIDEBAR_REORDER_EXCLUDED_TARGETS =
  'input, textarea, select, a, [contenteditable="true"], [data-sidebar-reorder-exclude], .sidebar-project-actions, .sidebar-session-actions, .sidebar-session-confirm-archive-button, .sidebar-section-actions'
const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation(event, source) {
      const target = event.target
      return (
        !(target instanceof Element) ||
        Boolean(target.closest(SIDEBAR_REORDER_EXCLUDED_TARGETS)) ||
        target.closest('[data-sidebar-sortable]') !== source.element
      )
    },
  }),
  KeyboardSensor.configure({
    keyboardCodes: {
      start: ['Space'],
      cancel: ['Escape'],
      end: ['Space', 'Enter', 'Tab'],
      up: ['ArrowUp'],
      down: ['ArrowDown'],
      left: ['ArrowLeft'],
      right: ['ArrowRight'],
    },
    preventActivation(event, source) {
      const target = event.target
      return (
        !(target instanceof Element) ||
        !target.matches(
          '.sidebar-session-button, .sidebar-project-button, .sidebar-section-toggle',
        ) ||
        target.closest('[data-sidebar-sortable]') !== source.element
      )
    },
  }),
]

type Props = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'li'
  children: ReactNode
  value: string
  dragHandleSelector?: string
  reducedMotion: boolean
  /** 该项目条目自身可接收聊天（项目行中间区域）。 */
  receives?: boolean
}

/** 源条目始终留在源容器，跨分组只预览插入位置；放下后才改变归属。 */
export const SidebarReorderItem = forwardRef<HTMLElement, Props>(function SidebarReorderItem(
  {
    as = 'div',
    children,
    value,
    dragHandleSelector,
    reducedMotion,
    receives,
    className,
    onClickCapture,
    ...props
  },
  forwardedRef,
): ReactNode {
  const list = useSidebarDragList()
  const suppressClick = useRef(false)
  const handleObserver = useRef<MutationObserver | null>(null)
  const { ref, handleRef, isDragSource } = useSortable<SidebarRegisteredItem>({
    id: `${list?.instanceId ?? list?.key}::${value}`,
    group: list?.instanceId ?? list?.key,
    index: list?.order.indexOf(value) ?? 0,
    data: list ? { list, key: value } : undefined,
    disabled: !list,
    accept: (source) =>
      ((source.data as SidebarRegisteredItem).list?.key === 'sections') ===
      (list?.key === 'sections'),
    sensors,
    plugins: [SortableKeyboardPlugin],
    transition: { duration: reducedMotion ? 0 : 220 },
  })
  useEffect(() => {
    if (isDragSource) suppressClick.current = true
  }, [isDragSource])
  const assignRef = useCallback(
    (element: HTMLElement | null) => {
      ref(element)
      handleObserver.current?.disconnect()
      handleObserver.current = null
      if (element) {
        // 句柄直接绑定在稳定节点上，不观察子树，也不依赖 HoverCard 的 Suspense。
        handleRef(element.querySelector(dragHandleSelector ?? '[data-sidebar-drag-handle]') ?? element)
      } else handleRef(null)
      if (typeof forwardedRef === 'function') forwardedRef(element)
      else if (forwardedRef) forwardedRef.current = element
    },
    [ref, handleRef, dragHandleSelector, forwardedRef],
  )
  const Component = as
  return (
    <Component
      {...props}
      ref={assignRef}
      data-sidebar-sortable={value}
      data-sidebar-sort-item={value}
      data-sidebar-receives={receives ? value : undefined}
      data-dragging={isDragSource || undefined}
      className={cx(
        'sidebar-reorder-item tw:relative tw:min-w-0 tw:cursor-grab',
        isDragSource && 'tw:opacity-40',
        className,
      )}
      onPointerDownCapture={(event) => {
        if (!isDragSource) suppressClick.current = false
        props.onPointerDownCapture?.(event)
      }}
      onKeyDownCapture={(event) => {
        if (!isDragSource) suppressClick.current = false
        props.onKeyDownCapture?.(event)
      }}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          event.preventDefault()
          event.stopPropagation()
          suppressClick.current = false
          return
        }
        onClickCapture?.(event)
      }}
    >
      {children}
    </Component>
  )
})
