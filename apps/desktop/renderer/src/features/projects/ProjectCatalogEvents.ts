type ProjectCatalogListener = () => void
import type { DesktopWorkspace } from '../../../shared/Types.js'

type Removal = { project: DesktopWorkspace; removalOperationId: string; undoExpiresAt: number }
const removalListeners = new Set<(removal: Removal) => void>()
const restoreListeners = new Set<(project: DesktopWorkspace, selected: boolean) => void>()

export function notifyProjectRemoved(removal: Removal): void {
  for (const listener of removalListeners) listener(removal)
}
export function subscribeProjectRemovals(listener: (removal: Removal) => void): () => void {
  removalListeners.add(listener)
  return () => {
    removalListeners.delete(listener)
  }
}
export function notifyProjectRestored(project: DesktopWorkspace, selected: boolean): void {
  for (const listener of restoreListeners) listener(project, selected)
  notifyProjectCatalogChanged()
}
export function subscribeProjectRestores(
  listener: (project: DesktopWorkspace, selected: boolean) => void,
): () => void {
  restoreListeners.add(listener)
  return () => {
    restoreListeners.delete(listener)
  }
}

const projectCatalogListeners = new Set<ProjectCatalogListener>()

export function notifyProjectCatalogChanged(): void {
  for (const listener of projectCatalogListeners) {
    listener()
  }
}

export function subscribeProjectCatalogChanges(listener: ProjectCatalogListener): () => void {
  projectCatalogListeners.add(listener)
  return () => projectCatalogListeners.delete(listener)
}
