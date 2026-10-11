import { z, type ZodType } from 'zod'
import {
  AgentError,
  type SubagentProfile,
  type TaskMode,
  type ToolAuthorizationScope,
  type ToolInvocation,
} from '../Domain'
import { WorkspaceService, type WorkspaceFileRevision } from '../workspace/WorkspaceService'
import type { PermissionConfig, SandboxMode } from '@pidex/shared/thread'
import type { Model } from '@pidex/model-schema'
import type { ToolExecutionMode as PiToolExecutionMode } from '../orchestration/harness/AgentTypes'
import type { Tool as PiAiTool } from '@earendil-works/pi-ai'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  resolveManagedTool,
  runToolProcess,
  type ToolingResolver,
  type ToolProcessRunner,
} from './ToolingRuntime'
import { nativeGlobWorkspace, nativeGrepWorkspace } from './NativeWorkspaceSearch'
import { applyEditsText } from './Edit/ApplyEditText'
import { subagentToolDefinitions } from '../subagent/ToolDefinitions'
import { applyPatchDefinition } from './ApplyPatch/Definition'
import type { TurnPatchMutationFile } from '../patch/TurnPatchTypes'
import { diffLines } from 'diff'
import type { FileAccessProfile } from '../permission/ExecutionPolicy'
import { fileAccessProfileFromV4 } from '../permission/ExecutionPolicy'

export type ToolCapabilities = {
  filesystem: 'none' | 'read' | 'workspace-write' | 'host-write'
  network: 'none' | 'declared' | 'unrestricted'
  process: boolean
  externalState: boolean
  userInteraction: boolean
}

export type ApprovalStrategy = 'policy' | 'always-review' | 'never-review'
export type ToolVisibility = 'eager' | 'deferred' | 'internal'
export type ToolExecutionMode = PiToolExecutionMode
export type ToolProgress = {
  message: string
  completed?: number
  total?: number
  details?: unknown
}
export type ToolStructuredResult = {
  images?: Array<{ type: 'image'; data: string; mimeType: string }>
  content: string
  details: unknown
  addedToolNames?: string[]
}
export type PromptFactory = string | ((context: ToolContext) => string)
export type { ToolAffectedPath, ToolAuthorizationScope, ToolReviewSummary } from '../Domain'
export type ToolFileSnapshots = {
  get(path: string): Promise<WorkspaceFileRevision | undefined>
  set(path: string, revision: WorkspaceFileRevision): Promise<void>
  invalidate(paths: readonly string[]): Promise<void>
}
export type ToolInputInspection = {
  permissionFacts?: ToolInvocation['permissionFacts']
  grantsForbidden?: boolean
  fileDiffs?: ToolInvocation['fileDiffs']
  authorizationScope: ToolAuthorizationScope
  configWrites?: readonly {
    path: string
    content: string
    scope: 'user' | 'project'
  }[]
}
export type ToolOrigin =
  | { kind: 'builtin' }
  | {
      kind: 'mcp'
      serverName: string
      rawToolName: string
      generation: number
    }

export interface ToolCatalogEntry<Input = unknown, Output = unknown> {
  /** The sole canonical name exposed to the model. */
  available?: () => boolean
  sdkName: string
  /** Internal execution name. It is never exposed to the model. */
  name?: string
  schema: ZodType<Input>
  description: PromptFactory
  capabilities: ToolCapabilities
  allowedModes: readonly TaskMode[]
  allowedProfiles: readonly SubagentProfile[]
  approvalStrategy: ApprovalStrategy
  visibility: ToolVisibility
  executionMode: ToolExecutionMode
  inputSchema: Record<string, unknown>
  /** Normalizes provider-specific argument encodings before schema validation. */
  prepareArguments?: (input: unknown) => unknown
  /** Optional provider-side constrained sampling configuration. */
  constrainedSampling?: PiAiTool['constrainedSampling']
  /** Structured provenance used by permission and routing decisions. */
  origin?: ToolOrigin
  /** Host-only inspection performed before hooks, review, or execution. */
  inspectInput?: (
    input: Input,
    context: ToolContext,
  ) => ToolInputInspection | Promise<ToolInputInspection>
  progress?: (input: Input, context: ToolContext) => ToolProgress | undefined
  auditResult?: (output: Output) => unknown
  formatResult?: (output: Output, context: ToolContext) => ToolStructuredResult
}

export interface ToolContext {
  subagentLifecycle?: (name: string, input: Record<string, unknown>) => Promise<unknown>
  signal: AbortSignal
  taskMode: TaskMode
  profile?: SubagentProfile
  workspace: WorkspaceService
  permissionConfig: PermissionConfig
  model: Model.Ref
  onProgress?: (progress: ToolProgress) => void
  deferredTools?: readonly ToolCatalogEntry[]
  readSnapshot?: { mtimeMs: number; sha256: string }
  fileSnapshots?: ToolFileSnapshots
  /** Host-inspected scope for the exact input being executed. */
  computerGrant?: 'chat' | 'persistent'
  authorizationScope?: ToolAuthorizationScope
  fileSaved?: (input: { filePath: string; content: string }) => Promise<void>
  /** Persists host-only reversible evidence after a successful managed file mutation. */
  recordMutation?: (files: readonly TurnPatchMutationFile[]) => Promise<void>
  resolveTooling?: ToolingResolver
  runToolProcess?: ToolProcessRunner
  /** Host-owned identity for this invocation. It is never derived from model input. */
  invocation?: Readonly<{
    threadID: string
    turnID: string
    agentID: string
    toolCallID: string
  }>
}

