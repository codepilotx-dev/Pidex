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
import { useDesktopSettings } from '../settings/UseDesktopSettings.js'
import { useLocation } from 'react-router-dom'
import { desktopClient } from '../../services/desktop-client/index.js'
import { notifyProjectCatalogChanged } from '../projects/ProjectCatalogEvents.js'
import { useSidebarProjectCatalog } from '../layout/sidebar/UseSidebarProjectCatalog.js'
import { ReviewFileRequestCoordinator } from '../review/source/ReviewAgentClient.js'
import {
  gitBoardRefreshTargets,
  loadGitBoardRepository,
  type GitBoardRepository,
} from './GitBoardRepository.js'
import {
  GIT_BOARD_STORAGE_KEY,
  parseGitBoardState,
  gitBoardView,
  toggleGitBoardQuickView,
  type GitBoardState,
} from './GitBoardState.js'

export type { GitBoardRepository } from './GitBoardRepository.js'

function useGitBoardController() {
  const active = useLocation().pathname === '/git'
  const { settingsLoaded, draft } = useDesktopSettings()
  const hydrated = useRef(false)
  const [ready, setReady] = useState(false)
  const saveVersion = useRef(0)
  const [state, setState] = useState(() => parseGitBoardState(null))
  const [storageError, setStorageError] = useState(false)
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
    const stored = draft.values.gitBoardState
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
  }, [settingsLoaded, draft.values.gitBoardState, saveState])
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
  const [activeGroupId, openGroup] = useState<string | null>(null)
  const view = useMemo(() => gitBoardView(state, activeGroupId), [state, activeGroupId])
  const toggleQuickView = useCallback(
    (projectId: string) => {
      if (!stateRef.current.quickProjectIds.includes(projectId)) openGroup(null)
      update((current) => toggleGitBoardQuickView(current, projectId))
    },
    [update],
  )
  const [selectedRefs, setSelectedRefs] = useState<Record<string, string>>({})
  const [supportsCommitRef, setSupportsCommitRef] = useState(false)
  const selectBranch = useCallback((projectId: string, ref: string) => {
    sequence.current += 1
    setSelectedRefs((current) => ({ ...current, [projectId]: ref }))
    setRepositories((current) => {
      const repository = current[projectId]
      return repository
        ? {
            ...current,
            [projectId]: { ...repository, commits: undefined, historyError: undefined },
          }
        : current
    })
  }, [])
  const [repositories, setRepositories] = useState<Record<string, GitBoardRepository>>({})
  const reload = useRef<(projectIds?: readonly string[]) => void>(() => {})
  const [refreshing, setRefreshing] = useState(false)
  const coordinator = useRef(new ReviewFileRequestCoordinator(3))
  const sequence = useRef(0)
  const refresh = useCallback(() => {
    notifyProjectCatalogChanged()
    reload.current()
  }, [])
  const refreshView = useCallback(() => reload.current(view.projectIds), [view.projectIds])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let running = false
    const load = async (projectIds?: readonly string[]) => {
      if (running || document.visibilityState === 'hidden') return
      running = true
      setRefreshing(true)
      const request = ++sequence.current
      try {
        const capabilities = await desktopClient.getRuntimeCapabilities().catch(() => [])
        if (cancelled) return
        const supportsRef = capabilities.includes('git.review.commit-ref.v1')
        setSupportsCommitRef(supportsRef)
        const ordered = gitBoardRefreshTargets(projects, projectIds).sort(
          (a, b) =>
            Number(view.projectIds.includes(b.projectId!)) -
            Number(view.projectIds.includes(a.projectId!)),
        )
        await Promise.all(
          ordered.map((project) =>
            coordinator.current.schedule(`${request}:${project.projectId}`, async () => {
              if (cancelled) return
              const id = project.projectId!
              const repository = await loadGitBoardRepository(
                project,
                selectedRefs[id],
                supportsRef,
                view.projectIds.includes(id),
                () => cancelled || request !== sequence.current,
              )
              if (repository) setRepositories((current) => ({ ...current, [id]: repository }))
            }),
          ),
        )
      } finally {
        running = false
        if (!cancelled) setRefreshing(false)
      }
    }
    reload.current = load
    void load()
    const timer = window.setInterval(() => {
      void load()
    }, 15_000)
    const onFocus = () => {
      void load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      cancelled = true
      reload.current = () => {}
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [active, projects, view.projectIds, selectedRefs])

  return {
    state,
    ready,
    view,
    openGroup,
    toggleQuickView,
    update,
    storageError,
    projects,
    projectCatalogState,
    repositories,
    selectedRefs,
    selectBranch,
    supportsCommitRef,
    refreshing,
    refresh,
    refreshView,
  }
}

const GitBoardContext = createContext<ReturnType<typeof useGitBoardController> | null>(null)
export function GitBoardProvider({ children }: { children: ReactNode }) {
  const value = useGitBoardController()
  return <GitBoardContext.Provider value={value}>{children}</GitBoardContext.Provider>
}
export function useGitBoard() {
  const value = useContext(GitBoardContext)
  if (!value) throw new Error('GitBoardProvider required')
  return value
}
