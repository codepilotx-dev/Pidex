import { createHash, randomUUID } from 'node:crypto'
import { watch as watchFileSystem } from 'node:fs'
import {
  chmod,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { AgentError } from '../Domain'
import { pathContains } from '../permission/PathPermissions'
import type { RequestedPermissions } from '../permission/PermissionDecisionEngine'
import type { FileAccessProfile } from '../permission/ExecutionPolicy'

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
])
const MAX_FILE_BYTES = 1_000_000
const EDITOR_READ_MAX_BYTES = 20 * 1024 * 1024
const EDITOR_WRITE_MAX_BYTES = 10 * 1024 * 1024
const SEARCH_LIMIT = 200
const LIST_LIMIT = 2_000
const SEARCH_MAX_FILES = 10_000
const SEARCH_MAX_BYTES = 50 * 1024 * 1024
const SEARCH_TIMEOUT_MS = 10_000
const WINDOWS_REPLACE_BLOCKED_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const decoder = new TextDecoder('utf-8', { fatal: true })
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const isWindowsReplaceBlocked = (cause: unknown) =>
  process.platform === 'win32' &&
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  typeof cause.code === 'string' &&
  WINDOWS_REPLACE_BLOCKED_CODES.has(cause.code)
const decodeUtf8 = (bytes: Uint8Array) => {
  try {
    return decoder.decode(bytes)
  } catch {
    throw new AgentError('WORKSPACE_FILE_UNREADABLE', '文件包含非法 UTF-8 字节', 400)
  }
}
const hasUtf8Bom = (bytes: Uint8Array) =>
  bytes.length >= UTF8_BOM.length && UTF8_BOM.every((value, index) => bytes[index] === value)
const encodeUtf8 = (content: string, preserveBom: boolean) => {
  const explicitBom = content.startsWith('\uFEFF')
  const normalizedContent = explicitBom ? content.slice(1) : content
  const bytes = Buffer.from(normalizedContent, 'utf8')
  return {
    content: normalizedContent,
    bytes: preserveBom || explicitBom ? Buffer.concat([UTF8_BOM, bytes]) : bytes,
  }
}

export interface WorkspaceSearchResult {
  path: string
  line?: number
  preview?: string
}

export type WorkspaceReadOnlyPath = {
  path: string
  kind: 'file' | 'directory'
}

export interface WorkspaceFileRevision {
  mtimeMs: number
  sha256: string
  /** Internal raw-byte guard used by editor mutations; older RPC clients may omit it. */
  rawSha256?: string
  /** Internal BOM guard used by editor mutations; older RPC clients may omit it. */
  utf8Bom?: boolean
}

export type WorkspaceMutationExpectation = 'existing-file' | 'new-file'

export type WorkspaceMutationPathInspection =
  | {
      expectation: 'new-file'
      path: string
      canonicalPath: string
    }
  | {
      expectation: 'existing-file'
      path: string
      canonicalPath: string
      content: string
      sizeBytes: number
      revision: WorkspaceFileRevision
      utf8Bom: boolean
      rawSha256: string
    }

export type EditorMutation =
  | {
      operation: 'create'
      path: string
      content: string
    }
  | {
      operation: 'update'
      path: string
      content: string
      expectedRevision: WorkspaceFileRevision
    }
  | {
      operation: 'delete'
      path: string
      expectedRevision: WorkspaceFileRevision
    }

export interface EditorMutationResult {
  operation: EditorMutation['operation']
  path: string
  beforeSha256: string | null
  afterSha256: string | null
  revision: WorkspaceFileRevision | null
}

export interface EditorMutationCommitResult {
  outcome: 'committed'
  files: EditorMutationResult[]
}

type InternalMutationPathInspection =
  | (Extract<WorkspaceMutationPathInspection, { expectation: 'new-file' }> & {
      key: string
    })
  | (Extract<WorkspaceMutationPathInspection, { expectation: 'existing-file' }> & {
      key: string
      mode: number
    })

export interface WorkspaceEditorFile {
  path: string
  content: string
  sizeBytes: number
  readonly: boolean
  truncated: false
  revision: WorkspaceFileRevision
}

export interface WorkspaceFileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  depth: number
}

export interface WorkspaceRoot {
  folderId?: string
  path: string
  role: 'primary' | 'secondary'
  writable?: boolean
}

export type ApplyPatchInput =
  | { operation: 'update'; path: string; before: string; after: string }
  | { operation: 'create'; path: string; content: string }
  | { operation: 'delete'; path: string; expectedSha256: string }

export interface ApplyPatchResult {
  operation: ApplyPatchInput['operation']
  path: string
  diff: string
  additions: number
  deletions: number
  beforeSha256: string | null
  afterSha256: string | null
}

const lines = (value: string) => (value === '' ? [] : value.replace(/\r?\n$/, '').split(/\r?\n/))
const lineCount = (value: string) => lines(value).length
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const sha256Bytes = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

const diffLines = (prefix: '+' | '-', value: string) =>
  lines(value).map((line) => `${prefix}${line}`)

const uniqueContextIndex = (current: string, before: string) => {
  if (!before) throw new AgentError('INVALID_TOOL_INPUT', 'before 必须是非空字符串', 400)
  const index = current.indexOf(before)
  if (index < 0) throw new AgentError('PATCH_CONTEXT_NOT_FOUND', '补丁上下文未找到', 409)
  if (current.indexOf(before, index + 1) >= 0) {
    throw new AgentError('PATCH_CONTEXT_AMBIGUOUS', '补丁上下文不唯一', 409)
  }
  return index
}

const lineNumberAt = (value: string, index: number) => value.slice(0, index).split(/\r?\n/).length

