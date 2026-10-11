import type {
  DesktopRemovedWorkspace,
  DesktopSidebarOrganization,
  DesktopWorkspace,
  SidebarCustomSection,
} from '../../../../shared/Types.js'
import type { SessionListItem } from '../../../UiTypes.js'
import { sortSessionsByRecency } from '../../session/state/SessionSorting.js'
import { normalizePathForComparison } from '../../../utils/PathUtils.js'

export type SidebarSessionVisualState = 'needs-input' | 'running' | 'unread' | 'idle'

export type SidebarPinnedItem =
  | {
      key: string
      kind: 'session'
      pinnedAt: string | null
      session: SessionListItem
    }
  | {
      key: string
      kind: 'project'
      pinnedAt: string | null
      project: DesktopWorkspace
    }

export type SidebarProjectSessionBucket = {
  allSessions: SessionListItem[]
  displaySessions: SessionListItem[]
  openCount: number
  unreadCount: number
}

export type SidebarViewModel = {
  allProjectSessions: SessionListItem[]
  customSections: SidebarCustomSectionModel[]
  pinnedSessions: SessionListItem[]
  pinnedWorkspaces: DesktopWorkspace[]
  projectSessionBuckets: ReadonlyMap<string, SidebarProjectSessionBucket>
  projectWorkspaces: DesktopWorkspace[]
  recentSessions: SessionListItem[]
  standaloneSessions: SessionListItem[]
  unpinnedSessions: SessionListItem[]
  visibleSessions: SessionListItem[]
  sessionStateById: Record<string, SidebarSessionVisualState>
}

export type SidebarFocusSectionId = 'priority' | 'pinned' | `day-${number}`

export type SidebarFocusSection = {
  id: SidebarFocusSectionId
  label: string
  sessions: SessionListItem[]
}

export type SidebarActivityIndicatorState = 'attention' | 'active' | 'idle'

export type SlicedSidebarTimelineModel = {
  prioritySessions: SessionListItem[]
  pinnedSessions: SessionListItem[]
  dateSections: SidebarFocusSection[]
  totalCount: number
  visibleCount: number
  hasMore: boolean
}

export type SidebarTimelineModel = {
  /** 所有需要关注的任务，不受置顶分组开关影响。 */
  attentionSessions: SessionListItem[]
  /** showPinned 为 true 时，从其余分组抽出的置顶任务。 */
  pinnedSessions: SessionListItem[]
  /** 实际显示在“优先级”分类中的关注任务。 */
  prioritySessions: SessionListItem[]
  dateSections: SidebarFocusSection[]
}

export function buildSidebarTimelineModel(input: {
  now: number
  sessions: readonly SessionListItem[]
  showPinned: boolean
  showPriority?: boolean
  snapshot?: SidebarActivitySnapshot
}): SidebarTimelineModel {
  const attention: SessionListItem[] = []
  const attentionRankById = new Map<string, number>()
  const pinned: SessionListItem[] = []
  const dayBuckets = new Map<number, SessionListItem[]>()

  for (const session of input.sessions) {
    if (session.archivedAt) continue
    const priorityRank = sidebarTimelinePriorityRank(session)
    if (
      input.showPriority !== false &&
      (priorityRank != null || input.snapshot?.priorityIds.includes(session.id))
    ) {
      attention.push(session)
      attentionRankById.set(session.id, priorityRank ?? 3)
      continue
    }
    if (input.showPinned && session.pinnedAt != null) {
      pinned.push(session)
      continue
    }
    const activityMs = input.snapshot?.recencyById.get(session.id) ?? sessionRecencyMs(session)
    if (activityMs <= 0) {
      // 时间无效的普通任务不进入时间线
      continue
    }
    let offset = localDayOrdinal(input.now) - localDayOrdinal(activityMs)
    if (offset < 0) offset = 0
    if (offset > 6) continue
    const bucket = dayBuckets.get(offset)
    if (bucket) {
      bucket.push(session)
    } else {
      dayBuckets.set(offset, [session])
    }
  }

  let prioritySessions = attention
  if (input.showPinned) {
    const pinnedAttention = attention.filter((session) => session.pinnedAt != null)
    if (pinnedAttention.length > 0) {
      pinned.push(...pinnedAttention)
      const pinnedAttentionIds = new Set(pinnedAttention.map((session) => session.id))
      prioritySessions = attention.filter((session) => !pinnedAttentionIds.has(session.id))
    }
  }

  const dateSections: SidebarFocusSection[] = []
  for (const offset of [...dayBuckets.keys()].sort((a, b) => a - b)) {
    const sessions = dayBuckets.get(offset) ?? []
    if (sessions.length === 0) continue
    const dayDate = new Date(input.now)
    dayDate.setDate(dayDate.getDate() - offset)
    dateSections.push({
      id: `day-${offset}`,
      label: labelForDayOffset(offset, dayDate),
      sessions: [...sessions].sort(
        (a, b) =>
          (input.snapshot?.recencyById.get(b.id) ?? sessionRecencyMs(b)) -
          (input.snapshot?.recencyById.get(a.id) ?? sessionRecencyMs(a)),
      ),
    })
  }
  return {
    attentionSessions: priorityOrder(attention),
    pinnedSessions: sortSessionsByRecency(pinned),
    prioritySessions: priorityOrder(prioritySessions),
    dateSections,
  }
  function priorityOrder(items: SessionListItem[]): SessionListItem[] {
    if (!input.snapshot) return sortPrioritySessions(items, attentionRankById)
    const positions = new Map(input.snapshot.priorityIds.map((id, index) => [id, index]))
    return [...items].sort(
      (a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity),
    )
  }
}

