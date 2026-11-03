import type { ModelRef } from '@pidex/shared'
import type { Input, PermissionConfig, ThreadSnapshot } from '@pidex/shared/thread'
import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import { formatCanonicalSkillInvocation } from '../../../shared/DesktopUserMessage.js'
import type {
  DesktopModelSelection,
  DesktopSessionSnapshot,
  DesktopUserMessageInput,
} from '../../../shared/Types.js'
import { AgentRpcError, createAgentRpcClient } from '../AgentRpcClient.js'

type AgentRpcClient = ReturnType<typeof createAgentRpcClient>
type QueueStateResult = RpcResult<'queue/update'>
type TurnGoal = NonNullable<RpcParams<'turn/start'>['goal']>

export type AgentMessageDelivery = 'start' | 'steer' | 'follow-up'

export type AgentMessageAdmission = {
  inputId: string
  outcome: 'sent' | 'steered' | 'queued'
}

type AgentTurnQueueClientDependencies = {
  rpc: AgentRpcClient
  awaitPendingSettingsUpdate: (sessionId: string) => Promise<void>
  importMessageContext: (
    sessionId: string,
    input: DesktopUserMessageInput,
  ) => Promise<{ attachmentIds: string[]; contextReferenceIds: string[] }>
  resolveModelRef: (
    model: string | DesktopModelSelection | undefined,
    sessionId: string,
  ) => Promise<ModelRef>
  permissionConfigForSession: (sessionId: string) => PermissionConfig
  taskModeForSession: (sessionId: string) => 'chat' | 'plan' | 'grill'
  queueVersionForSession: (sessionId: string) => number | undefined
  loadThreadSnapshot: (sessionId: string) => Promise<ThreadSnapshot>
  refreshSession: (sessionId: string) => Promise<DesktopSessionSnapshot>
  emitSessionStoreChange: () => void
  requireSkillInvocationCapability?: () => void
  supportsGoalQueue?: () => boolean
}