const unifiedDiff = (path: string, before: string | null, after: string | null, startLine = 1) => {
  const oldLines = before === null ? 0 : lineCount(before)
  const newLines = after === null ? 0 : lineCount(after)
  const oldPath = before === null ? '/dev/null' : `a/${path}`
  const newPath = after === null ? '/dev/null' : `b/${path}`
  const oldStart = before === null ? 0 : startLine
  const newStart = after === null ? 0 : startLine
  return [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
    ...diffLines('-', before ?? ''),
    ...diffLines('+', after ?? ''),
  ].join('\n')
}

/**
 * Per-thread state shared by every file-access scope of the same workspace.
 * Scopes must not copy it: mutation queues serialize writers across concurrent
 * calls, and alias/read-only grants are minted after the service is opened.
 */
type WorkspaceSharedState = {
  editorAliases: Map<string, string>
  mutationQueues: Map<string, Promise<void>>
  readOnlyPaths: Map<string, WorkspaceReadOnlyPath>
}

/**
 * The only file-system boundary available to agents. Every existing path is
 * resolved through realpath before use, which prevents symlinks from escaping
 * the directory selected by the user.
 *
 * The default scope stays inside the workspace roots. `full-access` drops that
 * boundary and is only ever applied to a call-scoped view created by
 * `withFileAccess`, so one call's privilege never widens another call's.
 */
export class WorkspaceService {
  readonly rootPath: string
  readonly roots: readonly string[]
  readonly writableRoots: readonly string[]
  readonly workspaceRoots: readonly WorkspaceRoot[]
  /** File-access scope of this instance. It never widens another instance. */
  readonly fileAccess: FileAccessProfile
  private readonly shared: WorkspaceSharedState

  private constructor(
    rootPath: string,
    workspaceRoots: readonly WorkspaceRoot[],
    fileAccess: FileAccessProfile = 'workspace-write',
    shared: WorkspaceSharedState = {
      editorAliases: new Map(),
      mutationQueues: new Map(),
      readOnlyPaths: new Map(),
    },
    private readonly permissionPaths: Pick<RequestedPermissions, 'readPaths' | 'writePaths'> = {
      readPaths: [],
      writePaths: [],
    },
  ) {
    this.rootPath = rootPath
    this.workspaceRoots = Object.freeze(workspaceRoots.map((root) => Object.freeze({ ...root })))
    this.roots = Object.freeze(this.workspaceRoots.map((root) => root.path))
    this.writableRoots = Object.freeze(
      this.workspaceRoots.filter((root) => root.writable !== false).map((root) => root.path),
    )
    this.fileAccess = fileAccess
    this.shared = shared
  }

  /**
   * Call-scoped view of the same workspace under a different file-access scope.
   * Roots, grants, aliases and mutation queues are shared by reference, so this
   * never mutates the instance other calls or subagents are using.
   */
  withFileAccess(fileAccess: FileAccessProfile): WorkspaceService {
    if (fileAccess === this.fileAccess) return this
    return new WorkspaceService(
      this.rootPath,
      this.workspaceRoots,
      fileAccess,
      this.shared,
      this.permissionPaths,
    )
  }

  /** Approved paths are invocation-local and never modify shared grants. */
  withPermissionPaths(paths: Pick<RequestedPermissions, 'readPaths' | 'writePaths'>) {
    return new WorkspaceService(
      this.rootPath,
      this.workspaceRoots,
      this.fileAccess,
      this.shared,
      paths,
    )
  }

  private permissionPathFor(path: string, write = false) {
    return (
      write
        ? this.permissionPaths.writePaths
        : [...this.permissionPaths.readPaths, ...this.permissionPaths.writePaths]
    ).find((parent) => pathContains(parent, path))
  }

  /** True only when this scope may reach paths outside the workspace roots. */
  allowsOutsideWorkspace() {
    return this.fileAccess === 'full-access'
  }

  static async open(rootPath: string) {
    return this.openRoots({
      primaryRoot: rootPath,
      roots: [{ path: rootPath, role: 'primary' }],
    })
  }

  static async openRoots(input: { primaryRoot: string; roots: readonly WorkspaceRoot[] }) {
    const primary = await this.canonicalDirectory(input.primaryRoot)
    const candidates =
      input.roots.length > 0 ? input.roots : [{ path: primary, role: 'primary' as const }]
    const roots: WorkspaceRoot[] = []
    const seen = new Set<string>()
    for (const candidate of candidates) {
      let path: string
      try {
        path = await this.canonicalDirectory(candidate.path)
      } catch (cause) {
        if (resolve(candidate.path) === resolve(input.primaryRoot)) throw cause
        continue
      }
      const key = process.platform === 'win32' ? path.toLowerCase() : path
      if (seen.has(key)) continue
      seen.add(key)
      roots.push({
        ...(candidate.folderId ? { folderId: candidate.folderId } : {}),
        path,
        role: path === primary ? 'primary' : 'secondary',
        ...(candidate.writable === false ? { writable: false } : {}),
      })
    }
    if (!roots.some((root) => root.path === primary))
      roots.unshift({ path: primary, role: 'primary' })
    roots.sort((left, right) => Number(right.path === primary) - Number(left.path === primary))
    return new WorkspaceService(primary, roots)
  }

  private static async canonicalDirectory(path: string) {
    const resolved = await realpath(resolve(path)).catch(() => {
      throw new AgentError('WORKSPACE_PATH_NOT_FOUND', '工作区路径不存在或不可访问', 404)
    })
    const metadata = await stat(resolved)
    if (!metadata.isDirectory())
      throw new AgentError('WORKSPACE_NOT_DIRECTORY', '工作区路径必须是目录', 400)
    return resolved
  }

  grantEditorAlias(alias: '@pidex/config.json', targetPath: string) {
    if (!isAbsolute(targetPath))
      throw new AgentError('WORKSPACE_PATH_DENIED', '编辑器别名目标无效', 403)
    this.shared.editorAliases.set(alias, resolve(targetPath))
  }

  grantReadOnlyPaths(paths: readonly WorkspaceReadOnlyPath[]) {
    for (const entry of paths) {
      if (!isAbsolute(entry.path)) continue
      const canonical = resolve(entry.path)
      this.shared.readOnlyPaths.set(this.mutationKey(canonical), {
        path: canonical,
        kind: entry.kind,
      })
    }
  }

