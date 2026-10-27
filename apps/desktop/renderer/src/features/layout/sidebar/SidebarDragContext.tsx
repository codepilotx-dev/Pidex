import {
  DragDropProvider,
  DragOverlay,
  useDroppable,
  useDragDropMonitor,
  type DragDropEventHandlers,
} from '@dnd-kit/react'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import {
  createContext,
  useCallback,
  useEffect,
  type HTMLAttributes,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { registerSidebarPreviewHold } from '../SidebarShellState.js'
import type {
  SidebarDragSession,
  SidebarDropContainer,
  SidebarDropResolution,
} from './SidebarDragRules.js'
import {
  canAcceptSidebarDrop,
  dropAnchorKey,
  previewSidebarDrop,
  resolveSidebarDrop,
  resolveSidebarDropRegion,
} from './SidebarDragRules.js'

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

export type SidebarDragContextValue = {
  /** 首次拖动开始前为 null；拖动期间保留源信息与临时顺序。 */
  session: SidebarDragSession | null
  /** 当前悬停容器键；没有可放置目标时为 null。 */
  targetKey: string | null
  /** 目标不接受当前载荷时给出拒绝反馈。 */
  rejected: boolean
  isDragging: boolean
  beginDrag: (session: SidebarDragSession) => void
  /** 悬停仅更新临时预览；没有目标时清除插入指示。 */
  hoverTarget: (target: SidebarDropContainer | null, anchorKey: string | null) => void
  /** 悬停到不可放置的目标：只记录目标键，供拒绝反馈使用。 */
  hoverRejectedTarget: (target: SidebarDropContainer) => void
  /** 以一次统一入口结束拖动；返回值交给调用方提交或丢弃。 */
  finishDrag: (
    target: SidebarDropContainer | null,
    canceled: boolean,
    sourcePersistedOrder: readonly string[],
    nextOrder: readonly string[] | null,
  ) => SidebarDropResolution
}

const SidebarDragContext = createContext<SidebarDragContextValue | null>(null)

const REJECTION_MS = 400

export const SIDEBAR_DRAG_REJECTED_CLASS = 'sidebar-drop-rejected'

export function SidebarDragProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<SidebarDragSession | null>(null)
  const [targetKey, setTargetKey] = useState<string | null>(null)
  const [rejected, setRejected] = useState(false)
  const releaseRef = useRef<(() => void) | null>(null)
  const rejectionTimerRef = useRef<number | null>(null)
  const sessionRef = useRef<SidebarDragSession | null>(null)

  const clearRejection = useCallback(() => {
    if (rejectionTimerRef.current !== null) window.clearTimeout(rejectionTimerRef.current)
    rejectionTimerRef.current = null
    setRejected(false)
  }, [])

  useEffect(
    () => () => {
      releaseRef.current?.()
      if (rejectionTimerRef.current !== null) window.clearTimeout(rejectionTimerRef.current)
    },
    [],
  )

  const beginDrag = useCallback(
    (next: SidebarDragSession) => {
      if (!releaseRef.current) releaseRef.current = registerSidebarPreviewHold('sidebar-drag')
      clearRejection()
      sessionRef.current = next
      setSession(next)
      setTargetKey(next.sourceContainerKey)
    },
    [clearRejection],
  )

  const hoverTarget = useCallback((target: SidebarDropContainer | null, anchorKey: string | null) => {
    const current = sessionRef.current
    if (!current) return
    setTargetKey(target?.key ?? null)
    setRejected(false)
    if (!target) {
      const next = {
        ...current,
        lists: { [current.sourceContainerKey]: current.sourceOrder },
      }
      sessionRef.current = next
      setSession(next)
      return
    }
    const next = previewSidebarDrop(current, target, anchorKey)
    if (next === current) return
    sessionRef.current = next
    setSession(next)
  }, [])

  const hoverRejectedTarget = useCallback((target: SidebarDropContainer) => {
    setTargetKey(target.key)
    setRejected(true)
  }, [])

  const finishDrag = useCallback(
    (
      target: SidebarDropContainer | null,
      canceled: boolean,
      sourcePersistedOrder: readonly string[],
      nextOrder: readonly string[] | null,
    ): SidebarDropResolution => {
      const current = sessionRef.current
      clearRejection()
      releaseRef.current?.()
      releaseRef.current = null
      sessionRef.current = null
      setSession(null)
      setTargetKey(null)
      const resolution = resolveSidebarDrop({
        session: current,
        target,
        canceled,
        sourcePersistedOrder,
        nextOrder,
      })
      if (resolution.status === 'reject') {
        clearRejection()
        setRejected(true)
        rejectionTimerRef.current = window.setTimeout(() => {
          rejectionTimerRef.current = null
          setRejected(false)
        }, REJECTION_MS)
      }
      return resolution
    },
    [clearRejection],
  )

  const value = useMemo<SidebarDragContextValue>(
    () => ({
      session,
      targetKey,
      rejected,
      isDragging: session !== null,
      beginDrag,
      hoverTarget,
      hoverRejectedTarget,
      finishDrag,
    }),
    [beginDrag, finishDrag, hoverRejectedTarget, hoverTarget, rejected, session, targetKey],
  )
  return (
    <DragDropProvider>
      <SidebarDragContext.Provider value={value}>{children}</SidebarDragContext.Provider>
    </DragDropProvider>
  )
}

