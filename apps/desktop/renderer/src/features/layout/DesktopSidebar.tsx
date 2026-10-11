import { sortSessionsByRecency } from '../session/state/SessionSorting.js'
import { mergeCatalogProjects } from './sidebar/UseSidebarProjectCatalog.js'
import type React from 'react'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopRemovedWorkspace,
  DesktopSessionCatalogStatus,
  DesktopWorkspace,
} from '../../../shared/Types.js'
import type { AppView, SessionListItem } from '../../UiTypes.js'
import { SidebarBody } from './sidebar/SidebarBody.js'
import { useSidebarActivity } from './sidebar/UseSidebarActivity.js'
import { archiveSidebarActivity, sessionNeedsStop } from './sidebar/SidebarActivityActions.js'
import { SidebarDockedPanes } from './sidebar/SidebarDockedPanes.js'
import { SidebarEmptyRow } from './sidebar/SidebarRow.js'
import type { DesktopFileEntry } from '../../../shared/Types.js'
import type {
  WorkbenchPanelSnapshot,
  WorkbenchPanelTarget,
  WorkbenchTabId,
  WorkbenchTabsState,
} from './dock/RightDockState.js'
import { SidebarHeader } from './sidebar/SidebarTopNav.js'
import {
  buildSidebarViewModel,
  buildSidebarTimelineModel,
  filterSidebarActivitySessions,
  deriveSidebarActivityIndicatorState,
  sidebarTimelinePriorityRank,
  sidebarArchivableAttentionSessions,
  sidebarAttentionUnreadSessions,
  sidebarProjectKey,
  sidebarPinnedProjectKey,
  sidebarPinnedSessionKey,
} from './sidebar/SidebarViewModel.js'
import { useDesktopSettings } from '../settings/UseDesktopSettings.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useEverOpened } from '../../hooks/UsePresenceRetention.js'
import {
  getSidebarScrollModeKey,
  type SidebarScrollModeKey,
} from './sidebar/UseSidebarScrollController.js'
import { useSidebarProjectCatalog } from './sidebar/UseSidebarProjectCatalog.js'
import {
  createSidebarDisclosureStore,
  sidebarSectionDisclosureKey,
} from './sidebar/SidebarDisclosureStore.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { DEFAULT_SIDEBAR_CUSTOMIZATION } from '../../../shared/SettingsSchema.js'
import {
  addSidebarSection,
  deleteSidebarSection,
  moveItemToSection,
  orderSidebarSections,
  removeItemsFromSections,
  renameSidebarSection,
  captureSidebarAssignments,
  restoreFailedArchiveAssignments,
  restoreSidebarAssignments,
  setSidebarSectionCollapsed,
  setSidebarSectionItems,
  setSidebarSectionSort,
} from './sidebar/SidebarCustomization.js'
import type { SidebarCustomization } from '../../../shared/Types.js'

import {
  notifyProjectRestored,
  subscribeProjectRemovals,
} from '../projects/ProjectCatalogEvents.js'
import { Toast, ToastDivider } from '../../components/ui/Toast.js'
import { Button } from '../../components/ui/Button.js'
import { InputDialog } from '../../components/ui/ConfirmationDialog.js'
import type { SidebarPane } from './sidebar/SidebarNavigation.js'

type Props = {
  active?: boolean
  pane?: SidebarPane
  activeSessionId: string | null
  catalogStatus: DesktopSessionCatalogStatus
  pendingPermissionSessionIds: ReadonlySet<string>
  titleLoadingIds: ReadonlySet<string>
  recentWorkspaces: DesktopWorkspace[]
  removedWorkspaces: DesktopRemovedWorkspace[]
  sessionFallbackTitles: Record<string, string>
  sessions: SessionListItem[]
  unavailableWorkspacePaths: Set<string>
  workspace: DesktopWorkspace | null
  onChooseWorkspace: () => void
  onCreateSession: (workspace?: DesktopWorkspace | null) => void
  onOpenCommandMenu: () => void
  onOpenWhatsNew: (restoreFocusElement: HTMLElement | null) => void
  onPinWorkspace: (workspace: DesktopWorkspace) => void
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void
  onSelectSession: (session: SessionListItem) => void
  onArchiveSessions: (sessionIds: readonly string[]) => Promise<{
    failedSessionIds: string[]
    succeededSessionIds: string[]
  }>
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void
  onReport: (message: string) => void
  onError?: (message: string) => void
  dockedPanesState?: WorkbenchPanelSnapshot
  dockedTabsById?: WorkbenchTabsState['tabsById']
  workspaceFiles?: DesktopFileEntry[]
  onSelectDockedTab?: (tabId: WorkbenchTabId) => void
  onCloseDockedTab?: (tabId: WorkbenchTabId) => void
  onMoveDockedTab?: (
    source: WorkbenchPanelTarget,
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
  ) => void
  onPopOutDockedTab?: (source: WorkbenchPanelTarget, tabId: WorkbenchTabId) => void
  onOpenFile?: (file: DesktopFileEntry) => void
  onAddComposerFiles?: (files: string[]) => void
}

