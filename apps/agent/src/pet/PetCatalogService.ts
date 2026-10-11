import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PetCatalogItem, PetCatalogResult, PetLicenseKind } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import { asPetStorageError, isPetStorageError } from './PetStorageError'

const CATALOG_URL = 'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets.json'
const CATEGORIES_URL =
  'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/categories.json'
const MANIFEST_BASE_URL = 'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/'
const PREVIEW_BASE_URL = 'https://codexpet.top/assets/previews/'
const CACHE_FILE_NAME = '.catalog-cache.json'
const CACHE_VERSION = 1
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000
const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024
const MAX_CATALOG_ITEMS = 1_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const PET_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

type CatalogPet = Omit<PetCatalogItem, 'installed'>

type CatalogCache = {
  version: typeof CACHE_VERSION
  fetchedAt: string
  pets: CatalogPet[]
}

type CatalogServiceOptions = {
  fetch?: typeof globalThis.fetch
  now?: () => number
}

export class PetCatalogService {
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => number
  private refreshPromise: Promise<CatalogCache> | null = null

  constructor(
    private readonly rootDirectory: string,
    options: CatalogServiceOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  async list(installedPetIDs: ReadonlySet<string>, refresh = false): Promise<PetCatalogResult> {
    const cached = await this.readCache()
    if (cached && !refresh && this.isFresh(cached)) {
      return this.result(cached, installedPetIDs, 'fresh')
    }
    if (cached && !refresh) {
      void this.refresh().catch(() => undefined)
      return this.result(cached, installedPetIDs, 'stale')
    }
    try {
      const updated = await this.refresh()
      return this.result(updated, installedPetIDs, 'fresh')
    } catch (cause) {
      if (isPetStorageError(cause)) throw cause
      if (cached) return this.result(cached, installedPetIDs, 'stale')
      return { pets: [], fetchedAt: null, cacheState: 'unavailable' }
    }
  }

  async install<T>(
    slug: string,
    acceptedRestrictedLicense: boolean,
    installer: (manifestUrl: string) => Promise<T>,
  ): Promise<T> {
    const item = await this.requireCatalogItem(slug)
    if (
      (item.licenseKind === 'restricted' || item.licenseKind === 'unknown') &&
      !acceptedRestrictedLicense
    ) {
      throw new AgentError('PET_INVALID', '安装此宠物前需要确认其许可证或使用限制', 400)
    }
    return installer(manifestUrl(item.slug))
  }

  async previewAsset(slug: string): Promise<{
    bytes: Uint8Array
    contentType: 'image/gif'
    etag: string
  }> {
    const item = await this.requireCatalogItem(slug)
    const url = new URL(`${encodeURIComponent(item.slug)}/gifs/idle.gif`, PREVIEW_BASE_URL)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'codexpet.top' ||
      !url.pathname.startsWith('/assets/previews/')
    ) {
      throw new AgentError('PATH_DENIED', '宠物预览地址无效', 403)
    }
    const response = await this.fetchNoRedirect(url, '宠物预览')
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (contentType !== 'image/gif') {
      throw new AgentError('PET_INVALID', '宠物预览只支持 GIF', 400)
    }
    const bytes = await readLimitedBody(response, MAX_PREVIEW_BYTES, '宠物预览超过大小限制')
    if (!isGif(bytes)) {
      throw new AgentError('PET_INVALID', '宠物预览文件签名无效', 400)
    }
    return {
      bytes,
      contentType,
      etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
    }
  }

  private async requireCatalogItem(slug: string): Promise<CatalogPet> {
    if (!PET_SLUG_PATTERN.test(slug)) {
      throw new AgentError('PET_INVALID', '社区宠物 slug 无效', 400)
    }
    const catalog = await this.list(new Set())
    if (catalog.cacheState === 'unavailable') {
      throw new AgentError('PET_DOWNLOAD_FAILED', '社区宠物目录暂时不可用', 502)
    }
    const item = catalog.pets.find((candidate) => candidate.slug === slug)
    if (!item) {
      throw new AgentError('PET_NOT_FOUND', '社区宠物不存在', 404)
    }
    const { installed: _, ...catalogPet } = item
    return catalogPet
  }

