import { expect, test } from 'bun:test'
import { Schema } from 'effect'
import { RpcMethods } from '../src/methods/index'

test('新上下文实施使用独立 capability，模型可省略', () => {
  const method = RpcMethods['planApproval/implementFresh']
  expect(method.capability).toBe('plan.approval.fresh.v1')
  const params = {
    threadId: 'thread',
    approvalId: 'approval',
    expectedVersion: 1,
    operationId: 'fresh',
  }
  expect(Schema.decodeUnknownSync(method.params)(params)).toEqual(params)
  expect(() => Schema.decodeUnknownSync(method.params)({ ...params, expectedVersion: 0 })).toThrow()
})

test('plan approval accepts only valid response/version and preserves all actions', () => {
  const method = RpcMethods['planApproval/respond']
  const decode = Schema.decodeUnknownSync(method.params)
  const base = { threadId: 'thread', approvalId: 'approval', expectedVersion: 1, operationId: 'op' }
  for (const response of [
    { action: 'implement' },
    { action: 'feedback', feedback: '继续补充\n测试' },
    { action: 'close' },
  ] as const) {
    expect(decode({ ...base, response }).response).toEqual(response)
  }
  for (const feedback of ['', '   ', ' 前导空白', '尾部空白 ']) {
    expect(() => decode({ ...base, response: { action: 'feedback', feedback } })).toThrow()
  }
  for (const expectedVersion of [0, -1, 1.5]) {
    expect(() => decode({ ...base, expectedVersion, response: { action: 'close' } })).toThrow()
  }
  expect(method.capability).toBe('plan.approval.v1')
})
