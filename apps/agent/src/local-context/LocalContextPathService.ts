import type { LocalContextReference } from '@pidex/shared/thread'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { AgentError } from '../Domain'
import { LocalContextPathRepository } from '../storage/repositories/LocalContextPathRepository'

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024
const DEFAULT_RANGE_BYTES = 256 * 1024
const MAX_LIST_LIMIT = 200
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const imageMediaTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}
const pathKey = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path)
const contained = (root: string, candidate: string) => {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}
const displayRelative = (path: string) => path.replaceAll('\\', '/')

export class LocalContextPathService {
  constructor(readonly repository: LocalContextPathRepository) {}

  async import(threadID: string, paths: readonly string[], operationID: string) {
    if (paths.length === 0 || paths.length > 8)
      throw new AgentError('ATTACHMENT_LIMIT', '每次最多导入 8 个本地上下文路径', 413)
    const imported = await Promise.all(
      paths.map(async (input) => {
        if (!isAbsolute(input))
          throw new AgentError('PATH_DENIED', '本地上下文必须使用绝对路径', 403)
        const canonical = await realpath(resolve(input)).catch(() => {
          throw new AgentError('FILE_NOT_FOUND', '所选本地路径不存在或不可访问', 404)
        })
        const metadata = await stat(canonical).catch(() => {
          throw new AgentError('FILE_NOT_FOUND', '所选本地路径不存在或不可访问', 404)
        })
        const kind = metadata.isDirectory()
          ? ('directory' as const)
          : metadata.isFile()
            ? ('file' as const)
            : null
        if (!kind) throw new AgentError('PATH_DENIED', '仅支持普通文件或目录', 403)
        return { name: basename(canonical), path: canonical, pathKey: pathKey(canonical), kind }
      }),
    )
    const deduplicated = [...new Map(imported.map((entry) => [entry.pathKey, entry])).values()]
    const requestHash = createHash('sha256')
      .update(JSON.stringify(deduplicated.map(({ pathKey }) => pathKey)))
      .digest('hex')
    return this.repository.import(threadID, deduplicated, operationID, requestHash)
  }

  private async reference(threadID: string, referenceID: string) {
    const stored = this.repository.getAuthorized(threadID, referenceID)
    if (!stored) throw new AgentError('LOCAL_CONTEXT_NOT_FOUND', '本地上下文引用不存在', 404)
    return stored
  }

