import { randomUUID } from 'node:crypto'
import { AgentError } from '../Domain'
import { ContentBlobStore, contentSha256 } from '../storage/ContentBlobStore'

export const ATTACHMENT_LIMITS = {
  maxCount: 8,
  maxTextBytes: 1 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
} as const

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const TEXT_APPLICATION_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/javascript',
  'application/xml',
  'application/yaml',
])
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i

export type AttachmentKind = 'text' | 'image'

export interface AttachmentUpload {
  readonly kind: AttachmentKind
  readonly name: string
  readonly mimeType: string
  readonly data: string | Uint8Array
}

export interface AttachmentBinding {
  readonly type: string
  readonly id: string
}

export interface AttachmentRecord {
  readonly id: string
  readonly kind: AttachmentKind
  readonly name: string
  readonly mimeType: string
  readonly size: number
  readonly sha256: string
  readonly createdAt: number
  readonly binding: AttachmentBinding | null
}

export interface AttachmentReadResult {
  readonly record: AttachmentRecord
  readonly data: Uint8Array
}

/** Database adapters should keep each multi-record method transactional. */
export interface AttachmentCatalog {
  insertMany(records: readonly AttachmentRecord[]): Promise<void>
  get(id: string): Promise<AttachmentRecord | null>
  getMany(ids: readonly string[]): Promise<AttachmentRecord[]>
  listByBinding(binding: AttachmentBinding): Promise<AttachmentRecord[]>
  bindMany(ids: readonly string[], binding: AttachmentBinding): Promise<void>
  unbindMany(ids: readonly string[], binding: AttachmentBinding): Promise<void>
  removeMany(ids: readonly string[]): Promise<void>
  removeOrphans(createdBefore: number, limit: number): Promise<AttachmentRecord[]>
  countBySha256(sha256: string): Promise<number>
}

export interface AttachmentServiceOptions {
  readonly catalog?: AttachmentCatalog
  readonly now?: () => number
  readonly id?: () => string
}

const cloneBinding = (binding: AttachmentBinding | null) => (binding ? { ...binding } : null)
const cloneRecord = (record: AttachmentRecord): AttachmentRecord => ({
  ...record,
  binding: cloneBinding(record.binding),
})
const bindingEquals = (left: AttachmentBinding | null, right: AttachmentBinding) =>
  left?.type === right.type && left.id === right.id

export class InMemoryAttachmentCatalog implements AttachmentCatalog {
  private readonly records = new Map<string, AttachmentRecord>()

  async insertMany(records: readonly AttachmentRecord[]) {
    if (records.some((record) => this.records.has(record.id))) {
      throw new AgentError('ATTACHMENT_ID_CONFLICT', '附件 ID 已存在', 409)
    }
    for (const record of records) this.records.set(record.id, cloneRecord(record))
  }

  async get(id: string) {
    const record = this.records.get(id)
    return record ? cloneRecord(record) : null
  }

  async getMany(ids: readonly string[]) {
    return ids.flatMap((id) => {
      const record = this.records.get(id)
      return record ? [cloneRecord(record)] : []
    })
  }

  async listByBinding(binding: AttachmentBinding) {
    return [...this.records.values()]
      .filter((record) => bindingEquals(record.binding, binding))
      .map(cloneRecord)
  }

  async bindMany(ids: readonly string[], binding: AttachmentBinding) {
    const records = ids.map((id) => this.records.get(id))
    if (records.some((record) => !record))
      throw new AgentError('ATTACHMENT_NOT_FOUND', '一个或多个附件不存在', 404)
    if (records.some((record) => record!.binding && !bindingEquals(record!.binding, binding))) {
      throw new AgentError('ATTACHMENT_ALREADY_BOUND', '附件已绑定到其他对象', 409)
    }
    for (const record of records as AttachmentRecord[]) {
      this.records.set(record.id, { ...record, binding: { ...binding } })
    }
  }

  async unbindMany(ids: readonly string[], binding: AttachmentBinding) {
    const records = ids.map((id) => this.records.get(id))
    if (records.some((record) => !record))
      throw new AgentError('ATTACHMENT_NOT_FOUND', '一个或多个附件不存在', 404)
    if (records.some((record) => !bindingEquals(record!.binding, binding))) {
      throw new AgentError('ATTACHMENT_BINDING_MISMATCH', '附件绑定对象不匹配', 409)
    }
    for (const record of records as AttachmentRecord[]) {
      this.records.set(record.id, { ...record, binding: null })
    }
  }

  async removeMany(ids: readonly string[]) {
    for (const id of ids) this.records.delete(id)
  }

  async removeOrphans(createdBefore: number, limit: number) {
    const removed = [...this.records.values()]
      .filter((record) => record.binding === null && record.createdAt <= createdBefore)
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(0, limit)
    for (const record of removed) this.records.delete(record.id)
    return removed.map(cloneRecord)
  }

