import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ThreadPullRequestState } from '@pidex/shared/thread'
import { SidebarSessionGroup } from '../src/features/layout/sidebar/SidebarSessionGroup.js'
import { SidebarHoverCardProvider } from '../src/features/layout/sidebar/SidebarHoverCard.js'
import { DesktopSettingsProvider } from '../src/features/settings/UseDesktopSettings.js'
import { mockSessionSnapshot, mockWorkspace } from '../src/services/desktop-client/Fixtures.js'
import type { SessionListItem } from '../src/UiTypes.js'
import {
  applyThreadPullRequestList,
  threadPullRequestStore,
} from '../src/features/layout/sidebar/ThreadPullRequestStore.js'
import { threadPullRequestVisual } from '../src/features/layout/sidebar/ThreadPullRequestPresentation.js'

function renderSessionRows(sessions: SessionListItem[]) {
  // 静态渲染读取 Zustand 的初始快照；夹具已在渲染前写入缓存。
  const getInitialState = threadPullRequestStore.getInitialState
  threadPullRequestStore.getInitialState = threadPullRequestStore.getState
  try {
    return renderToStaticMarkup(
      <DesktopSettingsProvider access="read-only">
        <SidebarHoverCardProvider>
          <SidebarSessionGroup
            activeSessionId={null}
            groupKey="pull-request"
            now={0}
            sessions={sessions}
            pendingPermissionSessionIds={new Set()}
            titleLoadingIds={new Set()}
            sessionFallbackTitles={{}}
            onArchiveSessions={async () => true}
            onPinSession={() => {}}
            onSelectSession={() => {}}
            onToggleSessionUnread={() => {}}
            onRenameSession={async () => true}
            onUnpinSession={() => {}}
          />
        </SidebarHoverCardProvider>
      </DesktopSettingsProvider>,
    )
  } finally {
    threadPullRequestStore.getInitialState = getInitialState
  }
}

test('pull request status maps to the documented color and Chinese copy', () => {
  const visual = (state: ThreadPullRequestState, reason = null, stale = false) =>
    threadPullRequestVisual({ state, reason, stale, checkedAt: 0 })

  expect(visual('merged')).toEqual({ className: 'tw:text-app-skill', label: '已合并' })
  expect(visual('closed').className).toBe('tw:text-app-danger')
  expect(visual('draft').className).toBe('tw:text-app-text-meta')
  expect(visual('conflicts').className).toBe('tw:text-app-danger')
  expect(visual('checks-failed').label).toBe('检查失败')
  expect(visual('mergeable').className).toBe('tw:text-app-success')
  expect(visual('checks-passing').label).toBe('检查通过，尚不可合并')
  expect(visual('waiting', 'checks-running')).toEqual({
    className: 'tw:text-app-warning',
    label: '等待中：检查进行中',
  })
  expect(visual('unknown', null, true)).toEqual({
    className: 'tw:text-app-text-meta',
    label: '状态未知／待刷新',
  })
})

test('sidebar marks the worktree environment and colors the primary pull request', () => {
  const project = mockWorkspace('C:\\sidebar-pr')
  const base = mockSessionSnapshot('pr', project, { workspacePath: project.path }).item
  const session: SessionListItem = {
    ...base,
    executionEnvironment: {
      kind: 'worktree',
      worktreeId: 'wt-1',
      cwd: project.path,
      branchName: 'feature',
      status: 'ready',
      revision: 1,
    },
  }
  applyThreadPullRequestList({
    threadId: session.id,
    items: [
      {
        owner: 'octocat',
        repository: 'fixture',
        number: 42,
        url: 'https://github.com/octocat/fixture/pull/42',
        title: 'Fix it',
        origin: 'manual',
        primary: true,
        status: { state: 'mergeable', reason: null, stale: false, checkedAt: 1 },
      },
    ],
  })

  const markup = renderSessionRows([session])
  expect(markup).toContain('工作树会话')
  expect(markup).toContain('aria-label="Pull Request #42"')
  expect(markup).toContain('tw:text-app-success')
  expect(markup).toContain('#42 Fix it · 可合并')
})

test('a local session without links shows neither the worktree nor the pull request marker', () => {
  const project = mockWorkspace('C:\\sidebar-no-pr')
  const base = mockSessionSnapshot('no-pr', project, { workspacePath: project.path }).item
  const markup = renderSessionRows([
    { ...base, executionEnvironment: { kind: 'local', cwd: project.path, revision: 1 } },
  ])
  expect(markup).not.toContain('工作树会话')
  expect(markup).not.toContain('Pull Request #')
})
