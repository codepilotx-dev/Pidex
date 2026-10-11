import type { AgentHarness } from '../harness/AgentHarness'
import type {
  AgentHarnessEvent,
  AgentHarnessResources,
  CompactResult,
  Session,
} from '../harness/Types'
import type { AgentTool, ThinkingLevel } from '../harness/AgentTypes'
import type { Model, Models } from '@earendil-works/pi-ai'
import type { ContextUsageBreakdownEntry, ToolResultBlock } from '@pidex/shared/thread'
import type {
  ModelRef,
  PermissionConfig,
  SubagentProfile,
  SubagentResult,
  TaskMode,
} from '../../Domain'
import type { PromptBundle, PromptSection } from '../../prompt/Types'
import type { ToolExecutor } from '../../tool/ToolExecutor'
import type { ToolCatalog } from '../../tool/ToolRegistry'
import type { WorkspaceService } from '../../workspace/WorkspaceService'
import type { ExecutionPlanInput } from '../plan/ExecutionPlanInput'
import type { StructuredPlan } from '@pidex/shared/thread'
import type { RequestUserInput } from '../../session/QuestionInput'

export type HarnessRunResult =
  | { status: 'completed'; output: string; result?: SubagentResult }
  | { status: 'paused'; output: string }

export type RuntimeCompactionTrigger = 'manual' | 'automatic' | 'reactive'

export interface HarnessRuntimeRequest {
  threadID: string
  turnID: string
  agentID: string
  sessionID: string
  profile?: SubagentProfile
  content: string
  taskMode: TaskMode
  permissionConfig: PermissionConfig
  signal: AbortSignal
  workspace: WorkspaceService
  defaultCwd?: string
  model: Model<any>
  policyModel: ModelRef
  thinkingLevel?: ThinkingLevel
  collaborationMessages?: () => Array<{
    id: string
    kind: string
    message: string
    created_at: number
  }>
  exposedTools: readonly string[]
  promptSections: readonly PromptSection[]
  /** Authoritative pre-composed prompt bundle (frozen by the turn composition). */
  bundle?: PromptBundle
  attachments?: Array<
    | { kind: 'text'; name: string; text: string }
    | { kind: 'image'; name: string; mediaType: string; base64: string }
  >
  allowedTools?: readonly string[]
  toolCatalog?: ToolCatalog
  /** Frozen deferred tool names from the persisted turn snapshot; the runtime may only bind these. */
  frozenDeferredToolNames?: readonly string[]
  onPromptComposed?: (bundle: PromptBundle) => void | Promise<void>
  /** 每次 provider 请求前上报按来源实测的上下文字符量；仅用于展示。 */
  onContextUsageMeasured?: (breakdown: readonly ContextUsageBreakdownEntry[]) => void
  onSkillDocumentRead?: (path: string, hash: string) => Promise<{ name: string } | undefined>
  preapprovedToolCalls?: ReadonlyMap<string, string | undefined>
  canAutoCompact?: () => boolean | Promise<boolean>
}

export interface PiHarnessDependencies {
  models: Models
  session: Session
  resources?: AgentHarnessResources
}

export interface PiHarnessFactory {
  resolve(request: HarnessRuntimeRequest): Promise<PiHarnessDependencies>
}

export interface PiRuntimeEventContext {
  threadID: string
  turnID: string
  agentID: string
}

export type PiAssistantMessagePlacement = 'process' | 'result'

/**
 * Base64-encoded artifact content produced by a tool result. The sink persists
 * the blob under a controlled store and only the artifact ID travels in items
 * and events.
 */
export type PiToolArtifactInput = {
  artifactId: string
  name: string
  mimeType: string
  data: string
}

