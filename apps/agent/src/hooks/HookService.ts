import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import { AgentError, type EventEnvelope } from '../Domain'
import type { ConfigObject, ConfigService } from '../config/ConfigService'

export type HookEvent =
  | 'session_start'
  | 'session_resume'
  | 'user_prompt_submit'
  | 'pre_tool_use'
  | 'permission_request'
  | 'post_tool_use'
  | 'post_tool_error'
  | 'pre_compact'
  | 'stop'
export type HookDecision = 'continue' | 'ask' | 'deny'

export type HookDefinition = {
  id: string
  event: HookEvent
  command: string
  matcher?: string
  timeoutMs?: number
}

export type HookResult = {
  decision: HookDecision
  reason?: string
  suggestions?: string[]
  narrowedInput?: Record<string, unknown>
}

export interface HookToolRunner {
  run(input: {
    hookID: string
    command: string
    timeoutMs: number
    evidence: string
    threadID?: string
    turnID?: string
    toolCallID?: string
  }): Promise<{ output: string }>
}

export type HookScrubber = (value: string) => string
export type HookRunContext = {
  threadID?: string
  turnID?: string
  toolCallID?: string
  toolName?: string
  workspaceRoot?: string
}
type HookConfiguration = {
  hooks: readonly HookDefinition[]
  userHooks: readonly HookDefinition[]
  projectHooks: readonly HookDefinition[]
  workspaceRoot: string | null
  configPath: string | null
  configHash: string | null
}
const MAX_CONFIG_BYTES = 256 * 1024
const MAX_OUTPUT_CHARS = 64 * 1024
const EVENTS = new Set<HookEvent>([
  'session_start',
  'session_resume',
  'user_prompt_submit',
  'pre_tool_use',
  'permission_request',
  'post_tool_use',
  'post_tool_error',
  'pre_compact',
  'stop',
])

const contained = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const parseDefinitions = (hooks: unknown, source: string) => {
  if (!Array.isArray(hooks)) throw new Error(`Hook 配置必须包含 hooks 数组: ${source}`)
  return hooks.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`Hook #${index + 1} 无效`)
    const hook = value as Record<string, unknown>
    if (typeof hook.id !== 'string' || !hook.id.trim())
      throw new Error(`Hook #${index + 1} 缺少 id`)
    if (typeof hook.event !== 'string' || !EVENTS.has(hook.event as HookEvent))
      throw new Error(`Hook ${hook.id} event 无效`)
    if (typeof hook.command !== 'string' || !hook.command.trim())
      throw new Error(`Hook ${hook.id} 缺少 command`)
    if (
      hook.timeoutMs !== undefined &&
      (typeof hook.timeoutMs !== 'number' ||
        !Number.isFinite(hook.timeoutMs) ||
        hook.timeoutMs <= 0 ||
        hook.timeoutMs > 60_000)
    )
      throw new Error(`Hook ${hook.id} timeoutMs 必须在 1..60000`)
    if (hook.matcher !== undefined && typeof hook.matcher !== 'string')
      throw new Error(`Hook ${hook.id} matcher 无效`)
    return {
      id: hook.id,
      event: hook.event as HookEvent,
      command: hook.command,
      ...(typeof hook.matcher === 'string' ? { matcher: hook.matcher } : {}),
      ...(typeof hook.timeoutMs === 'number' ? { timeoutMs: hook.timeoutMs } : {}),
    }
  })
}

