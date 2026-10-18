import { useCallback, useEffect, useState } from 'react'
import type { DesktopWorkspace } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { toUserErrorMessage } from '../../../utils/Errors.js'
import { subscribeProjectCatalogChanges } from '../../projects/ProjectCatalogEvents.js'

export type SidebarProjectCatalogState =
  | { status: 'loading'; projects: readonly DesktopWorkspace[] }
  | { status: 'ready'; projects: readonly DesktopWorkspace[] }
  | {
      status: 'unavailable'
      projects: readonly DesktopWorkspace[]
      error?: string
    }

export function useSidebarProjectCatalog({
  onReport,
  onError,
}: {
  onReport?: (message: string) => void
  onError?: (message: string) => void
} = {}): {
  projectCatalogState: SidebarProjectCatalogState
  removeCatalogProject: (project: DesktopWorkspace) => void
} {
  const [projectCatalogState, setProjectCatalogState] = useState<SidebarProjectCatalogState>({
    status: 'loading',
    projects: [],
  })

  useEffect(() => {
    let cancelled = false
    let requestVersion = 0
    const refreshProjects = (): void => {
      const currentRequest = ++requestVersion
      void desktopClient
        .listProjects()
        .then((projects) => {
          if (cancelled || currentRequest !== requestVersion) return
          setProjectCatalogState({ status: 'ready', projects })
        })
        .catch((error) => {
          if (cancelled || currentRequest !== requestVersion) return
          const message = toUserErrorMessage(error, 'project-list')
          setProjectCatalogState((current) => ({
            status: 'unavailable',
            projects: current.projects,
          }))
          if (onError) {
            onError(message)
          } else if (onReport) {
            onReport(message)
          }
        })
    }

    refreshProjects()
    const unsubscribe = subscribeProjectCatalogChanges(refreshProjects)
    // 用户在资源管理器里增删目录不会产生项目事件，重新聚焦/可见时补一次探测。
    let lastFocusRefreshAt = 0
    const refreshOnFocus = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastFocusRefreshAt < 1_000) return
      lastFocusRefreshAt = now
      refreshProjects()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)
    return () => {
      cancelled = true
      unsubscribe()
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [onReport, onError])

  const removeCatalogProject = useCallback((target: DesktopWorkspace): void => {
    setProjectCatalogState((current) => ({
      ...current,
      projects: current.projects.filter((project) =>
        target.projectId ? project.projectId !== target.projectId : project.path !== target.path,
      ),
    }))
  }, [])

  return { projectCatalogState, removeCatalogProject }
}

export function mergeCatalogProjects(
  catalogProjects: readonly DesktopWorkspace[],
  recentWorkspaces: readonly DesktopWorkspace[],
): DesktopWorkspace[] {
  const recentByKey = new Map(recentWorkspaces.map((project) => [projectKey(project), project]))
  const merged = catalogProjects.map((project) => {
    const recent = recentByKey.get(projectKey(project))
    recentByKey.delete(projectKey(project))
    return {
      ...recent,
      ...project,
      pinnedAt: recent?.pinnedAt ?? project.pinnedAt ?? null,
    }
  })
  return [...merged, ...recentByKey.values()]
}

function projectKey(project: DesktopWorkspace): string {
  return project.projectId
    ? `id:${project.projectId}`
    : `path:${project.path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()}`
}
