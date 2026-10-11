import type { FileEditorViewState } from '../../editor/FileEditor.js'

export type WorkbenchPanelTarget = 'right' | 'bottom' | 'sidebar'

export type WorkbenchFocusArea = 'main' | 'right-panel' | 'bottom-panel' | 'sidebar-panel'

export type MarkdownFileViewMode = 'rich' | 'source'

export type UserAttachmentPreviewSource =
  | {
      storage: 'thread'
      attachmentId: string
    }
  | {
      storage: 'draft'
      data: string
      encoding: 'base64' | 'utf8'
    }
  | {
      storage: 'draft-path'
      grantId: string
      relativePath?: string
    }
  | {
      storage: 'thread-path'
      threadId: string
      referenceId: string
      relativePath?: string
    }
  | {
      storage: 'artifact'
      threadId: string
      artifactId: string
    }

export type UserAttachmentPreviewTab = {
  id: 'user-attachment-preview'
  kind: 'attachment-preview'
  attachment: {
    id: string
    kind: 'image' | 'text' | 'binary' | 'directory'
    name: string
    mediaType: string
    sizeBytes: number
  }
  source: UserAttachmentPreviewSource
}

/** A process-local, read-only preview for an installed non-builtin SKILL.md. */
export type SkillPreviewTab = {
  id: `skill-preview:${string}`
  kind: 'skill-preview'
  skill: {
    name: string
    path: string
    workspacePath: string | null
  }
}

export type WorkbenchTabKind =
  | 'review'
  | 'browser'
  | 'file-browser'
  | 'file-preview'
  | 'attachment-preview'
  | 'skill-preview'
  | 'plan'
  | 'side-chat'
  | 'side-task'
  | 'terminal'

export type WorkbenchTabDescriptor =
  | { id: 'review'; kind: 'review' }
  | {
      id: `browser:${string}`
      kind: 'browser'
      tabId: string
      title?: string
      busy?: boolean
      suspended?: boolean
    }
  | {
      id: 'file-browser'
      kind: 'file-browser'
      directoryPath?: string
      revealToken?: number
    }
  | {
      id: `file:${string}`
      kind: 'file-preview'
      workspacePath: string
      projectId?: string
      folderId?: string
      relativePath: string
      preview: boolean
      markdownViewMode?: MarkdownFileViewMode
      viewState?: FileEditorViewState
      line?: number
      column?: number
      endLine?: number
      endColumn?: number
    }
  | {
      id: `plan:${string}`
      kind: 'plan'
      eventId: string
      title: string
      /** Markdown captured when opened; older persisted tabs may omit it. */
      content?: string
    }
  | {
      id: `side-chat:${string}`
      kind: 'side-chat'
      threadId: string
      sourceThreadId: string
      inheritedThroughTurnId: string | null
      title: string
    }
  | UserAttachmentPreviewTab
  | SkillPreviewTab
  | {
      id: `terminal:${string}` | 'terminal'
      kind: 'terminal'
      terminalId?: string
      title?: string
    }
  | {
      id: `side-task:${string}`
      kind: 'side-task'
      taskId: string
      childThreadId: string
    }

export type WorkbenchTabId = WorkbenchTabDescriptor['id']

export function createSkillPreviewTab(input: {
  name: string
  path: string
  workspacePath: string | null
}): SkillPreviewTab {
  return {
    id: `skill-preview:${skillPreviewFingerprint(input.path)}`,
    kind: 'skill-preview',
    skill: input,
  }
}

/**
 * Keeps a tab identity stable without placing a local absolute path in DOM,
 * UI persistence, logs, or drag payloads. This is an identifier, not a
 * security primitive: the original path remains only in the in-memory tab.
 */
