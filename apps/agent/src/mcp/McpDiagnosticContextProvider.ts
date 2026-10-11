import type { ThreadSnapshot } from '@pidex/shared/thread'
import type { Model } from '@pidex/model-schema'
import type { TaskMode } from '../Domain'
import { secretScrubber } from '../security/SecretScrubber'

const MAX_ENTRIES = 20
const MAX_TOOLS = 50
const MAX_TEXT_BYTES = 16 * 1024
const MAX_CONTEXT_BYTES = 64 * 1024

export const MCP_DIAGNOSTIC_CONTEXT_KEY = 'com.pidex/diagnostic-context'

export type McpDiagnosticContext = {
  version: 1
  thread: {
    id: string
    title: string
    taskMode: TaskMode
  }
  invocation: {
    turnId: string
    agentId: string
    toolCallId: string
    model: {
      providerID: string
      id: string
    }
  }
  entries: Array<{
    role: 'user' | 'assistant'
    placement?: 'process' | 'result'
    text: string
    createdAt: number
  }>
  tools: Array<{
    name: string
    state: string
    durationMs: number | null
  }>
  truncated: boolean
}

export type McpDiagnosticContextUnavailable = {
  version: 1
  status: 'DIAGNOSTIC_CONTEXT_UNAVAILABLE'
}

export type McpDiagnosticContextSource = {
  snapshot(threadID: string): ThreadSnapshot | null
}

export type McpDiagnosticContextInput = {
  threadID: string
  turnID: string
  agentID: string
  toolCallID: string
  taskMode: TaskMode
  model: Model.Ref
  workspaceRoot: string
}

const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const truncateUtf8 = (value: string, maximumBytes: number) => {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) {
    return { value, truncated: false }
  }
  let end = Math.min(value.length, maximumBytes)
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maximumBytes) {
    end -= Math.max(
      1,
      Math.ceil((Buffer.byteLength(value.slice(0, end), 'utf8') - maximumBytes) / 2),
    )
  }
  return { value: value.slice(0, end), truncated: true }
}

const pathVariants = (workspaceRoot: string) => {
  const normalized = workspaceRoot.replace(/[\\/]+$/u, '')
  return [
    ...new Set(
      [normalized, normalized.replaceAll('\\', '/'), normalized.replaceAll('/', '\\')].filter(
        Boolean,
      ),
    ),
  ]
}

export class McpDiagnosticContextProvider {
  constructor(private readonly source: McpDiagnosticContextSource) {}

  build(input: McpDiagnosticContextInput): McpDiagnosticContext {
    const snapshot = this.source.snapshot(input.threadID)
    if (!snapshot) throw new Error('Thread projection unavailable')

    const roots = pathVariants(input.workspaceRoot)
    let truncated = false
    const safeText = (value: string) => {
      let safe = secretScrubber.scrubText(value)
      for (const root of roots) {
        safe = safe.replace(new RegExp(escapeRegExp(root), 'giu'), '<workspace>')
      }
      const bounded = truncateUtf8(safe, MAX_TEXT_BYTES)
      truncated ||= bounded.truncated
      return bounded.value
    }

    const allEntries: McpDiagnosticContext['entries'] = [
      ...snapshot.inputs.map((entry) => ({
        role: 'user' as const,
        text: safeText(entry.content),
        createdAt: entry.createdAt,
      })),
      ...snapshot.items.flatMap((item) =>
        item.type === 'text'
          ? [
              {
                role: 'assistant' as const,
                placement: item.placement,
                text: safeText(item.text),
                createdAt: item.createdAt,
              },
            ]
          : [],
      ),
    ].sort((left, right) => left.createdAt - right.createdAt)

    const allTools: McpDiagnosticContext['tools'] = snapshot.items.flatMap((item) =>
      item.type === 'tool'
        ? [
            {
              name: safeText(item.tool),
              state: item.state,
              durationMs: item.durationMs,
            },
          ]
        : [],
    )

    truncated ||= allEntries.length > MAX_ENTRIES || allTools.length > MAX_TOOLS
    const context: McpDiagnosticContext = {
      version: 1,
      thread: {
        id: snapshot.thread.id,
        title: safeText(snapshot.thread.title),
        taskMode: input.taskMode,
      },
      invocation: {
        turnId: input.turnID,
        agentId: input.agentID,
        toolCallId: input.toolCallID,
        model: {
          providerID: String(input.model.providerID),
          id: String(input.model.id),
        },
      },
      entries: allEntries.slice(-MAX_ENTRIES),
      tools: allTools.slice(-MAX_TOOLS),
      truncated,
    }

    while (byteLength(context) > MAX_CONTEXT_BYTES && context.entries.length > 1) {
      context.entries.shift()
      context.truncated = true
    }
    while (byteLength(context) > MAX_CONTEXT_BYTES && context.tools.length > 0) {
      context.tools.shift()
      context.truncated = true
    }
    if (byteLength(context) > MAX_CONTEXT_BYTES && context.entries.length === 1) {
      const entry = context.entries[0]!
      const overhead = byteLength({ ...context, entries: [{ ...entry, text: '' }] })
      entry.text = truncateUtf8(entry.text, Math.max(0, MAX_CONTEXT_BYTES - overhead)).value
      context.truncated = true
      while (byteLength(context) > MAX_CONTEXT_BYTES && entry.text.length > 0) {
        const overflow = byteLength(context) - MAX_CONTEXT_BYTES
        entry.text = entry.text.slice(0, Math.max(0, entry.text.length - Math.max(1, overflow)))
      }
    }
    return context
  }
}
