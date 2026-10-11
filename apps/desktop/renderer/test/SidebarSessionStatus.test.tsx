import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarSessionGroup } from '../src/features/layout/sidebar/SidebarSessionGroup.js'
import { SidebarStatusPill } from '../src/features/layout/sidebar/SidebarStatusPill.js'
import { SidebarHoverCardProvider } from '../src/features/layout/sidebar/SidebarHoverCard.js'
import { DesktopSettingsProvider } from '../src/features/settings/UseDesktopSettings.js'
import { mockSessionSnapshot, mockWorkspace } from '../src/services/desktop-client/Fixtures.js'
import { withSessionStatusOverride } from '../src/services/desktop-client/SessionStatusOverrides.js'
import type { SessionListItem } from '../src/UiTypes.js'

function renderSessionRows(
  sessions: SessionListItem[],
  pendingPermissionSessionIds: ReadonlySet<string> = new Set(),
  sessionIndent: 'content' | 'gutter' = 'content',
  activeSessionId: string | null = null,
) {
  return renderToStaticMarkup(
    <DesktopSettingsProvider access="read-only">
      <SidebarHoverCardProvider>
        <SidebarSessionGroup
          activeSessionId={activeSessionId}
          groupKey="status"
          sessionIndent={sessionIndent}
          now={0}
          sessions={sessions}
          pendingPermissionSessionIds={pendingPermissionSessionIds}
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
}

const INDICATOR_CLASS_TOKEN = /(?:^|\s)sidebar-indicator(?=\s|$)/

test('gutter session rows and show-more omit the leading spacer', () => {
  const project = mockWorkspace('C:\\sidebar-gutter')
  const base = mockSessionSnapshot('gutter', project, { workspacePath: project.path }).item
  const sessions = Array.from({ length: 11 }, (_, index) => ({ ...base, id: `gutter-${index}` }))
  const markup = renderSessionRows(sessions, new Set(), 'gutter')
  expect(markup).toContain('sidebar-row--no-leading')
  expect(markup).toContain('展开显示')
  expect(markup).not.toContain('sidebar-row-leading-spacer')
  expect(markup).toContain('tw:grid-cols-[minmax(0,1fr)_auto]')
  expect(renderSessionRows(sessions)).toContain('sidebar-row-leading-spacer')
})

/** 统计带 `sidebar-indicator` 语义类的行尾状态槽数量（类名顺序无关）。 */
function countIndicatorSlots(markup: string): number {
  return [...markup.matchAll(/<span[^>]*class="([^"]*)"/g)].filter((match) =>
    INDICATOR_CLASS_TOKEN.test(match[1] ?? ''),
  ).length
}

test('sidebar approval replaces the spinner until the session resumes running', () => {
  const project = mockWorkspace('C:\\sidebar-status')
  const base = mockSessionSnapshot('status', project, { workspacePath: project.path }).item
  const render = (
    status: SessionListItem['status'],
    pending = false,
    latestTurnStatus: SessionListItem['latestTurnStatus'] = null,
  ) =>
    renderSessionRows(
      [{ ...base, status, latestTurnStatus, planModeActive: true, unreadAt: null }],
      new Set(pending ? [base.id] : []),
    )
  for (const approval of [render('waiting'), render('running', true)]) {
    expect(approval).toContain('sidebar-session-approval')
    expect(approval).not.toContain('sidebar-session-spinner')
    expect(countIndicatorSlots(approval)).toBe(0)
  }
  const running = render('running')
  expect(running).toContain('sidebar-session-spinner')
  expect(running).not.toContain('sidebar-session-approval')
  const question = render('running', false, 'waiting-question')
  expect(question).toContain('需要用户输入')
  expect(question).toContain('tw:bg-app-chart-blue/15')
  expect(question).not.toContain('等待批准')
  expect(question).not.toContain('sidebar-session-spinner')
  const permission = render('running', false, 'waiting-permission')
  expect(permission).toContain('等待批准')
  expect(permission).toContain('tw:bg-app-chart-green/20')
  expect(permission).not.toContain('需要用户输入')
  expect(render('running', true, 'waiting-question')).toContain('等待批准')
})

test('canonical completion clears a stale running indicator', () => {
  const project = mockWorkspace('C:\\sidebar-canonical')
  const base = mockSessionSnapshot('canonical', project, { workspacePath: project.path }).item
  const catalogSession = {
    ...base,
    status: 'running' as const,
    latestTurnStatus: 'running' as const,
    unreadAt: null,
  }

  // The catalog snapshot alone is what used to leave the row spinning forever.
  expect(renderSessionRows([catalogSession])).toContain('sidebar-session-spinner')

  // This is the status the session store publishes once the canonical projection
  // reports the terminal turn.
  const corrected = withSessionStatusOverride(catalogSession, {
    status: 'done',
    latestTurnStatus: 'completed',
  })
  const markup = renderSessionRows([corrected])
  expect(markup).not.toContain('sidebar-session-spinner')
  expect(countIndicatorSlots(markup)).toBe(0)
})

