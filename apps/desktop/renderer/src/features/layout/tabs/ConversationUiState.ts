import type { DesktopComposerAttachment, DesktopReviewSource } from '../../../../shared/Types.js'
import type { FileEditorViewState } from '../../editor/FileEditor.js'
import {
  createDefaultWorkbenchTabsState,
  inferWorkspaceView,
  type WorkbenchFocusArea,
  type WorkbenchPanelSnapshot,
  type WorkbenchPanelTarget,
  type WorkbenchTabDescriptor,
  type WorkbenchTabId,
  type WorkbenchTabsState,
  type WorkspaceSurface,
  type WorkspaceView,
} from '../dock/RightDockState.js'
import { arePathsEqual } from '../../../utils/PathUtils.js'
import { isRecord } from '@pidex/shared/guards'

const STORAGE_PREFIX = 'conversation.ui-state.'

export function readFileEditorViewState(value: unknown): FileEditorViewState | null {
  if (!isRecord(value)) return null
  const { scrollTop, scrollLeft, anchor, head } = value
  if (
    ![scrollTop, scrollLeft, anchor, head].every(
      (field) => typeof field === 'number' && Number.isFinite(field) && field >= 0,
    )
  )
    return null
  return {
    scrollTop: scrollTop as number,
    scrollLeft: scrollLeft as number,
    anchor: Math.trunc(anchor as number),
    head: Math.trunc(head as number),
  }
}

export type ReviewTabUiState = {
  source: DesktopReviewSource
  selectedFile: string | null
  selectedCommentId: string | null
  scrollTop: number
  diffExpansion: ReviewDiffExpansion
  viewedRevisions: Record<string, string>
  fileTreeVisible: boolean
  fileTreeWidth: number
  diffMode: 'inline' | 'split'
  wrapLines: boolean
  showWordDiff: boolean
  hideWhitespace: boolean
  richPreview: boolean
  loadFullFiles: boolean
  hideImports: boolean
}

export type ReviewDiffExpansion =
  { mode: 'all' } | { mode: 'none' } | { mode: 'custom'; expandedFiles: string[] }

export function isReviewDiffExpanded(expansion: ReviewDiffExpansion, path: string): boolean {
  if (expansion.mode === 'all') return true
  if (expansion.mode === 'none') return false
  return expansion.expandedFiles.includes(path)
}

export function toggleReviewDiffExpansion(
  expansion: ReviewDiffExpansion,
  allPaths: readonly string[],
  path: string,
): ReviewDiffExpansion {
  const expanded = new Set(
    allPaths.filter((candidate) => isReviewDiffExpanded(expansion, candidate)),
  )
  if (expanded.has(path)) expanded.delete(path)
  else expanded.add(path)

  if (expanded.size === 0) return { mode: 'none' }
  if (allPaths.length > 0 && allPaths.every((candidate) => expanded.has(candidate))) {
    return { mode: 'all' }
  }
  return {
    mode: 'custom',
    expandedFiles: allPaths.filter((candidate) => expanded.has(candidate)),
  }
}

export type ConversationUiStateV4 = {
  schemaVersion: 4
  workbench: WorkbenchTabsState
  mainScrollTop: number
  sideChatInput: string
  sideChatAttachments: DesktopComposerAttachment[]
  review: ReviewTabUiState
}

export type ConversationUiState = ConversationUiStateV4

export type ConversationUiValidationOptions = {
  validPlanItemIds?: readonly string[]
  validSideTaskIds?: readonly string[]
  workspacePath?: string | null
  fileScopes?: readonly {
    projectId?: string
    folderId?: string
    workspacePath: string
  }[]
}

export function createDefaultConversationUiState(): ConversationUiState {
  return {
    schemaVersion: 4,
    workbench: createDefaultWorkbenchTabsState(),
    mainScrollTop: 0,
    sideChatInput: '',
    sideChatAttachments: [],
    review: createDefaultReviewTabUiState(),
  }
}