  private async resolveTarget(reference: LocalContextReference, relativePath?: string) {
    const root = resolve(reference.path)
    if (reference.kind === 'file' && relativePath && relativePath !== '.') {
      throw new AgentError('PATH_DENIED', '文件引用不接受相对子路径', 403)
    }
    if (relativePath && (isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..'))) {
      throw new AgentError('PATH_DENIED', '相对路径不在引用范围内', 403)
    }
    const requested =
      reference.kind === 'directory' && relativePath ? resolve(root, relativePath) : root
    if (reference.kind === 'directory' && !contained(root, requested))
      throw new AgentError('PATH_DENIED', '相对路径不在引用范围内', 403)
    const canonicalRoot = await realpath(root).catch(() => {
      throw new AgentError('FILE_NOT_FOUND', '本地上下文路径已丢失', 404)
    })
    if (pathKey(canonicalRoot) !== pathKey(root)) {
      throw new AgentError('PATH_DENIED', '本地上下文根路径已被重定向', 403)
    }
    const canonical = await realpath(requested).catch(() => {
      throw new AgentError('FILE_NOT_FOUND', '本地上下文路径已丢失', 404)
    })
    if (reference.kind === 'file') {
      if (canonical !== canonicalRoot)
        throw new AgentError('PATH_DENIED', '本地文件引用已被重定向', 403)
    } else if (!contained(canonicalRoot, canonical)) {
      throw new AgentError('PATH_DENIED', '本地目录引用不能通过链接越界', 403)
    }
    return { root: canonicalRoot, path: canonical }
  }

  async read(input: {
    threadID: string
    referenceID: string
    relativePath?: string
    range?: { offset: number; length: number }
  }) {
    const reference = await this.reference(input.threadID, input.referenceID)
    let target: { root: string; path: string }
    try {
      target = await this.resolveTarget(reference, input.relativePath)
    } catch (cause) {
      if (cause instanceof AgentError && cause.code === 'FILE_NOT_FOUND') {
        throw new AgentError('FILE_NOT_FOUND', '本地上下文路径已丢失', 404)
      }
      throw cause
    }
    const metadata = await stat(target.path)
    if (!metadata.isFile()) throw new AgentError('FILE_NOT_TEXT', '该路径不是可预览文件', 400)
    const relativePath =
      reference.kind === 'directory' ? displayRelative(relative(target.root, target.path)) : null
    const mediaType = imageMediaTypes[extname(target.path).toLowerCase()] ?? null
    if (metadata.size > MAX_PREVIEW_BYTES) {
      return {
        reference,
        relativePath,
        preview: 'unsupported' as const,
        mediaType,
        data: null,
        encoding: null,
        range: null,
      }
    }
    const bytes = await readFile(target.path)
    const offset = Math.max(0, input.range?.offset ?? 0)
    const requestedLength = Math.max(
      1,
      input.range?.length ?? (mediaType ? bytes.byteLength : DEFAULT_RANGE_BYTES),
    )
    const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + requestedLength))
    if (mediaType) {
      return {
        reference,
        relativePath,
        preview: 'image' as const,
        mediaType,
        data: Buffer.from(chunk).toString('base64'),
        encoding: 'base64' as const,
        range: { offset, length: chunk.byteLength, total: bytes.byteLength },
      }
    }
    try {
      return {
        reference,
        relativePath,
        preview: 'text' as const,
        mediaType: 'text/plain; charset=utf-8',
        data: textDecoder.decode(chunk),
        encoding: 'utf8' as const,
        range: { offset, length: chunk.byteLength, total: bytes.byteLength },
      }
    } catch {
      return {
        reference,
        relativePath,
        preview: 'unsupported' as const,
        mediaType: null,
        data: null,
        encoding: null,
        range: null,
      }
    }
  }

  async list(input: {
    threadID: string
    referenceID: string
    relativePath?: string
    cursor?: string
    limit?: number
  }) {
    const reference = await this.reference(input.threadID, input.referenceID)
    let target: { root: string; path: string }
    try {
      target = await this.resolveTarget(reference, input.relativePath)
    } catch (cause) {
      if (cause instanceof AgentError && cause.code === 'FILE_NOT_FOUND') {
        throw new AgentError('FILE_NOT_FOUND', '本地上下文路径已丢失', 404)
      }
      throw cause
    }
    const metadata = await stat(target.path)
    if (!metadata.isDirectory()) throw new AgentError('FILE_NOT_TEXT', '该路径不是目录', 400)
    const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, input.limit ?? 100))
    const offset = input.cursor
      ? Number.parseInt(Buffer.from(input.cursor, 'base64url').toString('utf8'), 10)
      : 0
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new AgentError('INVALID_REQUEST', '目录游标无效', 400)
    const entries = await readdir(target.path, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    const visible = entries
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .slice(offset, offset + limit + 1)
    const page = visible.slice(0, limit)
    const base = reference.kind === 'directory' ? relative(target.root, target.path) : ''
    return {
      reference,
      relativePath: reference.kind === 'directory' ? displayRelative(base) || null : null,
      entries: page.map((entry) => ({
        name: entry.name,
        relativePath: displayRelative(join(base, entry.name)),
        kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        status: 'available' as const,
      })),
      nextCursor:
        visible.length > limit
          ? Buffer.from(String(offset + limit), 'utf8').toString('base64url')
          : null,
    }
  }
}
