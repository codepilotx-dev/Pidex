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

  test('applies header--with-search and title-row wrapper when permanent search is configured', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout
        actions={<button type="button">操作</button>}
        description="页面说明"
        search={<SearchInput aria-label="搜索" onChange={() => undefined} placeholder="搜索" value="" />}
        title="页面标题"
      >
        内容
      </PrimaryPageLayout>,
    )

    expect(html).toContain('primary-page-layout tw:@container')
    expect(html).toContain('primary-page-layout__header--with-search')
    expect(html).toContain('primary-page-layout__title-row tw:flex tw:min-h-9 tw:min-w-0 tw:items-center')
    expect(html).toContain('primary-page-layout__actions tw:flex tw:min-h-9 tw:shrink-0 tw:flex-wrap tw:items-center')
    expect(html).not.toContain('primary-page-layout__actions tw:flex tw:shrink-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:pt-1')
    expect(html).toContain('primary-page-layout__search tw:mt-4 tw:w-full tw:min-w-0')
  })

  test('keeps title row 36px min-height without permanent search for baseline consistency', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout
        description="页面说明"
        title="页面标题"
      >
        内容
      </PrimaryPageLayout>,
    )

    expect(html).not.toContain('primary-page-layout__header--with-search')
    expect(html).toContain('primary-page-layout__title-row tw:flex tw:min-h-9 tw:min-w-0 tw:items-center')
  })

  test('supports permanent search without actions and omits actions container', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout
        description="页面说明"
        search={<SearchInput aria-label="搜索" onChange={() => undefined} placeholder="搜索" value="" />}
        title="页面标题"
      >
        内容
      </PrimaryPageLayout>,
    )

    expect(html).toContain('primary-page-layout__header--with-search')
    expect(html).toContain('primary-page-layout__search')
    expect(html).not.toContain('primary-page-layout__actions')
  })

  test('primary-page.css defines shared header--with-search rules without one-off plugin header hacks', () => {
    const css = readFileSync(
      new URL('../src/styles/features/primary-page.css', import.meta.url),
      'utf8',
    )

    expect(css).toContain('.primary-page-layout__header--with-search')
    expect(css).toContain('@container (min-width: 680px)')
    expect(css).not.toContain('plugins-primary-header')
    expect(css).not.toContain('@container plugins-page')
  })

  test('all primary pages align buttons and search inputs with plugin page standard while respecting constraints', () => {
    const automationsSource = readFileSync(
      new URL('../src/features/automation/AutomationView.tsx', import.meta.url),
      'utf8',
    )
    const modelsSource = readFileSync(
      new URL('../src/features/models/ModelCenterWorkbench.tsx', import.meta.url),
      'utf8',
    )
    const petsSource = readFileSync(
      new URL('../src/features/pet/PetCatalogPage.tsx', import.meta.url),
      'utf8',
    )
    const workflowsSource = readFileSync(
      new URL('../src/features/session-groups/SessionGroupsView.tsx', import.meta.url),
      'utf8',
    )
    const projectsSource = readFileSync(
      new URL('../src/features/settings/EnvironmentSettings.tsx', import.meta.url),
      'utf8',
    )
    const pullRequestsSource = readFileSync(
      new URL('../src/features/pull-requests/PullRequestsPlaceholder.tsx', import.meta.url),
      'utf8',
    )

    // 1. None of the primary pages use expandableSearch anymore
    expect(automationsSource).not.toContain('expandableSearch')
    expect(modelsSource).not.toContain('expandableSearch')

    // 2. All pages with search use permanent pill search: shape="pill", size="md", variant="outlined"
    for (const source of [automationsSource, modelsSource, petsSource, workflowsSource, projectsSource]) {
      expect(source).toContain('shape="pill"')
      expect(source).toContain('size="md"')
      expect(source).toContain('variant="outlined"')
    }

    // 3. Header action buttons use shape="pill" and size="md"
    expect(automationsSource).toContain('color="primary" shape="pill" size="md"')
    expect(modelsSource).toContain('variant="ghost"')
    expect(modelsSource).toContain('isIconOnly')
    expect(modelsSource).toContain('shape="pill"')
    expect(modelsSource).toContain('size="md"')
    expect(petsSource).toContain('variant="ghost"')
    expect(petsSource).toContain('isIconOnly')
    expect(petsSource).toContain('shape="pill"')
    expect(petsSource).toContain('size="md"')
    expect(workflowsSource).toContain('color="primary"')
    expect(workflowsSource).toContain('shape="pill"')
    expect(workflowsSource).toContain('size="md"')
    expect(projectsSource).toContain('color="primary"')
    expect(projectsSource).toContain('shape="pill"')
    expect(projectsSource).toContain('size="md"')

    // 4. Respect constraints: do not add search or refresh where there were none originally
    expect(pullRequestsSource).not.toContain('search=')
    expect(pullRequestsSource).not.toContain('RefreshCw')
    expect(automationsSource).not.toContain('title="刷新')
    expect(workflowsSource).not.toContain('title="刷新')
    expect(projectsSource).not.toContain('title="刷新')
  })
})
