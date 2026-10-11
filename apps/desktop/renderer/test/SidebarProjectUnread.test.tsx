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
