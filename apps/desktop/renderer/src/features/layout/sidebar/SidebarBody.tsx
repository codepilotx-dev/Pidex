import type React from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Ellipsis, Plus, RefreshCw, SquarePen, X } from 'lucide-react'
import { AnimatePresence, motion, Reorder, useIsPresent } from 'motion/react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import type {
  DesktopSidebarOrganization,
  DesktopSidebarSort,
  DesktopWorkspace,
  SidebarSectionId,
} from '../../../../shared/Types.js'
import type { SessionListItem } from '../../../UiTypes.js'
import { Button } from '../../../components/ui/Button.js'

import {
  PopoverCheckboxItem,
  PopoverItem,
  PopoverLabel,
  PopoverRadioGroup,
  PopoverRadioItem,
  PopoverSeparator,
} from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import {
  type KeyedDisclosureStore,
  useDisclosureExpanded,
} from '../../../components/ui/KeyedDisclosureStore.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import { fastTween, motionTransition, standardTween } from '../../motion/MotionTransitions.js'
import { SidebarEmptyRow } from './SidebarRow.js'
import { SidebarHoverCardProvider } from './SidebarHoverCard.js'
import { DropdownActions } from '../../../components/ui/DropdownActions.js'
import { SidebarProjectGroup } from './SidebarProjectGroup.js'
import { SidebarReorderItem } from './SidebarReorderItem.js'
import { getSidebarSessionDisplayGroups, SidebarSessionGroup } from './SidebarSessionGroup.js'
import {
  SidebarDragProvider,
  dropContainerKey,
  resolveSidebarDragSelection,
  useSidebarDrag,
  type SidebarDropDestination,
} from './SidebarDragContext.js'
import {
  buildSidebarPinnedItems,
  clampTimelineVisibleLimit,
  normalizeSidebarPath,
  reorderSidebarPinnedItemKeys,
  sidebarPinnedProjectKey,
  sidebarPinnedSessionKey,
  sidebarProjectKey,
  sidebarSessionProjectKey,
  type SidebarCustomSectionEntry,
  type SidebarCustomSectionModel,
  type SidebarFocusSection,
  type SidebarPinnedItem,
  type SidebarProjectSessionBucket,
  type SidebarTimelineModel,
  sliceSidebarTimelineModel,
} from './SidebarViewModel.js'
import { cx } from '../../../utils/Cx.js'
import { moveFocusOnArrowKey } from '../../../utils/ArrowListFocus.js'
import type { SidebarProjectCatalogState } from './UseSidebarProjectCatalog.js'
import {
  type SidebarScrollModeKey,
  useSidebarScrollController,
} from './UseSidebarScrollController.js'
import { sidebarSectionDisclosureKey } from './SidebarDisclosureStore.js'

const PINNED_INITIAL_LIMIT = 10
const PINNED_LIMIT_STEP = 10
const CUSTOM_SECTION_INITIAL_LIMIT = 10

/* 分组标题行：sticky 30px 头部、8px gutter、右侧 4.286em trailing 列。 */
const SECTION_HEADER_CLASS =
  'sidebar-section-header tw:sticky tw:top-0 tw:z-local tw:grid tw:min-h-[var(--sidebar-row-height)] tw:w-full tw:grid-cols-[minmax(0,1fr)_var(--sidebar-trailing-width)] tw:items-center tw:gap-x-2 tw:rounded-md tw:px-2 tw:select-none tw:focus-within:outline-none tw:group'
const SECTION_TITLE_CLASS =
  'sidebar-section-title tw:flex tw:min-w-0 tw:items-center tw:type-body tw:normal-case tw:text-app-text-meta'
const SECTION_TOGGLE_CLASS =
  'sidebar-section-toggle tw:grid tw:w-full tw:min-w-0 tw:grid-cols-[auto_minmax(0,1fr)] tw:items-center tw:gap-x-2 tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit'
const SECTION_ACTIONS_CLASS =
  'sidebar-section-actions tw:flex tw:w-full tw:items-center tw:justify-end tw:gap-1 tw:opacity-0 tw:pointer-events-none tw:transition-opacity tw:duration-feedback tw:ease-out tw:group-hover:opacity-100 tw:group-hover:pointer-events-auto tw:group-has-[:focus-visible]:opacity-100 tw:group-has-[:focus-visible]:pointer-events-auto tw:has-[[data-state=open]]:opacity-100 tw:has-[[data-state=open]]:pointer-events-auto'
/* 展开/折叠箭头：随 aria-expanded 旋转，hover 时显现。 */
const SECTION_CHEVRON_CLASS =
  'sidebar-section-chevron tw:inline-flex tw:flex-none tw:items-center tw:text-app-text-meta tw:opacity-0 tw:pointer-events-none tw:group-hover:opacity-100 tw:[transition:opacity_var(--cpx-sys-motion-feedback)_var(--cpx-sys-ease-out),color_var(--cpx-sys-motion-feedback)_var(--cpx-sys-ease-out),transform_var(--cpx-sys-motion-disclosure)_var(--cpx-sys-ease-disclosure)]'
const SECTION_LABEL_CLASS =
  'sidebar-section-label tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-app-text-meta'
const SECTION_MAIN_CLASS = 'sidebar-section-main tw:flex tw:min-w-0 tw:items-center'
const SECTION_TRAILING_CLASS =
  'sidebar-section-trailing tw:flex tw:min-h-4 tw:min-w-0 tw:items-center tw:justify-end'
const SECTION_CONTENT_CLASS =
  'sidebar-section-content tw:grid tw:min-w-0 tw:gap-0.5 tw:overflow-hidden tw:pt-0'
/* 更多/收起操作行：与分组行同一 gutter，1px 行间距。 */
const SHOW_MORE_ACTIONS_CLASS =
  'sidebar-show-more-actions tw:grid tw:w-full tw:box-border tw:min-h-7 tw:items-center tw:gap-x-2 tw:grid-cols-[var(--sidebar-row-columns)] tw:rounded-md tw:px-2 tw:py-1 tw:text-left tw:text-app-text-meta tw:type-control tw:no-underline tw:transition-[background-color,box-shadow,color] tw:duration-feedback tw:ease-standard'
const SHOW_MORE_ROW_CLASS = 'sidebar-row-main tw:min-w-0 tw:flex tw:items-center tw:gap-4'
const SHOW_MORE_BUTTON_CLASS =
  'tw:w-auto sidebar-show-more-button tw:first:-ml-2 tw:min-w-0 tw:border-0 tw:whitespace-nowrap tw:[font:inherit]'
const SHOW_MORE_LABEL_CLASS = 'tw:block tw:overflow-hidden tw:whitespace-nowrap'

