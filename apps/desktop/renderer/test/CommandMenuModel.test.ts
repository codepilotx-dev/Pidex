import { describe, expect, test } from 'bun:test'
import {
  buildCommandMenuTasks,
  matchesTaskQuery,
  resolveCommandMenuShortcut,
  type CommandMenuShortcutEvent,
} from '../src/features/search/CommandMenuModel.js'
import type { SessionListItem } from '../src/UiTypes.js'

function session(id: string, overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id,
    sessionName: `任务 ${id}`,
    aiTitle: null,
    workspaceName: 'Pidex',
    workspacePath: 'F:\\CodeProject\\Pidex',
    permissionMode: 'default',
    model: null,
    thinkingMode: 'medium',
    hasSystemPrompt: false,
    hasAppendSystemPrompt: false,
    additionalDirectoryCount: 0,
    status: 'idle',
    createdAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  }
}

function shortcutEvent(
  key: string,
  overrides: Partial<CommandMenuShortcutEvent> = {},
): CommandMenuShortcutEvent {
  return {
    altKey: false,
    ctrlKey: true,
    defaultPrevented: false,
    isComposing: false,
    key,
    keyCode: key.charCodeAt(0),
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  }
}

describe('任务命令面板模型', () => {
  test('排除归档任务，保留目录顺序并截断到九条', () => {
    const sessions = [
      session('archived', { archivedAt: '2026-07-30T01:00:00.000Z' }),
      ...Array.from({ length: 11 }, (_, index) => session(`visible-${index}`)),
    ]

    const tasks = buildCommandMenuTasks(sessions, '')

    expect(tasks).toHaveLength(9)
    expect(tasks.map((task) => task.id)).toEqual(
      Array.from({ length: 9 }, (_, index) => `visible-${index}`),
    )
    expect(tasks.map((task) => task.shortcutLabel)).toEqual(
      Array.from({ length: 9 }, (_, index) => `Ctrl+${index + 1}`),
    )
  })

  test('按旧搜索字段匹配中文、英文与大小写', () => {
    const item = session('searchable', {
      sessionName: '数据库迁移',
      customTitle: 'Release Checklist',
      aiTitle: 'AI 标题',
      tag: 'Backend',
      gitBranch: 'codex/command-menu',
      summary: '统一任务入口',
      firstPrompt: '新增命令面板',
      prRepository: 'Pidex/desktop',
      prUrl: 'https://example.test/pull/42',
      workspaceName: '工作区 Alpha',
      workspacePath: 'F:\\Projects\\Alpha',
      createdAt: '2026-07-30T12:00:00.000Z',
      status: 'running',
    })

    for (const query of [
      '数据库',
      'release',
      'BACKEND',
      'COMMAND-MENU',
      '任务入口',
      '命令面板',
      'pidex/desktop',
      'PULL/42',
      '工作区',
      'projects\\alpha',
      '2026-07-30',
      'RUNNING',
    ]) {
      expect(matchesTaskQuery(item, query)).toBeTrue()
    }
    expect(matchesTaskQuery(item, '不存在的内容')).toBeFalse()
  })

  test('复用标题与侧栏状态派生', () => {
    const tasks = buildCommandMenuTasks(
      [
        session('waiting', {
          customTitle: '等待用户确认',
          status: 'running',
          unreadAt: '2026-07-30T12:00:00.000Z',
        }),
        session('unread', {
          unreadAt: '2026-07-30T12:00:00.000Z',
          status: 'running',
        }),
      ],
      '',
      new Set(['waiting']),
    )

    expect(tasks[0]).toMatchObject({
      title: '等待用户确认',
      workspaceName: 'Pidex',
      visualState: 'needs-input',
    })
    expect(tasks[1]?.visualState).toBe('running')
  })

  test('只在面板打开时解析当前可见任务编号', () => {
    const state = {
      hasWorkspace: true,
      menuOpen: true,
      taskCount: 2,
    }

    expect(resolveCommandMenuShortcut(shortcutEvent('1'), state)).toEqual({
      type: 'select-task',
      index: 0,
    })
    expect(resolveCommandMenuShortcut(shortcutEvent('3'), state)).toBeNull()
    expect(
      resolveCommandMenuShortcut(shortcutEvent('1'), {
        ...state,
        menuOpen: false,
      }),
    ).toBeNull()
  })

  test('解析打开与推荐动作，并在无工作区时禁用搜索文件', () => {
    const closed = {
      hasWorkspace: true,
      menuOpen: false,
      taskCount: 0,
    }

    expect(resolveCommandMenuShortcut(shortcutEvent('k'), closed)).toEqual({
      type: 'open-menu',
    })
    expect(resolveCommandMenuShortcut(shortcutEvent('P', { shiftKey: true }), closed)).toEqual({
      type: 'open-menu',
    })
    expect(resolveCommandMenuShortcut(shortcutEvent('n'), closed)).toEqual({
      type: 'create-task',
    })
    expect(resolveCommandMenuShortcut(shortcutEvent('o'), closed)).toEqual({
      type: 'open-folder',
    })
    expect(resolveCommandMenuShortcut(shortcutEvent('p'), closed)).toEqual({
      type: 'search-files',
    })
    expect(
      resolveCommandMenuShortcut(shortcutEvent('p'), {
        ...closed,
        hasWorkspace: false,
      }),
    ).toBeNull()
    expect(
      resolveCommandMenuShortcut(shortcutEvent('k'), {
        ...closed,
        menuOpen: true,
      }),
    ).toEqual({ type: 'focus-query' })
  })

  test('忽略输入法、重复按键、已处理事件和其他业务对话框', () => {
    const state = {
      hasWorkspace: true,
      menuOpen: false,
      taskCount: 0,
    }

    expect(resolveCommandMenuShortcut(shortcutEvent('k', { isComposing: true }), state)).toBeNull()
    expect(resolveCommandMenuShortcut(shortcutEvent('k', { keyCode: 229 }), state)).toBeNull()
    expect(resolveCommandMenuShortcut(shortcutEvent('k', { repeat: true }), state)).toBeNull()
    expect(
      resolveCommandMenuShortcut(shortcutEvent('k', { defaultPrevented: true }), state),
    ).toBeNull()
    expect(
      resolveCommandMenuShortcut(shortcutEvent('k'), {
        ...state,
        hasOtherDialogOpen: true,
      }),
    ).toBeNull()
  })
})