function skillPreviewFingerprint(path: string): string {
  return `${fnv1a(path).toString(36)}-${fnv1a(`${path}\u0000`).toString(36)}`
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export type WorkbenchPanelSnapshot = {
  open: boolean
  activeTabId: WorkbenchTabId | null
  tabIds: WorkbenchTabId[]
}

/** Persisted workspace layout mode. Chat-vs-content presentation lives in `tabsHidden`. */
export type WorkspaceLayoutMode = 'split'

/** Which surface of the workspace owns the viewport. `chat` is the main conversation. */
export type WorkspaceSurface = 'chat' | 'content'

/**
 * The single source of truth for the right workspace presentation.
 *
 * `layoutMode` retains the persisted split mode; `tabsHidden` controls
 * whether the workspace presents chat alone or chat alongside content.
 */
export type WorkspaceView = {
  layoutMode: WorkspaceLayoutMode
  tabsHidden: boolean
  selectedSurface: WorkspaceSurface
  sidePanelSelectedSurface: WorkspaceSurface
}

/** chat（内容隐藏）与 split（聊天和内容并排）。 */
export type WorkspaceLayout = 'chat' | 'split'

export type WorkbenchTabsState = {
  schemaVersion: 2
  tabsById: Partial<Record<WorkbenchTabId, WorkbenchTabDescriptor>>
  right: WorkbenchPanelSnapshot
  bottom: WorkbenchPanelSnapshot
  sidebar?: WorkbenchPanelSnapshot
  floatingTabIds?: WorkbenchTabId[]
  rightFullWidth: boolean
  restoreRightFullWidthOnNextOpen: boolean
  focusArea: WorkbenchFocusArea
  workspaceView?: WorkspaceView
}

/**
 * Temporary naming compatibility for callers migrating from the fixed-tool
 * workbench. The shape is the v2 dynamic-tab state.
 */
export type WorkbenchPanelState = WorkbenchTabsState

export type WorkbenchPanelAction =
  | {
      type: 'openTab'
      target: WorkbenchPanelTarget
      tab: WorkbenchTabDescriptor
      index?: number
      /** `false` 保留当前显隐：仅用于会话恢复、Browser 投影等后台挂接。 */
      reveal?: boolean
    }
  | {
      type: 'replaceTab'
      previousTabId: WorkbenchTabId
      tab: WorkbenchTabDescriptor
    }
  | {
      type: 'selectTab'
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
    }
  | {
      type: 'closeTab'
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
    }
  | {
      type: 'closeOtherTabs'
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
    }
  | {
      type: 'closeTabsToRight'
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
    }
  | { type: 'pinTab'; tabId: WorkbenchTabId }
  | {
      type: 'setFileViewState'
      tabId: WorkbenchTabId
      viewState: FileEditorViewState
    }
  | {
      type: 'setFileMarkdownViewMode'
      tabId: WorkbenchTabId
      mode: MarkdownFileViewMode
    }
  | {
      type: 'moveTab'
      source: WorkbenchPanelTarget
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
      index?: number
    }
  | {
      type: 'popOutTab'
      source?: WorkbenchPanelTarget
      tabId: WorkbenchTabId
    }
  | {
      type: 'dockBackTab'
      target?: WorkbenchPanelTarget
      tabId: WorkbenchTabId
    }
  | {
      type: 'reorderTab'
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
      index: number
    }
  | { type: 'togglePanel'; target: WorkbenchPanelTarget }
  | {
      type: 'closePanel'
      target: WorkbenchPanelTarget
      responsive?: boolean
    }
  | { type: 'setWorkspaceLayout'; layout: WorkspaceLayout }
  | { type: 'stepWorkspaceLayout' }
  | { type: 'focusPanel'; target: WorkbenchPanelTarget | 'main' }

export const DEFAULT_WORKSPACE_VIEW: WorkspaceView = {
  layoutMode: 'split',
  tabsHidden: true,
  selectedSurface: 'chat',
  sidePanelSelectedSurface: 'content',
}

export function getWorkspaceLayout(view: WorkspaceView): WorkspaceLayout {
  if (view.tabsHidden) return 'chat'
  return 'split'
}

export function getWorkspaceView(state: WorkbenchTabsState): WorkspaceView {
  return state.workspaceView ?? inferWorkspaceView(state.right.open)
}

/** 旧数据推导：关闭→chat，打开→split；旧全宽标记不再参与布局。 */
export function inferWorkspaceView(open: boolean): WorkspaceView {
  if (!open) {
    return { ...DEFAULT_WORKSPACE_VIEW, tabsHidden: true, selectedSurface: 'chat' }
  }
  return {
    ...DEFAULT_WORKSPACE_VIEW,
    layoutMode: 'split',
    tabsHidden: false,
    selectedSurface: 'content',
  }
}

export function getWorkbenchWorkspaceLayout(state: WorkbenchTabsState): WorkspaceLayout {
  return getWorkspaceLayout(getWorkspaceView(state))
}

/** 在仅聊天与分屏之间切换。 */
export function nextWorkspaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
  if (layout === 'split') return 'chat'
  return 'split'
}

