import { expect, test } from 'bun:test'
import { createDesktopSettingsDraft } from '../src/features/settings/UseDesktopSettings.js'
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from '../shared/SettingsSchema.js'
import {
  archivedGroups,
  deleteArchivedSessions,
} from '../src/features/settings/ArchivedConversationsModel.js'
import type { SessionListItem } from '../src/UiTypes.js'

test('按字段保存往返保留新设置，不提交其他页草稿或覆盖保存期间的新输入', async () => {
  let saved = defaultDesktopStoredSettings()
  let finish!: () => void
  const draft = createDesktopSettingsDraft(saved, async (next) => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    saved = normalizeDesktopStoredSettings(next)
    return saved
  })
  draft.setValue('worktreeRoot', 'F:/managed')
  draft.setValue('worktreeFetchUpstream', true)
  draft.setValue('gitBranchPrefix', 'feature/')
  const request = draft.saveFields(['worktreeRoot', 'worktreeFetchUpstream'])
  draft.setValue('worktreeRoot', 'F:/newer')
  finish()
  await request
  expect(saved.worktreeRoot).toBe('F:/managed')
  expect(saved.worktreeFetchUpstream).toBe(true)
  expect(saved.gitBranchPrefix).toBe(defaultDesktopStoredSettings().gitBranchPrefix)
  expect(draft.values.worktreeRoot).toBe('F:/newer')
  expect(draft.values.gitBranchPrefix).toBe('feature/')
  expect(draft.dirty).toBe(true)
})

test('归档投影搜索、项目/定时分类与创建/更新时间排序', () => {
  const item = (id: string, extra: Partial<SessionListItem>) =>
    ({
      id,
      sessionName: id,
      workspaceName: '项目',
      projectId: 'project',
      archivedAt: '2026-10-08',
      createdAt: '2026-01-01',
      lastMessageAt: '2026-02-01',
      ...extra,
    }) as SessionListItem
  const sessions = [
    item('B', { createdAt: '2026-03-01' }),
    item('A', { lastMessageAt: '2026-05-01' }),
    item('task', { projectId: null, isScheduledSession: true }),
    item('active', { archivedAt: null }),
  ]
  expect(
    archivedGroups(sessions, '', 'project', 'updated')[0]!.sessions.map((item) => item.id),
  ).toEqual(['A', 'B'])
  expect(
    archivedGroups(sessions, '', 'project', 'created')[0]!.sessions.map((item) => item.id),
  ).toEqual(['B', 'A'])
  expect(
    archivedGroups(sessions, 'TASK', 'scheduled', 'updated')[0]!.sessions.map((item) => item.id),
  ).toEqual(['task'])
  expect(archivedGroups(sessions, '', 'all', 'alphabetical')).toHaveLength(2)
})
test('归档批量部分失败只移除成功记录，保留失败项供重试', async () => {
  const result = await deleteArchivedSessions(['a', 'failed', 'b'], async (id) => {
    if (id === 'failed') throw new Error('删除失败')
  })
  expect([...result.removed]).toEqual(['a', 'b'])
  expect(result.failed).toBe(1)
})