export function createAgentTurnQueueClient({
  rpc,
  awaitPendingSettingsUpdate,
  importMessageContext,
  resolveModelRef,
  permissionConfigForSession,
  taskModeForSession,
  queueVersionForSession,
  loadThreadSnapshot,
  refreshSession,
  emitSessionStoreChange,
  requireSkillInvocationCapability,
  supportsGoalQueue,
}: AgentTurnQueueClientDependencies) {
  const pendingInterrupts = new Map<string, Promise<void>>()

  async function submitMessage(
    sessionId: string,
    input: DesktopUserMessageInput,
    delivery: AgentMessageDelivery,
    options?: {
      inputId?: string
      model?: string | DesktopModelSelection
      goal?: TurnGoal
    },
  ): Promise<AgentMessageAdmission> {
    await awaitPendingSettingsUpdate(sessionId)
    const permissionConfig = { ...permissionConfigForSession(sessionId) }
    const taskMode = input.taskMode ?? taskModeForSession(sessionId)
    const goal = input.goal ?? options?.goal
    if (delivery === 'steer' && (goal || input.taskMode === 'plan' || input.taskMode === 'grill'))
      delivery = 'follow-up'
    if (goal && delivery === 'start') {
      const snapshot = await loadThreadSnapshot(sessionId)
      if (
        snapshot.turns.some(
          (turn) =>
            turn.status === 'queued' ||
            turn.status === 'running' ||
            turn.status.startsWith('waiting-'),
        )
      )
        delivery = 'follow-up'
    }
    if (goal && delivery === 'follow-up' && supportsGoalQueue?.() === false) {
      const snapshot = await loadThreadSnapshot(sessionId)
      if (
        snapshot.turns.some(
          (turn) =>
            turn.status === 'queued' ||
            turn.status === 'running' ||
            turn.status.startsWith('waiting-'),
        )
      )
        throw new Error('当前 Agent 不支持目标排队，请等待任务结束或升级 Agent')
      delivery = 'start'
      options = { ...options, goal: { ...goal, expectedVersion: snapshot.goal?.version ?? null } }
    }
    if (goal && taskMode !== 'chat') throw new Error('请先退出计划或访谈模式再提交目标')
    if (input.skills?.length) requireSkillInvocationCapability?.()
    const frozen =
      delivery === 'steer'
        ? undefined
        : {
            model: { ...(await resolveModelRef(options?.model, sessionId)) },
            permissionConfig,
            taskMode,
          }
    const { attachmentIds, contextReferenceIds } = await importMessageContext(sessionId, input)
    const content = formatCanonicalSkillInvocation(input.skillInvocation, input.text)
    const inputId = options?.inputId ?? crypto.randomUUID()

    if (delivery === 'steer') {
      const current = await loadThreadSnapshot(sessionId)
      const activeTurn = findActiveTurn(current)
      if (activeTurn) {
        const taskMode = input.taskMode ?? taskModeForSession(sessionId)
        if (taskMode !== 'chat' && activeTurn.mode !== taskMode)
          throw new Error('当前轮次模式不同，请等待结束或选择排队发送')
        await rpc.call('turn/steer', {
          threadId: sessionId,
          turnId: activeTurn.id,
          inputId,
          content,
          ...(input.skills?.length ? { skills: [...input.skills] } : {}),
          ...(attachmentIds.length ? { attachmentIds } : {}),
          ...(contextReferenceIds.length ? { contextReferenceIds } : {}),
        })
        await refreshSession(sessionId).catch(() => null)
        emitSessionStoreChange()
        return { inputId, outcome: 'steered' }
      }
      await startTurn(
        sessionId,
        inputId,
        content,
        attachmentIds,
        contextReferenceIds,
        options?.model,
        options?.goal,
        input.skills,
        input.taskMode,
        frozen,
      )
      await refreshSession(sessionId).catch(() => null)
      emitSessionStoreChange()
      return { inputId, outcome: 'sent' }
    }

    if (delivery === 'follow-up') {
      const admission = await callQueueMutation(sessionId, 'queue/add', {
        inputId,
        content,
        ...(goal
          ? {
              goal: {
                objective: goal.objective,
                ...(goal.tokenBudget === undefined ? {} : { tokenBudget: goal.tokenBudget }),
              },
            }
          : {}),
        model: frozen!.model,
        ...(input.skills?.length ? { skills: [...input.skills] } : {}),
        permissionConfig,
        taskMode,
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(contextReferenceIds.length ? { contextReferenceIds } : {}),
      })
      await refreshSession(sessionId).catch(() => null)
      emitSessionStoreChange()
      return {
        inputId,
        outcome: admission.admission === 'queued' ? 'queued' : 'sent',
      }
    }

    await startTurn(
      sessionId,
      inputId,
      content,
      attachmentIds,
      contextReferenceIds,
      options?.model,
      options?.goal,
      input.skills,
      input.taskMode,
      frozen,
    )
    await refreshSession(sessionId).catch(() => null)
    emitSessionStoreChange()
    return { inputId, outcome: 'sent' }
  }

  async function callQueueMutation(
    sessionId: string,
    method: 'queue/add',
    params: Record<string, unknown>,
  ): Promise<RpcResult<'queue/add'>>
  async function callQueueMutation(
    sessionId: string,
    method: 'queue/update' | 'queue/remove' | 'queue/resume',
    params: Record<string, unknown>,
  ): Promise<QueueStateResult>
  async function callQueueMutation(
    sessionId: string,
    method: 'queue/add' | 'queue/update' | 'queue/remove' | 'queue/resume',
    params: Record<string, unknown>,
  ): Promise<RpcResult<'queue/add'> | QueueStateResult> {
    const operationId = crypto.randomUUID()
    let originalInput: Input | undefined
    for (let attempt = 0; ; attempt += 1) {
      const snapshot = await loadThreadSnapshot(sessionId)
      const target =
        method === 'queue/update' || method === 'queue/remove'
          ? snapshot.inputs?.find((input) => input.id === params.inputId)
          : undefined
      if (attempt === 0) originalInput = target
      else if (
        originalInput &&
        (!target ||
          JSON.stringify([
            target.content,
            target.skills,
            target.attachmentIds,
            target.contextReferenceIds,
          ]) !==
            JSON.stringify([
              originalInput.content,
              originalInput.skills,
              originalInput.attachmentIds,
              originalInput.contextReferenceIds,
            ]))
      )
        throw Object.assign(new Error('排队消息已被修改或开始执行，已刷新，请确认后重试。'), {
          code: 'QUEUE_VERSION_CONFLICT',
        })
      const expectedVersion = snapshot.queue?.version ?? queueVersionForSession(sessionId)
      try {
        return await rpc.call<RpcResult<'queue/add'> | QueueStateResult>(method, {
          threadId: sessionId,
          ...params,
          operationId,
          ...(typeof expectedVersion === 'number' ? { expectedVersion } : {}),
        })
      } catch (error) {
        await refreshSession(sessionId).catch(() => null)
        emitSessionStoreChange()
        const details = error instanceof AgentRpcError ? error.details : null
        const versionConflict =
          error instanceof AgentRpcError &&
          error.errorCode === 'CONFLICT' &&
          details != null &&
          typeof details === 'object' &&
          'expectedVersion' in details &&
          'actualVersion' in details
        if (versionConflict && attempt === 0) continue
        if (versionConflict)
          throw Object.assign(new Error('队列仍在变化，已刷新最新状态，请重试。'), {
            code: 'QUEUE_VERSION_CONFLICT',
          })
        throw error
      }
    }
  }

  async function interrupt(sessionId: string): Promise<void> {
    const pending = pendingInterrupts.get(sessionId)
    if (pending) return pending
    const operation = (async () => {
      const current = await loadThreadSnapshot(sessionId)
      const activeTurn = findActiveTurn(current)
      if (!activeTurn) return
      await rpc.call('turn/interrupt', {
        threadId: sessionId,
        turnId: activeTurn.id,
        operationId: crypto.randomUUID(),
      })
    })()
    pendingInterrupts.set(sessionId, operation)
    const clear = () => {
      if (pendingInterrupts.get(sessionId) === operation) pendingInterrupts.delete(sessionId)
    }
    void operation.then(clear, clear)
    return operation
  }

  async function startTurn(
    sessionId: string,
    inputId: string,
    content: string,
    attachmentIds: string[],
    contextReferenceIds: string[],
    model: string | DesktopModelSelection | undefined,
    goal?: TurnGoal,
    skills?: DesktopUserMessageInput['skills'],
    taskMode?: 'chat' | 'plan' | 'grill',
    frozen?: {
      model: ModelRef
      permissionConfig: PermissionConfig
      taskMode: 'chat' | 'plan' | 'grill'
    },
  ): Promise<void> {
    await rpc.call('turn/start', {
      threadId: sessionId,
      inputId,
      content,
      model: frozen?.model ?? (await resolveModelRef(model, sessionId)),
      ...(skills?.length ? { skills: [...skills] } : {}),
      permissionConfig: frozen?.permissionConfig ?? permissionConfigForSession(sessionId),
      taskMode: frozen?.taskMode ?? taskMode ?? taskModeForSession(sessionId),
      ...(goal ? { goal } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(contextReferenceIds.length ? { contextReferenceIds } : {}),
    })
  }

  return {
    callQueueMutation,
    interrupt,
    submitMessage,
  }
}

function findActiveTurn(snapshot: ThreadSnapshot) {
  return [...snapshot.turns]
    .reverse()
    .find((turn) => turn.status === 'running' || turn.status.startsWith('waiting-'))
}
