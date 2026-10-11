import type { DesktopWorkspace, SidebarSectionId } from '../../../../shared/Types.js'
import {
  createKeyedDisclosureStore,
  type KeyedDisclosureStore,
} from '../../../components/ui/KeyedDisclosureStore.js'
import { sidebarProjectKey } from './SidebarViewModel.js'

const SIDEBAR_SECTIONS: readonly SidebarSectionId[] = ['pinned', 'projects', 'recent']

export type SidebarDisclosureSnapshot = {
  collapsedSidebarSections: SidebarSectionId[]
  collapsedSidebarProjectPaths: string[]
}

export type SidebarDisclosureStore = {
  store: KeyedDisclosureStore
  registerProjects: (projects: readonly DesktopWorkspace[]) => void
  replace: (snapshot: SidebarDisclosureSnapshot) => void
  setProjectExpanded: (project: DesktopWorkspace, expanded: boolean) => void
}

export function sidebarSectionDisclosureKey(section: SidebarSectionId): string {
  return `section:${section}`
}

export function sidebarProjectDisclosureKey(project: DesktopWorkspace): string {
  return `project:${sidebarProjectKey(project)}`
}

export function createSidebarDisclosureStore(
  initial: SidebarDisclosureSnapshot,
  persist: (snapshot: SidebarDisclosureSnapshot) => void,
): SidebarDisclosureStore {
  let external = copySnapshot(initial)
  let projects: readonly DesktopWorkspace[] = []
  const knownProjectAliases = new Set<string>()

  const expandedKeys = (): string[] => [
    ...SIDEBAR_SECTIONS.filter(
      (section) => !external.collapsedSidebarSections.includes(section),
    ).map(sidebarSectionDisclosureKey),
    ...projects
      .filter((project) => !isProjectCollapsed(project, external.collapsedSidebarProjectPaths))
      .map(sidebarProjectDisclosureKey),
  ]

  const store = createKeyedDisclosureStore({
    initialExpandedKeys: expandedKeys(),
    persist: (keys) => {
      const expanded = new Set(keys)
      const unknownCollapsed = external.collapsedSidebarProjectPaths.filter(
        (key) => !knownProjectAliases.has(key),
      )
      persist({
        collapsedSidebarSections: SIDEBAR_SECTIONS.filter(
          (section) => !expanded.has(sidebarSectionDisclosureKey(section)),
        ),
        collapsedSidebarProjectPaths: [
          ...unknownCollapsed,
          ...projects
            .filter((project) => !expanded.has(sidebarProjectDisclosureKey(project)))
            .map(sidebarProjectKey),
        ],
      })
    },
  })

  return {
    store,
    registerProjects: (nextProjects) => {
      projects = nextProjects
      knownProjectAliases.clear()
      for (const project of projects) {
        knownProjectAliases.add(sidebarProjectKey(project))
        knownProjectAliases.add(project.path)
      }
      store.replace(expandedKeys())
    },
    replace: (snapshot) => {
      external = copySnapshot(snapshot)
      store.replace(expandedKeys())
    },
    setProjectExpanded: (project, expanded) => {
      store.setExpanded(sidebarProjectDisclosureKey(project), expanded)
    },
  }
}

function isProjectCollapsed(project: DesktopWorkspace, collapsed: readonly string[]): boolean {
  return collapsed.includes(sidebarProjectKey(project)) || collapsed.includes(project.path)
}

function copySnapshot(snapshot: SidebarDisclosureSnapshot): SidebarDisclosureSnapshot {
  return {
    collapsedSidebarSections: [...snapshot.collapsedSidebarSections],
    collapsedSidebarProjectPaths: [...snapshot.collapsedSidebarProjectPaths],
  }
}
