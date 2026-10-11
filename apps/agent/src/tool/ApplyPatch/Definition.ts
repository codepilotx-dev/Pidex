import { createHash } from 'node:crypto'
import { filePathProtection } from '../../permission/FilePathProtection'
import { relative } from 'node:path'
import { z } from 'zod'
import {
  AgentError,
  type ToolAffectedPath,
  type ToolAuthorizationScope,
  type ToolReviewSummary,
} from '../../Domain'
import type {
  EditorMutation,
  WorkspaceFileRevision,
  WorkspaceMutationPathInspection,
} from '../../workspace/WorkspaceService'
import type { ToolContext, ToolDefinition, ToolInputInspection } from '../ToolRegistry'
import { applyPatchText } from './ApplyPatchText'
import { parseApplyPatch, type ApplyPatchOperation } from './ParseApplyPatch'
import { buildFileDiff } from '../../patch/TurnPatchService'

const MAX_PATCH_BYTES = 1024 * 1024
const MAX_AFFECTED_FILES = 100
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_STAGED_BYTES = 50 * 1024 * 1024

const APPLY_PATCH_LARK_GRAMMAR = String.raw`start: begin_patch operation+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?
operation: add_file | update_file
add_file: "*** Add File: " filename LF add_line+
update_file: "*** Update File: " filename LF change+
filename: /(.+)/
add_line: "+" /(.*)/ LF
change: change_context change_line+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF
%import common.LF`

const applyPatchInputSchema = z
  .object({
    patch: z.string().min(1).max(MAX_PATCH_BYTES),
  })
  .strict()

type ApplyPatchInput = z.infer<typeof applyPatchInputSchema>

type PreparedOperation = {
  operation: 'create' | 'update'
  requestedPath: string
  path: string
  workspacePath: string
  canonicalPath: string
  content: string
  beforeContent: string | null
  expectedRevision?: WorkspaceFileRevision
  additions: number
  deletions: number
  hunkCount: number
}

type PreparedPatch = {
  operations: readonly PreparedOperation[]
  authorizationScope: ToolAuthorizationScope
  configWrites: NonNullable<ToolInputInspection['configWrites']>
}

type ConfigWrite = NonNullable<ToolInputInspection['configWrites']>[number]

export type ApplyPatchOutput = {
  operation: 'apply_patch'
  files: readonly {
    operation: 'create' | 'update'
    path: string
    additions: number
    deletions: number
    beforeSha256: string | null
    afterSha256: string
    revision: WorkspaceFileRevision
  }[]
  summary: ToolReviewSummary
}