  /** Isolate turn-local context grants while retaining the shared mutation queues. */
  withReadOnlyPaths(paths: readonly WorkspaceReadOnlyPath[]) {
    const workspace = new WorkspaceService(
      this.rootPath,
      this.workspaceRoots,
      this.fileAccess,
      {
        ...this.shared,
        readOnlyPaths: new Map(this.shared.readOnlyPaths),
      },
      this.permissionPaths,
    )
    workspace.grantReadOnlyPaths(paths)
    return workspace
  }

  private aliasTarget(path: string) {
    if (path.startsWith('@') && !this.shared.editorAliases.has(path)) {
      throw new AgentError('WORKSPACE_PATH_DENIED', '未知的 host 编辑器别名', 403)
    }
    return this.shared.editorAliases.get(path)
  }

  displayPath(path: string) {
    const canonical = resolve(path)
    for (const [alias, target] of this.shared.editorAliases) {
      if (canonical === target) return alias
    }
    const owner = this.rootForPath(canonical)
    if (!owner) {
      // Paths outside every root are only reachable through full access or a
      // granted local-context path, and both need an unambiguous absolute path.
      if (this.allowsOutsideWorkspace()) return canonical.replaceAll('\\', '/')
      if (this.readOnlyPathFor(canonical) || this.permissionPathFor(canonical)) return canonical
      const outside = relative(this.rootPath, canonical)
      return outside === '' ? '.' : outside.replaceAll('\\', '/')
    }
    if (owner.path !== this.rootPath) return canonical
    const result = relative(this.rootPath, canonical)
    return result === '' ? '.' : result.replaceAll('\\', '/')
  }

  rootForPath(path: string) {
    const candidate = resolve(path)
    return [...this.workspaceRoots]
      .sort((left, right) => right.path.length - left.path.length)
      .find((root) => {
        const child = relative(root.path, candidate)
        return child === '' || (!child.startsWith('..') && !isAbsolute(child))
      })
  }

  containsPath(path: string) {
    return Boolean(this.rootForPath(path))
  }

  private ensureWithinRoot(path: string) {
    if (
      this.allowsOutsideWorkspace() ||
      this.containsPath(path) ||
      this.permissionPathFor(path, true)
    )
      return
    throw new AgentError('WORKSPACE_PATH_DENIED', '路径不在当前工作区内，请先申请路径权限', 403)
  }

  private readOnlyPathFor(path: string) {
    const candidate = resolve(path)
    return [...this.shared.readOnlyPaths.values()].find((entry) => {
      if (entry.kind === 'file') return this.mutationKey(entry.path) === this.mutationKey(candidate)
      const child = relative(entry.path, candidate)
      return child === '' || (!child.startsWith('..') && !isAbsolute(child))
    })
  }

  private ensureReadable(path: string) {
    if (
      this.allowsOutsideWorkspace() ||
      this.containsPath(path) ||
      this.readOnlyPathFor(path) ||
      this.permissionPathFor(path)
    )
      return
    throw new AgentError('WORKSPACE_PATH_DENIED', '路径不在当前工作区或已授权本地上下文内', 403)
  }

  private ensureWritable(path: string) {
    if (this.fileAccess === 'read-only')
      throw new AgentError('WORKSPACE_FILE_READONLY', '当前文件访问范围为只读', 403)
    const owner = this.rootForPath(path)
    // An explicitly read-only root stays read-only even under full access.
    if (owner) {
      if (owner.writable !== false) return
      throw new AgentError('WORKSPACE_FILE_READONLY', '当前工作区目录为只读', 403)
    }
    if (this.allowsOutsideWorkspace() || this.permissionPathFor(path, true)) return
    throw new AgentError('WORKSPACE_FILE_READONLY', '当前工作区目录为只读', 403)
  }

  private requestedPath(path: string) {
    const alias = this.aliasTarget(path)
    if (alias) return alias
    if (
      typeof path !== 'string' ||
      path.trim() === '' ||
      (!isAbsolute(path) && path.split(/[\\/]+/).includes('..'))
    ) {
      throw new AgentError('WORKSPACE_PATH_DENIED', '路径必须位于当前工作区内', 403)
    }
    const requested = isAbsolute(path) ? resolve(path) : resolve(this.rootPath, path)
    // A call with approved paths also checks the canonical target below, including directory links.
    if (!this.permissionPaths.readPaths.length && !this.permissionPaths.writePaths.length)
      this.ensureReadable(requested)
    return requested
  }

  async resolveExistingPath(path: string) {
    return this.existingPath(path)
  }

  async resolveDirectory(path = '.') {
    return this.directory(path)
  }

  private async existingPath(path: string) {
    const requested = this.requestedPath(path)
    const canonical = await realpath(requested).catch(() => {
      throw new AgentError('WORKSPACE_PATH_NOT_FOUND', '工作区路径不存在或不可访问', 404)
    })
    const alias = this.aliasTarget(path)
    if (alias) {
      if (canonical !== alias)
        throw new AgentError('WORKSPACE_PATH_DENIED', '编辑器别名不能通过符号链接重定向', 403)
    } else if (!this.containsPath(canonical) && !this.allowsOutsideWorkspace()) {
      const permissionPath = this.permissionPathFor(canonical)
      if (permissionPath) {
        if (!pathContains(permissionPath, canonical))
          throw new AgentError('WORKSPACE_PATH_DENIED', '授权路径不能通过链接越界', 403)
        return canonical
      }
      const grant = this.readOnlyPathFor(requested)
      if (!grant)
        throw new AgentError('WORKSPACE_PATH_DENIED', '路径不在当前工作区或已授权本地上下文内', 403)
      const currentRoot = await realpath(grant.path).catch(() => {
        throw new AgentError('WORKSPACE_PATH_NOT_FOUND', '本地上下文路径不存在或不可访问', 404)
      })
      if (this.mutationKey(currentRoot) !== this.mutationKey(grant.path)) {
        throw new AgentError('WORKSPACE_PATH_DENIED', '本地上下文根路径已被重定向', 403)
      }
      if (grant.kind === 'file') {
        if (this.mutationKey(canonical) !== this.mutationKey(grant.path))
          throw new AgentError('WORKSPACE_PATH_DENIED', '文件引用不能访问其他路径', 403)
      } else {
        const child = relative(currentRoot, canonical)
        if (child !== '' && (child.startsWith('..') || isAbsolute(child)))
          throw new AgentError('WORKSPACE_PATH_DENIED', '目录引用不能通过链接越界', 403)
      }
    }
    return canonical
  }