const inlineHooks = (config: ConfigObject, source: string) => {
  const hooks = config.hooks
  if (!hooks) return []
  if (Array.isArray(hooks)) return parseDefinitions(hooks, source)
  if (typeof hooks !== 'object') throw new Error(`内联 Hook 配置无效: ${source}`)
  const table = hooks as Record<string, unknown>
  if (Array.isArray(table.config)) return parseDefinitions(table.config, source)
  const definitions = Object.entries(table).flatMap(([id, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? [{ id, ...(value as Record<string, unknown>) }]
      : [],
  )
  return parseDefinitions(definitions, source)
}

const readConfig = (path: string, containmentRoot?: string) => {
  const canonical = realpathSync(path)
  if (containmentRoot && !contained(realpathSync(containmentRoot), canonical))
    throw new Error(`Hook 配置逃出 workspace: ${path}`)
  const bytes = readFileSync(canonical)
  if (bytes.byteLength > MAX_CONFIG_BYTES)
    throw new Error(`Hook 配置超过 ${MAX_CONFIG_BYTES} bytes`)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const parsed = JSON.parse(text) as unknown
  const hooks = Array.isArray(parsed) ? parsed : (parsed as { hooks?: unknown })?.hooks
  const definitions = parseDefinitions(hooks, path)
  return { definitions, canonical, hash: createHash('sha256').update(bytes).digest('hex') }
}

const parseResult = (output: string): HookResult => {
  const value = JSON.parse(output) as Record<string, unknown>
  if (!value || !['continue', 'ask', 'deny'].includes(String(value.decision)))
    throw new Error('Hook 输出缺少有效 decision')
  if (
    value.narrowedInput !== undefined &&
    (!value.narrowedInput ||
      typeof value.narrowedInput !== 'object' ||
      Array.isArray(value.narrowedInput))
  )
    throw new Error('Hook narrowedInput 无效')
  return {
    decision: value.decision as HookDecision,
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(Array.isArray(value.suggestions)
      ? {
          suggestions: value.suggestions
            .filter((item): item is string => typeof item === 'string')
            .slice(0, 20),
        }
      : {}),
    ...(value.narrowedInput
      ? { narrowedInput: value.narrowedInput as Record<string, unknown> }
      : {}),
  }
}

const isNarrowing = (original: unknown, narrowed: unknown): boolean => {
  if (Array.isArray(narrowed))
    return (
      Array.isArray(original) &&
      narrowed.every((item) =>
        original.some((candidate) => JSON.stringify(candidate) === JSON.stringify(item)),
      )
    )
  if (narrowed && typeof narrowed === 'object') {
    if (!original || typeof original !== 'object' || Array.isArray(original)) return false
    return Object.entries(narrowed as Record<string, unknown>).every(
      ([key, value]) =>
        key in (original as Record<string, unknown>) &&
        isNarrowing((original as Record<string, unknown>)[key], value),
    )
  }
  if (typeof narrowed === 'number' && typeof original === 'number') return narrowed <= original
  return Object.is(original, narrowed)
}

export class HookService {
  private readonly configurations = new Map<string, HookConfiguration>()
  private readonly threadConfigurations = new Map<string, string>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly runner: HookToolRunner,
    private readonly scrub: HookScrubber = (value) => value,
    private readonly publishEvent?: (event: EventEnvelope) => Promise<void>,
    private readonly config?: ConfigService,
  ) {}

  load(input: { userConfigPath?: string; projectRoot?: string; includeProjectHooks?: boolean }) {
    const layers = this.config?.snapshotLayers(input.projectRoot) ?? []
    const userLayer = layers.find((layer) => layer.kind === 'user')
    const projectLayer = layers.find((layer) => layer.kind === 'project' && layer.trusted)
    const userHooks = [
      ...(input.userConfigPath && existsSync(input.userConfigPath)
        ? readConfig(input.userConfigPath).definitions
        : []),
      ...(userLayer ? inlineHooks(userLayer.config, userLayer.filePath ?? '用户 config.json') : []),
    ]
    const projectHooks: HookDefinition[] = []
    let projectConfig: ReturnType<typeof readConfig> | null = null
    if (input.projectRoot && input.includeProjectHooks !== false) {
      const configFile = resolve(input.projectRoot, '.pidex/hooks.json')
      if (existsSync(configFile)) {
        const loaded = readConfig(configFile, input.projectRoot)
        projectHooks.push(...loaded.definitions)
        projectConfig = loaded
      }
    }
    const projectInlineHooks =
      input.includeProjectHooks !== false && projectLayer
        ? inlineHooks(projectLayer.config, projectLayer.filePath ?? '项目 config.json')
        : []
    projectHooks.push(...projectInlineHooks)
    const combinedProjectHash = projectInlineHooks.length
      ? createHash('sha256')
          .update(`${projectConfig?.hash ?? ''}:${projectLayer?.version ?? ''}`)
          .digest('hex')
      : (projectConfig?.hash ?? null)
    const hooks = Object.freeze([...userHooks, ...projectHooks])
    const key = input.projectRoot
      ? `workspace:${realpathSync(input.projectRoot)}`
      : input.userConfigPath && existsSync(input.userConfigPath)
        ? `user:${realpathSync(input.userConfigPath)}`
        : 'default'
    this.configurations.set(key, {
      hooks,
      userHooks: Object.freeze([...userHooks]),
      projectHooks: Object.freeze([...projectHooks]),
      workspaceRoot: input.projectRoot ? realpathSync(input.projectRoot) : null,
      configPath: projectInlineHooks.length
        ? (projectLayer?.filePath ?? null)
        : (projectConfig?.canonical ?? null),
      configHash: combinedProjectHash,
    })
    return hooks.slice()
  }

  definitions(workspaceRoot?: string) {
    if (workspaceRoot)
      return [...(this.configurations.get(`workspace:${realpathSync(workspaceRoot)}`)?.hooks ?? [])]
    if (this.configurations.size === 1) return [...this.configurations.values()][0]!.hooks.slice()
    return []
  }

  private hooksFor(evidence: unknown, context: HookRunContext) {
    const evidenceWorkspace =
      evidence &&
      typeof evidence === 'object' &&
      'workspace' in evidence &&
      typeof (evidence as { workspace?: unknown }).workspace === 'string'
        ? (evidence as { workspace: string }).workspace
        : undefined
    const workspaceRoot = context.workspaceRoot ?? evidenceWorkspace
    if (workspaceRoot) {
      const key = `workspace:${realpathSync(workspaceRoot)}`
      if (context.threadID) this.threadConfigurations.set(context.threadID, key)
      return this.configurations.get(key) ?? null
    }
    const threadKey = context.threadID ? this.threadConfigurations.get(context.threadID) : undefined
    if (threadKey) return this.configurations.get(threadKey) ?? null
    if (this.configurations.size === 1) return [...this.configurations.values()][0]!
    return null
  }

  async run(event: HookEvent, evidence: unknown, context: HookRunContext = {}) {
    // Capture an immutable workspace snapshot before the first await so
    // concurrent projects cannot replace one another's active hook set.
    const configuration = this.hooksFor(evidence, context)
    if (!configuration) return []
    const results: Array<{ hook: HookDefinition; result: HookResult }> = []
    const execute = async (hooks: readonly HookDefinition[]) => {
      for (const hook of hooks) {
        const id = crypto.randomUUID()
        const startedAt = Date.now()
        const safeEvidence = this.scrub(JSON.stringify(evidence)).slice(0, MAX_OUTPUT_CHARS)
        this.db.sqlite
          .query(
            "INSERT INTO hook_runs (id, thread_id, turn_id, tool_call_id, event, hook_id, status, input, command, cwd, evidence_summary, started_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)",
          )
          .run(
            id,
            context.threadID ?? null,
            context.turnID ?? null,
            context.toolCallID ?? null,
            event,
            hook.id,
            safeEvidence,
            this.scrub(hook.command).slice(0, 4_000),
            configuration.workspaceRoot,
            safeEvidence.slice(0, 2_000),
            startedAt,
          )
        try {
          // The injected runner must route this command through the normal ToolExecutor.
          const execution = await this.runner.run({
            hookID: hook.id,
            command: hook.command,
            timeoutMs: Math.min(60_000, hook.timeoutMs ?? 10_000),
            evidence: safeEvidence,
            ...context,
          })
          const scrubbed = this.scrub(execution.output).slice(0, MAX_OUTPUT_CHARS)
          const result = parseResult(scrubbed)
          if (result.narrowedInput) {
            const originalInput =
              evidence && typeof evidence === 'object' && 'input' in evidence
                ? (evidence as { input: unknown }).input
                : evidence
            if (!isNarrowing(originalInput, result.narrowedInput))
              throw new Error('Hook 试图扩大或替换 tool input scope')
          }
          this.db.sqlite
            .query(
              "UPDATE hook_runs SET status = 'completed', output = ?, finished_at = ? WHERE id = ?",
            )
            .run(JSON.stringify(result), Date.now(), id)
          results.push({ hook, result })
        } catch (cause) {
          const error = this.scrub(cause instanceof Error ? cause.message : String(cause)).slice(
            0,
            4_000,
          )
          this.db.sqlite
            .query(
              "UPDATE hook_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
            )
            .run(error, Date.now(), id)
          throw new Error(`Hook ${hook.id} 执行失败: ${error}`)
        }
      }
    }
    const matches = (hook: HookDefinition) =>
      hook.event === event &&
      (!hook.matcher || hook.matcher === '*' || hook.matcher === context.toolName)
    await execute(configuration.userHooks.filter(matches))
    const projectHooks = configuration.projectHooks.filter(matches)
    if (!projectHooks.length) return results
    if (configuration.workspaceRoot && configuration.configPath && configuration.configHash) {
      const trust = this.db.hookTrustDecision(configuration.workspaceRoot, configuration.configHash)
      if (trust === 'block') return results
      if (trust !== 'allow') {
        const auditSummary = {
          cwd: configuration.workspaceRoot,
          configPath: configuration.configPath,
          configHash: configuration.configHash,
          hooks: configuration.projectHooks.map((hook) => ({
            id: hook.id,
            event: hook.event,
            command: this.scrub(hook.command).slice(0, 2_000),
          })),
        }
        const pending = this.db.ensureHookTrustRequest({
          threadID: context.threadID ?? null,
          turnID: context.turnID ?? null,
          workspacePath: configuration.workspaceRoot,
          configPath: configuration.configPath,
          configHash: configuration.configHash,
          auditSummary,
        })
        if (pending.event && this.publishEvent) await this.publishEvent(pending.event)
        throw new AgentError(
          'HOOK_TRUST_REQUIRED',
          '项目 Hook 配置尚未获得信任，用户 Hook 已执行，项目 Hook 未执行',
          409,
          { request: pending.request },
        )
      }
    }
    await execute(projectHooks)
    return results
  }
}