export function DesktopSidebar({
  active = true,
  pane,
  activeSessionId,
  catalogStatus,
  pendingPermissionSessionIds,
  titleLoadingIds,
  recentWorkspaces,
  removedWorkspaces,
  sessionFallbackTitles,
  sessions,
  unavailableWorkspacePaths,
  workspace,
  onChooseWorkspace,
  onCreateSession,
  onOpenCommandMenu,
  onOpenWhatsNew,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onArchiveSessions,
  onRenameSession,
  onUnpinWorkspace,
  onReport,
  onError,
  dockedPanesState,
  dockedTabsById,
  workspaceFiles,
  onSelectDockedTab,
  onCloseDockedTab,
  onMoveDockedTab,
  onPopOutDockedTab,
  onOpenFile,
  onAddComposerFiles,
}: Props): React.ReactNode {
  const [relativeNow, setRelativeNow] = useState(() => Date.now())
  const [sidebarScrollOverlapping, setSidebarScrollOverlapping] = useState(false)
  const sidebarScrollPositionsRef = useRef<Map<SidebarScrollModeKey, number>>(new Map())
  const {
    collapsedSidebarSections,
    collapsedSidebarProjectPaths,
    setSidebarManualOrder,
    setRecentWorkspaces,
    setSidebarOrganization,
    setSidebarProjectSort,
    sidebarCustomization,
    setSidebarCustomization,
    sidebarSessionPins,
    setSidebarSessionPins,
    sidebarManualOrder,
    sidebarOrganization,
    sidebarShowScheduledSessions,
    setSidebarShowScheduledSessions,
    sidebarProjectSort,
    sidebarSort,
    setSidebarSort,
    sidebarTimelineEnabled,
    sidebarProductMode,
    sidebarTimelinePriorityEnabled,
    setSidebarTimelinePriorityEnabled,
    sidebarActivityShowScheduled,
    setSidebarActivityShowScheduled,
    sidebarActivityShowWork,
    setSidebarActivityShowWork,
    sidebarActivityShowChat,
    setSidebarActivityShowChat,
    sidebarActivityShowPinned,
    setSidebarActivityShowPinned,
    syncExternalSettingsPatch,
  } = useDesktopSettings()
  const sidebarCustomizationRef = useRef(sidebarCustomization)
  sidebarCustomizationRef.current = sidebarCustomization
  const persistSidebarDisclosuresRef = useRef(syncExternalSettingsPatch)
  persistSidebarDisclosuresRef.current = syncExternalSettingsPatch
  const sidebarDisclosureExternalSignatureRef = useRef(
    sidebarDisclosureSignature(collapsedSidebarSections, collapsedSidebarProjectPaths),
  )
  const sidebarDisclosureState = useMemo(
    () =>
      createSidebarDisclosureStore(
        { collapsedSidebarSections, collapsedSidebarProjectPaths },
        (snapshot) => persistSidebarDisclosuresRef.current(snapshot),
      ),
    [],
  )
  const { projectCatalogState, removeCatalogProject } = useSidebarProjectCatalog({
    onError: onError ?? onReport,
    onReport,
  })

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const mergedProjects = useMemo(
    () => mergeCatalogProjects(projectCatalogState.projects, recentWorkspaces),
    [projectCatalogState.projects, recentWorkspaces],
  )

  useEffect(() => {
    sidebarDisclosureState.registerProjects(mergedProjects)
  }, [mergedProjects, sidebarDisclosureState])

  useEffect(() => {
    const signature = sidebarDisclosureSignature(
      collapsedSidebarSections,
      collapsedSidebarProjectPaths,
    )
    if (sidebarDisclosureExternalSignatureRef.current === signature) return
    sidebarDisclosureExternalSignatureRef.current = signature
    sidebarDisclosureState.replace({
      collapsedSidebarSections,
      collapsedSidebarProjectPaths,
    })
  }, [collapsedSidebarProjectPaths, collapsedSidebarSections, sidebarDisclosureState])

  const viewModel = useMemo(
    () =>
      buildSidebarViewModel({
        manualOrderByScope: sidebarManualOrder,
        organization: sidebarOrganization,
        showProjectsInRecents: sidebarCustomization.showProjectsInRecents ?? false,
        showScheduledSessions:
          pane === 'activity' ? sidebarActivityShowScheduled : sidebarShowScheduledSessions,
        pendingPermissionSessionIds,
        recentWorkspaces: mergedProjects,
        removedWorkspaces,
        sessionPins: sidebarSessionPins,
        customSections: sidebarCustomization.sections,
        sessions,
      }),
    [
      pendingPermissionSessionIds,
      mergedProjects,
      removedWorkspaces,
      sessions,
      sidebarManualOrder,
      sidebarOrganization,
      sidebarShowScheduledSessions,
      sidebarActivityShowScheduled,
      sidebarCustomization,
      sidebarSessionPins,
      pane,
    ],
  )

  const [archiveAttentionOpen, setArchiveAttentionOpen] = useState(false)
  const [archiveAttentionTargets, setArchiveAttentionTargets] = useState<SessionListItem[]>([])
  const [archivingAttention, setArchivingAttention] = useState(false)
  const archiveAttentionDialogMounted = useEverOpened(archiveAttentionOpen)

  const activitySessions = useMemo(
    () =>
      sessions
        .filter((session) => !session.archivedAt)
        .map((session) => ({ ...session, pinnedAt: sidebarSessionPins[session.id] ?? null })),
    [sessions, sidebarSessionPins],
  )
  const activityFilteredSessions = useMemo(
    () =>
      filterSidebarActivitySessions(
        activitySessions.filter(
          (session) => sidebarActivityShowScheduled || !session.isScheduledSession,
        ),
        {
          showWork: sidebarProductMode === 'coding' || sidebarActivityShowWork,
          showChat: sidebarProductMode !== 'coding' && sidebarActivityShowChat,
        },
      ),
    [
      activitySessions,
      sidebarProductMode,
      sidebarActivityShowScheduled,
      sidebarActivityShowChat,
      sidebarActivityShowWork,
    ],
  )

  const activity = useSidebarActivity(
    activitySessions,
    pane === 'activity' ? sidebarProductMode : null,
  )
  const timelineModel = useMemo(
    () =>
      buildSidebarTimelineModel({
        now: relativeNow,
        sessions: activityFilteredSessions,
        showPinned: sidebarActivityShowPinned,
        showPriority: sidebarTimelinePriorityEnabled,
        snapshot: activity.snapshot,
      }),
    [
      activityFilteredSessions,
      relativeNow,
      sidebarActivityShowPinned,
      sidebarTimelinePriorityEnabled,
      activity.snapshot,
    ],
  )
  const timeline = pane === 'activity' ? timelineModel : null
  const hasUnread = useMemo(
    () => deriveSidebarActivityIndicatorState(activityFilteredSessions) === 'attention',
    [activityFilteredSessions],
  )
  const unreadActivityCount = activityFilteredSessions.filter(
    (session) => session.unreadAt != null,
  ).length
  const hasReadActivity = timelineModel.prioritySessions.some(
    (session) => sidebarTimelinePriorityRank(session) === null,
  )
  const attentionUnreadSessions = useMemo(
    () => sidebarAttentionUnreadSessions(timelineModel.prioritySessions),
    [timelineModel],
  )
  const archivableAttentionSessions = useMemo(
    () => sidebarArchivableAttentionSessions(timelineModel.prioritySessions),
    [timelineModel],
  )
  const sidebarScrollModeKey = getSidebarScrollModeKey({
    organization: sidebarOrganization,
    timelineEnabled: timeline !== null,
    pane,
  })

  const markAttentionRead = useCallback(async (): Promise<void> => {
    if (attentionUnreadSessions.length === 0) return
    const readThroughAt = new Date().toISOString()
    const results = await Promise.allSettled(
      attentionUnreadSessions.map((session) =>
        desktopClient.markSessionRead(session.id, readThroughAt),
      ),
    )
    const failedCount = results.filter((result) => result.status === 'rejected').length
    if (failedCount > 0) {
      onReport(
        `已标记 ${attentionUnreadSessions.length - failedCount} 个任务为已读，${failedCount} 个失败。`,
      )
    }
  }, [attentionUnreadSessions, onReport])

  const requestArchiveAttention = useCallback((): void => {
    if (archivableAttentionSessions.length === 0) return
    setArchiveAttentionTargets(archivableAttentionSessions)
    setArchiveAttentionOpen(true)
  }, [archivableAttentionSessions])

  const confirmArchiveAttention = useCallback(async (): Promise<void> => {
    if (archivingAttention) return
    setArchivingAttention(true)
    try {
      const latestById = new Map(activitySessions.map((session) => [session.id, session]))
      const targets = archiveAttentionTargets.flatMap((session) =>
        latestById.has(session.id) ? [latestById.get(session.id)!] : [],
      )
      const failed = await archiveSidebarActivity(
        targets,
        (id) => desktopClient.interruptSession(id),
        archiveSessions,
      )
      if (failed > 0) onReport(`${failed} 个聊天停止失败，未归档。`)
    } finally {
      setArchivingAttention(false)
      setArchiveAttentionOpen(false)
    }
  }, [activitySessions, archiveAttentionTargets, archivingAttention, archiveSessions, onReport])

  const previousActiveSessionIdRef = useRef<string | null | undefined>(undefined)
  const pendingContainerRevealIdRef = useRef<string | null>(activeSessionId)
  useEffect(() => {
    if (previousActiveSessionIdRef.current !== activeSessionId) {
      previousActiveSessionIdRef.current = activeSessionId
      pendingContainerRevealIdRef.current = activeSessionId
    }
    if (!activeSessionId || pendingContainerRevealIdRef.current !== activeSessionId) {
      return
    }

    if (timeline) {
      pendingContainerRevealIdRef.current = null
      return
    }

    const sessionExists = viewModel.visibleSessions.some(
      (session) => session.id === activeSessionId,
    )
    if (!sessionExists) return
    const pinnedSession = viewModel.pinnedSessions.some((session) => session.id === activeSessionId)
    const pinnedProject = viewModel.pinnedWorkspaces.find((project) =>
      viewModel.projectSessionBuckets
        .get(sidebarProjectKey(project))
        ?.displaySessions.some((session) => session.id === activeSessionId),
    )
    const project =
      sidebarOrganization === 'projects'
        ? viewModel.projectWorkspaces.find((projectEntry) =>
            viewModel.projectSessionBuckets
              .get(sidebarProjectKey(projectEntry))
              ?.displaySessions.some((session) => session.id === activeSessionId),
          )
        : undefined
    const recent = viewModel.recentSessions.some((session) => session.id === activeSessionId)

    if (!pinnedSession && !pinnedProject && !project && !recent) return
    pendingContainerRevealIdRef.current = null

    if (pinnedSession || pinnedProject) {
      sidebarDisclosureState.store.setExpanded(sidebarSectionDisclosureKey('pinned'), true)
      if (pinnedProject) {
        sidebarDisclosureState.setProjectExpanded(pinnedProject, true)
      }
      return
    }
    if (project) {
      sidebarDisclosureState.store.setExpanded(sidebarSectionDisclosureKey('projects'), true)
      sidebarDisclosureState.setProjectExpanded(project, true)
      return
    }
    if (recent)
      sidebarDisclosureState.store.setExpanded(sidebarSectionDisclosureKey('recent'), true)
  }, [activeSessionId, sidebarDisclosureState, sidebarOrganization, timeline, viewModel])

  function pinSession(session: SessionListItem): void {
    setSidebarSessionPins((current) => ({
      ...current,
      [session.id]: new Date().toISOString(),
    }))
  }

  function unpinSession(session: SessionListItem): void {
    setSidebarSessionPins((current) => {
      const { [session.id]: _removed, ...next } = current
      return next
    })
    removePinnedManualOrder([sidebarPinnedSessionKey(session)])
  }

  function toggleSessionUnread(session: SessionListItem): void {
    const operation = session.unreadAt
      ? desktopClient.markSessionRead(session.id, session.unreadAt)
      : desktopClient.markSessionUnread(session.id, new Date().toISOString())
    void operation.catch(() => {
      onReport('更新会话已读状态失败，请重试。')
    })
  }

  async function archiveSessions(targetSessions: readonly SessionListItem[]): Promise<boolean> {
    const targetKeys = targetSessions.map((session) => sidebarPinnedSessionKey(session))
    const capturedAssignments = captureSidebarAssignments(
      sidebarCustomizationRef.current,
      targetKeys,
    )
    const result = await onArchiveSessions(targetSessions.map((session) => session.id))
    if (result.failedSessionIds.length > 0) {
      // 部分失败时只回滚失败条目的分组归属，成功归档的保持移除。
      updateSidebarCustomization((current) =>
        restoreFailedArchiveAssignments(
          current,
          result.failedSessionIds.map((sessionId) => `session:${sessionId}`),
          capturedAssignments,
        ),
      )
    }
    if (result.succeededSessionIds.length > 0) {
      const removedIds = new Set(result.succeededSessionIds)
      setSidebarSessionPins((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([sessionId]) => !removedIds.has(sessionId)),
        ),
      )
      removePinnedManualOrder(result.succeededSessionIds.map((sessionId) => `session:${sessionId}`))
    }
    if (result.failedSessionIds.length > 0) {
      onReport(
        `已归档 ${result.succeededSessionIds.length} 个任务，${result.failedSessionIds.length} 个失败。`,
      )
      return false
    }
    if (result.succeededSessionIds.length > 1) {
      onReport(`已归档 ${result.succeededSessionIds.length} 个任务。`)
    }
    return true
  }

  const removePinnedManualOrder = useCallback(
    (keys: readonly string[]): void => {
      if (keys.length === 0) return
      const removedKeys = new Set(keys)
      setSidebarManualOrder((current) => {
        const pinnedItems = current['pinned-items']
        if (!pinnedItems?.some((key) => removedKeys.has(key))) return current
        const nextPinnedItems = pinnedItems.filter((key) => !removedKeys.has(key))
        if (nextPinnedItems.length > 0) {
          return {
            ...current,
            'pinned-items': nextPinnedItems,
          }
        }
        const { ['pinned-items']: _removed, ...next } = current
        return next
      })
    },
    [setSidebarManualOrder],
  )

  const updateSidebarCustomization = useCallback(
    (updater: (current: SidebarCustomization) => SidebarCustomization): void => {
      setSidebarCustomization((current) => updater(current ?? DEFAULT_SIDEBAR_CUSTOMIZATION))
    },
    [setSidebarCustomization],
  )

  function changeChatSort(sort: 'manual' | 'updated' | 'priority'): void {
    if (sort === 'manual' && (sidebarSort !== 'manual' || sidebarProjectSort !== 'manual')) {
      setSidebarManualOrder((current) => {
        const next = {
          ...current,
          recent: sortSessionsByRecency(viewModel.recentSessions).map((session) => session.id),
        }
        for (const [key, bucket] of viewModel.projectSessionBuckets)
          next[`project:${key}`] = sortSessionsByRecency(bucket.displaySessions).map(
            (session) => session.id,
          )
        return next
      })
    }
    setSidebarSort(sort)
    setSidebarProjectSort(sort)
  }

  const [projectUndo, setProjectUndo] = useState<{
    expiresAt: number
    restore: () => Promise<void>
  } | null>(null)
  const [restoringProject, setRestoringProject] = useState(false)
  useEffect(
    () =>
      subscribeProjectRemovals(({ project, removalOperationId, undoExpiresAt }) => {
        const key = sidebarPinnedProjectKey(project)
        const assignments = captureSidebarAssignments(sidebarCustomizationRef.current, [key])
        const orders = Object.entries(sidebarManualOrder).flatMap(([scope, keys]) => {
          const index = keys.indexOf(scope === 'projects' ? sidebarProjectKey(project) : key)
          return index < 0
            ? []
            : [{ scope, index, key: scope === 'projects' ? sidebarProjectKey(project) : key }]
        })
        const selected = Boolean(
          workspace &&
          (project.projectId
            ? workspace.projectId === project.projectId
            : workspace.path === project.path),
        )
        setProjectUndo({
          expiresAt: undoExpiresAt,
          restore: async () => {
            const restored = await desktopClient.restoreProject(
              project.projectId!,
              removalOperationId,
            )
            const workspaceToRestore = { ...restored, pinnedAt: project.pinnedAt }
            updateSidebarCustomization((current) =>
              restoreFailedArchiveAssignments(current, [key], assignments),
            )
            setSidebarManualOrder((current) => {
              const next = { ...current }
              for (const entry of orders) {
                const keys = [...(next[entry.scope] ?? [])]
                if (!keys.includes(entry.key))
                  keys.splice(Math.min(entry.index, keys.length), 0, entry.key)
                next[entry.scope] = keys
              }
              return next
            })
            notifyProjectRestored(workspaceToRestore, selected)
          },
        })
      }),
    [sidebarManualOrder, workspace, setSidebarManualOrder, updateSidebarCustomization],
  )
  useEffect(() => {
    if (!projectUndo) return
    const timer = setTimeout(
      () => setProjectUndo(null),
      Math.max(0, projectUndo.expiresAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [projectUndo])

  const [pendingSectionKeys, setPendingSectionKeys] = useState<string[] | null>(null)
  const [sectionTitle, setSectionTitle] = useState('')
  const createCustomSection = useCallback((itemKeys: string[] = []): void => {
    setSectionTitle('')
    setPendingSectionKeys(itemKeys)
  }, [])

  /** 拖入自定义分组：移除置顶与旧归属，按插入位置写入目标分组。 */
  const moveItemsToDestination = useCallback(
    (itemKeys: readonly string[], sectionId: string, index?: number): void => {
      const sessionKeys = itemKeys.filter((key) => key.startsWith('session:'))
      if (sessionKeys.length > 0) {
        const sessionIds = new Set(sessionKeys.map((key) => key.slice('session:'.length)))
        setSidebarSessionPins((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([sessionId]) => !sessionIds.has(sessionId)),
          ),
        )
        removePinnedManualOrder(sessionKeys)
      }
      const projectKeys = itemKeys.filter((key) => key.startsWith('project:'))
      let offset = 0
      for (const key of itemKeys) {
        const target = index === undefined ? undefined : index + offset
        updateSidebarCustomization((current) => moveItemToSection(current, sectionId, key, target))
        offset += 1
      }
      if (projectKeys.length > 0) {
        setRecentWorkspaces((current) =>
          current.map((workspace) =>
            projectKeys.includes(sidebarPinnedProjectKey(workspace))
              ? { ...workspace, pinnedAt: null }
              : workspace,
          ),
        )
        removePinnedManualOrder(projectKeys)
      }
    },
    [
      removePinnedManualOrder,
      setRecentWorkspaces,
      setSidebarSessionPins,
      updateSidebarCustomization,
    ],
  )

  /** 拖入置顶区：移除自定义归属、取消旧置顶顺序后按插入位置置顶。 */
  const pinItemsToTop = useCallback(
    (itemKeys: readonly string[], index?: number): void => {
      updateSidebarCustomization((current) => removeItemsFromSections(current, itemKeys))
      const pinnedAt = new Date().toISOString()
      const sessionKeys = itemKeys.filter((key) => key.startsWith('session:'))
      if (sessionKeys.length > 0) {
        setSidebarSessionPins((current) => {
          const next = { ...current }
          for (const key of sessionKeys) next[key.slice('session:'.length)] = pinnedAt
          return next
        })
      }
      const projectKeys = itemKeys.filter((key) => key.startsWith('project:'))
      if (projectKeys.length > 0) {
        setRecentWorkspaces((current) =>
          current.map((workspace) =>
            projectKeys.includes(sidebarPinnedProjectKey(workspace))
              ? { ...workspace, pinnedAt }
              : workspace,
          ),
        )
      }
      if (index !== undefined) {
        setSidebarManualOrder((current) => {
          const existing = (current['pinned-items'] ?? []).filter((key) => !itemKeys.includes(key))
          const insertAt = Math.max(0, Math.min(index, existing.length))
          const nextPinned = [
            ...existing.slice(0, insertAt),
            ...itemKeys,
            ...existing.slice(insertAt),
          ]
          return { ...current, 'pinned-items': nextPinned }
        })
      }
    },
    [setRecentWorkspaces, setSidebarManualOrder, setSidebarSessionPins, updateSidebarCustomization],
  )

  /** 拖入默认区域：移除自定义归属并取消置顶，回到真实项目或平铺列表。 */
  const releaseItemsToDefault = useCallback(
    (itemKeys: readonly string[]): void => {
      updateSidebarCustomization((current) => removeItemsFromSections(current, itemKeys))
      const sessionKeys = itemKeys.filter((key) => key.startsWith('session:'))
      if (sessionKeys.length > 0) {
        const sessionIds = new Set(sessionKeys.map((key) => key.slice('session:'.length)))
        setSidebarSessionPins((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([sessionId]) => !sessionIds.has(sessionId)),
          ),
        )
      }
      const projectKeys = itemKeys.filter((key) => key.startsWith('project:'))
      if (projectKeys.length > 0) {
        setRecentWorkspaces((current) =>
          current.map((workspace) =>
            projectKeys.includes(sidebarPinnedProjectKey(workspace))
              ? { ...workspace, pinnedAt: null }
              : workspace,
          ),
        )
      }
      removePinnedManualOrder(itemKeys)
    },
    [
      removePinnedManualOrder,
      setRecentWorkspaces,
      setSidebarSessionPins,
      updateSidebarCustomization,
    ],
  )

  const updateManualOrder = useCallback(
    (scopeKey: string, order: string[]): void => {
      setSidebarManualOrder((current) => ({
        ...current,
        [scopeKey]: order,
      }))
    },
    [setSidebarManualOrder],
  )

  return (
    <div className="sidebar-layout tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:py-2">
      {projectUndo ? (
        <div className="tw:fixed tw:bottom-4 tw:left-1/2 tw:z-50 tw:-translate-x-1/2">
          <Toast role="status" aria-live="polite">
            项目已移除
            <ToastDivider />
            <Button
              color="ghostSecondary"
              size="compact"
              disabled={restoringProject}
              onClick={() => {
                setRestoringProject(true)
                void projectUndo
                  .restore()
                  .then(() => setProjectUndo(null))
                  .catch((error) =>
                    onReport(error instanceof Error ? error.message : String(error)),
                  )
                  .finally(() => setRestoringProject(false))
              }}
            >
              撤销
            </Button>
          </Toast>
        </div>
      ) : null}
      <InputDialog
        open={pendingSectionKeys !== null}
        title="新建分区"
        description="将聊天和项目放入分区，按你的习惯整理侧边栏。"
        actionLabel="创建分区"
        input={{ value: sectionTitle, onChange: setSectionTitle, maxLength: 120 }}
        onCancel={() => setPendingSectionKeys(null)}
        onAction={() => {
          if (!sectionTitle.trim()) return
          const id = `section-${crypto.randomUUID()}`
          updateSidebarCustomization((current) =>
            addSidebarSection(current, id, sectionTitle.trim()),
          )
          if (pendingSectionKeys?.length) moveItemsToDestination(pendingSectionKeys, id)
          setPendingSectionKeys(null)
        }}
      />
      <SidebarHeader
        showActions={active}
        hasUnread={hasUnread}
        unreadActivityCount={unreadActivityCount}
        onOpenCommandMenu={onOpenCommandMenu}
        scrollOverlapping={sidebarScrollOverlapping}
      />
      <SidebarBody
        onScrollOverlapChange={setSidebarScrollOverlapping}
        scrollHeader={
          <>
            {catalogStatus.state === 'loading' ? (
              <SidebarEmptyRow role="status">正在加载任务目录…</SidebarEmptyRow>
            ) : null}
          </>
        }
        projectCatalogState={projectCatalogState}
        scrollModeKey={sidebarScrollModeKey}
        scrollPositions={sidebarScrollPositionsRef.current}
        activeSessionId={activeSessionId}
        pendingPermissionSessionIds={pendingPermissionSessionIds}
        titleLoadingIds={titleLoadingIds}
        disclosureStore={sidebarDisclosureState.store}
        organization={sidebarOrganization}
        timeline={timeline}
        showActivityPriority={sidebarTimelinePriorityEnabled}
        onShowActivityPriorityChange={setSidebarTimelinePriorityEnabled}
        showActivityScheduled={sidebarActivityShowScheduled}
        onShowActivityScheduledChange={setSidebarActivityShowScheduled}
        showActivitySources={sidebarProductMode !== 'coding'}
        hasReadActivity={hasReadActivity}
        onClearReadActivity={activity.clearRead}
        onRestoreActivityDefaults={() => {
          setSidebarTimelinePriorityEnabled(true)
          setSidebarActivityShowWork(true)
          setSidebarActivityShowChat(true)
          setSidebarActivityShowPinned(false)
          setSidebarActivityShowScheduled(false)
          activity.clearRead()
        }}
        showTimelinePinned={sidebarActivityShowPinned}
        showActivityWork={sidebarActivityShowWork}
        showActivityChat={sidebarActivityShowChat}
        showScheduledSessions={sidebarShowScheduledSessions}
        onShowScheduledSessionsChange={setSidebarShowScheduledSessions}
        onShowActivityWorkChange={setSidebarActivityShowWork}
        onShowActivityChatChange={setSidebarActivityShowChat}
        onShowTimelinePinnedChange={setSidebarActivityShowPinned}
        now={relativeNow}
        pinnedSessions={viewModel.pinnedSessions}
        pinnedWorkspaces={viewModel.pinnedWorkspaces}
        projectSessionBuckets={viewModel.projectSessionBuckets}
        projectWorkspaces={viewModel.projectWorkspaces}
        projectSort={sidebarProjectSort}
        sessionFallbackTitles={sessionFallbackTitles}
        recentSessions={viewModel.recentSessions}
        sessionSort={sidebarSort}
        manualOrderByScope={sidebarManualOrder}
        unavailableWorkspacePaths={unavailableWorkspacePaths}
        workspace={workspace}
        onArchiveSessions={archiveSessions}
        onChooseWorkspace={onChooseWorkspace}
        onCreateSession={onCreateSession}
        onPinSession={pinSession}
        onPinWorkspace={onPinWorkspace}
        onRemoveWorkspace={(target) => {
          removeCatalogProject(target)
          const key = sidebarPinnedProjectKey(target)
          removePinnedManualOrder([key])
          updateSidebarCustomization((current) => removeItemsFromSections(current, [key]))
          setSidebarManualOrder((current) => ({
            ...current,
            projects: (current.projects ?? []).filter(
              (value) => value !== sidebarProjectKey(target),
            ),
          }))
          onRemoveWorkspace(target)
        }}
        onSelectSession={onSelectSession}
        onToggleSessionUnread={toggleSessionUnread}
        onRenameSession={onRenameSession}
        onUnpinSession={unpinSession}
        onUnpinWorkspace={(target) => {
          removePinnedManualOrder([sidebarPinnedProjectKey(target)])
          onUnpinWorkspace(target)
        }}
        onReport={onReport}
        customSections={viewModel.customSections}
        pinnedSort={sidebarCustomization.pinnedSort}
        onPinnedSortChange={(pinnedSort) =>
          updateSidebarCustomization((current) => ({ ...current, pinnedSort }))
        }
        onManualOrderChange={updateManualOrder}
        onCreateSection={createCustomSection}
        onRenameSection={(sectionId, title) =>
          updateSidebarCustomization((current) => renameSidebarSection(current, sectionId, title))
        }
        onDeleteSection={(sectionId) =>
          updateSidebarCustomization((current) => deleteSidebarSection(current, sectionId))
        }
        onSetSectionCollapsed={(sectionId, collapsed) =>
          updateSidebarCustomization((current) =>
            setSidebarSectionCollapsed(current, sectionId, collapsed),
          )
        }
        onSetSectionSort={(sectionId, sort) =>
          updateSidebarCustomization((current) => setSidebarSectionSort(current, sectionId, sort))
        }
        onReorderSectionItems={(sectionId, keys) =>
          updateSidebarCustomization((current) => setSidebarSectionItems(current, sectionId, keys))
        }
        onMoveItemsToSection={(itemKeys, sectionId, index) => {
          moveItemsToDestination(itemKeys, sectionId, index)
        }}
        onMoveItemsToPinned={(itemKeys, index) => {
          pinItemsToTop(itemKeys, index)
        }}
        onMoveItemsToDefault={(itemKeys) => {
          releaseItemsToDefault(itemKeys)
        }}
        onRestoreItemsToProject={(itemKeys) => {
          releaseItemsToDefault(itemKeys)
        }}
        onMoveSessionToSection={(sessionId, sectionId) =>
          moveItemsToDestination([`session:${sessionId}`], sectionId)
        }
        onMoveSessionToDefault={(sessionId) => releaseItemsToDefault([`session:${sessionId}`])}
        showProjectsInRecents={sidebarCustomization.showProjectsInRecents ?? false}
        onShowProjectsInRecentsChange={(showProjectsInRecents) =>
          updateSidebarCustomization((current) => ({ ...current, showProjectsInRecents }))
        }
        onOrganizationChange={setSidebarOrganization}
        onProjectSortChange={changeChatSort}
        onSessionSortChange={changeChatSort}
        hasUnreadAttention={attentionUnreadSessions.length > 0}
        hasArchivableAttention={archivableAttentionSessions.length > 0}
        onMarkAttentionRead={() => void markAttentionRead()}
        onRequestArchiveAttention={requestArchiveAttention}
      />
      {dockedPanesState && dockedPanesState.tabIds.length > 0 ? (
        <SidebarDockedPanes
          files={workspaceFiles ?? []}
          state={dockedPanesState}
          tabsById={dockedTabsById ?? {}}
          workspace={workspace}
          onAddComposerFiles={onAddComposerFiles}
          onCloseTab={onCloseDockedTab ?? (() => undefined)}
          onMoveTab={onMoveDockedTab ?? (() => undefined)}
          onPopOutTab={onPopOutDockedTab}
          onOpenFile={onOpenFile}
          onSelectTab={onSelectDockedTab ?? (() => undefined)}
        />
      ) : null}
      {archiveAttentionDialogMounted ? (
        <Suspense fallback={null}>
          <ConfirmationDialog
            actionDisabled={archivingAttention}
            actionLabel={
              archivingAttention
                ? '归档中…'
                : archiveAttentionTargets.some(sessionNeedsStop)
                  ? '停止并归档'
                  : '归档聊天'
            }
            description={
              archiveAttentionTargets.some(sessionNeedsStop)
                ? `将停止并归档 ${archiveAttentionTargets.length} 个优先事项聊天。你可以稍后恢复聊天；最近的聊天不会被归档。`
                : `将归档 ${archiveAttentionTargets.length} 个优先事项聊天；最近的聊天不会被归档。`
            }
            open={archiveAttentionOpen}
            title={
              archiveAttentionTargets.some(sessionNeedsStop) ? '停止并归档聊天？' : '归档聊天？'
            }
            tone="danger"
            onAction={() => void confirmArchiveAttention()}
            onCancel={() => setArchiveAttentionOpen(false)}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

function sidebarDisclosureSignature(
  sections: readonly string[],
  projects: readonly string[],
): string {
  return `${sections.join('\u0000')}\u0001${projects.join('\u0000')}`
}
