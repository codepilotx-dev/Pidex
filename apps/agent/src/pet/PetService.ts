import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { PetCatalogResult } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import { PetCatalogService } from './PetCatalogService'
import { asPetStorageError, isNodeErrorCode } from './PetStorageError'

const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_SPRITESHEET_BYTES = 20 * 1024 * 1024
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export type PetManifest = {
  id: string
  displayName: string
  description?: string
  spriteVersionNumber: 1 | 2
  spritesheetPath: string
}

export type PetDescriptor = PetManifest & {
  spritesheetUrl: string
  installed: boolean
}

export type PetInstallPreview = {
  pet: PetDescriptor
  sourceUrl: string
  sizeBytes: number
}

type DownloadedPet = {
  manifest: PetManifest
  manifestUrl: URL
  spritesheet: Uint8Array
  contentType: 'image/png' | 'image/webp'
}

export class PetService {
  private readonly catalogService: PetCatalogService

  constructor(private readonly rootDirectory: string) {
    this.catalogService = new PetCatalogService(rootDirectory)
  }

  async list(): Promise<PetDescriptor[]> {
    let entries
    try {
      await mkdir(this.rootDirectory, { recursive: true })
      entries = await readdir(this.rootDirectory, { withFileTypes: true })
    } catch (cause) {
      throw asPetStorageError(cause)
    }
    const pets: PetDescriptor[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !PET_ID_PATTERN.test(entry.name)) continue
      try {
        const manifest = await this.readInstalledManifest(entry.name)
        pets.push(this.descriptor(manifest, true))
      } catch {
        // A broken package is ignored rather than making the catalog unusable.
      }
    }
    return pets.sort((left, right) => left.displayName.localeCompare(right.displayName))
  }

  async preview(source: string): Promise<PetInstallPreview> {
    const downloaded = await this.download(source)
    return {
      pet: this.descriptor(downloaded.manifest, false),
      sourceUrl: downloaded.manifestUrl.toString(),
      sizeBytes: downloaded.spritesheet.byteLength,
    }
  }

  async catalog(refresh = false): Promise<PetCatalogResult> {
    const installed = await this.list()
    return this.catalogService.list(new Set(installed.map((pet) => pet.id)), refresh)
  }

  async installCatalog(slug: string, acceptedRestrictedLicense: boolean): Promise<PetDescriptor> {
    return this.catalogService.install(slug, acceptedRestrictedLicense, (source) =>
      this.install(source, slug),
    )
  }

  async previewAsset(slug: string): Promise<{
    bytes: Uint8Array
    contentType: 'image/gif'
    etag: string
  }> {
    return this.catalogService.previewAsset(slug)
  }

  async install(source: string, expectedID?: string): Promise<PetDescriptor> {
    const downloaded = await this.download(source)
    if (expectedID !== undefined && downloaded.manifest.id !== expectedID) {
      throw new AgentError('PET_INVALID', '社区宠物清单 ID 与目录 slug 不一致', 400)
    }
    const targetDirectory = this.petDirectory(downloaded.manifest.id)
    const stagingDirectory = join(
      this.rootDirectory,
      `.install-${downloaded.manifest.id}-${crypto.randomUUID()}`,
    )
    try {
      await mkdir(this.rootDirectory, { recursive: true })
      await mkdir(stagingDirectory, { recursive: true })
      const extension = downloaded.contentType === 'image/png' ? '.png' : '.webp'
      const spritesheetName = `spritesheet${extension}`
      const manifest: PetManifest = {
        ...downloaded.manifest,
        spritesheetPath: spritesheetName,
      }
      await writeFile(join(stagingDirectory, spritesheetName), downloaded.spritesheet)
      await writeFile(
        join(stagingDirectory, 'pet.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      )
      await rm(targetDirectory, { recursive: true, force: true })
      await rename(stagingDirectory, targetDirectory)
      return this.descriptor(manifest, true)
    } catch (cause) {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw asPetStorageError(cause)
    }
  }

  async remove(id: string): Promise<void> {
    const directory = this.petDirectory(id)
    try {
      await readFile(join(directory, 'pet.json'))
    } catch (cause) {
      if (!isNodeErrorCode(cause, 'ENOENT')) throw asPetStorageError(cause)
      throw new AgentError('PET_NOT_FOUND', '宠物不存在', 404)
    }
    try {
      await rm(directory, { recursive: true, force: true })
    } catch (cause) {
      throw asPetStorageError(cause)
    }
  }

  async spritesheet(id: string): Promise<{
    bytes: Uint8Array
    contentType: 'image/png' | 'image/webp'
    etag: string
  }> {
    const manifest = await this.readInstalledManifest(id)
    const path = this.resolvePackagePath(this.petDirectory(id), manifest.spritesheetPath)
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(path))
    } catch (cause) {
      throw asPetStorageError(cause)
    }
    const contentType = imageContentType(bytes)
    validateAtlas(bytes, contentType, manifest.spriteVersionNumber)
    return {
      bytes,
      contentType,
      etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
    }
  }

  private async download(source: string): Promise<DownloadedPet> {
    const manifestUrl = requireAllowedURL(source)
    const manifestResponse = await fetchNoRedirect(manifestUrl)
    const manifestBytes = await readLimitedBody(manifestResponse, MAX_MANIFEST_BYTES)
    let rawManifest: unknown
    try {
      rawManifest = JSON.parse(new TextDecoder().decode(manifestBytes))
    } catch {
      throw new AgentError('PET_INVALID', 'pet.json 不是有效 JSON', 400)
    }
    const manifest = normalizeManifest(rawManifest)
    const spritesheetUrl = requireAllowedURL(
      new URL(manifest.spritesheetPath, manifestUrl).toString(),
    )
    const spritesheetResponse = await fetchNoRedirect(spritesheetUrl)
    const headerType = spritesheetResponse.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim()
      .toLowerCase()
    if (headerType !== 'image/png' && headerType !== 'image/webp') {
      throw new AgentError('PET_INVALID', '宠物图集只支持 PNG 或 WebP', 400)
    }
    const spritesheet = await readLimitedBody(spritesheetResponse, MAX_SPRITESHEET_BYTES)
    const detectedType = imageContentType(spritesheet)
    if (detectedType !== headerType) {
      throw new AgentError('PET_INVALID', '宠物图集类型与响应不一致', 400)
    }
    validateAtlas(spritesheet, detectedType, manifest.spriteVersionNumber)
    return { manifest, manifestUrl, spritesheet, contentType: detectedType }
  }

  private async readInstalledManifest(id: string): Promise<PetManifest> {
    const directory = this.petDirectory(id)
    const raw = await readFile(join(directory, 'pet.json'), 'utf8')
    const manifest = normalizeManifest(JSON.parse(raw))
    if (manifest.id !== id) {
      throw new AgentError('PET_INVALID', '宠物目录与清单 ID 不一致', 400)
    }
    this.resolvePackagePath(directory, manifest.spritesheetPath)
    return manifest
  }

  private descriptor(manifest: PetManifest, installed: boolean): PetDescriptor {
    return {
      ...manifest,
      spritesheetUrl: `/api/pets/${encodeURIComponent(manifest.id)}/spritesheet`,
      installed,
    }
  }

  private petDirectory(id: string): string {
    if (!PET_ID_PATTERN.test(id)) {
      throw new AgentError('PET_INVALID', '宠物 ID 无效', 400)
    }
    return this.resolvePackagePath(this.rootDirectory, id)
  }

  private resolvePackagePath(root: string, path: string): string {
    if (!path || path.includes('\0')) {
      throw new AgentError('PATH_DENIED', '宠物包路径无效', 403)
    }
    const resolved = resolve(root, path)
    const child = relative(root, resolved)
    if (
      child === '' ||
      child === '..' ||
      child.startsWith(`..${sep}`) ||
      resolve(root) === resolved
    ) {
      throw new AgentError('PATH_DENIED', '宠物包路径越界', 403)
    }
    return resolved
  }
}