export function createDefaultReviewTabUiState(): ReviewTabUiState {
  return {
    source: { kind: 'unstaged' },
    selectedFile: null,
    selectedCommentId: null,
    scrollTop: 0,
    diffExpansion: { mode: 'all' },
    viewedRevisions: {},
    fileTreeVisible: true,
    fileTreeWidth: 340,
    diffMode: 'inline',
    wrapLines: true,
    showWordDiff: true,
    hideWhitespace: false,
    richPreview: true,
    loadFullFiles: true,
    hideImports: false,
  }
}

export function openPatchReviewTabState(
  current: ReviewTabUiState,
  path?: string,
): ReviewTabUiState {
  return {
    ...current,
    source: { kind: 'unstaged' },
    selectedFile: path ?? null,
    selectedCommentId: null,
    scrollTop: 0,
    diffExpansion: { mode: 'all' },
  }
}

export function saveConversationUiState(sessionId: string, state: ConversationUiState): void {
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + sessionId,
      JSON.stringify({
        ...state,
        workbench: omitEphemeralSideChatTabs(state.workbench),
        sideChatInput: '',
        sideChatAttachments: [],
      }),
    )
  } catch {
    /* localStorage full or disabled; silently ignore */
  }
}

/** Removes process-local tabs before a conversation UI snapshot is persisted. */
export function omitEphemeralSideChatTabs(workbench: WorkbenchTabsState): WorkbenchTabsState {
  const sideChatIds = new Set(
    Object.entries(workbench.tabsById)
      .filter(
        ([, tab]) =>
          tab?.kind === 'side-chat' ||
          tab?.kind === 'attachment-preview' ||
          tab?.kind === 'skill-preview',
      )
      .map(([tabId]) => tabId),
  )
  if (sideChatIds.size === 0) return workbench

  const tabsById = { ...workbench.tabsById }
  for (const tabId of sideChatIds) {
    delete tabsById[tabId as WorkbenchTabId]
  }
  const filterPanel = (panel: WorkbenchPanelSnapshot): WorkbenchPanelSnapshot => {
    const tabIds = panel.tabIds.filter((tabId) => !sideChatIds.has(tabId))
    return {
      ...panel,
      tabIds,
      activeTabId:
        panel.activeTabId && !sideChatIds.has(panel.activeTabId)
          ? panel.activeTabId
          : (tabIds.at(-1) ?? null),
    }
  }
  return {
    ...workbench,
    tabsById,
    right: filterPanel(workbench.right),
    bottom: filterPanel(workbench.bottom),
  }
}

export function patchConversationUiState(
  sessionId: string,
  patch: Partial<Omit<ConversationUiState, 'schemaVersion'>>,
): void {
  const raw = loadConversationUiStateRecord(sessionId)
  const current = validateConversationUiState(raw ?? createDefaultConversationUiState())
  const rawWorkbench = raw != null && isRecord(raw.workbench) ? raw.workbench : {}
  const rawTabsById = isRecord(rawWorkbench.tabsById) ? rawWorkbench.tabsById : {}
  const patchedWorkbench = patch.workbench
  // 局部合并：本次不认识的顶层/工作区字段与未知 tab 记录原样保留，不因一次保存被删除。
  saveConversationUiState(sessionId, {
    ...(raw ?? {}),
    ...current,
    ...patch,
    schemaVersion: 4,
    workbench: {
      ...rawWorkbench,
      ...current.workbench,
      ...(patchedWorkbench ?? {}),
      tabsById: {
        ...rawTabsById,
        ...current.workbench.tabsById,
        ...(patchedWorkbench?.tabsById ?? {}),
      },
    },
  } as ConversationUiState)
}

export function loadConversationUiState(sessionId: string): ConversationUiState | null {
  return loadConversationUiStateRecord(sessionId) as ConversationUiState | null
}

function loadConversationUiStateRecord(sessionId: string): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + sessionId)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function removeConversationUiState(sessionId: string): void {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + sessionId)
  } catch {
    /* localStorage disabled; silently ignore */
  }
}