export type SidebarActivitySnapshot = {
  priorityIds: string[]
  recencyById: ReadonlyMap<string, number>
}

/** 保留本次活动视图的顺序与时间；状态仍由实时会话投影提供。 */
export function reconcileSidebarActivitySnapshot(
  previous: SidebarActivitySnapshot | null,
  sessions: readonly SessionListItem[],
  clearRead = false,
): SidebarActivitySnapshot {
  const visible = sessions.filter((session) => !session.archivedAt)
  const ids = new Set(visible.map((session) => session.id))
  const activeIds = new Set(
    visible
      .filter((session) => sidebarTimelinePriorityRank(session) != null)
      .map((session) => session.id),
  )
  const priorityIds =
    previous?.priorityIds.filter((id) => ids.has(id) && (!clearRead || activeIds.has(id))) ?? []
  const retained = new Set(priorityIds)
  const ranked = visible.filter(
    (session) => sidebarTimelinePriorityRank(session) != null && !retained.has(session.id),
  )
  const ranks = new Map(
    ranked.map((session) => [session.id, sidebarTimelinePriorityRank(session)!]),
  )
  priorityIds.push(...sortPrioritySessions(ranked, ranks).map((session) => session.id))
  return {
    priorityIds,
    recencyById: new Map(
      visible.map((session) => [
        session.id,
        (!clearRead ? previous?.recencyById.get(session.id) : undefined) ??
          sessionRecencyMs(session),
      ]),
    ),
  }
}

/** “全部标为已读”的目标集合：未读的关注任务。 */
export function sidebarAttentionUnreadSessions(
  sessions: readonly SessionListItem[],
): SessionListItem[] {
  return sessions.filter((session) => session.unreadAt != null)
}

/** 活动视图的来源筛选。 */
export function filterSidebarActivitySessions(
  sessions: readonly SessionListItem[],
  filters: {
    showWork?: boolean
    showChat?: boolean
  } = {},
): SessionListItem[] {
  const showWork = filters.showWork ?? true
  const showChat = filters.showChat ?? true
  return sessions.filter((session) => {
    if (session.archivedAt) return false
    const surface = session.creationSurface
    const isChat = surface === 'chat'
    const isWork =
      surface === 'coding' || surface === 'working' || surface === undefined || surface === null
    if (isChat && showChat) return true
    if (isWork && showWork) return true
    return false
  })
}

export function deriveSidebarActivityIndicatorState(
  sessions: readonly SessionListItem[],
): SidebarActivityIndicatorState {
  let hasActive = false
  for (const session of sessions) {
    if (session.archivedAt) continue
    const rank = sidebarTimelinePriorityRank(session)
    if (rank === 0 || rank === 1) {
      return 'attention'
    }
    if (rank === 2) {
      hasActive = true
    }
  }
  return hasActive ? 'active' : 'idle'
}

