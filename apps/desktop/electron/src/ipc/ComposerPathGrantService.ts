import { randomUUID } from 'node:crypto'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import type { Stats } from 'node:fs'
import type {
  DesktopComposerPathGrant,
  DesktopComposerPathListInput,
  DesktopComposerPathListResult,
  DesktopComposerPathPreview,
  DesktopComposerPathReadInput,
} from '@pidex/shared/desktop-attachment-ipc'
import { isRecord } from '@pidex/shared/guards'

const MAX_GRANTED_PATHS_PER_CALL = 64
const MAX_PATH_LENGTH = 32_767
const DEFAULT_DIRECTORY_PAGE_SIZE = 100
const MAX_DIRECTORY_PAGE_SIZE = 200
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024
const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024

type StoredGrant = DesktopComposerPathGrant & {
  canonicalPathKey: string
}

export class ComposerPathGrantService {
  readonly #grantsByOwner = new Map<number, Map<string, StoredGrant>>()

  async grantPaths(ownerId: number, input: unknown): Promise<DesktopComposerPathGrant[]> {
    const paths = requirePathList(input)
    const grants = this.#grantsByOwner.get(ownerId) ?? new Map()
    this.#grantsByOwner.set(ownerId, grants)
    const grantsByPath = new Map(
      [...grants.values()].map((grant) => [grant.canonicalPathKey, grant]),
    )
    const result: DesktopComposerPathGrant[] = []
    const returnedPaths = new Set<string>()

    for (const path of paths) {
      let resolvedPath: string
      let info: Awaited<ReturnType<typeof stat>>
      try {
        resolvedPath = await realpath(path)
        info = await stat(resolvedPath)
      } catch {
        throw new Error('无法访问所选文件或目录')
      }
      if (!info.isFile() && !info.isDirectory()) {
        throw new Error('不支持所选路径类型')
      }

      const canonicalPathKey = canonicalPath(resolvedPath)
      if (returnedPaths.has(canonicalPathKey)) continue
      returnedPaths.add(canonicalPathKey)
      const existing = grantsByPath.get(canonicalPathKey)
      if (existing) {
        result.push(publicGrant(existing))
        continue
      }

      const grant: StoredGrant = {
        grantId: randomUUID(),
        name: basename(resolvedPath),
        path: resolvedPath,
        pathKind: info.isDirectory() ? 'directory' : 'file',
        mediaType: info.isDirectory() ? 'inode/directory' : mediaTypeForPath(resolvedPath),
        sizeBytes: info.isFile() ? info.size : 0,
        canonicalPathKey,
      }
      grants.set(grant.grantId, grant)
      grantsByPath.set(canonicalPathKey, grant)
      result.push(publicGrant(grant))
    }
    return result
  }

  clearOwner(ownerId: number): void {
    this.#grantsByOwner.delete(ownerId)
  }

  async read(ownerId: number, input: unknown): Promise<DesktopComposerPathPreview> {
    const request = requireReadInput(input)
    const grant = this.#requireGrant(ownerId, request.grantId)
    const target = await this.#resolveGrantedTarget(grant, request.relativePath)
    const info = await safeStat(target.path)
    if (!info.isFile()) throw new Error('所选项目不是可预览文件')

    const mediaType = mediaTypeForPath(target.path)
    const base = {
      name: basename(target.path),
      relativePath: target.relativePath,
      mediaType,
      sizeBytes: info.size,
    }
    if (mediaType.startsWith('image/') && !request.range) {
      if (info.size > MAX_IMAGE_PREVIEW_BYTES) {
        return { ...base, kind: 'binary' }
      }
      const content = await readBytes(target.path, 0, info.size)
      return {
        ...base,
        kind: 'image',
        encoding: 'base64',
        data: content.toString('base64'),
        truncated: false,
      }
    }

    if (!isTextPreviewPath(target.path)) {
      return { ...base, kind: 'binary' }
    }
    const offset = request.range?.offset ?? 0
    const requestedLength =
      request.range?.length ?? Math.min(info.size - offset, MAX_TEXT_PREVIEW_BYTES)
    const length = Math.min(
      requestedLength,
      MAX_TEXT_PREVIEW_BYTES,
      Math.max(0, info.size - offset),
    )
    const content = await readBytes(target.path, offset, length)
    try {
      return {
        ...base,
        kind: 'text',
        encoding: 'utf8',
        data: new TextDecoder('utf-8', { fatal: true }).decode(content),
        truncated: offset + content.byteLength < info.size,
      }
    } catch {
      return { ...base, kind: 'binary' }
    }
  }

