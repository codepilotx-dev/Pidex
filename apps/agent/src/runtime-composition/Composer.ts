import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { Model } from '@earendil-works/pi-ai'
import { Model as ModelSchema } from '@pidex/model-schema'
import { AgentError, type PermissionConfig, type TaskMode } from '../Domain'
import { resolveEffectivePermissionConfig } from '../permission/EffectivePermissionConfig'
import {
  createToolExposurePlan,
  PI_LIFECYCLE_TOOLS,
  type ToolExposureInput,
} from '../tool/ToolExposurePlan'
import type { ToolExecutionContext } from '../tool/ToolExecutor'
import type { ToolCatalog } from '../tool/ToolRegistry'
import type { WorkspaceService } from '../workspace/WorkspaceService'
import type { PromptBundle } from '../prompt/Types'
import type { SkillService } from '../prompt/SkillService'
import type { ThinkingLevel } from '../orchestration/harness/AgentTypes'
import type {
  CompositionHashes,
  ContextBaseline,
  McpGenerationBinding,
  ResolvedModelSnapshot,
  RuntimeCapability,
  RuntimeCompositionBindings,
  RuntimeCompositionIdentity,
  RuntimeCompositionProfile,
  RuntimeCompositionSnapshot,
  RuntimeCompositionSnapshotV2,
  RuntimeWorkspaceScope,
  SerializableToolExposurePlan,
  SkillSnapshot,
  SkillSnapshotV2,
} from './Types'

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>()
  const walk = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object') return entry
    if (seen.has(entry as object)) return null
    seen.add(entry as object)
    if (Array.isArray(entry)) return entry.map(walk)
    const record = entry as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      next[key] = walk(record[key] ?? null)
    }
    return next
  }
  return JSON.stringify(walk(value))
}

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

const hashJson = (value: unknown) => sha256(stableStringify(value))

export interface RuntimeCompositionInput {
  turnID: string
  threadID: string
  profile: RuntimeCompositionProfile
  taskMode: TaskMode
  thinkingLevel?: ThinkingLevel
  model: Model<any>
  modelRef: ModelSchema.Ref
  toolCatalog: ToolCatalog
  workspace: WorkspaceService
  workspaceScope: RuntimeWorkspaceScope
  sessionEntryID: string | null
  skillService: SkillService
  mcpBinding: McpGenerationBinding
  effectivePermissionConfig: PermissionConfig
  toolContext: ToolExecutionContext
  defaultCwd?: string
  promptBundle: PromptBundle
  allowedTools?: readonly string[]
  /** Authoritative exposure plan; when provided the composer skips its own derivation. */
  exposurePlan?: SerializableToolExposurePlan
  /** Persist a newly referenced Skill (V2 only). Called after a successful read. */
  recordReferenced?(name: string, hash: string): void | Promise<void>
}

export interface ComposeRuntimeCompositionResult {
  snapshot: RuntimeCompositionSnapshot
  bindings: RuntimeCompositionBindings
}

const snapshotModel = (model: Model<any>, ref?: ModelSchema.Ref): ResolvedModelSnapshot => ({
  providerID: model.provider,
  id: model.id,
  variant: ref?.variant ? String(ref.variant) : null,
  contextWindow: Math.max(1, Math.trunc(Number(model.contextWindow) || 1)),
  capabilities: {
    tools: true,
    input: Array.isArray(model.input) ? model.input.map((value) => String(value)) : [],
    output: [],
  },
})

const workspaceHashFor = (workspace: RuntimeWorkspaceScope) =>
  hashJson({
    kind: workspace.kind,
    cwd: resolve(workspace.cwd),
    roots: workspace.roots.map((root) => resolve(root)).sort(),
    outputDirectory: workspace.outputDirectory ? resolve(workspace.outputDirectory) : null,
    instructionSources: [...workspace.instructionSources].sort(),
  })

const v1SkillsHashFor = (skills: SkillSnapshot) =>
  hashJson(
    skills.skills.map((skill) => ({
      name: skill.name,
      hash: skill.hash,
      path: skill.path,
    })),
  )

const v2SkillsHashFor = (referenced: SkillSnapshotV2['referenced']) =>
  hashJson(referenced.map((item) => ({ name: item.name, hash: item.hash })))

