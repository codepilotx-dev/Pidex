import { describe, expect, test } from 'bun:test'
import type { PluginSummary } from '@pidex/agent-protocol'
import {
  filterPluginCatalog,
  groupMarketplacePlugins,
  groupPluginCatalogBySource,
  mergePluginCatalog,
  pluginPrimaryAction,
  pluginStatusLabel,
  selectInstalledPluginOverview,
} from '../src/features/plugins/PluginCatalog.js'
import { groupSkillsForDisplay } from '../src/features/plugins/SkillCatalog.js'
import type { DesktopSkillCatalogItem } from '../shared/Types.js'

const builtin: PluginSummary = {
  id: 'task-planning',
  name: '任务规划',
  version: '1.0.0',
  description: '规划复杂工作',
  developerName: 'Pidex',
  category: 'Productivity',
  source: 'bundled',
  installationPolicy: 'INSTALLED_BY_DEFAULT',
  installed: true,
  enabled: true,
  status: 'ready',
  capabilities: [],
  skills: ['task-planning'],
}
const demo: PluginSummary = {
  ...builtin,
  id: 'pidex-demo',
  name: 'Pidex Demo',
  source: 'installed',
  installationPolicy: 'AVAILABLE',
  installed: false,
  enabled: false,
  canInstall: true,
  canUninstall: false,
}
const catalog = (plugins: PluginSummary[] = [builtin, demo]) => mergePluginCatalog(plugins)

test('catalog contains only discovered plugins and retains them on remote errors', () => {
  expect(catalog().map((item) => item.id)).toEqual(['task-planning', 'pidex-demo'])
  expect(catalog([builtin])).toHaveLength(1)
  expect(catalog([])).toEqual([])
})
test('remote plugin offers installation, installed plugin offers toggle and removal', () => {
  const item = catalog()[1]!
  expect(pluginStatusLabel(item)).toBe('未安装')
  expect(pluginPrimaryAction(item)).toEqual({ kind: 'install', label: '安装', disabled: false })
  const installed = catalog([
    { ...demo, installed: true, enabled: false, canInstall: false, canUninstall: true },
  ])[0]!
  expect(pluginPrimaryAction(installed)).toEqual({
    kind: 'toggle-plugin',
    label: '启用',
    disabled: false,
    checked: false,
  })
  expect(installed.canUninstall).toBe(true)
  expect(catalog()[0]?.canUninstall).toBe(false)
  expect(pluginPrimaryAction(catalog([{ ...demo, canInstall: false }])[0]!).disabled).toBe(true)
})
test('filters actual names, categories and enabled state', () => {
  expect(
    filterPluginCatalog(catalog(), ' DEMO ', 'manageable', 'all').map((item) => item.id),
  ).toEqual(['pidex-demo'])
  expect(filterPluginCatalog(catalog(), '', 'included', 'enabled').map((item) => item.id)).toEqual([
    'task-planning',
  ])
  expect(groupPluginCatalogBySource(catalog()).map((group) => group.category)).toEqual([
    'included',
    'manageable',
  ])
  expect(selectInstalledPluginOverview(catalog()).map((item) => item.id)).toEqual(['task-planning'])
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

test('market sections retain repository ordering, merge installed state and include uncategorized entries', () => {
  const items = mergePluginCatalog([
    { ...demo, installed: true, enabled: false, inMarketplace: true },
    { ...demo, id: 'other', name: 'Other', developerName: 'Acme' },
  ])
  const groups = groupMarketplacePlugins(items, [
    { id: 'featured', title: '推荐', pluginIds: ['pidex-demo', 'pidex-demo', 'missing'] },
  ])
  expect(groups.map((group) => group.id)).toEqual(['featured', '!other'])
  expect(groups[0]?.items).toHaveLength(1)
  expect(groups[0]?.items[0]).toMatchObject({ installed: true, enabled: false })
  expect(filterPluginCatalog(items, 'Acme', 'all', 'all').map((item) => item.id)).toEqual(['other'])
  expect(filterPluginCatalog(items, 'Productivity', 'all', 'all')).toHaveLength(2)
})