  private async refresh(): Promise<CatalogCache> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.downloadCatalog()
      .then(async (cache) => {
        await this.writeCache(cache)
        return cache
      })
      .finally(() => {
        this.refreshPromise = null
      })
    return this.refreshPromise
  }

  private async downloadCatalog(): Promise<CatalogCache> {
    const [petsResponse, categoriesResponse] = await Promise.all([
      this.fetchNoRedirect(new URL(CATALOG_URL), '社区宠物目录'),
      this.fetchNoRedirect(new URL(CATEGORIES_URL), '社区宠物分类'),
    ])
    const [petsBytes, categoriesBytes] = await Promise.all([
      readLimitedBody(petsResponse, MAX_CATALOG_BYTES, '社区宠物目录超过大小限制'),
      readLimitedBody(categoriesResponse, MAX_CATALOG_BYTES, '社区宠物分类超过大小限制'),
    ])
    const pets = parseJson(petsBytes, '社区宠物目录')
    const categories = parseJson(categoriesBytes, '社区宠物分类')
    return {
      version: CACHE_VERSION,
      fetchedAt: new Date(this.now()).toISOString(),
      pets: normalizeCatalog(pets, categories),
    }
  }

  private async fetchNoRedirect(url: URL, resourceName: string): Promise<Response> {
    let response: Response
    try {
      response = await this.fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new AgentError('PET_DOWNLOAD_FAILED', `无法下载${resourceName}`, 502)
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      throw new AgentError('PET_DOWNLOAD_FAILED', `${resourceName}不允许重定向`, 502)
    }
    if (!response.ok) {
      throw new AgentError(
        'PET_DOWNLOAD_FAILED',
        `${resourceName}下载失败（HTTP ${response.status}）`,
        502,
      )
    }
    return response
  }

  private async readCache(): Promise<CatalogCache | null> {
    try {
      const raw = await readFile(join(this.rootDirectory, CACHE_FILE_NAME), 'utf8')
      return normalizeCache(JSON.parse(raw))
    } catch {
      return null
    }
  }

  private async writeCache(cache: CatalogCache): Promise<void> {
    let temporary: string | null = null
    try {
      await mkdir(this.rootDirectory, { recursive: true })
      const target = join(this.rootDirectory, CACHE_FILE_NAME)
      temporary = join(this.rootDirectory, `${CACHE_FILE_NAME}.${crypto.randomUUID()}.tmp`)
      await writeFile(temporary, `${JSON.stringify(cache)}\n`, 'utf8')
      await rename(temporary, target)
    } catch (cause) {
      if (temporary) {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
      throw asPetStorageError(cause)
    }
  }

  private isFresh(cache: CatalogCache): boolean {
    const fetchedAt = Date.parse(cache.fetchedAt)
    return (
      Number.isFinite(fetchedAt) &&
      this.now() - fetchedAt >= 0 &&
      this.now() - fetchedAt < CACHE_TTL_MS
    )
  }

  private result(
    cache: CatalogCache,
    installedPetIDs: ReadonlySet<string>,
    cacheState: 'fresh' | 'stale',
  ): PetCatalogResult {
    return {
      pets: cache.pets.map((pet) => ({
        ...pet,
        installed: installedPetIDs.has(pet.slug),
      })),
      fetchedAt: cache.fetchedAt,
      cacheState,
    }
  }
}

function normalizeCatalog(petsValue: unknown, categoriesValue: unknown): CatalogPet[] {
  if (!Array.isArray(petsValue) || petsValue.length > MAX_CATALOG_ITEMS) {
    throw new AgentError('PET_INVALID', '社区宠物目录格式无效', 400)
  }
  if (!Array.isArray(categoriesValue) || categoriesValue.length > 200) {
    throw new AgentError('PET_INVALID', '社区宠物分类格式无效', 400)
  }
  const categories = new Map<string, { slug: string; label: string }>()
  for (const value of categoriesValue) {
    const category = record(value, '社区宠物分类')
    const name = requiredString(category.name, 100, '社区宠物分类名称')
    const slug = requiredSlug(category.slug, '社区宠物分类 slug')
    const label = optionalLocalizedName(category.label)?.zh ?? name
    categories.set(name, { slug, label })
  }
  const seen = new Set<string>()
  return petsValue.map((value) => {
    const pet = record(value, '社区宠物')
    const slug = requiredSlug(pet.slug, '社区宠物 slug')
    if (seen.has(slug)) {
      throw new AgentError('PET_INVALID', '社区宠物目录包含重复 slug', 400)
    }
    seen.add(slug)
    const englishName =
      optionalLocalizedName(pet.localized_names)?.en ?? optionalString(pet.name, 100)
    const displayName =
      optionalLocalizedName(pet.localized_names)?.zh ??
      englishName ??
      requiredString(pet.name, 100, '社区宠物名称')
    const categoryName = requiredString(pet.primary_category, 100, '社区宠物分类')
    const category = categories.get(categoryName) ?? {
      slug: 'other',
      label: categoryName,
    }
    const license = optionalString(pet.license, 500) ?? '未声明许可证'
    const version = pet.spriteVersionNumber
    if (version !== 1 && version !== 2) {
      throw new AgentError('PET_INVALID', '社区宠物图集版本无效', 400)
    }
    return {
      slug,
      displayName,
      ...(englishName && englishName !== displayName ? { englishName } : {}),
      ...(optionalString(pet.description, 500)
        ? { description: optionalString(pet.description, 500)! }
        : {}),
      author: requiredString(pet.author, 100, '社区宠物作者'),
      category: category.slug,
      categoryLabel: category.label,
      spriteVersionNumber: version,
      license,
      licenseKind: classifyLicense(license),
      previewUrl: `/api/pets/catalog/${encodeURIComponent(slug)}/preview`,
    }
  })
}

export function classifyPetLicense(license: string): PetLicenseKind {
  return classifyLicense(license)
}