export function useSidebarDrag(): SidebarDragContextValue {
  const value = useContext(SidebarDragContext)
  if (!value) throw new Error('useSidebarDrag 必须在 SidebarDragProvider 内使用')
  return value
}

export function dropContainerKey(destination: SidebarDropDestination): string {
  if (destination.kind === 'section') return `section:${destination.sectionId}`
  if (destination.kind === 'project') return `project:${destination.projectKey}`
  return destination.kind
}

/**
 * 真实项目目标只接受属于该项目的聊天；其他真实项目拒绝放置，
 * 本次不修改会话工作目录或执行绑定。
 */
export function canDropOnDestination(
  drag: SidebarDragState,
  destination: SidebarDropDestination,
  allowedSessionKeys: readonly string[],
): boolean {
  return canAcceptSidebarDrop(drag, {
    key: dropContainerKey(destination),
    destination,
    sessionKeys: allowedSessionKeys,
  })
}

/**
 * 把选择集合折叠为“父项目优先”的拖放载荷：
 * 同一项目同时选中项目行与其子聊天时只移动项目，避免重复操作。
 * `keys` 为实际要移动的条目，不再包含被折叠的子聊天。
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
  const selected =
    selectedKeys.length > 1 && selectedKeys.includes(fallbackKey)
      ? [...selectedKeys]
      : [fallbackKey]
  const projectKeySet = new Set(projectKeys.filter((key) => selected.includes(key)))
  const sessionKeys: string[] = []
  for (const key of selected) {
    if (projectKeySet.has(key)) continue
    const parentProjectKey = projectKeyOfSession(key)
    if (parentProjectKey && projectKeySet.has(parentProjectKey)) continue
    sessionKeys.push(key)
  }
  return {
    keys: selected.filter((key) => projectKeySet.has(key) || sessionKeys.includes(key)),
    projectKeys: [...projectKeySet],
    sessionKeys,
  }
}

export type SidebarDragList = SidebarDropContainer & {
  onReorder: (order: string[]) => void
  instanceId?: string
  sessionsOnly?: boolean
}
export type SidebarRegisteredItem = { list: SidebarDragList; key?: string; index?: number }
const SidebarListContext = createContext<SidebarDragList | null>(null)
export function useSidebarDragList(): SidebarDragList | null {
  return useContext(SidebarListContext)
}
export function useOptionalSidebarDrag(): SidebarDragContextValue | null {
  return useContext(SidebarDragContext)
}

export function SidebarDropList({
  list,
  children,
  as = 'div',
  ...props
}: HTMLAttributes<HTMLElement> & {
  list: SidebarDragList
  as?: 'div' | 'ul' | 'section'
  children: ReactNode
}): ReactNode {
  const { ref, isDropTarget } = useDroppable({
    id: `container:${list.instanceId ?? list.key}`,
    data: { list },
    collisionPriority: list.sessionsOnly ? 1 : list.key === 'default' ? -2 : -1,
    accept: (source) => {
      const data = source.data as SidebarRegisteredItem
      if ((data.list?.key === 'sections') !== (list.key === 'sections')) return false
      return !list.sessionsOnly || Boolean(data.key?.startsWith('session:'))
    },
  })
  const Component = as
  return (
    <SidebarListContext.Provider value={list}>
      <Component
        {...props}
        ref={ref}
        data-sidebar-drop-container={list.key}
        data-sidebar-receive-area={isDropTarget ? 'active' : undefined}
        className={`${props.className ?? ''} ${
          isDropTarget ? 'sidebar-drop-receive-active tw:bg-app-accent-subtle' : ''
        }`}
      >
        {children}
      </Component>
    </SidebarListContext.Provider>
  )
}

/** 浮层展示数据：来自业务载荷，不读 DOM 文本。 */
export type SidebarDragOverlayModel = {
  title: string
  /** 多选时的载荷数量；单条拖动不显示。 */
  count: number
}

