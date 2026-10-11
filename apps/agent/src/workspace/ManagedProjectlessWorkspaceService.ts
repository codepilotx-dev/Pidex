import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { AgentError } from '../Domain'

const MARKER_NAME = '.pidex-projectless.json'
// 托管无项目工作区的固定目录名。品牌清零后改用新名称；旧名称下的既有目录不会被
// 删除或改写，但不再被识别，需由用户自行确认后处理。
const MANAGED_ROOT_DIRECTORY_NAME = 'Pidex'
const MAX_SLUG_LENGTH = 80
const MAX_NUMBERED_ATTEMPTS = 100
const MAX_RANDOM_ATTEMPTS = 5

type MarkerState = 'allocating' | 'active'

type ManagedProjectlessWorkspaceMarker = {
  schemaVersion: 1
  workspaceID: string
  threadID: string
  state: MarkerState
  createdAt: number
}

export type ManagedProjectlessWorkspaceAllocation = {
  workspaceID: string
  threadID: string
  managedRoot: string
  sessionRoot: string
  cwd: string
  outputDirectory: string
  slug: string
  createdAt: number
}

export type ManagedProjectlessWorkspaceRecord = ManagedProjectlessWorkspaceAllocation & {
  state: MarkerState
}

export type PersistedProjectlessWorkspace = {
  threadID: string
  sessionRoot: string
  cwd: string
  outputDirectory: string
}

export type AllocateManagedProjectlessWorkspaceInput = {
  workspaceID: string
  threadID: string
  prompt?: string
  directoryName?: string
  now?: Date
}

const applicationError = (
  cause: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  status = 500,
) => {
  if (cause instanceof AgentError) return cause
  const code =
    cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : fallbackCode
  const message =
    cause instanceof Error && cause.message
      ? `${fallbackMessage}：${cause.message}`
      : fallbackMessage
  return new AgentError(code, message, status)
}

const pathIsWithin = (parent: string, child: string) => {
  const result = relative(parent, child)
  return result === '' || (!result.startsWith('..') && !isAbsolute(result))
}

