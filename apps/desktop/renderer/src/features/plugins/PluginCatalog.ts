import type { MiniMaxCliStatus, PluginSummary } from '@pidex/agent-protocol'

export type PluginCategory = 'included' | 'manageable' | 'external'
export type PluginRuntimeStatus =
  'loading' | 'enabled' | 'disabled' | 'installed' | 'not-installed' | 'unavailable' | 'error'
export type PluginActionKind =
  'install' | 'toggle-plugin' | 'open-external' | 'install-minimax' | 'update-minimax'
export type PluginIconName =
  | 'plugin'
  | 'task-planning'
  | 'browser'
  | 'computer-use'
  | 'chrome'
  | 'spreadsheets'
  | 'presentations'
  | 'github'
  | 'minimax'
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
  miniMaxCli?: MiniMaxCliStatus
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
      kind: 'install' | 'open-external' | 'install-minimax' | 'update-minimax'
      label: string
      disabled: boolean
    }

export const MINIMAX_CLI_DOCS_URL = 'https://github.com/MiniMax-AI/cli'
export const PLUGIN_CATEGORY_ORDER = [
  'included',
  'manageable',
  'external',
] as const satisfies readonly PluginCategory[]
export const PLUGIN_CATEGORY_LABELS: Record<PluginCategory, string> = {
  manageable: '可管理',
  included: 'Featured',
  external: '外部工具',
}

const FEATURED_UNAVAILABLE = { actionKind: 'install', category: 'included' } as const
export const PLUGIN_CATALOG_DESCRIPTORS = [
  {
    ...FEATURED_UNAVAILABLE,
    id: 'computer-use',
    name: 'Computer Use',
    description: '通过 Pidex 控制 Windows 应用',
    iconName: 'computer-use',
    tone: 'pidex',
  },
  {
    ...FEATURED_UNAVAILABLE,
    id: 'browser',
    name: 'Browser',
    description: '控制应用内浏览器并执行网页任务',
    iconName: 'browser',
    tone: 'chrome',
  },
  {
    ...FEATURED_UNAVAILABLE,
    id: 'chrome',
    name: 'Chrome',
    description: '通过 Pidex 控制 Chrome 浏览器',
    iconName: 'chrome',
    tone: 'chrome',
  },
  {
    ...FEATURED_UNAVAILABLE,
    id: 'spreadsheets',
    name: 'Spreadsheets',
    description: '创建和编辑电子表格文件',
    iconName: 'spreadsheets',
    tone: 'sheet',
  },
  {
    ...FEATURED_UNAVAILABLE,
    id: 'presentations',
    name: 'Presentations',
    description: '创建和编辑演示文稿',
    iconName: 'presentations',
    tone: 'slides',
  },
  {
    ...FEATURED_UNAVAILABLE,
    id: 'github',
    name: 'GitHub',
    description: '处理 PR、Issue、CI 和发布流程',
    iconName: 'github',
    tone: 'github',
  },
  {
    id: 'minimax',
    externalURL: MINIMAX_CLI_DOCS_URL,
    name: 'MiniMax CLI',
    description: '安装官方 CLI，通过 MiniMax 生成文本、图片、视频和音频',
    category: 'external',
    actionKind: 'open-external',
    iconName: 'minimax',
    tone: 'creative',
  },
] as const satisfies readonly PluginCatalogDescriptor[]

function runtimeIconName(id: string): PluginIconName {
  if (id === 'computer-use') return 'computer-use'
  return id === 'task-planning' ? 'task-planning' : 'plugin'
}

