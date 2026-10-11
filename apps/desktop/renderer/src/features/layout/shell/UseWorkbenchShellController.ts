import type { FileEditorViewState } from '../../editor/FileEditor.js'
import { desktopBrowserClient } from '../../../services/desktop-client/DesktopBrowserClient.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SIDEBAR_MAX_WIDTH, useDesktopLayout } from '../UseDesktopLayout.js'
import {
  applyWorkbenchTabsAction,
  createDefaultWorkbenchTabsState,
  getWorkbenchWorkspaceLayout,
  getWorkspaceView,
  type WorkbenchPanelAction,
  type WorkbenchPanelTarget,
  type MarkdownFileViewMode,
  type WorkbenchTabDescriptor,
  type WorkbenchTabId,
  type WorkbenchTabsState,
  type WorkspaceLayout,
} from '../dock/RightDockState.js'
import { auxiliaryWindowService } from '../auxiliary/AuxiliaryWindowService.js'
import { BUILTIN_COMPOSITE_VIEWS } from '../dock/CompositeViews.js'
import { getWorkbenchTabDisplayTitle } from '../tabs/WorkbenchTabRegistry.js'
import type { OpenPlanInDockRequest } from '../../session/workflow/WorkflowPlanCard.js'
import type { DesktopResizeActivityPhase } from '@pidex/shared/desktop-window-ipc'
import {
  getResizeActivityCoordinator,
  resizeActivityFromLegacy,
} from './ResizeActivityCoordinator.js'
import { useSidebarShellController } from '../SidebarShellState.js'
import { useLiveResizeValue } from '../UseLiveResizeValue.js'
import {
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY,
  BOTTOM_PANEL_MIN_HEIGHT,
  RIGHT_DOCK_MIN_WIDTH,
  RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY,
  bottomPanelHeightFromRatio,
  bottomPanelHeightToRatio,
  clampWorkbenchSize,
  getBottomPanelMaxHeight,
  getResponsiveRightDockDefaultWidth,
  getRightDockMaxWidth,
  resolveRightDockDragLayout,
  rightDockWidthFromRangeRatio,
  rightDockWidthToRangeRatio,
  rightDockWidthToRatio,
  type WorkbenchSize,
} from './WorkbenchLayoutSizing.js'
import {
  applyWorkbenchLayoutAction,
  WORKBENCH_LAYOUT_SCHEMA_VERSION,
  type WorkbenchLayoutAction,
  type WorkbenchLayoutState,
} from './WorkbenchLayoutState.js'

export {
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_MIN_HEIGHT,
  RIGHT_DOCK_MAIN_MIN_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  getResponsiveRightDockDefaultWidth,
  rightDockWidthFromRatio,
  rightDockWidthToRatio,
} from './WorkbenchLayoutSizing.js'

import {
  MODERN_SIDEBAR_DEFAULT_WIDTH,
  MODERN_SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  type SidebarPane,
} from '../sidebar/SidebarNavigation.js'

const NON_NATIVE_RESIZE_SETTLE_MS = 500

