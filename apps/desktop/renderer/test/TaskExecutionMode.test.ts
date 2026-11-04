import { describe, expect, test } from 'bun:test'
import {
  resolveSessionCreationExecution,
  resolveTaskExecution,
} from '../src/features/session/TaskExecutionMode.js'

const WORKTREE = { kind: 'worktree', startingState: { type: 'working-tree' } }
const LOCAL = { kind: 'local' }

describe('automatic task execution selection', () => {
  test('Git 项目自动使用 working-tree Worktree', () => {
    expect(
      resolveTaskExecution({
        supportsExecution: true,
        projectExecutionEnvironment: 'auto',
        eligibility: { isGitRepository: true },
      }),
    ).toEqual(WORKTREE)
  })

  test('非 Git 项目使用 Local', () => {
    expect(
      resolveTaskExecution({
        supportsExecution: true,
        projectExecutionEnvironment: 'auto',
        eligibility: { isGitRepository: false },
      }),
    ).toEqual(LOCAL)
  })

  test('项目设置选择本地目录后即使 Git 也不创建 Worktree', () => {
    expect(
      resolveTaskExecution({
        supportsExecution: true,
        projectExecutionEnvironment: 'local',
        eligibility: { isGitRepository: true },
      }),
    ).toEqual(LOCAL)
  })

  test('缺少设置时按自动处理', () => {
    expect(
      resolveTaskExecution({
        supportsExecution: true,
        projectExecutionEnvironment: undefined,
        eligibility: { isGitRepository: true },
      }),
    ).toEqual(WORKTREE)
  })

  test('eligibility 请求失败静默使用 Local', () => {
    expect(
      resolveTaskExecution({
        supportsExecution: true,
        projectExecutionEnvironment: 'auto',
        eligibility: null,
      }),
    ).toEqual(LOCAL)
  })

  test('旧 Agent 未协商 thread.execution.v2 时省略 execution 字段', () => {
    expect(
      resolveTaskExecution({
        supportsExecution: false,
        projectExecutionEnvironment: 'auto',
        eligibility: { isGitRepository: true },
      }),
    ).toBeUndefined()
  })
})

describe('explicit session creation execution', () => {
  test('首页显式选择优先于项目设置与自动选择', () => {
    expect(
      resolveSessionCreationExecution({
        execution: { kind: 'local' },
        supportsExplicitExecution: true,
        projectExecutionEnvironment: 'auto',
        eligibility: { isGitRepository: true },
      }),
    ).toEqual(LOCAL)
    const branchExecution = {
      kind: 'worktree' as const,
      startingState: { type: 'branch' as const, branchName: 'feature/launch' },
    }
    expect(
      resolveSessionCreationExecution({
        execution: branchExecution,
        supportsExplicitExecution: true,
        projectExecutionEnvironment: 'local',
        eligibility: { isGitRepository: false },
      }),
    ).toEqual(branchExecution)
  })

  test('旧调用不传执行选择时维持自动选择', () => {
    expect(
      resolveSessionCreationExecution({
        supportsExplicitExecution: true,
        projectExecutionEnvironment: 'auto',
        eligibility: { isGitRepository: true },
      }),
    ).toEqual(WORKTREE)
    expect(
      resolveSessionCreationExecution({
        supportsExplicitExecution: false,
        projectExecutionEnvironment: 'auto',
        eligibility: { isGitRepository: true },
      }),
    ).toBeUndefined()
  })

  test('不支持显式执行选择的 Agent 不会把工作树静默变成其他位置', () => {
    expect(() =>
      resolveSessionCreationExecution({
        execution: {
          kind: 'worktree',
          startingState: { type: 'branch', branchName: 'feature/launch' },
        },
        supportsExplicitExecution: false,
        projectExecutionEnvironment: 'auto',
        eligibility: { isGitRepository: true },
      }),
    ).toThrow('当前 Agent 不支持从指定分支创建工作树')
  })
})
