import {
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY,
  DEFAULT_PRIMARY_SIDEBAR_WIDTH,
  RIGHT_DOCK_MAIN_MIN_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY,
  bottomPanelHeightFromRatio,
  bottomPanelHeightToRatio,
  getResponsiveRightDockDefaultWidth,
  rightDockWidthFromRatio,
  rightDockWidthToRangeRatio,
  rightDockWidthToRatio,
} from './WorkbenchLayoutSizing.js'
import {
  WORKBENCH_LAYOUT_SCHEMA_VERSION,
  WORKBENCH_LAYOUT_STORAGE_KEY,
  clampAuxiliaryPanelWidth,
  clampBottomPanelHeight,
  clampPrimarySidebarWidth,
  createDefaultVisibility,
  createDefaultWorkbenchLayoutState,
  type WorkbenchLayoutSnapshot,
  type WorkbenchLayoutState,
  type WorkbenchPartVisibility,
} from './WorkbenchLayoutState.js'
import { isRecord } from '@pidex/shared/guards'

export { WORKBENCH_LAYOUT_STORAGE_KEY, WORKBENCH_LAYOUT_SCHEMA_VERSION }

export type { WorkbenchLayoutSnapshot, WorkbenchLayoutState, WorkbenchPartVisibility }

const LEGACY_RIGHT_DOCK_WIDTH_STORAGE_KEY = 'pidex.desktop.rightDockWidth'
const LEGACY_SIDEBAR_WIDTH_STORAGE_KEY = 'layout.sidebarWidth'
const LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY = 'layout.sidebarCollapsed'

export interface ReadWorkbenchLayoutInput {
  workspaceWidth: number
  workspaceHeight: number
  sidebarCollapsed: boolean
  sidebarWidth: number
  rightDockRatio: number
  bottomPanelRatio: number
}

export interface SaveWorkbenchLayoutTarget {
  storage?: Storage | null
}

export function readWorkbenchLayoutSnapshot(
  input: ReadWorkbenchLayoutInput,
  target: SaveWorkbenchLayoutTarget = {},
): WorkbenchLayoutSnapshot {
  const storage = resolveStorage(target.storage)
  const raw = safeGetItem(storage, WORKBENCH_LAYOUT_STORAGE_KEY)
  if (raw != null) {
    const parsed = tryParseStoredSnapshot(raw)
    if (parsed != null) {
      return normalizeSnapshot(parsed, input)
    }
  }
  return createDefaultWorkbenchLayoutSnapshot(input)
}

export function saveWorkbenchLayoutSnapshot(
  snapshot: WorkbenchLayoutSnapshot,
  target: SaveWorkbenchLayoutTarget = {},
): void {
  const storage = resolveStorage(target.storage)
  if (storage == null) return
  try {
    storage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* localStorage full or disabled; the in-memory state remains authoritative. */
  }
}

export function createDefaultWorkbenchLayoutSnapshot(
  input: ReadWorkbenchLayoutInput,
): WorkbenchLayoutSnapshot {
  const base = createDefaultWorkbenchLayoutState(input.workspaceWidth, input.workspaceHeight)
  const auxiliaryWidth = clampAuxiliaryPanelWidth(
    rightDockWidthFromRatio(input.rightDockRatio, input.workspaceWidth),
    input.workspaceWidth,
  )
  const bottomHeight = clampBottomPanelHeight(
    bottomPanelHeightFromRatio(input.bottomPanelRatio, input.workspaceHeight),
    input.workspaceHeight,
  )
  const sidebarWidth = clampPrimarySidebarWidth(input.sidebarWidth)
  // 注意：auxiliaryPanel / bottomPanel 的可见性只是阶段 1 的占位默认值，阶段 2
  // 接入时将由现有的 WorkbenchTabsState (right.open / bottom.open) 同步覆盖。
  // 兼容门面必须保留此占位以避免改变现有 panel open 状态。
  const visibility: WorkbenchPartVisibility = {
    primarySidebar: !input.sidebarCollapsed,
    mainContent: true,
    auxiliaryPanel: base.visibility.auxiliaryPanel,
    bottomPanel: base.visibility.bottomPanel,
  }
  return {
    schemaVersion: WORKBENCH_LAYOUT_SCHEMA_VERSION,
    visibility,
    primarySidebarWidth: sidebarWidth,
    auxiliaryPanelWidth: auxiliaryWidth,
    auxiliaryPanelWidthRangeRatio: rightDockWidthToRangeRatio(
      auxiliaryWidth,
      input.workspaceWidth,
    ),
    bottomPanelHeight: bottomHeight,
    auxiliaryMaximized: false,
    beforeAuxiliaryMaximized: null,
    beforeAuxiliaryMaximizedAuxiliaryWidth: null,
  }
}

