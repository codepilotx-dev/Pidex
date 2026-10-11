import {
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_MIN_HEIGHT,
  DEFAULT_PRIMARY_SIDEBAR_WIDTH,
  RIGHT_DOCK_DEFAULT_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  clampPrimarySidebarWidth,
  clampWorkbenchSize,
  getBottomPanelMaxHeight,
  getRightDockMaxWidth,
  rightDockWidthToRangeRatio,
} from './WorkbenchLayoutSizing.js'

export const WORKBENCH_LAYOUT_SCHEMA_VERSION = 1
export const WORKBENCH_LAYOUT_STORAGE_KEY = 'pidex.desktop.workbenchLayout.v1'

export type WorkbenchPartId =
  'primary-sidebar' | 'main-content' | 'auxiliary-panel' | 'bottom-panel'

export type WorkbenchPartVisibility = {
  primarySidebar: boolean
  mainContent: boolean
  auxiliaryPanel: boolean
  bottomPanel: boolean
}

export type WorkbenchLayoutState = {
  visibility: WorkbenchPartVisibility
  primarySidebarWidth: number
  auxiliaryPanelWidth: number
  /** 右栏宽度在有效区间内的位置，跨工作区宽度变化时优先于像素宽度。 */
  auxiliaryPanelWidthRangeRatio: number | null
  bottomPanelHeight: number
  auxiliaryMaximized: boolean
  beforeAuxiliaryMaximized: WorkbenchPartVisibility | null
  beforeAuxiliaryMaximizedAuxiliaryWidth: number | null
}

export type WorkbenchLayoutSnapshot = WorkbenchLayoutState & {
  schemaVersion: typeof WORKBENCH_LAYOUT_SCHEMA_VERSION
}

export type WorkbenchLayoutAction =
  | {
      type: 'setVisibility'
      part: WorkbenchPartId
      visible: boolean
    }
  | {
      type: 'commitPrimarySidebarSize'
      size: number
    }
  | {
      type: 'commitAuxiliaryPanelSize'
      size: number
      workspaceWidth: number
    }
  | {
      type: 'commitBottomPanelSize'
      size: number
      workspaceHeight: number
    }
  | { type: 'enterAuxiliaryMaximized' }
  | { type: 'exitAuxiliaryMaximized' }

const PART_KEY_MAP: Record<WorkbenchPartId, keyof WorkbenchPartVisibility> = {
  'primary-sidebar': 'primarySidebar',
  'main-content': 'mainContent',
  'auxiliary-panel': 'auxiliaryPanel',
  'bottom-panel': 'bottomPanel',
}

export function createDefaultWorkbenchLayoutState(
  workspaceWidth: number,
  workspaceHeight: number,
): WorkbenchLayoutState {
  const auxiliaryPanelWidth = clampAuxiliaryPanelWidth(RIGHT_DOCK_DEFAULT_WIDTH, workspaceWidth)
  return {
    visibility: createDefaultVisibility(),
    primarySidebarWidth: clampPrimarySidebarWidth(DEFAULT_PRIMARY_SIDEBAR_WIDTH),
    auxiliaryPanelWidth,
    auxiliaryPanelWidthRangeRatio: rightDockWidthToRangeRatio(auxiliaryPanelWidth, workspaceWidth),
    bottomPanelHeight: clampBottomPanelHeight(BOTTOM_PANEL_DEFAULT_HEIGHT, workspaceHeight),
    auxiliaryMaximized: false,
    beforeAuxiliaryMaximized: null,
    beforeAuxiliaryMaximizedAuxiliaryWidth: null,
  }
}

export function createDefaultVisibility(): WorkbenchPartVisibility {
  return {
    primarySidebar: true,
    mainContent: true,
    auxiliaryPanel: true,
    bottomPanel: false,
  }
}

export function applyWorkbenchLayoutAction(
  state: WorkbenchLayoutState,
  action: WorkbenchLayoutAction,
): WorkbenchLayoutState {
  switch (action.type) {
    case 'setVisibility':
      return reduceSetVisibility(state, action.part, action.visible)
    case 'commitPrimarySidebarSize':
      return reduceCommitPrimarySidebarSize(state, action.size)
    case 'commitAuxiliaryPanelSize':
      return reduceCommitAuxiliaryPanelSize(state, action.size, action.workspaceWidth)
    case 'commitBottomPanelSize':
      return reduceCommitBottomPanelSize(state, action.size, action.workspaceHeight)
    case 'enterAuxiliaryMaximized':
      return reduceEnterAuxiliaryMaximized(state)
    case 'exitAuxiliaryMaximized':
      return reduceExitAuxiliaryMaximized(state)
  }
}

