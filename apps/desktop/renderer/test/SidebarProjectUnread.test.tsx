import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createKeyedDisclosureStore } from '../src/components/ui/KeyedDisclosureStore.js'
import { SidebarProjectGroup } from '../src/features/layout/sidebar/SidebarProjectGroup.js'
import { SidebarHoverCardProvider } from '../src/features/layout/sidebar/SidebarHoverCard.js'
import { sidebarProjectDisclosureKey } from '../src/features/layout/sidebar/SidebarDisclosureStore.js'
import {
  buildSidebarViewModel,
  sidebarProjectKey,
} from '../src/features/layout/sidebar/SidebarViewModel.js'
import { DesktopSettingsProvider } from '../src/features/settings/UseDesktopSettings.js'
import { mockSessionSnapshot, mockWorkspace } from '../src/services/desktop-client/Fixtures.js'
import type { SessionListItem } from '../src/UiTypes.js'

test('project with every folder missing greys session titles and hides new chat', () => {
  const project = {
    ...mockWorkspace('C:\\project-missing'),
    folders: [
      {
        id: 'folder-1',
        name: 'project-missing',
        path: 'C:\\project-missing',
        role: 'primary' as const,
        availability: 'missing' as const,
        order: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  }
  const store = createKeyedDisclosureStore({ initialExpandedKeys: [] })
  const session = mockSessionSnapshot('missing', project, { workspacePath: project.path }).item
  const markup = renderToStaticMarkup(
    <DesktopSettingsProvider access="read-only">
      <SidebarHoverCardProvider>
        <SidebarProjectGroup
          activeSessionId={null}
          bucket={
            buildSidebarViewModel({
              sessions: [session],
              sessionPins: {},
              recentWorkspaces: [project],
              removedWorkspaces: [],
              pendingPermissionSessionIds: new Set(),
            }).projectSessionBuckets.get(sidebarProjectKey(project)) ?? {
              allSessions: [],
              displaySessions: [],
              openCount: 0,
              unreadCount: 0,
            }
          }
          disclosureStore={store}
          isUnavailable
          now={0}
          pendingPermissionSessionIds={new Set()}
          titleLoadingIds={new Set()}
          project={project}
          sessionFallbackTitles={{}}
          workspace={null}
          onArchiveSessions={async () => true}
          onCreateSession={() => {}}
          onPinWorkspace={() => {}}
          onRemoveWorkspace={() => {}}
          onSelectSession={() => {}}
          onToggleSessionUnread={() => {}}
          onRenameSession={async () => true}
          onPinSession={() => {}}
          onUnpinSession={() => {}}
          onUnpinWorkspace={() => {}}
        />
      </SidebarHoverCardProvider>
    </DesktopSettingsProvider>,
  )
  expect(markup).toContain('sidebar-project-header--unavailable')
  expect(markup).toContain('sidebar-session-row--project-unavailable')
  // 全部目录缺失时，项目行下不渲染新建对话按钮。
  expect(markup).not.toContain('aria-label="新建对话"')
  expect(markup).not.toContain('title="新建对话"')
  store.destroy()
})

test('collapsed project unread follows its unpinned, unarchived list including hidden pages', () => {
  const project = mockWorkspace('C:\\project-unread')
  const store = createKeyedDisclosureStore({ initialExpandedKeys: [] })
  const base = mockSessionSnapshot('unread', project, { workspacePath: project.path }).item
  const unread = { ...base, unreadAt: '2026-09-05T00:00:00.000Z' }
  const render = (sessions: SessionListItem[], pinned = false) => {
    const model = buildSidebarViewModel({
      sessions,
      sessionPins: pinned ? { [unread.id]: unread.unreadAt } : {},
      recentWorkspaces: [project],
      removedWorkspaces: [],
      pendingPermissionSessionIds: new Set(),
    })
    const bucket = model.projectSessionBuckets.get(sidebarProjectKey(project)) ?? {
      allSessions: [],
      displaySessions: [],
      openCount: 0,
      unreadCount: 0,
    }
    return renderToStaticMarkup(
      <DesktopSettingsProvider access="read-only">
        <SidebarHoverCardProvider>
          <SidebarProjectGroup
            activeSessionId={null}
            bucket={bucket}
            disclosureStore={store}
            isUnavailable={false}
            now={0}
            pendingPermissionSessionIds={new Set()}
            titleLoadingIds={new Set()}
            project={project}
            sessionFallbackTitles={{}}
            workspace={null}
            onArchiveSessions={async () => true}
            onCreateSession={() => {}}
            onPinWorkspace={() => {}}
            onRemoveWorkspace={() => {}}
            onSelectSession={() => {}}
            onToggleSessionUnread={() => {}}
            onRenameSession={async () => true}
            onPinSession={() => {}}
            onUnpinSession={() => {}}
            onUnpinWorkspace={() => {}}
          />
        </SidebarHoverCardProvider>
      </DesktopSettingsProvider>,
    )
  }
  const marker = 'aria-label="项目内有未读会话"'
  try {
    expect(render([base])).not.toContain(marker)
    // 目录仍可用时保留新建对话入口，避免把按钮整体删掉。
    expect(render([base])).toContain('aria-label="新建对话"')
    expect(render([unread])).toContain(marker)
    store.setExpanded(sidebarProjectDisclosureKey(project), true)
    expect(render([unread])).not.toContain(marker)
    expect(unread.unreadAt).toBe('2026-09-05T00:00:00.000Z')
    store.setExpanded(sidebarProjectDisclosureKey(project), false)
    expect(render([unread], true)).not.toContain(marker)
    expect(render([unread])).toContain(marker)
    expect(render([{ ...unread, archivedAt: unread.unreadAt }])).not.toContain(marker)
    expect(render([{ ...unread, unreadAt: null }])).not.toContain(marker)
    expect(
      render([...Array.from({ length: 6 }, (_, i) => ({ ...base, id: `read-${i}` })), unread]),
    ).toContain(marker)
  } finally {
    store.destroy()
  }
})
