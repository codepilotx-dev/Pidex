import type { RpcResult } from '@pidex/agent-protocol'

import type {
  ConversationForkClient,
  ConversationForkDestination,
  ConversationForkPoint,
} from './ForkClient.js'

export type ConversationForkOperation = RpcResult<'thread/fork/start'>['operation']
export type ConversationForkOutput = RpcResult<'thread/fork/status'>['output']

export type ConversationForkProgress = {
  operation: ConversationForkOperation
  output: string
  outputTruncated: boolean
}

export type ConversationForkResult =
  | { kind: 'completed'; operation: ConversationForkOperation }
  | { kind: 'awaiting-setup-decision'; operation: ConversationForkOperation }
  | { kind: 'failed'; operation: ConversationForkOperation }
  | { kind: 'abandoned'; operation: ConversationForkOperation }

export type RunConversationForkInput = {
  client: ConversationForkClient
  point: ConversationForkPoint
  destination: ConversationForkDestination
  onProgress?: (progress: ConversationForkProgress) => void
}

export async function runConversationFork(
  input: RunConversationForkInput,
): Promise<ConversationForkResult> {
  const started = await input.client.startThreadFork({
    operationId: crypto.randomUUID(),
    sourceThreadId: input.point.sourceThreadId,
    lastTurnId: input.point.lastTurnId,
    sourceItemId: input.point.sourceItemId,
    destination: input.destination,
  })
  return observeConversationFork(input.client, started.operation, input.onProgress)
}

export async function resumeConversationFork(
  client: ConversationForkClient,
  point: ConversationForkPoint,
  onProgress?: (progress: ConversationForkProgress) => void,
): Promise<ConversationForkResult | null> {
  const pending = await client.pendingThreadFork(
    point.sourceThreadId,
    point.lastTurnId,
    point.sourceItemId,
  )
  if (!pending.operation) return null
  return observeConversationFork(client, pending.operation, onProgress)
}

export async function retryConversationForkSetup(
  client: ConversationForkClient,
  operation: ConversationForkOperation,
  onProgress?: (progress: ConversationForkProgress) => void,
): Promise<ConversationForkResult> {
  const updated = await client.retryThreadForkSetup(operation.operationId, operation.revision)
  return observeConversationFork(client, updated.operation, onProgress)
}

export async function continueConversationForkWithoutSetup(
  client: ConversationForkClient,
  operation: ConversationForkOperation,
  onProgress?: (progress: ConversationForkProgress) => void,
): Promise<ConversationForkResult> {
  const updated = await client.continueThreadForkWithoutSetup(
    operation.operationId,
    operation.revision,
  )
  return observeConversationFork(client, updated.operation, onProgress)
}

export async function abandonConversationFork(
  client: ConversationForkClient,
  operation: ConversationForkOperation,
  onProgress?: (progress: ConversationForkProgress) => void,
): Promise<ConversationForkResult> {
  const updated = await client.abandonThreadFork(operation.operationId, operation.revision)
  return observeConversationFork(client, updated.operation, onProgress)
}

async function observeConversationFork(
  client: ConversationForkClient,
  initialOperation: ConversationForkOperation,
  onProgress?: (progress: ConversationForkProgress) => void,
): Promise<ConversationForkResult> {
  let operation = initialOperation
  let output = ''
  let outputCursor: number | undefined
  let outputTruncated = false
  onProgress?.({ operation, output, outputTruncated })

  let firstStatusRead = true
  while (firstStatusRead || operation.status === 'running') {
    const result = await client.threadForkStatus(
      operation.operationId,
      firstStatusRead ? undefined : operation.revision,
      outputCursor,
    )
    firstStatusRead = false
    operation = result.operation
    outputCursor = result.output.cursor
    output = result.output.truncated
      ? result.output.data
      : appendBoundedOutput(output, result.output.data)
    outputTruncated = outputTruncated || result.output.truncated
    onProgress?.({ operation, output, outputTruncated })
  }

  if (operation.status === 'completed') return { kind: 'completed', operation }
  if (operation.status === 'awaiting-setup-decision') {
    return { kind: 'awaiting-setup-decision', operation }
  }
  if (operation.status === 'abandoned') return { kind: 'abandoned', operation }
  return { kind: 'failed', operation }
}

function appendBoundedOutput(current: string, data: string): string {
  if (!data) return current
  const combined = `${current}${data}`
  const encoded = new TextEncoder().encode(combined)
  if (encoded.byteLength <= 65_536) return combined
  return new TextDecoder()
    .decode(encoded.slice(encoded.byteLength - 65_536))
    .replace(/^\uFFFD/u, '')
}