export function transferConversationUiStateForHandoff(input: {
  sourceThreadId: string
  targetThreadId: string
  sourceWorkspacePath: string
}): { transferred: boolean; warning?: 'LOCAL_STORAGE_UNAVAILABLE' } {
  try {
    const source = loadConversationUiState(input.sourceThreadId)
    if (!source) return { transferred: false }
    const tabsById = Object.fromEntries(
      Object.entries(source.workbench.tabsById).filter(
        ([, tab]) =>
          tab?.kind !== 'plan' &&
          tab?.kind !== 'side-chat' &&
          tab?.kind !== 'attachment-preview' &&
          tab?.kind !== 'skill-preview' &&
          tab?.kind !== 'side-task' &&
          tab?.kind !== 'file-preview',
      ),
    )
    const transferableIds = new Set(Object.keys(tabsById))
    const filterPanel = (panel: WorkbenchPanelSnapshot): WorkbenchPanelSnapshot => {
      const tabIds = panel.tabIds.filter((tabId) => transferableIds.has(tabId))
      return {
        ...panel,
        tabIds,
        activeTabId:
          panel.activeTabId && transferableIds.has(panel.activeTabId)
            ? panel.activeTabId
            : (tabIds.at(-1) ?? null),
      }
    }
    const candidate: ConversationUiState = {
      ...source,
      sideChatAttachments: source.sideChatAttachments.filter(
        (attachment) => !isPathInside(attachment.path, input.sourceWorkspacePath),
      ),
      review: {
        ...source.review,
        source:
          source.review.source.kind === 'last-turn' ? { kind: 'unstaged' } : source.review.source,
      },
      workbench: {
        ...source.workbench,
        tabsById,
        right: filterPanel(source.workbench.right),
        bottom: filterPanel(source.workbench.bottom),
      },
    }
    const transferred = validateConversationUiState(candidate, {
      validPlanItemIds: [],
      validSideTaskIds: [],
    })
    window.localStorage.setItem(STORAGE_PREFIX + input.targetThreadId, JSON.stringify(transferred))
    return { transferred: true }
  } catch {
    return { transferred: false, warning: 'LOCAL_STORAGE_UNAVAILABLE' }
  }
}

export function validateConversationUiState(
  state: unknown,
  options: ConversationUiValidationOptions = {},
): ConversationUiState {
  if (!isRecord(state)) return createDefaultConversationUiState()

  const workbench =
    state.schemaVersion === 4 && isRecord(state.workbench)
      ? validateWorkbenchState(state.workbench, options)
      : createDefaultWorkbenchTabsState()

  return {
    schemaVersion: 4,
    workbench,
    mainScrollTop: toFiniteNonNegativeNumber(state.mainScrollTop),
    sideChatInput: typeof state.sideChatInput === 'string' ? state.sideChatInput : '',
    sideChatAttachments: Array.isArray(state.sideChatAttachments)
      ? (state.sideChatAttachments as DesktopComposerAttachment[])
      : [],
    review: validateReviewTabUiState(state.review),
  }
}

function validateReviewTabUiState(value: unknown): ReviewTabUiState {
  const defaults = createDefaultReviewTabUiState()
  if (!isRecord(value)) return defaults
  const source = validateReviewSource(value.source)
  return {
    source: source ?? defaults.source,
    selectedFile: typeof value.selectedFile === 'string' ? value.selectedFile : null,
    selectedCommentId: typeof value.selectedCommentId === 'string' ? value.selectedCommentId : null,
    scrollTop: toFiniteNonNegativeNumber(value.scrollTop),
    diffExpansion: validateReviewDiffExpansion(value.diffExpansion, defaults.diffExpansion),
    viewedRevisions: normalizeStringRecord(value.viewedRevisions),
    fileTreeVisible:
      typeof value.fileTreeVisible === 'boolean' ? value.fileTreeVisible : defaults.fileTreeVisible,
    fileTreeWidth:
      typeof value.fileTreeWidth === 'number' &&
      Number.isFinite(value.fileTreeWidth) &&
      value.fileTreeWidth > 0
        ? value.fileTreeWidth
        : defaults.fileTreeWidth,
    diffMode:
      value.diffMode === 'split' || value.diffMode === 'inline'
        ? value.diffMode
        : defaults.diffMode,
    wrapLines: typeof value.wrapLines === 'boolean' ? value.wrapLines : defaults.wrapLines,
    showWordDiff:
      typeof value.showWordDiff === 'boolean' ? value.showWordDiff : defaults.showWordDiff,
    hideWhitespace:
      typeof value.hideWhitespace === 'boolean' ? value.hideWhitespace : defaults.hideWhitespace,
    loadFullFiles:
      typeof value.loadFullFiles === 'boolean' ? value.loadFullFiles : defaults.loadFullFiles,
    hideImports: typeof value.hideImports === 'boolean' ? value.hideImports : defaults.hideImports,
    richPreview: typeof value.richPreview === 'boolean' ? value.richPreview : defaults.richPreview,
  }
}