type Props = {
  activeSessionId: string | null
  disclosureStore: KeyedDisclosureStore
  organization: DesktopSidebarOrganization
  showProjectsInRecents?: boolean
  onShowProjectsInRecentsChange?: (value: boolean) => void
  showActivityPriority?: boolean
  onShowActivityPriorityChange?: (value: boolean) => void
  showActivityScheduled?: boolean
  onShowActivityScheduledChange?: (value: boolean) => void
  showActivitySources?: boolean
  hasReadActivity?: boolean
  onClearReadActivity?: () => void
  onRestoreActivityDefaults?: () => void
  timeline?: SidebarTimelineModel | null
  showTimelinePinned: boolean
  showActivityWork: boolean
  showActivityChat: boolean
  showScheduledSessions: boolean
  onShowScheduledSessionsChange: (value: boolean) => void
  onShowActivityWorkChange: (value: boolean) => void
  onShowActivityChatChange: (value: boolean) => void
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  titleLoadingIds: ReadonlySet<string>
  pinnedSessions: SessionListItem[]
  pinnedWorkspaces: DesktopWorkspace[]
  projectSessionBuckets: ReadonlyMap<string, SidebarProjectSessionBucket>
  projectWorkspaces: DesktopWorkspace[]
  projectSort: DesktopSidebarSort
  recentSessions: SessionListItem[]
  sessionFallbackTitles: Record<string, string>
  sessionSort: DesktopSidebarSort
  manualOrderByScope: Record<string, string[]>
  unavailableWorkspacePaths: Set<string>
  workspace: DesktopWorkspace | null
  /** 位于滚动视口最前端的次级导航与加载/错误提示。 */
  scrollHeader: React.ReactNode
  /** 滚动视口是否已滚过固定入口（scrollTop > 0），驱动动态分隔线。 */
  onScrollOverlapChange: (overlapping: boolean) => void
  projectCatalogState: SidebarProjectCatalogState
  scrollModeKey: SidebarScrollModeKey
  scrollPositions: Map<SidebarScrollModeKey, number>
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onChooseWorkspace: () => void
  onCreateSession: (workspace?: DesktopWorkspace | null) => void
  onPinSession: (session: SessionListItem) => void
  onPinWorkspace: (workspace: DesktopWorkspace) => void
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void
  onSelectSession: (session: SessionListItem) => void
  onToggleSessionUnread: (session: SessionListItem) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onUnpinSession: (session: SessionListItem) => void
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void
  onReport: (message: string) => void
  onManualOrderChange: (scopeKey: string, order: string[]) => void
  onOrganizationChange: (organization: DesktopSidebarOrganization) => void
  onProjectSortChange: (sort: DesktopSidebarSort) => void
  onSessionSortChange: (sort: DesktopSidebarSort) => void
  hasUnreadAttention: boolean
  hasArchivableAttention: boolean
  onMarkAttentionRead: () => void
  onRequestArchiveAttention: () => void
  onShowTimelinePinnedChange: (value: boolean) => void
  customSections: SidebarCustomSectionModel[]
  pinnedSort: 'manual' | 'updated'
  onPinnedSortChange: (sort: 'manual' | 'updated') => void
  onCreateSection: (itemKeys?: string[]) => void
  onRenameSection: (sectionId: string, title: string) => void
  onDeleteSection: (sectionId: string) => void
  onSetSectionCollapsed: (sectionId: string, collapsed: boolean) => void
  onSetSectionSort: (sectionId: string, sort: 'manual' | 'updated') => void
  onReorderSectionItems: (sectionId: string, keys: string[]) => void
  onMoveItemsToSection: (itemKeys: readonly string[], sectionId: string, index?: number) => void
  onMoveItemsToPinned: (itemKeys: readonly string[], index?: number) => void
  onMoveItemsToDefault: (itemKeys: readonly string[]) => void
  onRestoreItemsToProject: (itemKeys: readonly string[]) => void
  /** 会话行菜单：移动到自定义分组 / 回到默认区域。 */
  onMoveSessionToSection: (sessionId: string, sectionId: string) => void
  onMoveSessionToDefault: (sessionId: string) => void
}

export function SidebarBody(props: Props): React.ReactNode {
  return (
    <SidebarDragProvider>
      <SidebarBodyContent {...props} />
    </SidebarDragProvider>
  )
}

