import { expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

const LISTED_RULE = {
  id: 'rule-1',
  effect: 'allow',
  scope: 'chat',
  source: 'chat',
  match: { kind: 'tool', tool: 'Bash' },
  editable: true,
  version: '2',
} as const

test('审批规则客户端通过 permission.rules.v1 列出、写入并撤销规则', async () => {
  const methods: string[] = []
  const fetcher = async (_path: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body))
    methods.push(body.method)
    if (body.method === 'initialize') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocol: 'thread-rpc-v4',
          serverInfo: { name: 'test', version: '1' },
          capabilities: body.params.capabilities.filter((capability: string) =>
            ['rpc.typed.v1', 'permission.rules.v1'].includes(capability),
          ),
          limits: {
            maxFrameBytes: 1024,
            maxSubscriptions: 4,
            maxStreamsPerSubscription: 4,
            maxPendingRequests: 8,
          },
          connectionId: 'approval-rules-test',
        },
      })
    }
    if (body.method === 'initialized') return new Response(null, { status: 204 })
    if (body.method === 'approval/rules/list') {
      expect(body.params).toEqual({ threadId: 'thread-1' })
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { rules: [LISTED_RULE] },
      })
    }
    if (body.method === 'approval/rules/upsert') {
      expect(body.params).toEqual({
        threadId: 'thread-1',
        expectedVersion: '2',
        rule: {
          id: 'rule-1',
          effect: 'deny',
          scope: 'chat',
          match: { kind: 'tool', tool: 'Write' },
        },
      })
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { rule: { ...LISTED_RULE, effect: 'deny', version: '3' } },
      })
    }
    if (body.method === 'approval/rules/revoke') {
      expect(body.params).toEqual({
        threadId: 'thread-1',
        ruleId: 'rule-1',
        expectedVersion: '3',
      })
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { revoked: true } })
    }
    throw new Error(`Unhandled RPC method: ${body.method}`)
  }
  const client = createDesktopClient({ fetch: fetcher })

  const listed = await client.listApprovalRules('thread-1')
  expect(listed.rules[0]?.id).toBe('rule-1')

  const upserted = await client.upsertApprovalRule({
    threadId: 'thread-1',
    expectedVersion: '2',
    rule: {
      id: 'rule-1',
      effect: 'deny',
      scope: 'chat',
      match: { kind: 'tool', tool: 'Write' },
    },
  })
  expect(upserted.rule.effect).toBe('deny')
  expect(upserted.rule.version).toBe('3')

  expect(await client.revokeApprovalRule('thread-1', 'rule-1', '3')).toEqual({ revoked: true })
  expect(methods.slice(0, 5)).toEqual([
    'initialize',
    'initialized',
    'approval/rules/list',
    'approval/rules/upsert',
    'approval/rules/revoke',
  ])
})