  private async createPath(path: string) {
    const requested = this.requestedPath(path)
    const alias = this.aliasTarget(path)
    if (!alias && path.replaceAll('\\', '/').toLowerCase() === '.pidex/config.json') {
      await mkdir(dirname(requested), { recursive: true })
    }
    const parent = await realpath(dirname(requested)).catch(() => {
      throw new AgentError('WORKSPACE_PATH_NOT_FOUND', '目标文件的父目录不存在或不可访问', 404)
    })
    if (alias) {
      if (parent !== dirname(alias))
        throw new AgentError('WORKSPACE_PATH_DENIED', '编辑器别名父目录无效', 403)
    } else {
      this.ensureWithinRoot(resolve(parent, basename(requested)))
    }
    const metadata = await stat(parent)
    if (!metadata.isDirectory())
      throw new AgentError('WORKSPACE_NOT_DIRECTORY', '目标文件的父路径不是目录', 400)
    const canonical = resolve(parent, basename(requested))
    if (alias) {
      if (canonical !== alias)
        throw new AgentError('WORKSPACE_PATH_DENIED', '编辑器别名目标无效', 403)
    } else {
      this.ensureWithinRoot(canonical)
    }
    try {
      await lstat(canonical)
      throw new AgentError('WORKSPACE_PATH_EXISTS', '目标文件已存在', 409)
    } catch (error) {
      if (error instanceof AgentError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AgentError('WORKSPACE_PATH_UNREADABLE', '目标文件状态无法确认', 400)
      }
    }
    return canonical
  }

  private mutationKey(path: string) {
    const normalized = resolve(path)
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  private async inspectNewFilePath(path: string) {
    const requested = this.requestedPath(path)
    const alias = this.aliasTarget(path)
    const parent = await realpath(dirname(requested)).catch(() => {
      throw new AgentError('WORKSPACE_PATH_NOT_FOUND', '目标文件的父目录不存在或不可访问', 404)
    })
    if (alias) {
      if (parent !== dirname(alias))
        throw new AgentError('WORKSPACE_PATH_DENIED', '编辑器别名父目录无效', 403)
    } else {
      this.ensureWithinRoot(resolve(parent, basename(requested)))
    }
    const metadata = await stat(parent)
    if (!metadata.isDirectory())
      throw new AgentError('WORKSPACE_NOT_DIRECTORY', '目标文件的父路径不是目录', 400)
    const canonical = resolve(parent, basename(requested))
    if (alias) {
      if (canonical !== alias)
        throw new AgentError('WORKSPACE_PATH_DENIED', '编辑器别名目标无效', 403)
    } else {
      this.ensureWithinRoot(canonical)
    }
    this.ensureWritable(canonical)
    try {
      await lstat(canonical)
      throw new AgentError('WORKSPACE_PATH_EXISTS', '目标文件已存在', 409)
    } catch (cause) {
      if (cause instanceof AgentError) throw cause
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AgentError('WORKSPACE_PATH_UNREADABLE', '目标文件状态无法确认', 400)
      }
    }
    return canonical
  }

  private async readMutationFileState(canonical: string) {
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError('WORKSPACE_NOT_FILE', '路径不是文本文件', 400)
    if ((metadata.mode & 0o222) === 0) {
      throw new AgentError('WORKSPACE_FILE_READONLY', '目标文件为只读文件，拒绝修改', 403)
    }
    if (metadata.size > EDITOR_WRITE_MAX_BYTES) {
      throw new AgentError(
        'WORKSPACE_FILE_READONLY',
        `超过 ${EDITOR_WRITE_MAX_BYTES} 字节的文件为只读`,
        409,
        {
          sizeBytes: metadata.size,
          maxBytes: EDITOR_WRITE_MAX_BYTES,
        },
      )
    }
    const bytes = await readFile(canonical).catch(() => {
      throw new AgentError('WORKSPACE_FILE_UNREADABLE', '文件无法读取', 400)
    })
    const current = await stat(canonical)
    if (!current.isFile()) throw new AgentError('WORKSPACE_NOT_FILE', '路径不是文本文件', 400)
    if (current.size !== bytes.byteLength || current.mtimeMs !== metadata.mtimeMs) {
      throw new AgentError('WORKSPACE_FILE_STALE', '文件在读取时发生变化，请重新读取', 409)
    }
    const content = decodeUtf8(bytes)
    return {
      content,
      metadata: current,
      utf8Bom: hasUtf8Bom(bytes),
      rawSha256: sha256Bytes(bytes),
      revision: {
        mtimeMs: current.mtimeMs,
        sha256: sha256(content),
        rawSha256: sha256Bytes(bytes),
        utf8Bom: hasUtf8Bom(bytes),
      },
    }
  }

