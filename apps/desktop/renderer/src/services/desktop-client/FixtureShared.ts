// 从 Fixtures.ts 移出的 Browser Mock history projection。Agent 路径仅在
// Browser Mock 回退真正读取历史时动态加载，Electron 首屏不会解析本模块。
// 实现直接从 Fixtures.ts 移动，不复制平行逻辑。
import type { DesktopSessionSnapshot } from '../../../shared/Types.js'
import type { RpcResult } from '@pidex/agent-protocol'

export function mockThreadHistoryPage(
  snapshot: DesktopSessionSnapshot,
): RpcResult<'thread/history/read'> {
  const threadId = snapshot.item.id
  const createdAt = Date.parse(snapshot.item.createdAt) || Date.now()
  const updatedAt = Date.parse(snapshot.updatedAt) || createdAt
  const permissionConfig = snapshot.settings.permissionConfig
  const mode = snapshot.settings.planModeActive ? 'plan' : 'chat'
  const model = { providerID: 'mock', id: snapshot.settings.model ?? 'mock' }
  const bundles: Array<Record<string, unknown>> = []
  let current: {
    turn: Record<string, unknown>
    inputs: Array<Record<string, unknown>>
    messages: Array<Record<string, unknown>>
    agents: Array<Record<string, unknown>>
    items: Array<Record<string, unknown>>
    approvals: Array<Record<string, unknown>>
    attachments: Array<Record<string, unknown>>
  } | null = null

  for (const [index, message] of snapshot.view.messages.entries()) {
    const messageCreatedAt =
      typeof message.createdAt === 'number'
        ? message.createdAt
        : Date.parse(message.createdAt ?? '') || createdAt + index
    if (message.role === 'user') {
      const messageAttachments = mockMessageAttachments(message.metadata, message.id)
      const turnId = `mock-turn:${message.id}`
      const agentId = `mock-agent:${message.id}`
      current = {
        turn: {
          id: turnId,
          threadId,
          sourceInputID: message.id,
          status: 'completed',
          mode,
          model,
          permissionConfig,
          rootAgentId: agentId,
          mergedInputIDs: [],
          startedAt: messageCreatedAt,
          finishedAt: messageCreatedAt,
          elapsedSeconds: 0,
          error: null,
        },
        inputs: [
          {
            id: message.id,
            threadId,
            turnId,
            content: message.text,
            delivery: 'start',
            mode,
            model,
            permissionConfig,
            attachmentIds: messageAttachments.map((attachment) => attachment.id),
            state: 'completed',
            createdAt: messageCreatedAt,
          },
        ],
        messages: [{ id: message.id, threadId, turnId, role: 'user', createdAt: messageCreatedAt }],
        agents: [
          {
            id: agentId,
            threadId,
            turnId,
            parentAgentId: null,
            profile: 'main',
            task: message.text,
            model,
            sessionId: `mock-session:${turnId}`,
            depth: 0,
            status: 'completed',
            error: null,
            subagentRunId: null,
            runSequence: 0,
            createdAt: messageCreatedAt,
            updatedAt: messageCreatedAt,
          },
        ],
        items: [],
        approvals: [],
        attachments: messageAttachments,
      }
      bundles.push(current)
      continue
    }
    if (message.role !== 'assistant' || !current) continue
    const turnId = current.turn.id as string
    const agentId = current.turn.rootAgentId as string
    current.messages.push({
      id: message.id,
      threadId,
      turnId,
      role: 'assistant',
      createdAt: messageCreatedAt,
    })
    current.items.push({
      id: message.id,
      messageID: message.id,
      turnId,
      agentId,
      type: 'text',
      placement: 'result',
      text: message.text,
      status: message.streaming ? 'streaming' : 'completed',
      createdAt: messageCreatedAt,
    })
    if (message.streaming) {
      current.turn.status = 'running'
      current.turn.finishedAt = null
      current.agents[0]!.status = 'running'
    }
  }

  /* ── Process non-message events (tool calls, patches, plans) ── */

  const toolItems = new Map<string, Record<string, unknown>>()

  for (const event of snapshot.events) {
    if (!current) continue
    const turnId = current.turn.id as string
    const agentId = current.turn.rootAgentId as string
    const eventCreatedAt =
      typeof event.createdAt === 'number'
        ? event.createdAt
        : Date.parse(event.createdAt ?? '') || createdAt

    if (event.type === 'tool_call') {
      const metadata = (event as any).metadata ?? {}
      const toolUseId = metadata.toolUseId ?? event.id
      const toolName = metadata.toolName ?? 'Bash'
      const toolItem: Record<string, unknown> = {
        id: toolUseId,
        messageID: toolUseId,
        turnId,
        agentId,
        type: 'tool',
        callID: toolUseId,
        tool: toolName,
        title: event.content,
        state: 'running',
        input: null,
        command: typeof metadata.command === 'string' ? metadata.command : null,
        ...(metadata.activity ? { activity: metadata.activity } : {}),
        output: null,
        error: null,
        startedAt: eventCreatedAt,
        finishedAt: null,
        durationMs: null,
        createdAt: eventCreatedAt,
      }
      current.items.push(toolItem)
      toolItems.set(toolUseId, toolItem)
      if (current.turn.status === 'completed') {
        current.turn.status = 'running'
        current.turn.finishedAt = null
        current.agents[0]!.status = 'running'
      }
    }

    if (event.type === 'tool_output_delta') {
      const toolUseId = (event as any).metadata?.toolUseId
      const existing = toolUseId ? toolItems.get(toolUseId) : null
      if (existing) {
        const prev = (existing.output as string) ?? ''
        existing.output = prev + event.content
        existing.state = 'completed'
        existing.finishedAt = eventCreatedAt
      }
    }

    if (event.type === 'file_patch') {
      const metadata = (event as any).metadata
      const files: Array<Record<string, unknown>> = (metadata?.files ?? []).map(
        (
          f: { path: string; additions?: number; deletions?: number; patch?: string },
          i: number,
        ) => ({
          path: f.path,
          additions: f.additions ?? 1,
          deletions: f.deletions ?? 0,
          patch: f.patch ?? null,
        }),
      )
      current.items.push({
        id: `${event.id}`,
        messageID: `${event.id}`,
        turnId,
        agentId,
        type: 'patch',
        files,
        totalAdditions: files.reduce(
          (sum: number, f: Record<string, unknown>) => sum + (f.additions as number),
          0,
        ),
        totalDeletions: files.reduce(
          (sum: number, f: Record<string, unknown>) => sum + (f.deletions as number),
          0,
        ),
        createdAt: eventCreatedAt,
      })
      current.turn.status = 'completed'
      current.turn.finishedAt = eventCreatedAt
      current.agents[0]!.status = 'completed'
      current.agents[0]!.updatedAt = eventCreatedAt
    }

    if (event.type === 'proposed_plan') {
      current.items.push({
        id: `${event.id}`,
        messageID: `${event.id}`,
        turnId,
        agentId,
        type: 'plan',
        title: '实施计划',
        markdown: event.content,
        version: 0,
        status: 'completed',
        createdAt: eventCreatedAt,
      })
    }

    if (event.type === 'execution-plan') {
      const metadata = (event as any).metadata ?? {}
      current.items.push({
        id: `${event.id}`,
        messageID: `${event.id}`,
        turnId,
        agentId,
        type: 'execution-plan',
        explanation: event.content ?? null,
        steps: metadata.steps ?? [],
        status: metadata.status ?? 'completed',
        createdAt: eventCreatedAt,
      })
    }
  }

  // If there are tool items with no matching output delta, leave them as running

  return {
    thread: {
      id: threadId,
      title: snapshot.item.sessionName ?? snapshot.item.aiTitle ?? '浏览器会话',
      projectID: null,
      settings: { taskMode: mode, permissionConfig },
      createdAt,
      updatedAt,
    },
    subagents: [],
    turns: bundles,
    queue: { version: 0, pauseReason: null, turns: [], inputs: [] },
    olderCursor: null,
    hasOlder: false,
    // 与真实 thread/history/read 一致：同一个会话的 stream 就是会话本身。
    // 性能用例需要把 live delta 直接喂给 canonical coordinator，streamId 必须
    // 与订阅使用的 threadId 相同，否则事件会被投影按 stream 过滤掉。
    streamPosition: { streamId: threadId, sequence: 0 },
  } as unknown as RpcResult<'thread/history/read'>
}

