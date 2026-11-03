import { describe, expect, test } from 'bun:test'
import type { DesktopWorkspace } from '../shared/Types.js'
import { ComposerDraftStore } from '../src/features/session/composer/ComposerDraftStore.js'
import {
  composerLaunchAttemptSignature,
  composerLaunchProjectKey,
  createComposerLaunchSession,
  mergeComposerLaunchSettings,
  planComposerLaunch,
  readComposerLaunchSettings,
  resolveComposerLaunchBranch,
  withLaunchAttempt,
} from '../src/features/session/composer/ComposerLaunch.js'
import {
  selectComposerProjectEnvironment,
  selectedComposerEnvironmentId,
} from '../src/features/session/composer/ComposerEnvironmentSelection.js'

const GIT_WORKSPACE: DesktopWorkspace = {
  projectId: 'project-a',
  name: 'Alpha',
  path: 'C:\\alpha',
  branchName: 'main',
  isGitRepo: true,
  branches: ['main', 'feature/launch'],
}

const OTHER_PROJECT: DesktopWorkspace = {
  projectId: 'project-b',
  name: 'Beta',
  path: 'C:\\beta',
  branchName: 'release',
  isGitRepo: true,
  branches: ['release', 'hotfix'],
}

const PLAIN_WORKSPACE: DesktopWorkspace = {
  projectId: 'project-plain',
  name: 'Notes',
  path: 'C:\\notes',
  branchName: null,
  isGitRepo: false,
}

function store(): ComposerDraftStore {
  let sequence = 0
  return new ComposerDraftStore(() => `id-${++sequence}`)
}