  private async inspectMutationPathInternal(
    path: string,
    expectation: WorkspaceMutationExpectation,
  ): Promise<InternalMutationPathInspection> {
    if (expectation === 'new-file') {
      const canonicalPath = await this.inspectNewFilePath(path)
      return {
        expectation,
        path: this.displayPath(canonicalPath),
        canonicalPath,
        key: this.mutationKey(canonicalPath),
      }
    }
    const canonicalPath = await this.existingPath(path)
    this.ensureWritable(canonicalPath)
    const state = await this.readMutationFileState(canonicalPath)
    return {
      expectation,
      path: this.displayPath(canonicalPath),
      canonicalPath,
      key: this.mutationKey(canonicalPath),
      content: state.content,
      sizeBytes: Buffer.byteLength(state.content, 'utf8'),
      revision: state.revision,
      utf8Bom: state.utf8Bom,
      rawSha256: state.rawSha256,
      mode: state.metadata.mode,
    }
  }

  /** Resolves and validates a mutation target without creating directories or files. */
  async inspectMutationPath(
    path: string,
    expectation: WorkspaceMutationExpectation,
  ): Promise<WorkspaceMutationPathInspection> {
    const inspected = await this.inspectMutationPathInternal(path, expectation)
    if (inspected.expectation === 'new-file') {
      return {
        expectation: inspected.expectation,
        path: inspected.path,
        canonicalPath: inspected.canonicalPath,
      }
    }
    return {
      expectation: inspected.expectation,
      path: inspected.path,
      canonicalPath: inspected.canonicalPath,
      content: inspected.content,
      sizeBytes: inspected.sizeBytes,
      revision: inspected.revision,
      utf8Bom: inspected.utf8Bom,
      rawSha256: inspected.rawSha256,
    }
  }

  private async withMutationLocks<T>(keys: readonly string[], execute: () => Promise<T>) {
    const ordered = [...new Set(keys)].sort((left, right) => left.localeCompare(right))
    const predecessors = ordered.map(
      (key) => this.shared.mutationQueues.get(key) ?? Promise.resolve(),
    )
    const ready = Promise.all(
      predecessors.map((predecessor) => predecessor.catch(() => undefined)),
    ).then(() => undefined)
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const tail = ready.then(() => gate)
    for (const key of ordered) this.shared.mutationQueues.set(key, tail)
    await ready
    try {
      return await execute()
    } finally {
      release()
      for (const key of ordered) {
        if (this.shared.mutationQueues.get(key) === tail) this.shared.mutationQueues.delete(key)
      }
    }
  }

