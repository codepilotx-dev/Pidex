import type {
  PluginSummary,
  PluginAssetKind,
  PluginMarketplaceSection,
} from '@pidex/agent-protocol'

export type PluginCategory = 'included' | 'manageable' | 'external'
export type PluginRuntimeStatus =
  'loading' | 'enabled' | 'disabled' | 'installed' | 'not-installed' | 'unavailable' | 'error'
export type PluginActionKind = 'install' | 'toggle-plugin' | 'open-external'
export type PluginIconName =
  | 'plugin'
  | 'task-planning'
  | 'browser'
  | 'computer-use'
  | 'chrome'
  | 'spreadsheets'
  | 'presentations'
  | 'github'
export type PluginTone = 'chrome' | 'pidex' | 'sheet' | 'slides' | 'github' | 'creative'

export type PluginCatalogDescriptor = {
  id: string
  externalURL?: string
  name: string
  description: string
  category: PluginCategory
  actionKind: PluginActionKind
  iconName: PluginIconName
  logoSource?: string
  logoDarkSource?: string
  tone: PluginTone
}

export type PluginCatalogItem = PluginCatalogDescriptor & {
  source?: PluginSummary['source']
  workspacePath?: string | null
  assetKinds?: readonly PluginAssetKind[]
  inMarketplace?: boolean
  status: PluginRuntimeStatus
  installed: boolean
  enabled: boolean
  version?: string
  developerName?: string
  productCategory?: string
  capabilities?: readonly string[]
  skills?: readonly string[]
  availabilityLabel?: string
  unavailableReason?: string
  canInstall?: boolean
  canUninstall?: boolean
}

export type PluginCatalogGroup = {
  category: PluginCategory
  label: string
  items: PluginCatalogItem[]
}
export type PluginCategoryFilter = 'all' | PluginCategory
export type PluginStatusFilter = 'all' | 'enabled' | 'disabled' | 'unavailable'
export type PluginPrimaryAction =
  | { kind: 'toggle-plugin'; label: string; disabled: boolean; checked: boolean }
  | {
      kind: 'install' | 'open-external'
      label: string
      disabled: boolean
    }

export const PLUGIN_CATEGORY_ORDER = [
  'included',
  'manageable',
  'external',
] as const satisfies readonly PluginCategory[]
export const PLUGIN_SOURCE_LABELS = {
  bundled: '自带插件',
  installed: '官方仓库',
  workspace: '项目插件',
  personal: '个人插件',
} as const

export const PLUGIN_CATEGORY_LABELS: Record<PluginCategory, string> = {
  manageable: '可管理',
  included: '自带插件',
  external: '外部工具',
}

function runtimeIconName(id: string): PluginIconName {
  if (id === 'computer-use') return 'computer-use'
  return id === 'task-planning' ? 'task-planning' : 'plugin'
}

export function mergePluginCatalog(
  plugins: readonly PluginSummary[] | undefined,
  workspacePath?: string | null,
): PluginCatalogItem[] {
  if (plugins === undefined) return []
  const runtimeItems = plugins.map<PluginCatalogItem>((plugin) => ({
    id: plugin.id,
    workspacePath,
    source: plugin.source,
    assetKinds: plugin.assetKinds,
    inMarketplace: plugin.inMarketplace,
    name: plugin.name,
    description: plugin.description,
    category: plugin.source === 'bundled' ? 'included' : 'manageable',
    canInstall: plugin.canInstall === true,
    canUninstall: plugin.canUninstall === true,
    actionKind: plugin.installed ? 'toggle-plugin' : 'install',
    iconName: runtimeIconName(plugin.id),
    tone: plugin.id === 'task-planning' ? 'pidex' : 'creative',
    status:
      plugin.status === 'ready'
        ? plugin.installed
          ? plugin.enabled
            ? 'enabled'
            : 'disabled'
          : 'not-installed'
        : 'unavailable',
    installed: plugin.installed,
    enabled: plugin.enabled,
    version: plugin.version,
    developerName: plugin.developerName,
    productCategory: plugin.category,
    capabilities: plugin.capabilities,
    skills: plugin.skills,
    ...(plugin.unavailableReason
      ? { unavailableReason: plugin.unavailableReason }
      : !plugin.installed && !plugin.canInstall
        ? { unavailableReason: '此来源不支持下载安装' }
        : {}),
  }))
  return runtimeItems
}

export function filterPluginCatalog(
  items: readonly PluginCatalogItem[],
  query: string,
  category: PluginCategoryFilter,
  status: PluginStatusFilter,
): PluginCatalogItem[] {
  const keyword = query.trim().toLocaleLowerCase()
  const uniqueItems = new Map(items.map((item) => [item.id, item]))
  return [...uniqueItems.values()].filter((item) => {
    if (category !== 'all' && item.category !== category) return false
    if (status === 'unavailable') {
      if (item.status !== 'unavailable' && item.status !== 'error') return false
    } else if (status !== 'all' && item.status !== status) return false
    return (
      !keyword ||
      `${item.name}\n${item.description}\n${item.developerName ?? ''}\n${item.productCategory ?? ''}`
        .toLocaleLowerCase()
        .includes(keyword)
    )
  })
}

export function groupPluginCatalogBySource(
  items: readonly PluginCatalogItem[],
): PluginCatalogGroup[] {
  return PLUGIN_CATEGORY_ORDER.flatMap((category) => {
    const groupedItems = items.filter((item) => item.category === category)
    return groupedItems.length
      ? [{ category, label: PLUGIN_CATEGORY_LABELS[category], items: groupedItems }]
      : []
  })
}

export function selectInstalledPluginOverview(
  items: readonly PluginCatalogItem[],
): PluginCatalogItem[] {
  return items.filter((item) => item.installed && item.enabled)
}

export function groupMarketplacePlugins(
  items: readonly PluginCatalogItem[],
  sections: readonly PluginMarketplaceSection[],
) {
  const byId = new Map(items.map((item) => [item.id, item]))
  const grouped = new Set<string>()
  const groups = sections.map((section) => ({
    id: section.id,
    label: section.title,
    items: [...new Set(section.pluginIds)].flatMap((id) => {
      const item = byId.get(id)
      if (!item) return []
      grouped.add(id)
      return [item]
    }),
  }))
  const remaining = [...byId.values()].filter((item) => !grouped.has(item.id))
  if (remaining.length) groups.push({ id: '!other', label: '全部插件', items: remaining })
  return groups.filter((group) => group.items.length)
}

export function pluginPrimaryAction(item: PluginCatalogItem): PluginPrimaryAction {
  if (item.actionKind === 'open-external')
    return { kind: 'open-external', label: '查看安装说明', disabled: !item.externalURL }
  if (item.actionKind === 'install')
    return {
      kind: 'install',
      label: '安装',
      disabled: !item.canInstall || item.status !== 'not-installed',
    }
  if (item.status === 'enabled')
    return { kind: 'toggle-plugin', label: '禁用', disabled: false, checked: true }
  if (item.status === 'disabled')
    return { kind: 'toggle-plugin', label: '启用', disabled: false, checked: false }
  return {
    kind: 'toggle-plugin',
    label: item.status === 'loading' ? '正在检查' : '当前不可用',
    disabled: true,
    checked: false,
  }
}

export function pluginStatusLabel(item: PluginCatalogItem): string {
  if (item.category === 'external') return '外部工具'
  if (item.status === 'not-installed') return '未安装'
  if (item.status === 'loading') return '正在检查'
  if (item.status === 'enabled') return '已启用'
  if (item.status === 'disabled') return '已禁用'
  if (item.status === 'error') return '状态读取失败'
  return '当前不可用'
}
