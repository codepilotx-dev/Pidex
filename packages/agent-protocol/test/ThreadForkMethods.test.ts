import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { ThreadForkOperationSchema, ThreadForkRpcMethods } from '../src/methods/ThreadFork'

const operation = {
  operationId: 'operation:fork-1',
  sourceThreadId: 'thread:source',
  sourceTurnId: 'turn:boundary',
  sourceItemId: 'item:assistant-result',
  targetThreadId: null,
  targetWorktreeId: null,
  destinationKind: 'new-worktree' as const,
  snapshotMode: 'working-tree' as const,
  status: 'running' as const,
  step: 'prepare-worktree' as const,
  revision: 2,
  errorCode: null,
  warnings: [],
  createdAt: 1,
  updatedAt: 2,
  completedAt: null,
}

describe('thread fork method contracts', () => {
  test('operation 投影只包含稳定标识与安全状态', () => {
    expect(
      Schema.decodeUnknownSync(ThreadForkOperationSchema, { onExcessProperty: 'error' })(operation),
    ).toEqual(operation)

    expect(() =>
      Schema.decodeUnknownSync(ThreadForkOperationSchema, { onExcessProperty: 'error' })({
        ...operation,
        cwd: 'C:\\private\\repo',
        command: 'private-command',
        requestHash: 'private-hash',
      }),
    ).toThrow()
  })

  test('start 只接受消息边界与目标种类', () => {
    const decode = Schema.decodeUnknownSync(ThreadForkRpcMethods['thread/fork/start'].params, {
      onExcessProperty: 'error',
    })
    const params = {
      operationId: 'operation:fork-1',
      sourceThreadId: 'thread:source',
      lastTurnId: 'turn:boundary',
      sourceItemId: 'item:assistant-result',
      destination: { kind: 'same-worktree' as const },
    }

    expect(decode(params)).toEqual(params)
    expect(() => decode({ ...params, cwd: 'C:\\private\\repo' })).toThrow()
  })

  test('status 同时约束 revision long-poll 与 64KiB cursor output', () => {
    const method = ThreadForkRpcMethods['thread/fork/status']
    expect(
      Schema.decodeUnknownSync(method.params)({
        operationId: 'operation:fork-1',
        afterRevision: 1,
        afterOutputCursor: 12,
        waitMs: 30_000,
      }),
    ).toEqual({
      operationId: 'operation:fork-1',
      afterRevision: 1,
      afterOutputCursor: 12,
      waitMs: 30_000,
    })
    expect(() =>
      Schema.decodeUnknownSync(method.params)({
        operationId: 'operation:fork-1',
        waitMs: 30_001,
      }),
    ).toThrow()

    expect(
      Schema.decodeUnknownSync(method.result)({
        operation,
        changed: true,
        output: { cursor: 13, data: 'setup tail', truncated: false, complete: false },
      }).output.data,
    ).toBe('setup tail')
    expect(() =>
      Schema.decodeUnknownSync(method.result)({
        operation,
        changed: true,
        output: { cursor: 13, data: 'x'.repeat(65_537), truncated: true, complete: false },
      }),
    ).toThrow()
  })

  test('所有方法要求 thread.fork.v1 且保持精确 envelope', () => {
    for (const definition of Object.values(ThreadForkRpcMethods)) {
      expect(definition.capability).toBe('thread.fork.v1')
      expect(definition.exactParams).toBe(true)
      expect(definition.exactResult).toBe(true)
    }
  })
})
