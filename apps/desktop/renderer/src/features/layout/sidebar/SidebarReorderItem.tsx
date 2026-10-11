import {
  forwardRef,
  useRef,
  useState,
  type ForwardedRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { Reorder, useDragControls, type HTMLMotionProps } from 'motion/react'
import { layoutTween, motionTransition } from '../../motion/MotionTransitions.js'
import { cx } from '../../../utils/Cx.js'

const REORDER_EXCLUDED_TARGETS = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[data-sidebar-reorder-exclude]',
  '.sidebar-project-actions',
  '.sidebar-session-actions',
  '.sidebar-session-confirm-archive-button',
].join(', ')

type Props = Omit<
  HTMLMotionProps<'div' | 'li'>,
  | 'as'
  | 'children'
  | 'drag'
  | 'dragControls'
  | 'dragListener'
  | 'dragMomentum'
  | 'layout'
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
  | 'value'
> & {
  as?: 'div' | 'li'
  children: ReactNode
  dragHandleSelector?: string
  presenceMotion?: boolean
  reducedMotion: boolean
  value: string
  onReorderDragStart?: () => void
  onReorderDragEnd?: () => void
}

export const SidebarReorderItem = forwardRef<HTMLElement, Props>(function SidebarReorderItem(
  {
    as = 'div',
    children,
    className,
    dragHandleSelector,
    presenceMotion = false,
    reducedMotion,
    value,
    onClickCapture,
    onPointerDown,
    onReorderDragStart,
    onReorderDragEnd,
    ...itemProps
  },
  ref,
): ReactNode {
  const controls = useDragControls()
  const suppressClickRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  function handlePointerDown(event: PointerEvent<HTMLElement>): void {
    onPointerDown?.(event as PointerEvent<HTMLDivElement> & PointerEvent<HTMLLIElement>)
    if (event.defaultPrevented) return

    // A session reorder item can be nested inside a project reorder item.
    // Always stop the pointer gesture here so only the innermost group moves.
    event.stopPropagation()
    if (!event.isPrimary || event.button !== 0) return
    if (event.target instanceof Element && event.target.closest(REORDER_EXCLUDED_TARGETS)) {
      return
    }
    if (
      dragHandleSelector &&
      (!(event.target instanceof Element) || !event.target.closest(dragHandleSelector))
    ) {
      return
    }
    controls.start(event, { distanceThreshold: 5, snapToCursor: false })
  }

  function handleClickCapture(event: MouseEvent<HTMLElement>): void {
    onClickCapture?.(event as MouseEvent<HTMLDivElement> & MouseEvent<HTMLLIElement>)
    if (!suppressClickRef.current || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <Reorder.Item
      {...itemProps}
      ref={ref as ForwardedRef<HTMLDivElement> & ForwardedRef<HTMLLIElement>}
      as={as}
      className={cx(
        'sidebar-reorder-item tw:relative tw:min-w-0 tw:cursor-grab tw:shadow-none tw:transition-shadow tw:duration-feedback tw:ease-standard tw:data-[dragging=true]:shadow-lg',
        className,
      )}
      animate={presenceMotion ? { opacity: 1 } : undefined}
      data-dragging={dragging || undefined}
      dragControls={controls}
      dragElastic={0.08}
      dragListener={false}
      dragMomentum={false}
      exit={presenceMotion ? { opacity: 0 } : undefined}
      initial={presenceMotion ? { opacity: 0 } : false}
      layout="position"
      transition={motionTransition(reducedMotion, layoutTween)}
      value={value}
      whileDrag={
        reducedMotion
          ? undefined
          : {
              scale: 1.015,
            }
      }
      onClickCapture={handleClickCapture}
      onDragEnd={() => {
        setDragging(false)
        onReorderDragEnd?.()
        requestAnimationFrame(() => {
          suppressClickRef.current = false
        })
      }}
      onDragStart={() => {
        suppressClickRef.current = true
        setDragging(true)
        onReorderDragStart?.()
      }}
      onPointerDown={handlePointerDown}
    >
      {children}
    </Reorder.Item>
  )
})
