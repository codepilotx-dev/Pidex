import { Effect } from 'effect'
import { AgentError } from '../Domain'
import type { ComputerUseService } from '../computer/ComputerUseService'
import type { ApprovalService } from '../permission/ApprovalService'
import type { QuestionService } from '../session/QuestionService'
import type { ThreadService } from '../session/ThreadService'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import type { SubagentService } from '../subagent/SubagentService'
import { secretScrubber } from '../security/SecretScrubber'
import { hookTrustRequestedPayload } from './HookTrustPayloads'

const record = (value: unknown, name = 'value'): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  }
  return value as Record<string, unknown>
}

const enumValue = <T extends string>(value: unknown, allowed: readonly T[], name: string): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  }
  return value as T
}

const stringParam = (params: Record<string, unknown>, name: string) => {
  const value = params[name]
  if (typeof value !== 'string' || !value)
    throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  return value
}

const offsetCursor = (value: unknown) => {
  if (value === undefined) return 0
  if (typeof value !== 'string' || !/^offset:\d+$/.test(value))
    throw new AgentError('INVALID_REQUEST', 'cursor 参数无效', 400)
  return Number(value.slice('offset:'.length))
}

export type InteractionServiceDependencies = {
  mcpElicitations?: import('../mcp/McpElicitationService').McpElicitationService
  db: AgentDatabase
  hub: EventHub
  computer?: ComputerUseService
  approvals: ApprovalService
  questions: QuestionService
  subagents: SubagentService
  threads: ThreadService
}

/** Surface-neutral interaction orchestration. RPC handlers only decode and delegate. */
export class InteractionService {
  constructor(private readonly dependencies: InteractionServiceDependencies) {}

