import type { ModelRef } from '@pidex/shared'
import type { PermissionConfig, ThreadSnapshot } from '@pidex/shared/thread'
import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import { desktopUserMessageInputToPreviewText } from '../../../shared/DesktopUserMessage.js'
import type {
  DesktopModelSelection,
  DesktopSessionSnapshot,
  DesktopUserMessageInput,
} from '../../../shared/Types.js'
import { createAgentRpcClient } from '../AgentRpcClient.js'

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
  taskModeForSession: (sessionId: string) => 'chat' | 'plan'
  queueVersionForSession: (sessionId: string) => number | undefined
  loadThreadSnapshot: (sessionId: string) => Promise<ThreadSnapshot>
  refreshSession: (sessionId: string) => Promise<DesktopSessionSnapshot>
  emitSessionStoreChange: () => void
  requireSkillInvocationCapability?: () => void
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
}: AgentTurnQueueClientDependencies) {
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
    if (options?.goal) {
      const snapshot = await loadThreadSnapshot(sessionId)
      if (
        delivery !== 'start' ||
        snapshot.turns.some(
          (turn) =>
            turn.status === 'queued' ||
            turn.status === 'running' ||
            turn.status.startsWith('waiting-'),
        )
      )
        throw new Error('当前任务正在执行，请等待本轮结束后提交目标')
      if ((input.taskMode ?? taskModeForSession(sessionId)) === 'plan')
        throw new Error('请先退出计划模式再提交目标')
    }
    if (input.skills?.length) requireSkillInvocationCapability?.()
    const { attachmentIds, contextReferenceIds } = await importMessageContext(sessionId, input)
    const content = desktopUserMessageInputToPreviewText({ ...input, skills: undefined })
    const inputId = options?.inputId ?? crypto.randomUUID()

    if (delivery === 'steer') {
      const current = await loadThreadSnapshot(sessionId)
      const activeTurn = findActiveTurn(current)
      if (activeTurn) {
        if (input.taskMode === 'plan' && activeTurn.mode !== 'plan')
          throw new Error('当前轮次仍在实施，请等待结束或选择排队发送计划任务')
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
      )
      await refreshSession(sessionId).catch(() => null)
      emitSessionStoreChange()
      return { inputId, outcome: 'sent' }
    }

    if (delivery === 'follow-up') {
      const expectedVersion = queueVersionForSession(sessionId)
      const admission = await rpc.call('queue/add', {
        threadId: sessionId,
        inputId,
        content,
        model: await resolveModelRef(options?.model, sessionId),
        ...(input.skills?.length ? { skills: [...input.skills] } : {}),
        permissionConfig: permissionConfigForSession(sessionId),
        taskMode: input.taskMode ?? taskModeForSession(sessionId),
        operationId: crypto.randomUUID(),
        ...(typeof expectedVersion === 'number' ? { expectedVersion } : {}),
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
    )
    await refreshSession(sessionId).catch(() => null)
    emitSessionStoreChange()
    return { inputId, outcome: 'sent' }
  }

  async function callQueueMutation(
    sessionId: string,
    method: 'queue/update' | 'queue/remove' | 'queue/resume',
    params: Record<string, unknown>,
  ): Promise<QueueStateResult> {
    const expectedVersion = queueVersionForSession(sessionId)
    try {
      return await rpc.call<QueueStateResult>(method, {
        threadId: sessionId,
        ...params,
        operationId: crypto.randomUUID(),
        ...(typeof expectedVersion === 'number' ? { expectedVersion } : {}),
      })
    } catch (error) {
      await refreshSession(sessionId).catch(() => null)
      emitSessionStoreChange()
      throw error
    }
  }

  async function interrupt(sessionId: string): Promise<void> {
    const current = await loadThreadSnapshot(sessionId)
    const activeTurn = findActiveTurn(current)
    if (!activeTurn) return
    await rpc.call('turn/interrupt', {
      threadId: sessionId,
      turnId: activeTurn.id,
      operationId: crypto.randomUUID(),
    })
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
    taskMode?: 'chat' | 'plan',
  ): Promise<void> {
    await rpc.call('turn/start', {
      threadId: sessionId,
      inputId,
      content,
      model: await resolveModelRef(model, sessionId),
      ...(skills?.length ? { skills: [...skills] } : {}),
      permissionConfig: permissionConfigForSession(sessionId),
      taskMode: taskMode ?? taskModeForSession(sessionId),
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