  async list(ownerId: number, input: unknown): Promise<DesktopComposerPathListResult> {
    const request = requireListInput(input)
    const grant = this.#requireGrant(ownerId, request.grantId)
    const target = await this.#resolveGrantedTarget(grant, request.relativePath)
    const targetInfo = await safeStat(target.path)
    if (!targetInfo.isDirectory()) throw new Error('所选项目不是目录')

    let children
    try {
      children = await readdir(target.path, { withFileTypes: true })
    } catch {
      throw new Error('无法读取所选目录')
    }
    children.sort((left, right) => left.name.localeCompare(right.name))
    const entries = []
    for (const child of children) {
      try {
        const childRelativePath = target.relativePath
          ? `${target.relativePath}/${child.name}`
          : child.name
        const childTarget = await this.#resolveGrantedTarget(grant, childRelativePath)
        const childInfo = await stat(childTarget.path)
        if (!childInfo.isFile() && !childInfo.isDirectory()) continue
        entries.push({
          name: child.name,
          relativePath: childRelativePath,
          pathKind: childInfo.isDirectory() ? ('directory' as const) : ('file' as const),
          mediaType: childInfo.isDirectory()
            ? 'inode/directory'
            : mediaTypeForPath(childTarget.path),
          sizeBytes: childInfo.isFile() ? childInfo.size : 0,
        })
      } catch {
        // Broken links and links escaping the grant are intentionally hidden.
      }
    }

    const start = request.cursor ? Number(request.cursor) : 0
    const limit = request.limit ?? DEFAULT_DIRECTORY_PAGE_SIZE
    const page = entries.slice(start, start + limit)
    const nextOffset = start + page.length
    return {
      entries: page,
      nextCursor: nextOffset < entries.length ? String(nextOffset) : null,
    }
  }

  #requireGrant(ownerId: number, grantId: string): StoredGrant {
    const grant = this.#grantsByOwner.get(ownerId)?.get(grantId)
    if (!grant) throw new Error('本地预览授权无效或已过期')
    return grant
  }

  async #resolveGrantedTarget(
    grant: StoredGrant,
    requestedRelativePath: string | undefined,
  ): Promise<{ path: string; relativePath: string }> {
    let currentRoot: string
    try {
      currentRoot = await realpath(grant.path)
    } catch {
      throw new Error('所选文件或目录已不可用')
    }
    if (canonicalPath(currentRoot) !== grant.canonicalPathKey) {
      throw new Error('所选文件或目录已发生变化')
    }

    const relativePath = normalizeRelativePath(requestedRelativePath)
    if (grant.pathKind === 'file') {
      if (relativePath) throw new Error('文件授权不允许访问其他路径')
      return { path: currentRoot, relativePath: '' }
    }
    const candidate = resolve(currentRoot, relativePath || '.')
    if (!isSameOrDescendant(currentRoot, candidate)) {
      throw new Error('目录预览路径无效')
    }
    let resolvedTarget: string
    try {
      resolvedTarget = await realpath(candidate)
    } catch {
      throw new Error('所选文件或目录已不可用')
    }
    if (!isSameOrDescendant(currentRoot, resolvedTarget)) {
      throw new Error('目录预览路径无效')
    }
    return { path: resolvedTarget, relativePath }
  }
}