/**
 * Backwards-compatible facade for callers that still consume the legacy
 * right-dock / bottom-panel ratio resolver. Phase 2 will replace it with a
 * direct snapshot reader; until then the controller must keep working.
 */
export default function resolveStoredWorkbenchRatios(
  workspaceWidth: number,
  workspaceHeight: number,
): [number, number] {
  const storage = resolveStorage(null)
  const rawRightRatio = safeGetItem(storage, RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY)
  const rawLegacyRightWidth = safeGetItem(storage, LEGACY_RIGHT_DOCK_WIDTH_STORAGE_KEY)
  const rawBottomRatio = safeGetItem(storage, BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY)
  const sidebarCollapsed = safeGetItem(storage, LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  const sidebarWidthRaw = safeGetItem(storage, LEGACY_SIDEBAR_WIDTH_STORAGE_KEY)
  const sidebarWidth = parseFiniteNumber(sidebarWidthRaw)
  const snapshot = readWorkbenchLayoutSnapshot({
    workspaceWidth,
    workspaceHeight,
    sidebarCollapsed,
    sidebarWidth: sidebarWidth ?? clampPrimarySidebarWidth(DEFAULT_PRIMARY_SIDEBAR_WIDTH),
    rightDockRatio:
      parseUnitInterval(rawRightRatio) ??
      rightDockWidthToRatio(
        parseFiniteNumber(rawLegacyRightWidth) ??
          getResponsiveRightDockDefaultWidth(workspaceWidth, workspaceHeight),
        workspaceWidth,
      ),
    bottomPanelRatio:
      parseUnitInterval(rawBottomRatio) ??
      bottomPanelHeightToRatio(BOTTOM_PANEL_DEFAULT_HEIGHT, workspaceHeight),
  })

  return [
    rightDockWidthToRatio(snapshot.auxiliaryPanelWidth, workspaceWidth),
    bottomPanelHeightToRatio(snapshot.bottomPanelHeight, workspaceHeight),
  ]
}

export function resolveInitialRightDockWidthRatio(
  storedRatioValue: string | null,
  legacyStoredWidthValue: string | null,
  workspaceWidth: number,
  workspaceHeight: number,
): number {
  const storedRatio = parseUnitInterval(storedRatioValue)
  if (storedRatio != null) return storedRatio

  const legacyStoredWidth = parseFiniteNumber(legacyStoredWidthValue)
  if (legacyStoredWidth != null && legacyStoredWidth >= 0) {
    const legacyWidth =
      legacyStoredWidth <= 1
        ? legacyRightDockWidthFromRatio(legacyStoredWidth, workspaceWidth)
        : legacyStoredWidth
    return rightDockWidthToRatio(legacyWidth, workspaceWidth)
  }

  return rightDockWidthToRatio(
    getResponsiveRightDockDefaultWidth(workspaceWidth, workspaceHeight),
    workspaceWidth,
  )
}

export function resolveInitialBottomPanelHeightRatio(
  storedRatioValue: string | null,
  workspaceHeight: number,
): number {
  const storedRatio = parseUnitInterval(storedRatioValue)
  if (storedRatio != null) return storedRatio

  return bottomPanelHeightToRatio(BOTTOM_PANEL_DEFAULT_HEIGHT, workspaceHeight)
}

function legacyRightDockWidthFromRatio(ratio: number, workspaceWidth: number): number {
  const maximum = Math.max(RIGHT_DOCK_MIN_WIDTH, workspaceWidth - RIGHT_DOCK_MAIN_MIN_WIDTH)
  return Math.round(RIGHT_DOCK_MIN_WIDTH + ratio * (maximum - RIGHT_DOCK_MIN_WIDTH))
}

function resolveStorage(explicit: SaveWorkbenchLayoutTarget['storage']): Storage | null {
  if (explicit != null) return explicit
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function safeGetItem(storage: Storage | null, key: string): string | null {
  if (storage == null) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function tryParseStoredSnapshot(raw: string): WorkbenchLayoutSnapshot | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (parsed.schemaVersion !== WORKBENCH_LAYOUT_SCHEMA_VERSION) return null
  const visibility = parseVisibility(parsed.visibility)
  if (visibility == null) return null
  const primarySidebarWidth = parseFiniteNumber(parsed.primarySidebarWidth)
  const auxiliaryPanelWidth = parseFiniteNumber(parsed.auxiliaryPanelWidth)
  const bottomPanelHeight = parseFiniteNumber(parsed.bottomPanelHeight)
  if (primarySidebarWidth == null || auxiliaryPanelWidth == null || bottomPanelHeight == null) {
    return null
  }
  const auxiliaryMaximized = parsed.auxiliaryMaximized === true
  const beforeAuxiliaryMaximized = auxiliaryMaximized
    ? (parseVisibility(parsed.beforeAuxiliaryMaximized) ?? createDefaultVisibility())
    : null
  const beforeAuxiliaryMaximizedAuxiliaryWidth = auxiliaryMaximized
    ? parseFiniteNumber(parsed.beforeAuxiliaryMaximizedAuxiliaryWidth)
    : null
  return {
    schemaVersion: WORKBENCH_LAYOUT_SCHEMA_VERSION,
    visibility,
    primarySidebarWidth,
    auxiliaryPanelWidth,
    auxiliaryPanelWidthRangeRatio: parseUnitIntervalValue(parsed.auxiliaryPanelWidthRangeRatio),
    bottomPanelHeight,
    auxiliaryMaximized,
    beforeAuxiliaryMaximized,
    beforeAuxiliaryMaximizedAuxiliaryWidth,
  }
}

function normalizeSnapshot(
  snapshot: WorkbenchLayoutSnapshot,
  input: ReadWorkbenchLayoutInput,
): WorkbenchLayoutSnapshot {
  const safeWorkspaceWidth = Math.max(input.workspaceWidth, 0)
  const safeWorkspaceHeight = Math.max(input.workspaceHeight, 0)
  const visibility: WorkbenchPartVisibility = {
    primarySidebar: snapshot.visibility.primarySidebar,
    mainContent: snapshot.visibility.mainContent,
    auxiliaryPanel: snapshot.visibility.auxiliaryPanel,
    bottomPanel: snapshot.visibility.bottomPanel,
  }
  if (!snapshot.auxiliaryMaximized && !visibility.mainContent) {
    visibility.mainContent = true
  }
  const primarySidebarWidth = clampPrimarySidebarWidth(snapshot.primarySidebarWidth)
  const auxiliaryPanelWidth = clampAuxiliaryPanelWidth(
    snapshot.auxiliaryPanelWidth,
    safeWorkspaceWidth,
  )
  const auxiliaryPanelWidthRangeRatio =
    snapshot.auxiliaryPanelWidthRangeRatio ??
    rightDockWidthToRangeRatio(auxiliaryPanelWidth, safeWorkspaceWidth)
  const bottomPanelHeight = clampBottomPanelHeight(snapshot.bottomPanelHeight, safeWorkspaceHeight)
  const beforeAuxiliaryMaximized = snapshot.auxiliaryMaximized
    ? { ...(snapshot.beforeAuxiliaryMaximized ?? visibility) }
    : null
  const beforeAuxiliaryMaximizedAuxiliaryWidth = snapshot.auxiliaryMaximized
    ? clampAuxiliaryPanelWidth(
        snapshot.beforeAuxiliaryMaximizedAuxiliaryWidth ?? snapshot.auxiliaryPanelWidth,
        safeWorkspaceWidth,
      )
    : null
  return {
    schemaVersion: WORKBENCH_LAYOUT_SCHEMA_VERSION,
    visibility,
    primarySidebarWidth,
    auxiliaryPanelWidth,
    auxiliaryPanelWidthRangeRatio,
    bottomPanelHeight,
    auxiliaryMaximized: snapshot.auxiliaryMaximized,
    beforeAuxiliaryMaximized,
    beforeAuxiliaryMaximizedAuxiliaryWidth,
  }
}

function parseVisibility(value: unknown): WorkbenchPartVisibility | null {
  if (!isRecord(value)) return null
  if (
    typeof value.primarySidebar !== 'boolean' ||
    typeof value.mainContent !== 'boolean' ||
    typeof value.auxiliaryPanel !== 'boolean' ||
    typeof value.bottomPanel !== 'boolean'
  ) {
    return null
  }
  return {
    primarySidebar: value.primarySidebar,
    mainContent: value.mainContent,
    auxiliaryPanel: value.auxiliaryPanel,
    bottomPanel: value.bottomPanel,
  }
}

function parseUnitInterval(value: string | null): number | null {
  const parsed = parseFiniteNumber(value)
  return parsed != null && parsed >= 0 && parsed <= 1 ? parsed : null
}

function parseUnitIntervalValue(value: unknown): number | null {
  const parsed = parseFiniteNumber(value)
  return parsed != null && parsed >= 0 && parsed <= 1 ? parsed : null
}

function parseFiniteNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