function normalizeManifest(value: unknown): PetManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentError('PET_INVALID', 'pet.json 格式无效', 400)
  }
  const manifest = value as Record<string, unknown>
  const id = typeof manifest.id === 'string' ? manifest.id.trim() : ''
  const displayName = typeof manifest.displayName === 'string' ? manifest.displayName.trim() : ''
  const spritesheetPath =
    typeof manifest.spritesheetPath === 'string' ? manifest.spritesheetPath.trim() : ''
  const spriteVersionNumber = manifest.spriteVersionNumber === 2 ? 2 : 1
  if (!PET_ID_PATTERN.test(id) || !displayName || displayName.length > 100) {
    throw new AgentError('PET_INVALID', '宠物清单名称或 ID 无效', 400)
  }
  if (
    !spritesheetPath ||
    spritesheetPath.length > 240 ||
    spritesheetPath.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(spritesheetPath) ||
    spritesheetPath.split(/[\\/]/).includes('..')
  ) {
    throw new AgentError('PET_INVALID', 'spritesheetPath 必须是包内相对路径', 400)
  }
  const description =
    typeof manifest.description === 'string' ? manifest.description.trim().slice(0, 500) : undefined
  return {
    id,
    displayName,
    ...(description ? { description } : {}),
    spriteVersionNumber,
    spritesheetPath,
  }
}

function requireAllowedURL(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AgentError('PET_INVALID', '宠物安装地址无效', 400)
  }
  const localhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(localhost && url.protocol === 'http:')) {
    throw new AgentError('PET_INVALID', '宠物安装地址必须使用 HTTPS', 400)
  }
  if (url.username || url.password) {
    throw new AgentError('PET_INVALID', '宠物安装地址不能包含凭据', 400)
  }
  return url
}

async function fetchNoRedirect(url: URL): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new AgentError('PET_DOWNLOAD_FAILED', '无法下载宠物资源', 502)
  }
  if (REDIRECT_STATUSES.has(response.status)) {
    throw new AgentError('PET_DOWNLOAD_FAILED', '宠物资源不允许重定向', 502)
  }
  if (!response.ok) {
    throw new AgentError('PET_DOWNLOAD_FAILED', `宠物资源下载失败（HTTP ${response.status}）`, 502)
  }
  return response
}

async function readLimitedBody(response: Response, limit: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new AgentError('PET_INVALID', '宠物资源超过大小限制', 400)
  }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new AgentError('PET_INVALID', '宠物资源超过大小限制', 400)
    }
    chunks.push(value)
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function imageContentType(bytes: Uint8Array): 'image/png' | 'image/webp' {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  throw new AgentError('PET_INVALID', '宠物图集文件签名无效', 400)
}

function validateAtlas(
  bytes: Uint8Array,
  contentType: 'image/png' | 'image/webp',
  version: 1 | 2,
): void {
  const { width, height } =
    contentType === 'image/png' ? pngDimensions(bytes) : webpDimensions(bytes)
  const expectedHeight = version === 2 ? 2_288 : 1_872
  if (width !== 1_536 || height !== expectedHeight) {
    throw new AgentError('PET_INVALID', `宠物图集尺寸必须为 1536x${expectedHeight}`, 400)
  }
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunk = ascii(bytes, 12, 16)
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
      height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
    }
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    }
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }
  throw new AgentError('PET_INVALID', '无法读取 WebP 图集尺寸', 400)
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end))
}
