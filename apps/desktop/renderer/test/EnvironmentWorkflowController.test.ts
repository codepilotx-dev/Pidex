import { describe, expect, test } from 'bun:test'
import type { LocalEnvironmentActionMetadata, ManagedWorktree } from '@pidex/agent-protocol'
import { createEnvironmentDomainClient } from '../src/services/desktop-client/EnvironmentDomainClient.js'
import type { EnvironmentDomainClient } from '../src/services/desktop-client/EnvironmentDomainClient.js'
import type { DesktopTerminalClient } from '../src/services/desktop-client/TerminalClient.js'
import {
  listTerminalActions,
  runTerminalAction,
} from '../src/features/session/workflow/actions/TerminalActionController.js'
import {
  resumePendingHandoff,
  runHandoff,
} from '../src/features/session/workflow/handoff/HandoffController.js'
import {
  loadGitEnvironmentProjection,
  shouldResumePendingHandoff,
} from '../src/features/session/workflow/ConversationEnvironmentControls.js'
import {
  buildEnvironmentConfigEdits,
  environmentActionsValue,
  serializeEnvironmentActions,
} from '../src/features/settings/local-environment/LocalEnvironmentEditorModel.js'

const operation = (patch: Record<string, unknown> = {}) => ({
  operationId: 'handoff-1',
  sourceThreadId: 'source',
  targetThreadId: null,
  direction: 'local-to-worktree' as const,
  status: 'running' as const,
  step: 'preflight' as const,
  revision: 1,
  errorCode: null,
  warnings: [],
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
  ...patch,
})

