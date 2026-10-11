import { describe, expect, test } from 'bun:test'
import { resolveTaskExecution } from '../src/features/session/TaskExecutionMode.js'

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