export function createDefaultWorkbenchPanelState(): WorkbenchTabsState {
  return {
    schemaVersion: 2,
    tabsById: {},
    right: createEmptyPanel(),
    bottom: createEmptyPanel(),
    sidebar: createEmptyPanel(),
    floatingTabIds: [],
    rightFullWidth: false,
    restoreRightFullWidthOnNextOpen: false,
    focusArea: 'main',
    workspaceView: DEFAULT_WORKSPACE_VIEW,
  }
}

export const createDefaultWorkbenchTabsState = createDefaultWorkbenchPanelState

export function normalizeWorkbenchTabsState(state: WorkbenchTabsState): WorkbenchTabsState {
  const invalidBottomIds = state.bottom.tabIds.filter(
    (id) => state.tabsById[id] && state.tabsById[id]?.kind !== 'terminal',
  )
  if (invalidBottomIds.length === 0) return state

  const newBottomTabIds = state.bottom.tabIds.filter(
    (id) => state.tabsById[id]?.kind === 'terminal',
  )
  const newRightTabIds = [...state.right.tabIds]
  for (const id of invalidBottomIds) {
    if (!newRightTabIds.includes(id)) {
      newRightTabIds.push(id)
    }
  }

  const bottomActive =
    state.bottom.activeTabId && newBottomTabIds.includes(state.bottom.activeTabId)
      ? state.bottom.activeTabId
      : (newBottomTabIds[0] ?? null)

  return {
    ...state,
    right: {
      ...state.right,
      tabIds: newRightTabIds,
    },
    bottom: {
      ...state.bottom,
      tabIds: newBottomTabIds,
      open: newBottomTabIds.length > 0 ? state.bottom.open : false,
      activeTabId: bottomActive,
    },
  }
}

export function applyWorkbenchPanelAction(
  state: WorkbenchTabsState,
  action: WorkbenchPanelAction,
): WorkbenchTabsState {
  return normalizeWorkbenchTabsState(reduceWorkbenchPanelAction(state, action))
}

function workspaceFocusArea(view: WorkspaceView, fallback: WorkbenchFocusArea): WorkbenchFocusArea {
  if (fallback === 'bottom-panel' || fallback === 'sidebar-panel') return fallback
  if (getWorkspaceLayout(view) === 'chat') return 'main'
  return view.selectedSurface === 'chat' ? 'main' : 'right-panel'
}

/**
 * 唯一写入 workspaceView 的地方，同时把 `right.open` / `rightFullWidth` 更新为
 * 兼容投影。只有显式布局动作会改写显隐：后台挂接（`reveal: false`）保持现状。
 */
function setWorkspaceView(
  state: WorkbenchTabsState,
  patch: Partial<WorkspaceView>,
): WorkbenchTabsState {
  const next: WorkspaceView = { ...getWorkspaceView(state), ...patch }
  const layout = getWorkspaceLayout(next)
  const open = layout !== 'chat'
  const focusArea = workspaceFocusArea(next, state.focusArea)
  if (
    open === state.right.open &&
    !state.rightFullWidth &&
    !state.restoreRightFullWidthOnNextOpen &&
    focusArea === state.focusArea &&
    sameWorkspaceView(next, state.workspaceView)
  ) {
    return state
  }
  return {
    ...state,
    workspaceView: next,
    right: { ...state.right, open },
    rightFullWidth: false,
    restoreRightFullWidthOnNextOpen: false,
    focusArea,
  }
}

function sameWorkspaceView(left: WorkspaceView, right: WorkspaceView | undefined): boolean {
  return (
    right != null &&
    left.layoutMode === right.layoutMode &&
    left.tabsHidden === right.tabsHidden &&
    left.selectedSurface === right.selectedSurface &&
    left.sidePanelSelectedSurface === right.sidePanelSelectedSurface
  )
}

