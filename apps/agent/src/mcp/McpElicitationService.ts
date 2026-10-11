import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { Effect } from 'effect'
import type { RpcResult } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import type { InteractionOperationInput } from '../storage/repositories/InteractionRepository'
import { secretScrubber } from '../security/SecretScrubber'

export type McpInvocationIdentity = {
  threadID: string
  turnID: string
  agentID: string
  toolCallID: string
}
type Response = Extract<RpcResult<'interaction/respond'>['response'], { kind: 'mcp-elicitation' }>

/** Durable interaction ownership; only the live connection owns the external reply callback. */
export class McpElicitationService {
  private readonly pending = new Map<
    string,
    { resolve: (response: Response) => void; schema: Record<string, unknown> }
  >()
  private readonly ajv = new Ajv({ strict: false, allErrors: true })
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
  ) {
    addFormats(this.ajv)
  }

  async restore(): Promise<void> {
    for (const request of this.db.repositories.interactions.pendingMcpElicitations()) {
      const event = this.db.repositories.interactions.resolveMcpElicitation(
        String(request.interactionId),
        Number(request.version),
        { kind: 'mcp-elicitation', action: 'cancel' },
      )
      await Promise.allSettled([Effect.runPromise(this.hub.publish(event))])
    }
  }

  async request(
    connectionID: string,
    server: string,
    tool: string,
    identity: McpInvocationIdentity,
    raw: unknown,
    signal: AbortSignal,
  ): Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: Response['content'] }> {
    if (signal.aborted || !raw || typeof raw !== 'object' || Array.isArray(raw))
      return { action: 'cancel' }
    const request = secretScrubber.scrub(raw) as Record<string, unknown>
    if (
      (request.mode !== undefined && request.mode !== 'form') ||
      !request.requestedSchema ||
      typeof request.requestedSchema !== 'object'
    )
      return { action: 'cancel' }
    const schema = request.requestedSchema as Record<string, unknown>
    try {
      this.ajv.compile(schema)
    } catch {
      return { action: 'cancel' }
    }
    const id = crypto.randomUUID()
    const payload = {
      interactionId: id,
      threadId: identity.threadID,
      turnId: identity.turnID,
      agentId: identity.agentID,
      toolCallId: identity.toolCallID,
      createdAt: Date.now(),
      version: 1,
      kind: 'mcp-elicitation',
      server,
      tool,
      request,
    }
    let complete!: (response: Response) => void
    const reply = new Promise<Response>((resolve) => {
      complete = resolve
    })
    const event = this.db.repositories.interactions.createMcpElicitation(payload, connectionID)
    this.pending.set(id, { resolve: complete, schema })
    const abort = () => {
      void this.respond(id, 1, { kind: 'mcp-elicitation', action: 'cancel' }).catch(() => {})
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try {
      await Promise.allSettled([Effect.runPromise(this.hub.publish(event))])
      const response = await reply
      return {
        action: response.action,
        ...(response.action === 'accept' ? { content: response.content } : {}),
      }
    } finally {
      signal.removeEventListener('abort', abort)
      this.pending.delete(id)
    }
  }

  async respond(
    id: string,
    version: number,
    response: Response,
    operation?: InteractionOperationInput,
  ): Promise<void> {
    const pending = this.pending.get(id)
    if (!pending) throw new AgentError('REQUEST_NOT_PENDING', 'MCP 连接已经失效', 409)
    if (response.action === 'accept') {
      if (!response.content || !this.ajv.validate(pending.schema, response.content))
        throw new AgentError('INVALID_REQUEST', 'MCP 表单回答不符合 schema', 400)
      secretScrubber.assertSafeOpaqueState(JSON.stringify(response.content))
    } else if (response.content !== undefined)
      throw new AgentError('INVALID_REQUEST', '取消或拒绝不能包含表单回答', 400)
    const event = this.db.repositories.interactions.resolveMcpElicitation(
      id,
      version,
      response as Record<string, unknown>,
      operation,
    )
    pending.resolve(response)
    await Promise.allSettled([Effect.runPromise(this.hub.publish(event))])
  }
}
