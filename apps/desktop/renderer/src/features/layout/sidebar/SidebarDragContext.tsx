import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { registerSidebarPreviewHold } from '../SidebarShellState.js'

/** 拖放目的地类型；真实项目目标只接受同一项目的组内排序。 */
export type SidebarDropDestination =
  | { kind: 'pinned'; index: number }
  | { kind: 'section'; sectionId: string; index: number }
  | { kind: 'default'; index: number }
  | { kind: 'project'; projectKey: string; index: number }

export type SidebarDragState = {
  keys: readonly string[]
  /** 同时选中父项目与其子聊天时，只按父项目处理。 */
  projectKeys: readonly string[]
  sessionKeys: readonly string[]
}

export type SidebarDropIndicator = {
  containerKey: string
  top: number
  left: number
  width: number
}

export type SidebarDragContextValue = {
  drag: SidebarDragState | null
  beginDrag: (state: SidebarDragState) => void
  endDrag: () => void
  hovered: SidebarDropDestination | null
  indicator: SidebarDropIndicator | null
  /** 目标不接受当前载荷时给出拒绝反馈。 */
  rejected: boolean
  setScrollElement: (element: HTMLElement | null) => void
  isDragging: boolean
}

const SidebarDragContext = createContext<SidebarDragContextValue | null>(null)

const EDGE_SCROLL_ZONE = 40
const EDGE_SCROLL_STEP = 12

