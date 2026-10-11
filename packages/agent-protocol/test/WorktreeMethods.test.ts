import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  ManagedWorktreeSchema,
  WorktreeOperationSchema,
  WorktreeRpcMethods,
} from '../src/methods/Worktree'

const worktree = {
  id: 'worktree-1',
  projectId: 'project-1',
  status: 'ready' as const,
  branchName: 'feature',
  baseCommit: 'a'.repeat(40),
  headCommit: 'b'.repeat(40),
  permanent: false,
  pinned: false,
  setupStatus: 'succeeded' as const,
  continuedWithoutSetup: false,
  createdAt: 1,
  updatedAt: 2,
  lastUsedAt: 2,
  deletedAt: null,
}

const operation = {
  operationId: 'operation-1',
  worktreeId: 'worktree-1',
  projectId: 'project-1',
  kind: 'create' as const,
  step: 'complete',
  status: 'completed' as const,
  revision: 3,
  errorCode: null,
  warnings: [],
  createdAt: 1,
  updatedAt: 2,
  completedAt: 2,
}

describe('managed worktree method contracts', () => {
  test('公开投影不暴露 repository、cwd、恢复快照或 request hash', () => {
    expect(
      Schema.decodeUnknownSync(ManagedWorktreeSchema, { onExcessProperty: 'error' })(worktree),
    ).toEqual(worktree)
    expect(() =>
      Schema.decodeUnknownSync(ManagedWorktreeSchema, { onExcessProperty: 'error' })({
        ...worktree,
        path: 'C:\\secret',
        repositoryRoot: 'C:\\repo',
        restoreSnapshotPath: 'C:\\data\\snapshot',
      }),
    ).toThrow()
    expect(
      Schema.decodeUnknownSync(WorktreeOperationSchema, { onExcessProperty: 'error' })(operation),
    ).toEqual(operation)
    expect(() =>
      Schema.decodeUnknownSync(WorktreeOperationSchema, { onExcessProperty: 'error' })({
        ...operation,
        requestHash: 'secret',
      }),
    ).toThrow()
  })

  test('create 只接受 projectId、startingState 与 operationId', () => {
    const schema = WorktreeRpcMethods['worktree/create'].params
    expect(
      Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })({
        projectId: 'project-1',
        startingState: { type: 'working-tree' },
        operationId: 'operation-1',
      }).startingState,
    ).toEqual({ type: 'working-tree' })
    expect(() =>
      Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })({
        projectId: 'project-1',
        startingState: { type: 'branch', branchName: 'feature' },
        operationId: 'operation-1',
        path: 'C:\\escape',
      }),
    ).toThrow()
  })

  test('operation status 支持 cursor polling 且 tail 有 64KiB 上限', () => {
    const method = WorktreeRpcMethods['worktree/operation/status']
    expect(
      Schema.decodeUnknownSync(method.params)({
        operationId: 'operation-1',
        afterOutputCursor: 12,
      }),
    ).toEqual({
      operationId: 'operation-1',
      afterOutputCursor: 12,
    })
    expect(
      Schema.decodeUnknownSync(method.result)({
        operation,
        output: { cursor: 20, data: 'tail', truncated: false, complete: true },
      }).output.data,
    ).toBe('tail')
    expect(() =>
      Schema.decodeUnknownSync(method.result)({
        operation,
        output: { cursor: 70_000, data: 'x'.repeat(65_537), truncated: true, complete: false },
      }),
    ).toThrow()
  })
})