export function hasSidebarUnreadSessions(sessions: readonly SessionListItem[]): boolean {
  return sessions.some((session) => session.archivedAt == null && session.unreadAt != null)
}

export function sliceSidebarTimelineModel(
  model: SidebarTimelineModel,
  visibleLimit: number,
): SlicedSidebarTimelineModel {
  const limit = Math.max(0, visibleLimit)
  const totalCount =
    model.prioritySessions.length +
    model.pinnedSessions.length +
    model.dateSections.reduce((sum, section) => sum + section.sessions.length, 0)

  let remaining = limit
  let prioritySessions: SessionListItem[] = []
  if (remaining > 0 && model.prioritySessions.length > 0) {
    prioritySessions = model.prioritySessions.slice(0, remaining)
    remaining -= prioritySessions.length
  }

  let pinnedSessions: SessionListItem[] = []
  if (remaining > 0 && model.pinnedSessions.length > 0) {
    pinnedSessions = model.pinnedSessions.slice(0, remaining)
    remaining -= pinnedSessions.length
  }

  const dateSections: SidebarFocusSection[] = []
  for (const section of model.dateSections) {
    if (remaining <= 0) break
    const sliceCount = Math.min(remaining, section.sessions.length)
    if (sliceCount > 0) {
      dateSections.push({
        ...section,
        sessions: section.sessions.slice(0, sliceCount),
      })
      remaining -= sliceCount
    }
  }

  return {
    prioritySessions,
    pinnedSessions,
    dateSections,
    totalCount,
    visibleCount: limit - remaining,
    hasMore: totalCount > limit,
  }
}

/**
 * 时间线 visibleLimit 在 total 数据变更时的纯函数状态转换。
 *
 * 规则：
 * - 首次加载（previousTotal 未定义）：保留 currentLimit（组件初始 10）。
 * - 数据从较大值减小到较小值：clamp 到 nextTotal，避免越界后空白。
 * - 数据从 0 再次增长（之前被 clamp 到 0）：恢复到 initialLimit，避免永远停在 0。
 * - 数据增加或持平：保留 currentLimit。
 *
 * 筛选切换由组件单独 `setVisibleLimit(initialLimit)` 触发，不走本函数。
 */
export function clampTimelineVisibleLimit({
  previousTotal,
  nextTotal,
  currentLimit,
  initialLimit = 10,
}: {
  previousTotal: number | undefined
  nextTotal: number
  currentLimit: number
  initialLimit?: number
}): number {
  if (previousTotal === undefined) {
    return Math.max(0, currentLimit)
  }
  if (previousTotal > 0 && nextTotal === 0 && currentLimit > 0) {
    return 0
  }
  if (previousTotal === 0 && nextTotal > 0 && currentLimit === 0) {
    return initialLimit
  }
  if (nextTotal < previousTotal) {
    return Math.min(Math.max(0, currentLimit), nextTotal)
  }
  return Math.max(0, currentLimit)
}

export function sidebarArchivableAttentionSessions(
  sessions: readonly SessionListItem[],
): SessionListItem[] {
  return sessions.filter((session) => !session.archivedAt)
}

export function sidebarTimelinePriorityRank(session: SessionListItem): number | null {
  if (
    session.latestTurnStatus === 'waiting-question' ||
    session.latestTurnStatus === 'waiting-permission'
  ) {
    return 0
  }
  if (session.pendingPlanApproval === true) {
    return 0
  }
  if (session.unreadAt != null) return 1
  if (
    session.latestTurnStatus === 'running' ||
    session.latestTurnStatus === 'waiting-subagents' ||
    session.latestTurnStatus === 'queued'
  ) {
    return 2
  }
  return null
}

export function labelForDayOffset(offset: number, date: Date): string {
  if (offset === 0) return '今天'
  if (offset === 1) return '昨天'
  return `星期${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}`
}

export function localDayOrdinal(timestamp: number): number {
  const date = new Date(timestamp)
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
}

