import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ProviderCatalog, type ProviderCatalogItem } from '../src/features/models/ProviderCatalog.js'
import { SidebarProvidersPane } from '../src/features/layout/sidebar/SidebarProvidersPane.js'

function makeItem(id: string, name: string, canAddConnection: boolean): ProviderCatalogItem {
  return {
    id,
    name,
    source: '内置',
    modelCount: 3,
    current: false,
    canAddConnection,
  }
}

describe('ProviderMarketCatalog', () => {
  test('按已配置和未配置分组展示供应商', () => {
    const providers: ProviderCatalogItem[] = [
      makeItem('openai', 'OpenAI', false),
      makeItem('anthropic', 'Anthropic', true),
      makeItem('deepseek', 'DeepSeek', true),
    ]

    const html = renderToStaticMarkup(
      <ProviderCatalog
        providers={providers}
        onSelect={() => {}}
        onAddConnection={() => {}}
        onManageConnection={() => {}}
      />,
    )

    expect(html).toContain('已配置')
    expect(html).toContain('未配置')
    expect(html).toContain('OpenAI')
    expect(html).toContain('Anthropic')
    expect(html).toContain('DeepSeek')

    // 确保已配置组在未配置组之前
    const configuredIndex = html.indexOf('已配置')
    const unconfiguredIndex = html.indexOf('未配置')
    expect(configuredIndex).toBeGreaterThan(-1)
    expect(unconfiguredIndex).toBeGreaterThan(configuredIndex)

    // 分组项直接平铺在界面上，不使用 settings-management-list 大卡片外框
    expect(html).not.toContain('settings-management-list')
    expect(html).toContain('model-center-catalog-list')
  })

  test('仅有已配置供应商时只展示已配置分组', () => {
    const providers: ProviderCatalogItem[] = [makeItem('openai', 'OpenAI', false)]

    const html = renderToStaticMarkup(
      <ProviderCatalog
        providers={providers}
        onSelect={() => {}}
        onAddConnection={() => {}}
        onManageConnection={() => {}}
      />,
    )

    expect(html).toContain('已配置')
    expect(html).not.toContain('未配置')
  })

  test('仅有未配置供应商时只展示未配置分组', () => {
    const providers: ProviderCatalogItem[] = [makeItem('anthropic', 'Anthropic', true)]

    const html = renderToStaticMarkup(
      <ProviderCatalog
        providers={providers}
        onSelect={() => {}}
        onAddConnection={() => {}}
        onManageConnection={() => {}}
      />,
    )

    expect(html).not.toContain('已配置')
    expect(html).toContain('未配置')
  })

  test('操作按钮仅图标且无文字，带有 Tooltip 和无障碍说明', () => {
    const providers: ProviderCatalogItem[] = [
      makeItem('openai', 'OpenAI', false),
      makeItem('anthropic', 'Anthropic', true),
    ]

    const html = renderToStaticMarkup(
      <ProviderCatalog
        providers={providers}
        onSelect={() => {}}
        onAddConnection={() => {}}
        onManageConnection={() => {}}
      />,
    )

    // 按钮无文字内容，文字移至 aria-label / title / tooltip
    expect(html).not.toContain('>查看<')
    expect(html).not.toContain('>连接<')
    expect(html).toContain('aria-label="查看 OpenAI"')
    expect(html).toContain('title="查看 OpenAI"')
    expect(html).toContain('aria-label="连接 Anthropic"')
    expect(html).toContain('title="连接 Anthropic"')
  })

  test('供应商侧栏头部包含「市场」与「新建供应商」导航', () => {
    const marketHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/providers']}>
        <SidebarProvidersPane />
      </MemoryRouter>,
    )

    expect(marketHtml).toContain('市场')
    expect(marketHtml).toContain('新建供应商')
    // 处于市场路由时，包含 aria-current="page" 高亮当前页面
    expect(marketHtml).toContain('aria-current="page"')

    const providerDetailHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/providers?provider=openai']}>
        <SidebarProvidersPane />
      </MemoryRouter>,
    )

    expect(providerDetailHtml).toContain('市场')
    // 处于未保存的新建或无选中的其他子状态时，市场按钮不高亮为当前页面
    expect(providerDetailHtml).not.toContain('aria-current="page"')
  })
})