function SidebarBodyContent({
  activeSessionId,
  disclosureStore,
  organization,
  showProjectsInRecents = false,
  onShowProjectsInRecentsChange,
  timeline,
  showActivityPriority = true,
  onShowActivityPriorityChange,
  showActivityScheduled = false,
  onShowActivityScheduledChange,
  showActivitySources = true,
  hasReadActivity = false,
  onClearReadActivity,
  onRestoreActivityDefaults,
  showTimelinePinned,
  showActivityWork,
  showActivityChat,
  showScheduledSessions,
  onShowScheduledSessionsChange,
  onShowActivityWorkChange,
  onShowActivityChatChange,
  now,
  pendingPermissionSessionIds,
  titleLoadingIds,
  pinnedSessions,
  pinnedWorkspaces,
  projectSessionBuckets,
  projectWorkspaces,
  projectSort,
  recentSessions,
  sessionFallbackTitles,
  sessionSort,
  manualOrderByScope,
  unavailableWorkspacePaths,
  workspace,
  scrollHeader,
  onScrollOverlapChange,
  projectCatalogState,
  scrollModeKey,
  scrollPositions,
  onArchiveSessions,
  onChooseWorkspace,
  onCreateSession,
  onPinSession,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onToggleSessionUnread,
  onRenameSession,
  onUnpinSession,
  onUnpinWorkspace,
  onReport,
  onManualOrderChange,
  onOrganizationChange,
  onProjectSortChange,
  onSessionSortChange,
  hasUnreadAttention,
  hasArchivableAttention,
  onMarkAttentionRead,
  onRequestArchiveAttention,
  onShowTimelinePinnedChange,
  customSections,
  pinnedSort,
  onPinnedSortChange,
  onCreateSection,
  onRenameSection,
  onDeleteSection,
  onSetSectionCollapsed,
  onSetSectionSort,
  onReorderSectionItems,
  onMoveItemsToSection,
  onMoveItemsToPinned,
  onMoveItemsToDefault,
  onRestoreItemsToProject,
  onMoveSessionToSection,
  onMoveSessionToDefault,
}: Props): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const [visibleProjectLimit, setVisibleProjectLimit] = useState(5)
  const [visiblePinnedLimit, setVisiblePinnedLimit] = useState(PINNED_INITIAL_LIMIT)
  const [draggingProjectKey, setDraggingProjectKey] = useState<string | null>(null)
  const [draggingPinnedItemKey, setDraggingPinnedItemKey] = useState<string | null>(null)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const { onScroll } = useSidebarScrollController({
    activeSessionId,
    modeKey: scrollModeKey,
    positions: scrollPositions,
    viewportRef: scrollViewportRef,
    onScrollOverlapChange,
  })
  const unavailablePaths = useMemo(
    () => new Set([...unavailableWorkspacePaths].map((path) => normalizeSidebarPath(path))),
    [unavailableWorkspacePaths],
  )
  const pinnedItems = useMemo(
    () =>
      buildSidebarPinnedItems({
        pinnedSessions,
        pinnedWorkspaces,
        storedOrder: manualOrderByScope['pinned-items'] ?? [],
      }),
    [manualOrderByScope, pinnedSessions, pinnedWorkspaces],
  )
  const canonicalProjectOrder = useMemo(
    () => projectWorkspaces.map(sidebarProjectKey),
    [projectWorkspaces],
  )
  const [projectOrder, setProjectOrder] = useState(canonicalProjectOrder)
  const projectOrderRef = useRef(projectOrder)
  const orderedProjects = useMemo(
    () => orderItemsByKeys(projectWorkspaces, projectOrder, sidebarProjectKey),
    [projectOrder, projectWorkspaces],
  )
  const {
    baseSessions: baseProjects,
    canCollapse: canCollapseProjects,
    canShowMore: canShowMoreProjects,
    extraSessions: extraProjects,
    hasOverflow: hasProjectOverflow,
  } = getSidebarSessionDisplayGroups(orderedProjects, visibleProjectLimit)
  const displayedProjects = [...baseProjects, ...extraProjects]
  const canonicalPinnedOrder = useMemo(() => pinnedItems.map((item) => item.key), [pinnedItems])
  const [pinnedOrder, setPinnedOrder] = useState(canonicalPinnedOrder)
  const pinnedOrderRef = useRef(pinnedOrder)
  const orderedPinnedItems = useMemo(
    () =>
      pinnedSort === 'updated'
        ? [...pinnedItems].sort(
            (left, right) => pinnedAtMs(right.pinnedAt) - pinnedAtMs(left.pinnedAt),
          )
        : orderItemsByKeys(pinnedItems, pinnedOrder, (item) => item.key),
    [pinnedItems, pinnedOrder, pinnedSort],
  )
  const {
    baseSessions: basePinnedItems,
    canCollapse: canCollapsePinnedItems,
    canShowMore: canShowMorePinnedItems,
    extraSessions: extraPinnedItems,
    hasOverflow: hasPinnedItemOverflow,
  } = getSidebarSessionDisplayGroups(orderedPinnedItems, visiblePinnedLimit, PINNED_INITIAL_LIMIT)
  const displayedPinnedItems = [...basePinnedItems, ...extraPinnedItems]
  const pinnedItemValues = orderedPinnedItems.map((item) => item.key)

  const customSectionOptions = useMemo(
    () => customSections.map((section) => ({ id: section.id, title: section.title })),
    [customSections],
  )
  const sectionIdBySessionKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const section of customSections) {
      for (const entry of section.entries) {
        if (entry.kind === 'session') map.set(sidebarPinnedSessionKey(entry.session), section.id)
      }
    }
    return map
  }, [customSections])
  const drag = useSidebarDrag()
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([])
  const [dropRejected, setDropRejected] = useState(false)
  const selectionAnchorRef = useRef<string | null>(null)
  const sessionProjectKeyBySessionKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const [projectKeyValue, bucket] of projectSessionBuckets) {
      for (const session of bucket.allSessions) {
        map.set(sidebarPinnedSessionKey(session), `project:${projectKeyValue}`)
      }
    }
    return map
  }, [projectSessionBuckets])
  const allItemKeys = useMemo(
    () => [
      ...pinnedItems.map((item) => item.key),
      ...customSections.flatMap((section) => section.entries.map((entry) => entry.key)),
      ...projectWorkspaces.map((project) => sidebarPinnedProjectKey(project)),
      ...recentSessions.map((session) => sidebarPinnedSessionKey(session)),
    ],
    [customSections, pinnedItems, projectWorkspaces, recentSessions],
  )

  useEffect(() => {
    setSelectedKeys((current) => {
      const known = new Set(allItemKeys)
      const next = current.filter((key) => known.has(key))
      return next.length === current.length ? current : next
    })
  }, [allItemKeys])

  function toggleSelection(key: string, modifier: 'toggle' | 'range' | 'replace'): void {
    if (modifier === 'replace') {
      selectionAnchorRef.current = key
      setSelectedKeys([])
      return
    }
    if (modifier === 'range' && selectionAnchorRef.current) {
      const anchorIndex = allItemKeys.indexOf(selectionAnchorRef.current)
      const targetIndex = allItemKeys.indexOf(key)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] =
          anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        setSelectedKeys(allItemKeys.slice(start, end + 1))
        return
      }
    }
    selectionAnchorRef.current = key
    setSelectedKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    )
  }

  function beginItemDrag(key: string): void {
    const state = resolveSidebarDragSelection({
      selectedKeys,
      fallbackKey: key,
      projectKeyOfSession: (sessionKey) => sessionProjectKeyBySessionKey.get(sessionKey) ?? null,
      projectKeys: [
        ...pinnedItems.filter((item) => item.kind === 'project').map((item) => item.key),
        ...projectWorkspaces.map((project) => sidebarPinnedProjectKey(project)),
      ],
    })
    drag.beginDrag(state)
  }

  function commitItemDrop(): void {
    const destination = drag.hovered
    const state = drag.drag
    drag.endDrag()
    if (!destination || !state) return
    if (destination.kind === 'project') {
      const allowed = state.sessionKeys.filter(
        (key) => sessionProjectKeyBySessionKey.get(key) === `project:${destination.projectKey}`,
      )
      if (allowed.length === 0) {
        setDropRejected(true)
        window.setTimeout(() => setDropRejected(false), 400)
        return
      }
      onRestoreItemsToProject(allowed)
      return
    }
    if (destination.kind === 'pinned') {
      onMoveItemsToPinned(state.keys, destination.index)
      return
    }
    if (destination.kind === 'section') {
      onMoveItemsToSection(state.keys, destination.sectionId, destination.index)
      return
    }
    onMoveItemsToDefault(state.keys)
  }

  function handleSelectionClick(event: React.MouseEvent<HTMLElement>): void {
    if (!(event.target instanceof Element)) return
    const row = event.target.closest<HTMLElement>(
      '[data-sidebar-session-id], [data-sidebar-project-key]',
    )
    if (!row) return
    const sessionId = row.dataset.sidebarSessionId
    const projectKeyValue = row.dataset.sidebarProjectKey
    if (projectKeyValue && !event.shiftKey && !event.ctrlKey && !event.metaKey) return
    const key = sessionId
      ? `session:${sessionId}`
      : projectKeyValue
        ? `project:${projectKeyValue}`
        : null
    if (!key) return
    toggleSelection(
      key,
      event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace',
    )
  }

  useEffect(() => {
    if (activeSessionId) return
    setSelectedKeys([])
    selectionAnchorRef.current = null
  }, [activeSessionId])

  useEffect(() => {
    if (!draggingProjectKey) return
    projectOrderRef.current = canonicalProjectOrder
    setProjectOrder((current) =>
      sameStringOrder(current, canonicalProjectOrder) ? current : canonicalProjectOrder,
    )
  }, [canonicalProjectOrder, draggingProjectKey])

  useEffect(() => {
    if (draggingPinnedItemKey) return
    pinnedOrderRef.current = canonicalPinnedOrder
    setPinnedOrder((current) =>
      sameStringOrder(current, canonicalPinnedOrder) ? current : canonicalPinnedOrder,
    )
  }, [canonicalPinnedOrder, draggingPinnedItemKey])

  useEffect(() => {
    if (!activeSessionId) return

    const pinnedIndex = pinnedItems.findIndex((item) =>
      item.kind === 'session'
        ? item.session.id === activeSessionId
        : projectSessionBuckets
            .get(sidebarProjectKey(item.project))
            ?.displaySessions.some((session) => session.id === activeSessionId),
    )
    if (pinnedIndex >= 0) {
      setVisiblePinnedLimit((current) => Math.max(current, pinnedIndex + 1))
      return
    }

    const projectIndex =
      organization === 'projects'
        ? projectWorkspaces.findIndex((project) =>
            projectSessionBuckets
              .get(sidebarProjectKey(project))
              ?.displaySessions.some((session) => session.id === activeSessionId),
          )
        : -1
    if (projectIndex >= 0) {
      setVisibleProjectLimit((current) => Math.max(current, projectIndex + 1))
    }
  }, [activeSessionId, pinnedItems, organization, projectSessionBuckets, projectWorkspaces])

  useEffect(() => {
    const activeProjectIndex =
      activeSessionId && organization === 'projects'
        ? projectWorkspaces.findIndex((project) =>
            projectSessionBuckets
              .get(sidebarProjectKey(project))
              ?.displaySessions.some((session) => session.id === activeSessionId),
          )
        : -1
    setVisibleProjectLimit(activeProjectIndex < 0 ? 5 : Math.max(5, activeProjectIndex + 1))
  }, [organization])

  function isUnavailable(project: DesktopWorkspace): boolean {
    return unavailablePaths.has(normalizeSidebarPath(project.path))
  }

  function moveProject(
    projects: readonly DesktopWorkspace[],
    scopeKey: string,
    sourceKey: string,
    targetKey: string,
  ): void {
    if (sourceKey === targetKey) return
    const order = projects.map(sidebarProjectKey)
    const sourceIndex = order.indexOf(sourceKey)
    const targetIndex = order.indexOf(targetKey)
    if (sourceIndex < 0 || targetIndex < 0) return
    const [moved] = order.splice(sourceIndex, 1)
    if (!moved) return
    order.splice(targetIndex, 0, moved)
    onManualOrderChange(scopeKey, order)
    onProjectSortChange('manual')
  }

  function renderProjectGroup(project: DesktopWorkspace, dropIndex?: number): React.ReactNode {
    return (
      <SidebarProjectGroup
        currentSectionId={
          customSections.find((section) =>
            section.entries.some((entry) => entry.key === sidebarPinnedProjectKey(project)),
          )?.id ?? null
        }
        onMoveProjectToSection={(target, sectionId) =>
          onMoveItemsToSection([sidebarPinnedProjectKey(target)], sectionId)
        }
        onMoveProjectToDefault={(target) => onMoveItemsToDefault([sidebarPinnedProjectKey(target)])}
        onCreateSection={onCreateSection}
        customSections={customSectionOptions}
        dropIndex={dropIndex}
        onItemDragEnd={commitItemDrop}
        onItemDragStart={(sessionId) =>
          beginItemDrag(sidebarPinnedSessionKey({ id: sessionId } as SessionListItem))
        }
        onMoveToDefault={onMoveSessionToDefault}
        onMoveToSection={onMoveSessionToSection}
        activeSessionId={activeSessionId}
        bucket={
          projectSessionBuckets.get(sidebarProjectKey(project)) ?? EMPTY_PROJECT_SESSION_BUCKET
        }
        disclosureStore={disclosureStore}
        isUnavailable={isUnavailable(project)}
        manualOrderByScope={manualOrderByScope}
        now={now}
        pendingPermissionSessionIds={pendingPermissionSessionIds}
        titleLoadingIds={titleLoadingIds}
        project={project}
        sessionFallbackTitles={sessionFallbackTitles}
        sort={projectSort}
        workspace={workspace}
        onArchiveSessions={onArchiveSessions}
        onCreateSession={onCreateSession}
        onManualOrderChange={onManualOrderChange}
        onPinSession={onPinSession}
        onPinWorkspace={onPinWorkspace}
        onRemoveWorkspace={onRemoveWorkspace}
        onReport={onReport}
        onSelectSession={onSelectSession}
        onToggleSessionUnread={onToggleSessionUnread}
        onRenameSession={onRenameSession}
        onSortChange={onProjectSortChange}
        onUnpinSession={onUnpinSession}
        onUnpinWorkspace={onUnpinWorkspace}
      />
    )
  }

  function renderProject(project: DesktopWorkspace, index: number): React.ReactNode {
    const key = sidebarProjectKey(project)
    return (
      <SidebarReorderItem
        data-sidebar-drop-index={index}
        className="sidebar-project-sortable"
        dragHandleSelector=".sidebar-project-header"
        key={key}
        reducedMotion={reducedMotion}
        value={key}
        onReorderDragEnd={() => {
          const finalOrder = projectOrderRef.current
          setDraggingProjectKey(null)
          onManualOrderChange('projects', finalOrder)
          onProjectSortChange('manual')
          commitItemDrop()
        }}
        onReorderDragStart={() => {
          projectOrderRef.current = orderedProjects.map(sidebarProjectKey)
          setDraggingProjectKey(key)
          beginItemDrag(sidebarPinnedProjectKey(project))
        }}
        onKeyDownCapture={(event) => {
          if (
            !event.altKey ||
            (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
            isTextEntry(event.target) ||
            !(event.target as Element).closest('.sidebar-project-button')
          ) {
            return
          }
          const order = orderedProjects.map(sidebarProjectKey)
          const index = order.indexOf(key)
          const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1
          const target = order[targetIndex]
          if (index < 0 || !target) return
          event.preventDefault()
          moveProject(orderedProjects, 'projects', key, target)
        }}
      >
        {renderProjectGroup(project)}
      </SidebarReorderItem>
    )
  }

  function movePinnedItem(sourceKey: string, targetKey: string): void {
    const order = reorderSidebarPinnedItemKeys(orderedPinnedItems, sourceKey, targetKey)
    if (order) onManualOrderChange('pinned-items', order)
  }

  function renderPinnedItem(item: SidebarPinnedItem, index: number): React.ReactNode {
    const shortcutTargetSelector =
      item.kind === 'session' ? '.sidebar-session-button' : '.sidebar-project-button'
    return (
      <SidebarReorderItem
        className={cx(
          'sidebar-project-sortable',
          selectedKeys.includes(item.key) &&
            (item.kind === 'project'
              ? 'sidebar-item--selected tw:[&_.sidebar-project-header]:bg-app-selected'
              : 'sidebar-item--selected tw:[&_.sidebar-session-row]:bg-app-selected'),
        )}
        data-sidebar-drop-index={index}
        data-sidebar-pinned-item-key={item.key}
        dragHandleSelector={item.kind === 'project' ? '.sidebar-project-header' : undefined}
        key={item.key}
        reducedMotion={reducedMotion}
        value={item.key}
        onReorderDragEnd={() => {
          const finalOrder = pinnedOrderRef.current
          setDraggingPinnedItemKey(null)
          onManualOrderChange('pinned-items', finalOrder)
          commitItemDrop()
        }}
        onReorderDragStart={() => {
          setDraggingPinnedItemKey(item.key)
          beginItemDrag(item.key)
        }}
        onKeyDownCapture={(event) => {
          if (
            !event.altKey ||
            (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
            isTextEntry(event.target) ||
            !(event.target as Element).closest(shortcutTargetSelector)
          ) {
            return
          }
          const index = orderedPinnedItems.findIndex((entry) => entry.key === item.key)
          const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1
          const target = orderedPinnedItems[targetIndex]
          if (index < 0 || !target) return
          event.preventDefault()
          event.stopPropagation()
          movePinnedItem(item.key, target.key)
        }}
      >
        {item.kind === 'project' ? (
          renderProjectGroup(item.project)
        ) : (
          <SidebarSessionGroup
            activeSessionId={activeSessionId}
            currentSectionId={sectionIdBySessionKey.get(item.key) ?? null}
            customSections={customSectionOptions}
            groupKey={`pinned-item:${item.session.id}`}
            onItemDragEnd={commitItemDrop}
            onItemDragStart={(sessionId) =>
              beginItemDrag(sidebarPinnedSessionKey({ id: sessionId } as SessionListItem))
            }
            now={now}
            pendingPermissionSessionIds={pendingPermissionSessionIds}
            titleLoadingIds={titleLoadingIds}
            sessionFallbackTitles={sessionFallbackTitles}
            sessions={[item.session]}
            showConversationIcon
            onArchiveSessions={onArchiveSessions}
            onMoveToDefault={onMoveSessionToDefault}
            onMoveToSection={onMoveSessionToSection}
            onPinSession={onPinSession}
            onSelectSession={onSelectSession}
            onToggleSessionUnread={onToggleSessionUnread}
            onRenameSession={onRenameSession}
            onUnpinSession={onUnpinSession}
          />
        )}
      </SidebarReorderItem>
    )
  }

  return (
    <SidebarHoverCardProvider>
      <ScrollArea
        className="sidebar-scroll-area tw:min-h-0 tw:flex-1 tw:overflow-x-hidden tw:scroll-pb-2 tw:forced-colors:[scrollbar-color:auto]"
        contentClassName="sidebar-scroll-content tw:min-w-0 tw:pb-2"
        viewportRef={scrollViewportRef}
        onScroll={onScroll}
      >
        {scrollHeader}
        {/* 次级导航与时间线/任务主体之间的分组间距，不再占用整个滚动视口的外边距 */}
        <div
          className={cx(
            'sidebar-scroll-main tw:min-w-0 tw:pt-2',
            dropRejected && 'sidebar-drop-rejected',
          )}
          onClickCapture={handleSelectionClick}
          onKeyDown={(event) =>
            moveFocusOnArrowKey(event, '.sidebar-session-button, .sidebar-project-button')
          }
        >
          {drag.indicator ? (
            <div
              aria-hidden="true"
              className="sidebar-drop-indicator tw:pointer-events-none tw:fixed tw:z-tooltip tw:-mt-px tw:h-0.5 tw:rounded-full tw:bg-app-accent"
              style={{
                top: drag.indicator.top,
                left: drag.indicator.left,
                width: drag.indicator.width,
              }}
            />
          ) : null}
          {timeline ? (
            <Timeline
              showPriority={showActivityPriority}
              onShowPriorityChange={onShowActivityPriorityChange}
              showSources={showActivitySources}
              hasReadActivity={hasReadActivity}
              onClearReadActivity={onClearReadActivity}
              onRestoreDefaults={onRestoreActivityDefaults}
              activeSessionId={activeSessionId}
              hasArchivableAttention={hasArchivableAttention}
              hasUnreadAttention={hasUnreadAttention}
              now={now}
              pendingPermissionSessionIds={pendingPermissionSessionIds}
              showWork={showActivityWork}
              showChat={showActivityChat}
              showScheduledSessions={showActivityScheduled}
              onShowScheduledSessionsChange={onShowActivityScheduledChange ?? (() => undefined)}
              showPinned={showTimelinePinned}
              timeline={timeline}
              titleLoadingIds={titleLoadingIds}
              sessionFallbackTitles={sessionFallbackTitles}
              onArchiveSessions={onArchiveSessions}
              onMarkAttentionRead={onMarkAttentionRead}
              onPinSession={onPinSession}
              onRequestArchiveAttention={onRequestArchiveAttention}
              onSelectSession={onSelectSession}
              onToggleSessionUnread={onToggleSessionUnread}
              onRenameSession={onRenameSession}
              onShowWorkChange={onShowActivityWorkChange}
              onShowChatChange={onShowActivityChatChange}
              onShowPinnedChange={onShowTimelinePinnedChange}
              onUnpinSession={onUnpinSession}
            />
          ) : (
            <div
              className="sidebar-standard-mode sidebar-section-group tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:px-2"
              data-sidebar-drop-container="default"
            >
              <AnimatePresence initial={false}>
                {pinnedItems.length > 0 ? (
                  <SidebarSectionPresence key="pinned" reducedMotion={reducedMotion}>
                    <SidebarSection
                      action={
                        <SidebarSectionActions>
                          <SidebarPinnedSortMenu
                            sort={pinnedSort}
                            onSortChange={onPinnedSortChange}
                          />
                        </SidebarSectionActions>
                      }
                      disclosureStore={disclosureStore}
                      sectionId="pinned"
                      title="置顶"
                    >
                      {displayedPinnedItems.length > 0 ? (
                        <Reorder.Group
                          as="div"
                          axis="y"
                          className="sidebar-reorder-group tw:flex tw:min-w-0 tw:flex-col tw:gap-px"
                          data-sidebar-drop-container="pinned"
                          values={pinnedItemValues}
                          onReorder={(nextOrder) => {
                            if (sameStringOrder(pinnedOrderRef.current, nextOrder)) return
                            pinnedOrderRef.current = nextOrder
                            setPinnedOrder(nextOrder)
                          }}
                        >
                          {displayedPinnedItems.map(renderPinnedItem)}
                        </Reorder.Group>
                      ) : null}
                      {hasPinnedItemOverflow ? (
                        <SidebarShowMoreActions
                          canCollapse={canCollapsePinnedItems}
                          canShowMore={canShowMorePinnedItems}
                          onCollapse={() => setVisiblePinnedLimit(PINNED_INITIAL_LIMIT)}
                          onShowMore={() =>
                            setVisiblePinnedLimit((current) =>
                              Math.min(current + PINNED_LIMIT_STEP, pinnedItems.length),
                            )
                          }
                        />
                      ) : null}
                    </SidebarSection>
                  </SidebarSectionPresence>
                ) : null}
              </AnimatePresence>

              {customSections.map((section) => (
                <SidebarCustomSection
                  key={section.id}
                  activeSessionId={activeSessionId}
                  manualOrderByScope={manualOrderByScope}
                  now={now}
                  pendingPermissionSessionIds={pendingPermissionSessionIds}
                  section={section}
                  sectionOptions={customSectionOptions}
                  selectedKeys={selectedKeys}
                  sessionFallbackTitles={sessionFallbackTitles}
                  titleLoadingIds={titleLoadingIds}
                  onArchiveSessions={onArchiveSessions}
                  onDelete={onDeleteSection}
                  onItemDragEnd={commitItemDrop}
                  onItemDragStart={(sessionId) =>
                    beginItemDrag(sidebarPinnedSessionKey({ id: sessionId } as SessionListItem))
                  }
                  onManualOrderChange={onManualOrderChange}
                  onMoveSessionToDefault={onMoveSessionToDefault}
                  onMoveSessionToSection={onMoveSessionToSection}
                  onPinSession={onPinSession}
                  onRename={onRenameSection}
                  onRenameSession={onRenameSession}
                  onRenderProject={renderProjectGroup}
                  onReorderItems={onReorderSectionItems}
                  onSelectSession={onSelectSession}
                  onSetCollapsed={onSetSectionCollapsed}
                  onSetSort={onSetSectionSort}
                  onToggleSessionUnread={onToggleSessionUnread}
                  onUnpinSession={onUnpinSession}
                />
              ))}

              <AnimatePresence initial={false}>
                {organization === 'projects' ? (
                  <SidebarSectionPresence key="projects" reducedMotion={reducedMotion}>
                    <SidebarSection
                      action={
                        <SidebarSectionActions>
                          <SidebarOrganizeMenu
                            onCreateSection={onCreateSection}
                            showScheduledSessions={showScheduledSessions}
                            onShowScheduledSessionsChange={onShowScheduledSessionsChange}
                            organization={organization}
                            sort={projectSort}
                            onOrganizationChange={onOrganizationChange}
                            onSortChange={onProjectSortChange}
                          />
                          <Button
                            isIconOnly
                            variant="text"
                            onClick={onChooseWorkspace}
                            iconSize="md"
                            size="compact"
                            title="添加项目"
                          >
                            <Plus size={APP_ICON_SIZE} />
                          </Button>
                        </SidebarSectionActions>
                      }
                      disclosureStore={disclosureStore}
                      sectionId="projects"
                      title="项目"
                    >
                      {projectCatalogState.status === 'loading' ? (
                        <SidebarEmptyRow role="status">正在加载项目…</SidebarEmptyRow>
                      ) : null}
                      {projectWorkspaces.length > 0 ? (
                        <>
                          <Reorder.Group
                            as="div"
                            axis="y"
                            className="sidebar-reorder-group tw:flex tw:min-w-0 tw:flex-col tw:gap-px"
                            values={orderedProjects.map(sidebarProjectKey)}
                            onReorder={(nextOrder) => {
                              if (sameStringOrder(projectOrderRef.current, nextOrder)) return
                              projectOrderRef.current = nextOrder
                              setProjectOrder(nextOrder)
                            }}
                          >
                            {displayedProjects.map(renderProject)}
                          </Reorder.Group>
                          {hasProjectOverflow ? (
                            <SidebarShowMoreActions
                              canCollapse={canCollapseProjects}
                              canShowMore={canShowMoreProjects}
                              onCollapse={() => setVisibleProjectLimit(5)}
                              onShowMore={() =>
                                setVisibleProjectLimit((current) =>
                                  Math.min(current + 5, projectWorkspaces.length),
                                )
                              }
                            />
                          ) : null}
                        </>
                      ) : projectCatalogState.status !== 'loading' ? (
                        <SidebarEmptyRow>暂无项目</SidebarEmptyRow>
                      ) : null}
                    </SidebarSection>
                  </SidebarSectionPresence>
                ) : null}
              </AnimatePresence>

              <SidebarSection
                action={
                  <SidebarSectionActions>
                    <SidebarOrganizeMenu
                      onCreateSection={onCreateSection}
                      showScheduledSessions={showScheduledSessions}
                      onShowScheduledSessionsChange={onShowScheduledSessionsChange}
                      organization={organization}
                      showProjectsInRecents={showProjectsInRecents}
                      onShowProjectsInRecentsChange={onShowProjectsInRecentsChange}
                      sort={sessionSort}
                      onOrganizationChange={onOrganizationChange}
                      onSortChange={onSessionSortChange}
                    />
                    <Button
                      isIconOnly
                      variant="text"
                      onClick={() => onCreateSession(null)}
                      iconSize="md"
                      size="compact"
                      title="新建无项目任务"
                    >
                      <SquarePen size={APP_ICON_SIZE} />
                    </Button>
                  </SidebarSectionActions>
                }
                disclosureStore={disclosureStore}
                sectionId="recent"
                title="最近"
              >
                {recentSessions.length === 0 ? (
                  <SidebarEmptyRow>
                    {organization === 'flat' ? '暂无任务' : '暂无无项目任务'}
                  </SidebarEmptyRow>
                ) : (
                  <SidebarSessionGroup
                    activeSessionId={activeSessionId}
                    customSections={customSectionOptions}
                    dropIndexBase={displayedProjects.length}
                    groupKey="recent"
                    sessionIndent="gutter"
                    initialLimit={10}
                    manualOrderByScope={manualOrderByScope}
                    now={now}
                    pendingPermissionSessionIds={pendingPermissionSessionIds}
                    titleLoadingIds={titleLoadingIds}
                    sessionFallbackTitles={sessionFallbackTitles}
                    sessions={recentSessions}
                    sort={sessionSort}
                    onArchiveSessions={onArchiveSessions}
                    onItemDragEnd={commitItemDrop}
                    onItemDragStart={(sessionId) =>
                      beginItemDrag(sidebarPinnedSessionKey({ id: sessionId } as SessionListItem))
                    }
                    onManualOrderChange={onManualOrderChange}
                    onMoveToDefault={onMoveSessionToDefault}
                    onMoveToSection={onMoveSessionToSection}
                    onPinSession={onPinSession}
                    onSelectSession={onSelectSession}
                    onToggleSessionUnread={onToggleSessionUnread}
                    onRenameSession={onRenameSession}
                    onSortChange={onSessionSortChange}
                    onUnpinSession={onUnpinSession}
                  />
                )}
              </SidebarSection>
            </div>
          )}
        </div>
      </ScrollArea>
    </SidebarHoverCardProvider>
  )
}

type ActivityMenuProps = {
  hasArchivableAttention: boolean
  hasUnreadAttention: boolean
  showPriority: boolean
  onShowPriorityChange?: (value: boolean) => void
  showSources: boolean
  showWork: boolean
  showChat: boolean
  showScheduledSessions: boolean
  onShowScheduledSessionsChange: (value: boolean) => void
  showPinned: boolean
  onMarkAttentionRead: () => void
  onRequestArchiveAttention: () => void
  onShowWorkChange: (value: boolean) => void
  onShowChatChange: (value: boolean) => void
  onShowPinnedChange: (value: boolean) => void
  hasReadActivity: boolean
  onClearReadActivity?: () => void
  onRestoreDefaults?: () => void
}

function Timeline({
  activeSessionId,
  now,
  pendingPermissionSessionIds,
  timeline,
  titleLoadingIds,
  sessionFallbackTitles,
  onArchiveSessions,
  onPinSession,
  onSelectSession,
  onToggleSessionUnread,
  onRenameSession,
  onUnpinSession,
  ...options
}: ActivityMenuProps & {
  activeSessionId: string | null
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  timeline: SidebarTimelineModel
  titleLoadingIds: ReadonlySet<string>
  sessionFallbackTitles: Record<string, string>
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onPinSession: (session: SessionListItem) => void
  onSelectSession: (session: SessionListItem) => void
  onToggleSessionUnread: (session: SessionListItem) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onUnpinSession: (session: SessionListItem) => void
}): React.ReactNode {
  const { showPriority, showWork, showChat, showPinned, showScheduledSessions } = options
  const [visibleLimit, setVisibleLimit] = useState(10)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const previousTotalRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    setVisibleLimit(10)
  }, [showPriority, showWork, showChat, showPinned, showScheduledSessions])

  const sliced = useMemo(
    () => sliceSidebarTimelineModel(timeline, visibleLimit),
    [timeline, visibleLimit],
  )

  useEffect(() => {
    const nextTotal = sliced.totalCount
    const previousTotal = previousTotalRef.current
    setVisibleLimit((current) =>
      clampTimelineVisibleLimit({
        previousTotal,
        nextTotal,
        currentLimit: current,
      }),
    )
    previousTotalRef.current = nextTotal
  }, [sliced.totalCount])

  useEffect(() => {
    if (!sliced.hasMore || !sentinelRef.current) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleLimit((prev) => prev + 10)
        }
      },
      { rootMargin: '100px' },
    )
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [sliced.hasMore])

  const sharedSessionProps = {
    activeSessionId,
    now,
    pendingPermissionSessionIds,
    titleLoadingIds,
    sessionFallbackTitles,
    onArchiveSessions,
    onPinSession,
    onSelectSession,
    onToggleSessionUnread,
    onRenameSession,
    onUnpinSession,
  }

  const actions = (
    <div className="tw:flex tw:items-center tw:gap-1">
      <TimelinePriorityMenu {...options} />
      {showPriority && options.hasReadActivity ? (
        <Button
          isIconOnly
          aria-label="清除已读聊天"
          title="清除已读聊天"
          color="ghostSecondary"
          size="compact"
          onClick={options.onClearReadActivity}
        >
          <RefreshCw size={APP_ICON_SIZE} />
        </Button>
      ) : null}
    </div>
  )
  const groups: SidebarFocusSection[] = [
    ...(showPriority
      ? [{ id: 'priority' as const, label: '优先事项', sessions: sliced.prioritySessions }]
      : []),
    ...(sliced.pinnedSessions.length
      ? [{ id: 'pinned' as const, label: '置顶', sessions: sliced.pinnedSessions }]
      : []),
    ...sliced.dateSections,
  ]
  if (groups.length === 0) groups.push({ id: 'day-0', label: '今天', sessions: [] })
  return (
    <div className="sidebar-timeline tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:px-2">
      {groups.map((section, index) => (
        <FocusSectionGroup
          key={section.id}
          action={index === 0 ? actions : undefined}
          emptyState={section.id === 'priority' ? '暂无需要关注的任务' : '当前筛选下没有活动'}
          section={section}
          sort="preserve"
          {...sharedSessionProps}
        />
      ))}
      {sliced.hasMore ? (
        <div ref={sentinelRef} className="sidebar-activity-sentinel tw:h-4 tw:w-full" />
      ) : null}
    </div>
  )
}