export function SidebarDragOverlay({
  model,
  maxWidth,
}: {
  model: SidebarDragOverlayModel | null
  maxWidth?: number
}): ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
      {() =>
        model ? (
          <div
            aria-hidden="true"
            className="sidebar-drag-overlay tw:flex tw:min-h-[var(--sidebar-row-height,30px)] tw:items-center tw:gap-2 tw:rounded-md tw:bg-app-raised tw:px-2 tw:text-app-text tw:shadow-lg tw:type-body"
            style={maxWidth ? { maxWidth } : undefined}
          >
            <span className="tw:min-w-0 tw:flex-1 tw:truncate whitespace-nowrap">{model.title}</span>
            {model.count > 1 ? (
              <span className="tw:shrink-0 tw:rounded-full tw:bg-app-selected tw:px-1.5 tw:type-caption tw:text-app-text-meta">
                {model.count}
              </span>
            ) : null}
          </div>
        ) : null
      }
    </DragOverlay>
  )
}

export type SidebarDropIndicatorModel = {
  instanceId: string
  itemKey: string
  edge: 'before' | 'after'
}

export function useSidebarDragEvents({
  select,
  commit,
}: {
  select: (key: string) => SidebarDragState
  commit: (
    operation: import('./SidebarDragRules.js').SidebarDropOperation,
    target: SidebarDragList,
    order: string[],
  ) => void
}): SidebarDropIndicatorModel | null {
  const [indicator, setIndicator] = useState<SidebarDropIndicatorModel | null>(null)
  const drag = useSidebarDrag()
  const active = useRef<{ session: SidebarDragSession; order: readonly string[] } | null>(null)
  const preview = useRef<{ list: SidebarDragList; order: string[] } | null>(null)
  const lastAnchor = useRef<string | null>(null)
  const hover: DragDropEventHandlers['onDragMove'] = (event) => {
    const current = active.current
    const element = event.operation.target?.element
    const target = event.operation.target?.data as SidebarRegisteredItem | undefined
    if (!current || !target?.list || !element) {
      setIndicator(null)
      lastAnchor.current = null
      preview.current = null
      drag.hoverTarget(null, null)
      return
    }
    const list = target.list
    if (!canAcceptSidebarDrop(current.session.state, list)) {
      // 非法项目目标：显示拒绝，不回退到外层区域。
      setIndicator(null)
      lastAnchor.current = null
      preview.current = { list, order: [...list.order] }
      drag.hoverRejectedTarget(list)
      return
    }
    const bounds = element.getBoundingClientRect()
    const itemKey = target.key ?? null
    const region = itemKey
      ? resolveSidebarDropRegion({
          isProjectEntry: Boolean((element as HTMLElement).dataset.sidebarReceives),
          offsetY: event.operation.position.current.y - bounds.top,
          height: bounds.height,
          hasOwnItems: true,
        })
      : 'container'
    const anchorKey = dropAnchorKey(region, itemKey)
    if (lastAnchor.current === `${list.key}|${anchorKey}` && preview.current?.list.key === list.key)
      return
    lastAnchor.current = `${list.key}|${anchorKey}`
    const next = previewSidebarDrop(current.session, list, anchorKey)
    const order = [...(next.lists[list.key] ?? list.order)]
    preview.current = { list, order }
    drag.hoverTarget(list, anchorKey)
    // 插入线依附目标锚点：排序显示插入线，接收区域只高亮容器。
    if (itemKey && (region === 'before' || region === 'after' || region === 'sort-edge')) {
      setIndicator({
        instanceId: `${list.key}|${anchorKey}`,
        itemKey,
        edge: region === 'before' || region === 'sort-edge' ? 'before' : 'after',
      })
    } else setIndicator(null)
  }
  useDragDropMonitor({
    onDragStart(event) {
      const source = event.operation.source
      const data = source?.data as SidebarRegisteredItem | undefined
      if (!source || !data?.key) return
      const state = select(data.key)
      const session: SidebarDragSession = {
        state,
        sourceDisplayId: String(source.id),
        sourceContainerKey: data.list.key,
        sourceOrder: [...data.list.order],
        lists: { [data.list.key]: [...data.list.order] },
      }
      active.current = { session, order: [...data.list.order] }
      preview.current = null
      drag.beginDrag(session)
    },
    onDragMove: hover,
    onDragOver: hover,
    onDragEnd(event) {
      const current = active.current
      if (!current) return
      const targetData = event.operation.target?.data as SidebarRegisteredItem | undefined
      const destination =
        targetData?.list && preview.current?.list.key === targetData.list.key
          ? preview.current
          : null
      active.current = null
      preview.current = null
      setIndicator(null)
      const result = drag.finishDrag(
        destination?.list ?? null,
        event.canceled || !destination,
        current.order,
        destination?.order ?? null,
      )
      if (result.status === 'commit' && destination)
        for (const operation of result.operations)
          commit(operation, destination.list, destination.order)
    },
  })
  return indicator
}

