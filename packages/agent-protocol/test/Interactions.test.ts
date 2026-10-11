import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  ApprovalRequestResultSchema,
  HookTrustRequestResultSchema,
  PermissionRequestResultSchema,
  QuestionRequestResultSchema,
  createServerRequestMessage,
  decodeServerRequestMessage,
  ServerRequestResultSchema,
  ServerRequests,
} from '../src/wire/Interactions'
import { EventManifest } from '../src/wire/Events'
import { RpcMethods } from '../src/methods/index'

const responseBranches = [
  {
    method: 'approval/request',
    resultSchema: ApprovalRequestResultSchema,
    response: { kind: 'approval', decision: 'deny', feedback: '请改用只读命令' },
    invalidResponse: { kind: 'approval', decision: 'continue' },
  },
  {
    method: 'permission/request',
    resultSchema: PermissionRequestResultSchema,
    response: {
      kind: 'permission',
      decision: 'grant',
      scope: 'turn',
      grantedPermissions: { readPaths: ['C:\\workspace'] },
    },
    invalidResponse: { kind: 'permission', decision: 'grant', scope: 'workspace' },
  },
  {
    method: 'question/request',
    resultSchema: QuestionRequestResultSchema,
    response: {
      kind: 'question',
      status: 'answered',
      resolution: 'user',
      answers: [{ questionId: 'question-1', choiceIds: ['choice-1'], text: 'details' }],
    },
    invalidResponse: { kind: 'question', status: 'answered' },
  },
  {
    method: 'hookTrust/request',
    resultSchema: HookTrustRequestResultSchema,
    response: { kind: 'hookTrust', decision: 'allow' },
    invalidResponse: { kind: 'hookTrust', decision: 'continue' },
  },
] as const

