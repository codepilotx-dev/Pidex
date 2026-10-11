import type { EventPayload, ServerRequestResponse } from '@pidex/agent-protocol'

export const interactionResolvedPayload = (
  result: ServerRequestResponse,
  resolvedAt: number,
  interactionId?: string,
): EventPayload<'interaction/resolved'> => ({
  ...(interactionId ? { interactionId } : {}),
  result,
  resolvedAt,
})

export const approvalCancelledPayload = (
  interactionId: string,
  reason: string,
  cancelledAt: number,
): EventPayload<'approval/cancelled'> => ({ interactionId, reason, cancelledAt })
