import type React from 'react'
import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react'

export type SidebarHoverCardOverlayRenderProps = {
  anchorRef: React.RefObject<HTMLElement | null>
  closeAfterDelay: () => void
  contentId: string
  keepOpen: () => void
  returnFocusToAnchor: () => void
  requestOpenChange: (open: boolean) => void
}

type AnchorProps = React.HTMLAttributes<HTMLElement> & React.RefAttributes<HTMLElement>

type Props = {
  children: React.ReactElement<AnchorProps>
  lockOpen?: boolean
  open: boolean
  onAnchorKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void
  onOpenChange: (open: boolean) => void
  renderOverlay: (props: SidebarHoverCardOverlayRenderProps) => React.ReactNode
}

const OPEN_DELAY_MS = 300
const CLOSE_DELAY_MS = 120

type HoverCardRegistration = {
  isLocked: () => boolean
  setOpen: (open: boolean) => void
}

type SidebarHoverCardCoordinator = {
  closeAfterDelay: (id: string) => void
  keepOpen: (id: string) => void
  openAfterDelay: (id: string) => void
  openImmediately: (id: string) => void
  register: (id: string, registration: HoverCardRegistration) => () => void
  release: (id: string) => void
  requestOpenChange: (id: string, open: boolean) => void
}

const SidebarHoverCardContext = createContext<SidebarHoverCardCoordinator | null>(null)

export function SidebarHoverCardProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  const coordinator = useMemo(createSidebarHoverCardCoordinator, [])

  useEffect(() => () => coordinator.dispose(), [coordinator])

  return (
    <SidebarHoverCardContext.Provider value={coordinator}>
      {children}
    </SidebarHoverCardContext.Provider>
  )
}

export function SidebarHoverCard({
  children,
  lockOpen = false,
  open,
  onAnchorKeyDown,
  onOpenChange,
  renderOverlay,
}: Props): React.ReactNode {
  const coordinator = useSidebarHoverCardCoordinator()
  const anchorRef = useRef<HTMLElement | null>(null)
  const contentId = useId()
  const lockOpenRef = useRef(lockOpen)
  const onOpenChangeRef = useRef(onOpenChange)
  const childRef = children.props.ref
  lockOpenRef.current = lockOpen
  onOpenChangeRef.current = onOpenChange
  const setAnchorRef = useCallback(
    (node: HTMLElement | null): void => {
      anchorRef.current = node
      assignRef(childRef, node)
    },
    [childRef],
  )

  useEffect(
    () =>
      coordinator.register(contentId, {
        isLocked: () => lockOpenRef.current,
        setOpen: applyOpenChange,
      }),
    [contentId, coordinator],
  )

  useEffect(() => {
    if (!open) coordinator.release(contentId)
  }, [contentId, coordinator, open])

  function requestOpenChange(nextOpen: boolean): void {
    coordinator.requestOpenChange(contentId, nextOpen)
  }

  function applyOpenChange(nextOpen: boolean): void {
    if (lockOpenRef.current && !nextOpen) return
    const restoreFocus =
      !nextOpen && document.getElementById(contentId)?.contains(document.activeElement)
    onOpenChangeRef.current(nextOpen)
    if (restoreFocus) returnFocusToAnchor()
  }

  function keepOpen(): void {
    coordinator.keepOpen(contentId)
  }

  function openImmediately(): void {
    coordinator.openImmediately(contentId)
  }

  function openAfterDelay(): void {
    coordinator.openAfterDelay(contentId)
  }

  function closeAfterDelay(): void {
    coordinator.closeAfterDelay(contentId)
  }

  function returnFocusToAnchor(): void {
    requestAnimationFrame(() => {
      focusSidebarHoverCardAnchor(anchorRef.current)
    })
  }

  const anchor = cloneElement(children, {
    ref: setAnchorRef,
    'aria-controls': open ? contentId : undefined,
    'aria-expanded': open,
    'aria-haspopup': 'dialog',
    onBlur: (event) => {
      children.props.onBlur?.(event)
      if (!event.defaultPrevented) closeAfterDelay()
    },
    onFocus: (event) => {
      children.props.onFocus?.(event)
      if (event.defaultPrevented) return
      if (event.currentTarget.dataset.sidebarSuppressHoverOpen === 'true') {
        delete event.currentTarget.dataset.sidebarSuppressHoverOpen
        return
      }
      openImmediately()
    },
    onKeyDown: (event) => {
      children.props.onKeyDown?.(event)
      if (!event.defaultPrevented) onAnchorKeyDown?.(event)
    },
    onPointerEnter: (event) => {
      children.props.onPointerEnter?.(event)
      if (!event.defaultPrevented) openAfterDelay()
    },
    onPointerLeave: (event) => {
      children.props.onPointerLeave?.(event)
      if (!event.defaultPrevented) closeAfterDelay()
    },
  })

  return (
    <>
      {anchor}
      {open
        ? renderOverlay({
            anchorRef,
            closeAfterDelay,
            contentId,
            keepOpen,
            returnFocusToAnchor,
            requestOpenChange,
          })
        : null}
    </>
  )
}