const canonicalKey = (path: string) => {
  const normalized = path.replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const safeWorkspacePath = (context: ToolContext, inspection: WorkspaceMutationPathInspection) => {
  if (inspection.path.startsWith('@')) return inspection.path
  const owner = context.workspace.rootForPath(inspection.canonicalPath)
  if (!owner) {
    // Full access resolves the target to an absolute display path, which is the
    // only identifiable label for a file outside every workspace root.
    return context.workspace.displayPath(inspection.canonicalPath)
  }
  const child = relative(owner.path, inspection.canonicalPath).replaceAll('\\', '/')
  if (owner.path === context.workspace.rootPath) return child
  const rootIndex = context.workspace.workspaceRoots.findIndex(
    (root) => canonicalKey(root.path) === canonicalKey(owner.path),
  )
  const rootLabel = owner.folderId ?? `root-${Math.max(0, rootIndex) + 1}`
  return `@workspace/${rootLabel}/${child}`
}

const protectedPath = (_context: ToolContext, inspection: WorkspaceMutationPathInspection) =>
  filePathProtection(inspection.canonicalPath, inspection.path)

const countAddedFileLines = (content: string) =>
  content.endsWith('\n') ? content.slice(0, -1).split('\n').length : content.split('\n').length

const operationStats = (operation: ApplyPatchOperation) => {
  if (operation.type === 'add') {
    return {
      additions: countAddedFileLines(operation.content),
      deletions: 0,
      hunkCount: 0,
    }
  }
  return {
    additions: operation.chunks.reduce((sum, chunk) => sum + chunk.additions, 0),
    deletions: operation.chunks.reduce((sum, chunk) => sum + chunk.deletions, 0),
    hunkCount: operation.chunks.length,
  }
}

const staleError = (path: string): never => {
  throw new AgentError(
    'WORKSPACE_FILE_STALE',
    `无法更新 "${path}"：文件缺少完整 Read 快照或已在 Read 后发生变化。请重新 Read 所有受影响文件后再生成补丁。本次补丁未修改任何文件`,
    409,
  )
}

const preflightError = (cause: unknown): never => {
  if (cause instanceof AgentError) {
    if (cause.message.includes('本次补丁未修改任何文件')) throw cause
    throw new AgentError(
      cause.code,
      `${cause.message}。请检查补丁路径并在必要时重新 Read；本次补丁未修改任何文件`,
      cause.status,
      cause.details,
    )
  }
  throw new AgentError(
    'PATCH_EXECUTION_FAILED',
    'apply_patch 预检失败。请重新 Read 所有受影响文件后重试；本次补丁未修改任何文件',
    500,
  )
}

const summarize = (operations: readonly PreparedOperation[]): ToolReviewSummary => ({
  fileCount: operations.length,
  hunkCount: operations.reduce((sum, operation) => sum + operation.hunkCount, 0),
  additions: operations.reduce((sum, operation) => sum + operation.additions, 0),
  deletions: operations.reduce((sum, operation) => sum + operation.deletions, 0),
})

const preparePatch = async (
  input: ApplyPatchInput,
  context: ToolContext,
): Promise<PreparedPatch> => {
  try {
    if (Buffer.byteLength(input.patch, 'utf8') > MAX_PATCH_BYTES) {
      throw new AgentError('PATCH_LIMIT_EXCEEDED', `补丁文本超过 ${MAX_PATCH_BYTES} 字节上限`, 413)
    }
    const parsed = parseApplyPatch(input.patch)
    if (parsed.length > MAX_AFFECTED_FILES) {
      throw new AgentError(
        'PATCH_LIMIT_EXCEEDED',
        `补丁涉及 ${parsed.length} 个文件，超过 ${MAX_AFFECTED_FILES} 个文件上限`,
        413,
      )
    }

    const prepared: PreparedOperation[] = []
    const configWrites: ConfigWrite[] = []
    const canonicalPaths = new Map<string, string>()
    let stagedBytes = 0
    let ruleRequiresApproval = false

    for (const operation of parsed) {
      const inspection = await context.workspace.inspectMutationPath(
        operation.path,
        operation.type === 'add' ? 'new-file' : 'existing-file',
      )
      const path = safeWorkspacePath(context, inspection)
      const key = canonicalKey(inspection.canonicalPath)
      const duplicate = canonicalPaths.get(key)
      if (duplicate) {
        throw new AgentError(
          'PATCH_DUPLICATE_PATH',
          `补丁中的 "${path}" 与 "${duplicate}" 指向同一个文件；每个文件只能出现一次`,
          409,
        )
      }
      canonicalPaths.set(key, path)

      let content: string
      let beforeContent: string | null = null
      let expectedRevision: WorkspaceFileRevision | undefined
      if (operation.type === 'add') {
        content = operation.content
      } else {
        if (inspection.expectation !== 'existing-file') {
          throw new AgentError('WORKSPACE_PATH_NOT_FOUND', `Update File 目标 "${path}" 不存在`, 404)
        }
        const snapshot = await context.fileSnapshots?.get(operation.path)
        if (
          !snapshot ||
          snapshot.mtimeMs !== inspection.revision.mtimeMs ||
          snapshot.sha256 !== inspection.revision.sha256 ||
          (snapshot.rawSha256 !== undefined &&
            snapshot.rawSha256.toLowerCase() !== inspection.rawSha256) ||
          (snapshot.utf8Bom !== undefined && snapshot.utf8Bom !== inspection.utf8Bom)
        ) {
          staleError(path)
        }
        content = applyPatchText(path, operation.chunks, inspection.content).content
        beforeContent = inspection.content
        expectedRevision = snapshot
      }

      const sizeBytes = Buffer.byteLength(content, 'utf8')
      if (sizeBytes > MAX_FILE_BYTES) {
        throw new AgentError(
          'WORKSPACE_FILE_TOO_LARGE',
          `补丁后的 "${path}" 超过 ${MAX_FILE_BYTES} 字节上限`,
          413,
        )
      }
      stagedBytes += sizeBytes
      if (stagedBytes > MAX_STAGED_BYTES) {
        throw new AgentError(
          'PATCH_LIMIT_EXCEEDED',
          `补丁暂存内容超过 ${MAX_STAGED_BYTES} 字节上限`,
          413,
        )
      }

      const stats = operationStats(operation)
      const protection = protectedPath(context, inspection)
      ruleRequiresApproval ||= protection.requiresApproval
      if (protection.configScope) {
        configWrites.push({
          path,
          content,
          scope: protection.configScope,
        })
      }
      prepared.push({
        operation: operation.type === 'add' ? 'create' : 'update',
        requestedPath: operation.path,
        path,
        workspacePath: inspection.path,
        canonicalPath: inspection.canonicalPath,
        content,
        beforeContent,
        ...(expectedRevision ? { expectedRevision } : {}),
        ...stats,
      })
    }

    const reviewSummary = summarize(prepared)
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          parsed,
          canonicalPaths: prepared.map((operation) => canonicalKey(operation.canonicalPath)),
        }),
        'utf8',
      )
      .digest('hex')
    return {
      operations: prepared,
      authorizationScope: {
        affectedPaths: prepared.map(({ operation, path }): ToolAffectedPath => ({
          operation,
          path,
        })),
        fingerprint,
        ruleRequiresApproval,
        reviewSummary,
      },
      configWrites,
    }
  } catch (cause) {
    return preflightError(cause)
  }
}

