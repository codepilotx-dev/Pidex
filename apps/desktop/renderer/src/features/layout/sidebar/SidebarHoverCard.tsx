import type React from 'react'
import { useOptionalSidebarDragController, useSidebarDragSession } from './SidebarDragContext.js'
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
  /** 本次打开由预热窗口直开：跳过入场动画，0ms 就位。 */
  warmHandoff: boolean
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
/** 关闭后仍视为预热的时间窗口，与提示浮层的 skipDelayDuration 保持一致。 */
export const HANDOFF_WINDOW_MS = 300

type HoverCardRegistration = {
  isLocked: () => boolean
  setOpen: (open: boolean) => void
}

type SidebarHoverCardCoordinator = {
  closeAfterDelay: (id: string) => void
  getOpenMode: (id: string) => 'cold' | 'warm'
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
  const session = useSidebarDragSession()
  useEffect(() => {
    if (session) coordinator.closeAll()
  }, [coordinator, session])

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
  const drag = useOptionalSidebarDragController()
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
    if (nextOpen && drag?.getSession()) return
    if (lockOpenRef.current && !nextOpen && !drag?.getSession()) return
    const restoreFocus =
      !nextOpen && document.getElementById(contentId)?.contains(document.activeElement)
    onOpenChangeRef.current(nextOpen)
    if (restoreFocus) returnFocusToAnchor()
  }

  function keepOpen(): void {
    coordinator.keepOpen(contentId)
  }

  function openImmediately(): void {
    if (drag?.getSession()) return
    coordinator.openImmediately(contentId)
  }

  function openAfterDelay(): void {
    if (drag?.getSession()) return
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
      {open && !drag?.getSession()
        ? renderOverlay({
            anchorRef,
            closeAfterDelay,
            contentId,
            keepOpen,
            returnFocusToAnchor,
            requestOpenChange,
            warmHandoff: coordinator.getOpenMode(contentId) === 'warm',
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

export function createSidebarHoverCardCoordinator(): SidebarHoverCardCoordinator & {
  dispose: () => void
  closeAll: () => void
} {
  const registrations = new Map<string, HoverCardRegistration>()
  let activeId: string | null = null
  let pendingId: string | null = null
  let openTimer: number | null = null
  let closeTimer: number | null = null
  let warmUntil = Number.NEGATIVE_INFINITY
  // 每个 id 本次打开的不可变模式；打开期间不随协调器热状态改写。
  const openModes = new Map<string, 'cold' | 'warm'>()

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
    openModes.delete(id)
    warmUntil = window.performance.now() + HANDOFF_WINDOW_MS
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
    // 必须在改写热状态前判定，否则本次冷启动会被自己污染成预热。
    // close() 已把 warmUntil 推到下一个 300ms 窗口，覆盖「切成相邻卡片」的情况。
    const mode: 'cold' | 'warm' = window.performance.now() <= warmUntil ? 'warm' : 'cold'
    activeId = id
    openModes.set(id, mode)
    registration.setOpen(true)
  }

  return {
    closeAll() {
      clearOpenTimer()
      clearCloseTimer()
      const id = activeId
      activeId = null
      if (id) {
        openModes.delete(id)
        registrations.get(id)?.setOpen(false)
      }
    },
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
      openModes.clear()
      activeId = null
    },
    getOpenMode(id) {
      return openModes.get(id) ?? 'cold'
    },
    keepOpen(id) {
      if (activeId === id) clearCloseTimer()
    },
    openAfterDelay(id) {
      clearCloseTimer()
      // 预热窗口内 0ms 直开，窗口外仍走首次悬停延迟。
      if (activeId !== null || window.performance.now() <= warmUntil) {
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
        openModes.delete(id)
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
      openModes.delete(id)
      // 父组件直接关闭（非协调器关闭）同样开启预热窗口；挂载时为 no-op，不会误判首开。
      warmUntil = window.performance.now() + HANDOFF_WINDOW_MS
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
