import { z } from 'zod'
import type { ThreadPullRequestList } from '@pidex/shared/thread'
import type { ThreadPullRequestService } from '../../github/ThreadPullRequestService'
import { AgentError } from '../../Domain'
import type { ToolDefinition } from '../ToolRegistry'

const schema = z
  .object({
    url: z.string().trim().min(1),
  })
  .strict()

type AttachPullRequestInput = z.infer<typeof schema>

type AttachPullRequestOutput = { thread: ThreadPullRequestList }

export const createAttachPullRequestDefinition = (
  service: ThreadPullRequestService,
): ToolDefinition<AttachPullRequestInput, AttachPullRequestOutput> => ({
  sdkName: 'attach_pull_request',
  name: 'attach_pull_request',
  schema,
  description: [
    '把当前会话关联到一个真实存在的 GitHub Pull Request，使其出现在 PR 侧栏。',
    '成功创建 PR 后，无论通过 Shell 还是其他工具创建，都必须携带返回的真实 URL 调用本工具；多个 PR 逐个绑定。',
    '用户明确要求分析、审查、更新、继续处理或关联已有 PR 时也必须绑定，包括只读分析、只要求简短摘要或只提供仓库与 PR 编号的任务。取得真实 PR URL 后，在最终回复前调用；绑定只写当前会话的关联，不修改 GitHub。',
    '仅作示例、参考、依赖、对比或背景的 PR 不绑定。不要在 PR 尚未创建、只有计划、标题或分支名时调用。',
    '本工具只做绑定：如果 PR 已创建但这次绑定失败，必须如实向用户报告“PR 已创建，但未能绑定到当前会话”，不得谎报绑定成功或重新创建 PR。',
  ].join('\n'),
  capabilities: {
    filesystem: 'none',
    network: 'declared',
    process: false,
    externalState: true,
    userInteraction: false,
  },
  allowedModes: ['chat'],
  allowedProfiles: ['main', 'default', 'worker'],
  approvalStrategy: 'policy',
  visibility: 'eager',
  executionMode: 'sequential',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        minLength: 1,
        description:
          '真实存在的 github.com Pull Request URL，例如 https://github.com/owner/repo/pull/123。',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const threadId = context.invocation?.threadID
    if (!threadId)
      throw new AgentError('PERMISSION_DENIED', '绑定 Pull Request 缺少受信任的会话上下文', 403)
    try {
      return await service.link({ threadId, url: input.url })
    } catch (cause) {
      // Service validation/state errors keep their safe envelope; anything else
      // is normalized so raw provider/network details never reach the model.
      if (cause instanceof AgentError) throw cause
      throw new AgentError('PULL_REQUEST_BIND_FAILED', '绑定 Pull Request 失败', 502)
    }
  },
  formatResult: (output) => {
    const items = output.thread.items
    return {
      content: [
        `已将 Pull Request 绑定到当前会话（当前共 ${items.length} 个关联）。`,
        ...items.map((item) => `- ${item.url}${item.title ? `：${item.title}` : ''}`),
      ].join('\n'),
      details: { thread: output.thread },
    }
  },
})
