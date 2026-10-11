import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { DesktopAttachmentSaveResult } from '@pidex/shared/desktop-attachment-ipc'
import { isRecord } from '@pidex/shared/guards'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TEXT_BYTES = 1024 * 1024
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4
const MAX_COLLISION_SUFFIX = 9999
const WINDOWS_RESERVED_BASENAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i
const SAFE_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export type AttachmentDownloadServiceDependencies = {
  getDownloadsDirectory: () => string
}

export class AttachmentDownloadService {
  constructor(private readonly dependencies: AttachmentDownloadServiceDependencies) {}

  async save(input: unknown): Promise<DesktopAttachmentSaveResult> {
    if (!isRecord(input)) throw new Error('附件数据无效')
    const fileName = requireSafeFileName(input.name)
    const content = decodeAttachmentContent(input)
    let downloadsDirectory: string
    try {
      downloadsDirectory = this.dependencies.getDownloadsDirectory()
      await mkdir(downloadsDirectory, { recursive: true })
    } catch {
      throw new Error('附件保存失败')
    }

    for (let suffix = 0; suffix <= MAX_COLLISION_SUFFIX; suffix += 1) {
      const candidateName = suffix === 0 ? fileName : appendCollisionSuffix(fileName, suffix)
      try {
        await writeFile(join(downloadsDirectory, candidateName), content, {
          flag: 'wx',
        })
        return { fileName: candidateName }
      } catch (error) {
        if (isFileExistsError(error)) continue
        throw new Error('附件保存失败')
      }
    }

    throw new Error('附件保存失败')
  }
}

export function requireSafeFileName(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 255) {
    throw new Error('附件名称无效')
  }
  if (
    value === '.' ||
    value === '..' ||
    /[<>:"|?*\\/\u0000-\u001f\u007f]/.test(value) ||
    /[ .]$/.test(value) ||
    WINDOWS_RESERVED_BASENAME.test(value)
  ) {
    throw new Error('附件名称无效')
  }
  return value
}

export function decodeAttachmentContent(input: unknown): Uint8Array {
  if (!isRecord(input)) {
    throw new Error('附件数据无效')
  }
  if (typeof input.data !== 'string' || typeof input.mediaType !== 'string') {
    throw new Error('附件数据无效')
  }

  if (input.kind === 'image') {
    if (input.encoding !== 'base64' || !IMAGE_MEDIA_TYPES.has(input.mediaType)) {
      throw new Error('附件数据无效')
    }
    if (input.data.length > MAX_IMAGE_BASE64_LENGTH) {
      throw new Error('附件数据无效')
    }
    const content = decodeStrictBase64(input.data)
    if (content.byteLength > MAX_IMAGE_BYTES || !matchesImageSignature(content, input.mediaType)) {
      throw new Error('附件数据无效')
    }
    return content
  }

  if (input.kind === 'text') {
    if (input.encoding !== 'utf8') throw new Error('附件数据无效')
    const content = Buffer.from(input.data, 'utf8')
    if (content.byteLength > MAX_TEXT_BYTES) throw new Error('附件数据无效')
    return content
  }

  throw new Error('附件数据无效')
}

function decodeStrictBase64(value: string): Buffer {
  if (!SAFE_BASE64.test(value)) throw new Error('附件数据无效')
  const content = Buffer.from(value, 'base64')
  const normalizedInput = value.replace(/=+$/, '')
  const normalizedOutput = content.toString('base64').replace(/=+$/, '')
  if (normalizedInput !== normalizedOutput) throw new Error('附件数据无效')
  return content
}

function matchesImageSignature(content: Uint8Array, mediaType: string): boolean {
  if (mediaType === 'image/png') {
    return startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (mediaType === 'image/jpeg') {
    return startsWith(content, [0xff, 0xd8, 0xff])
  }
  if (mediaType === 'image/gif') {
    return (
      startsWith(content, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      startsWith(content, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    )
  }
  return (
    startsWith(content, [0x52, 0x49, 0x46, 0x46]) &&
    content.length >= 12 &&
    startsWith(content.slice(8), [0x57, 0x45, 0x42, 0x50])
  )
}

function startsWith(content: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => content[index] === value)
}

export function appendCollisionSuffix(fileName: string, suffix: number): string {
  const extension = extname(fileName)
  const rawStem =
    extension && extension !== fileName ? fileName.slice(0, -extension.length) : fileName
  const safeExtension = extension === fileName ? '' : extension
  const suffixText = ` (${suffix})`
  const stem = rawStem.slice(0, Math.max(1, 255 - suffixText.length - safeExtension.length))
  return `${stem}${suffixText}${safeExtension}`
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
