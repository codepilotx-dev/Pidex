import { useStore } from 'zustand/react'
import type { StoreApi } from 'zustand/vanilla'
import { useControllerStore } from '../../hooks/UseControllerStore.js'
import { createStore } from 'zustand/vanilla'
import { useFieldState } from '../../hooks/UseFieldState.js'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ProtocolCapability } from '@pidex/agent-protocol'
import type { DesktopReviewSource, DesktopWorkspace } from '../../../shared/Types.js'
import type { SessionListItem } from '../../UiTypes.js'
import {
  useDesktopSettingsDraftActions,
  useDesktopSettingsDraftValue,
  useDesktopSettingsField,
} from '../settings/UseDesktopSettings.js'
import { useLocation } from 'react-router-dom'
import { desktopClient } from '../../services/desktop-client/index.js'
import { notifyProjectCatalogChanged } from '../projects/ProjectCatalogEvents.js'
import { useSidebarProjectCatalog } from '../layout/sidebar/UseSidebarProjectCatalog.js'
import {
  gitBoardCommitLimitFor,
  gitBoardPollingTargets,
  gitBoardRefreshTargets,
  loadGitBoardRepository,
  type GitBoardRepository,
} from './GitBoardRepository.js'
import {
  GitBoardLoadQueue,
  GitBoardRefreshTicker,
  orderGitBoardProjectsByActivity,
} from './GitBoardLoadQueue.js'
import {
  GIT_BOARD_STORAGE_KEY,
  parseGitBoardState,
  gitBoardView,
  toggleGitBoardQuickView,
  type GitBoardState,
} from './GitBoardState.js'

export type { GitBoardRepository } from './GitBoardRepository.js'

/**
 * Git 看板主区域的临时视图。
 * 只在组件内 state 中保存：既不属于分组持久化结构，也不写入 settings。
 * `board` 是现有的速览/分组看板，`github` 是常驻的 GitHub 仓库页。
 */
export type GitBoardRemoteView = 'board' | 'github'

/** 右侧详情当前选中的 Review 来源；侧栏提交行与主区域文件行共享同一份选中态。 */
export type GitBoardReviewSelection = {
  project: DesktopWorkspace
  source: DesktopReviewSource
  path?: string
}

/**
 * 需要加载仓库状态的去重集合：速览、所有自定义分组与主区域当前列。
 * 侧栏会渲染其中全部仓库，主区域只渲染 `view.projectIds`。
 */
export function gitBoardRepositoryIds(
  state: GitBoardState,
  viewProjectIds: readonly string[],
): string[] {
  const ids = new Set<string>()
  for (const id of state.quickProjectIds) ids.add(id)
  for (const group of state.groups) for (const id of group.projectIds) ids.add(id)
  for (const id of viewProjectIds) ids.add(id)
  return [...ids]
}