export function mergePluginCatalog(
  descriptors: readonly PluginCatalogDescriptor[],
  plugins: readonly PluginSummary[] | undefined,
  loadError: unknown = null,
  miniMax?: {
    status?: MiniMaxCliStatus
    loading?: boolean
    unsupported?: boolean
    error?: string | null
  },
): PluginCatalogItem[] {
  const staticItems: PluginCatalogItem[] = descriptors.map((descriptor) => {
    if (descriptor.id === 'minimax' && miniMax && !miniMax.unsupported) {
      const status = miniMax.status
      const installed =
        status?.installationStatus === 'installed' ||
        status?.installationStatus === 'updating' ||
        status?.installationStatus === 'uninstalling'
      const missingPrerequisite = status?.installationStatus === 'missing-prerequisite'
      return {
        ...descriptor,
        actionKind: status?.updateAvailable ? 'update-minimax' : 'install-minimax',
        installed,
        enabled: false,
        status: miniMax.loading
          ? 'loading'
          : miniMax.error || status?.installationStatus === 'error'
            ? 'error'
            : missingPrerequisite
              ? 'unavailable'
              : installed
                ? 'installed'
                : 'not-installed',
        ...(status?.installedVersion ? { version: status.installedVersion } : {}),
        ...(missingPrerequisite
          ? { unavailableReason: status.prerequisiteReason ?? '需要 Node.js 18 或更高版本' }
          : {}),
        ...(miniMax.error ? { unavailableReason: miniMax.error } : {}),
        ...(status ? { miniMaxCli: status } : {}),
      }
    }
    return {
      ...descriptor,
      installed: false,
      enabled: false,
      status: 'unavailable',
      ...(descriptor.actionKind === 'install'
        ? {
            availabilityLabel: '即将推出',
            unavailableReason: '能力接入中，暂不可安装',
          }
        : {}),
    }
  })
  if (plugins === undefined || (loadError !== null && loadError !== undefined)) return staticItems

  const runtimeItems = plugins.map<PluginCatalogItem>((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    category: 'manageable',
    actionKind: plugin.installed ? 'toggle-plugin' : 'install',
    iconName: runtimeIconName(plugin.id),
    tone: plugin.id === 'task-planning' ? 'pidex' : 'creative',
    status: plugin.status === 'ready' ? (plugin.enabled ? 'enabled' : 'disabled') : 'unavailable',
    installed: plugin.installed,
    enabled: plugin.enabled,
    version: plugin.version,
    developerName: plugin.developerName,
    productCategory: plugin.category,
    capabilities: plugin.capabilities,
    skills: plugin.skills,
    ...(plugin.unavailableReason
      ? { unavailableReason: plugin.unavailableReason }
      : !plugin.installed
        ? { unavailableReason: '安装能力尚未接入，暂不可安装' }
        : {}),
    ...(!plugin.installed ? { availabilityLabel: '即将推出' } : {}),
  }))
  const runtimeIds = new Set(runtimeItems.map((item) => item.id))
  return [...staticItems.filter((item) => !runtimeIds.has(item.id)), ...runtimeItems]
}

export function filterPluginCatalog(
  items: readonly PluginCatalogItem[],
  query: string,
  category: PluginCategoryFilter,
  status: PluginStatusFilter,
): PluginCatalogItem[] {
  const keyword = query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (category !== 'all' && item.category !== category) return false
    if (status === 'unavailable') {
      if (item.status !== 'unavailable' && item.status !== 'error') return false
    } else if (status !== 'all' && item.status !== status) return false
    return !keyword || `${item.name}\n${item.description}`.toLocaleLowerCase().includes(keyword)
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

export function pluginPrimaryAction(item: PluginCatalogItem): PluginPrimaryAction {
  if (item.actionKind === 'open-external')
    return { kind: 'open-external', label: '查看安装说明', disabled: !item.externalURL }
  if (item.actionKind === 'install-minimax') {
    if (item.status === 'installed')
      return { kind: 'install-minimax', label: '已安装', disabled: true }
    return {
      kind: 'install-minimax',
      label: '安装',
      disabled: item.status === 'loading' || item.status === 'unavailable',
    }
  }
  if (item.actionKind === 'update-minimax')
    return {
      kind: 'update-minimax',
      label: '更新',
      disabled: item.status === 'loading' || item.status === 'unavailable',
    }
  if (item.actionKind === 'install') return { kind: 'install', label: '安装', disabled: true }
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
  if (item.id === 'minimax') {
    if (item.actionKind === 'open-external') return '外部工具'
    if (item.status === 'loading') return '正在检查'
    if (item.status === 'installed') {
      if (item.miniMaxCli?.authStatus === 'coding-plan-synced') return '已安装 · 已连接 Coding Plan'
      if (item.miniMaxCli?.authStatus === 'api-key' || item.miniMaxCli?.authStatus === 'oauth') {
        return '已安装 · 已登录'
      }
      return '已安装 · 尚未登录'
    }
    if (item.status === 'not-installed') return '未安装'
    if (item.status === 'error') return '状态读取失败'
    return item.unavailableReason ?? '当前不可用'
  }
  if (item.category === 'external') return '外部工具'
  if (item.actionKind === 'install') return item.availabilityLabel ?? '当前不可用'
  if (item.status === 'loading') return '正在检查'
  if (item.status === 'enabled') return '已启用'
  if (item.status === 'disabled') return '已禁用'
  if (item.status === 'error') return '状态读取失败'
  return '当前不可用'
}