function reduceWorkbenchPanelAction(
  state: WorkbenchTabsState,
  action: WorkbenchPanelAction,
): WorkbenchTabsState {
  if (action.type === 'setWorkspaceLayout') {
    return setWorkspaceView(state, {
      layoutMode: 'split',
      tabsHidden: action.layout === 'chat',
      selectedSurface: action.layout === 'chat' ? 'chat' : 'content',
    })
  }

  if (action.type === 'stepWorkspaceLayout') {
    const layout = getWorkspaceLayout(getWorkspaceView(state))
    return reduceWorkbenchPanelAction(state, {
      type: 'setWorkspaceLayout',
      layout: nextWorkspaceLayout(layout),
    })
  }

  if (action.type === 'focusPanel') {
    const targetPanel =
      action.target === 'main' ? null : (state[action.target] ?? createEmptyPanel())
    const focusArea: WorkbenchFocusArea =
      action.target === 'main' || !targetPanel?.open || !targetPanel?.activeTabId
        ? 'main'
        : `${action.target}-panel`
    const view = getWorkspaceView(state)
    const selectedSurface: WorkspaceSurface =
      focusArea === 'main' ? 'chat' : action.target === 'right' ? 'content' : view.selectedSurface
    if (focusArea === state.focusArea && selectedSurface === view.selectedSurface) return state
    return {
      ...setWorkspaceView(state, { selectedSurface }),
      focusArea,
    }
  }

  if (action.type === 'togglePanel') {
    if (action.target === 'right') {
      const layout = getWorkspaceLayout(getWorkspaceView(state))
      return reduceWorkbenchPanelAction(state, {
        type: 'setWorkspaceLayout',
        layout: layout === 'chat' ? 'split' : 'chat',
      })
    }
    const targetPanel = state[action.target] ?? createEmptyPanel()
    return targetPanel.open
      ? closeWorkbenchPanel(state, action.target)
      : openWorkbenchPanel(state, action.target)
  }

  if (action.type === 'closePanel') {
    if (action.target === 'right') {
      return reduceWorkbenchPanelAction(state, { type: 'setWorkspaceLayout', layout: 'chat' })
    }
    const targetPanel = state[action.target] ?? createEmptyPanel()
    if (!targetPanel.open) return state
    return closeWorkbenchPanel(state, action.target)
  }

  if (action.type === 'openTab') {
    const reveal = action.reveal !== false
    const existingTarget = findTabTarget(state, action.tab.id)
    if (existingTarget) {
      const existing = state.tabsById[action.tab.id]
      const reopenedTab =
        existing?.kind === 'file-preview' &&
        action.tab.kind === 'file-preview' &&
        (existing.markdownViewMode || existing.viewState)
          ? {
              ...action.tab,
              markdownViewMode: existing.markdownViewMode,
              viewState: existing.viewState,
            }
          : action.tab
      const tab =
        existing?.kind === 'file-preview' &&
        !existing.preview &&
        reopenedTab.kind === 'file-preview'
          ? { ...reopenedTab, preview: false }
          : reopenedTab
      const targetPanel = state[existingTarget] ?? createEmptyPanel()
      return revealPanelTab(
        { ...state, tabsById: { ...state.tabsById, [tab.id]: tab } },
        existingTarget,
        { ...targetPanel, open: true, activeTabId: tab.id },
        reveal,
      )
    }

    let next = state
    if (action.tab.kind === 'file-preview' && action.tab.preview) {
      const replaceableId = findReplaceablePreviewTab(state)
      if (replaceableId) {
        next = removeTabEverywhere(state, replaceableId)
      }
    }

    const effectiveTarget: WorkbenchPanelTarget =
      action.target === 'bottom' && action.tab.kind !== 'terminal' ? 'right' : action.target
    const destPanel = next[effectiveTarget] ?? createEmptyPanel()
    return revealPanelTab(
      {
        ...next,
        tabsById: {
          ...next.tabsById,
          [action.tab.id]: action.tab,
        },
      },
      effectiveTarget,
      {
        ...insertTab(destPanel, action.tab.id, action.index),
        open: true,
        activeTabId: action.tab.id,
      },
      reveal,
    )
  }

  if (action.type === 'replaceTab') {
    if (!state.tabsById[action.previousTabId]) return state
    const tabsById = { ...state.tabsById }
    delete tabsById[action.previousTabId]
    tabsById[action.tab.id] = action.tab
    const replaceInPanel = (panel: WorkbenchPanelSnapshot): WorkbenchPanelSnapshot => ({
      ...panel,
      activeTabId: panel.activeTabId === action.previousTabId ? action.tab.id : panel.activeTabId,
      tabIds: panel.tabIds.map((tabId) => (tabId === action.previousTabId ? action.tab.id : tabId)),
    })
    return {
      ...state,
      tabsById,
      right: replaceInPanel(state.right),
      bottom: replaceInPanel(state.bottom),
      ...(state.sidebar ? { sidebar: replaceInPanel(state.sidebar) } : {}),
    }
  }

  if (action.type === 'selectTab') {
    const panel = state[action.target] ?? createEmptyPanel()
    if (!panel.tabIds.includes(action.tabId)) return state
    return revealPanelTab(
      state,
      action.target,
      { ...panel, open: true, activeTabId: action.tabId },
      true,
    )
  }

  if (action.type === 'closeTab') {
    if (state.floatingTabIds?.includes(action.tabId)) {
      return removeTabEverywhere(state, action.tabId)
    }
    const panel = state[action.target] ?? createEmptyPanel()
    if (!panel.tabIds.includes(action.tabId)) return state
    return removeTabEverywhere(state, action.tabId)
  }

  if (action.type === 'closeOtherTabs') {
    const panel = state[action.target] ?? createEmptyPanel()
    if (!panel.tabIds.includes(action.tabId)) return state
    return removeTabsFromPanel(
      state,
      action.target,
      panel.tabIds.filter((id) => id !== action.tabId),
      action.tabId,
    )
  }

  if (action.type === 'closeTabsToRight') {
    const panel = state[action.target] ?? createEmptyPanel()
    const index = panel.tabIds.indexOf(action.tabId)
    if (index < 0 || index === panel.tabIds.length - 1) return state
    return removeTabsFromPanel(state, action.target, panel.tabIds.slice(index + 1), action.tabId)
  }

  if (action.type === 'pinTab') {
    const tab = state.tabsById[action.tabId]
    if (tab?.kind !== 'file-preview' || !tab.preview) return state
    return {
      ...state,
      tabsById: {
        ...state.tabsById,
        [tab.id]: { ...tab, preview: false },
      },
    }
  }

  if (action.type === 'setFileViewState') {
    const tab = state.tabsById[action.tabId]
    if (tab?.kind !== 'file-preview') return state
    return {
      ...state,
      tabsById: { ...state.tabsById, [tab.id]: { ...tab, viewState: action.viewState } },
    }
  }

  if (action.type === 'setFileMarkdownViewMode') {
    const tab = state.tabsById[action.tabId]
    if (tab?.kind !== 'file-preview' || tab.markdownViewMode === action.mode) {
      return state
    }
    return {
      ...state,
      tabsById: {
        ...state.tabsById,
        [tab.id]: { ...tab, markdownViewMode: action.mode },
      },
    }
  }

  if (action.type === 'moveTab') {
    if (action.target === 'bottom' && state.tabsById[action.tabId]?.kind !== 'terminal') {
      return state
    }
    const sourcePanel = state[action.source] ?? createEmptyPanel()
    if (!sourcePanel.tabIds.includes(action.tabId)) return state
    if (action.source === action.target) {
      return applyWorkbenchPanelAction(state, {
        type: 'reorderTab',
        target: action.target,
        tabId: action.tabId,
        index: action.index ?? sourcePanel.tabIds.length - 1,
      })
    }
    const source = closeEmptyPanel(removeTab(sourcePanel, action.tabId))
    const targetPanel = state[action.target] ?? createEmptyPanel()
    const target = insertTab(targetPanel, action.tabId, action.index)
    const rightBecameEmpty = action.source === 'right' && source.tabIds.length === 0
    const moved = revealPanelTab(
      { ...state, [action.source]: source },
      action.target,
      {
        ...target,
        open: true,
        activeTabId: action.tabId,
      },
      true,
    )
    return rightBecameEmpty ? collapseWorkspaceToChat(moved) : moved
  }

  if (action.type === 'reorderTab') {
    const panel = state[action.target] ?? createEmptyPanel()
    if (!panel.tabIds.includes(action.tabId)) return state
    return {
      ...state,
      [action.target]: insertTab(removeTab(panel, action.tabId), action.tabId, action.index),
    }
  }

  if (action.type === 'popOutTab') {
    const source = action.source ?? findTabTarget(state, action.tabId)
    if (!source) return state
    const sourcePanel = state[source] ?? createEmptyPanel()
    if (!sourcePanel.tabIds.includes(action.tabId)) return state
    const updatedSource = closeEmptyPanel(removeTab(sourcePanel, action.tabId))
    const floatingTabIds = Array.from(new Set([...(state.floatingTabIds ?? []), action.tabId]))
    const rightBecameEmpty = source === 'right' && updatedSource.tabIds.length === 0
    const popped = {
      ...state,
      [source]: updatedSource,
      floatingTabIds,
      ...(rightBecameEmpty ? { restoreRightFullWidthOnNextOpen: false } : {}),
      focusArea: state.focusArea === `${source}-panel` ? ('main' as const) : state.focusArea,
    }
    return rightBecameEmpty ? collapseWorkspaceToChat(popped) : popped
  }

  if (action.type === 'dockBackTab') {
    const floatingTabIds = (state.floatingTabIds ?? []).filter((id) => id !== action.tabId)
    const tab = state.tabsById[action.tabId]
    const defaultTarget: WorkbenchPanelTarget = tab?.kind === 'terminal' ? 'bottom' : 'right'
    const target = action.target ?? defaultTarget
    const targetPanel = state[target] ?? createEmptyPanel()
    const updatedTarget = insertTab(targetPanel, action.tabId)
    return revealPanelTab(
      { ...state, floatingTabIds },
      target,
      {
        ...updatedTarget,
        open: true,
        activeTabId: action.tabId,
      },
      true,
    )
  }

  return state
}