function TimelinePriorityMenu(options: ActivityMenuProps): React.ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const {
    showPriority,
    showWork,
    showChat,
    showPinned,
    showScheduledSessions,
    showSources,
    onShowPriorityChange,
    onShowWorkChange,
    onShowChatChange,
    onShowPinnedChange,
    onShowScheduledSessionsChange,
    onRestoreDefaults,
    hasUnreadAttention,
    onMarkAttentionRead,
    hasArchivableAttention,
    onRequestArchiveAttention,
  } = options
  const customized =
    !showPriority ||
    showPinned ||
    showScheduledSessions ||
    (showSources && (!showWork || !showChat))
  return (
    <PopoverMenu
      align="start"
      className="sidebar-timeline-menu popover-menu--flex"
      open={menuOpen}
      side="bottom"
      sideOffset={4}
      size="sm"
      onOpenChange={setMenuOpen}
      trigger={
        <Button
          isIconOnly
          aria-label="活动视图选项"
          title="活动视图选项"
          color="ghostSecondary"
          size="compact"
        >
          <Ellipsis size={APP_ICON_SIZE} />
        </Button>
      }
    >
      <PopoverLabel>显示</PopoverLabel>
      {customized ? <PopoverItem onClick={onRestoreDefaults}>恢复默认设置</PopoverItem> : null}
      <PopoverCheckboxItem checked={showPriority} keepOpen onCheckedChange={onShowPriorityChange}>
        优先事项部分
      </PopoverCheckboxItem>
      {showSources ? (
        <>
          <PopoverCheckboxItem checked={showWork} keepOpen onCheckedChange={onShowWorkChange}>
            工作
          </PopoverCheckboxItem>
          <PopoverCheckboxItem checked={showChat} keepOpen onCheckedChange={onShowChatChange}>
            聊天
          </PopoverCheckboxItem>
        </>
      ) : null}
      <PopoverCheckboxItem checked={showPinned} keepOpen onCheckedChange={onShowPinnedChange}>
        置顶
      </PopoverCheckboxItem>
      <PopoverCheckboxItem
        checked={showScheduledSessions}
        keepOpen
        onCheckedChange={onShowScheduledSessionsChange}
      >
        定时任务
      </PopoverCheckboxItem>
      <PopoverSeparator />
      <PopoverItem disabled={!hasUnreadAttention} onClick={onMarkAttentionRead}>
        全部标为已读
      </PopoverItem>
      <PopoverItem disabled={!hasArchivableAttention} onClick={onRequestArchiveAttention}>
        归档聊天
      </PopoverItem>
    </PopoverMenu>
  )
}