function classifyLicense(license: string): PetLicenseKind {
  const normalized = license.trim().toLowerCase()
  if (
    /\bby-nc\b|\bnc(?:-| |$)|non[- ]commercial|personal (?:non-commercial )?use|fan[- ]?use|source author terms|redistribution authorized|author terms/.test(
      normalized,
    )
  ) {
    return 'restricted'
  }
  if (!normalized || /unknown|unspecified|not (?:provided|specified)|no license/.test(normalized)) {
    return 'unknown'
  }
  if (
    /\bmit\b|\bapache(?:-| )?2(?:\.0)?\b|\bbsd\b|\bisc\b|\bcc0\b|public domain|unlicense/.test(
      normalized,
    )
  ) {
    return 'permissive'
  }
  if (/\bcc by(?:-| |$)|creative commons attribution/.test(normalized)) {
    return 'attribution'
  }
  return 'unknown'
}

function normalizeCache(value: unknown): CatalogCache {
  const cache = record(value, '社区宠物缓存')
  if (cache.version !== CACHE_VERSION) {
    throw new AgentError('PET_INVALID', '社区宠物缓存版本无效', 400)
  }
  const fetchedAt = requiredString(cache.fetchedAt, 50, '社区宠物缓存时间')
  if (!Number.isFinite(Date.parse(fetchedAt)) || !Array.isArray(cache.pets)) {
    throw new AgentError('PET_INVALID', '社区宠物缓存格式无效', 400)
  }
  if (cache.pets.length > MAX_CATALOG_ITEMS) {
    throw new AgentError('PET_INVALID', '社区宠物缓存条目过多', 400)
  }
  return {
    version: CACHE_VERSION,
    fetchedAt,
    pets: cache.pets.map((value) => {
      const pet = record(value, '社区宠物缓存条目')
      const spriteVersionNumber = pet.spriteVersionNumber
      const licenseKind = pet.licenseKind
      if (spriteVersionNumber !== 1 && spriteVersionNumber !== 2) {
        throw new AgentError('PET_INVALID', '社区宠物缓存图集版本无效', 400)
      }
      if (
        licenseKind !== 'permissive' &&
        licenseKind !== 'attribution' &&
        licenseKind !== 'restricted' &&
        licenseKind !== 'unknown'
      ) {
        throw new AgentError('PET_INVALID', '社区宠物缓存许可证无效', 400)
      }
      return {
        slug: requiredSlug(pet.slug, '社区宠物缓存 slug'),
        displayName: requiredString(pet.displayName, 100, '社区宠物缓存名称'),
        ...(optionalString(pet.englishName, 100)
          ? { englishName: optionalString(pet.englishName, 100)! }
          : {}),
        ...(optionalString(pet.description, 500)
          ? { description: optionalString(pet.description, 500)! }
          : {}),
        author: requiredString(pet.author, 100, '社区宠物缓存作者'),
        category: requiredString(pet.category, 100, '社区宠物缓存分类'),
        categoryLabel: requiredString(pet.categoryLabel, 100, '社区宠物缓存分类名称'),
        spriteVersionNumber,
        license: requiredString(pet.license, 500, '社区宠物缓存许可证'),
        licenseKind,
        previewUrl: `/api/pets/catalog/${encodeURIComponent(
          requiredSlug(pet.slug, '社区宠物缓存 slug'),
        )}/preview`,
      }
    }),
  }
}

function manifestUrl(slug: string): string {
  return new URL(`${encodeURIComponent(slug)}/pet.json`, MANIFEST_BASE_URL).toString()
}

function parseJson(bytes: Uint8Array, resourceName: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new AgentError('PET_INVALID', `${resourceName}不是有效 JSON`, 400)
  }
}

async function readLimitedBody(
  response: Response,
  limit: number,
  message: string,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new AgentError('PET_INVALID', message, 400)
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
      throw new AgentError('PET_INVALID', message, 400)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function isGif(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false
  const signature = String.fromCharCode(...bytes.slice(0, 6))
  return signature === 'GIF87a' || signature === 'GIF89a'
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentError('PET_INVALID', `${name}格式无效`, 400)
  }
  return value as Record<string, unknown>
}

function requiredSlug(value: unknown, name: string): string {
  const slug = requiredString(value, 64, name)
  if (!PET_SLUG_PATTERN.test(slug)) {
    throw new AgentError('PET_INVALID', `${name}无效`, 400)
  }
  return slug
}

function requiredString(value: unknown, maxLength: number, name: string): string {
  const normalized = optionalString(value, maxLength)
  if (!normalized) {
    throw new AgentError('PET_INVALID', `${name}无效`, 400)
  }
  return normalized
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) return undefined
  return normalized
}

function optionalLocalizedName(value: unknown): { en?: string; zh?: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const localized = value as Record<string, unknown>
  const en = optionalString(localized.en, 100)
  const zh = optionalString(localized.zh, 100)
  return en || zh ? { ...(en ? { en } : {}), ...(zh ? { zh } : {}) } : undefined
}