export const applyWorkbenchTabsAction = applyWorkbenchPanelAction

function createEmptyPanel(): WorkbenchPanelSnapshot {
  return {
    open: false,
    activeTabId: null,
    tabIds: [],
  }
}

/**
 * Registers the panel update and, for the right workspace, applies the reveal
 * rules of `openTab`/`selectTab`: background restores (`reveal: false`) never
 * reopen a hidden workspace or steal the content surface.
 */
function revealPanelTab(
  state: WorkbenchTabsState,
  target: WorkbenchPanelTarget,
  panel: WorkbenchPanelSnapshot,
  reveal: boolean,
): WorkbenchTabsState {
  const next = { ...state, [target]: panel }
  if (target !== 'right') {
    return { ...next, focusArea: `${target}-panel` }
  }
  if (!reveal) return next
  return setWorkspaceView(next, { tabsHidden: false, selectedSurface: 'content' })
}

/** 最后一个真实内容标签消失：回到主 Chat，但保留已记住的布局模式。 */
function collapseWorkspaceToChat(state: WorkbenchTabsState): WorkbenchTabsState {
  return setWorkspaceView(
    { ...state, right: { ...state.right, open: false, activeTabId: null, tabIds: [] } },
    { tabsHidden: true, selectedSurface: 'chat' },
  )
}