function FocusSectionGroup({
  action,
  activeSessionId,
  emptyState,
  now,
  pendingPermissionSessionIds,
  section,
  sort,
  titleLoadingIds,
  sessionFallbackTitles,
  onArchiveSessions,
  onPinSession,
  onSelectSession,
  onToggleSessionUnread,
  onRenameSession,
  onUnpinSession,
}: {
  action?: React.ReactNode
  activeSessionId: string | null
  emptyState?: React.ReactNode
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  section: SidebarFocusSection
  sort: 'updated' | 'preserve'
  titleLoadingIds: ReadonlySet<string>
  sessionFallbackTitles: Record<string, string>
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onPinSession: (session: SessionListItem) => void
  onSelectSession: (session: SessionListItem) => void
  onToggleSessionUnread: (session: SessionListItem) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onUnpinSession: (session: SessionListItem) => void
}): React.ReactNode {
  return (
    <section className="sidebar-section tw:grid">
      <div className={SECTION_HEADER_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>
          <span className={SECTION_LABEL_CLASS}>{section.label}</span>
        </h2>
        <div className={SECTION_TRAILING_CLASS}>
          <SidebarSectionActions>{action}</SidebarSectionActions>
        </div>
      </div>
      <div className={SECTION_CONTENT_CLASS}>
        {section.sessions.length === 0 && emptyState != null ? (
          <SidebarEmptyRow>{emptyState}</SidebarEmptyRow>
        ) : (
          <SidebarSessionGroup
            activeSessionId={activeSessionId}
            groupKey={`focus:${section.id}`}
            now={now}
            pagination="all"
            sessionIndent="gutter"
            pendingPermissionSessionIds={pendingPermissionSessionIds}
            presentation="activity"
            sort={sort}
            titleLoadingIds={titleLoadingIds}
            sessionFallbackTitles={sessionFallbackTitles}
            sessions={section.sessions}
            onArchiveSessions={onArchiveSessions}
            onPinSession={onPinSession}
            onSelectSession={onSelectSession}
            onToggleSessionUnread={onToggleSessionUnread}
            onRenameSession={onRenameSession}
            onUnpinSession={onUnpinSession}
          />
        )}
      </div>
    </section>
  )
}

const EMPTY_PROJECT_SESSION_BUCKET: SidebarProjectSessionBucket = {
  allSessions: [],
  displaySessions: [],
  openCount: 0,
  unreadCount: 0,
}

// 普通列表只提供最近更新与手动排序；历史 priority 值按最近更新呈现。
const SIDEBAR_SORT_OPTIONS: Array<{
  label: string
  value: DesktopSidebarSort
}> = [
  { label: '最近更新', value: 'updated' },
  { label: '手动排序', value: 'manual' },
]

function SidebarOrganizeMenu({
  showScheduledSessions,
  onShowScheduledSessionsChange,
  organization,
  showProjectsInRecents = false,
  onShowProjectsInRecentsChange,
  sort,
  onOrganizationChange,
  onSortChange,
  onCreateSection,
}: {
  organization: DesktopSidebarOrganization
  showProjectsInRecents?: boolean
  onShowProjectsInRecentsChange?: (value: boolean) => void
  showScheduledSessions: boolean
  onShowScheduledSessionsChange: (value: boolean) => void
  sort: DesktopSidebarSort
  onOrganizationChange: (organization: DesktopSidebarOrganization) => void
  onSortChange: (sort: DesktopSidebarSort) => void
  onCreateSection: (itemKeys?: string[]) => void
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <PopoverMenu
      align="start"
      className="popover-sidebar-organize popover-menu--flex"
      avoidCollisions={false}
      open={open}
      side="bottom"
      sideOffset={4}
      trigger={
        <Button isIconOnly variant="text" iconSize="md" size="compact" title="整理侧栏">
          <Ellipsis size={APP_ICON_SIZE} />
        </Button>
      }
      size="sm"
      onOpenChange={setOpen}
    >
      <DropdownActions
        actions={[
          {
            kind: 'sub',
            label: '整理侧边栏',
            layout: 'grid',
            children: [
              {
                kind: 'item',
                label: '分项目显示',
                checked: organization === 'projects',
                onSelect: () => onOrganizationChange('projects'),
              },
              {
                kind: 'item',
                label: '合并显示',
                checked: organization === 'flat',
                onSelect: () => onOrganizationChange('flat'),
              },
            ],
          },
          {
            kind: 'sub',
            label: '聊天排序方式',
            layout: 'grid',
            children: SIDEBAR_SORT_OPTIONS.map((option) => ({
              kind: 'item',
              label: option.label,
              checked: sort === option.value || (sort === 'priority' && option.value === 'updated'),
              onSelect: () => onSortChange(option.value),
            })),
          },
        ]}
      />
      {organization === 'projects' && onShowProjectsInRecentsChange ? (
        <>
          <PopoverSeparator />
          <PopoverLabel>显示</PopoverLabel>
          <PopoverCheckboxItem
            checked={showProjectsInRecents}
            onCheckedChange={onShowProjectsInRecentsChange}
          >
            项目
          </PopoverCheckboxItem>
        </>
      ) : null}
      <PopoverCheckboxItem
        checked={showScheduledSessions}
        keepOpen
        onCheckedChange={onShowScheduledSessionsChange}
      >
        显示日程会话
      </PopoverCheckboxItem>
      {onShowProjectsInRecentsChange ? (
        <>
          <PopoverSeparator />
          <PopoverItem
            icon={<Plus size={APP_ICON_SIZE} />}
            onClick={() => {
              setOpen(false)
              onCreateSection()
            }}
          >
            新建分区
          </PopoverItem>
        </>
      ) : null}
    </PopoverMenu>
  )
}

function SidebarPinnedSortMenu({
  sort,
  onSortChange,
}: {
  sort: 'manual' | 'updated'
  onSortChange: (sort: 'manual' | 'updated') => void
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <PopoverMenu
      align="start"
      className="popover-sidebar-organize popover-menu--flex"
      open={open}
      side="bottom"
      sideOffset={4}
      trigger={
        <Button isIconOnly variant="text" iconSize="md" size="compact" title="置顶排序">
          <Ellipsis size={APP_ICON_SIZE} />
        </Button>
      }
      size="sm"
      onOpenChange={setOpen}
    >
      <PopoverRadioGroup
        value={sort}
        onValueChange={(value) => onSortChange(value as 'manual' | 'updated')}
      >
        <PopoverRadioItem value="updated">最近更新</PopoverRadioItem>
        <PopoverRadioItem value="manual">手动排序</PopoverRadioItem>
      </PopoverRadioGroup>
    </PopoverMenu>
  )
}

function SidebarSectionActions({ children }: { children: React.ReactNode }): React.ReactNode {
  return <div className={SECTION_ACTIONS_CLASS}>{children}</div>
}

function SidebarShowMoreActions({
  canCollapse,
  canShowMore,
  onCollapse,
  onShowMore,
}: {
  canCollapse: boolean
  canShowMore: boolean
  onCollapse: () => void
  onShowMore: () => void
}): React.ReactNode {
  return (
    <div className={SHOW_MORE_ACTIONS_CLASS}>
      <span
        aria-hidden="true"
        className="sidebar-row-leading sidebar-row-leading-spacer tw:flex tw:size-6 tw:w-6 tw:min-w-6 tw:shrink-0 tw:grow-0 tw:basis-6 tw:items-center tw:justify-center"
      />
      <div className={SHOW_MORE_ROW_CLASS}>
        {canShowMore ? (
          <Button
            aria-expanded={canCollapse}
            className={SHOW_MORE_BUTTON_CLASS}
            color="ghostTertiary"
            onClick={onShowMore}
            size="compact"
            type="button"
          >
            <span className={SHOW_MORE_LABEL_CLASS}>展开显示</span>
          </Button>
        ) : null}
        {canCollapse ? (
          <Button
            className={SHOW_MORE_BUTTON_CLASS}
            color="ghostTertiary"
            onClick={onCollapse}
            size="compact"
            type="button"
          >
            <span className={SHOW_MORE_LABEL_CLASS}>折叠显示</span>
          </Button>
        ) : null}
      </div>
      <span
        aria-hidden="true"
        className={cx(
          'sidebar-row-trailing',
          'tw:min-w-0',
          'tw:flex',
          'tw:items-center',
          'tw:w-full',
          'tw:justify-end',
        )}
      />
    </div>
  )
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.matches('input, textarea, select') || target.isContentEditable
}

function orderItemsByKeys<T>(
  items: readonly T[],
  order: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  const byKey = new Map(items.map((item) => [keyOf(item), item]))
  const ordered = order.flatMap((key) => {
    const item = byKey.get(key)
    return item ? [item] : []
  })
  const knownKeys = new Set(ordered.map(keyOf))
  return [...ordered, ...items.filter((item) => !knownKeys.has(keyOf(item)))]
}

function pinnedAtMs(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function sameStringOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * 自定义分组：容纳聊天与项目，归属在置顶、自定义组和默认区域之间唯一。
 * 默认显示 10 项，展开按同样步长增加；活动条目强制可见。
 */
function SidebarCustomSection({
  activeSessionId,
  manualOrderByScope,
  now,
  pendingPermissionSessionIds,
  section,
  sectionOptions,
  selectedKeys,
  sessionFallbackTitles,
  titleLoadingIds,
  onArchiveSessions,
  onDelete,
  onItemDragEnd,
  onItemDragStart,
  onMoveSessionToDefault,
  onMoveSessionToSection,
  onManualOrderChange,
  onPinSession,
  onRename,
  onRenameSession,
  onRenderProject,
  onReorderItems,
  onSelectSession,
  onSetCollapsed,
  onSetSort,
  onToggleSessionUnread,
  onUnpinSession,
}: {
  activeSessionId: string | null
  manualOrderByScope: Record<string, string[]>
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  section: SidebarCustomSectionModel
  sectionOptions: readonly { id: string; title: string }[]
  selectedKeys: readonly string[]
  sessionFallbackTitles: Record<string, string>
  titleLoadingIds: ReadonlySet<string>
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onDelete: (sectionId: string) => void
  onManualOrderChange: (scopeKey: string, order: string[]) => void
  onMoveSessionToDefault: (sessionId: string) => void
  onMoveSessionToSection: (sessionId: string, sectionId: string) => void
  onItemDragStart: (sessionId: string) => void
  onItemDragEnd: () => void
  onPinSession: (session: SessionListItem) => void
  onRename: (sectionId: string, title: string) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onRenderProject: (project: DesktopWorkspace, dropIndex?: number) => React.ReactNode
  onReorderItems: (sectionId: string, keys: string[]) => void
  onSelectSession: (session: SessionListItem) => void
  onSetCollapsed: (sectionId: string, collapsed: boolean) => void
  onSetSort: (sectionId: string, sort: 'manual' | 'updated') => void
  onToggleSessionUnread: (session: SessionListItem) => void
  onUnpinSession: (session: SessionListItem) => void
}): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const [renaming, setRenaming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(section.title)
  const [visibleLimit, setVisibleLimit] = useState(CUSTOM_SECTION_INITIAL_LIMIT)
  const { baseSessions, canCollapse, canShowMore, extraSessions, hasOverflow } =
    getSidebarSessionDisplayGroups(section.entries, visibleLimit, CUSTOM_SECTION_INITIAL_LIMIT)
  const displayedEntries = [...baseSessions, ...extraSessions]
  const activeIndex = activeSessionId
    ? section.entries.findIndex(
        (entry) => entry.kind === 'session' && entry.session.id === activeSessionId,
      )
    : -1
  const visibleEntries =
    activeIndex >= visibleLimit ? section.entries.slice(0, activeIndex + 1) : displayedEntries
  const values = section.entries.map((entry) => entry.key)

  function renderEntry(entry: SidebarCustomSectionEntry, index: number): React.ReactNode {
    if (entry.kind === 'project') {
      return (
        <SidebarReorderItem
          className={cx(
            'sidebar-project-sortable',
            selectedKeys.includes(entry.key) &&
              'sidebar-item--selected tw:[&_.sidebar-project-header]:bg-app-selected',
          )}
          data-sidebar-drop-index={index}
          key={entry.key}
          reducedMotion={reducedMotion}
          value={entry.key}
        >
          {onRenderProject(entry.project, index)}
        </SidebarReorderItem>
      )
    }
    const entrySectionId = section.id
    return (
      <div
        className={cx(
          'sidebar-custom-section-session tw:min-w-0',
          selectedKeys.includes(entry.key) &&
            'sidebar-item--selected tw:[&_.sidebar-row]:bg-app-selected',
        )}
        data-sidebar-drop-index={index}
        key={entry.key}
      >
        <SidebarSessionGroup
          activeSessionId={activeSessionId}
          currentSectionId={entrySectionId}
          customSections={sectionOptions}
          dropIndexBase={index}
          groupKey={`custom:${section.id}:${entry.session.id}`}
          initialLimit={1}
          manualOrderByScope={manualOrderByScope}
          now={now}
          pendingPermissionSessionIds={pendingPermissionSessionIds}
          sessionFallbackTitles={sessionFallbackTitles}
          sessions={[entry.session]}
          showConversationIcon
          sort="preserve"
          titleLoadingIds={titleLoadingIds}
          onArchiveSessions={onArchiveSessions}
          onItemDragEnd={onItemDragEnd}
          onItemDragStart={onItemDragStart}
          onMoveToDefault={onMoveSessionToDefault}
          onMoveToSection={onMoveSessionToSection}
          onPinSession={onPinSession}
          onRenameSession={onRenameSession}
          onSelectSession={onSelectSession}
          onToggleSessionUnread={onToggleSessionUnread}
          onUnpinSession={onUnpinSession}
        />
      </div>
    )
  }

  return (
    <section
      className="sidebar-section sidebar-section--custom tw:grid"
      data-sidebar-drop-container={`section:${section.id}`}
    >
      <div className={SECTION_HEADER_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>
          {renaming ? (
            <input
              aria-label="分组名称"
              autoFocus
              className="sidebar-section-rename-input tw:h-[var(--sidebar-row-height)] tw:w-full tw:min-w-0 tw:rounded-md tw:border tw:border-app-focus tw:bg-app-control tw:px-2 tw:text-app-text tw:type-body tw:outline-none"
              onBlur={() => {
                onRename(section.id, renameValue)
                setRenaming(false)
              }}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onRename(section.id, renameValue)
                  setRenaming(false)
                } else if (event.key === 'Escape') {
                  setRenameValue(section.title)
                  setRenaming(false)
                }
              }}
              value={renameValue}
            />
          ) : (
            <button
              aria-expanded={!section.collapsed}
              className={SECTION_TOGGLE_CLASS}
              data-sidebar-section-id={section.id}
              type="button"
              onClick={() => onSetCollapsed(section.id, !section.collapsed)}
            >
              <span className={cx(SECTION_LABEL_CLASS, 'tw:min-w-0')}>{section.title}</span>
              <span className={SECTION_MAIN_CLASS}>
                <span
                  aria-hidden="true"
                  className={cx(SECTION_CHEVRON_CLASS, section.collapsed && 'tw:-rotate-90')}
                >
                  <ChevronDown size={APP_ICON_SIZES.sm} />
                </span>
              </span>
            </button>
          )}
        </h2>
        <div className={SECTION_TRAILING_CLASS}>
          <SidebarSectionActions>
            <PopoverMenu
              align="start"
              className="popover-sidebar-organize popover-menu--flex"
              open={menuOpen}
              side="bottom"
              sideOffset={4}
              trigger={
                <Button isIconOnly variant="text" iconSize="md" size="compact" title="分组操作">
                  <Ellipsis size={APP_ICON_SIZE} />
                </Button>
              }
              size="sm"
              onOpenChange={setMenuOpen}
            >
              <PopoverLabel className="popover-sidebar-organize-heading tw:px-2 tw:py-1 tw:text-app-text-meta tw:type-label">
                排序方式
              </PopoverLabel>
              <PopoverRadioGroup
                value={section.sort}
                onValueChange={(value) => onSetSort(section.id, value as 'manual' | 'updated')}
              >
                <PopoverRadioItem value="manual">手动排序</PopoverRadioItem>
                <PopoverRadioItem value="updated">最近更新</PopoverRadioItem>
              </PopoverRadioGroup>
              <PopoverSeparator />
              <PopoverItem
                icon={<SquarePen size={APP_ICON_SIZE} />}
                onClick={() => {
                  setRenameValue(section.title)
                  setRenaming(true)
                }}
              >
                重命名分组
              </PopoverItem>
              <PopoverItem icon={<X size={APP_ICON_SIZE} />} onClick={() => onDelete(section.id)}>
                删除分组
              </PopoverItem>
            </PopoverMenu>
          </SidebarSectionActions>
        </div>
      </div>
      <DisclosureContent
        className="sidebar-section-disclosure"
        contentClassName={SECTION_CONTENT_CLASS}
        expanded={!section.collapsed}
        id={`sidebar-custom-section-${section.id}`}
        mountPolicy="always"
      >
        {section.entries.length === 0 ? (
          <SidebarEmptyRow>把聊天或项目拖到这里</SidebarEmptyRow>
        ) : (
          <Reorder.Group
            as="div"
            axis="y"
            className="sidebar-reorder-group tw:flex tw:min-w-0 tw:flex-col tw:gap-px"
            data-sidebar-drop-container={`section:${section.id}`}
            values={values}
            onReorder={(nextOrder) => {
              if (
                sameStringOrder(
                  section.entries.map((entry) => entry.key),
                  nextOrder,
                )
              )
                return
              onReorderItems(section.id, nextOrder)
            }}
          >
            {visibleEntries.map(renderEntry)}
          </Reorder.Group>
        )}
        {hasOverflow ? (
          <SidebarShowMoreActions
            canCollapse={canCollapse}
            canShowMore={canShowMore}
            onCollapse={() => setVisibleLimit(CUSTOM_SECTION_INITIAL_LIMIT)}
            onShowMore={() =>
              setVisibleLimit((current) =>
                Math.min(current + CUSTOM_SECTION_INITIAL_LIMIT, section.entries.length),
              )
            }
          />
        ) : null}
      </DisclosureContent>
    </section>
  )
}

