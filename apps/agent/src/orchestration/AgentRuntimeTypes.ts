import type {
  ModelRef,
  PermissionConfig,
  SubagentProfile,
  SubagentResult,
  TaskMode,
} from '../Domain'
import type { WorkspaceService } from '../workspace/WorkspaceService'
import type { PromptBundle, PromptSection } from '../prompt/Types'
import type { SkillService } from '../prompt/SkillService'
import type { ToolCatalog } from '../tool/ToolRegistry'
import type { ExecutionPlanInput } from './plan/ExecutionPlanInput'
import type { RichQuestion } from '../session/QuestionInput'
import type { ContextCompaction } from '../context/ContextCompactionService'
import type { ToolExposureInput, ToolExposurePlan } from '../tool/ToolExposurePlan'

export type RuntimeImage = { type: 'image'; data: string; mimeType: string }

export class SafeBoundaryInterrupt extends Error {
  constructor() {
    super('Subagent reached a safe boundary')
    this.name = 'SafeBoundaryInterrupt'
  }
}

export interface PlanCheckpoint {
  state: string
  interruption: unknown
  answer: string | null
  decision?: 'allow' | 'deny'
  toolCallID?: string
  authorizationFingerprint?: string
  approvalID?: string
  checkpointID?: string
  resumeLeaseID?: string
  computerGrant?: 'chat' | 'persistent'
  permissionGrant?: {
    scope: 'tool-call' | 'turn' | 'session'
    grantedPermissions: {
      readPaths?: string[]
      writePaths?: string[]
      networkDomains?: string[]
    }
  }
}

export interface PendingApproval {
  checkpoint: Omit<PlanCheckpoint, 'answer'>
  kind: 'clarification' | 'subagents' | 'permission'
  question?: string
  options?: string[]
  questions?: RichQuestion[]
  autoResolutionMs?: number
  runIDs?: string[]
  waitMode?: 'all' | 'any'
  toolCallID?: string
}

export interface DelegationController {
  spawn(
    input: {
      agents: Array<{
        name?: string
        profile: 'default' | 'explorer' | 'worker'
        task: string
        workspaceMode?: 'shared' | 'worktree'
        model?: ModelRef
      }>
    },
    policy?: { permissionConfig: PermissionConfig; allowedTools?: readonly string[] },
  ): Promise<unknown>
  wait(input: { runIDs: string[]; mode: 'all' | 'any' }): Promise<unknown>
  isWaitSatisfied(input: { runIDs: string[]; mode: 'all' | 'any' }): Promise<boolean>
  send(input: { taskID: string; message: string; operationID?: string }): Promise<unknown>
  followup?(input: { taskID: string; message: string; operationID: string }): Promise<unknown>
  report?(input: { message: string; operationID: string }): Promise<unknown>
  list?(): Promise<unknown>
  stop(input: { taskID: string; operationID?: string }): Promise<unknown>
}

export interface ProjectSourceRuntimeAccess {
  list(): Promise<unknown>
  read(
    sourceID: string,
    range?: { offset: number; length: number },
  ): Promise<{
    source: {
      id: string
      name: string
      kind: 'text' | 'image'
    }
    data: Uint8Array
    mediaType: string
    range: {
      offset: number
      length: number
      total: number
    }
  }>
}

export interface AgentRuntimeRequest {
  threadID: string
  turnID: string
  agentID: string
  sessionID: string
  profile?: SubagentProfile
  depth?: number
  collaborationMessages?: () => Array<{
    id: string
    kind: string
    message: string
    created_at: number
  }>
  delegation?: DelegationController
  content: string
  taskMode: TaskMode
  fallbackModel: ModelRef
  permissionConfig: PermissionConfig
  signal: AbortSignal
  workspace: WorkspaceService
  defaultCwd?: string
  resume?: PlanCheckpoint
  /** Durable gate acquired before starting a fresh runtime (for example Hook trust). */
  startupGateLeaseID?: string
  defaultModeRequestUserInput?: boolean
  delegationEnabled?: boolean
  collaborationEnabled?: boolean
  promptSections?: PromptSection[]
  skillService?: SkillService
  projectSources?: ProjectSourceRuntimeAccess
  allowedTools?: readonly string[]
  activeDeferredTools?: readonly string[]
  toolCatalog?: ToolCatalog
  onPromptComposed?: (bundle: PromptBundle, context: { budgetText: string }) => void | Promise<void>
  onUsage?: (usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    requests: number
  }) => void | Promise<void>
  onRuntimeReady?: () => void | Promise<void>
  resolveModel(fallback: ModelRef): Promise<{ ref: ModelRef; model: unknown }>
  pause(approval: PendingApproval): Promise<void>
  updatePlan?(input: ExecutionPlanInput, toolCallID: string): Promise<unknown>
  updateGoal?(status: 'complete' | 'blocked', toolCallID: string): Promise<unknown>
  /** Subagent-only safe-boundary control; main Chat steer does not use this callback. */
  checkSafeBoundary?: () => Promise<boolean>
  attachments?: Array<
    | { kind: 'text'; name: string; text: string }
    | { kind: 'image'; name: string; mediaType: string; base64: string }
  >
}

export type AgentRuntimeResult =
  | { status: 'completed'; output: string; result?: SubagentResult }
  | { status: 'paused'; output: string }

export interface AgentRuntime {
  run(request: AgentRuntimeRequest): Promise<AgentRuntimeResult>
  steer(threadID: string, content: string, images?: RuntimeImage[], inputID?: string): Promise<void>
  followUp(threadID: string, content: string): Promise<void>
  abort(threadID: string): Promise<void>
  compact(threadID: string, instructions?: string, promptText?: string): Promise<ContextCompaction>
  toolExposure(input: ToolExposureInput): ToolExposurePlan
  /** Capability summary for the discoverable scope; preview reuses the turn generation. */
  capabilityCatalog(input: ToolExposureInput, toolCatalog?: ToolCatalog): PromptSection
  clearTurnPermissionGrants(threadID: string, turnID: string): void
  dispose(): Promise<void>
}

export function isMainAgentRequestUserInputEnabled(
  request: Pick<AgentRuntimeRequest, 'taskMode' | 'defaultModeRequestUserInput'>,
) {
  return request.taskMode === 'plan' || request.defaultModeRequestUserInput === true
}