function sortPrioritySessions(
  sessions: readonly SessionListItem[],
  priorityRankById: ReadonlyMap<string, number>,
): SessionListItem[] {
  return [...sessions].sort((left, right) => {
    const leftRank = priorityRankById.get(left.id) ?? 4
    const rightRank = priorityRankById.get(right.id) ?? 4
    return (
      leftRank - rightRank ||
      sessionRecencyMs(right) - sessionRecencyMs(left) ||
      right.id.localeCompare(left.id)
    )
  })
}

export function buildSidebarViewModel({
  manualOrderByScope = {},
  organization = 'projects',
  showProjectsInRecents = false,
  showScheduledSessions = true,
  customSections = [],
  pendingPermissionSessionIds,
  recentWorkspaces,
  removedWorkspaces,
  sessionPins,
  sessions,
}: {
  manualOrderByScope?: Readonly<Record<string, readonly string[]>>
  organization?: DesktopSidebarOrganization
  showProjectsInRecents?: boolean
  showScheduledSessions?: boolean
  customSections?: readonly SidebarCustomSection[]
  pendingPermissionSessionIds: ReadonlySet<string>
  recentWorkspaces: readonly DesktopWorkspace[]
  removedWorkspaces: readonly DesktopRemovedWorkspace[]
  sessionPins: Readonly<Record<string, string>>
  sessions: readonly SessionListItem[]
}): SidebarViewModel {
  const visibleSessions = sessions
    .filter(
      (session) => !session.archivedAt && (showScheduledSessions || !session.isScheduledSession),
    )
    .map((session) => ({
      ...session,
      pinnedAt: sessionPins[session.id] ?? null,
    }))
  const pinnedSessions = visibleSessions
    .filter((session) => Boolean(session.pinnedAt))
    .sort((left, right) => timestampMs(right.pinnedAt) - timestampMs(left.pinnedAt))
  const pinnedIds = new Set(pinnedSessions.map((session) => session.id))
  const allProjects = mergeProjectWorkspaces(recentWorkspaces, visibleSessions, removedWorkspaces)
  const pinnedWorkspaces = allProjects
    .filter((project) => Boolean(project.pinnedAt))
    .sort(
      (left, right) =>
        timestampMs(right.pinnedAt) - timestampMs(left.pinnedAt) ||
        left.name.localeCompare(right.name) ||
        projectKey(left).localeCompare(projectKey(right)),
    )
  const pinnedProjectKeys = new Set(pinnedWorkspaces.map(projectKey))
  const customSectionModels = buildSidebarCustomSections({
    sections: customSections,
    sessions: visibleSessions,
    projects: allProjects,
  })
  const claimedKeys = sidebarClaimedItemKeys({
    pinnedItems: [
      ...pinnedSessions.map((session) => ({
        key: sidebarPinnedSessionKey(session),
        kind: 'session' as const,
        pinnedAt: session.pinnedAt ?? null,
        session,
      })),
      ...pinnedWorkspaces.map((project) => ({
        key: sidebarPinnedProjectKey(project),
        kind: 'project' as const,
        pinnedAt: project.pinnedAt ?? null,
        project,
      })),
    ],
    sections: customSections,
  })
  const inCustomSection = (session: SessionListItem): boolean =>
    claimedKeys.has(sidebarPinnedSessionKey(session))
  const unpinnedSessions = visibleSessions.filter(
    (session) => !pinnedIds.has(session.id) && !inCustomSection(session),
  )
  const standaloneSessions = unpinnedSessions.filter((session) => session.standalone)
  const allProjectSessions = visibleSessions.filter((session) => !session.standalone)
  const projectSessionBuckets = buildProjectSessionBuckets(allProjectSessions, unpinnedSessions)
  const recentSessions =
    organization === 'flat'
      ? unpinnedSessions.filter(
          (session) => session.standalone || !pinnedProjectKeys.has(sessionProjectKey(session)),
        )
      : showProjectsInRecents
        ? unpinnedSessions.filter(
            (session) => session.standalone || !pinnedProjectKeys.has(sessionProjectKey(session)),
          )
        : standaloneSessions
  const projectWorkspaces = sortProjectsForSidebar(
    allProjects.filter(
      (project) =>
        !pinnedProjectKeys.has(projectKey(project)) &&
        !claimedKeys.has(sidebarPinnedProjectKey(project)),
    ),
    {
      manualOrderByScope,
      scopeKey: 'projects',
      sessions: allProjectSessions,
    },
  )
  const sessionStateById = Object.fromEntries(
    visibleSessions.map((session) => [
      session.id,
      deriveSidebarSessionVisualState(session, pendingPermissionSessionIds),
    ]),
  )

  return {
    allProjectSessions,
    customSections: customSectionModels,
    pinnedSessions,
    pinnedWorkspaces,
    projectSessionBuckets,
    projectWorkspaces,
    recentSessions,
    standaloneSessions,
    unpinnedSessions,
    visibleSessions,
    sessionStateById,
  }
}