  async countBySha256(sha256: string) {
    let count = 0
    for (const record of this.records.values()) if (record.sha256 === sha256) count += 1
    return count
  }
}

const validateName = (name: string) => {
  if (
    !name ||
    name.length > 255 ||
    name === '.' ||
    name === '..' ||
    /[\\/\x00-\x1f]/.test(name) ||
    name.endsWith('.') ||
    name.endsWith(' ') ||
    WINDOWS_RESERVED_NAME.test(name)
  ) {
    throw new AgentError('ATTACHMENT_NAME_INVALID', '附件名称不安全', 400)
  }
}

const validateBinding = (binding: AttachmentBinding) => {
  if (
    !binding.type ||
    binding.type.length > 64 ||
    !binding.id ||
    binding.id.length > 256 ||
    /[\x00-\x1f]/.test(binding.type) ||
    /[\x00-\x1f]/.test(binding.id)
  ) {
    throw new AgentError('ATTACHMENT_BINDING_INVALID', '附件绑定标识无效', 400)
  }
}

const uniqueIDs = (ids: readonly string[]) => {
  if (ids.length === 0 || new Set(ids).size !== ids.length || ids.some((id) => !id)) {
    throw new AgentError('ATTACHMENT_IDS_INVALID', '附件 ID 必须非空且不能重复', 400)
  }
}

export const normalizeAttachmentMimeType = (kind: AttachmentKind, value: string) => {
  const parts = value
    .toLowerCase()
    .split(';')
    .map((part) => part.trim())
  const mimeType = parts[0] ?? ''
  const charset = parts
    .find((part) => part.startsWith('charset='))
    ?.slice('charset='.length)
    .replaceAll('"', '')
  if (charset && charset !== 'utf-8' && charset !== 'utf8') {
    throw new AgentError('ATTACHMENT_CHARSET_UNSUPPORTED', '文本附件只支持 UTF-8', 400)
  }
  if (kind === 'image' && !IMAGE_MIME_TYPES.has(mimeType)) {
    throw new AgentError(
      'ATTACHMENT_IMAGE_TYPE_UNSUPPORTED',
      '仅支持 PNG、JPEG、GIF 和 WebP 图片',
      400,
    )
  }
  if (
    kind === 'text' &&
    !mimeType.startsWith('text/') &&
    !TEXT_APPLICATION_MIME_TYPES.has(mimeType)
  ) {
    throw new AgentError(
      'ATTACHMENT_TEXT_TYPE_UNSUPPORTED',
      '附件 MIME 类型不是受支持的文本类型',
      400,
    )
  }
  return mimeType
}

const hasImageSignature = (mimeType: string, data: Uint8Array) => {
  if (mimeType === 'image/png') {
    return (
      data.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => data[index] === byte)
    )
  }
  if (mimeType === 'image/jpeg')
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  if (mimeType === 'image/gif') {
    const header = new TextDecoder().decode(data.subarray(0, 6))
    return header === 'GIF87a' || header === 'GIF89a'
  }
  return (
    data.length >= 12 &&
    new TextDecoder().decode(data.subarray(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(data.subarray(8, 12)) === 'WEBP'
  )
}

export const attachmentUploadBytes = (upload: AttachmentUpload, mimeType: string) => {
  if (upload.kind === 'image' && typeof upload.data === 'string') {
    throw new AgentError('ATTACHMENT_IMAGE_BYTES_REQUIRED', '图片附件必须使用二进制数据', 400)
  }
  const data =
    typeof upload.data === 'string'
      ? new TextEncoder().encode(upload.data)
      : new Uint8Array(upload.data)
  if (upload.kind === 'text') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data)
    } catch {
      throw new AgentError('ATTACHMENT_UTF8_INVALID', '文本附件不是有效 UTF-8', 400)
    }
  } else if (!hasImageSignature(mimeType, data)) {
    throw new AgentError('ATTACHMENT_IMAGE_INVALID', '图片内容与 MIME 类型不匹配', 400)
  }
  return data
}

export const prepareAttachmentUpload = (upload: AttachmentUpload) => {
  validateName(upload.name)
  const mimeType = normalizeAttachmentMimeType(upload.kind, upload.mimeType)
  const data = attachmentUploadBytes(upload, mimeType)
  const limit =
    upload.kind === 'text' ? ATTACHMENT_LIMITS.maxTextBytes : ATTACHMENT_LIMITS.maxImageBytes
  if (data.byteLength > limit) {
    throw new AgentError(
      'ATTACHMENT_FILE_TOO_LARGE',
      `附件 ${upload.name} 超过 ${limit} 字节上限`,
      413,
    )
  }
  return { upload, mimeType, data, sha256: contentSha256(data) }
}

export class AttachmentService {
  private readonly catalog: AttachmentCatalog
  private readonly now: () => number
  private readonly nextID: () => string
  private mutationQueue: Promise<void> = Promise.resolve()

