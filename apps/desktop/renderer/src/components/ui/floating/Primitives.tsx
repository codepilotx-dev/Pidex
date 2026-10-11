import React, {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

export function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void,
) {
  const [internalValue, setInternalValue] = useState(defaultValue)
  const current = value === undefined ? internalValue : value
  const currentRef = useRef(current)
  currentRef.current = current
  const setValue = useCallback(
    (next: T) => {
      if (Object.is(currentRef.current, next)) return
      if (value === undefined) {
        currentRef.current = next
        setInternalValue(next)
      }
      onChange?.(next)
    },
    [value, onChange],
  )
  return [current, setValue] as const
}

export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    refs.forEach((ref) => {
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node
    })
  }
}

interface SlotProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode
  disabled?: boolean
  type?: string
}

// Only the clone boundary needs loose props: the child chooses the DOM element.
export const Slot = forwardRef<HTMLElement, SlotProps>(({ children, ...props }, ref) => {
  const child = Children.only(children) as React.ReactElement<Record<string, any>>
  const merged: Record<string, any> = { ...props, ...child.props }
  for (const name of Object.keys(props)) {
    const parentValue = (props as Record<string, any>)[name]
    const childValue = child.props[name]
    if (/^on[A-Z]/.test(name) && typeof parentValue === 'function') {
      merged[name] = (event: { defaultPrevented: boolean }) => {
        childValue?.(event)
        if (!event.defaultPrevented) parentValue(event)
      }
    }
  }
  merged.className = [props.className, child.props.className].filter(Boolean).join(' ')
  merged.style = { ...props.style, ...child.props.style }
  merged.ref = mergeRefs(ref, child.props.ref as Ref<HTMLElement> | undefined)
  // State and accessibility attributes belong to the primitive.
  for (const name of Object.keys(props)) {
    if (name.startsWith('aria-') || name.startsWith('data-') || name === 'disabled')
      merged[name] = (props as Record<string, any>)[name]
  }
  return cloneElement(child, merged)
})
Slot.displayName = 'Slot'

