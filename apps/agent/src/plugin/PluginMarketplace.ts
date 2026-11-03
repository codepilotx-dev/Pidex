import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  PluginDetails,
  PluginSummary,
  PluginMarketplaceSection,
  PluginAssetKind,
} from '@pidex/agent-protocol'

import {
  MAX_PLUGIN_ASSET_BYTES,
  pluginAssetResult,
  pluginPresentation,
  type PluginAssets,
} from './PluginPresentation'

const REPOSITORY = 'codepilotx-dev/Pidex-Plugins'
export const MAX_PLUGIN_ARCHIVE_BYTES = 32 * 1024 * 1024
// shortcut: 仓库 ZIP 限制为 32 MiB，目录增长后改为独立插件包。
const MAX_CATALOG_BYTES = 1024 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true })

export type MarketplaceEntry = {
  path: string
  assets: PluginAssets
  summary: PluginSummary
  details: PluginDetails
}

type Catalog = { commit: string; entries: MarketplaceEntry[]; sections: PluginMarketplaceSection[] }

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效目录')
  return value as Record<string, unknown>
}
const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('无效目录字段')
  return value
}

export function marketplacePath(value: unknown): string {
  const path = text(value)
  if (!/^plugins\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path)) {
    throw new Error('无效插件路径')
  }
  return path
}

export function parseCatalog(value: unknown): Pick<Catalog, 'entries' | 'sections'> {
  const catalog = object(value)
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.plugins)) throw new Error('无效目录')
  const ids = new Set<string>()
  const entries = catalog.plugins.map((raw): MarketplaceEntry => {
    const entry = object(raw)
    const id = text(entry.id)
    const version = text(entry.version)
    if (
      !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(id) ||
      ids.has(id) ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
        version,
      )
    ) {
      throw new Error('无效插件身份')
    }
    ids.add(id)
    const skills = entry.skills === undefined ? [] : entry.skills
    const prompts = entry.defaultPrompts === undefined ? [] : entry.defaultPrompts
    if (!Array.isArray(skills) || !Array.isArray(prompts)) throw new Error('无效插件详情')
    const presentation = pluginPresentation(entry)
    const details: PluginDetails = {
      ...presentation.links,
      pluginId: id,
      longDescription: text(entry.longDescription ?? entry.description),
      displayCapabilities: Array.isArray(entry.displayCapabilities)
        ? entry.displayCapabilities.map(text)
        : [],
      defaultPrompts: prompts.map(text),
      skills: skills.map((rawSkill) => {
        const skill = object(rawSkill)
        return { id: text(skill.id), name: text(skill.name), description: text(skill.description) }
      }),
    }
    return {
      path: marketplacePath(entry.path),
      assets: presentation.assets,
      summary: {
        id,
        inMarketplace: true,
        assetKinds: Object.keys(presentation.assets) as PluginAssetKind[],
        version,
        name: text(entry.name),
        description: text(entry.description),
        developerName: text(entry.developerName),
        category: text(entry.category),
        source: 'installed',
        installationPolicy: 'AVAILABLE',
        status: 'ready',
        installed: false,
        enabled: false,
        capabilities: [],
        skills: details.skills.map((skill) => skill.id),
        canInstall: true,
        canUninstall: false,
      },
      details,
    }
  })
  const sectionIds = new Set<string>()
  const sections: PluginMarketplaceSection[] = (
    Array.isArray(catalog.sections) ? catalog.sections : []
  ).map((raw) => {
    const section = object(raw)
    const id = text(section.id)
    if (sectionIds.has(id) || !/^[A-Za-z0-9_-]+$/.test(id) || !Array.isArray(section.pluginIds))
      throw new Error('无效栏目')
    sectionIds.add(id)
    const pluginIds = section.pluginIds.map(text)
    if (new Set(pluginIds).size !== pluginIds.length || pluginIds.some((id) => !ids.has(id)))
      throw new Error('无效栏目引用')
    return { id, title: text(section.title), pluginIds }
  })
  return { entries, sections }
}

