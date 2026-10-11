import { Effect } from 'effect'
import { contentText, type Api, type Model as PiModel, type Models } from '@earendil-works/pi-ai'
import { AgentHarness } from './harness/AgentHarness'
import { SessionError, type Session, type AgentHarnessEvent } from './harness/Types'
import type { AgentRuntime, AgentRuntimeRequest, PendingApproval } from './AgentRuntimeTypes'
import { executeHarnessRun } from './pi/ExecuteHarnessRun'
import type {
  ActiveHarness,
  HarnessRuntimeOptions,
  PiRuntimeEventContext,
  PiRuntimeEventSink,
} from './pi/Types'
import { piToolResultText } from './pi/PiEventAdapter'
import {
  SqlitePiSessionRepo,
  type SqlitePiSessionStorage,
} from '../storage/pi-session/SqlitePiSession'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import type { ToolExecutor } from '../tool/ToolExecutor'
import { PI_LIFECYCLE_TOOLS, type ToolExposureInput } from '../tool/ToolExposurePlan'
import { toolCatalogSummary, type ToolCatalog, type ToolCatalogEntry } from '../tool/ToolRegistry'
import { buildCapabilityCatalogSection } from '../prompt/CapabilityCatalog'
import type { PromptSection } from '../prompt/Types'
import { resolveEffectivePermissionConfig } from '../permission/EffectivePermissionConfig'
import { AgentError, type Item, type SubagentResult } from '../Domain'
import { createLiveEvent } from '../storage/events/EventPublisher'
import { secretScrubber } from '../security/SecretScrubber'
import { proposedPlanTitle } from './plan/ProposedPlanStreamParser'
import {
  formatStructuredPlanMarkdown,
  type ContextUsageBreakdownEntry,
  type StructuredPlan,
} from '@pidex/shared/thread'
import { parseApplyPatch } from '../tool/ApplyPatch/ParseApplyPatch'
import { TurnPiBoundaryRepository } from '../storage/repositories/TurnPiBoundaryRepository'
import {
  ContextCompactionService,
  type ContextCompaction,
} from '../context/ContextCompactionService'
import {
  ArtifactService,
  type ArtifactBlobInput,
  type StoredArtifactBlob,
} from '../storage/ArtifactService'
import type { NewArtifactRecord } from '../storage/repositories/ArtifactRepository'
import type { ToolResultBlock } from '@pidex/shared/thread'
import { PromptComposer } from '../prompt/PromptComposer'
import { RuntimeCompositionService } from '../runtime-composition/Service'
import {
  composeRuntimeComposition,
  createMcpGenerationBinding,
  rebindRuntimeComposition,
} from '../runtime-composition/Composer'
import type { RuntimeWorkspaceScope, BoundRuntimeComposition } from '../runtime-composition/Types'
import { SkillService } from '../prompt/SkillService'
import type { WorkspaceService } from '../workspace/WorkspaceService'
import { classifyToolActivity, storedToolActivity } from '../tool/ToolActivityClassifier'
import type { MemoryManager } from '../resource/MemoryManager'

export type {
  DelegationController,
  AgentRuntimeRequest,
  PendingApproval,
  PlanCheckpoint,
} from './AgentRuntimeTypes'

type PendingTurn = {
  items: Map<string, Item>
  storage: SqlitePiSessionStorage
  consumedInputIDs: Set<string>
  piBoundary?: { sessionID: string; entryID: string }
}

const outputDelta = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * Only tools the given turn may already discover appear in the summary; the
 * frozen deferred envelope is therefore never widened by a live registry.
 */
const capabilityCatalogSection = (
  catalog: ToolCatalog,
  deferredNames: readonly string[],
): PromptSection => {
  const byName = new Map(catalog.all().map((tool) => [tool.sdkName, tool]))
  return buildCapabilityCatalogSection(
    deferredNames.flatMap((name) => {
      const definition = byName.get(name)
      return definition ? [toolCatalogSummary(definition)] : []
    }),
  )
}

const safeTimelinePatchPath = (path: string) => {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\/+/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (/^(?:[a-z]:\/|\/)/i.test(normalized) || parts.includes('..')) {
    return parts.at(-1) ?? '<workspace-file>'
  }
  return normalized || '<workspace-file>'
}

export type TimelineMutationFile = {
  path: string
  additions: number
  deletions: number
}

const timelineToolName = (tool: string) => tool.toLowerCase().split('.').at(-1) ?? ''

const safeTimelineCount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0

const mutationToolKind = (tool: string) => {
  const name = timelineToolName(tool)
  return name === 'apply_patch' || name === 'write' || name === 'edit' ? name : null
}

const integrationSourceFor = (catalog: readonly ToolCatalogEntry[], tool: string) => {
  const origin = catalog.find((entry) => entry.sdkName === tool)?.origin
  return origin?.kind === 'mcp' ? origin.serverName : undefined
}

export const piToolMutationFiles = (tool: string, details: unknown): TimelineMutationFile[] => {
  const kind = mutationToolKind(tool)
  if (!kind || !details || typeof details !== 'object' || Array.isArray(details)) return []
  const record = details as Record<string, unknown>
  const candidates = kind === 'apply_patch' && Array.isArray(record.files) ? record.files : [record]
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const file = candidate as Record<string, unknown>
    if (typeof file.path !== 'string' || !file.path.trim()) return []
    return [
      {
        path: safeTimelinePatchPath(file.path),
        additions: safeTimelineCount(file.additions),
        deletions: safeTimelineCount(file.deletions),
      },
    ]
  })
}

