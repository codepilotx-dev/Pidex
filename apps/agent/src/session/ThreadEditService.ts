import { createHash } from 'node:crypto'
import type { RpcParams } from '@pidex/agent-protocol'
import { AgentError, type SubmitMessage } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import { ThreadEditRepository } from '../storage/repositories/ThreadEditRepository'

export class ThreadEditService {
  readonly repository: ThreadEditRepository
  constructor(private readonly db: AgentDatabase) {
    this.repository = new ThreadEditRepository(db)
  }

  prepare(request: RpcParams<'thread/editUserMessage'>) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          request.threadId,
          request.turnId,
          request.inputId,
          request.content,
          request.attachmentIds,
          request.contextReferenceIds,
        ]),
      )
      .digest('hex')
    const previous = this.repository.lookup(request.operationId)
    if (previous) {
      if (previous.thread_id !== request.threadId || previous.request_hash !== hash)
        throw new AgentError('OPERATION_ID_CONFLICT', '编辑操作标识已用于其他请求', 409)
      return { kind: 'duplicate' as const, duplicate: previous }
    }
    this.repository.assertIdle(request.threadId)
    const boundary = this.repository.prepare(request.threadId, request.turnId, request.inputId)
    const input = this.db.getTurnInput(request.turnId)
    if (!input) throw new AgentError('TURN_NOT_FOUND', '原消息不存在', 404)
    this.repository.validateReferences(
      request.threadId,
      request.inputId,
      request.attachmentIds,
      request.contextReferenceIds,
    )
    const { id: _id, ...original } = input
    const next: SubmitMessage = {
      ...original,
      content: request.content,
      permissionConfig: this.db.getThreadSettings(request.threadId)!.permissionConfig,
      strategy: 'start',
    }
    return { kind: 'edit' as const, hash, boundary, input: next }
  }
}