const safePartialCommit = (cause: AgentError, prepared: PreparedPatch) => {
  const details =
    cause.details && typeof cause.details === 'object'
      ? (cause.details as { committed?: unknown; pending?: unknown })
      : {}
  const byWorkspacePath = new Map(
    prepared.operations.map((operation) => [canonicalKey(operation.workspacePath), operation.path]),
  )
  const safeList = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((path): path is string => typeof path === 'string')
          .map((path) => byWorkspacePath.get(canonicalKey(path)) ?? '<workspace-file>')
      : []
  const committed = safeList(details.committed)
  const pending = safeList(details.pending)
  const list = (paths: readonly string[]) => (paths.length ? paths.slice(0, 10).join('、') : '无')
  return new AgentError(
    'PATCH_PARTIAL_COMMIT',
    `补丁提交阶段失败。已提交：${list(committed)}；未提交：${list(pending)}。请重新 Read 所有受影响文件，禁止直接重放原补丁`,
    500,
    { committed, pending },
  )
}

const invalidateSnapshots = async (
  context: ToolContext,
  operations: readonly PreparedOperation[],
) => {
  if (!context.fileSnapshots) return
  for (const operation of operations) {
    try {
      await context.fileSnapshots.invalidate([operation.requestedPath])
    } catch {
      // Snapshot cleanup is best-effort and must never replace the original patch failure.
    }
  }
}

