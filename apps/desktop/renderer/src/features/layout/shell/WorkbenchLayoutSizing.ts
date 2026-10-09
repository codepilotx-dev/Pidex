import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth as clampPrimarySidebarWidth,
} from '../UseDesktopLayout.js'

export const PRIMARY_SIDEBAR_MIN_WIDTH = SIDEBAR_MIN_WIDTH
export const PRIMARY_SIDEBAR_MAX_WIDTH = SIDEBAR_MAX_WIDTH
export const DEFAULT_PRIMARY_SIDEBAR_WIDTH = DEFAULT_SIDEBAR_WIDTH
export { clampPrimarySidebarWidth }

export const RIGHT_DOCK_MIN_WIDTH = 320
export const RIGHT_DOCK_MAIN_MIN_WIDTH = 352
export const RIGHT_DOCK_DEFAULT_WIDTH = 600
/** 越界拖拽把内容收成隐藏的原始宽度阈值。 */
export const RIGHT_DOCK_HIDE_THRESHOLD = 160

export const BOTTOM_PANEL_MIN_HEIGHT = 160
export const BOTTOM_PANEL_DEFAULT_HEIGHT = 220
export const BOTTOM_PANEL_UPPER_MIN_HEIGHT = 240

export const RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY = 'pidex.desktop.rightDockWidthRatio.v2'
export const BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY = 'pidex.desktop.bottomPanelHeightRatio.v3'
export interface WorkbenchSize {
  width: number
  height: number
}

export function rightDockWidthFromRatio(ratio: number, workspaceWidth: number): number {
  const safeWorkspaceWidth = normalizeDimension(workspaceWidth)
  const preferredWidth = safeWorkspaceWidth * clampUnitInterval(ratio)
  return Math.round(
    clamp(preferredWidth, RIGHT_DOCK_MIN_WIDTH, getRightDockMaxWidth(safeWorkspaceWidth)),
  )
}

export function rightDockWidthToRatio(width: number, workspaceWidth: number): number {
  const safeWorkspaceWidth = normalizeDimension(workspaceWidth)
  if (safeWorkspaceWidth === 0) return 0
  const safeWidth = Number.isFinite(width) ? width : RIGHT_DOCK_DEFAULT_WIDTH
  return clampUnitInterval(safeWidth / safeWorkspaceWidth)
}

export function getRightDockMaxWidth(workspaceWidth: number): number {
  return Math.max(
    RIGHT_DOCK_MIN_WIDTH,
    normalizeDimension(workspaceWidth) - RIGHT_DOCK_MAIN_MIN_WIDTH,
  )
}

/**
 * 有效尺寸区间比例：跨工作区宽度变化时保留用户在选择区间内的位置，
 * 而不是保留 width/W（后者在窗口变窄时会挤压主区）。
 */
export function rightDockWidthToRangeRatio(width: number, workspaceWidth: number): number {
  const safeWidth = normalizeDimension(workspaceWidth)
  const minimum = RIGHT_DOCK_MIN_WIDTH
  const maximum = getRightDockMaxWidth(safeWidth)
  if (maximum <= minimum) return 0
  const safe = Number.isFinite(width) ? width : RIGHT_DOCK_DEFAULT_WIDTH
  return clampUnitInterval((safe - minimum) / (maximum - minimum))
}

export function rightDockWidthFromRangeRatio(ratio: number, workspaceWidth: number): number {
  const safeWidth = normalizeDimension(workspaceWidth)
  const minimum = RIGHT_DOCK_MIN_WIDTH
  const maximum = getRightDockMaxWidth(safeWidth)
  return Math.round(minimum + clampUnitInterval(ratio) * (maximum - minimum))
}

export type RightDockDragLayout = 'chat' | 'split'

/**
 * 越界拖拽的布局判定：只读未夹紧的原始指针尺寸，因此 pointer cancel 后
 * 回到已提交布局，不需要额外的回滚状态。拉宽时由现有尺寸上限夹紧。
 */
export function resolveRightDockDragLayout(
  rawWidth: number,
): RightDockDragLayout {
  if (!Number.isFinite(rawWidth)) return 'split'
  if (rawWidth < RIGHT_DOCK_HIDE_THRESHOLD) return 'chat'
  return 'split'
}

/** 默认占工作区宽度 40%，仍遵守右栏与主内容区的最小宽度。 */
export function getResponsiveRightDockDefaultWidth(
  mainContentWidth: number,
  _shellHeight: number,
): number {
  return rightDockWidthFromRatio(0.4, mainContentWidth)
}

export function bottomPanelHeightFromRatio(ratio: number, workspaceHeight: number): number {
  const safeWorkspaceHeight = normalizeDimension(workspaceHeight)
  const preferredHeight = safeWorkspaceHeight * clampUnitInterval(ratio)
  return Math.round(
    clamp(preferredHeight, BOTTOM_PANEL_MIN_HEIGHT, getBottomPanelMaxHeight(safeWorkspaceHeight)),
  )
}

export function bottomPanelHeightToRatio(height: number, workspaceHeight: number): number {
  const safeWorkspaceHeight = normalizeDimension(workspaceHeight)
  if (safeWorkspaceHeight === 0) return 0
  const safeHeight = Number.isFinite(height) ? height : BOTTOM_PANEL_DEFAULT_HEIGHT
  return clampUnitInterval(safeHeight / safeWorkspaceHeight)
}

export function getBottomPanelMaxHeight(workspaceHeight: number): number {
  const safeWorkspaceHeight = normalizeDimension(workspaceHeight)
  return Math.floor(
    Math.max(
      BOTTOM_PANEL_MIN_HEIGHT,
      Math.min(safeWorkspaceHeight * 0.5, safeWorkspaceHeight - BOTTOM_PANEL_UPPER_MIN_HEIGHT),
    ),
  )
}

function normalizeDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function clampUnitInterval(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function clampWorkbenchSize(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, maximum))
}
