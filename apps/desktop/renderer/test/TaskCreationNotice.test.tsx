import { describe, expect, test } from 'bun:test'
import { createTaskSession } from '../src/features/session/composer/ComposerSubmitTransaction.js'

describe('task creation failure reporting', () => {
  test('创建失败只触发一次全局错误通知', async () => {
    const notices: string[] = []
    await expect(
      createTaskSession({
        onError: (message) => notices.push(message),
        create: async () => {
          throw new Error('无法创建 Worktree')
        },
      }),
    ).rejects.toThrow('无法创建 Worktree')
    expect(notices).toEqual(['无法创建 Worktree'])
  })

  test('创建返回空结果时只通知一次安全文案', async () => {
    const notices: string[] = []
    const created = await createTaskSession({
      onError: (message) => notices.push(message),
      create: async () => null,
    })
    expect(created).toBeNull()
    expect(notices).toEqual(['无法创建任务，请重试或选择本地目录。'])
  })

  test('没有错误文案时回退到简短可行动提示', async () => {
    const notices: string[] = []
    await expect(
      createTaskSession({
        onError: (message) => notices.push(message),
        create: async () => {
          throw 'not-an-error'
        },
      }),
    ).rejects.toBeDefined()
    expect(notices).toEqual(['无法创建任务，请重试或选择本地目录。'])
  })

  test('创建成功不产生任何通知', async () => {
    const notices: string[] = []
    const created = await createTaskSession({
      onError: (message) => notices.push(message),
      create: async () => 'thread:1',
    })
    expect(created).toBe('thread:1')
    expect(notices).toEqual([])
  })
})