describe('首页发起设置', () => {
  test('默认关闭工作树并使用项目本地目录，未选分支时不需要检出', () => {
    const plan = planComposerLaunch({
      settings: { createWorktree: false, branch: null },
      workspace: GIT_WORKSPACE,
    })
    expect(plan).toEqual({ execution: { kind: 'local' }, checkoutBranch: null, blockedReason: null })
  })

  test('选择分支只写入草稿，计划里保留待检出的分支', () => {
    const drafts = store()
    drafts.setLaunchSettings('home', 'project-a', {
      createWorktree: false,
      branch: 'feature/launch',
    })
    const settings = readComposerLaunchSettings(drafts.get('home'), 'project-a')
    expect(settings.branch).toBe('feature/launch')
    expect(
      planComposerLaunch({ settings, workspace: GIT_WORKSPACE }),
    ).toEqual({
      execution: { kind: 'local' },
      checkoutBranch: 'feature/launch',
      blockedReason: null,
    })
  })

  test('本地模式先检出再创建会话，检查失败即停止', async () => {
    const order: string[] = []
    await createComposerLaunchSession({
      plan: { execution: { kind: 'local' }, checkoutBranch: 'feature/launch', blockedReason: null },
      operationId: 'op-1',
      checkout: async (branch) => {
        order.push(`checkout:${branch}`)
      },
      create: async (options) => {
        order.push(`create:${options.execution.kind}:${options.operationId}`)
        return 'session-1'
      },
    })
    expect(order).toEqual(['checkout:feature/launch', 'create:local:op-1'])

    const afterFailure: string[] = []
    await expect(
      createComposerLaunchSession({
        plan: { execution: { kind: 'local' }, checkoutBranch: 'feature/launch', blockedReason: null },
        operationId: 'op-2',
        checkout: async () => {
          throw new Error('本地修改会被覆盖')
        },
        create: async () => {
          afterFailure.push('created')
          return 'session-2'
        },
      }),
    ).rejects.toThrow('本地修改会被覆盖')
    expect(afterFailure).toEqual([])
  })

  test('工作树模式携带分支创建，且不检出源目录', async () => {
    const plan = planComposerLaunch({
      settings: { createWorktree: true, branch: 'feature/launch' },
      workspace: GIT_WORKSPACE,
    })
    expect(plan).toEqual({
      execution: {
        kind: 'worktree',
        startingState: { type: 'branch', branchName: 'feature/launch' },
      },
      checkoutBranch: null,
      blockedReason: null,
    })
    const calls: string[] = []
    await createComposerLaunchSession({
      plan,
      operationId: 'op-worktree',
      checkout: async (branch) => {
        calls.push(`checkout:${branch}`)
      },
      create: async ({ execution }) => {
        calls.push(`create:${JSON.stringify(execution)}`)
        return 'session-3'
      },
    })
    expect(calls).toEqual([
      'create:{"kind":"worktree","startingState":{"type":"branch","branchName":"feature/launch"}}',
    ])
  })

  test('重试复用同一个 operationId，执行位置或标题变化时重新分配', () => {
    const drafts = store()
    const execution = {
      kind: 'worktree' as const,
      startingState: { type: 'branch' as const, branchName: 'feature/launch' },
    }
    const signature = composerLaunchAttemptSignature(execution, '第一条消息')
    const first = drafts.beginLaunchAttempt('home', { projectKey: 'project-a', signature })
    const retry = drafts.beginLaunchAttempt('home', { projectKey: 'project-a', signature })
    expect(retry).toBe(first)
    expect(drafts.get('home').launchAttempt?.operationId).toBe(first)

    const changedBranch = drafts.beginLaunchAttempt('home', {
      projectKey: 'project-a',
      signature: composerLaunchAttemptSignature(
        { kind: 'worktree', startingState: { type: 'branch', branchName: 'main' } },
        '第一条消息',
      ),
    })
    expect(changedBranch).not.toBe(first)

    const changedTitle = drafts.beginLaunchAttempt('home', {
      projectKey: 'project-a',
      signature: composerLaunchAttemptSignature(execution, '改过的消息'),
    })
    expect(changedTitle).not.toBe(changedBranch)
  })

  test('创建失败回退草稿时保留本次尝试，重试仍复用同一目标', () => {
    const drafts = store()
    const signature = composerLaunchAttemptSignature(
      { kind: 'worktree', startingState: { type: 'branch', branchName: 'feature/launch' } },
      '第一条消息',
      'default:false:false:working',
    )
    const operationId = drafts.beginLaunchAttempt('home', { projectKey: 'project-a', signature })
    const restored = withLaunchAttempt(drafts.get('home'), drafts.get('home').launchAttempt)
    expect(restored.launchAttempt?.operationId).toBe(operationId)
    // 回退后再次发送仍得到同一个 operationId。
    expect(
      drafts.beginLaunchAttempt('home', { projectKey: 'project-a', signature }),
    ).toBe(operationId)
  })

  test('草稿按项目隔离设置', () => {
    const drafts = store()
    drafts.setLaunchSettings('home', 'project-a', {
      createWorktree: true,
      branch: 'feature/launch',
    })
    expect(readComposerLaunchSettings(drafts.get('home'), 'project-b')).toEqual({
      createWorktree: false,
      branch: null,
    })
    const next = mergeComposerLaunchSettings(drafts.get('home'), 'project-b', {
      createWorktree: false,
      branch: 'hotfix',
    })
    expect(next.launchSettingsByProject).toEqual({
      'project-a': { createWorktree: true, branch: 'feature/launch' },
      'project-b': { createWorktree: false, branch: 'hotfix' },
    })
  })

  test('非 Git 项目始终使用本地目录且无分支可检出', () => {
    expect(
      planComposerLaunch({
        settings: { createWorktree: true, branch: 'main' },
        workspace: PLAIN_WORKSPACE,
      }),
    ).toEqual({ execution: { kind: 'local' }, checkoutBranch: null, blockedReason: null })
    expect(composerLaunchProjectKey(null)).toBeNull()
    expect(composerLaunchProjectKey(OTHER_PROJECT)).toBe('project-b')
    expect(resolveComposerLaunchBranch({ createWorktree: false, branch: null }, null)).toBeNull()
  })

  test('开启工作树但没有分支时阻断发送，而不是静默改用本地目录', async () => {
    const plan = planComposerLaunch({
      settings: { createWorktree: true, branch: null },
      workspace: { ...GIT_WORKSPACE, branchName: null, branches: [] },
    })
    expect(plan.blockedReason).toBe('请选择分支')
    let created = false
    await expect(
      createComposerLaunchSession({
        plan,
        operationId: 'op-blocked',
        checkout: async () => {},
        create: async () => {
          created = true
          return null
        },
      }),
    ).rejects.toThrow('请选择分支')
    expect(created).toBe(false)
  })
})

describe('首页环境选择', () => {
  test('选择环境先持久化、再回读目录并通知其他界面刷新', async () => {
    const calls: string[] = []
    const catalog = {
      environments: [
        {
          id: 'env-a',
          name: 'Node 环境',
          path: 'C:/alpha/.pidex/environments/node.jsonc',
          inherited: false,
          exists: true,
          invalid: false,
        },
        {
          id: 'env-b',
          name: 'Python 环境',
          path: 'C:/alpha/.pidex/environments/python.jsonc',
          inherited: false,
          exists: true,
          invalid: false,
        },
      ],
      selectedEnvironmentId: 'env-b',
    }
    const result = await selectComposerProjectEnvironment({
      client: {
        selectProjectEnvironment: async (projectId, environmentId) => {
          calls.push(`select:${projectId}:${environmentId}`)
        },
        listProjectEnvironments: async (projectId) => {
          calls.push(`list:${projectId}`)
          return catalog
        },
      },
      projectId: 'project-a',
      environmentId: 'env-b',
      notify: () => calls.push('notify'),
    })
    expect(calls).toEqual(['select:project-a:env-b', 'list:project-a', 'notify'])
    expect(result.selectedEnvironmentId).toBe('env-b')
    expect(selectedComposerEnvironmentId(result)).toBe('env-b')
    expect(selectedComposerEnvironmentId(null)).toBeNull()
  })
})