function openWorkbenchPanel(
  state: WorkbenchTabsState,
  target: WorkbenchPanelTarget,
): WorkbenchTabsState {
  const targetPanel = state[target] ?? createEmptyPanel()
  return {
    ...state,
    [target]: { ...openPanelWithFallback(targetPanel), open: true },
    focusArea: `${target}-panel`,
  }
}

function closeWorkbenchPanel(
  state: WorkbenchTabsState,
  target: WorkbenchPanelTarget,
): WorkbenchTabsState {
  const targetPanel = state[target] ?? createEmptyPanel()
  return {
    ...state,
    [target]: { ...targetPanel, open: false },
    focusArea: state.focusArea === `${target}-panel` ? 'main' : state.focusArea,
  }
}

function openPanelWithFallback(panel: WorkbenchPanelSnapshot): WorkbenchPanelSnapshot {
  return {
    ...panel,
    activeTabId:
      panel.activeTabId && panel.tabIds.includes(panel.activeTabId)
        ? panel.activeTabId
        : (panel.tabIds[0] ?? null),
  }
}

function findTabTarget(
  state: WorkbenchTabsState,
  tabId: WorkbenchTabId,
): WorkbenchPanelTarget | null {
  if (state.right.tabIds.includes(tabId)) return 'right'
  if (state.bottom.tabIds.includes(tabId)) return 'bottom'
  if (state.sidebar?.tabIds.includes(tabId)) return 'sidebar'
  return null
}

