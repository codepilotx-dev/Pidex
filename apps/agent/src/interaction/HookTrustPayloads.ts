type HookTrustPayloadSource = {
  id: string
  configPath: string
  configHash: string
  auditSummary: Record<string, unknown>
  createdAt: number
}

const firstHook = (request: HookTrustPayloadSource) => {
  const hooks = Array.isArray(request.auditSummary.hooks) ? request.auditSummary.hooks : []
  return hooks.find(
    (candidate): candidate is Record<string, unknown> =>
      Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate),
  )
}

export const hookTrustRequestedPayload = (
  request: HookTrustPayloadSource,
  waiter: { threadID: string; turnID: string; agentID: string },
) => {
  const hook = firstHook(request)
  const hookID = typeof hook?.id === 'string' && hook.id ? hook.id : 'project-hooks'
  return {
    interactionId: request.id,
    threadId: waiter.threadID,
    turnId: waiter.turnID,
    agentId: waiter.agentID,
    createdAt: request.createdAt,
    version: 1,
    kind: 'hookTrust' as const,
    configPath: request.configPath,
    sha256: request.configHash,
    hook: {
      id: hookID,
      name: hookID === 'project-hooks' ? '项目 Hook' : hookID,
      event: typeof hook?.event === 'string' && hook.event ? hook.event : 'unknown',
      command:
        typeof hook?.command === 'string' && hook.command ? hook.command : '(multiple hooks)',
    },
  }
}

export const hookTrustResolvedPayload = (
  request: Pick<HookTrustPayloadSource, 'id' | 'configPath' | 'configHash'>,
  decision: 'allow' | 'block',
  resumed: boolean,
  resolvedAt: number,
) => ({
  interactionId: request.id,
  configPath: request.configPath,
  configSha256: request.configHash,
  decision,
  resumed,
  resolvedAt,
})