function validateReviewDiffExpansion(
  value: unknown,
  fallback: ReviewDiffExpansion,
): ReviewDiffExpansion {
  if (!isRecord(value)) return fallback
  if (value.mode === 'all' || value.mode === 'none') {
    return { mode: value.mode }
  }
  if (value.mode !== 'custom') return fallback
  const expandedFiles = normalizeStringList(value.expandedFiles)
  return expandedFiles.length > 0 ? { mode: 'custom', expandedFiles } : { mode: 'none' }
}

function validateReviewSource(value: unknown): DesktopReviewSource | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'uncommitted' || value.kind === 'unstaged' || value.kind === 'staged') {
    return { kind: value.kind }
  }
  if (value.kind === 'branch' && typeof value.baseBranch === 'string') {
    return { kind: 'branch', baseBranch: value.baseBranch }
  }
  if (value.kind === 'commit' && typeof value.commitSha === 'string') {
    return { kind: 'commit', commitSha: value.commitSha }
  }
  if (
    value.kind === 'last-turn' &&
    typeof value.threadId === 'string' &&
    typeof value.turnId === 'string'
  ) {
    return {
      kind: 'last-turn',
      threadId: value.threadId,
      turnId: value.turnId,
    }
  }
  if (
    value.kind === 'pull-request' &&
    typeof value.owner === 'string' &&
    typeof value.repository === 'string' &&
    Number.isSafeInteger(value.number) &&
    Number(value.number) > 0
  ) {
    return {
      kind: 'pull-request',
      owner: value.owner,
      repository: value.repository,
      number: Number(value.number),
    }
  }
  return null
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function validateWorkbenchState(
  value: Record<string, unknown>,
  options: ConversationUiValidationOptions,
): WorkbenchTabsState {
  const rawTabs = isRecord(value.tabsById) ? value.tabsById : {}
  const tabsById: WorkbenchTabsState['tabsById'] = {}
  for (const candidate of Object.values(rawTabs)) {
    const tab = validateTabDescriptor(candidate, options)
    if (tab) tabsById[tab.id] = tab
  }

  const rawRight = readPanel(value.right)
  const rawBottom = readPanel(value.bottom)
  const ownership = resolveTabOwnership(rawRight, rawBottom, tabsById)
  const rightTabIds = [...rawRight.tabIds]
  for (const id of rawBottom.tabIds) {
    if (tabsById[id as WorkbenchTabId]?.kind !== 'terminal' && !rightTabIds.includes(id)) {
      rightTabIds.push(id)
    }
  }
  const right = validatePanel({ ...rawRight, tabIds: rightTabIds }, 'right', ownership, tabsById)
  const bottom = validatePanel(rawBottom, 'bottom', ownership, tabsById)
  const referencedIds = new Set([...right.tabIds, ...bottom.tabIds])
  for (const tabId of Object.keys(tabsById) as WorkbenchTabId[]) {
    if (!referencedIds.has(tabId)) delete tabsById[tabId]
  }

  const focusArea = validateFocusArea(value.focusArea, right, bottom)
  return {
    schemaVersion: 2,
    tabsById,
    right,
    bottom,
    rightFullWidth: false,
    restoreRightFullWidthOnNextOpen: false,
    focusArea,
    workspaceView: validateWorkspaceView(value.workspaceView, right),
  }
}

/**
 * 缺失 workspaceView 时由旧 right.open 推导；旧完整视图恢复为分屏，
 * 保留标签显隐与选中状态。
 */