const localDateSegment = (date: Date) => {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const projectlessWorkspaceSlug = (prompt?: string, directoryName?: string) => {
  const source = directoryName?.trim() || prompt?.trim() || ''
  const tokens = source.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const selected = directoryName?.trim() ? tokens : tokens.slice(0, 6)
  return selected.join('-').slice(0, MAX_SLUG_LENGTH).replace(/-+$/u, '') || 'new-chat'
}

/**
 * Owns the on-disk lifecycle of Agent-managed projectless workspaces.
 * Renderer input never supplies a path; every path is derived below the configured Documents directory.
 */
export class ManagedProjectlessWorkspaceService {
  readonly documentsDir: string

  constructor(documentsDir: string) {
    if (!isAbsolute(documentsDir))
      throw new AgentError(
        'PROJECTLESS_DOCUMENTS_PATH_INVALID',
        'Documents 路径必须是绝对路径',
        500,
      )
    this.documentsDir = resolve(documentsDir)
  }

  async allocate(
    input: AllocateManagedProjectlessWorkspaceInput,
  ): Promise<ManagedProjectlessWorkspaceAllocation> {
    if (!input.workspaceID.trim() || !input.threadID.trim()) {
      throw new AgentError(
        'PROJECTLESS_WORKSPACE_ID_INVALID',
        '无项目工作区缺少 workspace/thread 标识',
        400,
      )
    }

    const createdAt = (input.now ?? new Date()).getTime()
    const dateSegment = localDateSegment(input.now ?? new Date(createdAt))
    const slug = projectlessWorkspaceSlug(input.prompt, input.directoryName)
    let sessionRoot: string | null = null
    let allocation: ManagedProjectlessWorkspaceAllocation | null = null

    try {
      const documentsRoot = await this.canonicalDocumentsRoot()
      const managedRoot = await this.ensureOwnedDirectory(
        documentsRoot,
        MANAGED_ROOT_DIRECTORY_NAME,
      )
      const dateRoot = await this.ensureOwnedDirectory(managedRoot, dateSegment)
      sessionRoot = await this.reserveSessionRoot(dateRoot, slug)
      const marker: ManagedProjectlessWorkspaceMarker = {
        schemaVersion: 1,
        workspaceID: input.workspaceID,
        threadID: input.threadID,
        state: 'allocating',
        createdAt,
      }
      await this.writeMarker(sessionRoot, marker)
      const cwd = await this.createRequiredChild(sessionRoot, 'work')
      const outputDirectory = await this.createRequiredChild(sessionRoot, 'outputs')
      allocation = {
        workspaceID: input.workspaceID,
        threadID: input.threadID,
        managedRoot,
        sessionRoot,
        cwd,
        outputDirectory,
        slug,
        createdAt,
      }
      await this.validate({ ...allocation, state: 'allocating' })
      return allocation
    } catch (cause) {
      if (sessionRoot)
        await this.removeCreatedSessionRoot(sessionRoot, allocation?.managedRoot).catch(
          () => undefined,
        )
      throw applicationError(cause, 'PROJECTLESS_WORKSPACE_CREATE_FAILED', '无法创建无项目工作区')
    }
  }

  async activate(
    allocation: ManagedProjectlessWorkspaceAllocation,
  ): Promise<ManagedProjectlessWorkspaceRecord> {
    await this.validate({ ...allocation, state: 'allocating' })
    await this.writeMarker(allocation.sessionRoot, {
      schemaVersion: 1,
      workspaceID: allocation.workspaceID,
      threadID: allocation.threadID,
      state: 'active',
      createdAt: allocation.createdAt,
    })
    const active = { ...allocation, state: 'active' as const }
    await this.validate(active)
    return active
  }

  async rollback(allocation: ManagedProjectlessWorkspaceAllocation) {
    await this.validate({ ...allocation, state: 'allocating' })
    await this.removeCreatedSessionRoot(allocation.sessionRoot, allocation.managedRoot)
  }

  async validate(record: ManagedProjectlessWorkspaceRecord) {
    const documentsRoot = await this.canonicalDocumentsRoot()
    const managedRoot = await this.validateDirectory(record.managedRoot, documentsRoot)
    const sessionRoot = await this.validateSessionRoot(record.sessionRoot, managedRoot)
    const marker = await this.readMarker(sessionRoot)
    if (
      marker.workspaceID !== record.workspaceID ||
      marker.threadID !== record.threadID ||
      marker.createdAt !== record.createdAt ||
      marker.state !== record.state
    ) {
      throw new AgentError(
        'PROJECTLESS_WORKSPACE_MARKER_MISMATCH',
        '无项目工作区标记与持久化记录不一致',
        409,
      )
    }
    const cwd = await this.validateDirectory(record.cwd, sessionRoot)
    const outputDirectory = await this.validateDirectory(record.outputDirectory, sessionRoot)
    if (
      resolve(cwd) !== resolve(sessionRoot, 'work') ||
      resolve(outputDirectory) !== resolve(sessionRoot, 'outputs')
    ) {
      throw new AgentError('PROJECTLESS_WORKSPACE_LAYOUT_INVALID', '无项目工作区目录结构无效', 409)
    }
    return { ...record, managedRoot, sessionRoot, cwd, outputDirectory }
  }

  async validatePersisted(record: PersistedProjectlessWorkspace) {
    const documentsRoot = await this.canonicalDocumentsRoot()
    const managedRoot = await this.validateDirectory(
      resolve(documentsRoot, MANAGED_ROOT_DIRECTORY_NAME),
      documentsRoot,
    )
    const sessionRoot = await this.validateSessionRoot(record.sessionRoot, managedRoot)
    const marker = await this.readMarker(sessionRoot)
    if (marker.threadID !== record.threadID || marker.state !== 'active') {
      throw new AgentError(
        'PROJECTLESS_WORKSPACE_MARKER_MISMATCH',
        '无项目工作区标记与会话不一致',
        409,
      )
    }
    const cwd = await this.validateDirectory(record.cwd, sessionRoot)
    const outputDirectory = await this.validateDirectory(record.outputDirectory, sessionRoot)
    if (
      resolve(cwd) !== resolve(sessionRoot, 'work') ||
      resolve(outputDirectory) !== resolve(sessionRoot, 'outputs')
    ) {
      throw new AgentError('PROJECTLESS_WORKSPACE_LAYOUT_INVALID', '无项目工作区目录结构无效', 409)
    }
    return {
      ...record,
      managedRoot,
      sessionRoot,
      cwd,
      outputDirectory,
      workspaceID: marker.workspaceID,
      createdAt: marker.createdAt,
      state: marker.state,
    }
  }

  async ensureActivePersisted(record: PersistedProjectlessWorkspace) {
    const documentsRoot = await this.canonicalDocumentsRoot()
    const managedRoot = await this.validateDirectory(
      resolve(documentsRoot, MANAGED_ROOT_DIRECTORY_NAME),
      documentsRoot,
    )
    const sessionRoot = await this.validateSessionRoot(record.sessionRoot, managedRoot)
    const marker = await this.readMarker(sessionRoot)
    if (marker.threadID !== record.threadID) {
      throw new AgentError(
        'PROJECTLESS_WORKSPACE_MARKER_MISMATCH',
        '无项目工作区标记与会话不一致',
        409,
      )
    }
    if (marker.state === 'allocating')
      await this.writeMarker(sessionRoot, { ...marker, state: 'active' })
    return this.validatePersisted(record)
  }

  private async canonicalDocumentsRoot() {
    try {
      const canonical = await realpath(this.documentsDir)
      const metadata = await lstat(canonical)
      if (!metadata.isDirectory())
        throw new AgentError('PROJECTLESS_DOCUMENTS_NOT_DIRECTORY', 'Documents 路径不是目录', 500)
      return canonical
    } catch (cause) {
      throw applicationError(cause, 'PROJECTLESS_DOCUMENTS_UNAVAILABLE', '无法访问 Documents 目录')
    }
  }

  private async ensureOwnedDirectory(parent: string, name: string) {
    const requested = resolve(parent, name)
    if (!pathIsWithin(parent, requested) || requested === parent)
      throw new AgentError('PROJECTLESS_WORKSPACE_PATH_DENIED', '无项目工作区路径越界', 403)
    try {
      await mkdir(requested, { recursive: false })
    } catch (cause) {
      if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'EEXIST'))
        throw cause
    }
    return this.validateDirectory(requested, parent)
  }

  private async createRequiredChild(parent: string, name: 'work' | 'outputs') {
    const requested = resolve(parent, name)
    await mkdir(requested, { recursive: false })
    return this.validateDirectory(requested, parent)
  }

  private async reserveSessionRoot(dateRoot: string, slug: string) {
    const candidates = [slug]
    for (let index = 2; index <= MAX_NUMBERED_ATTEMPTS; index += 1)
      candidates.push(`${slug}-${index}`)
    for (let index = 0; index < MAX_RANDOM_ATTEMPTS; index += 1)
      candidates.push(`${slug}-${crypto.randomUUID()}`)
    for (const candidate of candidates) {
      const requested = resolve(dateRoot, candidate)
      if (!pathIsWithin(dateRoot, requested) || requested === dateRoot)
        throw new AgentError('PROJECTLESS_WORKSPACE_PATH_DENIED', '无项目工作区路径越界', 403)
      try {
        await mkdir(requested, { recursive: false })
        return this.validateDirectory(requested, dateRoot)
      } catch (cause) {
        if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'EEXIST')
          continue
        throw cause
      }
    }
    throw new AgentError('PROJECTLESS_WORKSPACE_COLLISION', '无法为无项目会话分配唯一目录', 409)
  }

  private async validateDirectory(path: string, expectedParent: string) {
    const requested = resolve(path)
    const parent = await realpath(resolve(expectedParent))
    if (!pathIsWithin(parent, requested) || requested === parent)
      throw new AgentError('PROJECTLESS_WORKSPACE_PATH_DENIED', '无项目工作区路径越界', 403)
    const metadata = await lstat(requested)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new AgentError(
        'PROJECTLESS_WORKSPACE_REPARSE_DENIED',
        '无项目工作区不能使用符号链接或非目录路径',
        403,
      )
    }
    const canonical = await realpath(requested)
    if (!pathIsWithin(parent, canonical) || canonical === parent)
      throw new AgentError('PROJECTLESS_WORKSPACE_PATH_DENIED', '无项目工作区真实路径越界', 403)
    return canonical
  }

  private async validateSessionRoot(sessionRoot: string, managedRoot: string) {
    const canonical = await this.validateDirectory(sessionRoot, managedRoot)
    const segments = relative(managedRoot, canonical).split(sep).filter(Boolean)
    if (segments.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/u.test(segments[0] ?? '')) {
      throw new AgentError('PROJECTLESS_WORKSPACE_LAYOUT_INVALID', '无项目工作区层级无效', 409)
    }
    return canonical
  }

  private async writeMarker(sessionRoot: string, marker: ManagedProjectlessWorkspaceMarker) {
    const markerPath = resolve(sessionRoot, MARKER_NAME)
    const temporaryPath = resolve(sessionRoot, `${MARKER_NAME}.${crypto.randomUUID()}.tmp`)
    await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    try {
      await rename(temporaryPath, markerPath)
    } catch (cause) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw cause
    }
  }

  private async readMarker(sessionRoot: string): Promise<ManagedProjectlessWorkspaceMarker> {
    try {
      const value = JSON.parse(
        await readFile(resolve(sessionRoot, MARKER_NAME), 'utf8'),
      ) as Partial<ManagedProjectlessWorkspaceMarker>
      if (
        value.schemaVersion !== 1 ||
        typeof value.workspaceID !== 'string' ||
        typeof value.threadID !== 'string' ||
        (value.state !== 'allocating' && value.state !== 'active') ||
        typeof value.createdAt !== 'number'
      )
        throw new Error('marker schema invalid')
      return value as ManagedProjectlessWorkspaceMarker
    } catch (cause) {
      throw applicationError(
        cause,
        'PROJECTLESS_WORKSPACE_MARKER_INVALID',
        '无项目工作区标记无效',
        409,
      )
    }
  }

  private async removeCreatedSessionRoot(sessionRoot: string, knownManagedRoot?: string) {
    const documentsRoot = await this.canonicalDocumentsRoot()
    const managedRoot = knownManagedRoot
      ? await this.validateDirectory(knownManagedRoot, documentsRoot)
      : await this.validateDirectory(
          resolve(documentsRoot, MANAGED_ROOT_DIRECTORY_NAME),
          documentsRoot,
        )
    const canonical = await this.validateSessionRoot(sessionRoot, managedRoot)
    await rm(canonical, { recursive: true, force: false })
  }
}