function reduceSetVisibility(
  state: WorkbenchLayoutState,
  part: WorkbenchPartId,
  visible: boolean,
): WorkbenchLayoutState {
  // main-content 永远不脱离辅助栏最大化事务；普通态下任何关闭请求都必须被忽略，
  // 由 enterAuxiliaryMaximized 独占切换到 false。
  if (part === 'main-content' && !visible && !state.auxiliaryMaximized) {
    return state
  }
  if (part === 'auxiliary-panel' && !visible && state.auxiliaryMaximized) {
    const restored = state.beforeAuxiliaryMaximized ?? createDefaultVisibility()
    return {
      ...state,
      visibility: {
        ...restored,
        auxiliaryPanel: false,
        mainContent: true,
      },
      auxiliaryMaximized: false,
      beforeAuxiliaryMaximized: null,
      beforeAuxiliaryMaximizedAuxiliaryWidth: null,
    }
  }
  const key = PART_KEY_MAP[part]
  return {
    ...state,
    visibility: { ...state.visibility, [key]: visible },
  }
}

function reduceCommitPrimarySidebarSize(
  state: WorkbenchLayoutState,
  size: number,
): WorkbenchLayoutState {
  return {
    ...state,
    primarySidebarWidth: clampPrimarySidebarWidth(size),
  }
}

function reduceCommitAuxiliaryPanelSize(
  state: WorkbenchLayoutState,
  size: number,
  workspaceWidth: number,
): WorkbenchLayoutState {
  const auxiliaryPanelWidth = clampAuxiliaryPanelWidth(size, workspaceWidth)
  return {
    ...state,
    auxiliaryPanelWidth,
    auxiliaryPanelWidthRangeRatio: rightDockWidthToRangeRatio(auxiliaryPanelWidth, workspaceWidth),
  }
}

function reduceCommitBottomPanelSize(
  state: WorkbenchLayoutState,
  size: number,
  workspaceHeight: number,
): WorkbenchLayoutState {
  return {
    ...state,
    bottomPanelHeight: clampBottomPanelHeight(size, workspaceHeight),
  }
}

function reduceEnterAuxiliaryMaximized(state: WorkbenchLayoutState): WorkbenchLayoutState {
  if (state.auxiliaryMaximized) return state
  return {
    ...state,
    visibility: {
      primarySidebar: false,
      mainContent: false,
      auxiliaryPanel: true,
      bottomPanel: false,
    },
    auxiliaryMaximized: true,
    beforeAuxiliaryMaximized: { ...state.visibility },
    beforeAuxiliaryMaximizedAuxiliaryWidth: state.auxiliaryPanelWidth,
  }
}

function reduceExitAuxiliaryMaximized(state: WorkbenchLayoutState): WorkbenchLayoutState {
  if (!state.auxiliaryMaximized) return state
  const restored = state.beforeAuxiliaryMaximized ?? createDefaultVisibility()
  const restoredWidth = state.beforeAuxiliaryMaximizedAuxiliaryWidth ?? state.auxiliaryPanelWidth
  return {
    ...state,
    visibility: restored,
    auxiliaryPanelWidth: restoredWidth,
    auxiliaryMaximized: false,
    beforeAuxiliaryMaximized: null,
    beforeAuxiliaryMaximizedAuxiliaryWidth: null,
  }
}

export function clampAuxiliaryPanelWidth(size: number, workspaceWidth: number): number {
  return clampWorkbenchSize(size, RIGHT_DOCK_MIN_WIDTH, getRightDockMaxWidth(workspaceWidth))
}

export function clampBottomPanelHeight(size: number, workspaceHeight: number): number {
  return clampWorkbenchSize(size, BOTTOM_PANEL_MIN_HEIGHT, getBottomPanelMaxHeight(workspaceHeight))
}

export { clampPrimarySidebarWidth }
