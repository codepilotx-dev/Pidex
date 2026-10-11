import { expect, spyOn, test } from 'bun:test'
import { desktopClient } from '../src/services/desktop-client/index.js'
import { chooseSessionGroupForThread } from '../src/features/session-groups/SessionGroupActions.js'

test('工作流归属选择支持加入、移出，取消或无效序号不写入', async () => {
  const originalPrompt = globalThis.prompt
  const list = spyOn(desktopClient, 'listSessionGroups').mockResolvedValue([
    { id: 'group-1', name: '工作流一' } as Awaited<
      ReturnType<typeof desktopClient.listSessionGroups>
    >[number],
  ])
  const set = spyOn(desktopClient, 'setSessionGroupMembership').mockResolvedValue(
    {} as Awaited<ReturnType<typeof desktopClient.setSessionGroupMembership>>,
  )
  try {
    for (const answer of [null, '999', '1', '0']) {
      globalThis.prompt = () => answer
      await chooseSessionGroupForThread('thread-1')
    }
    expect(set.mock.calls).toEqual([
      [{ threadId: 'thread-1', groupId: 'group-1' }],
      [{ threadId: 'thread-1', groupId: null }],
    ])
  } finally {
    globalThis.prompt = originalPrompt
    list.mockRestore()
    set.mockRestore()
  }
})