  listPending(rawParams: Record<string, unknown>) {
    const { db } = this.dependencies
    const repository = db.repositories.interactions
    const threadID = typeof rawParams.threadId === 'string' ? rawParams.threadId : undefined
    const requestedKinds = Array.isArray(rawParams.kinds)
      ? new Set(rawParams.kinds.filter((kind): kind is string => typeof kind === 'string'))
      : null
    const interactions: Array<Record<string, unknown>> = []
    if (!requestedKinds || requestedKinds.has('mcp-elicitation'))
      interactions.push(...repository.pendingMcpElicitations(threadID))

    if (!requestedKinds || requestedKinds.has('approval') || requestedKinds.has('permission')) {
      for (const row of repository.pendingApprovalIDs(threadID)) {
        const checkpoint = db.getApprovalCheckpoint(row.id)
        if (!checkpoint) continue
        const invocation = checkpoint.payload.invocation
        const isPermission = invocation.name === 'request_permissions'
        if (requestedKinds && !requestedKinds.has(isPermission ? 'permission' : 'approval'))
          continue
        const permissionSource = isPermission
          ? invocation.input
          : record(invocation.input.additionalPermissions ?? {}, 'requestedPermissions')
        const requestedPermissions = {
          ...(Array.isArray(permissionSource.readPaths)
            ? { readPaths: permissionSource.readPaths }
            : {}),
          ...(Array.isArray(permissionSource.writePaths)
            ? { writePaths: permissionSource.writePaths }
            : {}),
          ...(Array.isArray(permissionSource.networkDomains)
            ? { networkDomains: permissionSource.networkDomains }
            : {}),
        }
        const metadata = {
          interactionId: checkpoint.approvalID,
          threadId: checkpoint.threadID,
          turnId: checkpoint.turnID,
          agentId: checkpoint.agentID,
          createdAt: checkpoint.createdAt,
          version: checkpoint.version,
          toolCallId: checkpoint.toolCallID,
          tool: invocation.name,
          reason:
            typeof invocation.input.justification === 'string'
              ? invocation.input.justification
              : checkpoint.reason || '需要批准工具调用',
          requestedPermissions,
        }
        if (isPermission) {
          const requestedScope = enumValue(
            invocation.input.scope,
            ['tool-call', 'turn', 'session'] as const,
            'permission.scope',
          )
          interactions.push({
            ...metadata,
            kind: 'permission',
            requestedScope,
            allowedScopes:
              requestedScope === 'session'
                ? ['tool-call', 'turn', 'session']
                : requestedScope === 'turn'
                  ? ['tool-call', 'turn']
                  : ['tool-call'],
          })
        } else {
          interactions.push({
            ...metadata,
            kind: 'approval',
            ...this.dependencies.approvals.approvalMetadata(invocation),
            ...(invocation.authorizationScope?.computerApp
              ? { computerApp: invocation.authorizationScope.computerApp }
              : {}),
            risk: ['low', 'medium', 'high', 'critical'].includes(checkpoint.risk)
              ? checkpoint.risk
              : 'high',
            ...(typeof invocation.input.command === 'string'
              ? { command: invocation.input.command }
              : {}),
            ...(typeof invocation.input.cwd === 'string' ? { cwd: invocation.input.cwd } : {}),
            allowedChoices: ['allow-once', 'deny', 'stop'],
          })
        }
      }
    }

    if (!requestedKinds || requestedKinds.has('question')) {
      for (const row of repository.pendingQuestions(threadID)) {
        const questions = Array.isArray(row.payload.questions)
          ? row.payload.questions.flatMap((entry) => {
              const question = record(entry, 'question')
              if (
                typeof question.id !== 'string' ||
                typeof question.header !== 'string' ||
                typeof question.prompt !== 'string' ||
                !Array.isArray(question.choices)
              )
                return []
              const choices = question.choices.flatMap((entry) => {
                const choice = record(entry, 'choice')
                return typeof choice.id === 'string' &&
                  typeof choice.label === 'string' &&
                  typeof choice.description === 'string'
                  ? [
                      {
                        id: choice.id,
                        label: choice.label,
                        description: choice.description,
                        recommended: choice.recommended === true,
                      },
                    ]
                  : []
              })
              return choices.length <= 3
                ? [
                    {
                      id: question.id,
                      header: question.header,
                      prompt: question.prompt,
                      choices,
                      allowFreeform: true,
                      required: true,
                      minAnswers: typeof question.minAnswers === 'number' ? question.minAnswers : 1,
                      maxAnswers: typeof question.maxAnswers === 'number' ? question.maxAnswers : 1,
                    },
                  ]
                : []
            })
          : []
        if (questions.length === 0) continue
        interactions.push({
          interactionId: row.id,
          threadId: row.threadID,
          turnId: row.turnID,
          agentId: row.agentID,
          createdAt: row.createdAt,
          version: row.payloadVersion,
          kind: 'question',
          questions,
          ...(row.payload.autoResolutionPaused === true ? { autoResolutionPaused: true } : {}),
          ...(typeof row.payload.autoResolutionMs === 'number'
            ? { autoResolutionMs: row.payload.autoResolutionMs }
            : {}),
        })
      }
    }

    if (!requestedKinds || requestedKinds.has('hookTrust')) {
      for (const row of repository.pendingHookTrustWaiters(threadID)) {
        const request = db.getHookTrustRequest(row.id)
        if (!request) continue
        interactions.push(
          hookTrustRequestedPayload(request, {
            threadID: row.thread_id,
            turnID: row.turn_id,
            agentID: row.agent_id,
          }),
        )
      }
    }

    interactions.sort(
      (left, right) =>
        Number(left.createdAt) - Number(right.createdAt) ||
        String(left.interactionId).localeCompare(String(right.interactionId)),
    )
    const offset = offsetCursor(rawParams.cursor)
    const limit = typeof rawParams.limit === 'number' ? rawParams.limit : 100
    const page = interactions.slice(offset, offset + limit)
    return {
      interactions: page,
      nextCursor:
        offset + page.length < interactions.length ? `offset:${offset + page.length}` : null,
    }
  }