type MockMessageAttachment = {
  id: string
  kind: 'image' | 'text'
  name: string
  mediaType: string
  sizeBytes: number
  sha256: string
  createdAt: number
}

function mockMessageAttachments(
  metadata: Record<string, unknown> | undefined,
  messageId: string,
): MockMessageAttachment[] {
  const source = metadata?.attachments
  if (!Array.isArray(source)) return []
  return source.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return []
    const candidate = value as Record<string, unknown>
    const kind = candidate.kind === 'image' ? 'image' : candidate.kind === 'text' ? 'text' : null
    const name = typeof candidate.name === 'string' ? candidate.name : null
    if (!kind || !name) return []
    return [
      {
        id:
          typeof candidate.id === 'string' ? candidate.id : `${messageId}-attachment-${index + 1}`,
        kind,
        name,
        mediaType:
          typeof candidate.mediaType === 'string'
            ? candidate.mediaType
            : kind === 'image'
              ? 'image/png'
              : 'text/plain',
        sizeBytes: typeof candidate.sizeBytes === 'number' ? candidate.sizeBytes : 0,
        sha256:
          typeof candidate.sha256 === 'string'
            ? candidate.sha256
            : `visual-${messageId}-${index + 1}`,
        createdAt:
          typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now() + index,
      },
    ]
  })
}