const timelinePathKey = (path: string) => {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\/+/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export const mergeTimelineMutationFiles = (
  existing: readonly TimelineMutationFile[],
  incoming: readonly TimelineMutationFile[],
): TimelineMutationFile[] => {
  const merged = new Map<string, TimelineMutationFile>()
  for (const file of [...existing, ...incoming]) {
    const path = safeTimelinePatchPath(file.path)
    const key = timelinePathKey(path)
    const current = merged.get(key)
    merged.set(key, {
      path: current?.path ?? path,
      additions: (current?.additions ?? 0) + safeTimelineCount(file.additions),
      deletions: (current?.deletions ?? 0) + safeTimelineCount(file.deletions),
    })
  }
  return [...merged.values()]
}

export const piToolTimelineInput = (tool: string, input: unknown): Record<string, unknown> => {
  const record =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  const kind = mutationToolKind(tool)
  if (kind === 'write') {
    const path =
      typeof record.file_path === 'string'
        ? safeTimelinePatchPath(record.file_path)
        : '<workspace-file>'
    return {
      operation: 'write',
      file_path: path,
      ...(typeof record.content === 'string'
        ? { contentBytes: Buffer.byteLength(record.content, 'utf8') }
        : {}),
      affectedPaths: [{ path, operation: 'write' }],
    }
  }
  if (kind === 'edit') {
    const path =
      typeof record.path === 'string' ? safeTimelinePatchPath(record.path) : '<workspace-file>'
    return {
      operation: 'edit',
      path,
      ...(Array.isArray(record.edits) ? { editCount: record.edits.length } : {}),
      affectedPaths: [{ path, operation: 'update' }],
    }
  }
  if (kind !== 'apply_patch') return record
  const patch = typeof record.patch === 'string' ? record.patch : ''
  let affectedPaths: Array<{
    path: string
    operation: 'create' | 'update'
    additions: number
    deletions: number
  }> = []
  let hunkCount = 0
  let additions = 0
  let deletions = 0
  try {
    const operations = parseApplyPatch(patch)
    affectedPaths = operations.map((operation) => {
      const fileAdditions =
        operation.type === 'add'
          ? operation.content.endsWith('\n')
            ? operation.content.slice(0, -1).split('\n').length
            : operation.content.split('\n').length
          : operation.chunks.reduce((sum, chunk) => sum + chunk.additions, 0)
      const fileDeletions =
        operation.type === 'add'
          ? 0
          : operation.chunks.reduce((sum, chunk) => sum + chunk.deletions, 0)
      return {
        path: safeTimelinePatchPath(operation.path),
        operation: operation.type === 'add' ? 'create' : 'update',
        additions: fileAdditions,
        deletions: fileDeletions,
      }
    })
    additions = affectedPaths.reduce((sum, file) => sum + file.additions, 0)
    deletions = affectedPaths.reduce((sum, file) => sum + file.deletions, 0)
    hunkCount = operations.reduce(
      (sum, operation) => sum + (operation.type === 'add' ? 0 : operation.chunks.length),
      0,
    )
  } catch {
    // Invalid patches still get a safe timeline item; the tool result carries the actionable parse error.
  }
  return {
    operation: 'apply_patch',
    patchBytes: Buffer.byteLength(patch, 'utf8'),
    hunkCount,
    additions,
    deletions,
    patch: '[补丁正文已隐藏]',
    ...(affectedPaths.length ? { affectedPaths } : {}),
  }
}

const commandFromInput = (input: unknown) =>
  input &&
  typeof input === 'object' &&
  typeof (input as Record<string, unknown>).command === 'string'
    ? ((input as Record<string, unknown>).command as string)
    : null

const resumedToolResultText = (value: unknown, tool: string) => {
  if (typeof value === 'string') return value
  const safe = secretScrubber.scrub(value)
  const content = safe == null ? '' : JSON.stringify(safe, null, 2)
  return (
    piToolResultText(
      {
        content: content ? [{ type: 'text', text: content }] : [],
        details: safe,
      },
      { tool },
    ) || '工具执行完成（无输出）'
  )
}

export const piToolItemPayload = (item: Item) => {
  const data = item.data
  const terminal =
    item.status === 'completed' || item.status === 'error' || item.status === 'interrupted'
  const tool = typeof data.tool === 'string' ? data.tool : 'tool'
  const command = typeof data.command === 'string' ? data.command : null
  const activity =
    storedToolActivity(data.activity) ??
    classifyToolActivity({
      tool,
      input: data.input,
      command,
    })
  return {
    id: item.id,
    messageID: item.turnID,
    turnId: item.turnID,
    agentId: item.agentID,
    type: 'tool' as const,
    callID: typeof data.callID === 'string' ? data.callID : item.id,
    tool,
    title: typeof data.title === 'string' ? data.title : `运行了 ${tool}`,
    state:
      item.status === 'pending'
        ? ('pending' as const)
        : item.status === 'running'
          ? ('running' as const)
          : item.status === 'error'
            ? ('error' as const)
            : item.status === 'interrupted'
              ? ('interrupted' as const)
              : ('completed' as const),
    input: data.input ?? null,
    command,
    output: typeof data.output === 'string' ? data.output : null,
    error: typeof data.error === 'string' ? data.error : null,
    startedAt: typeof data.startedAt === 'number' ? data.startedAt : item.createdAt,
    finishedAt:
      typeof data.finishedAt === 'number' ? data.finishedAt : terminal ? item.updatedAt : null,
    durationMs:
      typeof data.durationMs === 'number'
        ? data.durationMs
        : terminal
          ? item.updatedAt - item.createdAt
          : null,
    activity,
    ...(item.ordinal === undefined ? {} : { ordinal: item.ordinal }),
    createdAt: item.createdAt,
  }
}

export const finishedPiToolItem = (input: {
  current: Item | null
  turnID: string
  agentID: string
  toolCallID: string
  tool: string
  output: string
  isError: boolean
  timestamp: number
}): Item | null => {
  if (input.current && ['completed', 'error', 'interrupted'].includes(input.current.status))
    return null
  const createdAt = input.current?.createdAt ?? input.timestamp
  return {
    id: input.toolCallID,
    turnID: input.turnID,
    agentID: input.agentID,
    type: 'tool',
    status: input.isError ? 'error' : 'completed',
    data: {
      ...(input.current?.data ?? {}),
      callID: input.toolCallID,
      tool: input.tool,
      title: input.tool,
      state: input.isError ? 'error' : 'completed',
      output: input.isError ? null : input.output,
      error: input.isError ? input.output : null,
      finishedAt: input.timestamp,
      durationMs: input.timestamp - createdAt,
    },
    createdAt,
    updatedAt: input.timestamp,
  }
}

export const piItemDeltaPayload = (input: {
  itemID: string
  context: PiRuntimeEventContext
  delta: string
}) => ({
  itemId: input.itemID,
  turnId: input.context.turnID,
  agentId: input.context.agentID,
  delta: input.delta,
})

export const MAX_CACHED_COMPACTIONS = 10

export interface AgentRuntimeServiceOptions {
  db: AgentDatabase
  hub: EventHub
  models: Models
  toolExecutor: ToolExecutor
  contextCompaction: ContextCompactionService
  artifacts?: ArtifactService
  memoryManager?: MemoryManager | undefined
  observeHarnessEvent?: (context: PiRuntimeEventContext, event: AgentHarnessEvent) => void
}

/** Adapts the existing product lifecycle to Pi without exposing Pi types to RPC. */
export class AgentRuntimeService implements AgentRuntime {
  private readonly repo: SqlitePiSessionRepo
  private readonly turnPiBoundaries: TurnPiBoundaryRepository
  private readonly runtimeCompositions: RuntimeCompositionService
  private readonly active = new Map<string, ActiveHarness>()
  private readonly pending = new Map<string, PendingTurn>()
  private readonly completedCompactions = new Map<string, ContextCompaction>()

  constructor(private readonly options: AgentRuntimeServiceOptions) {
    this.repo = new SqlitePiSessionRepo(options.db)
    this.turnPiBoundaries = new TurnPiBoundaryRepository(options.db)
    this.runtimeCompositions = new RuntimeCompositionService({ db: options.db })
  }

  private setCompletedCompaction(threadId: string, compaction: ContextCompaction): void {
    this.completedCompactions.delete(threadId)
    this.completedCompactions.set(threadId, compaction)
    while (this.completedCompactions.size > MAX_CACHED_COMPACTIONS) {
      const oldestKey = this.completedCompactions.keys().next().value
      if (!oldestKey) break
      this.completedCompactions.delete(oldestKey)
    }
  }

  private async publish(event: ReturnType<AgentDatabase['insertEvent']>) {
    await Effect.runPromise(this.options.hub.publish(event))
  }

  private persistFinishedTool(
    context: PiRuntimeEventContext,
    input: {
      toolCallID: string
      tool: string
      output: string
      details: unknown
      isError: boolean
      resultBlocks?: ToolResultBlock[]
      artifactRecords?: StoredArtifactBlob[]
    },
    workspace?: WorkspaceService,
    integrationSource?: string,
  ) {
    let item = finishedPiToolItem({
      current: this.options.db.getItem(input.toolCallID),
      turnID: context.turnID,
      agentID: context.agentID,
      ...input,
      timestamp: Date.now(),
    })
    if (!item) return []
    if (input.resultBlocks?.length) {
      item = { ...item, data: { ...item.data, resultBlocks: input.resultBlocks } }
    }
    const artifactRows = this.artifactRowsForItem(
      context,
      item.id,
      input.resultBlocks ?? [],
      input.artifactRecords ?? [],
    )
    const mutationFiles = input.isError ? [] : piToolMutationFiles(input.tool, input.details)
    if (mutationFiles.length) {
      const timelineInput =
        item.data.input && typeof item.data.input === 'object' && !Array.isArray(item.data.input)
          ? (item.data.input as Record<string, unknown>)
          : {}
      const priorPaths = Array.isArray(timelineInput.affectedPaths)
        ? timelineInput.affectedPaths
        : []
      const operationByPath = new Map(
        priorPaths.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return []
          const record = value as Record<string, unknown>
          return typeof record.path === 'string' && typeof record.operation === 'string'
            ? [[timelinePathKey(safeTimelinePatchPath(record.path)), record.operation] as const]
            : []
        }),
      )
      item = {
        ...item,
        data: {
          ...item.data,
          input: {
            ...timelineInput,
            affectedPaths: mutationFiles.map((file) => ({
              ...file,
              ...(operationByPath.has(timelinePathKey(file.path))
                ? { operation: operationByPath.get(timelinePathKey(file.path)) }
                : {}),
            })),
          },
        },
      }
    }
    const timelineInput =
      item.data.input && typeof item.data.input === 'object' && !Array.isArray(item.data.input)
        ? (item.data.input as Record<string, unknown>)
        : {}
    item = {
      ...item,
      data: {
        ...item.data,
        activity: classifyToolActivity({
          tool: input.tool,
          input: timelineInput,
          command: commandFromInput(timelineInput),
          details: input.details,
          ...(workspace ? { workspace } : {}),
          ...(integrationSource ? { integrationSource } : {}),
        }),
      },
    }
    const durable: Array<ReturnType<AgentDatabase['insertEvent']>> = []
    this.options.db.transaction(() => {
      this.options.db.upsertItem(context.threadID, item)
      if (artifactRows.length && this.options.db.artifacts.hasArtifactsTable()) {
        for (const artifact of artifactRows) {
          this.options.db.artifacts.insert(artifact)
        }
      }
      const storedTool = this.options.db.getItem(item.id) ?? item
      durable.push(
        this.options.db.insertEvent(
          context.threadID,
          context.turnID,
          input.isError ? 'tool/error' : 'tool/callCompleted',
          input.isError
            ? {
                item: storedTool,
                error: {
                  code: 'TOOL_EXECUTION_ERROR',
                  message: input.output || '工具执行失败',
                  retryable: false,
                },
              }
            : { item: storedTool },
        ),
      )
      if (!mutationFiles.length) return
      const patchID = `patch:${context.turnID}`
      const existingPatch = this.options.db.getItem(patchID)
      const existingFiles = Array.isArray(existingPatch?.data.files)
        ? existingPatch.data.files.flatMap((value): TimelineMutationFile[] => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return []
            const file = value as Record<string, unknown>
            if (typeof file.path !== 'string') return []
            return [
              {
                path: safeTimelinePatchPath(file.path),
                additions: safeTimelineCount(file.additions),
                deletions: safeTimelineCount(file.deletions),
              },
            ]
          })
        : []
      const files = mergeTimelineMutationFiles(existingFiles, mutationFiles)
      const timestamp = item.updatedAt
      const reversible = this.options.db.repositories.turnPatches.getByTurn(context.turnID)
      const patch: Item = {
        id: patchID,
        turnID: context.turnID,
        agentID: context.agentID,
        type: 'patch',
        status: 'completed',
        data: {
          files,
          totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
          totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
          ...(reversible?.evidenceComplete
            ? {
                reversible: true,
                applyState: reversible.applyState,
                actionVersion: reversible.actionVersion,
              }
            : {}),
        },
        ...(existingPatch?.ordinal === undefined ? {} : { ordinal: existingPatch.ordinal }),
        createdAt: existingPatch?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      this.options.db.upsertItem(context.threadID, patch)
      const storedPatch = this.options.db.getItem(patchID) ?? patch
      durable.push(
        this.options.db.insertEvent(context.threadID, context.turnID, 'item/completed', {
          item: storedPatch,
        }),
      )
    })
    return durable
  }

  private artifactRowsForItem(
    context: PiRuntimeEventContext,
    itemId: string,
    resultBlocks: readonly ToolResultBlock[],
    artifactRecords: readonly StoredArtifactBlob[],
  ) {
    const records = new Map(artifactRecords.map((record) => [record.artifactId, record]))
    const timestamp = Date.now()
    const rows: NewArtifactRecord[] = []
    for (const block of resultBlocks) {
      if (block.type !== 'artifact') continue
      const record = records.get(block.artifactId)
      if (!record) continue
      rows.push({
        id: block.artifactId,
        threadId: context.threadID,
        turnId: context.turnID,
        itemId,
        name: block.name,
        mimeType: block.mimeType,
        sizeBytes: record.sizeBytes,
        storagePath: record.sha256,
        sha256: record.sha256,
        createdAt: timestamp,
      })
    }
    return rows
  }

  private async persistFinishedToolArtifacts(inputs: readonly ArtifactBlobInput[]) {
    if (!this.options.artifacts || inputs.length === 0) return []
    return this.options.artifacts.persistBlobs(inputs)
  }

  private async finishTool(
    context: PiRuntimeEventContext,
    input: {
      toolCallID: string
      tool: string
      output: string
      details: unknown
      isError: boolean
      resultBlocks?: ToolResultBlock[]
      artifactInputs?: ArtifactBlobInput[]
    },
    workspace?: WorkspaceService,
    integrationSource?: string,
  ) {
    const artifactRecords = await this.persistFinishedToolArtifacts(input.artifactInputs ?? [])
    const events = this.persistFinishedTool(
      context,
      {
        toolCallID: input.toolCallID,
        tool: input.tool,
        output: input.output,
        details: input.details,
        isError: input.isError,
        ...(input.resultBlocks?.length ? { resultBlocks: input.resultBlocks } : {}),
        ...(artifactRecords.length ? { artifactRecords } : {}),
      },
      workspace,
      integrationSource,
    )
    for (const event of events) await this.publish(event)
  }

  private eventSink(
    storage: SqlitePiSessionStorage,
    session: Session,
    runtimeModel: PiModel<Api>,
    sessionID: string,
    workspace?: WorkspaceService,
    toolCatalog: readonly ToolCatalogEntry[] = [],
    onUsage?: AgentRuntimeRequest['onUsage'],
    readContextUsageBreakdown?: () => readonly ContextUsageBreakdownEntry[] | undefined,
  ): PiRuntimeEventSink {
    const pendingFor = (context: PiRuntimeEventContext) => {
      const existing = this.pending.get(context.threadID)
      if (existing) return existing
      const created: PendingTurn = {
        storage,
        items: new Map<string, Item>(),
        consumedInputIDs: new Set<string>(),
      }
      this.pending.set(context.threadID, created)
      return created
    }
    return {
      event: (context, event) => {
        this.options.observeHarnessEvent?.(context, event)
      },
      assistantMessageStarted: async (context, input) => {
        const timestamp = Date.now()
        const persisted = this.options.db.upsertItemWithEvent(
          context.threadID,
          {
            id: input.textItemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: 'text',
            status: 'running',
            data: { placement: input.placement, text: '' },
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          'item/started',
        )
        await this.publish(persisted.event)
      },
      planStarted: async (context, input) => {
        const timestamp = Date.now()
        const persisted = this.options.db.upsertItemWithEvent(
          context.threadID,
          {
            id: input.itemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: 'plan',
            status: 'running',
            data: { title: '实施计划', markdown: '' },
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          'item/started',
        )
        await this.publish(persisted.event)
      },
      textDelta: async (context, input) => {
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            'item/agentMessage/delta',
            piItemDeltaPayload({ itemID: input.itemID, context, delta: input.delta }),
          ),
        )
      },
      planDelta: async (context, input) => {
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            'plan/delta',
            piItemDeltaPayload({ itemID: input.itemID, context, delta: input.delta }),
          ),
        )
      },
      reasoningDelta: async (context, input) => {
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            'reasoning/textDelta',
            piItemDeltaPayload({
              itemID: input.itemID,
              context,
              delta: input.delta,
            }),
          ),
        )
      },
      assistantMessageCompleted: async (context, input) => {
        const timestamp = Date.now()
        const pending = pendingFor(context)
        if (input.placement === 'result' && input.sessionEntryID) {
          pending.piBoundary = { sessionID, entryID: input.sessionEntryID }
        }
        const text =
          input.text === undefined
            ? contentText(input.content as never, '\n').trim()
            : input.text.trim()
        const contextUsageBreakdown = readContextUsageBreakdown?.()
        const usage = {
          provider: input.provider || runtimeModel.provider,
          model: input.model || runtimeModel.id,
          contextWindow: Math.max(1, Math.trunc(Number(runtimeModel.contextWindow) || 1)),
          input: input.usage.input,
          output: input.usage.output,
          cacheRead: input.usage.cacheRead,
          cacheWrite: input.usage.cacheWrite,
          reasoning: input.usage.reasoning,
          ...(contextUsageBreakdown?.length ? { breakdown: [...contextUsageBreakdown] } : {}),
        }
        if (input.text === undefined || text) {
          const currentText = this.options.db.getItem(input.textItemID)
          pending.items.set(input.textItemID, {
            id: input.textItemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: 'text',
            status: 'completed',
            data: {
              placement: input.placement,
              text,
              usage,
              ...(input.completion ? { completion: input.completion } : {}),
            },
            ...(currentText?.ordinal === undefined ? {} : { ordinal: currentText.ordinal }),
            createdAt: currentText?.createdAt ?? timestamp,
            updatedAt: timestamp,
          })
        }
        const plan = input.plan?.trim()
        if (plan) {
          const currentPlan = this.options.db.getItem(input.planItemID)
          pending.items.set(input.planItemID, {
            id: input.planItemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: 'plan',
            status: 'completed',
            data: { title: proposedPlanTitle(plan), markdown: plan },
            ...(currentPlan?.ordinal === undefined ? {} : { ordinal: currentPlan.ordinal }),
            createdAt: currentPlan?.createdAt ?? timestamp,
            updatedAt: timestamp,
          })
        }
        const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite
        await onUsage?.({
          inputTokens,
          outputTokens: usage.output,
          totalTokens: inputTokens + usage.output,
          requests: 1,
        })
        const content = Array.isArray(input.content) ? input.content : []
        const reasoning = content
          .flatMap((part) => (part.type === 'thinking' ? [part.thinking] : []))
          .join('\n')
          .trim()
        if (reasoning) {
          pending.items.set(input.reasoningItemID, {
            id: input.reasoningItemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: 'reasoning',
            status: 'completed',
            data: { text: reasoning },
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }
      },
      toolStarted: async (context, input) => {
        const timestamp = Date.now()
        const timelineInput = piToolTimelineInput(input.tool, input.input)
        const command = commandFromInput(timelineInput)
        const integrationSource = integrationSourceFor(toolCatalog, input.tool)
        const item: Item = {
          id: input.toolCallID,
          turnID: context.turnID,
          agentID: context.agentID,
          type: 'tool',
          status: 'running',
          data: {
            callID: input.toolCallID,
            tool: input.tool,
            title: input.tool,
            state: 'running',
            input: timelineInput,
            command,
            activity: classifyToolActivity({
              tool: input.tool,
              input: timelineInput,
              command,
              ...(workspace ? { workspace } : {}),
              ...(integrationSource ? { integrationSource } : {}),
            }),
            output: null,
            error: null,
            startedAt: timestamp,
            finishedAt: null,
            durationMs: null,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const persisted = this.options.db.upsertItemWithEvent(
          context.threadID,
          item,
          'tool/callStarted',
          (stored: Item) => ({
            item: stored,
            inputSummary: commandFromInput(timelineInput) ?? input.tool,
          }),
        )
        await this.publish(persisted.event)
      },
      toolUpdated: async (context, input) => {
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            'tool/outputDelta',
            piItemDeltaPayload({
              itemID: input.toolCallID,
              context,
              delta: outputDelta(input.update),
            }),
          ),
        )
      },
      toolFinished: async (context, input) => {
        await this.finishTool(
          context,
          { ...input, output: input.result },
          workspace,
          integrationSourceFor(toolCatalog, input.tool),
        )
      },
      queueConsumed: async (context, input) => {
        if (input.delivery !== 'steer') return
        const pending = pendingFor(context)
        for (const inputID of input.inputIDs) pending.consumedInputIDs.add(inputID)
      },
      savePoint: async (context) => {
        const pending = this.pending.get(context.threadID)
        const durable: Array<ReturnType<AgentDatabase['insertEvent']>> = []
        this.options.db.transaction(() => {
          storage.flush()
          if (pending) {
            if (pending.piBoundary) {
              this.turnPiBoundaries.upsert({
                turnID: context.turnID,
                sessionID: pending.piBoundary.sessionID,
                entryID: pending.piBoundary.entryID,
              })
            }
            for (const item of pending.items.values()) {
              this.options.db.upsertItem(context.threadID, item)
              const persisted = this.options.db.getItem(item.id) ?? item
              durable.push(
                this.options.db.insertEvent(context.threadID, context.turnID, 'item/completed', {
                  item: persisted,
                }),
              )
            }
            const consumedInputIDs = this.options.db.consumeGuideMailbox(context.turnID, [
              ...pending.consumedInputIDs,
            ])
            for (const inputID of consumedInputIDs) {
              durable.push(
                this.options.db.insertEvent(context.threadID, context.turnID, 'queue/updated', {
                  threadId: context.threadID,
                  turnId: context.turnID,
                  inputId: inputID,
                  action: 'steer-consumed',
                }),
              )
            }
          }
        })
        if (pending) this.pending.delete(context.threadID)
        for (const event of durable) await this.publish(event)
      },
      compacted: async (context, input) => {
        const piEntry = await session.getEntry(input.entryID)
        if (!piEntry || piEntry.type !== 'compaction') {
          throw new Error(`Pi compaction entry ${input.entryID} 不存在`)
        }
        const afterContext = await session.buildContext()
        let completed!: ReturnType<ContextCompactionService['complete']>
        this.options.db.transaction(() => {
          storage.flush()
          completed = this.options.contextCompaction.complete({
            threadID: context.threadID,
            turnID: context.turnID,
            sessionID,
            piEntry,
            summary: input.summary,
            firstKeptEntryID: input.firstKeptEntryID,
            beforeCount: input.beforeCount,
            afterCount: afterContext.messages.length,
            items: afterContext.messages,
            promptText: input.promptText,
            contextWindowTokens: Math.max(1, Number(runtimeModel.contextWindow) || 1),
            trigger: input.trigger,
          })
        })
        this.setCompletedCompaction(context.threadID, completed.compaction)
        await this.publish(completed.event)
      },
      aborted: async (context) => {
        storage.discardPending()
        this.pending.delete(context.threadID)
      },
    }
  }

  /**
   * Persists a validated submit_plan submission as the turn's single completed
   * plan item. The item id is deterministic per turn so a repeated submission
   * replaces the same authoritative plan instead of creating a second one, and
   * the Markdown stays a deterministic projection of the structured object.
   */
  private async persistStructuredPlan(input: {
    threadID: string
    turnID: string
    agentID: string
    plan: StructuredPlan
  }): Promise<{ status: 'submitted'; itemID: string }> {
    const timestamp = Date.now()
    const itemID = `${input.turnID}:plan`
    const existing = this.options.db.getItem(itemID)
    const item: Item = {
      id: itemID,
      turnID: input.turnID,
      agentID: input.agentID,
      type: 'plan',
      status: 'completed',
      data: {
        title: input.plan.title.trim(),
        markdown: formatStructuredPlanMarkdown(input.plan),
        structured: input.plan,
      },
      ...(existing?.ordinal === undefined ? {} : { ordinal: existing.ordinal }),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    const persisted = this.options.db.upsertItemWithEvent(input.threadID, item, 'item/completed')
    await this.publish(persisted.event)
    return { status: 'submitted', itemID }
  }

  async run(request: AgentRuntimeRequest) {
    this.options.memoryManager?.notifyTurnStarted()
    // Serialized OpenAI RunState cannot be replayed safely. Continue only from
    // durable Pi session context; side effects remain protected by toolCallID.
    const resolved = await request.resolveModel(request.fallbackModel)
    let effectivePermissionConfig = resolveEffectivePermissionConfig(
      request.taskMode,
      request.permissionConfig,
    )
    const effectivePromptSections = (request.promptSections ?? []).map((section) =>
      section.id === 'permission.resolved'
        ? {
            ...section,
            content: `Resolved permission config: ${JSON.stringify(effectivePermissionConfig)}.`,
          }
        : section,
    )
    const model = resolved.model as unknown as PiModel<Api>
    let session
    try {
      session = await this.repo.openForThread(request.sessionID, request.threadID)
    } catch (cause) {
      if (!(cause instanceof SessionError) || cause.code !== 'not_found') throw cause
      session = await this.repo.create({
        id: request.sessionID,
        threadID: request.threadID,
        agentID: request.agentID,
      })
    }
    const storage = session.getStorage() as SqlitePiSessionStorage
    // Freeze a durable runtime composition before any provider sample. The same
    // product turn always rebinds the persisted snapshot (pause/resume); a new
    // product turn recomposes. Missing storage falls back to fresh ephemeral and
    // fails resume closed.
    const exposurePlan = this.toolExposure({
      ...request,
      permissionConfig: effectivePermissionConfig,
    })
    const toolCatalog = request.toolCatalog ?? this.options.toolExecutor.catalog()
    const activityToolCatalog = toolCatalog.all()
    // The capability summary is part of the prompt that gets frozen below, so a
    // resumed turn keeps the catalogue it started with. It is generated once for
    // the main Agent and subagents instead of being declared per tool.
    effectivePromptSections.splice(
      effectivePromptSections.length - 1,
      0,
      capabilityCatalogSection(toolCatalog, exposurePlan.deferred),
    )
    const composeBundle = () =>
      new PromptComposer().compose({
        threadID: request.threadID,
        mode: request.taskMode,
        profile: request.profile ?? 'main',
        exposedTools: exposurePlan.exposed,
        sections: effectivePromptSections,
      })
    const skillService = request.skillService ?? new SkillService()
    const mcpBinding = this.mcpGenerationFor(request)
    const workspaceScope: RuntimeWorkspaceScope = {
      kind: request.workspace.roots.length > 0 ? 'project' : 'legacy',
      cwd: request.workspace.rootPath,
      roots: [...request.workspace.roots],
      outputDirectory: null,
      instructionSources: [],
    }
    // Successful Skill document reads must leave durable evidence once composition storage
    // exists; a persistence failure is fail-closed so the read is NOT reported
    // as success. Missing-table ephemeral turns no-op inside the repository.
    const recordReferenced = (name: string, hash: string) => {
      this.runtimeCompositions.repository.recordReferencedSkills(request.turnID, [{ name, hash }])
    }
    let composition: BoundRuntimeComposition
    composition = await this.runtimeCompositions.loadOrCompose({
      turnID: request.turnID,
      agentID: request.agentID,
      allowEphemeralFresh: !request.resume,
      compose: async () => {
        const fresh = composeRuntimeComposition({
          turnID: request.turnID,
          threadID: request.threadID,
          profile: request.profile ?? 'main',
          taskMode: request.taskMode,
          ...(resolved.ref.variant
            ? {
                thinkingLevel: String(
                  resolved.ref.variant,
                ) as import('./harness/AgentTypes').ThinkingLevel,
              }
            : {}),
          model,
          modelRef: resolved.ref,
          toolCatalog,
          workspace: request.workspace,
          workspaceScope,
          sessionEntryID: null,
          skillService,
          mcpBinding,
          effectivePermissionConfig,
          toolContext: {
            threadID: request.threadID,
            turnID: request.turnID,
            agentID: request.agentID,
            profile: request.profile ?? 'main',
            taskMode: request.taskMode,
            signal: request.signal,
            workspace: request.workspace,
            ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
            permissionConfig: effectivePermissionConfig,
            model: request.fallbackModel,
            taskSummary: request.content,
          },
          promptBundle: composeBundle(),
          exposurePlan: {
            eager: [...exposurePlan.eager],
            deferred: [...exposurePlan.deferred],
            exposed: [...exposurePlan.exposed],
          },
          recordReferenced,
        })
        return { snapshot: fresh.snapshot, bindings: fresh.bindings }
      },
      rebind: async (snapshot) =>
        rebindRuntimeComposition(snapshot, {
          model,
          modelRef: resolved.ref,
          workspace: request.workspace,
          workspaceScope,
          skillService,
          mcpBinding,
          toolContext: {
            threadID: request.threadID,
            turnID: request.turnID,
            agentID: request.agentID,
            profile: request.profile ?? 'main',
            taskMode: request.taskMode,
            signal: request.signal,
            workspace: request.workspace,
            ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
            permissionConfig: effectivePermissionConfig,
            model: request.fallbackModel,
            taskSummary: request.content,
          },
          toolCatalog,
          ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
          recordReferenced,
        }),
    })
    const composedBundle = composition.plan.snapshot.prompt
    effectivePermissionConfig = composition.plan.snapshot.permissions
    let exposedTools = composition.plan.snapshot.tools.exposed
    try {
      if (request.resume?.toolCallID) {
        const entries = await session.getEntries()
        const assistantEntry = [...entries]
          .reverse()
          .find(
            (entry) =>
              entry.type === 'message' &&
              entry.message.role === 'assistant' &&
              entry.message.content.some(
                (part) => part.type === 'toolCall' && part.id === request.resume!.toolCallID,
              ),
          )
        const toolCall =
          assistantEntry?.type === 'message' && assistantEntry.message.role === 'assistant'
            ? assistantEntry.message.content.find(
                (part) => part.type === 'toolCall' && part.id === request.resume!.toolCallID,
              )
            : undefined
        if (!assistantEntry || !toolCall || toolCall.type !== 'toolCall')
          throw new Error('Pi checkpoint 中找不到待恢复的 tool call')
        const alreadySettled = this.options.db.hasPersistedToolResult(
          request.turnID,
          request.resume.toolCallID,
        )
        if (!alreadySettled) await session.moveTo(assistantEntry.id)
        let resolutionText =
          request.resume.decision === 'deny'
            ? request.resume.answer
              ? `用户拒绝了此工具调用，并要求：${request.resume.answer}`
              : '用户拒绝了此工具调用，请改用其他方案。'
            : (request.resume.answer ?? request.resume.decision ?? 'continue')
        let resolutionDetails: unknown
        let isError = request.resume.decision === 'deny'
        const lifecycleNames = new Set([
          'request_user_input',
          'request_permissions',
          'spawn_agents',
          'wait_agents',
          'send_agent',
          'followup_agent',
          'report_agent',
          'list_agents',
          'stop_agent',
          'update_plan',
          'update_goal',
          'finalize_result',
        ])
        if (
          !alreadySettled &&
          request.resume.decision === 'allow' &&
          toolCall.name === 'request_permissions' &&
          request.resume.permissionGrant
        ) {
          try {
            const grant = await this.options.toolExecutor.applyPermissionGrant(
              {
                scope: request.resume.permissionGrant.scope,
                requestedPermissions: toolCall.arguments as Record<string, unknown>,
                grantedPermissions: request.resume.permissionGrant.grantedPermissions,
              },
              {
                threadID: request.threadID,
                turnID: request.turnID,
                agentID: request.agentID,
                profile: request.profile ?? 'main',
                taskMode: request.taskMode,
                signal: request.signal,
                workspace: request.workspace,
                ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
                permissionConfig: effectivePermissionConfig,
                model: request.fallbackModel,
                taskSummary: request.content,
                toolCallID: request.resume.toolCallID,
              },
            )
            resolutionDetails = secretScrubber.scrub(grant)
            resolutionText = resumedToolResultText(grant, toolCall.name)
          } catch (cause) {
            isError = true
            resolutionText = secretScrubber.scrubText(
              cause instanceof Error ? cause.message : String(cause),
            )
          }
        }
        if (
          !alreadySettled &&
          request.resume.decision === 'allow' &&
          !lifecycleNames.has(toolCall.name)
        ) {
          const completed = this.options.db.completedToolCall(request.resume.toolCallID)
          if (completed && toolCall.name !== 'Read' && toolCall.name !== 'workspace.read') {
            resolutionDetails = secretScrubber.scrub(completed.output)
            resolutionText = resumedToolResultText(completed.output, completed.name)
          } else
            try {
              const resolution = await this.options.toolExecutor.execute(
                toolCall.name,
                toolCall.arguments as Record<string, unknown>,
                {
                  threadID: request.threadID,
                  turnID: request.turnID,
                  agentID: request.agentID,
                  profile: request.profile ?? 'main',
                  taskMode: request.taskMode,
                  signal: request.signal,
                  workspace: request.workspace,
                  ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
                  permissionConfig: effectivePermissionConfig,
                  model: request.fallbackModel,
                  taskSummary: request.content,
                  toolCallID: request.resume.toolCallID,
                  approvedToolCallID: request.resume.toolCallID,
                  ...(request.resume.computerGrant
                    ? { approvedComputerGrant: request.resume.computerGrant }
                    : {}),
                  onSkillDocumentRead: (path, hash) =>
                    composition.bindings.skills.documentRead(path, hash),
                  ...(request.resume.authorizationFingerprint
                    ? { approvedAuthorizationFingerprint: request.resume.authorizationFingerprint }
                    : {}),
                },
              )
              resolutionDetails = secretScrubber.scrub(resolution)
              resolutionText = resumedToolResultText(resolution, toolCall.name)
            } catch (cause) {
              isError = true
              resolutionText = secretScrubber.scrubText(
                cause instanceof Error ? cause.message : String(cause),
              )
            }
        }
        if (!alreadySettled) {
          await session.appendMessage({
            role: 'toolResult',
            toolCallId: request.resume.toolCallID,
            toolName: toolCall.name,
            content: [
              {
                type: 'text',
                text: resolutionText,
              },
            ],
            isError,
            timestamp: Date.now(),
          })
          let completedEvents: Array<ReturnType<AgentDatabase['insertEvent']>> = []
          this.options.db.transaction(() => {
            storage.flush()
            if (!request.resume?.resumeLeaseID && request.resume?.checkpointID) {
              this.options.db.completeQuestionResume(request.resume.checkpointID)
            }
            completedEvents = this.persistFinishedTool(
              {
                threadID: request.threadID,
                turnID: request.turnID,
                agentID: request.agentID,
              },
              {
                toolCallID: request.resume!.toolCallID!,
                tool: toolCall.name,
                output: resolutionText,
                details: resolutionDetails,
                isError,
              },
              request.workspace,
              integrationSourceFor(activityToolCatalog, toolCall.name),
            )
          })
          for (const event of completedEvents) await this.publish(event)
        }
      }
      const previousRuntime = this.active.get(request.threadID)
      if (previousRuntime) {
        try {
          await previousRuntime.harness.abort()
          await previousRuntime.harness.waitForIdle()
        } finally {
          previousRuntime.unsubscribe()
          if (this.active.get(request.threadID) === previousRuntime) {
            this.active.delete(request.threadID)
          }
        }
      }
      let paused = false
      const preapprovedToolCalls = new Map<string, string | undefined>()
      const pause = async (approval: PendingApproval) => {
        paused = true
        await request.pause(approval)
      }
      const executionContext = {
        threadID: request.threadID,
        turnID: request.turnID,
        agentID: request.agentID,
        profile: request.profile ?? 'main',
        taskMode: request.taskMode,
        signal: request.signal,
        workspace: request.workspace,
        ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
        permissionConfig: effectivePermissionConfig,
        model: request.fallbackModel,
        taskSummary: request.content,
      }
      // 按来源实测的上下文字符量只对本次 run 有意义，用闭包保存，
      // 由 executeHarnessRun 在每次 provider 请求前刷新、由 eventSink 读取。
      let contextUsageBreakdown: ContextUsageBreakdownEntry[] | undefined
      const executeSubagentTool = (
        name: string,
        input: Record<string, unknown>,
        toolCallID: string,
        execute: (input: Record<string, unknown>) => Promise<unknown>,
      ) => {
        if (!request.delegation)
          throw new AgentError('TOOL_NOT_AVAILABLE', '当前执行没有子 Agent 协作入口', 409)
        const definition = this.options.toolExecutor.definition(name)
        const normalized = definition.prepareArguments?.(input) ?? input
        return this.options.toolExecutor.execute(name, normalized as Record<string, unknown>, {
          ...executionContext,
          ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
          toolCallID,
          subagentLifecycle: async (_name, actual) => execute(actual),
        })
      }
      const runtimeOptions: HarnessRuntimeOptions = {
        activated: (threadID, active) => this.active.set(threadID, active),
        toolExecutor: this.options.toolExecutor,
        harnessFactory: {
          resolve: async () => ({
            models: this.options.models,
            model,
            session,
          }),
        } as never,
        eventSink: this.eventSink(
          storage,
          session,
          model,
          request.sessionID,
          request.workspace,
          activityToolCatalog,
          request.onUsage,
          () => contextUsageBreakdown,
        ),
        beforeToolCall: async (_runtimeRequest, input) => {
          if ((PI_LIFECYCLE_TOOLS as readonly string[]).includes(input.tool)) return undefined
          const decision = await this.options.toolExecutor.previewApproval(
            input.tool,
            input.input,
            executionContext,
            input.toolCallID,
          )
          if (decision.decision === 'allow') {
            preapprovedToolCalls.set(input.toolCallID, decision.authorizationFingerprint)
            return undefined
          }
          if (decision.decision === 'deny') return { block: true, reason: decision.reason }
          await pause({
            kind: 'permission',
            toolCallID: input.toolCallID,
            checkpoint: {
              state: JSON.stringify({
                engine: 'pi',
                sessionID: request.sessionID,
              }),
              interruption: input,
              toolCallID: input.toolCallID,
              ...(decision.authorizationFingerprint
                ? { authorizationFingerprint: decision.authorizationFingerprint }
                : {}),
            },
          })
          return { block: true, reason: '等待用户审批', pause: true }
        },
        compaction: {
          shouldAutoCompact: (threadID) =>
            this.options.contextCompaction.shouldAutoCompact(threadID),
          recordFailure: (threadID, trigger) =>
            this.options.contextCompaction.recordFailure(threadID, trigger),
        },
        lifecycle: {
          skillList: async () =>
            composition.bindings.skills
              .list()
              .map(({ name, description, origin, format, hash }) => ({
                name,
                description,
                origin,
                format,
                hash,
              })) ?? [],
          skillRead: async (input) => {
            return composition.bindings.skills.read(String(input.name))
          },
          projectSourceList: async () => {
            if (!request.projectSources) throw new Error('当前 turn 未启用项目来源')
            return request.projectSources.list()
          },
          projectSourceRead: async (input) => {
            if (!request.projectSources) throw new Error('当前 turn 未启用项目来源')
            return request.projectSources.read(
              input.sourceId,
              typeof input.offset === 'number' && typeof input.length === 'number'
                ? { offset: input.offset, length: input.length }
                : undefined,
            )
          },
          requestUserInput: async (input, toolCallID) => {
            await pause({
              kind: 'clarification',
              questions: input.questions,
              ...(input.autoResolutionMs === undefined
                ? {}
                : { autoResolutionMs: input.autoResolutionMs }),
              toolCallID,
              checkpoint: {
                state: JSON.stringify({
                  engine: 'pi',
                  sessionID: request.sessionID,
                }),
                interruption: { toolCallID },
                toolCallID,
              },
            })
            return { __piPause: true, status: 'waiting_for_user' }
          },
          requestPermissions: async (input, toolCallID) => {
            if (request.taskMode === 'plan') throw new Error('Plan 模式禁止请求或提升权限')
            const decision = await this.options.toolExecutor.previewApproval(
              'request_permissions',
              input,
              executionContext,
              toolCallID,
            )
            if (decision.decision === 'deny') throw new Error(decision.reason)
            if (decision.decision === 'allow') {
              return this.options.toolExecutor.execute('request_permissions', input, {
                ...executionContext,
                toolCallID,
                approvedToolCallID: toolCallID,
                ...(decision.authorizationFingerprint
                  ? { approvedAuthorizationFingerprint: decision.authorizationFingerprint }
                  : {}),
              })
            }
            await pause({
              kind: 'permission',
              toolCallID,
              checkpoint: {
                state: JSON.stringify({
                  engine: 'pi',
                  sessionID: request.sessionID,
                }),
                interruption: { toolCallID, input },
                toolCallID,
                ...(decision.authorizationFingerprint
                  ? { authorizationFingerprint: decision.authorizationFingerprint }
                  : {}),
              },
            })
            return { __piPause: true, status: 'waiting_for_permission' }
          },
          updatePlan: async (input, toolCallID) => {
            if (request.taskMode !== 'chat' || (request.profile ?? 'main') !== 'main')
              throw new Error('update_plan 仅允许 Chat 模式的主 Agent 使用')
            if (!request.updatePlan) throw new Error('当前 turn 未配置执行计划服务')
            return request.updatePlan(input, toolCallID)
          },
          updateGoal: async (input, toolCallID) => {
            if (request.taskMode !== 'chat' || (request.profile ?? 'main') !== 'main')
              throw new AgentError(
                'TOOL_NOT_ALLOWED_IN_MODE',
                'update_goal 仅允许 Chat 模式的主 Agent 使用',
                403,
              )
            if (!request.updateGoal)
              throw new AgentError('TOOL_NOT_AVAILABLE', '当前任务没有可更新的 Goal', 409)
            return request.updateGoal(input.status, toolCallID)
          },
          submitPlan: async (input) => {
            if (request.taskMode !== 'plan' || (request.profile ?? 'main') !== 'main')
              throw new AgentError(
                'TOOL_NOT_ALLOWED_IN_MODE',
                'submit_plan 仅允许 Plan 模式的主 Agent 使用',
                403,
              )
            return this.persistStructuredPlan({
              threadID: request.threadID,
              turnID: request.turnID,
              agentID: request.agentID,
              plan: input,
            })
          },
          spawnAgents: async (input, toolCallID) =>
            executeSubagentTool('spawn_agents', input, toolCallID, async (input) => {
              const agents = Array.isArray(input.agents) ? input.agents : []
              if (
                request.taskMode === 'plan' &&
                agents.some(
                  (agent) =>
                    !agent ||
                    typeof agent !== 'object' ||
                    (agent as Record<string, unknown>).profile !== 'explorer',
                )
              )
                throw new Error('Plan 模式只能创建 Explorer 子 Agent')
              return request.delegation?.spawn(input as never, {
                permissionConfig: effectivePermissionConfig,
                ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
              })
            }),
          waitAgents: async (input, toolCallID) =>
            executeSubagentTool('wait_agents', input, toolCallID, async (input) => {
              const runIDs = Array.isArray(input.runIDs) ? input.runIDs.map(String) : []
              const mode = input.mode === 'any' ? 'any' : 'all'
              if (!(await request.delegation?.isWaitSatisfied({ runIDs, mode }))) {
                await pause({
                  kind: 'subagents',
                  runIDs,
                  waitMode: mode,
                  toolCallID,
                  checkpoint: {
                    state: JSON.stringify({
                      engine: 'pi',
                      sessionID: request.sessionID,
                    }),
                    interruption: { toolCallID },
                    toolCallID,
                  },
                })
                return { __piPause: true, status: 'waiting_for_subagents' }
              }
              return request.delegation?.wait({ runIDs, mode })
            }),
          followupAgent: async (input, operationID) =>
            executeSubagentTool('followup_agent', input, operationID, async (actual) =>
              request.delegation?.followup?.({
                taskID: String(actual.taskID),
                message: String(actual.message),
                operationID,
              }),
            ),
          reportAgent: async (input, operationID) =>
            executeSubagentTool('report_agent', input, operationID, async (actual) =>
              request.delegation?.report?.({ message: String(actual.message), operationID }),
            ),
          listAgents: async (input, toolCallID) =>
            executeSubagentTool('list_agents', input, toolCallID, async () =>
              request.delegation?.list?.(),
            ),
          sendAgent: async (input, operationID) =>
            executeSubagentTool('send_agent', input, operationID, async (input) =>
              request.delegation?.send({
                taskID: String(input.taskID ?? input.taskId ?? ''),
                message: String(input.message ?? ''),
                operationID,
              }),
            ),
          stopAgent: async (input, operationID) =>
            executeSubagentTool('stop_agent', input, operationID, async (input) =>
              request.delegation?.stop({
                operationID,
                taskID: String(input.taskID ?? input.taskId ?? ''),
              }),
            ),
          finalizeResult: async (input: SubagentResult) => input,
        },
      }
      await request.onRuntimeReady?.()
      const resumedContent = request.resume
        ? `<interaction_resolution toolCallId=${JSON.stringify(request.resume.toolCallID ?? 'unknown')}>${JSON.stringify({ answer: request.resume.answer, decision: request.resume.decision ?? null })}</interaction_resolution>\n继续处理已恢复的 Pi session；不得重新执行已完成或已被用户拒绝的同一个工具调用。若用户给出调整要求，必须据此改用其他方案。`
        : request.content
      let result: Awaited<ReturnType<typeof executeHarnessRun>>
      try {
        result = await executeHarnessRun(runtimeOptions, {
          threadID: request.threadID,
          turnID: request.turnID,
          agentID: request.agentID,
          sessionID: request.sessionID,
          ...(request.profile ? { profile: request.profile } : {}),
          content: resumedContent,
          taskMode: request.taskMode,
          permissionConfig: effectivePermissionConfig,
          signal: request.signal,
          workspace: request.workspace,
          ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
          model,
          policyModel: request.fallbackModel,
          ...(resolved.ref.variant
            ? {
                thinkingLevel: String(
                  resolved.ref.variant,
                ) as import('./harness/AgentTypes').ThinkingLevel,
              }
            : {}),
          exposedTools,
          promptSections: effectivePromptSections,
          ...(request.collaborationMessages
            ? { collaborationMessages: request.collaborationMessages }
            : {}),
          bundle: composedBundle,
          ...(request.attachments ? { attachments: request.attachments } : {}),
          preapprovedToolCalls,
          ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
          ...(request.toolCatalog ? { toolCatalog: request.toolCatalog } : {}),
          frozenDeferredToolNames: composition.plan.snapshot.tools.deferred,
          onSkillDocumentRead: (path, hash) => composition.bindings.skills.documentRead(path, hash),
          onPromptComposed: async (bundle) =>
            request.onPromptComposed?.(bundle, { budgetText: bundle.instructions }),
          onContextUsageMeasured: (breakdown) => {
            contextUsageBreakdown = [...breakdown]
          },
          canAutoCompact: () => !paused && !request.signal.aborted,
        })
      } catch (cause) {
        if (
          cause instanceof AgentError &&
          cause.code === 'PI_CONTEXT_WINDOW_EXCEEDED' &&
          (request.profile ?? 'main') === 'main'
        ) {
          const completed = this.options.db.completedToolEvidenceForTurn(request.turnID)
          if (completed.length > 0) {
            const existing = this.options.db.getAgentTurnCheckpoint(request.turnID)
            const previousAttempt =
              existing?.payload.kind === 'side-effect-prompt-recovery'
                ? Number(existing.payload.attemptOrdinal) || 1
                : 1
            const interrupted = this.options.db.interruptForSideEffectRecovery({
              threadID: request.threadID,
              turnID: request.turnID,
              agentID: request.agentID,
              payload: {
                kind: 'side-effect-prompt-recovery',
                attemptOrdinal: previousAttempt + 1,
                completed,
                error: '模型上下文超过窗口限制，压缩后仍无法继续',
              },
            })
            for (const event of interrupted.events) await this.publish(event)
            throw new AgentError(
              'SIDE_EFFECT_RECOVERY_REQUIRED',
              '模型上下文超限；已保存副作用恢复证据',
              409,
            )
          }
        }
        throw cause
      }
      return paused ? { status: 'paused' as const, output: result.output } : result
    } finally {
      try {
        await composition.release().catch(() => undefined)
      } finally {
        this.options.memoryManager?.notifyTurnCompleted()
      }
    }
  }

  /**
   * Capability summary for the scope the given exposure input allows. Prompt
   * preview calls this so it shows the same generation the frozen turn uses.
   */
  capabilityCatalog(input: ToolExposureInput, toolCatalog?: ToolCatalog): PromptSection {
    const catalog = toolCatalog ?? this.options.toolExecutor.catalog()
    return capabilityCatalogSection(
      catalog,
      this.options.toolExecutor.exposurePlan(input, catalog).deferred,
    )
  }

  toolExposure(request: AgentRuntimeRequest | (ToolExposureInput & { permissionConfig?: never })) {
    const runtime = request as AgentRuntimeRequest
    return this.options.toolExecutor.exposurePlan(
      {
        taskMode: request.taskMode,
        sandboxMode:
          request.taskMode === 'plan'
            ? 'read-only'
            : 'permissionConfig' in request
              ? request.permissionConfig.sandboxMode
              : request.sandboxMode,
        approvalPolicy:
          'permissionConfig' in request
            ? request.permissionConfig.approvalPolicy
            : request.approvalPolicy,
        ...(request.profile ? { profile: request.profile } : {}),
        ...(runtime.skillService
          ? { hasSkillService: true }
          : 'hasSkillService' in request && request.hasSkillService
            ? { hasSkillService: true }
            : {}),
        ...(runtime.projectSources
          ? { hasProjectSources: true }
          : 'hasProjectSources' in request && request.hasProjectSources
            ? { hasProjectSources: true }
            : {}),
        ...(runtime.defaultModeRequestUserInput
          ? { defaultModeRequestUserInput: true }
          : 'defaultModeRequestUserInput' in request && request.defaultModeRequestUserInput
            ? { defaultModeRequestUserInput: true }
            : {}),
        ...(request.delegationEnabled === false ? { delegationEnabled: false } : {}),
        ...(runtime.depth !== undefined ? { depth: runtime.depth } : {}),
        ...(request.collaborationEnabled !== undefined
          ? { collaborationEnabled: request.collaborationEnabled }
          : {}),
        ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
        ...(request.activeDeferredTools
          ? { activeDeferredTools: request.activeDeferredTools }
          : {}),
      },
      runtime.toolCatalog,
    )
  }

  private mcpGenerationFor(request: AgentRuntimeRequest) {
    const definitions = (request.toolCatalog?.all() ?? [])
      .filter((definition) => definition.origin?.kind === 'mcp')
      .map((definition) => {
        const origin = definition.origin as { kind: 'mcp'; serverName: string; rawToolName: string }
        return {
          sdkName: definition.sdkName,
          serverName: origin.serverName,
          rawToolName: origin.rawToolName,
        }
      })
    const serverInstructions = (request.promptSections ?? [])
      .filter(
        (section) =>
          section.source.type === 'runtime' &&
          typeof (section.source as { name?: string }).name === 'string' &&
          (section.source as { name: string }).name.startsWith('mcp:'),
      )
      .map((section) => ({
        serverName: (section.source as { name: string }).name.slice(4),
        content: section.content,
      }))
    return createMcpGenerationBinding(request.workspace.rootPath, {
      serverInstructions,
      definitions,
    })
  }
  async compact(threadID: string, instructions?: string, promptText?: string) {
    const runtime = this.active.get(threadID)
    if (runtime) {
      await runtime.compact('manual', instructions)
      const completed = this.completedCompactions.get(threadID)
      if (!completed) throw new Error('Pi 压缩完成但缺少产品压缩记录')
      return completed
    }
    const row = this.options.db.sqlite
      .query(
        `
      SELECT a.session_id, a.model_ref, t.project_id,
             t.workspace_root, t.workspace_cwd
      FROM agent_executions AS a
      JOIN threads AS t ON t.id = a.thread_id
      WHERE a.thread_id = ? AND a.profile = 'main'
      ORDER BY a.created_at DESC LIMIT 1
    `,
      )
      .get(threadID) as {
      session_id: string
      model_ref: string
      project_id: string | null
      workspace_root: string | null
      workspace_cwd: string | null
    } | null
    if (!row) throw new Error('Pi session 不存在，无法执行手动压缩')
    const ref = JSON.parse(row.model_ref) as { providerID: string; id: string }
    const model = this.options.models.getModel(ref.providerID, ref.id)
    if (!model) throw new Error(`Pi 模型 ${ref.providerID}/${ref.id} 不可用`)
    const session = await this.repo.openForThread(row.session_id, threadID)
    const storage = session.getStorage() as SqlitePiSessionStorage
    const harness = new AgentHarness({
      session,
      models: this.options.models,
      model,
      tools: [],
      systemPrompt: '',
    })
    const beforeCount = (await session.getEntries()).length
    const result = await harness.compact(instructions)
    const entryID = await storage.getLeafId()
    const piEntry = entryID ? await session.getEntry(entryID) : undefined
    if (!piEntry || piEntry.type !== 'compaction') {
      throw new Error('Pi 压缩完成但未生成 compaction entry')
    }
    const afterContext = await session.buildContext()
    let completed!: ReturnType<ContextCompactionService['complete']>
    this.options.db.transaction(() => {
      storage.flush()
      completed = this.options.contextCompaction.complete({
        threadID,
        turnID: null,
        sessionID: row.session_id,
        piEntry,
        summary: result.summary,
        firstKeptEntryID: result.firstKeptEntryId ?? null,
        beforeCount,
        afterCount: afterContext.messages.length,
        items: afterContext.messages,
        promptText: promptText ?? '',
        contextWindowTokens: Math.max(1, Number(model.contextWindow) || 1),
        trigger: 'manual',
      })
    })
    this.setCompletedCompaction(threadID, completed.compaction)
    await this.publish(completed.event)
    return completed.compaction
  }

  async steer(
    threadID: string,
    content: string,
    images?: import('@earendil-works/pi-ai').ImageContent[],
    inputID?: string,
  ) {
    const runtime = this.active.get(threadID)
    if (!runtime) throw new Error('Pi Harness 尚未启动')
    await runtime.harness.steer(content, {
      ...(images ? { images } : {}),
      ...(inputID ? { inputId: inputID } : {}),
    })
  }

  async followUp(threadID: string, content: string) {
    const runtime = this.active.get(threadID)
    if (!runtime) throw new Error('Pi Harness 尚未启动')
    await runtime.harness.followUp(content)
  }

  async abort(threadID: string) {
    const runtime = this.active.get(threadID)
    if (runtime) await runtime.harness.abort()
  }

  clearTurnPermissionGrants(threadID: string, turnID: string) {
    this.options.toolExecutor.clearTurnPermissionGrants(threadID, turnID)
  }

  async dispose() {
    await Promise.allSettled(
      [...this.active.values()].map(async ({ harness, unsubscribe }) => {
        unsubscribe()
        await harness.abort()
      }),
    )
    this.active.clear()
  }
}