export function useWorkbenchShellController({
  activePane,
}: { activePane?: SidebarPane | null } = {}) {
  const railWidth = SIDEBAR_RAIL_WIDTH
  const layout = useDesktopLayout(MODERN_SIDEBAR_DEFAULT_WIDTH)
  const {
    sidebarCollapsed,
    sidebarWidth,
    setSidebarCollapsed,
    setSidebarWidth: setSidebarWidthLegacy,
  } = layout
  const [workbenchPanelState, setWorkbenchPanelState] = useState<WorkbenchTabsState>(
    createDefaultWorkbenchTabsState,
  )
  const workspaceRef = useRef<HTMLDivElement>(null)
  const workspaceMeasuredRef = useRef(false)
  const initSnapshotRef = useRef({
    sidebarCollapsed,
    sidebarWidth,
    rightOpen: workbenchPanelState.right.open,
    bottomOpen: workbenchPanelState.bottom.open,
  })
  const [workspaceSize, setWorkspaceSize] = useState<WorkbenchSize>({
    width: 0,
    height: 0,
  })
  /** 右栏宽度的有效区间比例（分裂态持久值），以及旧 width/W 兼容值。 */
  const [rightDockRangeRatio, setRightDockRangeRatio] = useState<number | null>(null)
  const [rightDockWidthRatio, setRightDockWidthRatio] = useState<number | null>(null)
  const [bottomPanelHeightRatio, setBottomPanelHeightRatio] = useState<number | null>(null)
  const responsiveBottomPanelHeight = bottomPanelHeightFromRatio(
    bottomPanelHeightRatio ?? 0,
    workspaceSize.height,
  )
  /** 拖拽期间的原始指针尺寸；越界判定只读它，松手/取消后回到已提交布局。 */
  const [rightDockDragRaw, setRightDockDragRaw] = useState<number | null>(null)

  const [workbenchLayoutState, setWorkbenchLayoutState] = useState<WorkbenchLayoutState | null>(
    null,
  )

  const workspaceView = getWorkspaceView(workbenchPanelState)
  const committedWorkspaceLayout = getWorkbenchWorkspaceLayout(workbenchPanelState)
  const dragWorkspaceLayout =
    rightDockDragRaw === null ? null : resolveRightDockDragLayout(rightDockDragRaw)
  const workspaceLayout = dragWorkspaceLayout ?? committedWorkspaceLayout

  const displayedSidebarWidth = Math.max(
    MODERN_SIDEBAR_MIN_WIDTH,
    workbenchLayoutState?.primarySidebarWidth ?? sidebarWidth,
  )

  const sidebarShell = useSidebarShellController({
    desktopCollapsed: sidebarCollapsed,
    railWidth,
    activePane,
    setDesktopCollapsed: setSidebarCollapsed,
  })
  const rightDockState = workbenchPanelState.right
  const bottomPanelState = workbenchPanelState.bottom
  const rightDockVisible = workspaceLayout !== 'chat'
  const rightDockMaxWidth = getRightDockMaxWidth(workspaceSize.width)
  const bottomPanelMaxHeight = getBottomPanelMaxHeight(workspaceSize.height)

  const splitRightDockWidth =
    rightDockRangeRatio !== null && workspaceSize.width > 0
      ? rightDockWidthFromRangeRatio(rightDockRangeRatio, workspaceSize.width)
      : (workbenchLayoutState?.auxiliaryPanelWidth ?? RIGHT_DOCK_MIN_WIDTH)
  const rightDockWidth = splitRightDockWidth
  const rightPanelCommittedSize = rightDockWidth
  const bottomPanelHeight = workbenchLayoutState?.bottomPanelHeight ?? responsiveBottomPanelHeight

  // 右栏隐藏时宿主仍保留挂载：实时尺寸必须收敛到 0，否则空白按分屏宽度占位。
  const rightPanelLiveResize = useLiveResizeValue(rightPanelCommittedSize, !rightDockVisible)
  const bottomPanelLiveResize = useLiveResizeValue(bottomPanelHeight)

  const latestWorkspaceSizeRef = useRef<WorkbenchSize>(workspaceSize)
  const rightDockRangeRatioRef = useRef(rightDockRangeRatio)
  const bottomPanelHeightRatioRef = useRef(bottomPanelHeightRatio)
  const workspaceLayoutRef = useRef(workspaceLayout)
  const previousWorkspaceLayoutRef = useRef(workspaceLayout)
  const dragLayoutRef = useRef<WorkspaceLayout | null>(dragWorkspaceLayout)
  const rightDockVisibleRef = useRef(rightDockVisible)
  const rightDockStateRef = useRef(rightDockState)
  const rightPanelLiveResizeRef = useRef(rightPanelLiveResize)
  const bottomPanelLiveResizeRef = useRef(bottomPanelLiveResize)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleFrameRef = useRef<number | null>(null)
  const resizeActivityCoordinator = getResizeActivityCoordinator()

  rightDockRangeRatioRef.current = rightDockRangeRatio
  bottomPanelHeightRatioRef.current = bottomPanelHeightRatio
  workspaceLayoutRef.current = workspaceLayout
  dragLayoutRef.current = dragWorkspaceLayout
  rightDockVisibleRef.current = rightDockVisible
  rightDockStateRef.current = rightDockState
  rightPanelLiveResizeRef.current = rightPanelLiveResize
  bottomPanelLiveResizeRef.current = bottomPanelLiveResize

  const collapseSidebar = useCallback((): void => {
    setSidebarCollapsed(true)
  }, [setSidebarCollapsed])

  const dispatchPanelAction = useCallback((action: WorkbenchPanelAction): void => {
    setWorkbenchPanelState((current) => {
      const tab = 'tabId' in action ? current.tabsById[action.tabId] : undefined
      if (
        tab?.kind === 'browser' &&
        ((action.type === 'moveTab' && action.target === 'sidebar') || action.type === 'popOutTab')
      )
        return current
      const next = applyWorkbenchTabsAction(current, action)
      if (
        tab?.kind === 'browser' &&
        (action.type === 'moveTab' || action.type === 'reorderTab' || action.type === 'openTab')
      ) {
        const panel = next.bottom.tabIds.includes(tab.id) ? 'bottom' : 'right'
        void desktopBrowserClient
          .forTab(tab.tabId)
          .layout(panel, next[panel].tabIds.indexOf(tab.id))
          .catch(() => {})
      }
      return next
    })
  }, [])

  const dispatchLayoutAction = useCallback((action: WorkbenchLayoutAction): void => {
    setWorkbenchLayoutState((current) =>
      current != null ? applyWorkbenchLayoutAction(current, action) : current,
    )
  }, [])

  const setWorkspaceLayout = useCallback((layout: WorkspaceLayout): void => {
    setWorkbenchPanelState((current) =>
      applyWorkbenchTabsAction(current, { type: 'setWorkspaceLayout', layout }),
    )
  }, [])

  const stepWorkspaceLayout = useCallback((): void => {
    setWorkbenchPanelState((current) =>
      applyWorkbenchTabsAction(current, { type: 'stepWorkspaceLayout' }),
    )
  }, [])

  const moveRightDockFocusToMain = useCallback((): void => {
    const activeElement = document.activeElement
    if (
      !(activeElement instanceof HTMLElement) ||
      !activeElement.closest('[data-app-shell-tab-panel-controller="right"]')
    )
      return
    activeElement.blur()
    dispatchPanelAction({ type: 'focusPanel', target: 'main' })
  }, [dispatchPanelAction])

  const openPanelTab = useCallback(
    (
      target: WorkbenchPanelTarget,
      tab: WorkbenchTabDescriptor,
      index?: number,
      options: { reveal?: boolean } = {},
    ): void => {
      dispatchPanelAction({ type: 'openTab', target, tab, index, reveal: options.reveal })
    },
    [dispatchPanelAction],
  )

  const openRightDockTab = useCallback(
    (tab: WorkbenchTabDescriptor): void => {
      openPanelTab('right', tab)
    },
    [openPanelTab],
  )

  const selectPanelTab = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      dispatchPanelAction({ type: 'selectTab', target, tabId })
    },
    [dispatchPanelAction],
  )

  const closePanelTab = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      dispatchPanelAction({ type: 'closeTab', target, tabId })
    },
    [dispatchPanelAction],
  )

  const togglePanel = useCallback((target: WorkbenchPanelTarget): void => {
    setWorkbenchPanelState((current) => {
      const opening = target === 'right' ? !current.right.open : !current[target].open
      const next = applyWorkbenchTabsAction(current, { type: 'togglePanel', target })
      if (opening) {
        focusPanelController(target)
      }
      return next
    })
  }, [])

  const closePanel = useCallback(
    (target: WorkbenchPanelTarget): void => {
      dispatchPanelAction({ type: 'closePanel', target })
    },
    [dispatchPanelAction],
  )

  const movePanelTab = useCallback(
    (
      source: WorkbenchPanelTarget,
      target: WorkbenchPanelTarget,
      tabId: WorkbenchTabId,
      index?: number,
    ): void => {
      if (target === 'sidebar' && sidebarCollapsed) {
        setSidebarCollapsed(false)
      }
      dispatchPanelAction({ type: 'moveTab', source, target, tabId, index })
    },
    [dispatchPanelAction, setSidebarCollapsed, sidebarCollapsed],
  )

  const popOutPanelTab = useCallback(
    (source: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      const tab = workbenchPanelState.tabsById[tabId]
      if (tab?.kind === 'browser') return
      const title = tab ? getWorkbenchTabDisplayTitle(tab, null) : 'Pidex Desktop'
      const entry = auxiliaryWindowService.open(tabId, title)
      if (entry) {
        dispatchPanelAction({ type: 'popOutTab', source, tabId })
      }
    },
    [dispatchPanelAction, workbenchPanelState.tabsById],
  )

  const dockBackPanelTab = useCallback(
    (tabId: WorkbenchTabId, target?: WorkbenchPanelTarget): void => {
      const tab = workbenchPanelState.tabsById[tabId]
      const definition = tab ? BUILTIN_COMPOSITE_VIEWS[tab.kind] : undefined
      const resolvedTarget =
        target ??
        ((definition?.defaultLocation !== 'floating' && definition?.defaultLocation
          ? definition.defaultLocation
          : 'right') as WorkbenchPanelTarget)
      auxiliaryWindowService.close(tabId)
      dispatchPanelAction({ type: 'dockBackTab', target: resolvedTarget, tabId })
    },
    [dispatchPanelAction, workbenchPanelState.tabsById],
  )

  useEffect(() => {
    auxiliaryWindowService.setDockBackHandler((tabId) => {
      dockBackPanelTab(tabId)
    })
  }, [dockBackPanelTab])

  const reorderPanelTab = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId, index: number): void => {
      dispatchPanelAction({ type: 'reorderTab', target, tabId, index })
    },
    [dispatchPanelAction],
  )

  const closeOtherTabs = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      dispatchPanelAction({ type: 'closeOtherTabs', target, tabId })
    },
    [dispatchPanelAction],
  )

  const closeTabsToRight = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      dispatchPanelAction({ type: 'closeTabsToRight', target, tabId })
    },
    [dispatchPanelAction],
  )

  const pinTab = useCallback(
    (tabId: WorkbenchTabId): void => {
      dispatchPanelAction({ type: 'pinTab', tabId })
    },
    [dispatchPanelAction],
  )

  const setFileViewState = useCallback(
    (tabId: WorkbenchTabId, viewState: FileEditorViewState): void => {
      dispatchPanelAction({ type: 'setFileViewState', tabId, viewState })
    },
    [dispatchPanelAction],
  )

  const setFileMarkdownViewMode = useCallback(
    (tabId: WorkbenchTabId, mode: MarkdownFileViewMode): void => {
      dispatchPanelAction({ type: 'setFileMarkdownViewMode', tabId, mode })
    },
    [dispatchPanelAction],
  )

  const commitRightDockRangeRatio = useCallback(
    (nextRatio: number): void => {
      setRightDockRangeRatio(nextRatio)
      const legacyRatio = rightDockWidthToRatio(
        rightDockWidthFromRangeRatio(nextRatio, workspaceSize.width),
        workspaceSize.width,
      )
      setRightDockWidthRatio(legacyRatio)
      window.localStorage.setItem(RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY, String(legacyRatio))
    },
    [workspaceSize.width],
  )

  const commitBottomPanelHeightRatio = useCallback((nextRatio: number): void => {
    setBottomPanelHeightRatio(nextRatio)
    window.localStorage.setItem(BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY, String(nextRatio))
  }, [])

  const handleSetRightDockWidth = useCallback(
    (nextWidth: number): void => {
      const clampedWidth = clampRightDockWidth(nextWidth, workspaceSize.width)
      commitRightDockRangeRatio(rightDockWidthToRangeRatio(clampedWidth, workspaceSize.width))
      dispatchLayoutAction({
        type: 'commitAuxiliaryPanelSize',
        size: clampedWidth,
        workspaceWidth: workspaceSize.width,
      })
    },
    [commitRightDockRangeRatio, dispatchLayoutAction, workspaceSize.width],
  )

  /** 拖拽期间只有分屏需要宽度预览；仅聊天时不占宽度。 */
  const resolveRightDockResizePreview = useCallback((nextSize: number | null): void => {
    if (nextSize === null) {
      rightPanelLiveResizeRef.current.previewSize(null)
      return
    }
    if (dragLayoutRef.current === 'split') {
      rightPanelLiveResizeRef.current.previewSize(nextSize)
    }
  }, [])

  const handleRightDockResizeRaw = useCallback((rawSize: number | null): void => {
    setRightDockDragRaw(rawSize)
  }, [])

  /**
   * 松手结算：分屏写回有效尺寸；隐藏内容只提交布局，不覆盖此前的
   * split 尺寸，也不在存储里留下越界值。
   */
  const resolveRightDockResizeCommit = useCallback((rawSize: number): boolean => {
    const layout = resolveRightDockDragLayout(rawSize)
    if (layout === 'split') return true
    setWorkbenchPanelState((current) =>
      applyWorkbenchTabsAction(current, { type: 'setWorkspaceLayout', layout }),
    )
    return false
  }, [])

  const handleResetRightDockWidth = useCallback((): void => {
    const defaultWidth = getResponsiveRightDockDefaultWidth(
      workspaceSize.width,
      workspaceSize.height,
    )
    commitRightDockRangeRatio(rightDockWidthToRangeRatio(defaultWidth, workspaceSize.width))
    dispatchLayoutAction({
      type: 'commitAuxiliaryPanelSize',
      size: defaultWidth,
      workspaceWidth: workspaceSize.width,
    })
  }, [commitRightDockRangeRatio, dispatchLayoutAction, workspaceSize.height, workspaceSize.width])

  const handleSetBottomPanelHeight = useCallback(
    (nextHeight: number): void => {
      const nextRatio = bottomPanelHeightToRatio(nextHeight, workspaceSize.height)
      commitBottomPanelHeightRatio(nextRatio)
      dispatchLayoutAction({
        type: 'commitBottomPanelSize',
        size: nextHeight,
        workspaceHeight: workspaceSize.height,
      })
    },
    [commitBottomPanelHeightRatio, dispatchLayoutAction, workspaceSize.height],
  )

  const handleResetBottomPanelHeight = useCallback((): void => {
    commitBottomPanelHeightRatio(
      bottomPanelHeightToRatio(BOTTOM_PANEL_DEFAULT_HEIGHT, workspaceSize.height),
    )
    dispatchLayoutAction({
      type: 'commitBottomPanelSize',
      size: BOTTOM_PANEL_DEFAULT_HEIGHT,
      workspaceHeight: workspaceSize.height,
    })
  }, [commitBottomPanelHeightRatio, dispatchLayoutAction, workspaceSize.height])

  const handleOpenPlanDock = useCallback(
    (plan: OpenPlanInDockRequest): void => {
      // 计划未生成完成时不允许在右栏打开：tab 内容取自打开瞬间的快照，流式
      // 期间打开会冻结半成品。这是所有 renderer 打开路径的唯一汇聚点。
      if (!plan.openable) return
      openRightDockTab({
        id: `plan:${plan.eventId}`,
        kind: 'plan',
        eventId: plan.eventId,
        title: plan.title,
        content: plan.content,
      })
    },
    [openRightDockTab],
  )

  const setSidebarWidth = useCallback(
    (width: number): void => {
      setSidebarWidthLegacy(width)
      dispatchLayoutAction({ type: 'commitPrimarySidebarSize', size: width })
    },
    [setSidebarWidthLegacy, dispatchLayoutAction],
  )

  const toggleSidebarCollapsed = useCallback((): void => {
    sidebarShell.toggle()
  }, [sidebarShell.toggle])

  useEffect(() => {
    const workspaceElement = workspaceRef.current
    if (!workspaceElement) return
    let disposed = false

    const clearPendingSettlement = (): void => {
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
      if (settleFrameRef.current !== null) {
        cancelAnimationFrame(settleFrameRef.current)
        settleFrameRef.current = null
      }
    }

    const commitWorkspaceSize = (): void => {
      if (disposed) return
      const bounds = workspaceElement.getBoundingClientRect()
      if (bounds.width > 0 && bounds.height > 0) {
        latestWorkspaceSizeRef.current = {
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        }
      }
      const finalSize = latestWorkspaceSizeRef.current
      if (finalSize.width <= 0 || finalSize.height <= 0) return

      const finalRightRangeRatio = rightDockRangeRatioRef.current
      const finalBottomRatio = bottomPanelHeightRatioRef.current
      const finalRightDockWidth =
        finalRightRangeRatio !== null
          ? rightDockWidthFromRangeRatio(finalRightRangeRatio, finalSize.width)
          : undefined
      const finalBottomHeight =
        finalBottomRatio !== null
          ? bottomPanelHeightFromRatio(finalBottomRatio, finalSize.height)
          : undefined

      setWorkspaceSize(finalSize)
      setWorkbenchLayoutState((current) => {
        if (current == null) return current
        let next = current
        if (finalRightDockWidth !== undefined && finalRightDockWidth !== next.auxiliaryPanelWidth) {
          next = applyWorkbenchLayoutAction(next, {
            type: 'commitAuxiliaryPanelSize',
            size: finalRightDockWidth,
            workspaceWidth: finalSize.width,
          })
        }
        if (finalBottomHeight !== undefined && finalBottomHeight !== next.bottomPanelHeight) {
          next = applyWorkbenchLayoutAction(next, {
            type: 'commitBottomPanelSize',
            size: finalBottomHeight,
            workspaceHeight: finalSize.height,
          })
        }
        const targetRightVisible = workspaceLayoutRef.current !== 'chat'
        if (next.visibility.auxiliaryPanel !== targetRightVisible) {
          next = {
            ...next,
            visibility: {
              ...next.visibility,
              auxiliaryPanel: targetRightVisible,
            },
          }
        }
        return next
      })
      rightPanelLiveResizeRef.current.previewSize(null)
      bottomPanelLiveResizeRef.current.previewSize(null)
    }

    const settleOnNextFrame = (): void => {
      clearPendingSettlement()
      settleFrameRef.current = requestAnimationFrame(() => {
        settleFrameRef.current = null
        commitWorkspaceSize()
      })
    }

    const scheduleFallbackSettlement = (): void => {
      clearPendingSettlement()
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null
        settleOnNextFrame()
      }, NON_NATIVE_RESIZE_SETTLE_MS)
    }

    const initializeWorkspace = (): void => {
      workspaceMeasuredRef.current = true
      const captured = initSnapshotRef.current
      void import('./WorkbenchLayoutStorage.js').then((module) => {
        if (disposed) return
        const initialSize = latestWorkspaceSizeRef.current
        if (initialSize.width <= 0 || initialSize.height <= 0) return
        const [rightRatio, bottomRatio] = module.default(initialSize.width, initialSize.height)
        bottomPanelHeightRatioRef.current = bottomRatio
        setRightDockWidthRatio(rightRatio)
        setBottomPanelHeightRatio(bottomRatio)

        const snapshot = module.readWorkbenchLayoutSnapshot({
          workspaceWidth: initialSize.width,
          workspaceHeight: initialSize.height,
          sidebarCollapsed: captured.sidebarCollapsed,
          sidebarWidth:
            captured.sidebarWidth ?? Math.min(520, Math.max(240, initialSize.width * 0.2)),
          rightDockRatio: rightRatio,
          bottomPanelRatio: bottomRatio,
        })
        const rangeRatio =
          snapshot.auxiliaryPanelWidthRangeRatio ??
          rightDockWidthToRangeRatio(snapshot.auxiliaryPanelWidth, initialSize.width)
        rightDockRangeRatioRef.current = rangeRatio
        setRightDockRangeRatio(rangeRatio)
        // 主导航折叠偏好由既有 sidebar 状态决定。
        const initialState: WorkbenchLayoutState = {
          visibility: {
            primarySidebar: !captured.sidebarCollapsed,
            mainContent: true,
            auxiliaryPanel: captured.rightOpen,
            bottomPanel: captured.bottomOpen,
          },
          primarySidebarWidth: snapshot.primarySidebarWidth,
          auxiliaryPanelWidth: snapshot.auxiliaryPanelWidth,
          auxiliaryPanelWidthRangeRatio: rangeRatio,
          bottomPanelHeight: snapshot.bottomPanelHeight,
          auxiliaryMaximized: false,
          beforeAuxiliaryMaximized: null,
          beforeAuxiliaryMaximizedAuxiliaryWidth: null,
        }
        setWorkspaceSize(initialSize)
        setWorkbenchLayoutState(initialState)
      })
    }

    const updateWorkspaceSize = (width: number, height: number): void => {
      if (width <= 0 || height <= 0) return
      const nextSize = {
        width: Math.round(width),
        height: Math.round(height),
      }
      latestWorkspaceSizeRef.current = nextSize
      if (!workspaceMeasuredRef.current) {
        initializeWorkspace()
        return
      }

      const currentRightRangeRatio = rightDockRangeRatioRef.current
      const currentBottomRatio = bottomPanelHeightRatioRef.current
      const liveRightDockWidth =
        currentRightRangeRatio !== null
          ? rightDockWidthFromRangeRatio(currentRightRangeRatio, nextSize.width)
          : null
      const liveBottomPanelHeight =
        currentBottomRatio !== null
          ? bottomPanelHeightFromRatio(currentBottomRatio, nextSize.height)
          : null
      if (liveRightDockWidth !== null) {
        rightPanelLiveResizeRef.current.previewSize(liveRightDockWidth)
      }
      if (liveBottomPanelHeight !== null) {
        bottomPanelLiveResizeRef.current.previewSize(liveBottomPanelHeight)
      }
      if (!resizeActivityCoordinator.isResizing()) scheduleFallbackSettlement()
    }

    // 原生缩放状态统一进入 resizeActivityCoordinator（按窗口 + revision + 看门狗），
    // 终端等其他消费者读取同一份状态，不再共用一个易失布尔值。
    const handleResizePhase = (phase: DesktopResizeActivityPhase): void => {
      if (phase === 'start') {
        clearPendingSettlement()
        return
      }
      settleOnNextFrame()
    }
    let legacyRevision = 0
    const bridge = window.DesktopBridge
    const unsubscribeResizeState =
      bridge?.onWindowResizeActivity?.((activity) => {
        resizeActivityCoordinator.applyNativeActivity(activity)
        handleResizePhase(activity.phase)
      }) ??
      bridge?.onWindowResizeStateChanged?.((resizing) => {
        // 旧版 Electron 只有布尔信号：合成带 revision 的活动事件，保持同等行为。
        legacyRevision += 1
        resizeActivityCoordinator.applyNativeActivity(
          resizeActivityFromLegacy(resizing, legacyRevision),
        )
        handleResizePhase(resizing ? 'start' : 'end')
      })
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        updateWorkspaceSize(entry.contentRect.width, entry.contentRect.height)
      }
    })
    observer.observe(workspaceElement)
    return () => {
      disposed = true
      // 卸载后不再有原生事件：清空状态，避免其他消费者永久停留在降载。
      resizeActivityCoordinator.reset()
      unsubscribeResizeState?.()
      observer.disconnect()
      clearPendingSettlement()
    }
  }, [moveRightDockFocusToMain])

  useEffect(() => {
    if (workspaceMeasuredRef.current) return
    initSnapshotRef.current = {
      sidebarCollapsed,
      sidebarWidth,
      rightOpen: rightDockState.open,
      bottomOpen: bottomPanelState.open,
    }
  }, [sidebarCollapsed, sidebarWidth, rightDockState.open, bottomPanelState.open])

  // 布局展示由 workspaceView 决定；这里只把同一份事实镜像进持久化快照的可见集合。
  useEffect(() => {
    if (workbenchLayoutState == null) return

    setWorkbenchLayoutState((current) => {
      if (current == null) return current
      const targetAuxVisible = rightDockVisible
      const targetBottomVisible = bottomPanelState.open
      const targetPrimaryVisible = !sidebarCollapsed

      if (
        current.visibility.auxiliaryPanel === targetAuxVisible &&
        current.visibility.bottomPanel === targetBottomVisible &&
        current.visibility.primarySidebar === targetPrimaryVisible &&
        current.visibility.mainContent === true
      ) {
        return current
      }

      return {
        ...current,
        visibility: {
          ...current.visibility,
          auxiliaryPanel: targetAuxVisible,
          bottomPanel: targetBottomVisible,
          primarySidebar: targetPrimaryVisible,
          mainContent: true,
        },
      }
    })
  }, [rightDockVisible, bottomPanelState.open, sidebarCollapsed, workbenchLayoutState])

  useEffect(() => {
    const previous = previousWorkspaceLayoutRef.current
    if (previous === workspaceLayout) return
    previousWorkspaceLayoutRef.current = workspaceLayout
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    const inChat = active.closest('#desktop-main-content') !== null
    const inContent = active.closest('[data-app-shell-tab-panel-controller="right"]') !== null
    if (!inChat && !inContent) return
    // 先把即将隐藏的一侧焦点移走，再切换布局：隐藏内容后回到聊天输入框。
    if (inChat) focusPanelController('right')
    else focusConversationComposer()
  }, [workspaceLayout])

  useEffect(() => {
    if (workbenchLayoutState == null) return
    void import('./WorkbenchLayoutStorage.js').then((module) => {
      module.saveWorkbenchLayoutSnapshot(
        {
          schemaVersion: WORKBENCH_LAYOUT_SCHEMA_VERSION,
          visibility: workbenchLayoutState.visibility,
          primarySidebarWidth: workbenchLayoutState.primarySidebarWidth,
          auxiliaryPanelWidth: workbenchLayoutState.auxiliaryPanelWidth,
          auxiliaryPanelWidthRangeRatio: workbenchLayoutState.auxiliaryPanelWidthRangeRatio,
          bottomPanelHeight: workbenchLayoutState.bottomPanelHeight,
          auxiliaryMaximized: workbenchLayoutState.auxiliaryMaximized,
          beforeAuxiliaryMaximized: workbenchLayoutState.beforeAuxiliaryMaximized,
          beforeAuxiliaryMaximizedAuxiliaryWidth:
            workbenchLayoutState.beforeAuxiliaryMaximizedAuxiliaryWidth,
        },
        { storage: window.localStorage },
      )
    })
  }, [workbenchLayoutState])

  return {
    sidebarCollapsed,
    sidebarWidth: displayedSidebarWidth,
    setSidebarWidth,
    toggleSidebarCollapsed,
    collapseSidebar,
    sidebarShell,
    sidebarMinWidth: MODERN_SIDEBAR_MIN_WIDTH,
    sidebarMaxWidth: SIDEBAR_MAX_WIDTH,
    workbenchPanelState,
    setWorkbenchPanelState,
    workspaceView,
    workspaceLayout,
    committedWorkspaceLayout,
    setWorkspaceLayout,
    stepWorkspaceLayout,
    rightDockState,
    bottomPanelState,
    bottomPanelVisible: workbenchLayoutState?.visibility.bottomPanel ?? bottomPanelState.open,
    workspaceRef,
    workspaceWidth: workspaceSize.width,
    rightDockVisible,
    rightDockMinWidth: RIGHT_DOCK_MIN_WIDTH,
    rightDockMaxWidth,
    rightDockWidth,
    rightPanelCommittedSize,
    rightPanelLiveResize,
    rightDockDragRaw,
    handleRightDockResizeRaw,
    handleRightDockResizePreview: resolveRightDockResizePreview,
    shouldCommitRightDockResize: resolveRightDockResizeCommit,
    bottomPanelMinHeight: BOTTOM_PANEL_MIN_HEIGHT,
    bottomPanelMaxHeight,
    bottomPanelHeight,
    bottomPanelLiveResize,
    openRightDockTab,
    openPanelTab,
    selectPanelTab,
    closePanelTab,
    handleSetRightDockWidth,
    handleResetRightDockWidth,
    handleSetBottomPanelHeight,
    handleResetBottomPanelHeight,
    handleOpenPlanDock,
    toggleBottomPanelVisible: () => togglePanel('bottom'),
    togglePanel,
    closePanel,
    movePanelTab,
    popOutPanelTab,
    dockBackPanelTab,
    reorderPanelTab,
    closeOtherTabs,
    closeTabsToRight,
    pinTab,
    setFileMarkdownViewMode,
    setFileViewState,
    workbenchLayoutState,
  }
}

function clampRightDockWidth(width: number, workspaceWidth: number): number {
  return clampWorkbenchSize(width, RIGHT_DOCK_MIN_WIDTH, getRightDockMaxWidth(workspaceWidth))
}

function focusPanelController(target: WorkbenchPanelTarget): void {
  let attempts = 0
  const focusWhenMounted = (): void => {
    const controller = document.querySelector<HTMLElement>(
      `[data-app-shell-tab-panel-controller="${target}"]`,
    )
    if (controller) {
      controller.focus({ preventScroll: true })
      return
    }
    if (attempts++ < 60) requestAnimationFrame(focusWhenMounted)
  }
  requestAnimationFrame(focusWhenMounted)
}

/** 隐藏右侧内容后把焦点交还聊天输入框；输入框尚未挂载时退回聊天区域。 */
function focusConversationComposer(): void {
  const composer = document.querySelector<HTMLElement>(
    '#desktop-main-content .composer-editor [contenteditable="true"]',
  )
  if (composer) composer.focus({ preventScroll: true })
  else document.getElementById('desktop-main-content')?.focus({ preventScroll: true })
}