export function buildProjectSessionBuckets(
  allProjectSessions: readonly SessionListItem[],
  displaySessions: readonly SessionListItem[],
): ReadonlyMap<string, SidebarProjectSessionBucket> {
  const buckets = new Map<string, SidebarProjectSessionBucket>()
  const ensureBucket = (projectKey: string): SidebarProjectSessionBucket => {
    const existing = buckets.get(projectKey)
    if (existing) return existing
    const created: SidebarProjectSessionBucket = {
      allSessions: [],
      displaySessions: [],
      openCount: 0,
      unreadCount: 0,
    }
    buckets.set(projectKey, created)
    return created
  }

  for (const session of allProjectSessions) {
    if (session.standalone) continue
    const bucket = ensureBucket(sessionProjectKey(session))
    bucket.allSessions.push(session)
    if (session.unreadAt) bucket.unreadCount += 1
    if (isOpenProjectSession(session)) bucket.openCount += 1
  }

  for (const session of displaySessions) {
    if (session.standalone) continue
    ensureBucket(sessionProjectKey(session)).displaySessions.push(session)
  }

  for (const bucket of buckets.values()) {
    bucket.displaySessions.sort(
      (left, right) =>
        sessionRecencyMs(right) - sessionRecencyMs(left) || right.id.localeCompare(left.id),
    )
  }
  return buckets
}

export function countOpenProjectSessions(sessions: readonly SessionListItem[]): number {
  return sessions.filter(isOpenProjectSession).length
}

export function buildSidebarPinnedItems({
  pinnedSessions,
  pinnedWorkspaces,
  storedOrder,
}: {
  pinnedSessions: readonly SessionListItem[]
  pinnedWorkspaces: readonly DesktopWorkspace[]
  storedOrder: readonly string[]
}): SidebarPinnedItem[] {
  const sessionItems: SidebarPinnedItem[] = pinnedSessions.map((session) => ({
    key: sidebarPinnedSessionKey(session),
    kind: 'session',
    pinnedAt: session.pinnedAt ?? null,
    session,
  }))
  const projectItems: SidebarPinnedItem[] = pinnedWorkspaces.map((project) => ({
    key: sidebarPinnedProjectKey(project),
    kind: 'project',
    pinnedAt: project.pinnedAt ?? null,
    project,
  }))
  // 置顶区是聊天与项目的混合有序列表：新置顶按时间排在前面，
  // 已手动排序的条目沿用存储顺序，不再按类型分组。
  return orderPinnedItemGroup([...sessionItems, ...projectItems], storedOrder)
}

function orderPinnedItemGroup(
  items: readonly SidebarPinnedItem[],
  storedKeys: readonly string[],
): SidebarPinnedItem[] {
  const storedKeySet = new Set(storedKeys)
  const itemByKey = new Map(items.map((item) => [item.key, item]))
  return [
    ...items
      .filter((item) => !storedKeySet.has(item.key))
      .sort((left, right) => timestampMs(right.pinnedAt) - timestampMs(left.pinnedAt)),
    ...storedKeys.flatMap((key) => {
      const item = itemByKey.get(key)
      return item ? [item] : []
    }),
  ]
}