describe('environment workflow controllers', () => {
  test('Handoff 先通过 Agent preflight，进入 stop-source 后才关闭 PTY，再复制 UI 并 ack', async () => {
    const order: string[] = []
    const waiting = operation({
      targetThreadId: 'target',
      status: 'await-client-transfer',
      step: 'await-client-transfer',
      revision: 9,
    })
    const client = {
      startHandoff: async () => {
        order.push('start')
        return { operation: operation() }
      },
      handoffStatus: async () => {
        order.push('status')
        return { operation: waiting, changed: true }
      },
      ackHandoff: async () => {
        order.push('ack')
        return {
          operation: operation({
            targetThreadId: 'target',
            status: 'completed',
            step: 'complete',
            revision: 11,
          }),
        }
      },
    } as unknown as EnvironmentDomainClient
    const terminal = {
      closeTerminalForThread: async () => {
        order.push('close-pty')
        return { closed: true }
      },
    } as Pick<DesktopTerminalClient, 'closeTerminalForThread'>
    const result = await runHandoff({
      sourceThreadId: 'source',
      sourceWorkspacePath: 'F:\\old-worktree',
      destination: { kind: 'worktree', worktreeId: 'worktree-1' },
      client,
      terminal,
      transferUiState: (input) => {
        order.push('transfer-ui')
        expect(input.targetThreadId).toBe('target')
        return { transferred: true }
      },
    })
    expect(result).toEqual({ targetThreadId: 'target', warning: null, warnings: [] })
    expect(order.indexOf('close-pty')).toBeGreaterThan(order.indexOf('start'))
    expect(order.indexOf('close-pty')).toBeGreaterThan(order.indexOf('status'))
    expect(order.indexOf('close-pty')).toBeLessThan(order.indexOf('transfer-ui'))
    expect(order.at(-1)).toBe('ack')
  })

  test('Handoff preflight 拒绝时不关闭源 PTY', async () => {
    let closed = false
    const failure = new Error('QUEUE_NOT_EMPTY')
    const client = {
      startHandoff: async () => {
        throw failure
      },
      handoffStatus: async () => {
        throw failure
      },
    } as unknown as EnvironmentDomainClient
    await expect(
      runHandoff({
        sourceThreadId: 'source',
        sourceWorkspacePath: 'F:\\source',
        destination: { kind: 'worktree', worktreeId: 'worktree-1' },
        client,
        terminal: {
          closeTerminalForThread: async () => {
            closed = true
            return { closed: true }
          },
        },
      }),
    ).rejects.toBe(failure)
    expect(closed).toBeFalse()
  })

  test('重启后可按 source task 发现 pending Handoff 并幂等完成客户端迁移', async () => {
    const waiting = operation({
      targetThreadId: 'target',
      status: 'await-client-transfer',
      step: 'await-client-transfer',
      revision: 9,
    })
    const order: string[] = []
    const client = {
      pendingHandoff: async () => ({ operation: waiting }),
      handoffStatus: async () => ({ operation: waiting, changed: false }),
      ackHandoff: async () => {
        order.push('ack')
        return {
          operation: operation({
            targetThreadId: 'target',
            status: 'completed',
            step: 'complete',
            revision: 11,
          }),
        }
      },
    } as unknown as EnvironmentDomainClient
    const result = await resumePendingHandoff({
      sourceThreadId: 'source',
      sourceWorkspacePath: 'F:\\source',
      destination: { kind: 'local' },
      client,
      terminal: {
        closeTerminalForThread: async () => {
          order.push('close-pty')
          return { closed: true }
        },
      },
      transferUiState: () => {
        order.push('transfer-ui')
        return { transferred: true }
      },
    })
    expect(result?.targetThreadId).toBe('target')
    expect(order).toEqual(['close-pty', 'transfer-ui', 'ack'])
  })

  test('Actions 列表和 Electron 调用都不向 Renderer 暴露 command/env/cwd', async () => {
    const actions = await listTerminalActions(
      {
        listActions: async () => ({
          revision: 'a'.repeat(64),
          actions: [{ name: 'test', icon: 'play', availability: 'available' }],
        }),
      },
      'thread-1',
    )
    expect(JSON.stringify(actions)).not.toMatch(/command|\benv\b|cwd/i)
    let terminalInput: unknown
    let terminalEvent: Event | null = null
    const actionSnapshot = { terminalId: 'terminal-action', instanceId: 'instance-action' }
    await runTerminalAction({
      threadId: 'thread-1',
      action: actions[0]!,
      profileId: null,
      terminal: {
        runTerminalAction: async (input) => {
          terminalInput = input
          return actionSnapshot as never
        },
      },
      dispatch: (event) => {
        terminalEvent = event
        return true
      },
    })
    expect(terminalInput).toEqual({
      threadId: 'thread-1',
      actionName: 'test',
      profileId: null,
      cols: 120,
      rows: 30,
    })
    expect(JSON.stringify(terminalInput)).not.toMatch(/command|\benv\b|cwd/i)
    expect((terminalEvent as unknown as CustomEvent).detail.snapshot).toBe(actionSnapshot)
  })

  test('Local environment Actions 以结构化字段读取并压缩保存', () => {
    const actions = environmentActionsValue([
      {
        name: 'Test',
        icon: 'play',
        command: 'bun test',
        windows: 'bun test --watch=false',
        macos: '',
        linux: '',
      },
    ])
    expect(actions[0]).toEqual({
      sourceIndex: 0,
      name: 'Test',
      icon: 'play',
      command: 'bun test',
      windows: 'bun test --watch=false',
      macos: '',
      linux: '',
    })
    expect(serializeEnvironmentActions(actions)).toEqual([
      {
        name: 'Test',
        icon: 'play',
        command: 'bun test',
        windows: 'bun test --watch=false',
      },
    ])
    expect(() =>
      serializeEnvironmentActions([...actions, { ...actions[0]!, name: 'test' }]),
    ).toThrow('Action 名称重复')
  })

  test('Local environment 保存只 patch 已知嵌套字段，不整块覆盖未知键', () => {
    const original = {
      setup: { script: 'old', future: true },
      actions: [{ name: 'Dev', command: 'old', future: { keep: true } }],
    }
    const actions = environmentActionsValue(original.actions)
    actions[0] = { ...actions[0]!, command: 'bun dev' }
    const edits = buildEnvironmentConfigEdits({
      original,
      name: 'Project',
      setup: { script: 'bun setup' },
      cleanup: { script: '' },
      actions,
    })
    expect(
      edits.some((edit) => edit.keyPath.length === 1 && edit.keyPath[0] === 'actions'),
    ).toBeFalse()
    expect(edits).toContainEqual({ keyPath: ['setup', 'script'], value: 'bun setup' })
    expect(edits).toContainEqual({ keyPath: ['actions', 0, 'command'], value: 'bun dev' })
    expect(edits.some((edit) => edit.keyPath.includes('future'))).toBeFalse()
  })
})

