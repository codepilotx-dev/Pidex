import { describe, expect, test } from 'bun:test'
import type { AgentDatabase } from '../src/storage/database/AgentDatabase'
import type { ToolInvocation } from '../src/Domain'
import { ReviewerService } from '../src/permission/ReviewerService'
import type { PiModelService } from '../src/provider/pi'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { PermissionDecisionEngine } from '../src/permission/PermissionDecisionEngine'
import { Model, Provider } from '@pidex/model-schema'

const reviewer = (
  getSetting: AgentDatabase['getSetting'],
  providers: PiModelService = {} as PiModelService,
) => {
  const configured = getSetting<Model.Ref>('reviewerModel')
  return new ReviewerService(
    { getSetting, threadProjectID: () => null } as unknown as AgentDatabase,
    providers,
    {
      snapshot: () =>
        configured
          ? {
              model_provider: String(configured.providerID),
              specialized_models: {
                security: `${String(configured.providerID)}/${String(configured.id)}`,
              },
            }
          : {},
    } as never,
  )
}

describe('Shell ReviewerService', () => {
  test('静态灾难级命令在没有审核模型时也直接拒绝', async () => {
    const service = reviewer(() => null)
    const result = await service.reviewShell({ command: 'format C:' }, new AbortController().signal)
    expect(result).toMatchObject({ decision: 'deny', risk: 'critical', requestedScopeValid: true })
    expect(result.categories).toContain('destructive')
  })

  test('审核模型未配置时普通 Shell fail-closed', async () => {
    const service = reviewer(() => null)
    const result = await service.reviewShell({ command: 'npm test' }, new AbortController().signal)
    expect(result).toMatchObject({ decision: 'deny', risk: 'high', requestedScopeValid: true })
    expect(result.reason).toContain('审核模型')
  })

  test('旧 review 调用保持 PermissionDecision 兼容，并对 Shell 审核异常拒绝', async () => {
    const service = reviewer(() => null)
    const invocation = {
      id: 'tool-1',
      threadID: 'thread-1',
      turnID: 'turn-1',
      name: 'shell.execute',
      input: { command: 'npm test' },
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
      taskMode: 'chat',
    } as unknown as ToolInvocation
    await expect(service.review(invocation, new AbortController().signal)).resolves.toMatchObject({
      decision: 'deny',
      risk: 'high',
    })
  })

  test('on-request 对基础 sandbox Shell 直接执行，仅权限提升进入审核', () => {
    const tools = new ToolRegistry()
    const engine = new PermissionDecisionEngine()
    const base = {
      id: 'tool-2',
      threadID: 'thread-1',
      turnID: 'turn-1',
      agentID: 'agent-1',
      name: 'shell',
      input: { command: 'npm test' },
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      taskMode: 'chat',
    } as unknown as ToolInvocation
    expect(engine.evaluate(base, tools.get('PowerShell'))).toMatchObject({ action: 'allow' })
    expect(
      engine.evaluate(
        {
          ...base,
          input: { command: 'npm test', additionalPermissions: { networkDomains: ['npmjs.org'] } },
        },
        tools.get('PowerShell'),
      ),
    ).toMatchObject({ action: 'review', reviewer: 'user' })
  })

  test('独立审核模型不可用时回退当前任务模型', async () => {
    const configured = Model.Ref.make({
      providerID: Provider.ID.make('configured'),
      id: Model.ID.make('reviewer'),
    })
    const fallback = Model.Ref.make({
      providerID: Provider.ID.make('fallback'),
      id: Model.ID.make('task'),
    })
    const resolved: string[] = []
    const providers = {
      getPiModel: async (ref: Model.Ref) => {
        resolved.push(`${ref.providerID}/${ref.id}`)
        if (String(ref.providerID) === 'configured') throw new Error('reviewer unavailable')
        return { provider: 'fallback', id: 'task' }
      },
      pi: {
        completeSimple: async () => ({
          stopReason: 'stop',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                decision: 'allow',
                risk: 'low',
                confidence: 'high',
                categories: [],
                requestedScopeValid: true,
                reason: '任务模型审核通过',
              }),
            },
          ],
        }),
      },
    } as unknown as PiModelService
    const service = reviewer((() => configured) as AgentDatabase['getSetting'], providers)

    await expect(
      service.reviewShell({ command: 'npm test' }, new AbortController().signal, fallback),
    ).resolves.toMatchObject({ decision: 'allow', reason: '任务模型审核通过' })
    expect(resolved).toEqual(['configured/reviewer', 'fallback/task'])
  })

  test('独立审核模型与任务模型都不可用时保持 fail-closed', async () => {
    const configured = Model.Ref.make({
      providerID: Provider.ID.make('configured'),
      id: Model.ID.make('reviewer'),
    })
    const fallback = Model.Ref.make({
      providerID: Provider.ID.make('fallback'),
      id: Model.ID.make('task'),
    })
    const providers = {
      getPiModel: async () => {
        throw new Error('all reviewers unavailable')
      },
    } as unknown as PiModelService
    const service = reviewer((() => configured) as AgentDatabase['getSetting'], providers)

    await expect(
      service.reviewShell({ command: 'npm test' }, new AbortController().signal, fallback),
    ).resolves.toMatchObject({ decision: 'deny', reviewUnavailable: true })
  })
})
