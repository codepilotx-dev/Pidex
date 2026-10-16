import { describe, expect, test } from 'bun:test'
import type { PluginDetails, PluginSummary } from '@pidex/agent-protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import { PluginProductDetailsView } from '../src/features/plugins/PluginProductDetailsView.js'
import { mergePluginCatalog } from '../src/features/plugins/PluginCatalog.js'

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
  const item = mergePluginCatalog([taskPlanning]).find(
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
  test('keeps the plugin switch separate from the unavailable skill switch', () => {
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
    expect(html).toContain('aria-label="启用 任务规划 插件"')
    expect(html).toContain('aria-label="启用 task-planning 技能"')
    expect(html.match(/role="switch"/g)).toHaveLength(2)
    const skillSwitch = html.match(/<button[^>]*aria-label="启用 task-planning 技能"[^>]*>/)?.[0]
    expect(skillSwitch).toContain('disabled=""')
    expect(html).not.toContain('<dd>task-planning</dd>')
  })

  test('falls back to the summary without rendering an empty prompt banner', () => {
    const html = renderTaskDetails(null)
    expect(html).not.toContain('catalog-plugin-prompts')
    expect(html).not.toContain('catalog-plugin-prompts__background')
    expect(html).not.toContain('立即试用')
    expect(html).toContain('拆解和规划复杂工作')
    expect(html).toContain('aria-label="启用 任务规划 插件"')
  })

  test('groups actual MCP and documentation components without fabricating hooks or duplicate skills', () => {
    const html = renderTaskDetails({
      ...details,
      components: [
        { kind: 'mcp', id: 'node_repl', name: 'node_repl', description: '', managedBy: 'host' },
        {
          kind: 'documentation',
          id: 'api',
          name: 'API.md',
          description: '电脑控制 API',
          managedBy: 'plugin',
        },
        {
          kind: 'skill',
          id: 'task-planning',
          name: 'task-planning',
          description: '',
          managedBy: 'plugin',
        },
      ],
    })
    expect(html).toContain('MCP 服务器 1')
    expect(html).toContain('文档 1')
    expect(html).toContain('由 Pidex 宿主管理')
    expect(html).not.toContain('catalog-plugin-components')
    expect(html).not.toContain('钩子')
    expect(html.match(/catalog-plugin-skill tw:/g)).toHaveLength(1)
  })

  test('does not render a prompt banner for blank prompts', () => {
    expect(renderTaskDetails({ ...details, defaultPrompts: ['  '] })).not.toContain(
      'catalog-plugin-prompts',
    )
  })

  test('offers management for a removable installed plugin', () => {
    const item = mergePluginCatalog([
      { ...taskPlanning, source: 'installed', canUninstall: true },
    ])[0]!
    const html = renderToStaticMarkup(
      <PluginProductDetailsView
        busy={false}
        details={details}
        item={item}
        onPrimaryAction={() => undefined}
        onTryPrompt={() => undefined}
        onUninstall={() => undefined}
      />,
    )
    expect(html).toContain('aria-label="更多插件操作"')
    expect(html).not.toContain('MiniMax')
  })
})

test('uninstalled and disabled plugins can prepare a prompt and optional metadata remains conditional', () => {
  const item = mergePluginCatalog([
    {
      ...taskPlanning,
      id: 'demo',
      source: 'installed',
      installed: false,
      enabled: false,
      canInstall: true,
    },
  ])[0]!
  const html = renderToStaticMarkup(
    <PluginProductDetailsView
      busy={false}
      item={item}
      details={{
        ...details,
        longDescription: item.description,
        websiteURL: 'https://example.com',
        privacyPolicyURL: 'https://example.com/privacy',
      }}
      onPrimaryAction={() => undefined}
      onTryPrompt={() => undefined}
    />,
  )
  const prompt = html.match(/<button[^>]*class="catalog-plugin-prompts__item[^>]*>/)?.[0]
  expect(prompt).toBeDefined()
  expect(prompt).not.toContain('disabled=""')
  expect(html).toContain('隐私政策')
  expect(html).not.toContain('服务条款')
  expect(html).not.toContain('catalog-plugin-details__description')
  expect(html).not.toContain('>task-planning</dd>')
})