describe('server request interactions', () => {
  test('defines exactly the four interaction request kinds', () => {
    expect(Object.keys(ServerRequests).sort()).toEqual(
      responseBranches.map(({ method }) => method).sort(),
    )
  })

  test('keeps each ServerRequest result aligned with interaction/respond', () => {
    const respond = RpcMethods['interaction/respond']
    const decodeSharedResponse = Schema.decodeUnknownSync(ServerRequestResultSchema)
    const decodeRespondParams = Schema.decodeUnknownSync(respond.params)
    const decodeRespondResult = Schema.decodeUnknownSync(respond.result)

    for (const [index, branch] of responseBranches.entries()) {
      expect(ServerRequests[branch.method].result).toBe(branch.resultSchema)
      expect(Schema.decodeUnknownSync(branch.resultSchema)(branch.response)).toEqual(
        branch.response,
      )
      expect(decodeSharedResponse(branch.response)).toEqual(branch.response)

      const params = {
        interactionId: `interaction-${index}`,
        expectedVersion: 1,
        response: branch.response,
        operationId: `operation-${index}`,
      }
      const result = {
        interactionId: params.interactionId,
        kind: branch.response.kind,
        state: 'resolved' as const,
        version: 2,
        resolvedAt: 10,
        response: branch.response,
      }

      expect(decodeRespondParams(params)).toEqual(params)
      expect(decodeRespondResult(result)).toEqual(result)

      expect(() => Schema.decodeUnknownSync(branch.resultSchema)(branch.invalidResponse)).toThrow()
      expect(() => decodeSharedResponse(branch.invalidResponse)).toThrow()
      expect(() => decodeRespondParams({ ...params, response: branch.invalidResponse })).toThrow()
      expect(() => decodeRespondResult({ ...result, response: branch.invalidResponse })).toThrow()

      for (const otherBranch of responseBranches) {
        if (otherBranch.method === branch.method) continue
        expect(() => Schema.decodeUnknownSync(otherBranch.resultSchema)(branch.response)).toThrow()
      }
    }
  })

  test('uses the persisted interactionId as the JSON-RPC request id', () => {
    const params = {
      kind: 'question' as const,
      interactionId: 'interaction-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      createdAt: 1,
      version: 1,
      questions: [
        {
          id: 'question-1',
          header: '执行方式',
          prompt: '如何继续？',
          choices: [
            { id: 'choice-1', label: '安全模式', description: '仅执行只读操作', recommended: true },
            {
              id: 'choice-2',
              label: '完整模式',
              description: '允许工作区写入',
              recommended: false,
            },
          ],
          allowFreeform: true,
          required: true,
        },
      ],
    } as const
    const message = createServerRequestMessage('question/request', params)
    expect(message.id).toBe(params.interactionId)
    expect(decodeServerRequestMessage(message)).toEqual(message)
    expect(() => decodeServerRequestMessage({ ...message, id: 'different-interaction' })).toThrow()
  })

  test('limits approval feedback to 4000 characters', () => {
    const decode = Schema.decodeUnknownSync(ApprovalRequestResultSchema)
    expect(
      decode({ kind: 'approval', decision: 'deny', feedback: '调'.repeat(4_000) }),
    ).toMatchObject({ decision: 'deny' })
    expect(() =>
      decode({ kind: 'approval', decision: 'deny', feedback: '调'.repeat(4_001) }),
    ).toThrow()
  })

  test('decodes optional multi-path approval scope without weakening old requests', () => {
    const decode = Schema.decodeUnknownSync(ServerRequests['approval/request'].params)
    const request = {
      kind: 'approval' as const,
      interactionId: 'approval-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      createdAt: 1,
      version: 1,
      toolCallId: 'tool-1',
      tool: 'apply_patch',
      risk: 'high' as const,
      reason: '需要确认多文件修改',
      affectedPaths: [
        { path: 'src/a.ts', operation: 'update' as const },
        { path: 'src/b.ts', operation: 'create' as const },
      ],
      reviewSummary: {
        fileCount: 2,
        hunkCount: 3,
        additions: 8,
        deletions: 2,
      },
      requestedPermissions: {},
      allowedChoices: ['allow-once', 'deny', 'stop'] as const,
    }
    expect(decode(request)).toEqual(request)
    const { affectedPaths: _affectedPaths, reviewSummary: _reviewSummary, ...legacy } = request
    expect(decode(legacy)).toEqual(legacy)
    expect(() =>
      decode({
        ...request,
        affectedPaths: [{ path: 'src/a.ts', operation: 'delete' }],
      }),
    ).toThrow()
  })

  test('bounds rich questions and automatic resolution', () => {
    const decode = Schema.decodeUnknownSync(ServerRequests['question/request'].params)
    const question = {
      id: 'question-1',
      header: '方案',
      prompt: '选择实现方案',
      choices: [
        { id: 'choice-1', label: '方案一', description: '推荐方案', recommended: true },
        { id: 'choice-2', label: '方案二', description: '替代方案', recommended: false },
      ],
      allowFreeform: true as const,
      required: true as const,
    }
    const base = {
      kind: 'question' as const,
      interactionId: 'interaction-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      createdAt: 1,
      version: 1,
      autoResolutionMs: 60_000,
      questions: [question],
    }

    expect(decode(base)).toEqual(base)
    expect(
      decode({ ...base, questions: [{ ...question, choices: [] }] }).questions[0]?.choices,
    ).toEqual([])
    expect(() => decode({ ...base, questions: [] })).toThrow()
    expect(() => decode({ ...base, autoResolutionMs: 59_999 })).toThrow()
    expect(() => decode({ ...base, autoResolutionMs: 240_001 })).toThrow()
    expect(() =>
      decode({
        ...base,
        questions: [{ ...question, choices: question.choices.slice(0, 1) }],
      }),
    ).toThrow()
  })

  test('carries requested and grantable permission scopes separately', () => {
    const decode = Schema.decodeUnknownSync(ServerRequests['permission/request'].params)
    const request = {
      kind: 'permission' as const,
      interactionId: 'interaction-permission-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      createdAt: 1,
      version: 1,
      toolCallId: 'tool-call-1',
      tool: 'shell',
      reason: '需要读取额外目录',
      requestedPermissions: { readPaths: ['C:\\workspace'] },
      requestedScope: 'turn' as const,
      allowedScopes: ['tool-call', 'turn'] as const,
    }

    expect(decode(request)).toEqual(request)
    expect(() => decode({ ...request, allowedScopes: [] })).toThrow()
    expect(() => decode({ ...request, requestedScope: 'workspace' })).toThrow()
  })

  test('permission requests accept an optional real checkpoint risk', () => {
    const decode = Schema.decodeUnknownSync(ServerRequests['permission/request'].params)
    const base = {
      kind: 'permission' as const,
      interactionId: 'interaction-permission-2',
      threadId: 'thread-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      createdAt: 1,
      version: 1,
      toolCallId: 'tool-call-2',
      tool: 'shell',
      reason: '需要读取额外目录',
      requestedPermissions: {},
      requestedScope: 'session' as const,
      allowedScopes: ['tool-call', 'turn', 'session'] as const,
    }

    // Legacy durable events without risk still decode.
    expect(decode(base)).toEqual(base)
    for (const risk of ['low', 'medium', 'high', 'critical'] as const) {
      expect(decode({ ...base, risk })).toEqual({ ...base, risk })
    }
    expect(() => decode({ ...base, risk: 'unknown' })).toThrow()
  })

  test('interaction/resolved events carry an optional interactionId for precise card closing', () => {
    const decode = Schema.decodeUnknownSync(EventManifest['interaction/resolved'].payload)
    const withId = {
      interactionId: 'interaction-permission-2',
      result: {
        kind: 'permission' as const,
        decision: 'grant' as const,
        scope: 'tool-call' as const,
        grantedPermissions: { readPaths: ['C:\\workspace'] },
      },
      resolvedAt: 10,
    }
    const legacy = {
      result: { kind: 'approval' as const, decision: 'deny' as const },
      resolvedAt: 10,
    }
    expect(decode(withId)).toEqual(withId)
    // Historical replay without the identifier still decodes.
    expect(decode(legacy)).toEqual(legacy)
  })
})

test('电脑应用授权使用独立响应字段，普通旧允许仍可解码', () => {
  const decode = Schema.decodeUnknownSync(ServerRequestResultSchema)
  expect(decode({ kind: 'approval', decision: 'allow-once' })).toEqual({
    kind: 'approval',
    decision: 'allow-once',
  })
  for (const computerGrant of ['chat', 'persistent'] as const)
    expect(decode({ kind: 'approval', decision: 'allow-once', computerGrant })).toEqual({
      kind: 'approval',
      decision: 'allow-once',
      computerGrant,
    })
  expect(() =>
    decode({ kind: 'approval', decision: 'allow-once', computerGrant: 'workspace' }),
  ).toThrow()
})