const PortalContext = createContext<HTMLElement | null>(null)
export interface PortalProps {
  children: ReactNode
  container?: HTMLElement | null
  anchor?: HTMLElement | null
}
export function Portal({ children, container, anchor }: PortalProps) {
  if (typeof document === 'undefined') return null
  const host =
    container ??
    (anchor ?? document.activeElement)?.closest<HTMLElement>(
      '[role="dialog"], [role="alertdialog"]',
    ) ??
    document.body
  return createPortal(
    <PortalContext.Provider value={host}>{children}</PortalContext.Provider>,
    host,
  )
}
export function usePortal() {
  return useContext(PortalContext) !== null
}
// Keep DOM ancestry inside modal focus scopes; the native top layer escapes clipping.
export function useTopLayer(ref: RefObject<HTMLElement | null>, open: boolean) {
  const host = useContext(PortalContext)
  const topLayer = !!host?.closest('[role="dialog"], [role="alertdialog"]')
  useLayoutEffect(() => {
    if (!open || !topLayer || !ref.current) return
    const element = ref.current
    element.showPopover()
    return () => {
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [topLayer, ref, open])
  return topLayer ? ('manual' as const) : undefined
}

export interface DismissEvents {
  onPointerDownOutside?: (event: PointerEvent) => void
  onFocusOutside?: (event: FocusEvent) => void
  onInteractOutside?: (event: PointerEvent | FocusEvent) => void
  onEscapeKeyDown?: (event: KeyboardEvent) => void
}

const layers: symbol[] = []
export function useDismissableLayer({
  open,
  contentRef,
  anchorRef,
  additionalRefs = [],
  onDismiss,
  onPointerDownOutside,
  onFocusOutside,
  onInteractOutside,
  onEscapeKeyDown,
}: DismissEvents & {
  open: boolean
  contentRef: RefObject<HTMLElement | null>
  anchorRef?: RefObject<HTMLElement | null>
  additionalRefs?: Array<RefObject<HTMLElement | null>>
  onDismiss: () => void
}) {
  const handlers = useRef({
    onDismiss,
    onPointerDownOutside,
    onFocusOutside,
    onInteractOutside,
    onEscapeKeyDown,
    additionalRefs,
  })
  handlers.current = {
    onDismiss,
    onPointerDownOutside,
    onFocusOutside,
    onInteractOutside,
    onEscapeKeyDown,
    additionalRefs,
  }
  useEffect(() => {
    if (!open) return
    const layer = Symbol()
    layers.push(layer)
    const shieldedEscapes = new WeakSet<KeyboardEvent>()
    const shieldDialogEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || layers[layers.length - 1] !== layer || event.defaultPrevented)
        return
      if (contentRef.current?.parentElement?.closest('[role="dialog"], [role="alertdialog"]')) {
        // Radix Dialog listens in document capture; leave child input handlers first refusal.
        event.preventDefault()
        shieldedEscapes.add(event)
      }
    }
    const outside = (event: PointerEvent | FocusEvent) => {
      if (layers[layers.length - 1] !== layer || event.defaultPrevented) return
      const target = event.target as Node
      if (
        contentRef.current?.contains(target) ||
        anchorRef?.current?.contains(target) ||
        handlers.current.additionalRefs.some((ref) => ref.current?.contains(target))
      )
        return
      // Native focusin is not cancelable; callers can still veto closing the layer.
      const outsideEvent =
        event.type === 'focusin'
          ? new FocusEvent('focusin', {
              cancelable: true,
              relatedTarget: (event as FocusEvent).relatedTarget,
            })
          : event
      if (outsideEvent !== event) Object.defineProperty(outsideEvent, 'target', { value: target })
      if (event.type === 'pointerdown')
        handlers.current.onPointerDownOutside?.(outsideEvent as PointerEvent)
      else handlers.current.onFocusOutside?.(outsideEvent as FocusEvent)
      if (!outsideEvent.defaultPrevented) handlers.current.onInteractOutside?.(outsideEvent)
      if (!outsideEvent.defaultPrevented) handlers.current.onDismiss()
    }
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        (event.defaultPrevented && !shieldedEscapes.has(event)) ||
        layers[layers.length - 1] !== layer
      )
        return
      // IME 组合输入中的 Escape 用于取消候选词，不应关闭浮层
      if (event.isComposing || event.keyCode === 229) return
      const closeEvent = shieldedEscapes.has(event)
        ? new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
        : event
      if (closeEvent !== event) Object.defineProperty(closeEvent, 'target', { value: event.target })
      handlers.current.onEscapeKeyDown?.(closeEvent)
      if (!closeEvent.defaultPrevented) {
        event.preventDefault()
        handlers.current.onDismiss()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', keyDown)
    window.addEventListener('keydown', shieldDialogEscape, true)
    return () => {
      layers.splice(layers.indexOf(layer), 1)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', keyDown)
      window.removeEventListener('keydown', shieldDialogEscape, true)
    }
  }, [open, contentRef, anchorRef])
}

export function useFocusReturn(
  open: boolean,
  contentRef: RefObject<HTMLElement | null>,
  targetRef?: RefObject<HTMLElement | null>,
  onCloseAutoFocus?: (event: Event) => void,
) {
  const closeHandler = useRef(onCloseAutoFocus)
  closeHandler.current = onCloseAutoFocus
  useLayoutEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const content = contentRef.current
    return () => {
      const event = new Event('floating.closeAutoFocus', { cancelable: true })
      closeHandler.current?.(event)
      if (event.defaultPrevented) return
      if (document.activeElement === document.body || content?.contains(document.activeElement)) {
        const anchor = targetRef?.current
        const target =
          anchor && (anchor.tabIndex >= 0 || anchor.hasAttribute('tabindex')) ? anchor : previous
        if (target?.isConnected) target.focus()
      }
    }
  }, [open, contentRef, targetRef])
}