function findReplaceablePreviewTab(state: WorkbenchTabsState): WorkbenchTabId | null {
  const allTabIds = [
    ...state.right.tabIds,
    ...state.bottom.tabIds,
    ...(state.sidebar?.tabIds ?? []),
  ]
  for (const tabId of allTabIds) {
    const tab = state.tabsById[tabId]
    if (tab?.kind === 'file-preview' && tab.preview) return tabId
  }
  return null
}

function insertTab(
  panel: WorkbenchPanelSnapshot,
  tabId: WorkbenchTabId,
  index?: number,
): WorkbenchPanelSnapshot {
  const tabIds = panel.tabIds.filter((id) => id !== tabId)
  const safeIndex =
    index === undefined ? tabIds.length : Math.max(0, Math.min(tabIds.length, Math.round(index)))
  tabIds.splice(safeIndex, 0, tabId)
  return { ...panel, activeTabId: tabId, tabIds }
}

function removeTab(panel: WorkbenchPanelSnapshot, tabId: WorkbenchTabId): WorkbenchPanelSnapshot {
  const index = panel.tabIds.indexOf(tabId)
  if (index < 0) return panel
  const tabIds = panel.tabIds.filter((id) => id !== tabId)
  const activeTabId =
    panel.activeTabId === tabId
      ? (tabIds[Math.min(index, tabIds.length - 1)] ?? null)
      : panel.activeTabId && tabIds.includes(panel.activeTabId)
        ? panel.activeTabId
        : (tabIds[tabIds.length - 1] ?? null)
  return { ...panel, activeTabId, tabIds }
}

function removeTabEverywhere(state: WorkbenchTabsState, tabId: WorkbenchTabId): WorkbenchTabsState {
  const tabsById = { ...state.tabsById }
  delete tabsById[tabId]
  const right = closeEmptyPanel(removeTab(state.right, tabId))
  const bottom = closeEmptyPanel(removeTab(state.bottom, tabId))
  const sidebar = state.sidebar ? closeEmptyPanel(removeTab(state.sidebar, tabId)) : undefined
  const floatingTabIds = (state.floatingTabIds ?? []).filter((id) => id !== tabId)
  const rightClosed = state.right.open && !right.open
  const bottomClosed = state.bottom.open && !bottom.open
  const sidebarClosed = state.sidebar?.open && !sidebar?.open
  const next: WorkbenchTabsState = {
    ...state,
    tabsById,
    right,
    bottom,
    ...(sidebar !== undefined ? { sidebar } : {}),
    floatingTabIds,
    restoreRightFullWidthOnNextOpen: rightClosed ? false : state.restoreRightFullWidthOnNextOpen,
    focusArea:
      (rightClosed && state.focusArea === 'right-panel') ||
      (bottomClosed && state.focusArea === 'bottom-panel') ||
      (sidebarClosed && state.focusArea === 'sidebar-panel')
        ? 'main'
        : state.focusArea,
  }
  // 右栏变空即回到主 Chat；工作区仍保留此前记住的布局模式。
  return right.tabIds.length === 0 ? collapseWorkspaceToChat(next) : next
}

function closeEmptyPanel(panel: WorkbenchPanelSnapshot): WorkbenchPanelSnapshot {
  return panel.tabIds.length === 0 ? { ...panel, open: false, activeTabId: null } : panel
}

function removeTabsFromPanel(
  state: WorkbenchTabsState,
  target: WorkbenchPanelTarget,
  tabIdsToRemove: readonly WorkbenchTabId[],
  activeTabId: WorkbenchTabId,
): WorkbenchTabsState {
  const removeSet = new Set(tabIdsToRemove)
  const tabsById = { ...state.tabsById }
  for (const tabId of removeSet) delete tabsById[tabId]
  const panel = state[target] ?? createEmptyPanel()
  return {
    ...state,
    tabsById,
    [target]: {
      ...panel,
      activeTabId,
      tabIds: panel.tabIds.filter((id) => !removeSet.has(id)),
    },
  }
}