export interface ToolDefinition<Input = unknown, Output = unknown> extends ToolCatalogEntry<
  Input,
  Output
> {
  execute(input: Input, context: ToolContext): Promise<Output>
}

const allModes = ['chat', 'plan'] as const
const allProfiles = ['main', 'default', 'explorer', 'worker'] as const
const noCapabilities = (): ToolCapabilities => ({
  filesystem: 'none',
  network: 'none',
  process: false,
  externalState: false,
  userInteraction: false,
})
const jsonObject = (properties: Record<string, unknown>, required?: string[]) => ({
  type: 'object',
  properties,
  additionalProperties: false,
  ...(required ? { required } : {}),
})
const editOperationSchema = z
  .object({
    oldText: z.string().min(1),
    newText: z.string(),
  })
  .strict()
const editInputSchema = z
  .object({
    path: z.string().min(1),
    edits: z.array(editOperationSchema).min(1),
  })
  .strict()
const normalizePiEditInput = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const edits = (input as Record<string, unknown>).edits
  if (typeof edits !== 'string') return input
  try {
    return { ...input, edits: JSON.parse(edits) }
  } catch {
    return input
  }
}
const shellSchema = z
  .object({
    command: z.string().min(1).max(32_000),
    cwd: z.string().min(1).optional(),
    timeout: z.number().positive().max(600_000).optional(),
    description: z.string().max(2_000).optional(),
    additionalPermissions: z
      .object({
        readPaths: z.array(z.string().min(1)).optional(),
        writePaths: z.array(z.string().min(1)).optional(),
        networkDomains: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
const shellInputSchema = jsonObject(
  {
    command: { type: 'string', maxLength: 32_000 },
    cwd: { type: 'string' },
    timeout: { type: 'number', maximum: 600_000 },
    description: { type: 'string', maxLength: 2_000 },
    additionalPermissions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        readPaths: { type: 'array', items: { type: 'string' } },
        writePaths: { type: 'array', items: { type: 'string' } },
        networkDomains: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  ['command'],
)

const searchPaths = async (context: ToolContext, value?: string) => {
  if (!value?.trim()) {
    return context.workspace.roots.map((root) => ({
      root,
      target: '.',
      nativeTarget: root === context.workspace.rootPath ? '.' : root,
    }))
  }
  const requested = value.trim()
  if (!isAbsolute(requested) && requested.split(/[\\/]+/).includes('..')) {
    throw new AgentError('WORKSPACE_PATH_DENIED', '搜索路径不得通过 .. 越出工作区', 403)
  }
  const canonical = await context.workspace.resolveDirectory(requested)
  const owner = context.workspace.rootForPath(canonical)
  if (!owner) {
    // resolveDirectory already checks full access or this call's approved paths.
    return [
      { root: canonical, target: '.', nativeTarget: context.workspace.displayPath(canonical) },
    ]
  }
  const child = relative(owner.path, canonical)
  return [
    {
      root: owner.path,
      target: child ? child.replaceAll('\\', '/') : '.',
      nativeTarget: context.workspace.displayPath(canonical),
    },
  ]
}

const resolveRipgrep = async (context: ToolContext) => {
  const resolution = await (context.resolveTooling ?? resolveManagedTool)('ripgrep', {
    signal: context.signal,
  })
  if (!resolution.available && (resolution.code === 'TOOLING_ABORTED' || context.signal.aborted)) {
    throw new AgentError('RUN_ABORTED', '任务已停止', 499)
  }
  return resolution
}

const ripgrep = async (
  context: ToolContext,
  executable: string,
  args: readonly string[],
  cwd = context.workspace.rootPath,
) => {
  const result = await (context.runToolProcess ?? runToolProcess)({
    executable,
    args,
    cwd,
    signal: context.signal,
    timeoutMs: 10_000,
    maxOutputBytes: 8 * 1024 * 1024,
  })
  if (result.exitCode !== 0 && result.exitCode !== 1)
    throw new AgentError(
      'WORKSPACE_SEARCH_FAILED',
      result.stderr || `ripgrep 退出码 ${result.exitCode}`,
      400,
    )
  return result
}

type RgEvent = {
  type?: string
  data?: {
    path?: { text?: string }
    lines?: { text?: string }
    line_number?: number | null
    submatches?: unknown[]
  }
}

const grepWorkspace = async (input: any, context: ToolContext) => {
  const targets = await searchPaths(context, input.path)
  const resolution = await resolveRipgrep(context)
  if (!resolution.available) {
    const results = await Promise.all(
      targets.map((target) =>
        nativeGrepWorkspace(
          { ...input, offset: 0, head_limit: 1_000 },
          context,
          target.nativeTarget,
        ),
      ),
    )
    const offset = input.offset ?? 0
    const limit = input.head_limit ?? 200
    if (input.output_mode === 'files_with_matches') {
      const files = results.flatMap((result) => ('files' in result ? result.files : []))
      return {
        files: files.slice(offset, offset + limit),
        truncated: results.some((result) => result.truncated) || files.length > offset + limit,
        engine: 'native-fallback' as const,
      }
    }
    if (input.output_mode === 'count') {
      const counts = results.flatMap((result) => ('counts' in result ? result.counts : []))
      return {
        counts: counts.slice(offset, offset + limit),
        truncated: results.some((result) => result.truncated) || counts.length > offset + limit,
        engine: 'native-fallback' as const,
      }
    }
    const matches = results.flatMap((result) => ('matches' in result ? result.matches : []))
    return {
      matches: matches.slice(offset, offset + limit),
      truncated: results.some((result) => result.truncated) || matches.length > offset + limit,
      engine: 'native-fallback' as const,
    }
  }
  const before = input['-B'] ?? input['-C'] ?? input.context ?? 0
  const after = input['-A'] ?? input['-C'] ?? input.context ?? 0
  const args = ['--json', '--color', 'never', '--no-messages', '--sort', 'path']
  if (input['-i']) args.push('--ignore-case')
  if (input.multiline) args.push('--multiline', '--multiline-dotall')
  if (before) args.push('--before-context', String(before))
  if (after) args.push('--after-context', String(after))
  if (input.glob) args.push('--glob', input.glob)
  if (input.type) args.push('--type', input.type)
  const matches: Array<{
    path: string
    line?: number
    text: string
    before?: string[]
    after?: string[]
  }> = []
  const counts = new Map<string, number>()
  const contexts = new Map<string, Map<number, string>>()
  const searches = await Promise.all(
    targets.map(async (target) => ({
      target,
      result: await ripgrep(
        context,
        resolution.path,
        [...args, '--', input.pattern, target.target],
        target.root,
      ),
    })),
  )
  for (const { target, result } of searches) {
    for (const raw of result.stdout.toString('utf8').split(/\r?\n/)) {
      if (!raw) continue
      let event: RgEvent
      try {
        event = JSON.parse(raw) as RgEvent
      } catch {
        throw new AgentError('WORKSPACE_SEARCH_INVALID_OUTPUT', 'ripgrep 返回了无法解析的输出', 502)
      }
      const rawPath = event.data?.path?.text
      const path = rawPath
        ? context.workspace.displayPath(
            isAbsolute(rawPath) ? resolve(rawPath) : resolve(target.root, rawPath),
          )
        : undefined
      const text = event.data?.lines?.text?.replace(/\r?\n$/, '')
      const line = event.data?.line_number ?? undefined
      if (!path || text === undefined || line === undefined) continue
      if (event.type === 'context') {
        const byLine = contexts.get(path) ?? new Map<number, string>()
        byLine.set(line, text)
        contexts.set(path, byLine)
      } else if (event.type === 'match') {
        const occurrences = Math.max(1, event.data?.submatches?.length ?? 1)
        counts.set(path, (counts.get(path) ?? 0) + occurrences)
        for (let index = 0; index < occurrences; index += 1)
          matches.push({
            path,
            ...(input['-n'] === false ? {} : { line }),
            text: text.slice(0, 8_000),
          })
      }
    }
  }
  for (const match of matches) {
    if (match.line === undefined) continue
    const byLine = contexts.get(match.path)
    const prior = Array.from({ length: before }, (_, index) =>
      byLine?.get(match.line! - before + index),
    ).filter((line): line is string => line !== undefined)
    const following = Array.from({ length: after }, (_, index) =>
      byLine?.get(match.line! + index + 1),
    ).filter((line): line is string => line !== undefined)
    if (prior.length) match.before = prior
    if (following.length) match.after = following
  }
  const offset = input.offset ?? 0
  const limit = input.head_limit ?? 200
  if (input.output_mode === 'files_with_matches') {
    const files = [...counts.keys()]
    return {
      files: files.slice(offset, offset + limit),
      truncated: files.length > offset + limit,
      engine: 'ripgrep' as const,
    }
  }
  if (input.output_mode === 'count') {
    const values = [...counts].map(([path, count]) => ({ path, count }))
    return {
      counts: values.slice(offset, offset + limit),
      truncated: values.length > offset + limit,
      engine: 'ripgrep' as const,
    }
  }
  return {
    matches: matches.slice(offset, offset + limit),
    truncated: matches.length > offset + limit,
    engine: 'ripgrep' as const,
  }
}

export const lineChangeSummary = (before: string, after: string) => {
  let additions = 0
  let deletions = 0
  for (const part of diffLines(before, after)) {
    if (part.added) additions += part.count ?? 0
    if (part.removed) deletions += part.count ?? 0
  }
  return { additions, deletions }
}

const requestPermissionsSchema = z
  .object({
    scope: z.enum(['tool-call', 'turn', 'session']),
    readPaths: z.array(z.string()).optional(),
    writePaths: z.array(z.string()).optional(),
    networkDomains: z.array(z.string()).optional(),
    escalationToken: z.string().uuid().optional(),
    justification: z.string().min(1),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      !input.escalationToken &&
      !input.readPaths?.length &&
      !input.writePaths?.length &&
      !input.networkDomains?.length
    ) {
      context.addIssue({
        code: 'custom',
        message: '至少需要申请一项路径、网络或 sandbox escalation 权限',
      })
    }
  })

export type RequestPermissionsInput = z.infer<typeof requestPermissionsSchema>

/**
 * Canonical contract of the permission-request tool. The Pi lifecycle adapter
 * binds this same description and argument schema, so the model always sees the
 * scope enum, the required justification and the requestable path fields.
 */
export const requestPermissionsDefinition: ToolDefinition<
  RequestPermissionsInput,
  RequestPermissionsInput & { granted: true }
> = {
  sdkName: 'request_permissions',
  name: 'request_permissions',
  description: [
    '为下一次工具调用、当前 turn 或当前运行会话请求临时权限，并等待用户或自动审核的决定。',
    '工作区外文件操作应先申请所需路径；授权不能覆盖敏感路径规则、Plan 或显式只读根。never 策略下本工具不可用，需由用户调整审批设置。',
    '每条申请都必须给出 justification，并至少包含一项 readPaths、writePaths 或 networkDomains；没有可申请权限时不要调用本工具。',
  ].join('\n'),
  schema: requestPermissionsSchema,
  inputSchema: jsonObject(
    {
      scope: {
        enum: ['tool-call', 'turn', 'session'],
        description: '临时权限的生效范围：仅下一次工具调用、当前 turn，或当前运行会话。',
      },
      readPaths: {
        type: 'array',
        items: { type: 'string' },
        description: '需要额外读取的绝对路径。完全访问模式下工作区外文件无需在此申请。',
      },
      writePaths: {
        type: 'array',
        items: { type: 'string' },
        description: '需要额外写入的绝对路径。完全访问模式下工作区外文件无需在此申请。',
      },
      networkDomains: {
        type: 'array',
        items: { type: 'string' },
        description:
          '需要 Shell 访问的域名，例如 npmjs.org；这是完全访问模式下仍然需要审批的主要能力。',
      },
      escalationToken: { type: 'string', format: 'uuid' },
      justification: {
        type: 'string',
        description: '必填。向用户说明为什么当前任务需要这些权限。',
      },
    },
    ['scope', 'justification'],
  ),
  capabilities: { ...noCapabilities(), userInteraction: true },
  allowedModes: allModes,
  allowedProfiles: allProfiles,
  approvalStrategy: 'always-review',
  visibility: 'internal',
  executionMode: 'sequential',
  execute: async (input) => ({ granted: true, ...input }),
}

/** Model-facing summary used by the capability catalog and ToolSearch results. */
export const toolCatalogSummary = (
  tool: Pick<ToolCatalogEntry, 'sdkName' | 'description' | 'origin'>,
): { name: string; description: string; source?: string } => ({
  name: tool.sdkName,
  description: typeof tool.description === 'string' ? tool.description : '',
  ...(tool.origin?.kind === 'mcp' ? { source: `mcp:${tool.origin.serverName}` } : {}),
})

/** Search matches the canonical name, the short description and the MCP server name. */
const toolSearchHaystack = (tool: Pick<ToolCatalogEntry, 'sdkName' | 'description' | 'origin'>) => {
  const summary = toolCatalogSummary(tool)
  return `${summary.name}\n${summary.description}\n${summary.source ?? ''}`.toLowerCase()
}

const builtinTools = (): ToolDefinition<any, any>[] => [
  {
    sdkName: 'Read',
    name: 'workspace.read',
    description:
      '读取工作区内的 UTF-8 文本文件，并保存完整快照供后续写入使用；完全访问模式下也直接读取工作区外的绝对路径。',
    schema: z
      .object({
        file_path: z.string().min(1),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(10_000).optional(),
      })
      .strict(),
    inputSchema: jsonObject(
      {
        file_path: {
          type: 'string',
          description:
            '已确认存在的工作区 UTF-8 文本文件路径；只接受文件，不接受目录或未经确认的猜测路径。',
        },
        offset: { type: 'number', minimum: 0 },
        limit: { type: 'number', minimum: 1, maximum: 10_000 },
      },
      ['file_path'],
    ),
    capabilities: { ...noCapabilities(), filesystem: 'read' },
    allowedModes: allModes,
    allowedProfiles: allProfiles,
    approvalStrategy: 'policy',
    visibility: 'eager',
    executionMode: 'parallel',
    progress: (input) => ({ message: `正在读取 ${input.file_path}` }),
    execute: async (input, context) => {
      const file = await context.workspace.readEditorFile(input.file_path)
      const offset = input.offset ?? 0
      const limit = input.limit ?? 400
      const lines = file.content.split(/\r?\n/)
      return {
        path: file.path,
        content: lines.slice(offset, offset + limit).join('\n'),
        offset,
        lineCount: lines.length,
        truncated: offset + limit < lines.length,
        sizeBytes: file.sizeBytes,
        snapshot: file.revision,
      }
    },
  },
  applyPatchDefinition,
  {
    sdkName: 'Write',
    name: 'workspace.write',
    description:
      '创建或完整覆写工作区文件。已有文件必须先 Read，快照由执行器自动维护。完全访问模式下也可创建或覆写工作区外的绝对路径。',
    schema: z.object({ file_path: z.string().min(1), content: z.string() }).strict(),
    inputSchema: jsonObject(
      {
        file_path: {
          type: 'string',
          description:
            '工作区文件路径；更新已有文件前必须先成功 Read 同一路径，创建新文件可直接写入。',
        },
        content: { type: 'string' },
      },
      ['file_path', 'content'],
    ),
    capabilities: { ...noCapabilities(), filesystem: 'workspace-write', externalState: true },
    allowedModes: ['chat'],
    allowedProfiles: ['main', 'default', 'worker'],
    approvalStrategy: 'policy',
    visibility: 'eager',
    executionMode: 'sequential',
    progress: (input) => ({ message: `正在写入 ${input.file_path}` }),
    execute: async (input, context) => {
      let current
      try {
        current = await context.workspace.readEditorFile(input.file_path)
      } catch (cause) {
        if (!(cause instanceof AgentError) || cause.code !== 'WORKSPACE_PATH_NOT_FOUND') throw cause
      }
      if (!current) {
        const created = await context.workspace.applyPatch({
          operation: 'create',
          path: input.file_path,
          content: input.content,
        })
        await context
          .recordMutation?.([
            {
              operation: 'create',
              path: created.path,
              beforeContent: null,
              afterContent: input.content.startsWith('\uFEFF')
                ? input.content.slice(1)
                : input.content,
              beforeSha256: null,
              afterSha256: created.afterSha256,
            },
          ])
          .catch(() => undefined)
        await context.fileSaved?.({ filePath: input.file_path, content: input.content })
        return {
          operation: 'write' as const,
          mutation: 'create' as const,
          path: created.path,
          additions: created.additions,
          deletions: created.deletions,
          beforeSha256: created.beforeSha256,
          afterSha256: created.afterSha256,
        }
      }
      if (
        !context.readSnapshot ||
        context.readSnapshot.sha256 !== current.revision.sha256 ||
        context.readSnapshot.mtimeMs !== current.revision.mtimeMs
      )
        throw new AgentError(
          'WORKSPACE_FILE_STALE',
          '文件内容已变化或缺少完整 Read 快照，拒绝覆写',
          409,
          { currentRevision: current.revision },
        )
      const saved = await context.workspace.saveEditorFile(
        input.file_path,
        input.content,
        context.readSnapshot,
      )
      if (saved.outcome === 'conflict')
        throw new AgentError('WORKSPACE_FILE_STALE', '文件在写入前发生变化，拒绝覆写', 409, {
          currentRevision: saved.revision,
        })
      await context
        .recordMutation?.([
          {
            operation: 'update',
            path: current.path,
            beforeContent: current.content,
            afterContent: input.content.startsWith('\uFEFF')
              ? input.content.slice(1)
              : input.content,
            beforeSha256: current.revision.sha256,
            afterSha256: saved.revision!.sha256,
          },
        ])
        .catch(() => undefined)
      await context.fileSaved?.({ filePath: current.path, content: input.content })
      const changes = lineChangeSummary(current.content, input.content)
      return {
        operation: 'write',
        mutation: 'update',
        path: current.path,
        ...changes,
        beforeSha256: current.revision.sha256,
        afterSha256: saved.revision!.sha256,
        revision: saved.revision!,
      }
    },
    formatResult: (output) => ({
      content: `已写入 ${output.path}（+${output.additions} -${output.deletions}）`,
      details: {
        operation: output.operation,
        mutation: output.mutation,
        path: output.path,
        additions: output.additions,
        deletions: output.deletions,
      },
    }),
  },
  {
    sdkName: 'Edit',
    name: 'workspace.edit',
    description:
      '对已 Read 的工作区文件执行一组精确且原子的文本编辑。每项 oldText 必须在原文件中唯一匹配，所有编辑均基于同一份原文定位；完全访问模式下同样适用于工作区外的绝对路径。',
    schema: editInputSchema,
    inputSchema: jsonObject(
      {
        path: {
          type: 'string',
          description: '已存在的工作区文件路径；必须先成功 Read 同一路径，并基于最新完整原文编辑。',
        },
        edits: {
          type: 'array',
          minItems: 1,
          description: '要原子应用的编辑列表；每项 oldText 必须包含足够上下文以保证唯一匹配。',
          items: jsonObject(
            {
              oldText: {
                type: 'string',
                minLength: 1,
                description: '文件中精确且唯一存在的原文。',
              },
              newText: {
                type: 'string',
                description: '用于替换 oldText 的新文本；空字符串表示删除。',
              },
            },
            ['oldText', 'newText'],
          ),
        },
      },
      ['path', 'edits'],
    ),
    prepareArguments: normalizePiEditInput,
    capabilities: { ...noCapabilities(), filesystem: 'workspace-write', externalState: true },
    allowedModes: ['chat'],
    allowedProfiles: ['main', 'default', 'worker'],
    approvalStrategy: 'policy',
    visibility: 'eager',
    executionMode: 'sequential',
    progress: (input) => ({
      message: `正在编辑 ${input.path}`,
      completed: 0,
      total: input.edits.length,
    }),
    execute: async (input, context) => {
      const current = await context.workspace.readEditorFile(input.path)
      if (
        !context.readSnapshot ||
        context.readSnapshot.sha256 !== current.revision.sha256 ||
        context.readSnapshot.mtimeMs !== current.revision.mtimeMs
      )
        throw new AgentError(
          'WORKSPACE_FILE_STALE',
          '文件内容已变化或缺少完整 Read 快照，拒绝编辑',
          409,
          { currentRevision: current.revision },
        )
      const content = applyEditsText(current.content, input.edits)
      const saved = await context.workspace.saveEditorFile(
        input.path,
        content,
        context.readSnapshot,
      )
      if (saved.outcome === 'conflict')
        throw new AgentError('WORKSPACE_FILE_STALE', '文件在编辑前发生变化，拒绝写入', 409, {
          currentRevision: saved.revision,
        })
      await context
        .recordMutation?.([
          {
            operation: 'update',
            path: current.path,
            beforeContent: current.content,
            afterContent: content,
            beforeSha256: current.revision.sha256,
            afterSha256: saved.revision!.sha256,
          },
        ])
        .catch(() => undefined)
      await context.fileSaved?.({ filePath: current.path, content })
      const changes = lineChangeSummary(current.content, content)
      return {
        operation: 'edit',
        path: current.path,
        ...changes,
        beforeSha256: current.revision.sha256,
        afterSha256: saved.revision!.sha256,
        revision: saved.revision!,
      }
    },
    formatResult: (output) => ({
      content: `已编辑 ${output.path}（+${output.additions} -${output.deletions}）`,
      details: {
        operation: output.operation,
        path: output.path,
        additions: output.additions,
        deletions: output.deletions,
      },
    }),
  },
  {
    sdkName: 'Glob',
    name: 'workspace.glob',
    description:
      '优先使用受管或本机 ripgrep 在工作区内按 glob 模式查找文件；无法获取 ripgrep 时使用有界原生搜索。path 默认为 .，优先传工作区相对路径，也接受工作区内绝对路径；完全访问模式下可搜索工作区外的绝对目录。',
    schema: z
      .object({
        pattern: z.string().min(1).max(1_000),
        path: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .strict(),
    inputSchema: jsonObject(
      {
        pattern: {
          type: 'string',
          maxLength: 1_000,
          description: '用于筛选文件名或相对路径的 glob 模式。',
        },
        path: {
          type: 'string',
          description: '可选的已存在工作区目录；不得传文件路径，文件筛选请写入 pattern。',
        },
        limit: { type: 'number', minimum: 1, maximum: 500 },
      },
      ['pattern'],
    ),
    capabilities: { ...noCapabilities(), filesystem: 'read', process: true },
    allowedModes: allModes,
    allowedProfiles: allProfiles,
    approvalStrategy: 'policy',
    visibility: 'eager',
    executionMode: 'parallel',
    progress: (input) => ({ message: `正在匹配 ${input.pattern}` }),
    execute: async (input, context) => {
      const targets = await searchPaths(context, input.path)
      const limit = input.limit ?? 200
      const resolution = await resolveRipgrep(context)
      if (!resolution.available) {
        const results = await Promise.all(
          targets.map((target) =>
            nativeGlobWorkspace({ ...input, limit: 500 }, context, target.nativeTarget),
          ),
        )
        const all = results
          .flatMap((result) => result.matches)
          .sort((left, right) => left.localeCompare(right))
        return {
          matches: all.slice(0, limit),
          truncated: results.some((result) => result.truncated) || all.length > limit,
          visited: results.reduce((sum, result) => sum + result.visited, 0),
          engine: 'native-fallback' as const,
        }
      }
      const all: string[] = []
      const searches = await Promise.all(
        targets.map(async (target) => ({
          target,
          result: await ripgrep(
            context,
            resolution.path,
            [
              '--files',
              '--null',
              '--color',
              'never',
              '--sort',
              'path',
              '--glob',
              input.pattern,
              '--',
              target.target,
            ],
            target.root,
          ),
        })),
      )
      for (const { target, result } of searches) {
        all.push(
          ...result.stdout
            .toString('utf8')
            .split('\0')
            .filter(Boolean)
            .map((path) =>
              context.workspace.displayPath(
                isAbsolute(path) ? resolve(path) : resolve(target.root, path),
              ),
            ),
        )
      }
      all.sort((left, right) => left.localeCompare(right))
      return {
        matches: all.slice(0, limit),
        truncated: all.length > limit,
        visited: all.length,
        engine: 'ripgrep' as const,
      }
    },
  },
  {
    sdkName: 'Grep',
    name: 'workspace.grep',
    description:
      '优先使用受管或本机 ripgrep 在工作区内执行有界正则搜索；无法获取 ripgrep 时使用有界原生搜索。path 默认为 .，优先传工作区相对路径，也接受工作区内绝对路径；支持文件过滤、上下文和多种输出模式，完全访问模式下可搜索工作区外的绝对目录。',
    schema: z
      .object({
        pattern: z.string().min(1).max(10_000),
        path: z.string().optional(),
        glob: z.string().max(1_000).optional(),
        output_mode: z.enum(['content', 'files_with_matches', 'count']).default('content'),
        '-A': z.number().int().min(0).max(100).optional(),
        '-B': z.number().int().min(0).max(100).optional(),
        '-C': z.number().int().min(0).max(100).optional(),
        context: z.number().int().min(0).max(100).optional(),
        '-n': z.boolean().optional(),
        '-i': z.boolean().optional(),
        type: z.string().max(100).optional(),
        head_limit: z.number().int().min(1).max(1_000).default(200),
        offset: z.number().int().min(0).default(0),
        multiline: z.boolean().default(false),
      })
      .strict(),
    inputSchema: jsonObject(
      {
        pattern: { type: 'string', maxLength: 10_000 },
        path: {
          type: 'string',
          description: '可选的已存在工作区目录；不得传文件路径，限制文件范围请使用 glob。',
        },
        glob: {
          type: 'string',
          maxLength: 1_000,
          description: '可选的文件 glob 过滤器；不要把文件路径传给 path。',
        },
        output_mode: { enum: ['content', 'files_with_matches', 'count'], default: 'content' },
        '-A': { type: 'integer', minimum: 0, maximum: 100 },
        '-B': { type: 'integer', minimum: 0, maximum: 100 },
        '-C': { type: 'integer', minimum: 0, maximum: 100 },
        context: { type: 'integer', minimum: 0, maximum: 100 },
        '-n': { type: 'boolean' },
        '-i': { type: 'boolean' },
        type: { type: 'string', maxLength: 100 },
        head_limit: { type: 'integer', minimum: 1, maximum: 1_000, default: 200 },
        offset: { type: 'integer', minimum: 0, default: 0 },
        multiline: { type: 'boolean', default: false },
      },
      ['pattern'],
    ),
    capabilities: { ...noCapabilities(), filesystem: 'read', process: true },
    allowedModes: allModes,
    allowedProfiles: allProfiles,
    approvalStrategy: 'policy',
    visibility: 'eager',
    executionMode: 'parallel',
    progress: (input) => ({ message: `正在搜索 ${input.pattern}` }),
    execute: grepWorkspace,
  },
  ...(['Bash', 'PowerShell'] as const).map((sdkName): ToolDefinition<any, any> => ({
    sdkName,
    name: sdkName,
    description:
      sdkName === 'Bash'
        ? '以工作区为默认 cwd，经 Pi tool_call、统一权限、Hook、hard-deny 与幂等门禁后，以当前用户身份执行 Bash 命令。计划模式禁用；无 OS 文件或网络沙箱。'
        : '以工作区为默认 cwd，经 Pi tool_call、统一权限、Hook、hard-deny 与幂等门禁后，以当前用户身份执行 PowerShell 命令。计划模式禁用；无 OS 文件或网络沙箱。',
    schema: shellSchema,
    inputSchema: shellInputSchema,
    capabilities: {
      filesystem: 'host-write',
      network: 'declared',
      process: true,
      externalState: true,
      userInteraction: false,
    },
    allowedModes: allModes,
    allowedProfiles: ['main', 'default', 'worker'],
    approvalStrategy: 'policy',
    visibility: 'eager',
    executionMode: 'sequential',
    progress: () => ({ message: `正在执行 ${sdkName}` }),
    execute: async () => {
      throw new AgentError('SHELL_EXECUTOR_REQUIRED', `${sdkName} 必须经过统一执行器`, 500)
    },
  })),
  {
    sdkName: 'ToolSearch',
    name: 'tool.search',
    description:
      '搜索当前可发现范围内的延迟工具并请求激活：query 匹配工具名称、描述与 MCP server 名称，query="*" 浏览整个目录，用 offset 分页、max_results 上限 20；命中的工具在下一次请求即可调用。select:<exact-name> 精确激活并返回完整参数 schema。',
    schema: z
      .object({
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(20).default(5),
        offset: z.number().int().min(0).default(0),
      })
      .strict(),
    inputSchema: jsonObject(
      {
        query: {
          type: 'string',
          minLength: 1,
          description:
            '搜索关键词，匹配工具名称、描述与 MCP server 名称；传 "*" 浏览整个目录，或传 select:<exact-name> 精确激活。',
        },
        max_results: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
        offset: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: '分页起点，用于浏览或宽泛搜索时查看被上限省略的后续结果。',
        },
      },
      ['query'],
    ),
    capabilities: noCapabilities(),
    allowedModes: allModes,
    allowedProfiles: allProfiles,
    approvalStrategy: 'never-review',
    visibility: 'eager',
    executionMode: 'parallel',
    execute: async (input, context) => {
      const raw = input.query.trim()
      const selection = raw.match(/^select:(.+)$/i)?.[1]?.trim()
      const browseAll = raw === '*'
      const query = raw.toLowerCase()
      const matches = (context.deferredTools ?? []).filter((tool) =>
        selection
          ? tool.sdkName === selection
          : browseAll || toolSearchHaystack(tool).includes(query),
      )
      if (selection && matches.length === 0)
        throw new AgentError(
          'DEFERRED_TOOL_NOT_FOUND',
          `延迟工具 ${selection} 不存在或不在当前权限范围内`,
          404,
        )
      const page = matches.slice(input.offset, input.offset + input.max_results)
      return {
        tools: page.map((tool) => {
          const summary = toolCatalogSummary(tool)
          return {
            name: summary.name,
            description: summary.description,
            ...(summary.source ? { source: summary.source } : {}),
          }
        }),
        total: matches.length,
        offset: input.offset,
        addedToolNames: page.map((tool) => tool.sdkName),
      }
    },
    formatResult: (output) => ({
      content: JSON.stringify(output, null, 2),
      details: output,
      addedToolNames: output.addedToolNames,
    }),
  },
  requestPermissionsDefinition,
  ...subagentToolDefinitions,
]

export const toolMayMutate = (tool: ToolCatalogEntry) =>
  tool.capabilities.filesystem === 'workspace-write' ||
  tool.capabilities.filesystem === 'host-write' ||
  tool.capabilities.externalState
const isShell = (tool: ToolCatalogEntry) => tool.sdkName === 'Bash' || tool.sdkName === 'PowerShell'
export const toolAllowedInTaskMode = (tool: ToolCatalogEntry, mode: TaskMode) =>
  tool.allowedModes.includes(mode) && (mode !== 'plan' || !toolMayMutate(tool))
export const toolAllowedForFileAccess = (tool: ToolCatalogEntry, profile: FileAccessProfile) =>
  profile !== 'read-only' ||
  isShell(tool) ||
  (tool.capabilities.filesystem !== 'workspace-write' &&
    tool.capabilities.filesystem !== 'host-write')

export class ToolCatalog {
  private readonly tools = new Map<string, ToolDefinition<any, any>>()
  private readonly internalNames = new Map<string, string>()

  constructor(definitions: ToolDefinition<any, any>[] = builtinTools()) {
    for (const definition of definitions) this.register(definition)
  }

  register(tool: ToolDefinition<any, any>) {
    if (
      !tool.sdkName ||
      !tool.schema ||
      !tool.execute ||
      !tool.capabilities ||
      !tool.visibility ||
      !tool.executionMode
    )
      throw new AgentError('INVALID_TOOL_DEFINITION', '工具定义不完整', 500)
    const internalName = tool.name ?? tool.sdkName
    if (
      this.tools.has(tool.sdkName) ||
      this.internalNames.has(tool.sdkName) ||
      this.internalNames.has(internalName) ||
      this.tools.has(internalName)
    )
      throw new AgentError(
        'TOOL_ALREADY_REGISTERED',
        `工具 ${tool.sdkName}/${internalName} 已注册`,
        409,
      )
    const frozen = Object.freeze({
      ...tool,
      name: internalName,
      allowedModes: [...tool.allowedModes],
      allowedProfiles: [...tool.allowedProfiles],
      capabilities: Object.freeze({ ...tool.capabilities }),
    })
    this.tools.set(tool.sdkName, frozen)
    this.internalNames.set(internalName, tool.sdkName)
  }

  all() {
    return [...this.tools.values()]
  }

  list(
    mode?: TaskMode,
    sandboxMode: SandboxMode = 'workspace-write',
    profile: SubagentProfile = 'main',
  ) {
    const fileAccess = fileAccessProfileFromV4(sandboxMode)
    return [...this.tools.values()].filter(
      (tool) =>
        (tool.available?.() ?? true) &&
        (!mode || toolAllowedInTaskMode(tool, mode)) &&
        tool.allowedProfiles.includes(profile) &&
        toolAllowedForFileAccess(tool, fileAccess),
    )
  }

  deferred(
    mode?: TaskMode,
    sandboxMode: SandboxMode = 'workspace-write',
    profile: SubagentProfile = 'main',
  ) {
    return this.list(mode, sandboxMode, profile).filter((tool) => tool.visibility === 'deferred')
  }

  get(name: string) {
    const tool = this.tools.get(name) ?? this.tools.get(this.internalNames.get(name) ?? '')
    if (!tool) throw new AgentError('TOOL_NOT_FOUND', `工具 ${name} 不存在`, 404)
    return tool
  }

  async execute(name: string, input: Record<string, unknown>, context: ToolContext) {
    const tool = this.get(name)
    if (!toolAllowedInTaskMode(tool, context.taskMode))
      throw new AgentError(
        'TOOL_NOT_ALLOWED_IN_MODE',
        `工具 ${name} 不允许在 ${context.taskMode} 模式执行`,
        403,
      )
    if (!tool.allowedProfiles.includes(context.profile ?? 'main'))
      throw new AgentError(
        'TOOL_NOT_ALLOWED_FOR_PROFILE',
        `工具 ${name} 不允许当前 Agent profile 使用`,
        403,
      )
    const fileAccess = fileAccessProfileFromV4(context.permissionConfig.sandboxMode)
    if (!toolAllowedForFileAccess(tool, fileAccess))
      throw new AgentError(
        'TOOL_NOT_ALLOWED_IN_SANDBOX',
        `工具 ${name} 不允许在 ${fileAccess} 文件访问范围执行`,
        403,
      )
    if (context.signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
    const parsed = tool.schema.safeParse(input)
    if (!parsed.success) throw new AgentError('INVALID_TOOL_INPUT', parsed.error.message, 400)
    const progress = tool.progress?.(parsed.data, context)
    if (progress) context.onProgress?.(progress)
    return tool.execute(parsed.data, {
      ...context,
      deferredTools:
        context.deferredTools ??
        this.deferred(
          context.taskMode,
          context.permissionConfig.sandboxMode,
          context.profile ?? 'main',
        ),
    })
  }
}

/** Canonical Skill allowlists are exact and cannot reactivate removed aliases. */
export const allowedToolNameMatches = (name: string, allowedTools: readonly string[]) =>
  allowedTools.includes(name)
export const toolNameMatches = (
  tool: Pick<ToolCatalogEntry, 'sdkName'>,
  allowedTools: readonly string[],
) => allowedToolNameMatches(tool.sdkName, allowedTools)

/** @deprecated Use ToolCatalog. */
export class ToolRegistry extends ToolCatalog {}

/** Immutable per-turn view combining process-wide built-ins with scoped tools. */
export class TurnToolCatalog extends ToolCatalog {
  constructor(base: ToolCatalog, scoped: readonly ToolDefinition[]) {
    super([...base.all(), ...scoped])
  }
}