export async function downloadPluginBytes(
  fetcher: typeof fetch,
  url: string,
  limit: number,
): Promise<Uint8Array> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok || !response.body) throw new Error('下载失败')
  if (Number(response.headers.get('content-length')) > limit) throw new Error('下载过大')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) throw new Error('下载过大')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export class PluginMarketplace {
  private catalog: Catalog | undefined
  private loading: Promise<void> | undefined
  error: string | undefined

  constructor(
    private readonly root: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  entries() {
    return this.catalog?.entries ?? []
  }

  sections() {
    return this.catalog?.sections ?? []
  }

  async refresh(force = false) {
    if (this.loading) return this.loading
    if (this.catalog && !force) return
    this.loading = this.load().finally(() => {
      this.loading = undefined
    })
    return this.loading
  }

  private async load() {
    this.error = undefined
    try {
      await mkdir(this.root, { recursive: true })
      if ((await lstat(this.root)).isSymbolicLink()) throw new Error('缓存路径无效')
    } catch {
      this.error = '插件目录缓存不可用，请检查数据目录。'
      return
    }
    try {
      const ref = object(
        JSON.parse(
          decoder.decode(
            await downloadPluginBytes(
              this.fetcher,
              `https://api.github.com/repos/${REPOSITORY}/commits/main`,
              MAX_CATALOG_BYTES,
            ),
          ),
        ),
      )
      const commit = text(ref.sha)
      if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('无效提交')
      const raw: unknown = JSON.parse(
        decoder.decode(
          await downloadPluginBytes(
            this.fetcher,
            `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/marketplace.json`,
            MAX_CATALOG_BYTES,
          ),
        ),
      )
      const parsed = parseCatalog(raw)
      const temporary = join(this.root, `catalog-${crypto.randomUUID()}.tmp`)
      try {
        await writeFile(temporary, JSON.stringify({ commit, catalog: raw }), 'utf8')
        await rename(temporary, join(this.root, 'catalog.json'))
      } finally {
        await rm(temporary, { force: true })
      }
      this.catalog = { commit, ...parsed }
    } catch {
      this.error = '插件目录获取失败，请检查网络后刷新重试。'
      if (!this.catalog) {
        try {
          if ((await lstat(join(this.root, 'catalog.json'))).isSymbolicLink())
            throw new Error('缓存路径无效')
          const bytes = await readFile(join(this.root, 'catalog.json'))
          if (bytes.byteLength > MAX_CATALOG_BYTES) throw new Error('缓存过大')
          const cache = object(JSON.parse(decoder.decode(bytes)))
          const commit = text(cache.commit)
          if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('缓存无效')
          this.catalog = { commit, ...parseCatalog(cache.catalog) }
        } catch {
          /* 无缓存时仍保留本地插件。 */
        }
      }
    }
  }

  async readAsset(pluginId: string, kind: PluginAssetKind) {
    await this.refresh()
    const catalog = this.catalog
    const entry = catalog?.entries.find((plugin) => plugin.summary.id === pluginId)
    const path = entry?.assets[kind]
    if (!catalog || !entry || !path) throw new Error('图片不存在')
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error('缓存路径无效')
    const cached = join(this.root, `${catalog.commit}-${pluginId}-${kind}.asset`)
    try {
      const stat = await lstat(cached)
      if (!stat.isSymbolicLink() && stat.size <= MAX_PLUGIN_ASSET_BYTES)
        return pluginAssetResult(await readFile(cached))
    } catch {
      /* 未缓存时读取固定提交。 */
    }
    const bytes = await downloadPluginBytes(
      this.fetcher,
      `https://raw.githubusercontent.com/${REPOSITORY}/${catalog.commit}/${entry.path}/${path.split('/').map(encodeURIComponent).join('/')}`,
      MAX_PLUGIN_ASSET_BYTES,
    )
    const result = pluginAssetResult(bytes)
    const temporary = join(this.root, `asset-${crypto.randomUUID()}.tmp`)
    try {
      await writeFile(temporary, bytes)
      await rename(temporary, cached)
    } finally {
      await rm(temporary, { force: true })
    }
    return result
  }

  async archive(pluginId: string) {
    await this.refresh()
    const entry = this.catalog?.entries.find((plugin) => plugin.summary.id === pluginId)
    if (!entry || !this.catalog) throw new Error('插件不在目录中')
    const { commit } = this.catalog
    const bytes = await downloadPluginBytes(
      this.fetcher,
      `https://codeload.github.com/${REPOSITORY}/zip/${commit}`,
      MAX_PLUGIN_ARCHIVE_BYTES,
    )
    return {
      entry,
      commit,
      bytes,
      prefix: `Pidex-Plugins-${commit}`,
    }
  }
}
