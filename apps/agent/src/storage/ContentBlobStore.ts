import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { AgentError } from '../Domain'

const SHA256 = /^[a-f\d]{64}$/

const contained = (root: string, candidate: string) => {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

export const contentSha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

/**
 * Shared immutable blob boundary for input attachments and project sources.
 * Catalog ownership and reference counting intentionally remain outside this
 * class because input history and project profile data have separate lifecycles.
 */
export class ContentBlobStore {
  private constructor(private readonly blobsRoot: string) {}

  static async open(dataDir: string) {
    const root = resolve(dataDir, 'attachments')
    await mkdir(root, { recursive: true })
    const rootMetadata = await lstat(root)
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new AgentError('ATTACHMENT_DATA_DIR_INVALID', '附件数据目录必须是普通目录', 400)
    }
    const canonicalRoot = await realpath(root)
    const blobs = join(canonicalRoot, 'blobs')
    await mkdir(blobs, { recursive: true })
    const blobsMetadata = await lstat(blobs)
    if (!blobsMetadata.isDirectory() || blobsMetadata.isSymbolicLink()) {
      throw new AgentError('ATTACHMENT_DATA_DIR_INVALID', '附件 Blob 目录必须是普通目录', 400)
    }
    return new ContentBlobStore(await realpath(blobs))
  }

  private path(sha256: string) {
    if (!SHA256.test(sha256)) {
      throw new AgentError('ATTACHMENT_SHA256_INVALID', '附件 SHA256 无效', 500)
    }
    const path = resolve(this.blobsRoot, sha256.slice(0, 2), sha256)
    if (!contained(this.blobsRoot, path)) {
      throw new AgentError('ATTACHMENT_PATH_DENIED', '附件存储路径越界', 403)
    }
    return path
  }

  private async shard(sha256: string) {
    const directory = resolve(this.blobsRoot, sha256.slice(0, 2))
    await mkdir(directory, { recursive: true })
    const metadata = await lstat(directory)
    const canonical = await realpath(directory)
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !contained(this.blobsRoot, canonical)
    ) {
      throw new AgentError('ATTACHMENT_PATH_DENIED', '附件分片目录越界或不是普通目录', 403)
    }
    return canonical
  }

  async read(sha256: string) {
    const path = this.path(sha256)
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new AgentError('ATTACHMENT_BLOB_INVALID', '附件 Blob 不是普通文件', 500)
    }
    const data = new Uint8Array(await readFile(path))
    if (contentSha256(data) !== sha256) {
      throw new AgentError('ATTACHMENT_BLOB_CORRUPT', '附件 Blob 校验失败', 500)
    }
    return data
  }

  async put(data: Uint8Array) {
    const sha256 = contentSha256(data)
    const destination = this.path(sha256)
    try {
      await this.read(sha256)
      return { sha256, created: false }
    } catch (cause) {
      if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause
    }

    const directory = await this.shard(sha256)
    const temporary = join(directory, `.${sha256}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, data, { flag: 'wx' })
      try {
        await link(temporary, destination)
        return { sha256, created: true }
      } catch (cause) {
        if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'EEXIST') throw cause
        await this.read(sha256)
        return { sha256, created: false }
      }
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  async remove(sha256: string) {
    try {
      await unlink(this.path(sha256))
      return true
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return false
      throw cause
    }
  }
}