test('sidebar renders only occupied status icon slots in their existing order', () => {
  const project = mockWorkspace('C:\\sidebar-icons')
  const base = mockSessionSnapshot('icons', project, { workspacePath: project.path }).item
  for (const worktree of [false, true]) {
    for (const hasScheduledRun of [false, true]) {
      for (const isFork of [false, true]) {
        for (const state of ['idle', 'unread', 'running'] as const) {
          const markup = renderSessionRows([
            {
              ...base,
              executionEnvironment: worktree
                ? {
                    kind: 'worktree',
                    worktreeId: 'wt-1',
                    cwd: project.path,
                    branchName: 'feature',
                    status: 'ready',
                    revision: 1,
                  }
                : { kind: 'local', cwd: project.path, revision: 1 },
              hasScheduledRun,
              isFork,
              status: state === 'running' ? 'running' : 'done',
              unreadAt: state === 'unread' ? 1 : null,
            },
          ])
          // 尾部标记顺序固定为环境、Fork、日程、PR。
          const labels = [
            ...(worktree ? ['工作树会话'] : []),
            ...(isFork ? ['分叉会话'] : []),
            ...(hasScheduledRun ? ['日程运行过的会话'] : []),
            ...(state === 'unread' ? ['未读'] : state === 'running' ? ['处理中'] : []),
          ]
          expect(countIndicatorSlots(markup)).toBe(labels.length)
          expect(markup).not.toMatch(/<span[^>]*class="[^"]*sidebar-indicator[^"]*"[^>]*><\/span>/)
          const positions = labels.map((label) => markup.indexOf(`aria-label="${label}"`))
          expect(positions.every((position) => position >= 0)).toBe(true)
          expect(positions).toEqual([...positions].sort((a, b) => a - b))
        }
      }
    }
  }
})

test('running takes precedence over unread and waiting transitions preserve unread', () => {
  const project = mockWorkspace('C:\\sidebar-precedence')
  const base = mockSessionSnapshot('precedence', project, { workspacePath: project.path }).item
  const render = (
    status: SessionListItem['status'],
    latestTurnStatus: SessionListItem['latestTurnStatus'],
  ) => renderSessionRows([{ ...base, status, latestTurnStatus, unreadAt: 1 }])
  const running = render('running', 'running')
  expect(running).toContain('处理中')
  expect(running).not.toContain('sidebar-unread-dot')
  expect(running).toContain('sidebar-status-icon tw:inline-flex tw:size-5')
  expect(running).toContain('tw:text-app-text/70')
  expect(render('running', 'waiting-question')).toContain('需要用户输入')
  expect(render('running', 'waiting-permission')).toContain('等待批准')
  const complete = render('done', 'completed')
  expect(complete).toContain('sidebar-unread-dot tw:size-2')
  expect(complete).not.toContain('sidebar-session-spinner')
})

test('active input request hides its pill without hiding unread or approvals', () => {
  const project = mockWorkspace('C:\\sidebar-active-input')
  const base = mockSessionSnapshot('active-input', project, { workspacePath: project.path }).item
  const question = {
    ...base,
    status: 'running' as const,
    latestTurnStatus: 'waiting-question' as const,
  }
  const render = (unreadAt: number | null, pending = false) =>
    renderSessionRows(
      [{ ...question, unreadAt }],
      new Set(pending ? [base.id] : []),
      'content',
      base.id,
    )
  expect(render(null)).not.toContain('sidebar-status-pill')
  expect(render(null)).not.toContain('sidebar-session-spinner')
  expect(render(1)).toContain('sidebar-unread-dot')
  expect(render(1)).not.toContain('sidebar-session-input')
  expect(render(null, true)).toContain('等待批准')
})

test('status pill progress and snooze are presentation-only opt-ins', () => {
  const plain = renderToStaticMarkup(<SidebarStatusPill kind="input" />)
  expect(plain).toContain('max-w-[150px]')
  expect(plain).toContain('tw:truncate')
  expect(plain).not.toContain('<button')
  expect(plain).not.toContain('sidebar-status-pill-progress')
  const scheduled = renderToStaticMarkup(
    <SidebarStatusPill
      kind="input"
      progress={{ deadlineMs: 60_000, durationMs: 60_000, nowMs: 30_000 }}
      onSnooze={() => {}}
    />,
  )
  expect(scheduled).toContain('<button')
  expect(scheduled).toContain('停用自动回答')
  expect(scheduled).toContain('>停用<')
  expect(scheduled).toContain('animation-delay:-30000ms')
  expect(scheduled).toContain('animation-duration:60000ms')
  expect(scheduled).toContain('animation-play-state:paused')
  const project = mockWorkspace('C:\\sidebar-no-snooze')
  const base = mockSessionSnapshot('no-snooze', project, { workspacePath: project.path }).item
  const row = renderSessionRows([
    { ...base, status: 'waiting', latestTurnStatus: 'waiting-question' },
  ])
  expect(row).not.toContain('sidebar-status-pill-progress')
  expect(row).not.toContain('停用自动回答')
})