export function reorderSidebarPinnedItemKeys(
  items: readonly SidebarPinnedItem[],
  sourceKey: string,
  targetKey: string,
): string[] | null {
  if (sourceKey === targetKey) return null
  const source = items.find((item) => item.key === sourceKey)
  const target = items.find((item) => item.key === targetKey)
  if (!source || !target) return null
  const order = items.map((item) => item.key)
  const sourceIndex = order.indexOf(sourceKey)
  const targetIndex = order.indexOf(targetKey)
  if (sourceIndex < 0 || targetIndex < 0) return null
  const [moved] = order.splice(sourceIndex, 1)
  if (!moved) return null
  order.splice(targetIndex, 0, moved)
  return order
}

export type SidebarCustomSectionEntry =
  | { key: string; kind: 'session'; session: SessionListItem }
  | { key: string; kind: 'project'; project: DesktopWorkspace }

export type SidebarCustomSectionModel = {
  id: string
  title: string
  collapsed: boolean
  sort: 'manual' | 'updated'
  entries: SidebarCustomSectionEntry[]
}

/**
 * 解析自定义分组的可见条目。只展示仍然存在的条目；
 * 目录尚未加载或条目暂时缺失时保留原始键，不做删除。
 */
export function buildSidebarCustomSections({
  sections,
  sessions,
  projects,
}: {
  sections: readonly SidebarCustomSection[]
  sessions: readonly SessionListItem[]
  projects: readonly DesktopWorkspace[]
}): SidebarCustomSectionModel[] {
  const sessionByKey = new Map(
    sessions.map((session) => [sidebarPinnedSessionKey(session), session] as const),
  )
  const projectByKey = new Map(
    projects.map((project) => [sidebarPinnedProjectKey(project), project] as const),
  )
  return sections.map((section) => {
    const entries: SidebarCustomSectionEntry[] = []
    for (const key of section.itemKeys) {
      const session = sessionByKey.get(key)
      if (session) {
        entries.push({ key, kind: 'session', session })
        continue
      }
      const project = projectByKey.get(key)
      if (project) entries.push({ key, kind: 'project', project })
    }
    return {
      id: section.id,
      title: section.title,
      collapsed: section.collapsed,
      sort: section.sort,
      entries:
        section.sort === 'updated'
          ? [...entries].sort(
              (left, right) =>
                customSectionEntryRecencyMs(right) - customSectionEntryRecencyMs(left),
            )
          : entries,
    }
  })
}

/** 自定义分组条目用于“最近更新”排序的时间：项目按最近活动时间参与比较。 */
function customSectionEntryRecencyMs(entry: SidebarCustomSectionEntry): number {
  if (entry.kind === 'session') {
    return timestampMs(entry.session.lastMessageAt ?? entry.session.createdAt)
  }
  return timestampMs(entry.project.lastOpenedAt ?? entry.project.pinnedAt)
}

/** 自定义分组与置顶区共同决定条目的顶层归属，二者互斥。 */
export function sidebarClaimedItemKeys({
  pinnedItems,
  sections,
}: {
  pinnedItems: readonly SidebarPinnedItem[]
  sections: readonly SidebarCustomSection[]
}): Set<string> {
  const claimed = new Set(pinnedItems.map((item) => item.key))
  for (const section of sections) {
    for (const key of section.itemKeys) claimed.add(key)
  }
  return claimed
}

export function sidebarPinnedSessionKey(session: SessionListItem): string {
  return `session:${session.id}`
}

export function sidebarPinnedProjectKey(project: DesktopWorkspace): string {
  return `project:${sidebarProjectKey(project)}`
}

export function sortProjectsForSidebar(
  projects: readonly DesktopWorkspace[],
  {
    manualOrderByScope,
    scopeKey,
    sessions,
  }: {
    manualOrderByScope: Readonly<Record<string, readonly string[]>>
    scopeKey: string
    sessions: readonly SessionListItem[]
  },
): DesktopWorkspace[] {
  const projectMetrics = new Map<string, { latestActivity: number }>()
  for (const project of projects) {
    projectMetrics.set(projectKey(project), {
      latestActivity: timestampMs(project.lastOpenedAt),
    })
  }
  for (const session of sessions) {
    const metrics = projectMetrics.get(sessionProjectKey(session))
    if (!metrics) continue
    metrics.latestActivity = Math.max(
      metrics.latestActivity,
      timestampMs(session.lastMessageAt ?? session.createdAt),
    )
  }

  const byActivity = [...projects].sort((left, right) => {
    const leftMetrics = projectMetrics.get(projectKey(left))
    const rightMetrics = projectMetrics.get(projectKey(right))
    return (
      (rightMetrics?.latestActivity ?? 0) - (leftMetrics?.latestActivity ?? 0) ||
      left.name.localeCompare(right.name) ||
      projectKey(left).localeCompare(projectKey(right))
    )
  })
  return applyStoredProjectOrder(byActivity, manualOrderByScope[scopeKey] ?? [])
}

