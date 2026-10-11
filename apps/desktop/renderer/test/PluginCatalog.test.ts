import { describe, expect, test } from 'bun:test'
import type { MiniMaxCliStatus, PluginSummary } from '@pidex/agent-protocol'
import {
  PLUGIN_CATALOG_DESCRIPTORS,
  filterPluginCatalog,
  groupPluginCatalogBySource,
  mergePluginCatalog,
  pluginPrimaryAction,
  pluginStatusLabel,
  selectInstalledPluginOverview,
} from '../src/features/plugins/PluginCatalog.js'
import { groupSkillsForDisplay } from '../src/features/plugins/SkillCatalog.js'
import type { DesktopSkillCatalogItem } from '../shared/Types.js'

function taskPlanning(enabled: boolean): PluginSummary {
  return {
    id: 'task-planning',
    name: '任务规划',
    version: '1.0.0',
    description: '澄清目标并生成可执行的任务规划。',
    developerName: 'Pidex',
    category: 'Productivity',
    source: 'bundled',
    installationPolicy: 'INSTALLED_BY_DEFAULT',
    installed: true,
    enabled,
    status: 'ready',
    capabilities: ['task-planning'],
    skills: ['task-planning'],
  }
}

function catalog(
  plugins: PluginSummary[] | undefined = [taskPlanning(true)],
  error: unknown = null,
) {
  return mergePluginCatalog(PLUGIN_CATALOG_DESCRIPTORS, plugins, error)
}

test('computer control replaces its placeholder with one manageable plugin', () => {
  const computer = { ...taskPlanning(false), id: 'computer-use', name: 'Computer Use' }
  const entries = catalog([computer]).filter((item) => item.id === 'computer-use')
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    status: 'disabled',
    iconName: 'computer-use',
    installed: true,
    actionKind: 'toggle-plugin',
  })
})

const miniMaxInstalled: MiniMaxCliStatus = {
  installationStatus: 'installed',
  installedVersion: '1.2.3',
  latestVersion: '1.2.3',
  updateAvailable: false,
  nodeVersion: 'v22.0.0',
  npmVersion: '10.0.0',
  authStatus: 'coding-plan-synced',
  credentialSource: {
    providerId: 'minimax-cn-coding-plan',
    credentialId: 'credential:cn',
    label: 'MiniMax CN Coding Plan',
    maskedValue: 'sk-****plan',
    region: 'cn',
  },
  generation: 2,
  updatedAt: 2,
}

describe('plugin catalog state', () => {
  test('maps the real task planning plugin to enabled and disabled states', () => {
    expect(catalog([taskPlanning(true)]).find((item) => item.id === 'task-planning')?.status).toBe(
      'enabled',
    )
    expect(catalog([taskPlanning(false)]).find((item) => item.id === 'task-planning')?.status).toBe(
      'disabled',
    )
  })

  test('keeps all six Featured plugins unavailable with disabled install actions', () => {
    const featured = catalog().filter((item) => item.category === 'included')
    expect(featured.map((item) => item.id)).toEqual([
      'computer-use',
      'browser',
      'chrome',
      'spreadsheets',
      'presentations',
      'github',
    ])
    for (const item of featured) {
      expect(item.status).toBe('unavailable')
      expect(pluginStatusLabel(item)).toBe('即将推出')
      expect(pluginPrimaryAction(item)).toEqual({ kind: 'install', label: '安装', disabled: true })
    }
  })

  test('keeps static entries visible when the real plugin request fails', () => {
    const items = catalog([], new Error('RPC failed'))
    expect(items).toHaveLength(7)
    expect(items.some((item) => item.id === 'task-planning')).toBe(false)
    expect(items.find((item) => item.id === 'browser')?.status).toBe('unavailable')
  })
})

describe('plugin catalog filtering and actions', () => {
  const items = catalog()

  test('matches trimmed, case-insensitive name and description queries', () => {
    expect(filterPluginCatalog(items, ' GITHUB ', 'all', 'all').map((item) => item.id)).toEqual([
      'github',
    ])
    expect(filterPluginCatalog(items, '任务规划', 'all', 'all').map((item) => item.id)).toEqual([
      'task-planning',
    ])
  })

  test('combines category and status filters', () => {
    expect(filterPluginCatalog(items, '', 'manageable', 'enabled').map((item) => item.id)).toEqual([
      'task-planning',
    ])
    expect(filterPluginCatalog(items, '', 'included', 'disabled')).toEqual([])
  })

  test('keeps the official link fallback when the connected Agent lacks MiniMax CLI support', () => {
    const minimax = items.find((item) => item.id === 'minimax')!
    expect(pluginPrimaryAction(minimax)).toEqual({
      kind: 'open-external',
      label: '查看安装说明',
      disabled: false,
    })
    expect(pluginStatusLabel(minimax)).toBe('外部工具')
  })

  test('maps MiniMax CLI installation, update, and Coding Plan authentication state', () => {
    const installed = mergePluginCatalog(PLUGIN_CATALOG_DESCRIPTORS, [], null, {
      status: miniMaxInstalled,
    }).find((item) => item.id === 'minimax')!
    expect(pluginPrimaryAction(installed)).toEqual({
      kind: 'install-minimax',
      label: '已安装',
      disabled: true,
    })
    expect(pluginStatusLabel(installed)).toBe('已安装 · 已连接 Coding Plan')

    const update = mergePluginCatalog(PLUGIN_CATALOG_DESCRIPTORS, [], null, {
      status: { ...miniMaxInstalled, latestVersion: '1.3.0', updateAvailable: true },
    }).find((item) => item.id === 'minimax')!
    expect(pluginPrimaryAction(update)).toEqual({
      kind: 'update-minimax',
      label: '更新',
      disabled: false,
    })
  })
})

describe('plugin catalog presentation selectors', () => {
  test('groups categories in their fixed order', () => {
    expect(groupPluginCatalogBySource(catalog()).map((group) => group.category)).toEqual([
      'included',
      'manageable',
      'external',
    ])
  })

  test('puts only installed and enabled real plugins on the shelf', () => {
    expect(
      selectInstalledPluginOverview(catalog([taskPlanning(true)])).map((item) => item.id),
    ).toEqual(['task-planning'])
    expect(selectInstalledPluginOverview(catalog([taskPlanning(false)]))).toEqual([])
  })
})

describe('skill catalog presentation selectors', () => {
  const skills = [
    { id: 'one', name: 'One', installed: false },
    { id: 'two', name: 'Two', installed: true },
  ] as DesktopSkillCatalogItem[]

  test('splits installed and recommended skills', () => {
    const groups = groupSkillsForDisplay(skills)
    expect(groups.installed.map((skill) => skill.id)).toEqual(['two'])
    expect(groups.recommended.map((skill) => skill.id)).toEqual(['one'])
  })
})
