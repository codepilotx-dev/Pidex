import { describe, expect, test } from 'bun:test'
import type { MiniMaxCliStatus, PluginDetails, PluginSummary } from '@pidex/agent-protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import { PluginProductDetailsView } from '../src/features/plugins/PluginProductDetailsView.js'
import {
  PLUGIN_CATALOG_DESCRIPTORS,
  mergePluginCatalog,
} from '../src/features/plugins/PluginCatalog.js'

const taskPlanning: PluginSummary = {
  id: 'task-planning',
  name: '任务规划',
  version: '1.0.0',
  description: '拆解和规划复杂工作',
  developerName: 'Pidex',
  category: 'Productivity',
  source: 'bundled',
  installationPolicy: 'INSTALLED_BY_DEFAULT',
  installed: true,
  enabled: true,
  status: 'ready',
  capabilities: ['task-planning'],
  skills: ['task-planning'],
}

const details: PluginDetails = {
  pluginId: 'task-planning',
  longDescription: '澄清目标与约束，将复杂工作拆分为里程碑和可执行任务。',
  displayCapabilities: ['Planning'],
  defaultPrompts: ['提示词一', '提示词二', '提示词三'],
  skills: [{ id: 'task-planning', name: 'task-planning', description: '真实的技能说明。' }],
}

function renderTaskDetails(pluginDetails: PluginDetails | null): string {
  const item = mergePluginCatalog(PLUGIN_CATALOG_DESCRIPTORS, [taskPlanning]).find(
    (candidate) => candidate.id === 'task-planning',
  )!
  return renderToStaticMarkup(
    <PluginProductDetailsView
      busy={false}
      details={pluginDetails}
      item={item}
      onPrimaryAction={() => undefined}
      onTryPrompt={() => undefined}
    />,
  )
}

describe('Codex-style plugin product details', () => {
  test('renders real prompts, display capability, Skill metadata, and the plugin-level switch', () => {
    const html = renderTaskDetails(details)
    expect(html).toContain('立即试用')
    expect(html).toContain('aria-label="示例提示词"')
    expect(html.match(/catalog-plugin-prompts__background/g)).toHaveLength(1)
    // 外观已迁到 Tailwind utility，断言只锁定背景图的存在与属性顺序。
    expect(html).toMatch(
      /<img alt="" aria-hidden="true" class="catalog-plugin-prompts__background[^"]*"/,
    )
    expect(html.match(/catalog-plugin-prompts__item/g)).toHaveLength(3)
    expect(html.match(/catalog-plugin-prompts__plugin-icon/g)).toHaveLength(3)
    expect(html).toContain('Planning')
    expect(html).toContain('真实的技能说明。')
    expect(html).toContain('aria-label="启用插件及其技能"')
    expect(html).not.toContain('<dd>task-planning</dd>')
  })

  test('falls back to the summary without rendering an empty prompt banner', () => {
    const html = renderTaskDetails(null)
    expect(html).not.toContain('catalog-plugin-prompts')
    expect(html).not.toContain('catalog-plugin-prompts__background')
    expect(html).not.toContain('立即试用')
    expect(html).toContain('拆解和规划复杂工作')
    expect(html).toContain('aria-label="启用插件及其技能"')
  })

  test('keeps MiniMax install metadata and official guidance', () => {
    const miniMax: MiniMaxCliStatus = {
      installationStatus: 'installed',
      installedVersion: '1.2.3',
      latestVersion: '1.2.3',
      updateAvailable: false,
      nodeVersion: 'v22.0.0',
      npmVersion: '10.0.0',
      authStatus: 'not-authenticated',
      generation: 1,
      updatedAt: 1,
    }
    const item = mergePluginCatalog(PLUGIN_CATALOG_DESCRIPTORS, [], null, { status: miniMax }).find(
      (candidate) => candidate.id === 'minimax',
    )!
    const html = renderToStaticMarkup(
      <PluginProductDetailsView
        busy={false}
        details={null}
        item={item}
        onPrimaryAction={() => undefined}
        onTryPrompt={() => undefined}
        onUninstall={() => undefined}
      />,
    )
    expect(html).toContain('已安装')
    expect(html).toContain('最新版本')
    expect(html).toContain('尚未登录，实际使用时再登录')
    expect(html).toContain('查看官方说明')
    expect(html).toContain('aria-label="更多插件操作"')
  })
})