  async respond(rawParams: Record<string, unknown>) {
    const { db, approvals, questions, subagents, threads, hub } = this.dependencies
    const repository = db.repositories.interactions
    const operationID = stringParam(rawParams, 'operationId')
    const interactionID = stringParam(rawParams, 'interactionId')
    const expectedVersion = rawParams.expectedVersion
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 0)
      throw new AgentError('INVALID_REQUEST', 'expectedVersion 参数无效', 400)
    const response = record(rawParams.response, 'response')
    const duplicate = repository.interactionOperation(operationID)
    if (duplicate) {
      if (
        duplicate.interactionID !== interactionID ||
        JSON.stringify(duplicate.response) !== JSON.stringify(response)
      ) {
        throw new AgentError('CONFLICT', 'operationId 已被其他 interaction 响应使用', 409)
      }
      const duplicateKind = enumValue(
        duplicate.response.kind,
        ['approval', 'permission', 'question', 'hookTrust', 'mcp-elicitation'] as const,
        'response.kind',
      )
      const stopped =
        (duplicateKind === 'approval' || duplicateKind === 'permission') &&
        duplicate.response.decision === 'stop'
      if (stopped) {
        const target = repository.interactionStopTarget(interactionID)
        if (target) {
          const execution = db.getAgentExecution(target.agentID)
          if (execution?.subagentRunID) {
            const taskID = repository.subagentTaskID(execution.subagentRunID)
            if (taskID) await subagents.stop(taskID, operationID).catch(() => undefined)
          } else
            await threads.abortStoppedTurn(target.threadID, target.turnID).catch(() => undefined)
        }
      } else if (duplicateKind !== 'mcp-elicitation') {
        for (const target of repository.interactionResumeTargets(interactionID, duplicateKind)) {
          const execution = db.getAgentExecution(target.agentID)
          if (execution?.subagentRunID) await subagents.resumeTurn(target.threadID, target.turnID)
          else if (duplicateKind === 'hookTrust')
            threads.resumeHookTrust(target.threadID, target.turnID)
          else threads.resumeTurn(target.threadID, target.turnID)
        }
      }
      return duplicate.result
    }
    const kind = enumValue(
      response.kind,
      ['approval', 'permission', 'question', 'hookTrust', 'mcp-elicitation'] as const,
      'response.kind',
    )
    const resolvedAt = Date.now()
    const result = {
      interactionId: interactionID,
      kind,
      state: 'resolved',
      version: Number(expectedVersion) + 1,
      resolvedAt,
      response,
    }
    const operation = { operationID, interactionID, response, result }
    const resumeActions: Array<() => void | Promise<void>> = []
    let operationPersistedWithResolution = false

    const stopCheckpoint = async (checkpoint: {
      agentID: string
      threadID: string
      turnID: string
    }) => {
      const execution = db.getAgentExecution(checkpoint.agentID)
      const stopped = repository.resolveStopInteraction({
        interactionID,
        threadID: checkpoint.threadID,
        turnID: checkpoint.turnID,
        agentID: checkpoint.agentID,
        operation,
      })
      operationPersistedWithResolution = true
      await Promise.allSettled(stopped.events.map((event) => Effect.runPromise(hub.publish(event))))
      if (execution?.subagentRunID) {
        const taskID = repository.subagentTaskID(execution.subagentRunID)
        if (!taskID) throw new AgentError('SUBAGENT_NOT_FOUND', '子 Agent 不存在', 404)
        await subagents.stop(taskID, operationID).catch(() => undefined)
      } else
        await threads
          .abortStoppedTurn(checkpoint.threadID, checkpoint.turnID)
          .catch(() => undefined)
    }
    const queueResume = (resolved: { agentID: string; threadID: string; turnID: string }) => {
      const execution = db.getAgentExecution(resolved.agentID)
      resumeActions.push(() =>
        execution?.subagentRunID
          ? subagents.resumeTurn(resolved.threadID, resolved.turnID)
          : threads.resumeTurn(resolved.threadID, resolved.turnID),
      )
    }

