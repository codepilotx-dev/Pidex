import { describe, expect, test } from 'bun:test'
import type { DesktopWorkspace } from '../shared/Types.js'
import { sidebarProjectKey } from '../src/features/layout/sidebar/SidebarViewModel.js'
import {
  createSidebarDisclosureStore,
  sidebarProjectDisclosureKey,
  sidebarSectionDisclosureKey,
  type SidebarDisclosureSnapshot,
} from '../src/features/layout/sidebar/SidebarDisclosureStore.js'

describe('sidebar disclosure store', () => {
  for (const flushBeforeRefresh of [false, true]) {
    test(`preserves disclosure changes when adding projects (flushed: ${flushBeforeRefresh})`, () => {
      const project = { path: 'C:\\workspace\\alpha', name: 'Alpha' } as DesktopWorkspace
      const addedProject = { path: 'C:\\workspace\\beta', name: 'Beta' } as DesktopWorkspace
      const snapshots: SidebarDisclosureSnapshot[] = []
      const disclosure = createSidebarDisclosureStore(
        { collapsedSidebarSections: ['projects'], collapsedSidebarProjectPaths: [] },
        (snapshot) => snapshots.push(snapshot),
      )
      disclosure.registerProjects([project])
      disclosure.store.setExpanded(sidebarSectionDisclosureKey('projects'), true)
      disclosure.setProjectExpanded(project, false)
      if (flushBeforeRefresh) disclosure.store.flush()

      disclosure.registerProjects([project, addedProject])

      expect(disclosure.store.getSnapshot(sidebarSectionDisclosureKey('projects'))).toBe(true)
      expect(disclosure.store.getSnapshot(sidebarProjectDisclosureKey(project))).toBe(false)
      expect(disclosure.store.getSnapshot(sidebarProjectDisclosureKey(addedProject))).toBe(true)
      expect(snapshots).toEqual([
        { collapsedSidebarSections: [], collapsedSidebarProjectPaths: [sidebarProjectKey(project)] },
      ])
      disclosure.store.destroy()
    })
  }

  test('normalizes known project aliases and preserves unknown collapsed entries', () => {
    const project = {
      path: 'C:\\workspace\\alpha',
      name: 'Alpha',
    } as DesktopWorkspace
    const snapshots: SidebarDisclosureSnapshot[] = []
    const disclosure = createSidebarDisclosureStore(
      {
        collapsedSidebarSections: ['projects'],
        collapsedSidebarProjectPaths: [project.path, 'unknown-project'],
      },
      (snapshot) => snapshots.push(snapshot),
    )
    disclosure.registerProjects([project])

    expect(disclosure.store.getSnapshot(sidebarSectionDisclosureKey('projects'))).toBe(false)
    expect(disclosure.store.getSnapshot(sidebarProjectDisclosureKey(project))).toBe(false)

    disclosure.store.setExpanded(sidebarSectionDisclosureKey('projects'), true)
    disclosure.setProjectExpanded(project, true)
    disclosure.store.flush()

    expect(snapshots).toEqual([
      {
        collapsedSidebarSections: [],
        collapsedSidebarProjectPaths: ['unknown-project'],
      },
    ])
  })
})