  private constructor(
    private readonly blobs: ContentBlobStore,
    options: AttachmentServiceOptions,
  ) {
    this.catalog = options.catalog ?? new InMemoryAttachmentCatalog()
    this.now = options.now ?? Date.now
    this.nextID = options.id ?? randomUUID
  }

  static async open(dataDir: string, options: AttachmentServiceOptions = {}) {
    return new AttachmentService(await ContentBlobStore.open(dataDir), options)
  }

  private exclusive<T>(operation: () => Promise<T>) {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async store(uploads: readonly AttachmentUpload[]) {
    return this.exclusive(async () => {
      if (uploads.length === 0 || uploads.length > ATTACHMENT_LIMITS.maxCount) {
        throw new AgentError(
          'ATTACHMENT_COUNT_LIMIT',
          `每次必须包含 1 到 ${ATTACHMENT_LIMITS.maxCount} 个附件`,
          413,
        )
      }
      const prepared = uploads.map(prepareAttachmentUpload)
      const total = prepared.reduce((sum, item) => sum + item.data.byteLength, 0)
      if (total > ATTACHMENT_LIMITS.maxTotalBytes) {
        throw new AgentError(
          'ATTACHMENT_TOTAL_TOO_LARGE',
          `附件总量超过 ${ATTACHMENT_LIMITS.maxTotalBytes} 字节上限`,
          413,
        )
      }

      const createdAt = this.now()
      const records = prepared.map<AttachmentRecord>((item) => ({
        id: this.nextID(),
        kind: item.upload.kind,
        name: item.upload.name,
        mimeType: item.mimeType,
        size: item.data.byteLength,
        sha256: item.sha256,
        createdAt,
        binding: null,
      }))
      if (
        new Set(records.map((record) => record.id)).size !== records.length ||
        records.some((record) => !record.id)
      ) {
        throw new AgentError('ATTACHMENT_ID_INVALID', '附件 ID 生成器返回了无效或重复 ID', 500)
      }

      const createdBlobs = new Set<string>()
      let catalogInserted = false
      try {
        for (const item of prepared) {
          const stored = await this.blobs.put(item.data)
          if (stored.sha256 !== item.sha256) {
            throw new AgentError('ATTACHMENT_BLOB_CORRUPT', '附件 Blob 摘要不一致', 500)
          }
          if (stored.created) createdBlobs.add(item.sha256)
        }
        await this.catalog.insertMany(records)
        catalogInserted = true
        return records.map(cloneRecord)
      } catch (error) {
        if (catalogInserted)
          await this.catalog.removeMany(records.map((record) => record.id)).catch(() => undefined)
        for (const hash of createdBlobs) {
          if ((await this.catalog.countBySha256(hash).catch(() => 1)) === 0) {
            await this.blobs.remove(hash).catch(() => undefined)
          }
        }
        throw error
      }
    })
  }

  async read(id: string): Promise<AttachmentReadResult> {
    return this.exclusive(async () => {
      const record = await this.catalog.get(id)
      if (!record) throw new AgentError('ATTACHMENT_NOT_FOUND', '附件不存在', 404)
      return { record, data: await this.blobs.read(record.sha256) }
    })
  }

  async readText(id: string) {
    const result = await this.read(id)
    if (result.record.kind !== 'text')
      throw new AgentError('ATTACHMENT_NOT_TEXT', '附件不是文本', 400)
    try {
      return {
        record: result.record,
        text: new TextDecoder('utf-8', { fatal: true }).decode(result.data),
      }
    } catch {
      throw new AgentError('ATTACHMENT_UTF8_INVALID', '文本附件不是有效 UTF-8', 500)
    }
  }

  async bind(ids: readonly string[], binding: AttachmentBinding) {
    uniqueIDs(ids)
    validateBinding(binding)
    return this.exclusive(async () => {
      await this.catalog.bindMany(ids, binding)
      return this.catalog.getMany(ids)
    })
  }

  async unbind(ids: readonly string[], binding: AttachmentBinding) {
    uniqueIDs(ids)
    validateBinding(binding)
    return this.exclusive(async () => {
      await this.catalog.unbindMany(ids, binding)
      return this.catalog.getMany(ids)
    })
  }

  async listByBinding(binding: AttachmentBinding) {
    validateBinding(binding)
    return this.exclusive(() => this.catalog.listByBinding(binding))
  }

  async cleanupOrphans(createdBefore: number, limit = 100) {
    if (!Number.isFinite(createdBefore) || !Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new AgentError('ATTACHMENT_CLEANUP_INPUT_INVALID', '孤儿清理参数无效', 400)
    }
    return this.exclusive(async () => {
      const removed = await this.catalog.removeOrphans(createdBefore, limit)
      const hashes = [...new Set(removed.map((record) => record.sha256))]
      let deletedBlobs = 0
      for (const hash of hashes) {
        if ((await this.catalog.countBySha256(hash)) === 0) {
          if (await this.blobs.remove(hash)) deletedBlobs += 1
        }
      }
      return { removedRecords: removed.length, deletedBlobs }
    })
  }
}
