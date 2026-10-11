import { isAbsolute, normalize } from 'node:path'
import type { AgentHarnessEvent } from '../orchestration/harness/Types'
import type { EventEnvelope } from '../Domain'
import type { EventHubSignal } from '../storage/events/EventHub'
import type { AgentLogger, LogContext, LogLevel } from './AgentLogger'
import { providerFailureCategory, providerFailureMessage } from '../provider/ModelHealthService'

type JsonObject = Record<string, unknown>

const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const nonNegativeInteger = (value: unknown) => {
  const parsed = number(value)
  return parsed === undefined || parsed < 0 ? undefined : Math.trunc(parsed)
}

const contextFor = (event: EventEnvelope, params: JsonObject): LogContext => ({
  ...(event.threadId ? { threadId: event.threadId } : {}),
  ...(event.turnId ? { turnId: event.turnId } : {}),
  ...((text(params.agentId) ?? text(params.rootAgentId))
    ? { agentId: (text(params.agentId) ?? text(params.rootAgentId))! }
    : {}),
})

const modelDetails = (value: unknown) => {
  const model = object(value)
  const provider = text(model.providerID) ?? text(model.providerId) ?? text(model.provider)
  const id = text(model.id) ?? text(model.model)
  return {
    ...(provider ? { provider } : {}),
    ...(id ? { model: id } : {}),
  }
}

const safeRelativePath = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return undefined
  if (isAbsolute(value) || /^(?:[a-z]:|[\\/]{2}|[\\/])/i.test(value)) return '[outside-workspace]'
  const normalized = normalize(value).replaceAll('\\', '/')
  if (normalized === '..' || normalized.startsWith('../')) return '[outside-workspace]'
  return normalized.slice(0, 500)
}

const byteLength = (value: unknown) =>
  typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : undefined

const cwdScope = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return 'default'
  if (isAbsolute(value) || /^(?:[a-z]:|[\\/]{2}|[\\/])/i.test(value)) return 'absolute'
  const normalized = normalize(value).replaceAll('\\', '/')
  return normalized === '..' || normalized.startsWith('../')
    ? 'outside-workspace'
    : 'workspace-relative'
}

const affectedPaths = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).flatMap((entry) => {
    const record = object(entry)
    const path = safeRelativePath(record.path)
    if (!path) return []
    const operation = text(record.operation)
    return [
      {
        path,
        ...(operation === 'create' || operation === 'update' ? { operation } : {}),
      },
    ]
  })
}

const toolDetails = (
  tool: string,
  input: JsonObject,
  data: JsonObject,
): Record<string, unknown> => {
  const leaf = tool.toLowerCase().split('.').at(-1) ?? tool.toLowerCase()
  if (/^(?:bash|powershell|pwsh|shell|command|exec)$/.test(leaf)) {
    const command = text(input.command) ?? text(data.command)
    const timeoutMs = nonNegativeInteger(input.timeoutMs ?? input.timeout)
    return {
      ...(command === undefined ? {} : { commandBytes: Buffer.byteLength(command, 'utf8') }),
      cwdScope: cwdScope(input.cwd ?? data.cwd),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }
  }

  if (leaf === 'write') {
    const path = safeRelativePath(input.file_path ?? input.path)
    const contentBytes = byteLength(input.content)
    return {
      ...(path ? { path, fileCount: 1 } : {}),
      ...(contentBytes === undefined ? {} : { contentBytes }),
    }
  }

  if (leaf === 'edit') {
    const path = safeRelativePath(input.file_path ?? input.path)
    const edits = Array.isArray(input.edits) ? input.edits.map(object) : []
    const oldTextBytes = edits.reduce((total, edit) => total + (byteLength(edit.oldText) ?? 0), 0)
    const newTextBytes = edits.reduce((total, edit) => total + (byteLength(edit.newText) ?? 0), 0)
    return {
      ...(path ? { path, fileCount: 1 } : {}),
      editCount: edits.length,
      oldTextBytes,
      newTextBytes,
    }
  }

  if (leaf === 'apply_patch') {
    const files = affectedPaths(input.affectedPaths)
    const summary = object(input.summary)
    const metric = (key: string) => nonNegativeInteger(input[key] ?? summary[key])
    const fileCount = metric('fileCount') ?? files.length
    const patchBytes = nonNegativeInteger(input.patchBytes)
    const hunkCount = metric('hunkCount')
    const additions = metric('additions')
    const deletions = metric('deletions')
    const createCount =
      metric('createCount') ?? files.filter((file) => file.operation === 'create').length
    const updateCount =
      metric('updateCount') ?? files.filter((file) => file.operation === 'update').length
    return {
      ...(files.length ? { affectedPaths: files } : {}),
      fileCount,
      createCount,
      updateCount,
      ...(patchBytes === undefined ? {} : { patchBytes }),
      ...(hunkCount === undefined ? {} : { hunkCount }),
      ...(additions === undefined ? {} : { additions }),
      ...(deletions === undefined ? {} : { deletions }),
    }
  }

  const path = safeRelativePath(input.file_path ?? input.path)
  return path ? { path } : {}
}