function SidebarSection({
  action,
  children,
  disclosureStore,
  sectionId,
  title,
}: {
  action?: React.ReactNode
  children: React.ReactNode
  disclosureStore: KeyedDisclosureStore
  sectionId: SidebarSectionId
  title: string
}): React.ReactNode {
  const contentId = useId()
  const disclosureKey = sidebarSectionDisclosureKey(sectionId)
  const expanded = useDisclosureExpanded(disclosureStore, disclosureKey)

  return (
    <section className="sidebar-section tw:grid">
      <div className={SECTION_HEADER_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>
          <button
            aria-controls={contentId}
            aria-expanded={expanded}
            className={SECTION_TOGGLE_CLASS}
            data-sidebar-section-id={sectionId}
            type="button"
            onClick={() => disclosureStore.setExpanded(disclosureKey, !expanded)}
          >
            <span className={cx(SECTION_LABEL_CLASS, 'tw:min-w-0')}>{title}</span>
            <span className={SECTION_MAIN_CLASS}>
              <span
                aria-hidden="true"
                className={cx(SECTION_CHEVRON_CLASS, !expanded && 'tw:-rotate-90')}
              >
                <ChevronDown size={APP_ICON_SIZES.sm} />
              </span>
            </span>
          </button>
        </h2>
        <div className={SECTION_TRAILING_CLASS}>{action}</div>
      </div>
      <DisclosureContent
        className="sidebar-section-disclosure"
        contentClassName={SECTION_CONTENT_CLASS}
        expanded={expanded}
        id={contentId}
        mountPolicy="always"
      >
        {children}
      </DisclosureContent>
    </section>
  )
}

function SidebarSectionPresence({
  children,
  reducedMotion,
  ref,
}: {
  children: React.ReactNode
  reducedMotion: boolean
  ref?: React.Ref<HTMLDivElement | null>
}): React.ReactNode {
  const isPresent = useIsPresent()

  return (
    <motion.div
      ref={ref}
      animate={{ height: 'auto', opacity: 1 }}
      aria-hidden={!isPresent ? true : undefined}
      data-presence={isPresent ? 'present' : 'exiting'}
      exit={{
        height: 0,
        opacity: 0,
        transition: motionTransition(reducedMotion, fastTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={{ height: 0, opacity: 0 }}
      style={{
        overflow: 'hidden',
        pointerEvents: isPresent ? undefined : 'none',
      }}
      transition={motionTransition(reducedMotion, standardTween)}
    >
      {children}
    </motion.div>
  )
}