function requirePathList(input: unknown): string[] {
  if (
    !Array.isArray(input) ||
    input.length > MAX_GRANTED_PATHS_PER_CALL ||
    !input.every(
      (path) =>
        typeof path === 'string' &&
        path.length >= 1 &&
        path.length <= MAX_PATH_LENGTH &&
        isAbsolute(path),
    )
  ) {
    throw new Error('所选路径参数无效')
  }
  return input
}

function requireReadInput(input: unknown): DesktopComposerPathReadInput {
  if (!isRecord(input) || !isGrantId(input.grantId)) {
    throw new Error('本地预览参数无效')
  }
  const relativePath = requireOptionalRelativePath(input.relativePath)
  let range: DesktopComposerPathReadInput['range']
  if (input.range !== undefined) {
    if (!isRecord(input.range)) throw new Error('本地预览参数无效')
    const offset = input.range.offset === undefined ? 0 : input.range.offset
    const length = input.range.length === undefined ? MAX_TEXT_PREVIEW_BYTES : input.range.length
    if (
      typeof offset !== 'number' ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > MAX_TEXT_PREVIEW_BYTES
    ) {
      throw new Error('本地预览范围无效')
    }
    range = { offset, length }
  }
  return { grantId: input.grantId, relativePath, range }
}

function requireListInput(input: unknown): DesktopComposerPathListInput {
  if (!isRecord(input) || !isGrantId(input.grantId)) {
    throw new Error('目录预览参数无效')
  }
  const relativePath = requireOptionalRelativePath(input.relativePath)
  const cursor = input.cursor
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^\d+$/.test(cursor))) {
    throw new Error('目录预览游标无效')
  }
  const limit = input.limit
  if (
    limit !== undefined &&
    (typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_DIRECTORY_PAGE_SIZE)
  ) {
    throw new Error('目录预览分页参数无效')
  }
  return { grantId: input.grantId, relativePath, cursor, limit }
}

function requireOptionalRelativePath(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > MAX_PATH_LENGTH) {
    throw new Error('本地预览路径无效')
  }
  return value
}

function normalizeRelativePath(value: string | undefined): string {
  if (!value) return ''
  if (isAbsolute(value) || value.includes('\0')) {
    throw new Error('本地预览路径无效')
  }
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '')
  if (normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('本地预览路径无效')
  }
  return normalized
}

function isGrantId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 100 &&
    /^[A-Za-z0-9-]+$/.test(value)
  )
}

function canonicalPath(path: string): string {
  return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
}

function isSameOrDescendant(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

async function safeStat(path: string): Promise<Stats> {
  try {
    return await stat(path)
  } catch {
    throw new Error('所选文件或目录已不可用')
  }
}

async function readBytes(path: string, offset: number, length: number): Promise<Buffer> {
  const handle = await open(path, 'r').catch(() => {
    throw new Error('无法读取所选文件')
  })
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return buffer.subarray(0, bytesRead)
  } catch {
    throw new Error('无法读取所选文件')
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function mediaTypeForPath(path: string): string {
  return MEDIA_TYPE_BY_EXTENSION[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function isTextPreviewPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase())
}

function publicGrant(grant: StoredGrant): DesktopComposerPathGrant {
  return {
    grantId: grant.grantId,
    name: grant.name,
    path: grant.path,
    pathKind: grant.pathKind,
    mediaType: grant.mediaType,
    sizeBytes: grant.sizeBytes,
  }
}

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.bmp': 'image/bmp',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsx': 'text/jsx',
  '.md': 'text/markdown',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.scss': 'text/x-scss',
  '.svg': 'image/svg+xml',
  '.toml': 'text/toml',
  '.ts': 'text/typescript',
  '.tsx': 'text/tsx',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
}

const TEXT_EXTENSIONS = new Set([
  '',
  '.c',
  '.cc',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.hpp',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
])