function validateWorkspaceView(value: unknown, right: WorkbenchPanelSnapshot): WorkspaceView {
  const hasContent = right.tabIds.length > 0
  const inferred = inferWorkspaceView(right.open)
  const raw = isRecord(value) ? value : null
  const surfaceFromStore = (candidate: unknown): WorkspaceSurface | null =>
    candidate === 'chat' || candidate === 'content' ? candidate : null
  const selectedSurface = surfaceFromStore(raw?.selectedSurface) ?? inferred.selectedSurface
  const sidePanelSelectedSurface =
    surfaceFromStore(raw?.sidePanelSelectedSurface) ?? selectedSurface
  const tabsHidden = typeof raw?.tabsHidden === 'boolean' ? raw.tabsHidden : inferred.tabsHidden
  return {
    layoutMode: 'split',
    tabsHidden: hasContent ? tabsHidden : true,
    selectedSurface: hasContent && !tabsHidden ? selectedSurface : 'chat',
    sidePanelSelectedSurface,
  }
}

type RawPanel = {
  open: boolean
  activeTabId: string | null
  tabIds: string[]
}

function readPanel(value: unknown): RawPanel {
  if (!isRecord(value)) {
    return { open: false, activeTabId: null, tabIds: [] }
  }
  return {
    open: Boolean(value.open),
    activeTabId: typeof value.activeTabId === 'string' ? value.activeTabId : null,
    tabIds: Array.isArray(value.tabIds)
      ? value.tabIds.filter((id): id is string => typeof id === 'string')
      : [],
  }
}

function resolveTabOwnership(
  right: RawPanel,
  bottom: RawPanel,
  tabsById: WorkbenchTabsState['tabsById'],
): Map<string, WorkbenchPanelTarget> {
  const ownership = new Map<string, WorkbenchPanelTarget>()
  for (const id of right.tabIds) ownership.set(id, 'right')
  for (const id of bottom.tabIds) {
    if (tabsById[id as WorkbenchTabId]?.kind !== 'terminal') {
      ownership.set(id, 'right')
    } else if (!ownership.has(id) || (bottom.activeTabId === id && right.activeTabId !== id)) {
      ownership.set(id, 'bottom')
    }
  }
  return ownership
}

function validatePanel(
  panel: RawPanel,
  target: WorkbenchPanelTarget,
  ownership: ReadonlyMap<string, WorkbenchPanelTarget>,
  tabsById: WorkbenchTabsState['tabsById'],
): WorkbenchPanelSnapshot {
  const tabIds = panel.tabIds.filter(
    (id, index): id is WorkbenchTabId =>
      id in tabsById && ownership.get(id) === target && panel.tabIds.indexOf(id) === index,
  )
  return {
    open: panel.open,
    activeTabId:
      panel.activeTabId && tabIds.includes(panel.activeTabId as WorkbenchTabId)
        ? (panel.activeTabId as WorkbenchTabId)
        : (tabIds[tabIds.length - 1] ?? null),
    tabIds,
  }
}

