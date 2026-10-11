import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopPermissionRequest } from '../shared/Types.js'
import { InlineApprovalCard } from '../src/features/session/approvals/InlineApprovalCard.js'
import { approvalToRequest } from '../src/services/AgentThreadAdapter.js'

for (const persistent of [true, false]) {
  test(`电脑审批卡提供对话授权，永久授权可用=${persistent}`, () => {
    const request: DesktopPermissionRequest = {
      requestId: 'computer',
      toolUseId: 'read',
      toolName: 'ComputerRead',
      input: {},
      description: '读取应用',
      computerApp: { name: '记事本', allowPersistentApproval: persistent },
    }
    const html = renderToStaticMarkup(<InlineApprovalCard request={request} onDecide={() => {}} />)
    expect(html).toContain('允许使用 记事本？')
    expect(html).toContain('允许此对话')
    expect(html).toContain('拒绝')
    expect(html).toContain('截图会进入聊天')
    expect(html.includes('始终允许')).toBe(persistent)
    expect(html).not.toContain('允许一次')
  })
}

test('durable 审批投影保留服务端应用授权信息', () => {
  const app = { name: '记事本', allowPersistentApproval: false }
  const request = approvalToRequest({
    id: 'approval',
    threadId: 'thread',
    turnId: 'turn',
    agentId: 'agent',
    toolCallID: 'read',
    tool: 'ComputerRead',
    command: null,
    cwd: null,
    paths: [],
    requestedPermissions: {},
    review: null,
    risk: 'low',
    reason: '读取',
    status: 'pending',
    createdAt: 1,
    computerApp: app,
  })
  expect(request.computerApp).toEqual(app)
})
