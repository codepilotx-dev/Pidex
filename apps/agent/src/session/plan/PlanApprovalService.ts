import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import type { PlanApproval } from '@pidex/shared/thread'
import { AgentError } from '../../Domain'
import type { AgentDatabase } from '../../storage/database/AgentDatabase'
import type { EventHub } from '../../storage/events/EventHub'
import type { ThreadService } from '../ThreadService'
import type { ThreadForkWorkspaceService } from '../fork/ThreadForkWorkspaceService'
import { probeThreadsStorageCapabilities } from '../../storage/database/StorageCapabilities'

const implementationPrompt = (markdown: string) =>
  `请实施以下已批准的计划。先简短重述用户目标和试图解决的问题，然后重新读取相关代码，完成实施与必要验证；计划中的旧事实需要重新确认：\n\n${markdown}`

export class PlanApprovalService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly threads: Pick<ThreadService, 'withPlanAdmission' | 'startFreshPlanTurn'>,
    private readonly workspaces?: ThreadForkWorkspaceService,
  ) {}

  read(threadId: string): PlanApproval | null {
    this.db.repositories.planApprovals.requireThread(threadId)
    this.db.repositories.planApprovals.recover(threadId)
    return this.db.repositories.planApprovals.pending(threadId)
  }

  supportsFresh() {
    return (
      Boolean(this.workspaces) && probeThreadsStorageCapabilities(this.db.sqlite).projectlessOwner
    )
  }

  async implementFresh(
    params: RpcParams<'planApproval/implementFresh'>,
  ): Promise<RpcResult<'planApproval/implementFresh'>> {
    const { threadId, approvalId, expectedVersion, operationId, model } = params
    const repository = this.db.repositories.planApprovals
    repository.requireThread(threadId, true)
    if (!this.supportsFresh())
      throw new AgentError('PERMISSION_DENIED', '当前 Agent 不支持新聊天实施计划', 403)
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          threadId,
          approvalId,
          expectedVersion,
          action: 'implementFresh',
          model: model
            ? { providerID: model.providerID, id: model.id, variant: model.variant ?? null }
            : null,
        }),
      )
      .digest('hex')
    return this.threads.withPlanAdmission(threadId, async (_start, assertIdle) => {
      const duplicate = repository.duplicate(operationId, fingerprint)
      if (duplicate)
        return {
          approval: duplicate,
          ...repository.implementationTarget(duplicate),
          disposition: 'duplicate',
        }
      assertIdle()
      repository.recover(threadId)
      const approval = repository.assertCurrent(threadId, approvalId, expectedVersion)
      const source = this.db.getTurnInput(approval.turnId)
      const settings = this.db.getThreadSettings(threadId)
      if (!source || !settings) throw new AgentError('CONFLICT', '计划执行上下文不可用', 409)
      let event: ReturnType<AgentDatabase['insertEvent']> | undefined
      const target = await this.threads.startFreshPlanTurn(
        threadId,
        approval.title,
        {
          content: implementationPrompt(approval.markdown),
          model: model ?? source.model,
          permissionConfig: settings.permissionConfig,
          taskMode: 'chat',
          strategy: 'start',
        },
        this.workspaces!,
        {
          beforeCreate: () => {
            const current = repository.assertCurrent(threadId, approvalId, expectedVersion)
            if (
              current.markdown !== approval.markdown ||
              JSON.stringify(this.db.getThreadSettings(threadId)?.permissionConfig) !==
                JSON.stringify(settings.permissionConfig)
            )
              throw new AgentError('CONFLICT', '计划或权限设置已变化，请刷新后重试', 409)
            repository.resolve(approvalId, expectedVersion, 'implemented', operationId, fingerprint)
            event = this.db.insertEvent(threadId, null, 'thread/settings/updated', {
              threadId,
              settings,
            })
          },
          afterCreate: (turnId) => repository.linkTurn(approvalId, turnId),
        },
      )
      if (event) await Effect.runPromise(this.hub.publish(event))
      return { approval: repository.get(approvalId)!, ...target, disposition: 'applied' }
    })
  }

  async respond(
    params: RpcParams<'planApproval/respond'>,
  ): Promise<RpcResult<'planApproval/respond'>> {
    const { threadId, approvalId, expectedVersion, operationId, response } = params
    this.db.repositories.planApprovals.requireThread(threadId, true)
    const feedback = response.action === 'feedback' ? response.feedback.trim() : null
    if (feedback !== null && !feedback)
      throw new AgentError('INVALID_REQUEST', '计划修改意见不能为空', 400)
    const model = response.action === 'close' ? undefined : response.model
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          threadId,
          approvalId,
          expectedVersion,
          action: response.action,
          feedback,
          model: model
            ? { providerID: model.providerID, id: model.id, variant: model.variant ?? null }
            : null,
        }),
      )
      .digest('hex')
    const repository = this.db.repositories.planApprovals
    return this.threads.withPlanAdmission(threadId, async (start, assertIdle) => {
      const duplicate = repository.duplicate(operationId, fingerprint)
      if (duplicate) return { approval: duplicate, disposition: 'duplicate' }
      assertIdle()
      repository.recover(threadId)
      const approval = repository.assertCurrent(threadId, approvalId, expectedVersion)
      const resolve = () => {
        const current = repository.assertCurrent(threadId, approvalId, expectedVersion)
        if (current.markdown !== approval.markdown)
          throw new AgentError('CONFLICT', '计划内容已变化，请刷新后重试', 409)
        repository.resolve(
          approvalId,
          expectedVersion,
          response.action === 'implement'
            ? 'implemented'
            : response.action === 'feedback'
              ? 'feedback'
              : 'closed',
          operationId,
          fingerprint,
        )
      }
      if (response.action === 'close') {
        const event = this.db.transaction(() => {
          resolve()
          const updated = this.db.updateThreadSettings(threadId, { taskMode: 'chat' })
          // Also notify when the setting already matches: the approval itself still changed.
          return (
            updated.event ??
            this.db.insertEvent(threadId, null, 'thread/settings/updated', {
              threadId,
              settings: updated.settings,
            })
          )
        })
        await Effect.runPromise(this.hub.publish(event))
      } else {
        const source = this.db.getTurnInput(approval.turnId)
        const settings = this.db.getThreadSettings(threadId)
        if (!source || !settings) throw new AgentError('CONFLICT', '计划执行上下文不可用', 409)
        await start(
          {
            content:
              response.action === 'implement'
                ? implementationPrompt(approval.markdown)
                : `请根据以下修改意见继续调查并更新计划，不要实施：\n\n${feedback}\n\n原计划：\n${approval.markdown}`,
            model: model ?? source.model,
            permissionConfig: settings.permissionConfig,
            taskMode: response.action === 'implement' ? 'chat' : 'plan',
            strategy: 'start',
          },
          crypto.randomUUID(),
          {
            beforeCreate: () => {
              if (
                JSON.stringify(this.db.getThreadSettings(threadId)?.permissionConfig) !==
                JSON.stringify(settings.permissionConfig)
              )
                throw new AgentError('CONFLICT', '权限设置已变化，请刷新后重试', 409)
              resolve()
            },
            afterCreate: (turnId) => repository.linkTurn(approvalId, turnId),
          },
        )
      }
      return { approval: repository.get(approvalId)!, disposition: 'applied' }
    })
  }
}