    if (kind === 'mcp-elicitation') {
      const service = this.dependencies.mcpElicitations
      if (!service) throw new AgentError('CAPABILITY_REQUIRED', 'MCP 表单不可用', 409)
      const action = enumValue(
        response.action,
        ['accept', 'decline', 'cancel'] as const,
        'response.action',
      )
      await service.respond(
        interactionID,
        Number(expectedVersion),
        {
          kind: 'mcp-elicitation',
          action,
          ...(response.content
            ? {
                content: response.content as Record<
                  string,
                  import('@pidex/agent-protocol').JsonValue
                >,
              }
            : {}),
        },
        operation,
      )
      operationPersistedWithResolution = true
    } else if (kind === 'approval') {
      const checkpoint = db.getApprovalCheckpoint(interactionID)
      if (!checkpoint || checkpoint.status !== 'pending')
        throw new AgentError('REQUEST_NOT_PENDING', '审批请求不存在或已处理', 409)
      if (checkpoint.version !== expectedVersion)
        throw new AgentError('CONFLICT', '审批请求版本已经变化', 409)
      const decision = enumValue(
        response.decision,
        ['allow-once', 'deny', 'stop'] as const,
        'response.decision',
      )
      const invocation = checkpoint.payload.invocation
      if (
        response.grantOptionId !== undefined &&
        (decision !== 'allow-once' || typeof response.grantOptionId !== 'string')
      )
        throw new AgentError('INVALID_REQUEST', '授权范围仅用于允许操作', 400)
      if (response.grantOptionId !== undefined)
        approvals.validateGrant(invocation, String(response.grantOptionId))
      if (response.remember !== undefined)
        throw new AgentError(
          'INVALID_REQUEST',
          '通用记忆规则不可用，请使用 Agent 提供的授权选项',
          400,
        )
      const isComputer =
        invocation.name === 'ComputerRead' && !!invocation.authorizationScope?.computerApp
      if (response.computerGrant !== undefined && (!isComputer || decision !== 'allow-once'))
        throw new AgentError('INVALID_REQUEST', '应用授权范围仅用于允许读取应用', 400)
      if (isComputer && response.remember !== undefined)
        throw new AgentError('INVALID_REQUEST', '电脑应用授权不能使用命令或工具记忆规则', 400)
      const computerGrant =
        isComputer && decision === 'allow-once'
          ? enumValue(
              response.computerGrant ?? 'chat',
              ['chat', 'persistent'] as const,
              'response.computerGrant',
            )
          : undefined
      if (computerGrant) {
        const computer = this.dependencies.computer
        if (!computer) throw new AgentError('CAPABILITY_REQUIRED', '电脑控制不可用', 409)
        computer.validateGrant(
          {
            threadID: invocation.threadID,
            turnID: invocation.turnID,
            agentID: invocation.agentID,
            toolCallID: invocation.id,
          },
          String(invocation.input.windowRef),
          invocation.authorizationScope!.fingerprint,
          computerGrant === 'persistent',
          invocation.taskMode === 'plan',
          invocation.permissionConfig,
        )
      }
      if (decision === 'stop') await stopCheckpoint(checkpoint)
      else {
        const rawFeedback = response.feedback
        if (rawFeedback !== undefined && typeof rawFeedback !== 'string')
          throw new AgentError('INVALID_REQUEST', 'response.feedback 参数无效', 400)
        if (decision !== 'deny' && rawFeedback?.trim())
          throw new AgentError('INVALID_REQUEST', '只有拒绝审批时才能提交调整意见', 400)
        const trimmed = rawFeedback?.trim().slice(0, 4_000)
        const resolved = await approvals.respond(
          interactionID,
          decision === 'allow-once' ? 'allow' : 'deny',
          trimmed ? secretScrubber.scrubText(trimmed) : undefined,
          operation,
          computerGrant,
          typeof response.grantOptionId === 'string' ? response.grantOptionId : undefined,
        )
        operationPersistedWithResolution = true
        queueResume(resolved)
      }
    } else if (kind === 'permission') {
      const checkpoint = db.getApprovalCheckpoint(interactionID)
      if (
        !checkpoint ||
        checkpoint.status !== 'pending' ||
        checkpoint.payload.invocation.name !== 'request_permissions'
      )
        throw new AgentError('REQUEST_NOT_PENDING', '权限请求不存在或已处理', 409)
      if (checkpoint.version !== expectedVersion)
        throw new AgentError('CONFLICT', '权限请求版本已经变化', 409)
      const decision = enumValue(
        response.decision,
        ['grant', 'deny', 'stop'] as const,
        'response.decision',
      )
      if (decision === 'stop') await stopCheckpoint(checkpoint)
      else {
        let resolved
        if (decision === 'grant') {
          const requestedScope = enumValue(
            checkpoint.payload.invocation.input.scope,
            ['tool-call', 'turn', 'session'] as const,
            'permission.requestedScope',
          )
          const scope = enumValue(
            response.scope,
            ['tool-call', 'turn', 'session'] as const,
            'response.scope',
          )
          const rank = { 'tool-call': 0, turn: 1, session: 2 } as const
          if (rank[scope] > rank[requestedScope])
            throw new AgentError('INVALID_REQUEST', '授予范围不能高于工具请求范围', 400)
          resolved = await approvals.respondPermission(
            interactionID,
            'allow',
            {
              scope,
              grantedPermissions: record(
                response.grantedPermissions,
                'response.grantedPermissions',
              ),
            },
            operation,
          )
        } else
          resolved = await approvals.respondPermission(interactionID, 'deny', undefined, operation)
        operationPersistedWithResolution = true
        queueResume(resolved)
      }
    } else if (kind === 'question') {
      const question = repository.pendingQuestionVersion(interactionID)
      if (!question || question.status !== 'pending')
        throw new AgentError('REQUEST_NOT_PENDING', '问题不存在或已经回答', 409)
      if (question.version !== expectedVersion)
        throw new AgentError('CONFLICT', '问题版本已经变化', 409)
      const status = enumValue(response.status, ['answered', 'ignored'] as const, 'response.status')
      const resolved = await questions.reply(
        interactionID,
        status === 'ignored' ? null : response.answers,
        status === 'ignored',
        status === 'answered'
          ? enumValue(response.resolution, ['user', 'auto'] as const, 'response.resolution')
          : 'user',
        false,
        operation,
      )
      operationPersistedWithResolution = true
      const execution = db.agentForTurn(resolved.turnID)
      resumeActions.push(() =>
        execution?.subagentRunID
          ? subagents.resumeTurn(resolved.threadID, resolved.turnID)
          : threads.resumeTurn(resolved.threadID, resolved.turnID),
      )
    } else {
      const request = db.getHookTrustRequest(interactionID)
      if (!request || request.status !== 'pending')
        throw new AgentError('REQUEST_NOT_PENDING', 'Hook 信任请求不存在或已经处理', 409)
      if (expectedVersion !== 1) throw new AgentError('CONFLICT', 'Hook 信任请求版本已经变化', 409)
      const decision = enumValue(
        response.decision,
        ['allow', 'block'] as const,
        'response.decision',
      )
      const resolved = db.resolveHookTrustRequest(interactionID, decision, operation)
      operationPersistedWithResolution = true
      await Promise.allSettled(
        resolved.events.map((event) => Effect.runPromise(hub.publish(event))),
      )
      for (const resumed of resolved.resumed) {
        const execution = db.getAgentExecution(resumed.agentID)
        resumeActions.push(() =>
          execution?.subagentRunID
            ? subagents.resumeTurn(resumed.threadID, resumed.turnID)
            : threads.resumeHookTrust(resumed.threadID, resumed.turnID),
        )
      }
    }

    const storedOperation = operationPersistedWithResolution
      ? repository.interactionOperation(operationID)
      : null
    const stored = (storedOperation ?? repository.saveInteractionOperation(operation)).result
    for (const resume of resumeActions) await resume()
    return stored
  }
}