const mcpHashFor = (binding: McpGenerationBinding) =>
  hashJson({
    workspaceKey: binding.workspaceKey,
    bindingHash: binding.bindingHash,
    serverInstructions: binding.serverInstructions.map((s) => ({
      serverName: s.serverName,
      content: s.content,
    })),
  })

const toolsHashFor = (plan: SerializableToolExposurePlan) =>
  hashJson({
    eager: [...plan.eager].sort(),
    deferred: [...plan.deferred].sort(),
    exposed: [...plan.exposed].sort(),
  })

const promptHashFor = (bundle: PromptBundle) =>
  hashJson({
    instructions: bundle.instructions,
    contextItems: bundle.contextItems.map((item) => item.content),
    baseHash: bundle.baseHash,
    contextHash: bundle.contextHash,
    cacheKey: bundle.cacheKey,
  })

const permissionHashFor = (config: PermissionConfig) => hashJson(config)

const frozenMcpInstructions = (
  binding: McpGenerationBinding,
): readonly { serverName: string; content: string }[] =>
  binding.serverInstructions.map((item) => ({ ...item }))

export interface MpcToolIdentity {
  readonly sdkName: string
  readonly serverName: string
  readonly rawToolName: string
}

/**
 * Stable MCP generation binding from serialized MCP metadata. The hash covers
 * the server instructions the prompt embeds and the exposed MCP tool names, so
 * any MCP config change invalidates the frozen generation and fails resume.
 */