const toolRecord = (
  event: EventEnvelope,
  params: JsonObject,
): {
  context: LogContext
  details: Record<string, unknown>
} => {
  const item = object(params.item)
  const data = object(item.data)
  const input = object(data.input)
  const tool = text(data.tool) ?? text(item.tool) ?? 'tool'
  const durationMs = number(data.durationMs)
  const context: LogContext = {
    ...contextFor(event, params),
    ...((text(item.turnID) ?? text(item.turnId))
      ? { turnId: (text(item.turnID) ?? text(item.turnId))! }
      : {}),
    ...((text(item.agentID) ?? text(item.agentId))
      ? { agentId: (text(item.agentID) ?? text(item.agentId))! }
      : {}),
    ...((text(data.callID) ?? text(data.callId) ?? text(item.id))
      ? { toolCallId: (text(data.callID) ?? text(data.callId) ?? text(item.id))! }
      : {}),
  }
  return {
    context,
    details: {
      tool,
      ...(text(item.status) ? { status: text(item.status) } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...toolDetails(tool, input, data),
    },
  }
}

const turnRecord = (
  event: EventEnvelope,
  params: JsonObject,
): {
  context: LogContext
  details: Record<string, unknown>
} => {
  const turn = object(params.turn)
  const input = object(params.input)
  const turnId = text(turn.id) ?? text(params.turnId) ?? event.turnId ?? undefined
  const agentId = text(turn.rootAgentId) ?? text(params.rootAgentId)
  const startedAt = number(turn.startedAt) ?? number(params.startedAt)
  const finishedAt = number(turn.finishedAt) ?? number(params.finishedAt)
  return {
    context: {
      ...(event.threadId ? { threadId: event.threadId } : {}),
      ...(turnId ? { turnId } : {}),
      ...(agentId ? { agentId } : {}),
    },
    details: {
      ...((text(turn.status) ?? text(params.status))
        ? { status: (text(turn.status) ?? text(params.status))! }
        : {}),
      ...((text(turn.mode) ?? text(input.taskMode))
        ? { mode: text(turn.mode) ?? text(input.taskMode) }
        : {}),
      ...modelDetails(turn.model ?? input.model),
      ...(startedAt !== undefined && finishedAt !== undefined
        ? { durationMs: Math.max(0, finishedAt - startedAt) }
        : {}),
    },
  }
}

export class ExecutionLogObserver {
  private readonly turnStarts = new Map<string, number>()
  constructor(private readonly logger: AgentLogger) {}

  observeSignal(signal: EventHubSignal): void {
    this.observeEvent(signal.event)
  }

  observeEvent(event: EventEnvelope): void {
    const params = object(event.params)
    if (event.method === 'turn/queued')
      return this.log('info', 'turn.queued', turnRecord(event, params))
    if (event.method === 'turn/started') {
      const record = turnRecord(event, params)
      if (record.context.turnId)
        this.turnStarts.set(
          record.context.turnId,
          number(object(params.turn).startedAt) ?? number(params.startedAt) ?? event.createdAt,
        )
      return this.log('info', 'turn.started', record)
    }
    if (event.method === 'turn/completed')
      return this.log('info', 'turn.completed', this.finishTurn(event, params))
    if (event.method === 'turn/failed') {
      const record = this.finishTurn(event, params)
      const error = object(params.error)
      record.details = {
        ...record.details,
        ...(text(error.code) ? { code: text(error.code) } : {}),
        ...(text(error.message) ? { message: text(error.message) } : {}),
      }
      return this.log('error', 'turn.failed', record)
    }
    if (event.method === 'turn/interrupted') {
      const record = this.finishTurn(event, params)
      record.details = { ...record.details, reason: text(params.reason) ?? 'interrupted' }
      return this.log('warn', 'turn.interrupted', record)
    }
    if (event.method === 'turn/statusChanged') {
      return this.log('info', 'turn.status-changed', {
        context: contextFor(event, params),
        details: {
          status: text(params.status) ?? text(params.state) ?? 'unknown',
          ...(text(params.reason) ? { reason: text(params.reason) } : {}),
        },
      })
    }
    if (event.method === 'tool/callStarted')
      return this.log('info', 'tool.started', toolRecord(event, params))
    if (event.method === 'tool/callCompleted')
      return this.log('info', 'tool.completed', toolRecord(event, params))
    if (event.method === 'tool/error') {
      const record = toolRecord(event, params)
      const error = object(params.error)
      record.details = {
        ...record.details,
        status: 'error',
        ...(text(error.code) ? { code: text(error.code) } : {}),
      }
      return this.log('error', 'tool.failed', record)
    }
    if (
      event.method === 'approval/requested' ||
      event.method === 'approval/cancelled' ||
      event.method === 'permission/requested'
    ) {
      return this.log(
        event.method.endsWith('cancelled') ? 'warn' : 'info',
        event.method.replace('/', '.'),
        {
          context: {
            ...contextFor(event, params),
            ...(text(params.toolCallId) ? { toolCallId: text(params.toolCallId)! } : {}),
            ...(text(params.interactionId) ? { interactionId: text(params.interactionId)! } : {}),
          },
          details: {
            status: event.method.endsWith('cancelled') ? 'cancelled' : 'requested',
            ...(text(params.tool) ? { tool: text(params.tool) } : {}),
            ...(text(params.risk) ? { risk: text(params.risk) } : {}),
            ...(event.method.endsWith('cancelled') && text(params.reason)
              ? { reason: text(params.reason) }
              : {}),
          },
        },
      )
    }
    if (event.method === 'question/requested' || event.method === 'interaction/resolved') {
      const result = object(params.result)
      return this.log('info', event.method.replace('/', '.'), {
        context: {
          ...contextFor(event, params),
          ...(text(params.toolCallId) ? { toolCallId: text(params.toolCallId)! } : {}),
          ...(text(params.interactionId) ? { interactionId: text(params.interactionId)! } : {}),
        },
        details: {
          status:
            text(result.status) ?? (event.method.endsWith('resolved') ? 'resolved' : 'requested'),
          ...(text(result.kind) ? { kind: text(result.kind) } : {}),
          ...(text(result.decision) ? { decision: text(result.decision) } : {}),
          ...(text(result.resolution) ? { resolution: text(result.resolution) } : {}),
        },
      })
    }
    if (event.method === 'queue/updated') {
      return this.log('info', 'queue.updated', {
        context: contextFor(event, params),
        details: {
          ...(text(params.action) ? { status: text(params.action) } : {}),
          ...(text(params.pauseReason) ? { reason: text(params.pauseReason) } : {}),
        },
      })
    }
    if (event.method === 'subagent/created' || event.method === 'subagent/updated') {
      const task = object(params.task)
      const run = object(params.run)
      return this.log('info', event.method.replace('/', '.'), {
        context: {
          ...contextFor(event, params),
          ...(text(task.id) ? { agentId: text(task.id)! } : {}),
        },
        details: {
          status:
            text(run.status) ??
            text(task.status) ??
            (event.method.endsWith('created') ? 'created' : 'updated'),
          ...modelDetails(run.model),
        },
      })
    }
  }

  private finishTurn(event: EventEnvelope, params: JsonObject) {
    const record = turnRecord(event, params)
    const turnId = record.context.turnId
    const startedAt = turnId ? this.turnStarts.get(turnId) : undefined
    if (startedAt !== undefined && record.details.durationMs === undefined) {
      record.details.durationMs = Math.max(
        0,
        (number(params.finishedAt) ?? event.createdAt) - startedAt,
      )
    }
    if (turnId) this.turnStarts.delete(turnId)
    return record
  }

  private log(level: LogLevel, event: string, fields: Record<string, unknown>) {
    this.logger[level](event, fields)
  }
}

type ProviderState = {
  startedAt: number
  responseCount: number
  firstResponseMs?: number
  requestIndex: number
  provider: string
  model: string
}

export class HarnessLogObserver {
  private readonly providers = new Map<string, ProviderState>()
  private readonly steps = new Map<string, number>()

  constructor(
    private readonly logger: AgentLogger,
    private readonly now: () => number = Date.now,
  ) {}

  finishTurn(turnId: string): void {
    for (const key of this.steps.keys()) {
      if (key.startsWith(`${turnId}:`)) {
        this.steps.delete(key)
        this.providers.delete(key)
      }
    }
  }

  observe(context: LogContext, event: AgentHarnessEvent): void {
    const key = `${context.turnId ?? ''}:${context.agentId ?? ''}`
    if (event.type === 'before_agent_start') {
      this.logger.info('agent.preparing', {
        context,
        details: {
          skillCount: event.resources.skills?.length ?? 0,
          promptTemplateCount: event.resources.promptTemplates?.length ?? 0,
        },
      })
      return
    }
    if (event.type === 'context') {
      this.logger.info('context.prepared', {
        context,
        details: { messageCount: event.messages.length },
      })
      return
    }
    if (event.type === 'turn_composition' || event.type === 'save_point') {
      this.logger.info(
        event.type === 'turn_composition' ? 'agent.step-prepared' : 'agent.save-point',
        {
          context,
          details: {
            toolCount: event.activeToolNames.length,
            ...(event.type === 'turn_composition'
              ? { stepIndex: event.stepIndex + 1 }
              : { hadPendingMutations: event.hadPendingMutations }),
          },
        },
      )
      return
    }
    if (event.type === 'queue_consumed') {
      this.logger.info('queue.consumed', {
        context,
        details: { delivery: event.delivery, inputCount: event.inputIds.length },
      })
      return
    }
    if (
      event.type === 'retry_scheduled' ||
      event.type === 'retry_attempt_start' ||
      event.type === 'retry_finished'
    ) {
      this.logger[event.type === 'retry_scheduled' ? 'warn' : 'info'](
        event.type.replaceAll('_', '.'),
        {
          context,
          details: {
            operation: event.operation,
            ...(event.type === 'retry_scheduled'
              ? {
                  attempt: event.attempt,
                  maxAttempts: event.maxAttempts,
                  delayMs: event.delayMs,
                }
              : {}),
          },
        },
      )
      return
    }
    if (event.type === 'before_provider_request') {
      const model = object(event.model)
      const requestIndex = (this.steps.get(key) ?? 0) + 1
      this.steps.set(key, requestIndex)
      const state: ProviderState = {
        startedAt: this.now(),
        responseCount: 0,
        requestIndex,
        provider: text(model.provider) ?? text(model.providerID) ?? 'unknown',
        model: text(model.id) ?? 'unknown',
      }
      this.providers.set(key, state)
      this.logger.info('provider.requested', {
        context,
        details: {
          provider: state.provider,
          model: state.model,
          requestIndex,
        },
      })
      return
    }
    if (event.type === 'after_provider_response') {
      const state = this.providers.get(key)
      if (state) state.responseCount += 1
      this.logger[event.status >= 500 ? 'error' : event.status >= 400 ? 'warn' : 'info'](
        'provider.response',
        {
          context,
          details: {
            status: event.status,
            ...(state
              ? {
                  provider: state.provider,
                  model: state.model,
                  requestIndex: state.requestIndex,
                  responseIndex: state.responseCount,
                  durationMs: Math.max(0, this.now() - state.startedAt),
                }
              : {}),
          },
        },
      )
      return
    }
    if (event.type === 'message_update') {
      const state = this.providers.get(key)
      if (
        state &&
        state.firstResponseMs === undefined &&
        ['text_delta', 'thinking_delta', 'toolcall_delta'].includes(
          event.assistantMessageEvent.type,
        )
      ) {
        state.firstResponseMs = Math.max(0, this.now() - state.startedAt)
        this.logger.info('provider.first-response', {
          context,
          details: {
            provider: state.provider,
            model: state.model,
            requestIndex: state.requestIndex,
            firstResponseMs: state.firstResponseMs,
          },
        })
      }
      return
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = event.message as unknown as JsonObject
      const usage = object(message.usage)
      const state = this.providers.get(key)
      const reason = text(message.stopReason)
      const category =
        reason === 'error' ? providerFailureCategory(message.errorMessage) : undefined
      this.logger[reason === 'error' ? 'error' : reason === 'aborted' ? 'warn' : 'info'](
        reason === 'error'
          ? 'provider.failed'
          : reason === 'aborted'
            ? 'provider.aborted'
            : 'provider.completed',
        {
          context,
          details: {
            ...(reason ? { reason } : {}),
            ...(category ? { category, message: providerFailureMessage(category, 'request') } : {}),
            ...(state
              ? {
                  provider: state.provider,
                  model: state.model,
                  requestIndex: state.requestIndex,
                  durationMs: Math.max(0, this.now() - state.startedAt),
                  firstResponseMs: state.firstResponseMs,
                }
              : {}),
            inputTokens: number(usage.input) ?? 0,
            outputTokens: number(usage.output) ?? 0,
            cacheReadTokens: number(usage.cacheRead) ?? 0,
            cacheWriteTokens: number(usage.cacheWrite) ?? 0,
          },
        },
      )
      this.providers.delete(key)
      return
    }
    if (event.type === 'session_before_compact') {
      this.logger.info('context.compaction-started', {
        context,
        details: { beforeCount: event.branchEntries.length },
      })
      return
    }
    if (event.type === 'session_compact') {
      this.logger.info('context.compaction-completed', {
        context,
        details: {
          beforeTokens: event.compactionEntry.tokensBefore,
          status: 'completed',
        },
      })
      return
    }
    if (event.type === 'abort') {
      this.providers.delete(key)
      this.steps.delete(key)
      this.logger.warn('agent.aborted', { context, details: { status: 'aborted' } })
      return
    }
    if (event.type === 'settled') {
      this.providers.delete(key)
      this.steps.delete(key)
      this.logger.info('agent.settled', {
        context,
        details: { status: 'settled', nextTurnCount: event.nextTurnCount },
      })
    }
  }
}