  private async replaceAtomically(
    path: string,
    content: string,
    mode?: number,
    maxBytes = MAX_FILE_BYTES,
  ) {
    this.ensureWritable(path)
    if (Buffer.byteLength(content, 'utf8') > maxBytes)
      throw new AgentError('WORKSPACE_FILE_TOO_LARGE', `最终文件超过 ${maxBytes} 字节上限`, 413)
    const bytes = Buffer.from(content, 'utf8')
    const temporary = resolve(dirname(path), `.pidex-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      if (mode !== undefined) await chmod(temporary, mode)
      if (mode === undefined) await rename(temporary, path)
      else await this.replaceExistingFile(path, temporary, bytes)
    } catch (cause) {
      await unlink(temporary).catch(() => undefined)
      if (cause instanceof AgentError) throw cause
      throw new AgentError('WORKSPACE_WRITE_FAILED', '无法原子写入工作区文件', 500)
    }
  }

  private async replaceExistingFile(path: string, temporary: string, expectedBytes: Uint8Array) {
    try {
      await rename(temporary, path)
      return
    } catch (cause) {
      if (!isWindowsReplaceBlocked(cause)) throw cause
    }

    await unlink(temporary).catch(() => undefined)
    await writeFile(path, expectedBytes, { flag: 'w', flush: true })
    const persisted = await readFile(path)
    if (sha256Bytes(persisted) !== sha256Bytes(expectedBytes)) {
      throw new AgentError('WORKSPACE_WRITE_FAILED', '工作区文件写入后校验失败', 500)
    }
  }

  private async directory(path?: string) {
    const canonical = await this.existingPath(path ?? '.')
    const metadata = await stat(canonical)
    if (!metadata.isDirectory())
      throw new AgentError('WORKSPACE_NOT_DIRECTORY', '路径不是目录', 400)
    return canonical
  }

  async list(path = '.') {
    const directory = await this.directory(path)
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => !IGNORED_DIRECTORIES.has(entry.name))
      .slice(0, LIST_LIMIT)
      .map((entry) => ({
        name: entry.name,
        path: this.displayPath(resolve(directory, entry.name)),
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }))
  }

  async listEditorFiles(path = '.'): Promise<WorkspaceFileEntry[]> {
    const directory = await this.directory(path || '.')
    const directoryPath = this.displayPath(directory)
    const depth = directoryPath === '.' ? 0 : directoryPath.split('/').length
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => {
      const typeOrder = Number(right.isDirectory()) - Number(left.isDirectory())
      return typeOrder || left.name.localeCompare(right.name)
    })

    const result: WorkspaceFileEntry[] = []
    for (const entry of entries) {
      if (result.length >= LIST_LIMIT) break
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue
      if (!entry.isDirectory() && !entry.isFile()) continue

      const entryPath = resolve(directory, entry.name)
      this.ensureReadable(entryPath)
      result.push({
        name: entry.name,
        path: this.displayPath(entryPath),
        type: entry.isDirectory() ? 'directory' : 'file',
        depth,
      })
    }
    return result
  }

  async read(path: string, offset = 0, limit = 400) {
    const canonical = await this.existingPath(path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError('WORKSPACE_NOT_FILE', '路径不是文本文件', 400)
    if (metadata.size > MAX_FILE_BYTES)
      throw new AgentError(
        'WORKSPACE_FILE_TOO_LARGE',
        `文件超过 ${MAX_FILE_BYTES} 字节读取上限`,
        413,
      )
    try {
      const text = decodeUtf8(await readFile(canonical))
      const fileLines = text.split(/\r?\n/)
      return fileLines
        .slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, Math.min(10_000, limit)))
        .join('\n')
    } catch {
      throw new AgentError('WORKSPACE_FILE_UNREADABLE', '文件无法按 UTF-8 读取', 400)
    }
  }

  async readEditorFile(path: string): Promise<WorkspaceEditorFile> {
    const canonical = await this.existingPath(path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError('WORKSPACE_NOT_FILE', '路径不是文本文件', 400)
    if (metadata.size > EDITOR_READ_MAX_BYTES) {
      throw new AgentError(
        'WORKSPACE_FILE_TOO_LARGE',
        `文件超过 ${EDITOR_READ_MAX_BYTES} 字节编辑器读取上限`,
        413,
        {
          sizeBytes: metadata.size,
          maxBytes: EDITOR_READ_MAX_BYTES,
        },
      )
    }
    let bytes: Buffer
    let content: string
    try {
      bytes = await readFile(canonical)
      content = decodeUtf8(bytes)
    } catch (cause) {
      if (cause instanceof AgentError) throw cause
      throw new AgentError('WORKSPACE_FILE_UNREADABLE', '文件无法按 UTF-8 读取', 400)
    }
    const current = await stat(canonical)
    if (!current.isFile()) throw new AgentError('WORKSPACE_NOT_FILE', '路径不是文本文件', 400)
    return {
      path: this.displayPath(canonical),
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      readonly: current.size > EDITOR_WRITE_MAX_BYTES,
      truncated: false,
      revision: {
        mtimeMs: current.mtimeMs,
        sha256: sha256(content),
        rawSha256: sha256Bytes(bytes),
        utf8Bom: hasUtf8Bom(bytes),
      },
    }
  }

  async watchEditorFile(path: string, onChange: (path: string) => void) {
    const canonical = await this.existingPath(path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError('WORKSPACE_NOT_FILE', '路径不是文本文件', 400)
    const displayPath = this.displayPath(canonical)
    let debounce: ReturnType<typeof setTimeout> | undefined
    const watcher = watchFileSystem(canonical, { persistent: false }, () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => onChange(displayPath), 50)
    })
    watcher.on('error', () => {
      if (debounce) clearTimeout(debounce)
    })
    return {
      path: displayPath,
      close: () => {
        if (debounce) clearTimeout(debounce)
        watcher.close()
      },
    }
  }

  async resolveEditorFilePath(path: string) {
    const canonical = await this.existingPath(path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError('WORKSPACE_NOT_FILE', '路径不是文本文件', 400)
    return this.displayPath(canonical)
  }

  /**
   * Preflights and stages every mutation before writing. Each target commit is
   * atomic, but a cross-file commit can still fail partway and reports that
   * state with PATCH_PARTIAL_COMMIT.
   */
  async commitEditorMutations(
    mutations: readonly EditorMutation[],
  ): Promise<EditorMutationCommitResult> {
    if (mutations.length === 0) throw new AgentError('INVALID_REQUEST', '文件变更不能为空', 400)
    for (const mutation of mutations) {
      if (mutation.operation === 'update' || mutation.operation === 'delete') {
        if (
          !Number.isFinite(mutation.expectedRevision.mtimeMs) ||
          mutation.expectedRevision.mtimeMs < 0 ||
          !/^[a-f\d]{64}$/i.test(mutation.expectedRevision.sha256) ||
          (mutation.expectedRevision.rawSha256 !== undefined &&
            !/^[a-f\d]{64}$/i.test(mutation.expectedRevision.rawSha256)) ||
          (mutation.expectedRevision.utf8Bom !== undefined &&
            typeof mutation.expectedRevision.utf8Bom !== 'boolean')
        ) {
          throw new AgentError('INVALID_REQUEST', 'expectedRevision 参数无效', 400)
        }
      }
      if (mutation.operation !== 'delete') {
        const normalized = encodeUtf8(mutation.content, false).content
        if (Buffer.byteLength(normalized, 'utf8') > EDITOR_WRITE_MAX_BYTES) {
          throw new AgentError(
            'WORKSPACE_FILE_READONLY',
            `编辑器只允许保存不超过 ${EDITOR_WRITE_MAX_BYTES} 字节的文件`,
            413,
            {
              sizeBytes: Buffer.byteLength(normalized, 'utf8'),
              maxBytes: EDITOR_WRITE_MAX_BYTES,
            },
          )
        }
      }
    }

    const initialInspections = await Promise.all(
      mutations.map((mutation) =>
        this.inspectMutationPathInternal(
          mutation.path,
          mutation.operation === 'create' ? 'new-file' : 'existing-file',
        ),
      ),
    )
    const keys = initialInspections.map((inspection) => inspection.key)
    if (new Set(keys).size !== keys.length) {
      throw new AgentError('INVALID_REQUEST', '同一批次不能多次修改同一个文件', 400)
    }

    return this.withMutationLocks(keys, async () => {
      type StagedMutation = {
        index: number
        key: string
        mutation: EditorMutation
        inspection: InternalMutationPathInspection
        content: string | null
        bytes: Buffer | null
        temporaryPath: string | null
      }

      const staged: StagedMutation[] = []
      const results: Array<EditorMutationResult | undefined> = Array.from({
        length: mutations.length,
      })
      const committed = new Set<number>()
      try {
        for (let index = 0; index < mutations.length; index += 1) {
          const mutation = mutations[index]!
          const initial = initialInspections[index]!
          const inspection = await this.inspectMutationPathInternal(
            mutation.path,
            mutation.operation === 'create' ? 'new-file' : 'existing-file',
          )
          if (inspection.key !== initial.key) {
            throw new AgentError(
              'WORKSPACE_FILE_STALE',
              '文件路径在写入前发生变化，请重新读取',
              409,
            )
          }
          if (mutation.operation === 'update' || mutation.operation === 'delete') {
            if (inspection.expectation !== 'existing-file') {
              throw new AgentError('WORKSPACE_FILE_STALE', '文件在写入前发生变化，请重新读取', 409)
            }
            const expectedSha256 = mutation.expectedRevision.sha256.toLowerCase()
            if (
              inspection.revision.mtimeMs !== mutation.expectedRevision.mtimeMs ||
              inspection.revision.sha256 !== expectedSha256 ||
              (mutation.expectedRevision.rawSha256 !== undefined &&
                inspection.rawSha256 !== mutation.expectedRevision.rawSha256.toLowerCase()) ||
              (mutation.expectedRevision.utf8Bom !== undefined &&
                inspection.utf8Bom !== mutation.expectedRevision.utf8Bom)
            ) {
              throw new AgentError('WORKSPACE_FILE_STALE', '文件在写入前发生变化，拒绝覆写', 409, {
                currentRevision: inspection.revision,
              })
            }
          }
          const encoded =
            mutation.operation === 'delete'
              ? null
              : encodeUtf8(
                  mutation.content,
                  inspection.expectation === 'existing-file' && inspection.utf8Bom,
                )
          staged.push({
            index,
            key: inspection.key,
            mutation,
            inspection,
            content: encoded?.content ?? null,
            bytes: encoded?.bytes ?? null,
            temporaryPath: encoded
              ? resolve(dirname(inspection.canonicalPath), `.pidex-${randomUUID()}.tmp`)
              : null,
          })
        }

        for (const item of staged) {
          if (item.temporaryPath && item.bytes) {
            await writeFile(item.temporaryPath, item.bytes, { flag: 'wx' })
            if (item.inspection.expectation === 'existing-file') {
              await chmod(item.temporaryPath, item.inspection.mode)
            }
          }
        }

        for (const item of staged) {
          const current = await this.inspectMutationPathInternal(
            item.mutation.path,
            item.mutation.operation === 'create' ? 'new-file' : 'existing-file',
          )
          if (current.key !== item.key) {
            throw new AgentError(
              'WORKSPACE_FILE_STALE',
              '文件路径在提交前发生变化，请重新读取',
              409,
            )
          }
          if (
            current.expectation === 'existing-file' &&
            item.inspection.expectation === 'existing-file' &&
            (current.rawSha256 !== item.inspection.rawSha256 ||
              current.revision.mtimeMs !== item.inspection.revision.mtimeMs)
          ) {
            throw new AgentError('WORKSPACE_FILE_STALE', '文件在提交前发生变化，拒绝覆写', 409, {
              currentRevision: current.revision,
            })
          }
        }

        const commitOrder = [...staged].sort((left, right) => left.key.localeCompare(right.key))
        for (const item of commitOrder) {
          const current = await this.inspectMutationPathInternal(
            item.mutation.path,
            item.mutation.operation === 'create' ? 'new-file' : 'existing-file',
          )
          if (current.key !== item.key) {
            throw new AgentError(
              'WORKSPACE_FILE_STALE',
              '文件路径在提交前发生变化，请重新读取',
              409,
            )
          }
          if (
            current.expectation === 'existing-file' &&
            item.inspection.expectation === 'existing-file' &&
            (current.rawSha256 !== item.inspection.rawSha256 ||
              current.revision.mtimeMs !== item.inspection.revision.mtimeMs)
          ) {
            throw new AgentError('WORKSPACE_FILE_STALE', '文件在提交前发生变化，拒绝覆写', 409, {
              currentRevision: current.revision,
            })
          }
          if (item.mutation.operation === 'delete') {
            await unlink(item.inspection.canonicalPath)
            committed.add(item.index)
          } else if (item.mutation.operation === 'create') {
            await link(item.temporaryPath!, item.inspection.canonicalPath)
            committed.add(item.index)
            await unlink(item.temporaryPath!)
          } else {
            await this.replaceExistingFile(
              item.inspection.canonicalPath,
              item.temporaryPath!,
              item.bytes!,
            )
            committed.add(item.index)
          }
          item.temporaryPath = null
          if (item.mutation.operation === 'delete') {
            results[item.index] = {
              operation: 'delete',
              path: item.inspection.path,
              beforeSha256:
                item.inspection.expectation === 'existing-file'
                  ? item.inspection.revision.sha256
                  : null,
              afterSha256: null,
              revision: null,
            }
            continue
          }
          const saved = await stat(item.inspection.canonicalPath)
          results[item.index] = {
            operation: item.mutation.operation,
            path: item.inspection.path,
            beforeSha256:
              item.inspection.expectation === 'existing-file'
                ? item.inspection.revision.sha256
                : null,
            afterSha256: sha256(item.content!),
            revision: {
              mtimeMs: saved.mtimeMs,
              sha256: sha256(item.content!),
              rawSha256: sha256Bytes(item.bytes!),
              utf8Bom: hasUtf8Bom(item.bytes!),
            },
          }
        }
      } catch (cause) {
        await Promise.all(
          staged.map((item) =>
            item.temporaryPath
              ? unlink(item.temporaryPath).catch(() => undefined)
              : Promise.resolve(),
          ),
        )
        if (committed.size > 0) {
          throw new AgentError(
            'PATCH_PARTIAL_COMMIT',
            '补丁仅部分写入，请重新读取相关文件后重试',
            500,
            {
              committed: staged
                .filter((item) => committed.has(item.index))
                .map((item) => item.inspection.path),
              pending: staged
                .filter((item) => !committed.has(item.index))
                .map((item) => item.inspection.path),
            },
          )
        }
        if (cause instanceof AgentError) throw cause
        throw new AgentError('WORKSPACE_WRITE_FAILED', '无法原子写入工作区文件', 500)
      }
      return {
        outcome: 'committed',
        files: results.map((result) => result!),
      }
    })
  }

  async saveEditorFile(path: string, content: string, expectedRevision: WorkspaceFileRevision) {
    if (
      !Number.isFinite(expectedRevision.mtimeMs) ||
      expectedRevision.mtimeMs < 0 ||
      !/^[a-f\d]{64}$/i.test(expectedRevision.sha256)
    ) {
      throw new AgentError('INVALID_REQUEST', 'expectedRevision 参数无效', 400)
    }
    try {
      const committed = await this.commitEditorMutations([
        {
          operation: 'update',
          path,
          content,
          expectedRevision,
        },
      ])
      return {
        outcome: 'saved' as const,
        revision: committed.files[0]!.revision,
      }
    } catch (cause) {
      if (cause instanceof AgentError && cause.code === 'WORKSPACE_FILE_STALE') {
        const currentRevision =
          cause.details && typeof cause.details === 'object' && 'currentRevision' in cause.details
            ? (cause.details as { currentRevision: WorkspaceFileRevision }).currentRevision
            : null
        if (currentRevision) return { outcome: 'conflict' as const, revision: currentRevision }
      }
      throw cause
    }
  }

  async search(
    path: string,
    query: string,
    signal: AbortSignal,
    limit = SEARCH_LIMIT,
  ): Promise<WorkspaceSearchResult[]> {
    if (!query.trim()) throw new AgentError('INVALID_TOOL_INPUT', 'query 必须是非空字符串', 400)
    const root = await this.directory(path)
    const found: WorkspaceSearchResult[] = []
    const needle = query.toLowerCase()
    const deadline = Date.now() + SEARCH_TIMEOUT_MS
    let visitedFiles = 0
    let readBytes = 0
    const visit = async (directory: string): Promise<void> => {
      if (
        signal.aborted ||
        found.length >= limit ||
        visitedFiles >= SEARCH_MAX_FILES ||
        readBytes >= SEARCH_MAX_BYTES ||
        Date.now() >= deadline
      )
        return
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (
          signal.aborted ||
          found.length >= limit ||
          visitedFiles >= SEARCH_MAX_FILES ||
          readBytes >= SEARCH_MAX_BYTES ||
          Date.now() >= deadline
        )
          return
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue
        const candidate = resolve(directory, entry.name)
        if (entry.isDirectory()) {
          await visit(candidate)
          continue
        }
        if (!entry.isFile()) continue
        visitedFiles += 1
        const display = this.displayPath(candidate)
        if (entry.name.toLowerCase().includes(needle)) {
          found.push({ path: display })
          continue
        }
        try {
          const size = (await stat(candidate)).size
          if (size > MAX_FILE_BYTES || readBytes + size > SEARCH_MAX_BYTES) continue
          readBytes += size
          const text = decodeUtf8(await readFile(candidate))
          const lines = text.split(/\r?\n/)
          const index = lines.findIndex((line) => line.toLowerCase().includes(needle))
          if (index >= 0) {
            const preview = lines[index]?.trim()
            found.push({
              path: display,
              line: index + 1,
              ...(preview === undefined ? {} : { preview }),
            })
          }
        } catch {
          // Binary and unreadable files are deliberately skipped.
        }
      }
    }
    await visit(root)
    if (signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
    if (Date.now() >= deadline)
      throw new AgentError('WORKSPACE_SEARCH_TIMEOUT', '工作区搜索超过 10 秒预算', 408)
    return found
  }

  async applyPatch(input: ApplyPatchInput): Promise<ApplyPatchResult> {
    if (input.operation === 'create') {
      if (Buffer.byteLength(input.content, 'utf8') > MAX_FILE_BYTES)
        throw new AgentError(
          'WORKSPACE_FILE_TOO_LARGE',
          `最终文件超过 ${MAX_FILE_BYTES} 字节上限`,
          413,
        )
      const canonical = await this.createPath(input.path)
      await this.replaceAtomically(canonical, input.content)
      const path = this.displayPath(canonical)
      return {
        operation: input.operation,
        path,
        diff: unifiedDiff(path, null, input.content),
        additions: lineCount(input.content),
        deletions: 0,
        beforeSha256: null,
        afterSha256: sha256(input.content),
      }
    }

    const canonical = await this.existingPath(input.path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError('WORKSPACE_NOT_FILE', '路径不是文本文件', 400)
    if (metadata.size > MAX_FILE_BYTES)
      throw new AgentError(
        'WORKSPACE_FILE_TOO_LARGE',
        `文件超过 ${MAX_FILE_BYTES} 字节读取上限`,
        413,
      )
    const current = await readFile(canonical)
      .then(decodeUtf8)
      .catch(() => {
        throw new AgentError('WORKSPACE_FILE_UNREADABLE', '文件无法按 UTF-8 读取', 400)
      })
    const path = this.displayPath(canonical)
    const beforeSha256 = sha256(current)

    if (input.operation === 'delete') {
      if (!/^[a-f\d]{64}$/i.test(input.expectedSha256)) {
        throw new AgentError(
          'INVALID_TOOL_INPUT',
          'expectedSha256 必须是 64 位十六进制 SHA-256',
          400,
        )
      }
      if (input.expectedSha256.toLowerCase() !== beforeSha256) {
        throw new AgentError('PATCH_SHA256_MISMATCH', '文件内容已变化，拒绝删除', 409)
      }
      this.ensureWritable(canonical)
      await unlink(canonical)
      return {
        operation: input.operation,
        path,
        diff: unifiedDiff(path, current, null),
        additions: 0,
        deletions: lineCount(current),
        beforeSha256,
        afterSha256: null,
      }
    }

    const index = uniqueContextIndex(current, input.before)
    const updated = `${current.slice(0, index)}${input.after}${current.slice(index + input.before.length)}`
    if (Buffer.byteLength(updated, 'utf8') > MAX_FILE_BYTES)
      throw new AgentError(
        'WORKSPACE_FILE_TOO_LARGE',
        `最终文件超过 ${MAX_FILE_BYTES} 字节上限`,
        413,
      )
    await this.replaceAtomically(canonical, updated, metadata.mode)
    return {
      operation: input.operation,
      path,
      diff: unifiedDiff(path, input.before, input.after, lineNumberAt(current, index)),
      additions: lineCount(input.after),
      deletions: lineCount(input.before),
      beforeSha256,
      afterSha256: sha256(updated),
    }
  }
}
