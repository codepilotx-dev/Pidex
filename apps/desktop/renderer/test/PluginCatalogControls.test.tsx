import { describe, expect, test } from 'bun:test'
import type { PluginSummary } from '@pidex/agent-protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../src/components/ui/Tooltip.js'
import { SkillCatalogCard } from '../src/features/plugins/SkillCatalogCard.js'
import { PluginIcon } from '../src/features/plugins/PluginIcon.js'
import {
  DesktopThemeContext,
  type DesktopThemeContextValue,
} from '../src/features/theme/ThemeContext.js'
import { PluginCatalogCard } from '../src/features/plugins/PluginCatalogCard.js'
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

function renderCard(
  id: 'task-planning' | 'pidex-demo',
  _unused?: undefined,
  enabled = true,
  error?: string,
): string {
  const plugin =
    id === 'pidex-demo'
      ? {
          ...taskPlanning,
          id,
          name: 'Pidex Demo',
          installed: false,
          enabled: false,
          source: 'installed' as const,
          canInstall: true,
        }
      : { ...taskPlanning, enabled }
  const item = mergePluginCatalog([plugin]).find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Missing plugin fixture: ${id}`)
  return renderToStaticMarkup(
    <TooltipProvider>
      <PluginCatalogCard
        item={item}
        error={error}
        onOpenDetails={() => undefined}
        onPrimaryAction={() => undefined}
      />
    </TooltipProvider>,
  )
}

describe('plugin catalog controls', () => {
  test('renders installed task planning with a management menu', () => {
    const html = renderCard('task-planning')
    expect(html).toContain('data-catalog-item-id="plugin:task-planning"')
    expect(html).toContain('data-plugin-status="enabled"')
    expect(html).toContain('管理 任务规划')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('role="switch"')
    expect(html).toContain('<img')
    expect(html).toContain('lucide-ellipsis')
    expect(html.match(/<button/g)).toHaveLength(2)
  })

  test('keeps a disabled installed plugin manageable', () => {
    const html = renderCard('task-planning', undefined, false)
    expect(html).toContain('data-plugin-status="disabled"')
    expect(html).toContain('管理 任务规划')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('disabled=""')
  })

  test('keeps errors and keyboard focus outside the faded plugin content', () => {
    const html = renderCard('task-planning', undefined, false, '更新失败')
    const main = html.match(/<button[^>]*data-plugin-status="disabled"[^>]*>/)?.[0]
    expect(main).toBeDefined()
    expect(main).not.toContain('opacity-')
    expect(main).toContain('focus-visible:outline-2')
    const error = html.match(/<span[^>]*class="plugin-catalog-card__error[^>]*>/)?.[0]
    expect(error).toBeDefined()
    expect(error).not.toContain('opacity-')
    expect(html).toContain('tw:opacity-60')
  })

  test('keeps the skill icon and copy in horizontal columns', () => {
    const html = renderToStaticMarkup(
      <SkillCatalogCard
        skill={{
          id: 'one',
          slug: 'one',
          name: 'One',
          source: 'local',
          installs: 0,
          sourceType: 'local',
          installUrl: null,
          url: '',
          isDuplicate: false,
          installed: false,
          audit: null,
        }}
        onInstall={() => undefined}
        onOpenDetails={() => undefined}
      />,
    )
    expect(html).toContain('tw:grid-cols-[auto_minmax(0,1fr)]')
    expect(html).toContain('tw:p-3')
    expect(html).not.toContain('tw:p-2.5')
  })

  test('shows a logo without a dark replacement in the dark theme', () => {
    const theme = { resolvedVariant: 'dark' } as DesktopThemeContextValue
    const html = renderToStaticMarkup(
      <DesktopThemeContext.Provider value={theme}>
        <PluginIcon name="browser" />
      </DesktopThemeContext.Provider>,
    )
    expect(html).toContain('<img')
    expect(html).not.toContain('tw:hidden')
    const themed = renderToStaticMarkup(
      <DesktopThemeContext.Provider value={theme}>
        <PluginIcon name="github" />
      </DesktopThemeContext.Provider>,
    )
    expect(themed).toContain('plugin-logo__image--light tw:hidden')
    expect(themed).toContain('plugin-logo__image--dark tw:block')
  })

  test('renders a downloadable demo with an enabled install action', () => {
    const html = renderCard('pidex-demo')
    expect(html).toContain('未安装')
    expect(html).toContain('安装 Pidex Demo')
    expect(html).toContain('lucide-plus')
    expect(html).not.toContain('disabled=""')
  })
})