export function SidebarDragProvider({ children }: { children: ReactNode }): ReactNode {
  const [drag, setDrag] = useState<SidebarDragState | null>(null)
  const [hovered, setHovered] = useState<SidebarDropDestination | null>(null)
  const [indicator, setIndicator] = useState<SidebarDropIndicator | null>(null)
  const [rejected, setRejected] = useState(false)
  const releaseRef = useRef<(() => void) | null>(null)
  const scrollElementRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<SidebarDragState | null>(null)
  dragRef.current = drag

  const setScrollElement = useCallback((element: HTMLElement | null) => {
    scrollElementRef.current = element
  }, [])

  const beginDrag = useCallback((state: SidebarDragState) => {
    if (!releaseRef.current) releaseRef.current = registerSidebarPreviewHold('sidebar-drag')
    setDrag(state)
    setHovered(null)
    setRejected(false)
  }, [])

  const endDrag = useCallback(() => {
    releaseRef.current?.()
    releaseRef.current = null
    setDrag(null)
    setHovered(null)
    setIndicator(null)
    setRejected(false)
  }, [])

  useEffect(() => {
    if (!drag) return
    const onPointerMove = (event: PointerEvent): void => {
      autoScrollNearEdge(scrollElementRef.current, event.clientY)
      const container = findSidebarDropContainer(event.clientX, event.clientY)
      setHovered(container ? resolveSidebarDropDestination(container, event.clientY) : null)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [drag])

  useEffect(() => {
    if (!drag || !hovered) {
      setIndicator(null)
      setRejected(false)
      return
    }
    const containerKey = dropContainerKey(hovered)
    const container = findDropContainerElement(containerKey)
    if (!container || !canDropOnDestination(drag, hovered, container)) {
      setIndicator(null)
      setRejected(Boolean(container))
      return
    }
    setRejected(false)
    setIndicator(measureDropIndicator(container, containerKey, hovered.index))
  }, [drag, hovered])

  const value = useMemo<SidebarDragContextValue>(
    () => ({
      drag,
      beginDrag,
      endDrag,
      hovered,
      indicator,
      rejected,
      setScrollElement,
      isDragging: drag !== null,
    }),
    [beginDrag, drag, endDrag, hovered, indicator, rejected, setScrollElement],
  )
  return <SidebarDragContext.Provider value={value}>{children}</SidebarDragContext.Provider>
}

export function useSidebarDrag(): SidebarDragContextValue {
  const value = useContext(SidebarDragContext)
  if (!value) throw new Error('useSidebarDrag 必须在 SidebarDragProvider 内使用')
  return value
}

export function useOptionalSidebarDrag(): SidebarDragContextValue | null {
  return useContext(SidebarDragContext)
}

export function dropContainerKey(destination: SidebarDropDestination): string {
  if (destination.kind === 'section') return `section:${destination.sectionId}`
  if (destination.kind === 'project') return `project:${destination.projectKey}`
  return destination.kind
}

export function findDropContainerElement(containerKey: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-sidebar-drop-container="${CSS.escape(containerKey)}"]`,
  )
}

/**
 * 真实项目目标只接受属于该项目的聊天；其他真实项目拒绝放置，
 * 本次不修改会话工作目录或执行绑定。
 */
export function canDropOnDestination(
  drag: SidebarDragState,
  destination: SidebarDropDestination,
  container: HTMLElement,
): boolean {
  if (destination.kind !== 'project') return true
  // 项目行本身不能被拖入其他项目；只有该项目的子聊天可以落回组内排序。
  if (drag.projectKeys.length > 0 || drag.sessionKeys.length === 0) return false
  const allowed = new Set(
    (container.dataset.sidebarProjectSessionKeys ?? '').split('|').filter(Boolean),
  )
  return drag.sessionKeys.every((key) => allowed.has(key))
}

export function measureDropIndicator(
  container: HTMLElement,
  containerKey: string,
  index: number,
): SidebarDropIndicator | null {
  const rows = [...container.querySelectorAll<HTMLElement>('[data-sidebar-drop-index]')]
  const bounds = container.getBoundingClientRect()
  const row = rows[index]
  if (!row) {
    const last = rows[rows.length - 1]
    const top = last ? last.getBoundingClientRect().bottom : bounds.top
    return { containerKey, top, left: bounds.left, width: bounds.width }
  }
  const rowBounds = row.getBoundingClientRect()
  return {
    containerKey,
    top: rowBounds.top,
    left: bounds.left,
    width: bounds.width,
  }
}

function autoScrollNearEdge(element: HTMLElement | null, clientY: number): void {
  if (!element) return
  const bounds = element.getBoundingClientRect()
  if (clientY < bounds.top + EDGE_SCROLL_ZONE) {
    element.scrollTop -= EDGE_SCROLL_STEP
    return
  }
  if (clientY > bounds.bottom - EDGE_SCROLL_ZONE) {
    element.scrollTop += EDGE_SCROLL_STEP
  }
}

/**
 * 把选择集合折叠为“父项目优先”的拖放载荷：
 * 同一项目同时选中项目行与其子聊天时只移动项目，避免重复操作。
 */
export function resolveSidebarDragSelection({
  selectedKeys,
  fallbackKey,
  projectKeyOfSession,
  projectKeys,
}: {
  selectedKeys: readonly string[]
  fallbackKey: string
  projectKeyOfSession: (sessionKey: string) => string | null
  projectKeys: readonly string[]
}): SidebarDragState {
  const keys =
    selectedKeys.length > 1 && selectedKeys.includes(fallbackKey)
      ? [...selectedKeys]
      : [fallbackKey]
  const projectKeySet = new Set(projectKeys.filter((key) => keys.includes(key)))
  const sessionKeys: string[] = []
  for (const key of keys) {
    if (projectKeySet.has(key)) continue
    const parentProjectKey = projectKeyOfSession(key)
    if (parentProjectKey && projectKeySet.has(parentProjectKey)) continue
    sessionKeys.push(key)
  }
  return {
    keys,
    projectKeys: [...projectKeySet],
    sessionKeys,
  }
}

/** 根据指针位置在容器内计算插入下标。 */
export function computeSidebarInsertIndex(
  container: HTMLElement,
  clientY: number,
  itemSelector = '[data-sidebar-drop-index]',
): number {
  const rows = [...container.querySelectorAll<HTMLElement>(itemSelector)]
  for (let position = 0; position < rows.length; position += 1) {
    const row = rows[position]
    if (!row) continue
    const bounds = row.getBoundingClientRect()
    if (clientY < bounds.top + bounds.height / 2) {
      return Number(row.dataset.sidebarDropIndex ?? position)
    }
  }
  return rows.length
}

/** 拖动时查找指针下的放置容器。 */
export function findSidebarDropContainer(clientX: number, clientY: number): HTMLElement | null {
  const element = document.elementFromPoint(clientX, clientY)
  if (!(element instanceof HTMLElement)) return null
  return element.closest<HTMLElement>('[data-sidebar-drop-container]')
}

export function resolveSidebarDropDestination(
  container: HTMLElement,
  clientY: number,
): SidebarDropDestination | null {
  const raw = container.dataset.sidebarDropContainer ?? ''
  const index = computeSidebarInsertIndex(container, clientY)
  if (raw === 'pinned') return { kind: 'pinned', index }
  if (raw === 'default') return { kind: 'default', index }
  if (raw.startsWith('section:')) return { kind: 'section', sectionId: raw.slice(8), index }
  if (raw.startsWith('project:')) return { kind: 'project', projectKey: raw.slice(8), index }
  return null
}