export type PiToolCompletionMetadata = {
  stopReason?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/**
 * Persistence is deliberately outside the Pi adapter. The eventual Agent integration
 * must implement savePoint/settled with AgentDatabase transactions and publish only
 * after the transaction commits.
 */
export interface PiRuntimeEventSink {
  event?(context: PiRuntimeEventContext, event: AgentHarnessEvent): void | Promise<void>
  assistantMessageStarted?(
    context: PiRuntimeEventContext,
    input: {
      textItemID: string
      reasoningItemID: string
      placement: PiAssistantMessagePlacement
    },
  ): void | Promise<void>
  assistantMessageCompleted?(
    context: PiRuntimeEventContext,
    input: {
      textItemID: string
      reasoningItemID: string
      planItemID: string
      placement: PiAssistantMessagePlacement
      content: unknown
      text?: string
      plan?: string | null
      provider: string
      api: string
      model: string
      /** Final assistant message entry in the private Pi session tree. */
      sessionEntryID?: string
      usage: {
        input: number
        output: number
        cacheRead: number
        cacheWrite: number
        reasoning: number
      }
      /** Safe completion metadata projected from the provider response. */
      completion?: PiToolCompletionMetadata
    },
  ): void | Promise<void>
  textDelta?(
    context: PiRuntimeEventContext,
    input: { itemID: string; delta: string },
  ): void | Promise<void>
  planStarted?(context: PiRuntimeEventContext, input: { itemID: string }): void | Promise<void>
  planDelta?(
    context: PiRuntimeEventContext,
    input: { itemID: string; delta: string },
  ): void | Promise<void>
  reasoningDelta?(
    context: PiRuntimeEventContext,
    input: { itemID: string; delta: string },
  ): void | Promise<void>
  toolStarted?(
    context: PiRuntimeEventContext,
    input: { toolCallID: string; tool: string; input: unknown },
  ): void | Promise<void>
  toolUpdated?(
    context: PiRuntimeEventContext,
    input: { toolCallID: string; tool: string; update: unknown },
  ): void | Promise<void>
  toolFinished?(
    context: PiRuntimeEventContext,
    input: {
      toolCallID: string
      tool: string
      result: string
      details: unknown
      isError: boolean
      resultBlocks?: ToolResultBlock[]
      artifactInputs?: PiToolArtifactInput[]
    },
  ): void | Promise<void>
  queueUpdated?(
    context: PiRuntimeEventContext,
    input: { steer: number; followUp: number; nextTurn: number },
  ): void | Promise<void>
  queueConsumed?(
    context: PiRuntimeEventContext,
    input: { delivery: 'steer' | 'follow-up' | 'next-turn'; inputIDs: string[] },
  ): void | Promise<void>
  compacted?(
    context: PiRuntimeEventContext,
    input: {
      entryID: string
      summary: string
      firstKeptEntryID: string | null
      tokensBefore: number
      beforeCount: number
      trigger: RuntimeCompactionTrigger
      promptText: string
    },
  ): void | Promise<void>
  savePoint?(
    context: PiRuntimeEventContext,
    input: { hadPendingMutations: boolean },
  ): void | Promise<void>
  settled?(context: PiRuntimeEventContext, input: { nextTurnCount: number }): void | Promise<void>
  aborted?(context: PiRuntimeEventContext): void | Promise<void>
}

export interface PiToolAdapterOptions {
  executor: ToolExecutor
  request: HarnessRuntimeRequest
}

export interface PiLifecycleCallbacks {
  skillList?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  skillRead?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  projectSourceList?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  projectSourceRead?(
    input: { sourceId: string; offset?: number; length?: number },
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<{
    source: { id: string; name: string; kind: 'text' | 'image' }
    data: Uint8Array
    mediaType: string
    range: { offset: number; length: number; total: number }
  }>
  requestUserInput?(
    input: RequestUserInput & { question?: string; options?: string[] },
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  requestPermissions?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  updatePlan?(input: ExecutionPlanInput, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  updateGoal?(
    input: { status: 'complete' | 'blocked' },
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  submitPlan?(input: StructuredPlan, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  spawnAgents?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  waitAgents?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  sendAgent?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  followupAgent?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  reportAgent?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  listAgents?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  stopAgent?(
    input: Record<string, unknown>,
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<unknown>
  finalizeResult?(input: SubagentResult, toolCallID: string): Promise<unknown>
}

export interface HarnessRuntimeOptions {
  harnessFactory: PiHarnessFactory
  toolExecutor: ToolExecutor
  eventSink?: PiRuntimeEventSink
  activated?(threadID: string, active: ActiveHarness): void
  lifecycle?: PiLifecycleCallbacks
  beforeToolCall?: (
    request: HarnessRuntimeRequest,
    input: {
      toolCallID: string
      tool: string
      input: Record<string, unknown>
      messageToolCallCount: number
    },
  ) => Promise<{ block?: boolean; reason?: string; pause?: boolean } | undefined>
  compaction?: {
    shouldAutoCompact(threadID: string): boolean | Promise<boolean>
    recordFailure(threadID: string, trigger: RuntimeCompactionTrigger): void | Promise<void>
  }
}

export interface ActiveHarness {
  harness: AgentHarness
  unsubscribe: () => void
  compact(trigger: RuntimeCompactionTrigger, instructions?: string): Promise<CompactResult>
}

export type PiTool = AgentTool<any, unknown>
