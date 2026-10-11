import type { ComputerAction, ComputerResult } from '@pidex/agent-protocol'

/**
 * Wire contract between the host and the isolated JavaScript child process.
 * One JSON object per line; the child only ever speaks this protocol on stdout.
 */
export const DEFAULT_NODE_REPL_TIMEOUT_MS = 60_000
export const MIN_NODE_REPL_TIMEOUT_MS = 1_000
export const MAX_NODE_REPL_TIMEOUT_MS = 120_000

export type NodeReplMethod = 'apps' | 'read' | 'action'

export type NodeReplOperationRequest =
  | { method: 'apps'; args: Record<string, never> }
  | { method: 'read'; args: { windowRef: string } }
  | {
      method: 'action'
      args: { windowRef: string; observationId: string; operation: ComputerAction }
    }

export type NodeReplImage = { data: string; mimeType: string }

export type NodeReplHostMessage =
  | { type: 'init'; code: string; timeoutMs: number }
  | { type: 'result'; id: number; ok: true; result: ComputerResult }
  | { type: 'result'; id: number; ok: false; error: { code: string; message: string } }

export type NodeReplChildMessage =
  | { type: 'call'; id: number; method: NodeReplMethod; args: Record<string, unknown> }
  | { type: 'write'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export const clampNodeReplTimeout = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_NODE_REPL_TIMEOUT_MS
  return Math.min(MAX_NODE_REPL_TIMEOUT_MS, Math.max(MIN_NODE_REPL_TIMEOUT_MS, Math.trunc(value)))
}

/**
 * Recoverable internal operation recorded in an approval checkpoint. Only the
 * operation identity is stored: scope, identity and window reference are
 * re-validated on resume, and no script or VM state is ever persisted.
 */
export type ComputerOperationRecovery = {
  method: NodeReplMethod
  args: Record<string, unknown>
}

/** Reads the recorded internal operation out of a stored interruption payload. */
export const computerOperationRecoveryFrom = (
  interruption: unknown,
): ComputerOperationRecovery | undefined => {
  if (!interruption || typeof interruption !== 'object') return undefined
  const value = (interruption as { computerOperation?: unknown }).computerOperation
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { method, args } = value as { method?: unknown; args?: unknown }
  if (method !== 'apps' && method !== 'read' && method !== 'action') return undefined
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  return { method, args: args as Record<string, unknown> }
}