function validateTabDescriptor(
  value: unknown,
  options: ConversationUiValidationOptions,
): WorkbenchTabDescriptor | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  const tab = value as Record<string, unknown>

  if (tab.id === 'review' && tab.kind === 'review') {
    return { id: 'review', kind: 'review' }
  }
  // Browser tabs are restored from Agent state, never per-conversation localStorage.
  if (tab.kind === 'browser') return null
  if (tab.id === 'file-browser' && tab.kind === 'file-browser') {
    const directoryPath =
      typeof tab.directoryPath === 'string' && isSafePath(tab.directoryPath, true)
        ? tab.directoryPath
        : undefined
    return {
      id: 'file-browser',
      kind: 'file-browser',
      ...(directoryPath ? { directoryPath } : {}),
    }
  }
  // Side chats are process-local and must never be restored from localStorage.
  if (tab.kind === 'terminal' && typeof tab.id === 'string') {
    return {
      id: tab.id as `terminal:${string}` | 'terminal',
      kind: 'terminal',
      ...(typeof tab.terminalId === 'string' ? { terminalId: tab.terminalId } : {}),
      ...(typeof tab.title === 'string' ? { title: tab.title } : {}),
    }
  }
  if (
    tab.kind === 'file-preview' &&
    typeof tab.id === 'string' &&
    tab.id.startsWith('file:') &&
    isSafePath(tab.workspacePath, false) &&
    isSafePath(tab.relativePath, true) &&
    (!options.workspacePath || sameWorkspacePath(tab.workspacePath, options.workspacePath))
  ) {
    const workspacePath = tab.workspacePath
    const fileScope = options.fileScopes?.find((scope) =>
      sameWorkspacePath(scope.workspacePath, workspacePath),
    )
    if (options.fileScopes && !fileScope) return null
    const viewState = readFileEditorViewState(tab.viewState)
    return {
      id: tab.id as `file:${string}`,
      kind: 'file-preview',
      workspacePath,
      ...(fileScope?.projectId
        ? { projectId: fileScope.projectId }
        : typeof tab.projectId === 'string'
          ? { projectId: tab.projectId }
          : {}),
      ...(fileScope?.folderId
        ? { folderId: fileScope.folderId }
        : typeof tab.folderId === 'string'
          ? { folderId: tab.folderId }
          : {}),
      relativePath: tab.relativePath,
      preview: Boolean(tab.preview),
      ...(tab.markdownViewMode === 'rich' || tab.markdownViewMode === 'source'
        ? { markdownViewMode: tab.markdownViewMode }
        : {}),
      ...(viewState ? { viewState } : {}),
      ...(isPositiveInteger(tab.line) ? { line: tab.line } : {}),
      ...(isPositiveInteger(tab.column) ? { column: tab.column } : {}),
      ...(isPositiveInteger(tab.endLine) ? { endLine: tab.endLine } : {}),
      ...(isPositiveInteger(tab.endColumn) ? { endColumn: tab.endColumn } : {}),
    }
  }
  if (tab.kind === 'plan' && typeof tab.id === 'string' && typeof tab.title === 'string') {
    // 新标签携带聊天与计划项身份；更早持久化的标签只有 eventId 和正文快照。
    const planItemId =
      typeof tab.planItemId === 'string'
        ? tab.planItemId
        : typeof tab.eventId === 'string'
          ? tab.eventId
          : null
    const threadId = typeof tab.threadId === 'string' && tab.threadId ? tab.threadId : null
    const content =
      typeof tab.content === 'string' && tab.content.trim() ? tab.content : undefined
    // 旧标签可能既没有聊天身份也没有正文快照；保留它，渲染时再按事件回退查找。
    if (!planItemId) return null
    if (options.validPlanItemIds && !options.validPlanItemIds.includes(planItemId)) return null
    return {
      id: `plan:${planItemId}`,
      kind: 'plan',
      planItemId,
      threadId: threadId ?? '',
      title: tab.title,
      ...(content ? { content } : {}),
    }
  }
  if (
    tab.kind === 'side-task' &&
    typeof tab.id === 'string' &&
    tab.id.startsWith('side-task:') &&
    typeof tab.taskId === 'string' &&
    tab.taskId.length > 0 &&
    typeof tab.childThreadId === 'string' &&
    tab.childThreadId.length > 0 &&
    (!options.validSideTaskIds || options.validSideTaskIds.includes(tab.taskId))
  ) {
    return {
      id: tab.id as `side-task:${string}`,
      kind: 'side-task',
      taskId: tab.taskId,
      childThreadId: tab.childThreadId,
    }
  }

  return null
}

function sameWorkspacePath(left: string, right: string): boolean {
  return arePathsEqual(left, right)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function validateFocusArea(
  value: unknown,
  right: WorkbenchPanelSnapshot,
  bottom: WorkbenchPanelSnapshot,
): WorkbenchFocusArea {
  if (value === 'right-panel' && right.open) return value
  if (value === 'bottom-panel' && bottom.open) return value
  return 'main'
}

function isSafePath(value: unknown, requireRelative: boolean): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    return false
  }
  if (!requireRelative) return true
  const normalized = value.replaceAll('\\', '/')
  return (
    !normalized.startsWith('/') &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split('/').includes('..')
  )
}

function toFiniteNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function isPathInside(candidate: string, root: string): boolean {
  const normalizedCandidate = candidate.replaceAll('\\', '/').toLowerCase()
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()
  return (
    normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
  )
}