function useGitBoardController() {
  const active = useLocation().pathname === '/git'
  const settingsLoaded = useDesktopSettingsField((settings) => settings.settingsLoaded)
  const draft = useDesktopSettingsDraftActions()
  const gitBoardStateValue = useDesktopSettingsDraftValue('gitBoardState')
  const hydrated = useRef(false)
  const [stateStore] = useState(() =>
    createStore(() => ({
      ready: false,
      state: (() => parseGitBoardState(null))(),
      storageError: false,
      activeGroupId: null as string | null,
      selectedProjectId: null as string | null,
      remoteView: 'board' as GitBoardRemoteView,
      selectedRefs: {} as Record<string, string>,
      supportsCommitRef: false,
      capabilities: [] as readonly ProtocolCapability[],
      repositories: {} as Record<string, GitBoardRepository>,
      commitLimitByProject: {} as Record<string, number>,
      selectedReview: null as GitBoardReviewSelection | null,
      refreshing: false,
    })),
  )
  const [ready, setReady] = useFieldState(stateStore, 'ready')
  const saveVersion = useRef(0)
  const [state, setState] = useFieldState(stateStore, 'state')
  const [storageError, setStorageError] = useFieldState(stateStore, 'storageError')
  const stateRef = useRef(state)
  const saveState = useCallback(
    (next: GitBoardState) => {
      const version = ++saveVersion.current
      draft.setValue('gitBoardState', JSON.stringify(next))
      void draft
        .saveFields(['gitBoardState'])
        .then(() => {
          if (version === saveVersion.current) setStorageError(false)
        })
        .catch(() => {
          if (version === saveVersion.current) setStorageError(true)
        })
    },
    [draft.setValue, draft.saveFields],
  )
  useEffect(() => {
    if (!settingsLoaded || hydrated.current) return
    const stored = gitBoardStateValue
    let legacy: string | null = null
    try {
      legacy = window.localStorage.getItem(GIT_BOARD_STORAGE_KEY)
    } catch {
      /* Desktop settings remain available without browser storage. */
    }
    const next = parseGitBoardState(stored ?? legacy)
    hydrated.current = true
    stateRef.current = next
    setState(next)
    setReady(true)
    if (stored == null && legacy !== null) saveState(next)
  }, [settingsLoaded, gitBoardStateValue, saveState])
  const update = useCallback(
    (change: (current: GitBoardState) => GitBoardState) => {
      if (!hydrated.current) return
      const next = change(stateRef.current)
      stateRef.current = next
      setState(next)
      saveState(next)
    },
    [saveState],
  )
  const { projectCatalogState } = useSidebarProjectCatalog()
  const projects = useMemo(
    () => projectCatalogState.projects.filter((project) => project.projectId),
    [projectCatalogState.projects],
  )
  const [activeGroupId, setActiveGroupId] = useFieldState(stateStore, 'activeGroupId')
  const [selectedProjectId, setSelectedProjectId] = useFieldState(stateStore, 'selectedProjectId')
  const [remoteView, setRemoteView] = useFieldState(stateStore, 'remoteView')
  // 打开分组或选中项目时切回看板视图，不能与 GitHub 仓库页同时选中。
  const openGroup = useCallback((groupId: string | null) => {
    setActiveGroupId(groupId)
    setSelectedProjectId(groupId)
    setRemoteView('board')
  }, [])
  const selectProject = useCallback((projectId: string | null) => {
    setSelectedProjectId(projectId)
    setActiveGroupId(projectId)
    setRemoteView('board')
    setSelectedReview((current) => (current?.project.projectId === projectId ? current : null))
  }, [])
  const openRemoteView = useCallback(() => setRemoteView('github'), [])
  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )
  const view = useMemo(
    () =>
      selectedProjectId
        ? {
            id: selectedProjectId,
            name: selectedProject?.name ?? gitBoardView(state, activeGroupId).name,
            projectIds: [selectedProjectId],
          }
        : {
            id: null,
            name: 'Git 看板',
            projectIds: [] as string[],
          },
    [activeGroupId, selectedProject, selectedProjectId, state],
  )
  const toggleQuickView = useCallback(
    (projectId: string) => {
      if (!stateRef.current.quickProjectIds.includes(projectId)) openGroup(null)
      update((current) => toggleGitBoardQuickView(current, projectId))
    },
    [update],
  )
  const [selectedRefs, setSelectedRefs] = useFieldState(stateStore, 'selectedRefs')
  const selectedRefsRef = useRef(selectedRefs)
  const [supportsCommitRef, setSupportsCommitRef] = useFieldState(stateStore, 'supportsCommitRef')
  const [capabilities, setCapabilities] = useFieldState(stateStore, 'capabilities')
  const [repositories, setRepositories] = useFieldState(stateStore, 'repositories')
  /** 每仓库当前请求的提交条数；侧栏“展开显示”按需递增，切换分支时清零。 */
  const [commitLimitByProject, setCommitLimitByProject] = useFieldState(
    stateStore,
    'commitLimitByProject',
  )
  const commitLimitByProjectRef = useRef(commitLimitByProject)
  const [selectedReview, setSelectedReview] = useFieldState(stateStore, 'selectedReview')
  const [refreshing, setRefreshing] = useFieldState(stateStore, 'refreshing')
  /** 首次加载、自动刷新、手动刷新、切换分支与提交补拉共用的串行加载队列。 */
  const queueRef = useRef<GitBoardLoadQueue | null>(null)
  /** 能力探测结果与在途请求；每个页面会话只探测一次。 */
  const capabilitiesRef = useRef({ supportsCommitRef: false, supportsBranches: false })
  const capabilitiesRequestRef = useRef<Promise<void> | null>(null)
  /** 侧栏已有的未归档聊天列表，只用于计算项目活跃度，不额外请求聊天历史。 */
  const activitySessionsRef = useRef<readonly SessionListItem[]>([])
  const activityOrderRef = useRef<{
    projects: readonly DesktopWorkspace[]
    sessions: readonly SessionListItem[]
    rank: ReadonlyMap<string, number>
  } | null>(null)
  /**
   * 侧栏把已有的聊天列表登记给看板，仅用于活跃度排序；
   * 看板不额外请求聊天历史，也不新增活跃度存储。
   */
  const registerActivitySessions = useCallback((next: readonly SessionListItem[]) => {
    activitySessionsRef.current = next
  }, [])
  // 加载器读取最新目录/分组，但生命周期只跟随 /git 路由，避免目录变化取消逐列刷新。
  const repositoriesRef = useRef(repositories)
  useEffect(() => {
    repositoriesRef.current = repositories
  }, [repositories])
  const projectsRef = useRef(projects)
  const visibleProjectIdsRef = useRef(view.projectIds)
  /** 侧栏会渲染的全部仓库：速览 + 全部自定义分组 + 主区域当前列。 */
  const repositoryIds = useMemo(() => gitBoardRepositoryIds(state, view.projectIds), [state, view])
  const repositoryIdsRef = useRef(repositoryIds)
  const selectedReviewRef = useRef(selectedReview)
  useEffect(() => {
    projectsRef.current = projects
  }, [projects])
  useEffect(() => {
    visibleProjectIdsRef.current = view.projectIds
  }, [view.projectIds])
  useEffect(() => {
    repositoryIdsRef.current = repositoryIds
  }, [repositoryIds])
  useEffect(() => {
    selectedReviewRef.current = selectedReview
  }, [selectedReview])

  /** 复用侧栏排序的活跃度名次：数值越小，加载优先级越高。 */
  const activityRank = useCallback((projectId: string): number => {
    const currentProjects = projectsRef.current
    const sessions = activitySessionsRef.current
    const cached = activityOrderRef.current
    if (cached && cached.projects === currentProjects && cached.sessions === sessions) {
      return cached.rank.get(projectId) ?? Number.MAX_SAFE_INTEGER
    }
    const rank = new Map<string, number>()
    const ordered = orderGitBoardProjectsByActivity(currentProjects, sessions)
    for (const [index, project] of ordered.entries()) {
      if (project.projectId) rank.set(project.projectId, index)
    }
    activityOrderRef.current = { projects: currentProjects, sessions, rank }
    return rank.get(projectId) ?? Number.MAX_SAFE_INTEGER
  }, [])
  const ensureCapabilities = useCallback((): Promise<void> => {
    if (!capabilitiesRequestRef.current) {
      capabilitiesRequestRef.current = desktopClient
        .getRuntimeCapabilities()
        .then((available) => {
          const next = available as readonly ProtocolCapability[]
          capabilitiesRef.current = {
            supportsCommitRef: next.includes('git.review.commit-ref.v1'),
            supportsBranches: next.includes('git.review.v1'),
          }
          setCapabilities(next)
          setSupportsCommitRef(capabilitiesRef.current.supportsCommitRef)
        })
        .catch(() => {
          // 能力探测失败时允许下一个仓库重试，避免整页一直按缺失能力加载。
          capabilitiesRequestRef.current = null
        })
    }
    return capabilitiesRequestRef.current
  }, [])
  /** 按当前目录把仓库加入队列；projectIds 缺省表示全部项目。 */
  const requestProjects = useCallback(
    (projectIds: readonly string[] | undefined, manual: boolean): number => {
      const queue = queueRef.current
      if (!queue) return 0
      const ids = gitBoardRefreshTargets(projectsRef.current, projectIds).flatMap((project) =>
        project.projectId ? [project.projectId] : [],
      )
      return queue.requestAll(ids, { manual })
    },
    [],
  )
  const clearHistory = useCallback((projectId: string) => {
    setRepositories((current) => {
      const repository = current[projectId]
      return repository
        ? {
            ...current,
            [projectId]: { ...repository, commits: undefined, historyError: undefined },
          }
        : current
    })
    setSelectedReview((current) =>
      current?.project.projectId === projectId && current.source.kind === 'commit' ? null : current,
    )
  }, [])
  const reduceCommitLimit = useCallback((projectId: string) => {
    setCommitLimitByProject((current) => {
      if (current[projectId] === undefined) return current
      const next = { ...current }
      delete next[projectId]
      commitLimitByProjectRef.current = next
      return next
    })
  }, [])
  const selectBranch = useCallback(
    (projectId: string, ref: string) => {
      const nextSelectedRefs = { ...selectedRefsRef.current, [projectId]: ref }
      selectedRefsRef.current = nextSelectedRefs
      setSelectedRefs(nextSelectedRefs)
      clearHistory(projectId)
      reduceCommitLimit(projectId)
      const queue = queueRef.current
      if (!queue) return
      // 旧分支的在途响应作废，新分支加载排在当前仓库之后。
      queue.request(projectId, 'full', { manual: true, invalidate: true })
      setRefreshing(true)
    },
    [clearHistory, reduceCommitLimit],
  )
  /**
   * 只刷新指定仓库列；仅使该仓库的旧请求失效，不中断其他仓库加载。
   */
  const refreshProject = useCallback(
    (projectId: string, options: { branchChanged?: boolean } = {}) => {
      if (options.branchChanged) {
        const nextSelectedRefs = { ...selectedRefsRef.current }
        delete nextSelectedRefs[projectId]
        selectedRefsRef.current = nextSelectedRefs
        setSelectedRefs(nextSelectedRefs)
        clearHistory(projectId)
        reduceCommitLimit(projectId)
        notifyProjectCatalogChanged()
      }
      const queue = queueRef.current
      if (!queue) return
      queue.request(projectId, 'full', {
        manual: true,
        invalidate: options.branchChanged === true,
      })
      setRefreshing(true)
    },
    [clearHistory, reduceCommitLimit],
  )
  /**
   * 侧栏补拉：只在已加载条数不足时按 10 条步进提高单仓库上限，并只补拉该仓库历史。
   * 同一仓库已有完整刷新排队时由队列合并，不额外排一次历史请求。
   */
  const ensureCommitHistory = useCallback(
    (projectId: string, requiredCount: number, { manual = false }: { manual?: boolean } = {}) => {
      const requested = gitBoardCommitLimitFor(requiredCount)
      // 首次整页扫描已包含这些仓库，挂载侧栏时不再抢占同一仓库的完整加载。
      if (!repositoriesRef.current[projectId] && repositoryIdsRef.current.includes(projectId))
        return
      const loaded = repositoriesRef.current[projectId]?.commits?.length ?? 0
      const current = commitLimitByProjectRef.current[projectId]
      if (loaded >= requested || (current !== undefined && current >= requested)) return
      const next = { ...commitLimitByProjectRef.current, [projectId]: requested }
      commitLimitByProjectRef.current = next
      setCommitLimitByProject(next)
      queueRef.current?.request(projectId, 'history', { manual })
    },
    [],
  )
  /** 用户展开某个仓库的提交时，优先为该仓库加载后续提交。 */
  const expandCommitHistory = useCallback(
    (projectId: string, requiredCount: number) => {
      ensureCommitHistory(projectId, requiredCount, { manual: true })
    },
    [ensureCommitHistory],
  )
  const selectReview = useCallback((selection: GitBoardReviewSelection) => {
    setSelectedReview(selection)
  }, [])
  const clearReview = useCallback(() => setSelectedReview(null), [])
  const refresh = useCallback(() => {
    notifyProjectCatalogChanged()
    if (requestProjects(undefined, true) > 0) setRefreshing(true)
  }, [requestProjects])
  const refreshView = useCallback(() => {
    if (requestProjects(view.projectIds, true) > 0) setRefreshing(true)
  }, [requestProjects, view.projectIds])
  /**
   * GitHub 仓库页的刷新入口：由页面标题栏按钮调用，经 Context 下发给视图组件，
   * 避免用全局 window 事件在父子组件之间隐式传值。注册方只在本视图挂载时登记。
   */
  const githubRefresh = useRef<(() => void) | null>(null)
  const registerGithubRefresh = useCallback((handler: (() => void) | null) => {
    githubRefresh.current = handler
  }, [])
  const refreshGithubRepositories = useCallback(() => {
    githubRefresh.current?.()
  }, [])

  useEffect(() => {
    if (!active) return
    const queue = new GitBoardLoadQueue({
      activityRank,
      isActive: (projectId) =>
        visibleProjectIdsRef.current.includes(projectId) ||
        selectedReviewRef.current?.project.projectId === projectId,
      onIdle: () => setRefreshing(false),
      execute: async (task, isCurrent) => {
        await ensureCapabilities()
        if (!isCurrent()) return
        const project = projectsRef.current.find((item) => item.projectId === task.projectId)
        if (!project) return
        const id = task.projectId
        const previousRepository = repositoriesRef.current[id]
        const visible = visibleProjectIdsRef.current.includes(id)
        // 当前选中仓库及按需展开历史的仓库加载提交记录。
        const loadHistory =
          visible ||
          repositoryIdsRef.current.includes(id) ||
          commitLimitByProjectRef.current[id] !== undefined
        const repository = await loadGitBoardRepository(project, {
          selectedRef: selectedRefsRef.current[id],
          background: !task.manual,
          previousRepository,
          supportsCommitRef: capabilitiesRef.current.supportsCommitRef,
          supportsBranches: capabilitiesRef.current.supportsBranches,
          loadHistory,
          historyOnly: task.kind === 'history',
          refreshStatus: task.manual,
          commitLimit: commitLimitByProjectRef.current[id],
          visible,
          isCancelled: () => !isCurrent(),
        })
        if (!repository || !isCurrent()) return
        repositoriesRef.current = { ...repositoriesRef.current, [id]: repository }
        setRepositories(repositoriesRef.current)
      },
    })
    queueRef.current = queue
    capabilitiesRequestRef.current = null
    const dueTargets = () =>
      gitBoardPollingTargets(projectsRef.current, repositoriesRef.current).flatMap((project) =>
        project.projectId ? [project.projectId] : [],
      )
    const ticker = new GitBoardRefreshTicker(
      () => queue.requestDue(dueTargets()),
      () => document.visibilityState === 'hidden',
    )
    ticker.start()
    const onResume = () => ticker.resume()
    window.addEventListener('focus', onResume)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      window.removeEventListener('focus', onResume)
      document.removeEventListener('visibilitychange', onResume)
      ticker.stop()
      // 离开 Git 页面后停止计时与待执行任务，仍在返回的旧结果按队列失效丢弃。
      queue.dispose()
      if (queueRef.current === queue) queueRef.current = null
      capabilitiesRequestRef.current = null
      setRefreshing(false)
    }
  }, [active, activityRank, ensureCapabilities])

  // 目录重新读取但成员/路径未变时，不再强制重复扫描全部仓库。
  const projectTargetsKey = JSON.stringify(projects.map(({ projectId, path }) => [projectId, path]))
  useEffect(() => {
    if (!active || !ready) return
    requestProjects(undefined, false)
  }, [active, ready, projectTargetsKey, requestProjects])

  useEffect(() => {
    if (!active || !ready || !selectedProjectId) return
    queueRef.current?.request(selectedProjectId, 'full', { manual: false })
  }, [active, ready, selectedProjectId])

  return {
    state,
    ready,
    view,
    selectedProjectId,
    selectedProject,
    selectProject,
    remoteView,
    openGroup,
    openRemoteView,
    toggleQuickView,
    update,
    storageError,
    projects,
    projectCatalogState,
    repositories,
    selectedRefs,
    selectBranch,
    supportsCommitRef,
    capabilities,
    refreshing,
    refresh,
    refreshView,
    refreshGithubRepositories,
    registerGithubRefresh,
    refreshProject,
    commitLimitByProject,
    ensureCommitHistory,
    expandCommitHistory,
    selectedReview,
    selectReview,
    clearReview,
    registerActivitySessions,
  }
}

const GitBoardContext = createContext<StoreApi<ReturnType<typeof useGitBoardController>> | null>(
  null,
)
export function GitBoardProvider({ children }: { children: ReactNode }) {
  const controller = useGitBoardController()
  const value = useControllerStore(controller)
  return <GitBoardContext.Provider value={value}>{children}</GitBoardContext.Provider>
}
export function useGitBoard<T>(
  selector: (state: ReturnType<typeof useGitBoardController>) => T,
): T {
  const value = useContext(GitBoardContext)
  if (!value) throw new Error('GitBoardProvider required')
  return useStore(value, selector)
}