export const createMcpGenerationBinding = (
  workspaceKey: string,
  input: {
    serverInstructions: readonly { serverName: string; content: string }[]
    definitions: readonly MpcToolIdentity[]
  },
): McpGenerationBinding => {
  const serverInstructions = input.serverInstructions.map(({ serverName, content }) => ({
    serverName,
    content,
  }))
  const toolNames = [...input.definitions]
    .map((definition) => ({
      name: definition.sdkName,
      server: definition.serverName,
      rawName: definition.rawToolName,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    workspaceKey,
    bindingHash: hashJson({ serverInstructions, toolNames }),
    serverInstructions,
  }
}

export type RebindRuntimeCompositionInput = Pick<
  RuntimeCompositionInput,
  | 'model'
  | 'modelRef'
  | 'workspace'
  | 'workspaceScope'
  | 'skillService'
  | 'mcpBinding'
  | 'toolContext'
  | 'toolCatalog'
  | 'defaultCwd'
> & {
  /** Persist a newly referenced Skill (V2 only). Called after a successful read. */
  recordReferenced?(name: string, hash: string): void | Promise<void>
}

const createBindings = (
  input: Pick<
    RuntimeCompositionInput,
    | 'toolContext'
    | 'model'
    | 'modelRef'
    | 'workspace'
    | 'defaultCwd'
    | 'toolCatalog'
    | 'skillService'
  >,
  snapshot: RuntimeCompositionSnapshot,
  recordReferenced?: RebindRuntimeCompositionInput['recordReferenced'],
): RuntimeCompositionBindings => {
  let released = false
  const catalog = new Map<string, { name: string; hash: string }>(
    snapshot.version === 2
      ? snapshot.skills.catalog.map((skill) => [skill.name, skill])
      : snapshot.skills.skills.map((skill) => [skill.name, skill]),
  )
  const referenced = new Set(
    snapshot.version === 2 ? snapshot.skills.referenced.map((item) => item.name) : [],
  )
  return Object.freeze({
    toolContext: input.toolContext,
    model: input.model,
    modelRef: input.modelRef,
    workspace: input.workspace,
    ...(input.defaultCwd ? { defaultCwd: input.defaultCwd } : {}),
    toolCatalog: input.toolCatalog,
    skills: Object.freeze({
      list: () => (snapshot.version === 2 ? snapshot.skills.catalog : snapshot.skills.skills),
      documentRead: async (path: string, hash: string) => {
        const skill = await input.skillService.documentSkill(
          resolve(input.workspace.rootPath, path),
        )
        if (!skill) return undefined
        if (catalog.get(skill.name)?.hash !== hash) {
          throw new AgentError('SKILL_SNAPSHOT_STALE', 'Skill snapshot is stale', 409)
        }
        input.skillService.recordRead(skill.name, hash)
        if (snapshot.version === 2 && !referenced.has(skill.name)) {
          await recordReferenced?.(skill.name, hash)
          referenced.add(skill.name)
        }
        return { name: skill.name }
      },
      read: async (name: string) => {
        const frozen = catalog.get(name)
        if (!frozen) {
          throw new AgentError('SKILL_SNAPSHOT_STALE', `Skill ${name} 不在冻结快照中`, 409)
        }
        const current = input.skillService.list().find((skill) => skill.name === name)
        if (!current || current.hash !== frozen.hash) {
          throw new AgentError('SKILL_SNAPSHOT_STALE', 'Skill snapshot is stale', 409)
        }
        const loaded = await input.skillService.read(name)
        if (snapshot.version === 2 && !referenced.has(name)) {
          await recordReferenced?.(name, current.hash)
          referenced.add(name)
        }
        return loaded
      },
    }),
    release: async () => {
      if (released) return
      released = true
    },
  })
}

/**
 * Compose a fresh turn snapshot from the live inputs. Hashes are computed from
 * normalized inputs so that re-binding the same snapshot always yields the
 * same identity hash. Caller persists the snapshot before any provider
 * sampling round. Only credentials-free, serializable metadata is stored.
 */
export function composeRuntimeComposition(
  input: RuntimeCompositionInput,
): ComposeRuntimeCompositionResult {
  const effectivePermissionConfig = resolveEffectivePermissionConfig(
    input.taskMode,
    input.effectivePermissionConfig,
  )
  const exposureInput: ToolExposureInput = {
    taskMode: input.taskMode,
    sandboxMode: input.taskMode === 'plan' ? 'read-only' : effectivePermissionConfig.sandboxMode,
    approvalPolicy: effectivePermissionConfig.approvalPolicy,
    profile: input.profile,
    hasSkillService: true,
    hasProjectSources: false,
    defaultModeRequestUserInput: false,
    delegationEnabled: input.profile === 'main' && input.taskMode !== 'plan',
    ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
  }
  const exposurePlan: SerializableToolExposurePlan =
    input.exposurePlan ??
    (() => {
      const derived = createToolExposurePlan(input.toolCatalog, exposureInput)
      return {
        eager: [...derived.eager],
        deferred: [...derived.deferred],
        exposed: [...derived.exposed],
      }
    })()

  const promptBundle: PromptBundle = structuredClone(input.promptBundle)

  const liveCatalog = input.skillService.list()
  const referenced = input.skillService.referencedSkills()
  const skillSnapshot: SkillSnapshotV2 = {
    catalog: liveCatalog.map(({ name, description, origin, format, hash }) => ({
      name,
      description,
      origin,
      format,
      hash,
    })),
    referenced: referenced.map(({ name, hash }) => ({ name, hash })),
  }

  const frozenMcp = {
    workspaceKey: input.mcpBinding.workspaceKey,
    bindingHash: input.mcpBinding.bindingHash,
    serverInstructions: frozenMcpInstructions(input.mcpBinding),
  }

  const compositionID = `rc:${input.turnID}`
  // Stable, credential-free identity: only model scalars, the thinking level and
  // the resolved variant participate. Provider objects, credentials, headers,
  // metadata and tool contexts are never hashed or serialized.
  const modelHash = hashJson({
    provider: input.model.provider,
    id: input.model.id,
    api: input.model.api,
    contextWindow: input.model.contextWindow,
    thinkingLevel: input.thinkingLevel ?? null,
    variant: input.modelRef?.variant ? String(input.modelRef.variant) : null,
  })
  const permissionHash = permissionHashFor(effectivePermissionConfig)
  const workspaceHash = workspaceHashFor(input.workspaceScope)
  const skillsHash = v2SkillsHashFor(skillSnapshot.referenced)
  const mcpHash = mcpHashFor(frozenMcp)
  const toolsHash = toolsHashFor(exposurePlan)
  const promptHash = promptHashFor(promptBundle)
  const contextHash = hashJson({
    threadsActiveTurnID: input.threadID,
    sessionEntryID: input.sessionEntryID,
  })
  const overall = sha256(
    [
      compositionID,
      modelHash,
      permissionHash,
      workspaceHash,
      skillsHash,
      mcpHash,
      toolsHash,
      promptHash,
      contextHash,
    ].join('\0'),
  )

  const hashes: CompositionHashes = {
    modelHash,
    permissionHash,
    workspaceHash,
    skillsHash,
    mcpHash,
    toolsHash,
    promptHash,
    contextHash,
    overall,
  }

  const identity: RuntimeCompositionIdentity = {
    id: compositionID,
    version: 2,
    hash: overall,
  }

  const serializablePlan: SerializableToolExposurePlan = exposurePlan

  const baseline: ContextBaseline = {
    threadsActiveTurnID: input.threadID,
    sessionEntryID: input.sessionEntryID,
  }

  const capabilities: readonly RuntimeCapability[] = [
    { id: 'harness.turn-composition.v1', version: 1 },
    { id: 'agent.runtime-composition.v2', version: 2 },
  ]

  const snapshot: RuntimeCompositionSnapshotV2 = {
    version: 2,
    identity,
    model: snapshotModel(input.model, input.modelRef),
    workspace: input.workspaceScope,
    permissions: effectivePermissionConfig,
    skills: skillSnapshot,
    mcp: frozenMcp,
    tools: serializablePlan,
    prompt: promptBundle,
    context: baseline,
    capabilities,
    hashes,
  }

  return {
    snapshot,
    bindings: createBindings(input, snapshot, input.recordReferenced),
  }
}

const skillReferencesValid = (
  snapshot: RuntimeCompositionSnapshot,
  skillService: SkillService,
): string | null => {
  if (snapshot.version === 2) {
    const current = new Map(skillService.list().map((skill) => [skill.name, skill.hash]))
    for (const item of snapshot.skills.referenced) {
      if (current.get(item.name) !== item.hash) {
        return `Frozen Skill ${item.name} 已变化或缺失`
      }
    }
    return null
  }
  const current: SkillSnapshot = {
    skills: skillService.list().map((skill) => ({
      name: skill.name,
      description: skill.description,
      origin: skill.origin,
      format: skill.format,
      hash: skill.hash,
      path: skill.path,
    })),
  }
  return v1SkillsHashFor(current) === snapshot.hashes.skillsHash
    ? null
    : 'Frozen Skills catalog 已变化'
}

/** Rebind live handlers from a persisted snapshot without recomposing prompt, policy or exposure. */
export function rebindRuntimeComposition(
  snapshot: RuntimeCompositionSnapshot,
  input: RebindRuntimeCompositionInput,
): RuntimeCompositionBindings {
  const currentModel = snapshotModel(input.model, input.modelRef)
  if (
    currentModel.providerID !== snapshot.model.providerID ||
    currentModel.id !== snapshot.model.id ||
    currentModel.variant !== snapshot.model.variant ||
    currentModel.contextWindow !== snapshot.model.contextWindow ||
    stableStringify(currentModel.capabilities) !== stableStringify(snapshot.model.capabilities)
  )
    throw new AgentError('RUNTIME_COMPOSITION_UNAVAILABLE', 'Frozen model is unavailable', 409)
  if (workspaceHashFor(input.workspaceScope) !== snapshot.hashes.workspaceHash) {
    throw new AgentError('RUNTIME_COMPOSITION_UNAVAILABLE', 'Frozen workspace is unavailable', 409)
  }
  const skillReason = skillReferencesValid(snapshot, input.skillService)
  if (skillReason) {
    throw new AgentError('RUNTIME_COMPOSITION_UNAVAILABLE', skillReason, 409)
  }
  if (input.mcpBinding.bindingHash !== snapshot.mcp.bindingHash) {
    throw new AgentError(
      'RUNTIME_COMPOSITION_UNAVAILABLE',
      'Frozen MCP binding is unavailable',
      409,
    )
  }
  if (promptHashFor(snapshot.prompt) !== snapshot.hashes.promptHash) {
    throw new AgentError(
      'RUNTIME_COMPOSITION_UNAVAILABLE',
      'Frozen prompt failed verification',
      409,
    )
  }
  // 动态生命周期工具由运行时按 turn 快照绑定，不来自普通 toolCatalog；恢复时
  // 必须与真正普通工具的 fail-closed 校验区分开，否则 Plan 恢复会误判不可用。
  // 复用曝光层的单一来源，避免新增生命周期工具时两边清单各自漂移。
  const lifecycle = new Set<string>(PI_LIFECYCLE_TOOLS)
  for (const name of new Set([...snapshot.tools.exposed, ...snapshot.tools.deferred])) {
    if (lifecycle.has(name)) continue
    try {
      input.toolCatalog.get(name)
    } catch {
      throw new AgentError(
        'RUNTIME_COMPOSITION_UNAVAILABLE',
        'Frozen tool catalog is unavailable',
        409,
      )
    }
  }
  return createBindings(input, snapshot, input.recordReferenced)
}
