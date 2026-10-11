import { describe, expect, test } from 'bun:test'
import type { DesktopPermissionGrant, DesktopPermissionRequest } from '../shared/Types.js'
import {
  permissionGrantDefaultScope,
  permissionGrantGroups,
  permissionGrantScopeOptions,
} from '../src/features/session/approvals/InlineApprovalCard.js'
import { approvalToRequest } from '../src/services/AgentThreadAdapter.js'

function permissionRequest(
  overrides: Partial<DesktopPermissionGrant> = {},
): DesktopPermissionRequest {
  return {
    requestId: 'permission-1',
    toolName: 'request_permissions',
    toolUseId: 'call-perm',
    input: {
      paths: ['C:\\docs', 'C:\\out', 'api.example.com'],
      risk: 'high',
    },
    description: '需要额外权限',
    requestKind: 'permission-grant',
    permissionGrant: {
      requestedPermissions: {
        readPaths: ['C:\\docs'],
        writePaths: ['C:\\out'],
        networkDomains: ['api.example.com'],
      },
      requestedScope: 'session',
      allowedScopes: ['tool-call', 'turn', 'session'],
      ...overrides,
    },
  }
}

describe('dynamic permission-grant card', () => {
  test('默认选中 Agent 请求的范围，只提供同级或更小的授权范围', () => {
    const request = permissionRequest({ requestedScope: 'session' })
    const options = permissionGrantScopeOptions(request)

    expect(options.map((option) => option.scope)).toEqual(['tool-call', 'turn', 'session'])
    expect(options.map((option) => option.label)).toEqual([
      '仅此次工具调用',
      '当前轮次',
      '当前任务会话',
    ])
    expect(permissionGrantDefaultScope(options, request.permissionGrant?.requestedScope)).toBe(
      'session',
    )
  })

  test('降级请求时默认较小范围，且不能越权选择更大范围', () => {
    const request = permissionRequest({
      requestedScope: 'turn',
      allowedScopes: ['tool-call', 'turn'],
    })
    const options = permissionGrantScopeOptions(request)

    expect(options.map((option) => option.scope)).toEqual(['tool-call', 'turn'])
    expect(permissionGrantDefaultScope(options, request.permissionGrant?.requestedScope)).toBe(
      'turn',
    )

    // Agent 只授予 tool-call 时，界面没有任何可选的更大范围。
    const single = permissionRequest({
      requestedScope: 'tool-call',
      allowedScopes: ['tool-call'],
    })
    expect(permissionGrantScopeOptions(single).map((option) => option.scope)).toEqual(['tool-call'])
  })

  test('缺失 allowedScopes 的旧记录回退到请求范围', () => {
    const request = permissionRequest({ allowedScopes: [] })
    const options = permissionGrantScopeOptions(request)
    expect(options.map((option) => option.scope)).toEqual(['session'])
    expect(permissionGrantDefaultScope(options, request.permissionGrant?.requestedScope)).toBe(
      'session',
    )
  })

  test('按读取路径、写入路径和网络域名分组展示授权内容', () => {
    const request = permissionRequest()
    expect(permissionGrantGroups(request)).toEqual([
      { title: '读取路径', items: ['C:\\docs'] },
      { title: '写入路径', items: ['C:\\out'] },
      { title: '网络域名', items: ['api.example.com'] },
    ])
  })

  test('缺少分组信息时回退到 input.paths 展示涉及范围', () => {
    const request = permissionRequest({
      requestedPermissions: { readPaths: [], writePaths: [], networkDomains: [] },
    })
    expect(permissionGrantGroups(request)).toEqual([
      { title: '涉及范围', items: ['C:\\docs', 'C:\\out', 'api.example.com'] },
    ])
  })

  test('approvalToRequest 把带 permissionGrant 的审批映射为 permission-grant', () => {
    const request = approvalToRequest({
      id: 'approval-perm',
      threadId: 'thread-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      toolCallID: 'call-perm',
      tool: 'request_permissions',
      command: null,
      cwd: null,
      paths: ['C:\\docs', 'C:\\out'],
      requestedPermissions: {
        readPaths: ['C:\\docs'],
        writePaths: ['C:\\out'],
        networkDomains: [],
      },
      review: null,
      risk: 'high',
      reason: '需要额外权限',
      status: 'pending',
      createdAt: 1,
      permissionGrant: { requestedScope: 'turn', allowedScopes: ['tool-call', 'turn'] },
    })
    expect(request.requestKind).toBe('permission-grant')
    expect(request.permissionGrant).toEqual({
      requestedPermissions: {
        readPaths: ['C:\\docs'],
        writePaths: ['C:\\out'],
        networkDomains: [],
      },
      requestedScope: 'turn',
      allowedScopes: ['tool-call', 'turn'],
    })

    const plain = approvalToRequest({
      id: 'approval-plain',
      threadId: 'thread-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      toolCallID: 'call-1',
      tool: 'shell',
      command: 'bun test',
      cwd: null,
      paths: [],
      requestedPermissions: { readPaths: [], writePaths: [], networkDomains: [] },
      review: null,
      risk: 'medium',
      reason: '需要运行测试',
      status: 'pending',
      createdAt: 1,
    })
    expect(plain.requestKind).toBe('shell-command')
    expect(plain.permissionGrant).toBeUndefined()
  })
})