describe('Git environment gating', () => {
  test('非 Git 时 actions/worktrees/pending handoff loader 均不被调用', async () => {
    const calls = { listActions: 0, projectForThread: 0, listWorktrees: 0 }
    const result = await loadGitEnvironmentProjection(
      false,
      'thread-1',
      {
        listActions: async () => {
          calls.listActions += 1
          return [action('dev')]
        },
        projectForThread: async () => {
          calls.projectForThread += 1
          return 'project-1'
        },
        listWorktrees: async () => {
          calls.listWorktrees += 1
          return [worktree('w-1')]
        },
      },
      () => true,
    )

    expect(result).toEqual({ status: 'not-git' })
    expect(calls).toEqual({ listActions: 0, projectForThread: 0, listWorktrees: 0 })
    expect(shouldResumePendingHandoff(false, 'thread-1', 'F:\\project', null)).toBe(false)
  })

  test('Git 时正常加载 actions、worktrees 与 projectId', async () => {
    const calls = { listActions: 0, projectForThread: 0, listWorktrees: 0 }
    const result = await loadGitEnvironmentProjection(
      true,
      'thread-1',
      {
        listActions: async () => {
          calls.listActions += 1
          return [action('dev')]
        },
        projectForThread: async () => {
          calls.projectForThread += 1
          return 'project-1'
        },
        listWorktrees: async () => {
          calls.listWorktrees += 1
          return [worktree('w-1'), worktree('w-2')]
        },
      },
      () => true,
    )

    expect(result).toEqual({
      status: 'loaded',
      snapshot: {
        actions: [action('dev')],
        projectId: 'project-1',
        worktrees: [worktree('w-1'), worktree('w-2')],
      },
    })
    expect(calls).toEqual({ listActions: 1, projectForThread: 1, listWorktrees: 1 })
  })

  test('请求期间由 Git 变非 Git 时忽略迟到结果，不恢复入口', async () => {
    let current = true
    const result = await loadGitEnvironmentProjection(
      true,
      'thread-1',
      {
        listActions: async () => [action('dev')],
        projectForThread: async () => {
          current = false
          return 'project-1'
        },
        listWorktrees: async () => [worktree('w-1')],
      },
      () => current,
    )

    expect(result).toEqual({ status: 'stale' })
  })

  test('迟到错误被吞掉，不向上抛出不显示 Toast', async () => {
    let current = false
    const result = await loadGitEnvironmentProjection(
      true,
      'thread-1',
      {
        listActions: async () => {
          throw new Error('REPOSITORY_NOT_FOUND')
        },
        projectForThread: async () => 'project-1',
        listWorktrees: async () => [],
      },
      () => current,
    )

    expect(result).toEqual({ status: 'stale' })
  })

  test('当前 Git 请求失败时返回 failed 供调用方渲染', async () => {
    const result = await loadGitEnvironmentProjection(
      true,
      'thread-1',
      {
        listActions: async () => {
          throw new Error('WORKTREE_GIT_FAILED')
        },
        projectForThread: async () => null,
        listWorktrees: async () => [],
      },
      () => true,
    )

    expect(result).toEqual({ status: 'failed', error: 'WORKTREE_GIT_FAILED' })
  })

  test('pending handoff 仅 Git 且同线程未恢复过时允许', () => {
    expect(shouldResumePendingHandoff(false, 'thread-1', 'F:\\project', null)).toBe(false)
    expect(shouldResumePendingHandoff(false, 'thread-1', 'F:\\project', 'thread-1')).toBe(false)
    expect(shouldResumePendingHandoff(true, 'thread-1', 'F:\\project', null)).toBe(true)
    expect(shouldResumePendingHandoff(true, 'thread-1', 'F:\\project', 'thread-1')).toBe(false)
    expect(shouldResumePendingHandoff(true, '', 'F:\\project', null)).toBe(false)
    expect(shouldResumePendingHandoff(true, 'thread-1', '', null)).toBe(false)
  })
})

function action(name: string): LocalEnvironmentActionMetadata {
  return { name, icon: 'play', availability: 'available' }
}

function worktree(id: string): ManagedWorktree {
  return {
    id,
    projectId: 'project-1',
    status: 'ready',
    branchName: 'feature/dev',
    baseCommit: 'a'.repeat(40),
    headCommit: 'b'.repeat(40),
    permanent: false,
    pinned: false,
    setupStatus: 'succeeded',
    continuedWithoutSetup: false,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: 1,
    deletedAt: null,
  }
}

test('旧 Agent 缺少多环境能力时不调用未知 RPC，返回重启说明', async () => {
  let calls = 0
  const rpc = {
    ensureInitialized: async () => ({ capabilities: [] }),
    call: async () => {
      calls++
      throw new Error('不应调用')
    },
  } as unknown as Parameters<typeof createEnvironmentDomainClient>[0]
  await expect(
    createEnvironmentDomainClient(rpc).listProjectEnvironments('project'),
  ).rejects.toThrow('完整退出应用')
  expect(calls).toBe(0)
})

test('工作树列表失败仍发布已经读到的启动操作', async () => {
  const action = { name: '启动agent', icon: 'run', availability: 'available' as const }
  const result = await loadGitEnvironmentProjection(
    true,
    'thread',
    {
      listActions: async () => [action],
      projectForThread: async () => 'project',
      listWorktrees: async () => {
        throw new Error('工作树读取失败')
      },
    },
    () => true,
  )
  expect(result.status).toBe('loaded')
  if (result.status === 'loaded') {
    expect(result.snapshot.actions).toEqual([action])
    expect(result.warning).toBe('工作树读取失败')
  }
})
