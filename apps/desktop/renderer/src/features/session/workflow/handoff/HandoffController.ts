import type { RpcResult } from '@pidex/agent-protocol'
import type { EnvironmentDomainClient } from '../../../../services/desktop-client/EnvironmentDomainClient.js'
import type { DesktopTerminalClient } from '../../../../services/desktop-client/TerminalClient.js'
import { transferConversationUiStateForHandoff } from '../../../layout/tabs/ConversationUiState.js'

export const HANDOFF_PROGRESS_STEPS = [
  'preflight',
  'stop-source',
  'prepare-destination',
  'capture-source',
  'release-branch',
  'checkout-destination',
  'apply-source-changes',
  'fork-conversation',
  'transfer-core-state',
  'await-client-transfer',
  'archive-source',
  'complete',
] as const

export type HandoffOperation = RpcResult<'thread/handoff/start'>['operation']

export type RunHandoffInput = {
  sourceThreadId: string
  sourceWorkspacePath: string
  destination: { kind: 'local' } | { kind: 'worktree'; worktreeId: string }
  client: EnvironmentDomainClient
  terminal: Pick<DesktopTerminalClient, 'closeTerminalForThread'>
  transferUiState?: typeof transferConversationUiStateForHandoff
  onProgress?: (operation: HandoffOperation) => void
}

export type HandoffResult = {
  targetThreadId: string
  warning: 'LOCAL_STORAGE_UNAVAILABLE' | null
  warnings: readonly string[]
}

export async function runHandoff(input: RunHandoffInput): Promise<HandoffResult> {
  const operationId = crypto.randomUUID()
  const startPromise = input.client.startHandoff({
    operationId,
    sourceThreadId: input.sourceThreadId,
    destination: input.destination,
  })
  return continueHandoff(input, operationId, startPromise)
}

export async function resumePendingHandoff(input: RunHandoffInput): Promise<HandoffResult | null> {
  const pending = await input.client.pendingHandoff(input.sourceThreadId)
  if (!pending.operation) return null
  return continueHandoff(input, pending.operation.operationId, undefined, pending.operation)
}

async function continueHandoff(
  input: RunHandoffInput,
  operationId: string,
  startPromise?: ReturnType<EnvironmentDomainClient['startHandoff']>,
  initialOperation: HandoffOperation | null = null,
): Promise<HandoffResult> {
  const startOutcome = startPromise?.then(
    (value) => ({ kind: 'start' as const, value }),
    (error) => ({ kind: 'start-error' as const, error }),
  )
  let startPending = Boolean(startOutcome)
  let operation: HandoffOperation | null = initialOperation
  let terminalClosed = false
  const observe = async (next: HandoffOperation): Promise<void> => {
    operation = next
    input.onProgress?.(next)
    if (
      !terminalClosed &&
      next.status !== 'failed' &&
      next.status !== 'rollback-failed' &&
      HANDOFF_PROGRESS_STEPS.indexOf(next.step) >= HANDOFF_PROGRESS_STEPS.indexOf('stop-source')
    ) {
      await input.terminal.closeTerminalForThread({
        threadId: input.sourceThreadId,
        reason: 'task-close',
      })
      terminalClosed = true
    }
  }
  if (operation) await observe(operation)
  while (!operation || operation.status === 'running') {
    const statusOutcome = input.client.handoffStatus(operationId, operation?.revision).then(
      (value) => ({ kind: 'status' as const, value }),
      (error) => ({ kind: 'status-error' as const, error }),
    )
    const outcome =
      startPending && startOutcome
        ? await Promise.race([startOutcome, statusOutcome])
        : await statusOutcome
    if (outcome.kind === 'start-error') throw outcome.error
    if (outcome.kind === 'start') {
      startPending = false
      await observe(outcome.value.operation)
    } else if (outcome.kind === 'status') await observe(outcome.value.operation)
    else if (!operation) {
      const startup =
        startPending && startOutcome
          ? await Promise.race([startOutcome, delay(75).then(() => ({ kind: 'retry' as const }))])
          : { kind: 'retry' as const }
      if (startup.kind === 'start-error') throw startup.error
      if (startup.kind === 'start') {
        startPending = false
        await observe(startup.value.operation)
      }
      continue
    } else throw outcome.error
  }
  if (startPending && startOutcome) {
    const settled = await startOutcome
    if (settled.kind === 'start-error') throw settled.error
    await observe(settled.value.operation)
  }
  if (operation.status !== 'await-client-transfer' || !operation.targetThreadId) {
    throw new Error(operation.errorCode ?? 'Handoff 未能完成')
  }
  const transfer = (input.transferUiState ?? transferConversationUiStateForHandoff)({
    sourceThreadId: input.sourceThreadId,
    targetThreadId: operation.targetThreadId,
    sourceWorkspacePath: input.sourceWorkspacePath,
  })
  const acknowledged = await input.client.ackHandoff(operationId, operation.revision)
  input.onProgress?.(acknowledged.operation)
  return {
    targetThreadId: operation.targetThreadId,
    warning: transfer.warning ?? null,
    warnings: acknowledged.operation.warnings,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function completedHandoffStepCount(operation: HandoffOperation | null): number {
  if (!operation) return 0
  const index = HANDOFF_PROGRESS_STEPS.indexOf(operation.step)
  return operation.status === 'completed' ? HANDOFF_PROGRESS_STEPS.length : Math.max(0, index)
}