export function focusSidebarHoverCardAnchor(anchor: HTMLElement | null): void {
  if (!anchor || document.activeElement === anchor) return
  anchor.dataset.sidebarSuppressHoverOpen = 'true'
  anchor.focus()
  delete anchor.dataset.sidebarSuppressHoverOpen
}

function assignRef(ref: React.Ref<HTMLElement> | undefined, node: HTMLElement | null): void {
  if (typeof ref === 'function') {
    ref(node)
  } else if (ref) {
    ref.current = node
  }
}

function useSidebarHoverCardCoordinator(): SidebarHoverCardCoordinator {
  const coordinator = useContext(SidebarHoverCardContext)
  if (!coordinator) {
    throw new Error('SidebarHoverCard must be used within SidebarHoverCardProvider')
  }
  return coordinator
}

function createSidebarHoverCardCoordinator(): SidebarHoverCardCoordinator & {
  dispose: () => void
} {
  const registrations = new Map<string, HoverCardRegistration>()
  let activeId: string | null = null
  let pendingId: string | null = null
  let openTimer: number | null = null
  let closeTimer: number | null = null

  function clearOpenTimer(): void {
    if (openTimer !== null) window.clearTimeout(openTimer)
    openTimer = null
    pendingId = null
  }

  function clearCloseTimer(): void {
    if (closeTimer !== null) window.clearTimeout(closeTimer)
    closeTimer = null
  }

  function close(id: string): boolean {
    if (activeId !== id) return true
    const registration = registrations.get(id)
    if (registration?.isLocked()) return false
    activeId = null
    registration?.setOpen(false)
    return true
  }

  function activate(id: string): void {
    clearOpenTimer()
    clearCloseTimer()
    const registration = registrations.get(id)
    if (!registration) return
    if (activeId === id) {
      registration.setOpen(true)
      return
    }
    if (activeId !== null && !close(activeId)) return
    activeId = id
    registration.setOpen(true)
  }

  return {
    closeAfterDelay(id) {
      if (pendingId === id) clearOpenTimer()
      if (activeId !== id || registrations.get(id)?.isLocked()) return
      clearCloseTimer()
      closeTimer = window.setTimeout(() => {
        closeTimer = null
        close(id)
      }, CLOSE_DELAY_MS)
    },
    dispose() {
      clearOpenTimer()
      clearCloseTimer()
      registrations.clear()
      activeId = null
    },
    keepOpen(id) {
      if (activeId === id) clearCloseTimer()
    },
    openAfterDelay(id) {
      clearCloseTimer()
      if (activeId !== null) {
        activate(id)
        return
      }
      if (pendingId === id) return
      clearOpenTimer()
      pendingId = id
      openTimer = window.setTimeout(() => activate(id), OPEN_DELAY_MS)
    },
    openImmediately: activate,
    register(id, registration) {
      registrations.set(id, registration)
      return () => {
        registrations.delete(id)
        if (pendingId === id) clearOpenTimer()
        if (activeId === id) {
          clearCloseTimer()
          activeId = null
        }
      }
    },
    release(id) {
      if (pendingId === id) clearOpenTimer()
      if (activeId !== id) return
      clearCloseTimer()
      activeId = null
    },
    requestOpenChange(id, nextOpen) {
      if (nextOpen) {
        activate(id)
        return
      }
      if (pendingId === id) clearOpenTimer()
      clearCloseTimer()
      close(id)
    },
  }
}
