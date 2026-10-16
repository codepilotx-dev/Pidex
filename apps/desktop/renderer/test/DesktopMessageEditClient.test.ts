import { expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

function fixture(enabled: boolean) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  const client = createDesktopClient({
    fetch: async (_path, init) => {
      const body = JSON.parse(String(init?.body))
      calls.push(body)
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      let result: unknown
      if (body.method === 'initialize')
        result = {
          protocol: 'thread-rpc-v4',
          serverInfo: { name: 'test', version: '1' },
          capabilities: ['rpc.typed.v1', ...(enabled ? ['thread.editUserMessage.v1'] : [])],
          limits: {
            maxFrameBytes: 1048576,
            maxSubscriptions: 4,
            maxStreamsPerSubscription: 4,
            maxPendingRequests: 8,
          },
          connectionId: 'edit-test',
        }
      else if (body.method === 'thread/editUserMessage')
        result = {
          inputId: 'new-input',
          turnId: 'new-turn',
          disposition: 'accepted',
          streamPosition: { streamId: 'thread-1', sequence: 1 },
        }
      // 请求已接纳后刷新失败不能把成功提交报告为失败。
      else if (body.method === 'thread/read') throw new Error('snapshot unavailable')
      else throw new Error(`Unexpected method: ${body.method}`)
      return Response.json({ jsonrpc: '2.0', id: body.id, result })
    },
  })
  return { client, calls }
}

test('编辑客户端传递原目标与操作标识，保留空附件列表，不走追加发送或附件重导入', async () => {
  const { client, calls } = fixture(true)
  const target = { turnId: 'old-turn', inputId: 'old-input', operationId: 'edit-1' }
  await client.editUserMessage!('thread-1', target, {
    text: '新问题',
    retainedAttachmentIds: [],
    retainedContextReferenceIds: ['context-1'],
  })
  expect(client.supportsMessageEditing?.()).toBe(true)
  expect(calls.find((call) => call.method === 'thread/editUserMessage')?.params).toEqual({
    threadId: 'thread-1',
    ...target,
    content: '新问题',
    attachmentIds: [],
    contextReferenceIds: ['context-1'],
  })
  expect(calls.map((call) => call.method)).toEqual([
    'initialize',
    'initialized',
    'thread/editUserMessage',
    'thread/read',
  ])
})

test('旧 Agent 不支持编辑时不发送未知 RPC', async () => {
  const { client, calls } = fixture(false)
  await expect(
    client.editUserMessage!(
      'thread-1',
      { turnId: 'old-turn', inputId: 'old-input', operationId: 'edit-1' },
      { text: '新问题' },
    ),
  ).rejects.toThrow()
  expect(client.supportsMessageEditing?.()).toBe(false)
  expect(calls.some((call) => call.method === 'thread/editUserMessage')).toBe(false)
})
