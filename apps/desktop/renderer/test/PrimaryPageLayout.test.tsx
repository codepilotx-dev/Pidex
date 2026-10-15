import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrimaryPageLayout } from '../src/features/layout/primary-page/index.js'
import { SearchInput } from '../src/components/ui/SearchInput.js'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

describe('PrimaryPageLayout', () => {
  test('keeps expandable search in the title row and initially out of keyboard navigation', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout
        title="插件"
        description="页面说明"
        expandableSearch
        search={
          <SearchInput
            variant="outlined"
            aria-label="搜索插件"
            placeholder="搜索插件"
            value=""
            onChange={() => undefined}
          />
        }
      >
        内容
      </PrimaryPageLayout>,
    )

    expect(html).toContain('search-heading')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('inert="" aria-hidden="true"')
    expect(html).toContain('清除并关闭搜索')
    expect(html).not.toContain('primary-page-layout__search')
    expect(html.indexOf('search-heading')).toBeLessThan(html.indexOf('页面说明'))
  })
  test('renders title, description, search, navigation, and body in order', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout
        description="页面说明"
        navigation={<div data-slot="navigation">页签</div>}
        search={<div data-slot="search">搜索</div>}
        title="页面标题"
      >
        <div data-slot="body">内容</div>
      </PrimaryPageLayout>,
    )

    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('primary-page-layout__header')
    expect(html).toContain('primary-page-layout__body')
    expect(html).toContain('tw:shrink-0')
    expect(html).not.toMatch(/primary-page-layout__body[^"]*tw:min-h-0/)
    expect(html.indexOf('页面标题')).toBeLessThan(html.indexOf('页面说明'))
    expect(html.indexOf('页面说明')).toBeLessThan(html.indexOf('data-slot="search"'))
    expect(html.indexOf('data-slot="search"')).toBeLessThan(html.indexOf('data-slot="navigation"'))
    expect(html.indexOf('data-slot="navigation"')).toBeLessThan(html.indexOf('data-slot="body"'))
  })

  test('omits optional search and navigation containers', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout description="页面说明" title="页面标题">
        内容
      </PrimaryPageLayout>,
    )

    expect(html).not.toContain('primary-page-layout__search')
    expect(html).not.toContain('primary-page-layout__navigation')
  })

  test('applies custom headerClassName to header element', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout
        description="页面说明"
        headerClassName="custom-header-class"
        title="页面标题"
      >
        内容
      </PrimaryPageLayout>,
    )

    expect(html).toContain('primary-page-layout__header')
    expect(html).toContain('custom-header-class')
  })

  test('workflows, automations, and plugins maintain unified bottom padding and prevent flex shrinkage', () => {
    const sessionGroupsSource = readFileSync(
      new URL('../src/features/session-groups/SessionGroupsView.tsx', import.meta.url),
      'utf8',
    )
    const automationSource = readFileSync(
      new URL('../src/features/automation/AutomationView.tsx', import.meta.url),
      'utf8',
    )
    const pluginsSource = readFileSync(
      new URL('../src/features/plugins/PluginsView.tsx', import.meta.url),
      'utf8',
    )
    const taskScheduleSource = readFileSync(
      new URL('../src/features/automation/TaskSchedulePanel.tsx', import.meta.url),
      'utf8',
    )

    // 工作流：列表页不收缩且无 min-h-0，详情页内层具备 tw:pb-8
    expectSourceContains(
      sessionGroupsSource,
      'session-groups-index tw:flex tw:min-w-0 tw:flex-auto tw:shrink-0 tw:flex-col',
    )
    expectSourceNotContains(sessionGroupsSource, 'session-groups-index tw:flex tw:min-w-0 tw:min-h-0')
    expectSourceContains(
      sessionGroupsSource,
      'session-group-detail__inner tw:mx-auto tw:flex tw:w-[min(var(--page-content-max-width),100%)] tw:flex-col tw:pb-8',
    )

    // 自动化：容器 stage 与 content 具备 tw:shrink-0，content 移除 tw:min-h-0，TaskSchedulePanel 根部具备 tw:shrink-0
    expectSourceContains(
      automationSource,
      'automation-page-stage tw:grid tw:flex-auto tw:min-w-0 tw:shrink-0 tw:grid-cols-[minmax(0,1fr)]',
    )
    expectSourceContains(
      automationSource,
      'automation-page-content tw:flex tw:min-w-0 tw:shrink-0 tw:flex-col',
    )
    expectSourceNotContains(automationSource, 'automation-page-content tw:flex tw:min-h-0')
    expectSourceContains(taskScheduleSource, 'section aria-label="任务与待处理" className="tw:grid tw:shrink-0 tw:gap-2"')

    // 插件：目录 panel 具备 tw:shrink-0，详情页包裹层具备 tw:pb-8
    expectSourceContains(pluginsSource, 'plugins-panel tw:grid tw:min-w-0 tw:shrink-0 tw:gap-8')
    expectSourceContains(
      pluginsSource,
      'tw:mx-auto tw:min-w-0 tw:w-[min(var(--page-content-max-width),100%)] tw:pb-8',
    )
  })
})