export function deriveSidebarSessionVisualState(
  session: SessionListItem,
  pendingPermissionSessionIds: ReadonlySet<string>,
): SidebarSessionVisualState {
  if (
    session.status === 'waiting' ||
    pendingPermissionSessionIds.has(session.id) ||
    session.latestTurnStatus === 'waiting-question' ||
    session.latestTurnStatus === 'waiting-permission'
  ) {
    return 'needs-input'
  }
  if (session.status === 'running') return 'running'
  if (session.unreadAt) return 'unread'
  return 'idle'
}

function mergeProjectWorkspaces(
  recentWorkspaces: readonly DesktopWorkspace[],
  sessions: readonly SessionListItem[],
  removedWorkspaces: readonly DesktopRemovedWorkspace[],
): DesktopWorkspace[] {
  const removedPaths = new Set(
    removedWorkspaces
      .filter((item) => !item.projectId && item.path)
      .map((item) => normalizePath(item.path)),
  )
  const removedProjectIds = new Set(
    removedWorkspaces.flatMap((item) => (item.projectId ? [item.projectId] : [])),
  )
  const byProject = new Map<string, DesktopWorkspace>()
  for (const workspace of recentWorkspaces) {
    if (
      !removedPaths.has(normalizePath(workspace.path)) &&
      !removedProjectIds.has(workspace.projectId ?? '')
    ) {
      byProject.set(projectKey(workspace), workspace)
    }
  }
  for (const session of sessions) {
    if (
      session.standalone ||
      removedPaths.has(normalizePath(session.workspacePath)) ||
      removedProjectIds.has(session.projectId ?? '') ||
      byProject.has(sessionProjectKey(session))
    ) {
      continue
    }
    byProject.set(sessionProjectKey(session), {
      projectId: session.projectId ?? undefined,
      name: session.workspaceName,
      path: session.workspacePath,
    })
  }
  return [...byProject.values()]
}

export function sidebarProjectKey(project: DesktopWorkspace): string {
  return project.projectId ? `id:${project.projectId}` : `path:${normalizePath(project.path)}`
}

function projectKey(project: DesktopWorkspace): string {
  return sidebarProjectKey(project)
}

export function sidebarSessionProjectKey(session: SessionListItem): string {
  return session.projectId
    ? `id:${session.projectId}`
    : `path:${normalizePath(session.workspacePath)}`
}

function sessionProjectKey(session: SessionListItem): string {
  return sidebarSessionProjectKey(session)
}

export function normalizeSidebarPath(value: string): string {
  return normalizePathForComparison(value)
}

function normalizePath(value: string): string {
  return normalizeSidebarPath(value)
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const result = new Date(value).getTime()
  return Number.isNaN(result) ? 0 : result
}

function sessionRecencyMs(session: SessionListItem): number {
  return timestampMs(session.lastMessageAt ?? session.createdAt)
}

function isOpenProjectSession(session: SessionListItem): boolean {
  return session.status === 'queued' || session.status === 'waiting' || session.status === 'running'
}

function applyStoredProjectOrder(
  projects: readonly DesktopWorkspace[],
  storedOrder: readonly string[],
): DesktopWorkspace[] {
  const projectByKey = new Map(projects.map((project) => [projectKey(project), project]))
  const storedKeys = new Set(storedOrder)
  return [
    ...projects.filter((project) => !storedKeys.has(projectKey(project))),
    ...storedOrder.flatMap((key) => {
      const project = projectByKey.get(key)
      return project ? [project] : []
    }),
  ]
}