export const applyPatchDefinition: ToolDefinition<ApplyPatchInput, ApplyPatchOutput> = {
  sdkName: 'apply_patch',
  name: 'workspace.apply_patch',
  description: [
    '按需使用确定性的多文件补丁新增或更新工作区 UTF-8 文本文件。普通单文件编辑应优先使用 Edit；Update File 必须先 Read 每个目标文件。',
    '完全访问模式下补丁也可作用于工作区外的绝对路径。',
    '格式必须以 *** Begin Patch 开始、以 *** End Patch 结束；支持 *** Add File: path、*** Update File: path、多个 @@ hunk 和 *** End of File。',
    '新补丁的 hunk 头必须使用不含行号计数的 @@ 或 @@ <精确上下文>；不要生成 @@ -旧行,+新行 @@。',
    '上下文必须精确且唯一；只等价处理 LF/CRLF，不进行空白、缩进或 Unicode 模糊匹配。',
    '当前不支持 Delete File 或 Move to；Add File 的每一行必须以 + 开头。',
  ].join('\n'),
  schema: applyPatchInputSchema,
  inputSchema: {
    type: 'object',
    properties: {
      patch: {
        type: 'string',
        description: [
          '完整补丁原文。首行必须直接是 *** Begin Patch，禁止 Markdown 代码围栏；末行必须是 *** End Patch。',
          '最小示例：\n*** Begin Patch\n*** Add File: path/to/file.txt\n+content\n*** End Patch',
          'Update 示例：\n*** Begin Patch\n*** Update File: path/to/file.txt\n@@\n-old\n+new\n*** End Patch',
          'Update File 必须基于刚刚 Read 的完整原文；解析或 context 失败后重新 Read 并重建补丁，禁止原样重放。',
        ].join('\n'),
        minLength: 1,
        maxLength: MAX_PATCH_BYTES,
      },
    },
    required: ['patch'],
    additionalProperties: false,
  },
  constrainedSampling: {
    type: 'grammar',
    variants: {
      openai_lark: APPLY_PATCH_LARK_GRAMMAR,
    },
  },
  capabilities: {
    filesystem: 'workspace-write',
    network: 'none',
    process: false,
    externalState: true,
    userInteraction: false,
  },
  allowedModes: ['chat'],
  allowedProfiles: ['main', 'default', 'worker'],
  approvalStrategy: 'policy',
  visibility: 'deferred',
  executionMode: 'sequential',
  inspectInput: async (input, context) => {
    const prepared = await preparePatch(input, context)
    const protectedFile = (file: PreparedOperation) =>
      filePathProtection(file.canonicalPath, file.path).requiresApproval
    return {
      authorizationScope: prepared.authorizationScope,
      grantsForbidden: prepared.operations.some(protectedFile),
      fileDiffs: prepared.operations
        .filter((file) => !protectedFile(file))
        .map((file) =>
          buildFileDiff({
            path: file.path,
            operation: file.operation,
            beforeContent: file.beforeContent,
            afterContent: file.content,
          }),
        ),
      ...(prepared.configWrites.length ? { configWrites: prepared.configWrites } : {}),
    }
  },
  progress: () => ({ message: '正在应用工作区补丁' }),
  execute: async (input, context) => {
    const prepared = await preparePatch(input, context)
    if (
      context.authorizationScope &&
      context.authorizationScope.fingerprint !== prepared.authorizationScope.fingerprint
    ) {
      throw new AgentError(
        'APPROVAL_SCOPE_CHANGED',
        'apply_patch 的文件范围或内容在授权后发生变化，已拒绝执行。请重新 Read 并重新提交补丁；本次补丁未修改任何文件',
        409,
      )
    }

    const mutations: EditorMutation[] = prepared.operations.map((operation) =>
      operation.operation === 'create'
        ? {
            operation: 'create',
            path: operation.requestedPath,
            content: operation.content,
          }
        : {
            operation: 'update',
            path: operation.requestedPath,
            content: operation.content,
            expectedRevision: operation.expectedRevision!,
          },
    )

    let committed = false
    try {
      const result = await context.workspace.commitEditorMutations(mutations)
      committed = true
      const resultByPath = new Map(result.files.map((file) => [canonicalKey(file.path), file]))
      const files = prepared.operations.map((operation) => {
        const saved = resultByPath.get(canonicalKey(operation.workspacePath))
        if (!saved || !saved.afterSha256 || !saved.revision) {
          throw new AgentError(
            'PATCH_PARTIAL_COMMIT',
            '补丁写入结果不完整。请重新 Read 所有受影响文件后再继续',
            500,
          )
        }
        return {
          operation: operation.operation,
          path: operation.path,
          additions: operation.additions,
          deletions: operation.deletions,
          beforeSha256: saved.beforeSha256,
          afterSha256: saved.afterSha256,
          revision: saved.revision,
        }
      })
      const evidence = prepared.operations.map((operation, index) => {
        const file = files[index]!
        return {
          operation: operation.operation,
          path: operation.path,
          beforeContent: operation.beforeContent,
          afterContent: operation.content.startsWith('\uFEFF')
            ? operation.content.slice(1)
            : operation.content,
          beforeSha256: file.beforeSha256,
          afterSha256: file.afterSha256,
        }
      })
      await context.recordMutation?.(evidence).catch(() => undefined)
      for (let index = 0; index < prepared.operations.length; index += 1) {
        const operation = prepared.operations[index]!
        const file = files[index]!
        await context.fileSaved?.({
          filePath: operation.workspacePath,
          content: operation.content,
        })
        await context.fileSnapshots?.set(operation.requestedPath, file.revision)
      }
      return {
        operation: 'apply_patch',
        files,
        summary: prepared.authorizationScope.reviewSummary!,
      }
    } catch (cause) {
      await invalidateSnapshots(context, prepared.operations)
      if (committed) {
        const paths = prepared.operations.map((operation) => operation.path)
        throw new AgentError(
          'PATCH_PARTIAL_COMMIT',
          `补丁文件已经写入，但后续状态同步失败。请重新 Read：${paths.slice(0, 10).join('、')}`,
          500,
          { committed: paths, pending: [] },
        )
      }
      if (cause instanceof AgentError && cause.code === 'PATCH_PARTIAL_COMMIT') {
        throw safePartialCommit(cause, prepared)
      }
      if (cause instanceof AgentError && cause.code !== 'WORKSPACE_WRITE_FAILED') {
        return preflightError(cause)
      }
      throw new AgentError(
        'PATCH_EXECUTION_FAILED',
        'apply_patch 暂存或提交失败。请检查目标是否可写并重新 Read 后再试；本次补丁未修改任何文件',
        500,
      )
    }
  },
  formatResult: (output) => {
    const created = output.files.filter((file) => file.operation === 'create').length
    const updated = output.files.length - created
    return {
      content: `补丁已应用：新增 ${created} 个文件，更新 ${updated} 个文件（+${output.summary.additions} -${output.summary.deletions}）`,
      details: output,
    }
  },
}