export function SidebarDropIndicator({
  indicator,
}: {
  indicator: SidebarDropIndicatorModel | null
}): ReactNode {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const instanceId = indicator?.instanceId ?? null
  const itemKey = indicator?.itemKey ?? null
  const edge = indicator?.edge ?? null

  // 插入线依附目标行：每次滚动或布局变化重新测量，不保留拖动瞬间坐标。
  useEffect(() => {
    if (!instanceId || !itemKey || !edge) {
      setRect(null)
      return
    }
    const selector = `[data-sidebar-sort-item="${CSS.escape(itemKey)}"]`
    const measure = () => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) {
        setRect(null)
        return
      }
      const bounds = element.getBoundingClientRect()
      setRect(
        new DOMRect(bounds.left, edge === 'before' ? bounds.top : bounds.bottom, bounds.width, 0),
      )
    }
    measure()
    window.addEventListener('scroll', measure, { capture: true, passive: true })
    window.addEventListener('resize', measure, { passive: true })
    return () => {
      window.removeEventListener('scroll', measure, { capture: true })
      window.removeEventListener('resize', measure)
    }
  }, [edge, instanceId, itemKey])

  if (!rect) return null
  return (
    <div
      aria-hidden="true"
      className="sidebar-drop-indicator tw:pointer-events-none tw:fixed tw:z-tooltip tw:h-0.5 tw:rounded-full tw:bg-app-accent"
      style={{ top: rect.top, left: rect.left, width: rect.width }}
    />
  )
}
