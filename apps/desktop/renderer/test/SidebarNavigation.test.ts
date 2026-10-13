import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '../src/components/ui/Tooltip.js'
import { DesktopSettingsProvider } from '../src/features/settings/UseDesktopSettings.js'
import { SidebarNavigationRail } from '../src/features/layout/sidebar/SidebarNavigationRail.js'
import { SidebarHeader, SidebarNewTaskNav } from '../src/features/layout/sidebar/SidebarTopNav.js'
import type { SidebarShellController } from '../src/features/layout/SidebarShellState.js'
import {
  sidebarPaneForRoute,
  SIDEBAR_RAIL_WIDTH,
} from '../src/features/layout/sidebar/SidebarNavigation.js'
import { resolveConversationProject } from '../src/features/projects/ProjectDetailsModel.js'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'
import { isSidebarPreviewHeld as isSidebarPreviewHeldForTest } from '../src/features/layout/SidebarShellState.js'
import { describe, expect, spyOn, test } from 'bun:test'
import * as settingsStorage from '../src/features/settings/SettingsStorage.js'
import { readFileSync } from 'node:fs'
import type { ProtocolCapability } from '@pidex/agent-protocol'
import type { DesktopRemovedWorkspace, DesktopWorkspace } from '../shared/Types.js'
import {
  SESSION_TITLE_MAX_LENGTH,
  sessionDisplayTitle,
  sessionEditableTitle,
  sessionResolvedTitle,
  type SessionListItem,
} from '../src/UiTypes.js'
import {
  canShowSidebarTooltip,
  deriveSidebarShellMode,
  isPointInTriangle,
  isPreviewHoverSupported,
  registerSidebarPreviewHold,
  resolveSidebarEscapeAction,
  SIDEBAR_PREVIEW_ENTER_DELAY,
  SIDEBAR_PREVIEW_LEAVE_DELAY,
  SIDEBAR_PREVIEW_MIN_WINDOW_WIDTH,
  SIDEBAR_PREVIEW_SAFE_TIMEOUT,
  SIDEBAR_PREVIEW_SETTLE_DURATION,
  SIDEBAR_PREVIEW_SWITCH_DELAY,
} from '../src/features/layout/SidebarShellState.js'
import {
  DEFAULT_RESIZE_COLLAPSE_BEHAVIOR,
  shouldCollapseSidebarResize,
} from '../src/features/layout/UseSidebarResizeCollapseConfirm.js'
import { getSidebarScrollModeKey } from '../src/features/layout/sidebar/UseSidebarScrollController.js'
import {
  buildSidebarSessionHoverCardModel,
  formatSidebarSessionRelativeTime,
} from '../src/features/layout/sidebar/SidebarSessionHoverCard.js'
import { countOpenProjectSessions } from '../src/features/layout/sidebar/SidebarProjectHoverCard.js'
import {
  getSidebarSessionDisplayGroups,
  sessionReadStatusActionLabel,
} from '../src/features/layout/sidebar/SidebarSessionGroup.js'
import {
  buildSidebarTimelineModel,
  reconcileSidebarActivitySnapshot,
  buildSidebarPinnedItems,
  buildProjectSessionBuckets,
  buildSidebarViewModel,
  deriveSidebarActivityIndicatorState,
  deriveSidebarSessionVisualState,
  filterSidebarActivitySessions,
  hasSidebarUnreadSessions,
  labelForDayOffset,
  localDayOrdinal,
  reorderSidebarPinnedItemKeys,
  sidebarArchivableAttentionSessions,
  sidebarAttentionUnreadSessions,
  sidebarPinnedProjectKey,
  sidebarPinnedSessionKey,
  sidebarProjectKey,
  clampTimelineVisibleLimit,
  sliceSidebarTimelineModel,
  sortProjectsForSidebar,
  type SidebarTimelineModel,
} from '../src/features/layout/sidebar/SidebarViewModel.js'
import { sortSessionsForSidebar } from '../src/features/session/state/SessionSorting.js'
import {
  getSidebarTopNavItems,
  type SidebarCapabilityState,
  SIDEBAR_PRODUCT_MODE_META,
  SIDEBAR_PRODUCT_MODE_ORDER,
  splitSidebarTopNavItems,
  TOP_NAV_ITEMS,
} from '../src/features/layout/sidebar/SidebarTopNav.js'
import { newSessionPath } from '../src/features/session/NewSessionSurface.js'
import {
  SETTINGS_GROUPS,
  SETTINGS_ITEMS,
  SETTINGS_SEARCH_DOCUMENTS,
} from '../src/features/settings/SettingsRegistry.js'

const unknownSidebarCapabilities: SidebarCapabilityState = {
  status: 'unknown',
  capabilities: null,
}

function readySidebarCapabilities(...capabilities: ProtocolCapability[]): SidebarCapabilityState {
  return { status: 'ready', capabilities: new Set(capabilities) }
}

function sidebarNavItems(
  showProjects: boolean,
  surface?: Parameters<typeof getSidebarTopNavItems>[0]['surface'],
  capabilityState: SidebarCapabilityState = unknownSidebarCapabilities,
) {
  return getSidebarTopNavItems({
    showProjects,
    surface,
    capabilityState,
  })
}

describe('Codex 侧栏导航', () => {
  test('全部固定后更多仍可用，首页忽略隐藏配置，宠物可固定且能力过滤保持生效', () => {
    const settings = settingsStorage.defaultDesktopSettings()
    const stored = spyOn(settingsStorage, 'readStoredDesktopSettings').mockReturnValue({
      ...settings,
      sidebarCustomization: {
        ...settings.sidebarCustomization,
        hiddenDestinationIds: ['home'],
        destinationOrder: ['pets', 'plugins', 'providers', 'automations', 'sessionGroups'],
      },
    })
    try {
      const render = (capabilityState: SidebarCapabilityState) => renderToStaticMarkup(
        createElement(MemoryRouter, null,
          createElement(DesktopSettingsProvider, null,
            createElement(TooltipProvider, null,
              createElement(SidebarNavigationRail, {
                shell: { mode: 'docked' } as unknown as SidebarShellController,
                activePane: 'chats', capabilityState,
                onOpenWhatsNew: () => {}, onReport: () => {}, onPinPanel: () => {},
              }),
            ),
          ),
        ),
      )
      const pinned = render(readySidebarCapabilities('pets.management.v1', 'skills.manage.v1', 'session-group.v1'))
      expect(pinned).toContain('aria-label="首页"')
      expect(pinned).toContain('aria-label="宠物市场"')
      expect(pinned).toContain('aria-label="更多"')
      const moreIndex = pinned.indexOf('aria-label="更多"')
      expect(pinned.indexOf('aria-label="插件"')).toBeLessThan(pinned.indexOf('aria-label="已安排"'))
      expect(pinned.indexOf('aria-label="已安排"')).toBeLessThan(moreIndex)
      expect(pinned.indexOf('aria-label="宠物市场"')).toBeGreaterThan(moreIndex)
      expect(pinned.indexOf('aria-label="供应商"')).toBeGreaterThan(pinned.indexOf('aria-label="宠物市场"'))
      expect(pinned.indexOf('aria-label="工作组"')).toBeGreaterThan(pinned.indexOf('aria-label="供应商"'))
      expect(render(unknownSidebarCapabilities)).not.toContain('aria-label="宠物市场"')
    } finally {
      stored.mockRestore()
    }
  })

  test('宠物市场收进更多且路由激活宠物侧栏', () => {
    const rail = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/pets'] },
        createElement(
          DesktopSettingsProvider,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(SidebarNavigationRail, {
              shell: { mode: 'docked' } as unknown as SidebarShellController,
              activePane: 'pets',
              capabilityState: readySidebarCapabilities('pets.management.v1'),
              onOpenWhatsNew: () => {},
              onReport: () => {},
              onPinPanel: () => {},
            }),
          ),
        ),
      ),
    )
    expect(rail).not.toContain('aria-label="宠物市场"')
    expect(rail).toContain('aria-label="更多"')
    expect(sidebarPaneForRoute('/pets', false)).toBe('pets')
  })

  test('新版图标栏只放页面入口，聊天操作保留在首页面板', () => {
    const shell = { mode: 'docked' } as unknown as SidebarShellController
    const render = (child: ReturnType<typeof createElement>) =>
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          { initialEntries: ['/new'] },
          createElement(DesktopSettingsProvider, null, createElement(TooltipProvider, null, child)),
        ),
      )
    const rail = render(
      createElement(SidebarNavigationRail, {
        shell,
        activePane: 'chats',
        capabilityState: unknownSidebarCapabilities,
        onOpenWhatsNew: () => {},
        onReport: () => {},
        onPinPanel: () => {},
      }),
    )
    expect(rail).toContain('aria-label="首页"')
    expect(rail).not.toContain('title="首页"')
    expect(rail).not.toContain('aria-label="项目"')
    expect(rail).not.toContain('aria-label="设置"')
    expect(rail).not.toContain('title="新建任务"')
    expect(rail).not.toContain('搜索任务')
    expect(rail).not.toContain('查看活动')
    const header = render(
      createElement(SidebarHeader, { hasUnread: false, onOpenCommandMenu: () => {} }),
    )
    expect(header).toContain('搜索任务')
    expect(header).toContain('查看活动')
    expect(header).toContain('新聊天')
    expect(header).toContain('sidebar-new-chat-button')
    const newChat = render(
      createElement(SidebarNewTaskNav, {
        label: '新聊天',
        isActiveView: () => false,
        scrollOverlapping: false,
      }),
    )
    expect(newChat).toContain('新聊天')
    expect(newChat).toContain('href="/new?surface=coding"')
  })

  test('产品模式按约定顺序展示名称和说明', () => {
    expect(
      SIDEBAR_PRODUCT_MODE_ORDER.map((value) => ({
        value,
        ...SIDEBAR_PRODUCT_MODE_META[value],
      })),
    ).toEqual([
      { value: 'coding', label: 'Coding', description: '构建、调试并发布' },
      { value: 'working', label: 'Working', description: '写作、分析和协作' },
      { value: 'chat', label: 'Chat', description: '创建、学习和探索' },
    ])
  })

  test('按产品入口优先顺序展示且搜索只保留在侧栏头部', () => {
    expect(
      TOP_NAV_ITEMS.map((item) => ({ view: item.view, label: item.label, path: item.path })),
    ).toEqual([
      { view: 'new', label: '新建任务', path: '/new' },
      { view: 'sessionGroups', label: '工作组', path: '/workflows' },
      { view: 'automations', label: '已安排', path: '/automations' },
      { view: 'plugins', label: '插件', path: '/plugins' },
      { view: 'providers', label: '供应商', path: '/providers' },
      { view: 'pets', label: '宠物市场', path: '/pets' },
    ])
    expect(TOP_NAV_ITEMS.some((item) => item.path === '/search')).toBeFalse()
    expect(TOP_NAV_ITEMS.some((item) => item.path === '/sites')).toBeFalse()
    expect(TOP_NAV_ITEMS.some((item) => item.path === '/pull-requests')).toBeFalse()
    expect(sidebarNavItems(false)).toEqual(
      TOP_NAV_ITEMS.filter((item) => item.availability.kind === 'always'),
    )
    expect(
      sidebarNavItems(true).map((item) => ({
        view: item.view,
        label: item.label,
        path: item.path,
      })),
    ).toEqual([
      { view: 'new', label: '新建任务', path: '/new' },
      { view: 'projects', label: '项目', path: '/projects' },
      ...TOP_NAV_ITEMS.filter((item) => item.availability.kind === 'always')
        .slice(1)
        .map((item) => ({
          view: item.view,
          label: item.label,
          path: item.path,
        })),
    ])
  })

  test('模式切换目标分别为对应 Surface 新建页', () => {
    expect(SIDEBAR_PRODUCT_MODE_ORDER.map((mode) => newSessionPath(mode))).toEqual([
      '/new?surface=coding',
      '/new?surface=working',
      '/new?surface=chat',
    ])
  })

  test('新建任务链接跟随当前 Surface，未指定时保留 /new 兼容入口', () => {
    expect(sidebarNavItems(false, 'working')[0]).toMatchObject({
      view: 'new',
      label: '新建任务',
      path: '/new?surface=working',
    })
    expect(
      sidebarNavItems(true, 'chat').map((item) => ({
        view: item.view,
        path: item.path,
      })),
    ).toEqual([
      { view: 'new', path: '/new?surface=chat' },
      { view: 'projects', path: '/projects' },
      ...TOP_NAV_ITEMS.filter((item) => item.availability.kind === 'always')
        .slice(1)
        .map((item) => ({
          view: item.view,
          path: item.path,
        })),
    ])
    expect(sidebarNavItems(false)[0]!.path).toBe('/new')
  })

  test('普通组织模式下固定分组只包含新建任务', () => {
    const { fixedItems, scrollableItems } = splitSidebarTopNavItems(sidebarNavItems(false))
    expect(fixedItems.map((item) => item.view)).toEqual(['new'])
    expect(scrollableItems.map((item) => item.view)).toEqual(['automations', 'providers'])
  })

  test('扁平组织模式下项目位于可滚动分组首位而不是固定分组', () => {
    const { fixedItems, scrollableItems } = splitSidebarTopNavItems(sidebarNavItems(true))
    expect(fixedItems.map((item) => item.view)).toEqual(['new'])
    expect(scrollableItems.map((item) => item.view)).toEqual([
      'projects',
      'automations',
      'providers',
    ])
  })

  test('可滚动分组不重复包含新建对话，且固定入口跟随 Surface', () => {
    const { fixedItems, scrollableItems } = splitSidebarTopNavItems(
      sidebarNavItems(true, 'working'),
    )
    expect(scrollableItems.some((item) => item.view === 'new')).toBeFalse()
    expect(fixedItems[0]!.path).toBe('/new?surface=working')
  })

  test('拆分后完整导航顺序保持不变', () => {
    for (const showProjects of [false, true]) {
      const items = sidebarNavItems(showProjects)
      const { fixedItems, scrollableItems } = splitSidebarTopNavItems(items)
      expect([...fixedItems, ...scrollableItems]).toEqual(items)
    }
  })

  test('能力未知或 Agent 暂时不可用时只保留 always 入口', () => {
    const unavailable: SidebarCapabilityState = {
      status: 'unavailable',
      capabilities: null,
    }

    const alwaysViews = TOP_NAV_ITEMS.filter((item) => item.availability.kind === 'always').map(
      (item) => item.view,
    )
    expect(sidebarNavItems(false).map((item) => item.view)).toEqual(alwaysViews)
    expect(sidebarNavItems(false, undefined, unavailable).map((item) => item.view)).toEqual(
      alwaysViews,
    )
  })

  test('协商 session-group.v1 后工作组位于新建对话之后、项目之前', () => {
    expect(
      sidebarNavItems(true, undefined, readySidebarCapabilities('session-group.v1')).map(
        (item) => item.view,
      ),
    ).toEqual(['new', 'sessionGroups', 'projects', 'automations', 'providers'])
  })

  test('明确缺少 GitHub 能力时隐藏拉取请求但保留固定产品入口', () => {
    const items = sidebarNavItems(false, undefined, readySidebarCapabilities())

    expect(items.map((item) => item.view)).toEqual(['new', 'automations', 'providers'])
  })

  test('插件入口满足 Skills 或 MCP 任一能力即可显示', () => {
    for (const capability of ['skills.manage.v1', 'mcp.manage.v1'] as const) {
      expect(
        sidebarNavItems(false, undefined, readySidebarCapabilities(capability)).some(
          (item) => item.view === 'plugins',
        ),
      ).toBeTrue()
    }
  })

  test('能力过滤不改变项目规则且固定区域仍只有新建对话', () => {
    const withoutProjects = sidebarNavItems(
      false,
      undefined,
      readySidebarCapabilities('github.pullRequests.v1'),
    )
    const withProjects = sidebarNavItems(
      true,
      undefined,
      readySidebarCapabilities('github.pullRequests.v1'),
    )
    const { fixedItems, scrollableItems } = splitSidebarTopNavItems(withProjects)

    expect(withoutProjects.some((item) => item.view === 'projects')).toBeFalse()
    expect(withProjects.some((item) => item.view === 'projects')).toBeTrue()
    // /pull-requests 仍是占位页面，即使 capability ready 也不在侧栏暴露。
    expect(withoutProjects.some((item) => item.view === 'pullRequests')).toBeFalse()
    expect(withProjects.some((item) => item.view === 'pullRequests')).toBeFalse()
    expect(fixedItems.map((item) => item.view)).toEqual(['new'])
    expect(scrollableItems.some((item) => item.view === 'new')).toBeFalse()
  })

  test('从设置目录移除旧 connections 标签', () => {
    expect(SETTINGS_ITEMS.some((item) => item.routeId === 'connections')).toBeFalse()
  })

  test('使用统一插件页管理扩展并移除独立 MCP 设置入口', () => {
    const integrations = SETTINGS_GROUPS.find((group) => group.id === 'integrations')

    expect(integrations?.items.map((item) => item.routeId)).toEqual([
      'plugins',
      'browser',
      'computer',
    ])
    expect(SETTINGS_ITEMS.some((item) => item.routeId === 'mcp')).toBeFalse()
  })

  test('供应商不再作为设置页，改由一级导航承载', () => {
    expect(SETTINGS_ITEMS.some((item) => item.routeId === 'providers')).toBeFalse()
    expect(SETTINGS_SEARCH_DOCUMENTS.some((doc) => doc.tabId === 'providers')).toBeFalse()
    expect(TOP_NAV_ITEMS.find((item) => item.view === 'providers')?.path).toBe('/providers')
  })
})

describe('设置导航', () => {
  test('宠物设置保留市场入口且一级导航按宠物管理能力显示', () => {
    const pets = SETTINGS_ITEMS.find((item) => item.routeId === 'pets')

    expect(pets?.rows.some((row) => row.title === '宠物市场')).toBeTrue()
    expect(TOP_NAV_ITEMS.find((item) => item.view === 'pets')?.path).toBe('/pets')
    expect(sidebarNavItems(false).some((item) => item.view === 'pets')).toBeFalse()
    expect(
      sidebarNavItems(false, undefined, readySidebarCapabilities()).some(
        (item) => item.view === 'pets',
      ),
    ).toBeFalse()
    expect(
      sidebarNavItems(false, undefined, readySidebarCapabilities('pets.management.v1')).some(
        (item) => item.view === 'pets',
      ),
    ).toBeTrue()
  })

  test('工作空间依赖项是编码分组中的独立页面', () => {
    const codingGroup = SETTINGS_GROUPS.find((group) => group.id === 'coding')
    const dependencies = SETTINGS_ITEMS.find((item) => item.routeId === 'dependencies')
    const config = SETTINGS_ITEMS.find((item) => item.routeId === 'config')

    expect(codingGroup?.items.some((item) => item.routeId === 'dependencies')).toBeTrue()
    expect(dependencies?.label).toBe('工作空间依赖项')
    expect(dependencies?.rows.map((row) => row.title)).toEqual([
      'Node.js',
      'Python',
      'Git Bash',
      'ripgrep',
    ])
    expect(config?.rows.some((row) => row.title === '工作空间依赖项')).toBeFalse()
  })
})

describe('sidebar shell modes', () => {
  test('悬停预览计时与预览保持注册表有固定基准', () => {
    expect([
      SIDEBAR_PREVIEW_ENTER_DELAY,
      SIDEBAR_PREVIEW_SWITCH_DELAY,
      SIDEBAR_PREVIEW_LEAVE_DELAY,
      SIDEBAR_PREVIEW_SAFE_TIMEOUT,
      SIDEBAR_PREVIEW_SETTLE_DURATION,
      SIDEBAR_PREVIEW_MIN_WINDOW_WIDTH,
    ]).toEqual([100, 300, 100, 1000, 0.12, 768])

    expect(isPreviewHoverSupported()).toBeFalse()
    expect(canShowSidebarTooltip('docked', false)).toBe(true)
    expect(canShowSidebarTooltip('collapsed', true)).toBe(false)
    expect(canShowSidebarTooltip('collapsed', false)).toBe(true)
    expect(canShowSidebarTooltip('preview', false)).toBe(false)

    expect(
      isPointInTriangle({ x: 60, y: 10 }, { x: 52, y: 10 }, { x: 62, y: 0 }, { x: 62, y: 100 }),
    ).toBe(true)
    expect(
      isPointInTriangle({ x: 200, y: 10 }, { x: 52, y: 10 }, { x: 62, y: 0 }, { x: 62, y: 100 }),
    ).toBe(false)

    expect(isSidebarPreviewHeldForTest()).toBeFalse()
    const release = registerSidebarPreviewHold('menu')
    expect(isSidebarPreviewHeldForTest()).toBeTrue()
    release()
    expect(isSidebarPreviewHeldForTest()).toBeFalse()
    expect(typeof release).toBe('function')
  })

  test('入口映射功能面板，独立页面只显示图标栏', () => {
    expect(
      [
        '/new',
        '/threads/task-1',
        '/projects',
        '/projects/project-1',
        '/automations',
        '/settings/appearance',
        '/plugins',
        '/plugins/detail',
        '/providers',
        '/providers/detail',
        '/workflows',
      ].map((path) => sidebarPaneForRoute(path, false)),
    ).toEqual([
      'chats',
      'chats',
      'chats',
      'chats',
      'scheduled',
      'settings',
      'plugins',
      'plugins',
      'providers',
      'providers',
      null,
    ])
    expect(sidebarPaneForRoute('/threads/task-1', true)).toBe('activity')
    const base = { organization: 'projects', timelineEnabled: false } as const
    expect(sidebarPaneForRoute('/projects/project-1', true)).toBe('activity')
    expect(getSidebarScrollModeKey({ ...base, pane: 'chats' })).not.toBe(
      getSidebarScrollModeKey({ ...base, pane: 'activity' }),
    )
  })

  test('侧栏只在收起且入口可用时进入预览，不再按窗口宽度自动隐藏', () => {
    expect(
      deriveSidebarShellMode({ collapsed: false, previewOpen: false, paneAvailable: true }),
    ).toBe('docked')
    expect(
      deriveSidebarShellMode({ collapsed: false, previewOpen: true, paneAvailable: true }),
    ).toBe('docked')
    expect(
      deriveSidebarShellMode({ collapsed: true, previewOpen: false, paneAvailable: true }),
    ).toBe('collapsed')
    expect(
      deriveSidebarShellMode({ collapsed: true, previewOpen: true, paneAvailable: true }),
    ).toBe('preview')
    expect(
      deriveSidebarShellMode({ collapsed: true, previewOpen: true, paneAvailable: false }),
    ).toBe('collapsed')

    const shellSource = readFileSync(
      new URL('../src/features/layout/SidebarShellState.ts', import.meta.url),
      'utf8',
    )
    expectSourceNotContains(shellSource, 'SIDEBAR_RESPONSIVE_BREAKPOINT')
    expectSourceNotContains(shellSource, 'responsiveAutoHidden')
    expectSourceNotContains(shellSource, 'ResizeObserver')
  })

  test('keeps independent runtime scroll modes without persistent storage', () => {
    expect([
      getSidebarScrollModeKey({
        organization: 'projects',
        timelineEnabled: true,
      }),
      getSidebarScrollModeKey({
        organization: 'flat',
        timelineEnabled: true,
      }),
      getSidebarScrollModeKey({
        organization: 'projects',
        timelineEnabled: false,
      }),
      getSidebarScrollModeKey({
        organization: 'flat',
        timelineEnabled: false,
      }),
    ]).toEqual(['timeline:priority', 'timeline:priority', 'standard:projects', 'standard:flat'])

    const controllerSource = readFileSync(
      new URL('../src/features/layout/sidebar/UseSidebarScrollController.ts', import.meta.url),
      'utf8',
    )
    expectSourceNotContains(controllerSource, 'localStorage')
    expectSourceNotContains(controllerSource, 'useDesktopSettings')
    expectSourceNotContains(controllerSource, 'timeline:recent')
  })

  test('侧边栏保留阈值收起，右工作区越界拖拽改由原始尺寸判定', () => {
    const leftBehavior = { kind: 'threshold', threshold: 120 } as const

    expect(shouldCollapseSidebarResize(119, leftBehavior)).toBeTrue()
    expect(shouldCollapseSidebarResize(120, leftBehavior)).toBeFalse()
    expect(DEFAULT_RESIZE_COLLAPSE_BEHAVIOR).toEqual({ kind: 'hold-target' })

    const rightDockSource = readFileSync(
      new URL('../src/features/layout/dock/RightDock.tsx', import.meta.url),
      'utf8',
    )
    // 右工作区不再到阈值就销毁 divider：拖动全程保留，隐藏/完整视图在布局层判定。
    expectSourceNotContains(rightDockSource, 'SIDEBAR_COLLAPSE_HOLD_MS')
    expectSourceNotContains(rightDockSource, 'threshold: minSize / 2')
    expectSourceContains(rightDockSource, 'collapseEnabled: false')
    expectSourceContains(rightDockSource, 'onResizeRawSize: isBottom ? undefined : onResizeRawSize')
    expectSourceContains(
      rightDockSource,
      'shouldCommitResizeSize: isBottom ? undefined : shouldCommitResizeSize',
    )
    expectSourceContains(rightDockSource, 'RIGHT_DOCK_KEYBOARD_STEP = 10')
  })

  test('图标栏宽度只由 SIDEBAR_RAIL_WIDTH 提供并由 rail slot 消费', () => {
    const frameSource = readFileSync(
      new URL('../src/features/layout/SidebarFrame.tsx', import.meta.url),
      'utf8',
    )

    // 迁移后宽度不再是 SCSS 字面量：TS 常量写入 `--sidebar-rail-width`，
    // rail slot 与侧栏面板都只通过该变量取得宽度，避免两侧漂移。
    expectSourceContains(frameSource, 'const railWidth = SIDEBAR_RAIL_WIDTH')
    expectSourceContains(frameSource, "'--sidebar-rail-width': `${railWidth}px`")
    expectSourceContains(frameSource, 'tw:w-[var(--sidebar-rail-width)]')
    expectSourceContains(
      frameSource,
      'tw:w-[calc(var(--sidebar-current-width)-var(--sidebar-rail-width))]',
    )
  })

  test('prioritizes local handlers, transient panels, and settings return', () => {
    const base = {
      defaultPrevented: false,
      isDialogOpen: false,
      isSettingsRoute: true,
      isTextEntry: false,
    }
    expect(
      resolveSidebarEscapeAction({
        ...base,
        defaultPrevented: true,
        mode: 'preview',
      }),
    ).toBe('none')
    expect(
      resolveSidebarEscapeAction({
        ...base,
        isTextEntry: true,
        mode: 'preview',
      }),
    ).toBe('none')
    expect(
      resolveSidebarEscapeAction({
        ...base,
        isTextEntry: true,
        mode: 'docked',
      }),
    ).toBe('none')
    expect(
      resolveSidebarEscapeAction({
        ...base,
        isDialogOpen: true,
        mode: 'docked',
      }),
    ).toBe('none')
    expect(
      resolveSidebarEscapeAction({
        ...base,
        mode: 'docked',
      }),
    ).toBe('settings-back')
    expect(
      resolveSidebarEscapeAction({
        ...base,
        isSettingsRoute: false,
        mode: 'docked',
      }),
    ).toBe('none')
  })
})

describe('sidebar view model', () => {
  test('日程来源过滤统一作用于分组与活动，并保留原会话和排序设置', () => {
    const input = {
      pendingPermissionSessionIds: new Set<string>(),
      recentWorkspaces: [{ name: 'Alpha', path: 'C:\\alpha' }],
      removedWorkspaces: [],
      sessionPins: { scheduledPinned: '2026-07-18T07:00:00.000Z' },
      manualOrderByScope: { 'pinned-items': ['session:scheduledPinned'] },
      sessions: [
        {
          ...session('scheduledPinned', 'C:\\alpha'),
          isScheduledSession: true,
          unreadAt: '2026-07-18T07:00:00.000Z',
        },
        { ...session('scheduledProject', 'C:\\alpha'), isScheduledSession: true },
        { ...session('scheduledRecent', '', undefined, true), isScheduledSession: true },
        { ...session('ordinaryWithRun', 'C:\\alpha'), hasScheduledRun: true },
        session('ordinaryRecent', '', undefined, true),
      ],
    }
    const original = structuredClone(input)
    const shown = buildSidebarViewModel(input)
    expect(shown.visibleSessions).toHaveLength(5)
    for (const organization of ['projects', 'flat'] as const) {
      const hidden = buildSidebarViewModel({ ...input, organization, showScheduledSessions: false })
      expect(hidden.visibleSessions.map((item) => item.id)).toEqual([
        'ordinaryWithRun',
        'ordinaryRecent',
      ])
      expect(hidden.pinnedSessions).toEqual([])
      expect(hidden.allProjectSessions.map((item) => item.id)).toEqual(['ordinaryWithRun'])
      expect(hidden.recentSessions.map((item) => item.id)).toEqual(
        organization === 'projects' ? ['ordinaryRecent'] : ['ordinaryWithRun', 'ordinaryRecent'],
      )
      expect(hidden.projectWorkspaces).toEqual(shown.projectWorkspaces)
      expect(
        [...hidden.projectSessionBuckets.values()][0]?.allSessions.map((item) => item.id),
      ).toEqual(['ordinaryWithRun'])
      expect(hasSidebarUnreadSessions(hidden.visibleSessions)).toBeFalse()
      const timeline = buildSidebarTimelineModel({
        now: Date.parse('2026-07-18T12:00:00.000Z'),
        sessions: hidden.visibleSessions,
        showPinned: true,
      })
      expect(timeline.attentionSessions).toEqual([])
      expect(timeline.pinnedSessions).toEqual([])
      expect(
        timeline.dateSections.flatMap((section) => section.sessions.map((item) => item.id)),
      ).toEqual(['ordinaryWithRun', 'ordinaryRecent'])
    }
    expect(buildSidebarViewModel({ ...input, showScheduledSessions: true })).toEqual(shown)
    expect(input).toEqual(original)
  })

  const projects: DesktopWorkspace[] = [
    { name: 'Alpha', path: 'C:\\alpha' },
    { name: 'Removed', path: 'C:\\removed' },
  ]
  const removed: DesktopRemovedWorkspace[] = [
    {
      name: 'Removed',
      path: 'C:\\removed',
      removedAt: '2026-07-18T00:00:00.000Z',
    },
  ]
  const sessions = [
    session('pinned', 'C:\\alpha', '2026-07-18T04:00:00.000Z'),
    session('project', 'C:\\beta', '2026-07-18T05:00:00.000Z'),
    session('standalone', '', '2026-07-18T03:00:00.000Z', true),
    { ...session('archived', 'C:\\alpha'), archivedAt: '2026-07-18T06:00:00.000Z' },
  ]

  test('deduplicates pinned tasks and filters archived and removed entries', () => {
    const model = buildSidebarViewModel({
      pendingPermissionSessionIds: new Set(['project']),
      recentWorkspaces: projects,
      removedWorkspaces: removed,
      sessionPins: { pinned: '2026-07-18T07:00:00.000Z' },
      sessions,
    })
    expect(model.pinnedSessions.map((item) => item.id)).toEqual(['pinned'])
    expect(model.pinnedWorkspaces).toEqual([])
    expect(model.unpinnedSessions.map((item) => item.id)).toEqual(['project', 'standalone'])
    expect(model.projectWorkspaces.map((item) => item.path)).toEqual(['C:\\beta', 'C:\\alpha'])
    expect(model.standaloneSessions.map((item) => item.id)).toEqual(['standalone'])
    expect(model.recentSessions.map((item) => item.id)).toEqual(['standalone'])
    expect(model.sessionStateById.project).toBe('needs-input')
    expect(model.sessionStateById.archived).toBeUndefined()
  })

  test('groups project sessions once while keeping pinned tasks in aggregate counts', () => {
    const allSessions = [
      {
        ...session('pinned-running', 'C:\\alpha'),
        projectId: 'alpha',
        pinnedAt: '2026-07-18T08:00:00.000Z',
        status: 'running' as const,
        unreadAt: '2026-07-18T08:00:00.000Z',
      },
      {
        ...session('recent', 'C:\\alpha', '2026-07-18T07:00:00.000Z'),
        projectId: 'alpha',
      },
      {
        ...session('older', 'C:\\alpha', '2026-07-18T06:00:00.000Z'),
        projectId: 'alpha',
        status: 'waiting' as const,
      },
      session('standalone', '', '2026-07-18T09:00:00.000Z', true),
    ]
    const buckets = buildProjectSessionBuckets(
      allSessions.filter((item) => !item.standalone),
      allSessions.filter((item) => !item.pinnedAt),
    )
    const bucket = buckets.get('id:alpha')

    expect(bucket?.allSessions.map((item) => item.id)).toEqual([
      'pinned-running',
      'recent',
      'older',
    ])
    expect(bucket?.displaySessions.map((item) => item.id)).toEqual(['recent', 'older'])
    expect(bucket?.openCount).toBe(2)
    expect(bucket?.unreadCount).toBe(1)
    expect([...buckets.keys()]).not.toContain('path:')
  })

  test('shows pinned items in batches of twenty', () => {
    const items = Array.from({ length: 45 }, (_, index) => index)

    expect(getSidebarSessionDisplayGroups(items, 20, 20)).toMatchObject({
      baseSessions: items.slice(0, 20),
      extraSessions: [],
      canShowMore: true,
      canCollapse: false,
    })
    expect(getSidebarSessionDisplayGroups(items, 40, 20)).toMatchObject({
      baseSessions: items.slice(0, 20),
      extraSessions: items.slice(20, 40),
      canShowMore: true,
      canCollapse: true,
    })
  })

  test('flat organization projects every unpinned task into recent', () => {
    const model = buildSidebarViewModel({
      organization: 'flat',
      pendingPermissionSessionIds: new Set(),
      recentWorkspaces: projects,
      removedWorkspaces: removed,
      sessionPins: { pinned: '2026-07-18T07:00:00.000Z' },
      sessions,
    })

    expect(model.pinnedSessions.map((item) => item.id)).toEqual(['pinned'])
    expect(model.recentSessions.map((item) => item.id)).toEqual(['project', 'standalone'])
  })

  test('flat organization keeps pinned-project tasks only in the pinned group', () => {
    const model = buildSidebarViewModel({
      organization: 'flat',
      pendingPermissionSessionIds: new Set(),
      recentWorkspaces: [
        {
          name: 'Pinned',
          path: 'C:\\pinned',
          projectId: 'pinned-project',
          pinnedAt: '2026-07-18T08:00:00.000Z',
        },
        {
          name: 'Regular',
          path: 'C:\\regular',
          projectId: 'regular-project',
        },
      ],
      removedWorkspaces: [],
      sessionPins: {},
      sessions: [
        {
          ...session('pinned-project-task', 'C:\\pinned'),
          projectId: 'pinned-project',
        },
        {
          ...session('regular-project-task', 'C:\\regular'),
          projectId: 'regular-project',
        },
      ],
    })

    expect(model.pinnedWorkspaces.map((item) => item.projectId)).toEqual(['pinned-project'])
    expect(model.recentSessions.map((item) => item.id)).toEqual(['regular-project-task'])
  })

  test('置顶列表把聊天与项目混排为同一条时间顺序', () => {
    const newerProject: DesktopWorkspace = {
      name: 'Newer project',
      path: 'C:\\newer',
      projectId: 'newer',
      pinnedAt: '2026-07-18T08:00:00.000Z',
    }
    const olderProject: DesktopWorkspace = {
      name: 'Older project',
      path: 'C:\\older',
      projectId: 'older',
      pinnedAt: '2026-07-18T06:00:00.000Z',
    }
    const pinnedSession = {
      ...session('middle-session', 'C:\\alpha'),
      pinnedAt: '2026-07-18T07:00:00.000Z',
    }
    const byPinnedAt = buildSidebarPinnedItems({
      pinnedSessions: [pinnedSession],
      pinnedWorkspaces: [olderProject, newerProject],
      storedOrder: [],
    })

    // 混合有序列表：没有手动顺序时按置顶时间倒序，聊天与项目不再分组。
    expect(byPinnedAt.map((item) => item.key)).toEqual([
      sidebarPinnedProjectKey(newerProject),
      sidebarPinnedSessionKey(pinnedSession),
      sidebarPinnedProjectKey(olderProject),
    ])
  })

  test('沿用混合手动顺序，不再按类型重新分组', () => {
    // 存储顺序：文件夹 B、会话 A、文件夹 C、会话 D
    const projectB: DesktopWorkspace = {
      name: 'B',
      path: 'C:\\b',
      projectId: 'b',
      pinnedAt: '2026-07-18T06:00:00.000Z',
    }
    const projectC: DesktopWorkspace = {
      name: 'C',
      path: 'C:\\c',
      projectId: 'c',
      pinnedAt: '2026-07-18T08:00:00.000Z',
    }
    const sessionA = {
      ...session('a', 'C:\\alpha'),
      pinnedAt: '2026-07-18T05:00:00.000Z',
    }
    const sessionD = {
      ...session('d', 'C:\\delta'),
      pinnedAt: '2026-07-18T07:00:00.000Z',
    }
    const items = buildSidebarPinnedItems({
      pinnedSessions: [sessionA, sessionD],
      pinnedWorkspaces: [projectB, projectC],
      storedOrder: [
        sidebarPinnedProjectKey(projectB),
        sidebarPinnedSessionKey(sessionA),
        sidebarPinnedProjectKey(projectC),
        sidebarPinnedSessionKey(sessionD),
      ],
    })

    expect(items.map((item) => item.key)).toEqual([
      sidebarPinnedProjectKey(projectB),
      sidebarPinnedSessionKey(sessionA),
      sidebarPinnedProjectKey(projectC),
      sidebarPinnedSessionKey(sessionD),
    ])
  })

  test('置顶列表允许跨类型重排并拒绝自反移动', () => {
    const projectB: DesktopWorkspace = {
      name: 'B',
      path: 'C:\\b',
      projectId: 'b',
      pinnedAt: '2026-07-18T06:00:00.000Z',
    }
    const projectC: DesktopWorkspace = {
      name: 'C',
      path: 'C:\\c',
      projectId: 'c',
      pinnedAt: '2026-07-18T08:00:00.000Z',
    }
    const sessionA = {
      ...session('a', 'C:\\alpha'),
      pinnedAt: '2026-07-18T05:00:00.000Z',
    }
    const items = buildSidebarPinnedItems({
      pinnedSessions: [sessionA],
      pinnedWorkspaces: [projectB, projectC],
      storedOrder: [],
    })

    // 无手动顺序时按置顶时间倒序：C(08:00)、B(06:00)、A(05:00)。
    expect(items.map((item) => item.key)).toEqual([
      sidebarPinnedProjectKey(projectC),
      sidebarPinnedProjectKey(projectB),
      sidebarPinnedSessionKey(sessionA),
    ])
    expect(
      reorderSidebarPinnedItemKeys(
        items,
        sidebarPinnedProjectKey(projectB),
        sidebarPinnedProjectKey(projectC),
      ),
    ).toEqual([
      sidebarPinnedProjectKey(projectB),
      sidebarPinnedProjectKey(projectC),
      sidebarPinnedSessionKey(sessionA),
    ])
    // 跨类型移动在同一条混合列表内合法。
    expect(
      reorderSidebarPinnedItemKeys(
        items,
        sidebarPinnedSessionKey(sessionA),
        sidebarPinnedProjectKey(projectC),
      ),
    ).toEqual([
      sidebarPinnedSessionKey(sessionA),
      sidebarPinnedProjectKey(projectC),
      sidebarPinnedProjectKey(projectB),
    ])
    expect(
      reorderSidebarPinnedItemKeys(
        items,
        sidebarPinnedSessionKey(sessionA),
        sidebarPinnedSessionKey(sessionA),
      ),
    ).toBeNull()
    // 目标键不存在时保持原状，不产生新顺序。
    expect(
      reorderSidebarPinnedItemKeys(items, sidebarPinnedSessionKey(sessionA), 'session:missing'),
    ).toBeNull()
  })

  test('derives stable visual state precedence', () => {
    expect(
      deriveSidebarSessionVisualState(
        { ...sessions[0]!, status: 'running', unreadAt: '2026-07-18T00:00:00Z' },
        new Set(['pinned']),
      ),
    ).toBe('needs-input')
    expect(
      deriveSidebarSessionVisualState(
        { ...sessions[0]!, status: 'running', unreadAt: '2026-07-18T00:00:00Z' },
        new Set(),
      ),
    ).toBe('running')
  })

  test('uses a dynamic read status action for every session', () => {
    expect(sessionReadStatusActionLabel({ unreadAt: null })).toBe('标记为未读')
    expect(
      sessionReadStatusActionLabel({
        unreadAt: '2026-07-18T00:00:00Z',
      }),
    ).toBe('标记为已读')
  })

  test('derives the Bell badge from unread sessions only', () => {
    expect(
      hasSidebarUnreadSessions([
        { ...sessions[0]!, status: 'running', unreadAt: null },
        { ...sessions[1]!, status: 'waiting', unreadAt: null },
      ]),
    ).toBe(false)
    expect(
      hasSidebarUnreadSessions([
        { ...sessions[0]!, status: 'running', unreadAt: '2026-07-18T00:00:00Z' },
      ]),
    ).toBe(true)
    expect(
      hasSidebarUnreadSessions([
        {
          ...sessions[0]!,
          archivedAt: '2026-07-18T01:00:00Z',
          unreadAt: '2026-07-18T00:00:00Z',
        },
      ]),
    ).toBe(false)
  })

  test('supports updated, priority, and manual task sorting', () => {
    const createdFirst = session(
      'created-first',
      'C:\\alpha',
      '2026-07-18T01:00:00Z',
      false,
      '2026-07-18T06:00:00Z',
    )
    const updatedFirst = session(
      'updated-first',
      'C:\\alpha',
      '2026-07-18T06:00:00Z',
      false,
      '2026-07-18T01:00:00Z',
    )
    const options = {
      needsInputSessionIds: new Set<string>(),
      unreadSessionIds: new Set<string>(),
      manualOrderByScope: { test: ['created-first', 'updated-first'] },
      scopeKey: 'test',
    }
    expect(
      sortSessionsForSidebar([createdFirst, updatedFirst], {
        ...options,
        sort: 'updated',
      }).map((item) => item.id),
    ).toEqual(['updated-first', 'created-first'])
    expect(
      sortSessionsForSidebar([updatedFirst, createdFirst], {
        ...options,
        sort: 'manual',
      }).map((item) => item.id),
    ).toEqual(['created-first', 'updated-first'])
    expect(
      sortSessionsForSidebar(
        [createdFirst, updatedFirst, session('new-unordered', 'C:\\alpha', '2026-07-18T07:00:00Z')],
        {
          ...options,
          sort: 'manual',
        },
      ).map((item) => item.id),
    ).toEqual(['new-unordered', 'created-first', 'updated-first'])
    expect(
      sortSessionsForSidebar(
        [
          session('new-a', 'C:\\alpha', '2026-07-18T08:00:00Z'),
          createdFirst,
          session('new-b', 'C:\\alpha', '2026-07-18T05:00:00Z'),
          updatedFirst,
        ],
        {
          ...options,
          sort: 'manual',
        },
      ).map((item) => item.id),
    ).toEqual(['new-a', 'created-first', 'new-b', 'updated-first'])
    expect(
      sortSessionsForSidebar(
        [
          { ...createdFirst, id: 'idle' },
          { ...createdFirst, id: 'running', status: 'running' },
          {
            ...createdFirst,
            id: 'unread',
            unreadAt: '2026-07-18T07:00:00Z',
          },
          { ...createdFirst, id: 'waiting', status: 'waiting' },
        ],
        {
          ...options,
          sort: 'priority',
          unreadSessionIds: new Set(['unread']),
        },
      ).map((item) => item.id),
    ).toEqual(['waiting', 'unread', 'running', 'idle'])
  })

  test('sorts projects by activity before applying stable stored order', () => {
    const sortableProjects: DesktopWorkspace[] = [
      { name: 'Alpha', path: 'C:\\alpha', projectId: 'alpha' },
      { name: 'Beta', path: 'C:\\beta', projectId: 'beta' },
    ]
    const sortableSessions = [
      session('alpha-session', 'C:\\alpha', '2026-07-18T01:00:00Z'),
      {
        ...session('beta-session', 'C:\\beta', '2026-07-18T02:00:00Z'),
        projectId: 'beta',
      },
    ].map((item) => (item.id === 'alpha-session' ? { ...item, projectId: 'alpha' } : item))
    const options = {
      manualOrderByScope: {
        projects: [
          sidebarProjectKey(sortableProjects[0]!),
          sidebarProjectKey(sortableProjects[1]!),
        ],
      },
      scopeKey: 'projects',
      sessions: sortableSessions,
    }

    expect(
      sortProjectsForSidebar(sortableProjects, {
        ...options,
        manualOrderByScope: {},
      }).map((project) => project.projectId),
    ).toEqual(['beta', 'alpha'])
    expect(
      sortProjectsForSidebar(sortableProjects, options).map((project) => project.projectId),
    ).toEqual(['alpha', 'beta'])
    expect(
      sortProjectsForSidebar(
        [...sortableProjects, { name: 'Gamma', path: 'C:\\gamma', projectId: 'gamma' }],
        {
          ...options,
        },
      ).map((project) => project.projectId),
    ).toEqual(['gamma', 'alpha', 'beta'])
  })
})

describe('sidebar session hover card projection', () => {
  test('shows compact time, project, and normalized work branch', () => {
    const item = {
      ...session('thread-1', 'F:\\CodeProject\\Pidex'),
      sessionName: '实现 Hover Card',
      gitBranch: '  codex/hover-card  ',
    }
    expect(
      buildSidebarSessionHoverCardModel(
        item,
        undefined,
        new Date('2026-07-18T00:19:00.000Z').getTime(),
      ),
    ).toEqual({
      title: '实现 Hover Card',
      relativeTime: '19 分',
      projectLabel: 'Pidex',
      gitBranch: 'codex/hover-card',
      environmentLabel: null,
      environmentKind: null,
      pullRequests: [],
      unread: false,
      isRunning: false,
    })
  })

  test('悬浮卡携带未读状态并按活动任务统计已开启数量', () => {
    const unreadItem = {
      ...session('thread-unread', 'F:\\CodeProject\\Pidex'),
      unreadAt: '2026-07-18T00:18:00.000Z',
    }
    expect(
      buildSidebarSessionHoverCardModel(
        unreadItem,
        undefined,
        new Date('2026-07-18T00:19:00.000Z').getTime(),
      ).unread,
    ).toBe(true)
    expect(
      countOpenProjectSessions([
        { ...unreadItem, status: 'queued' },
        { ...unreadItem, id: 'waiting', status: 'waiting' },
        { ...unreadItem, id: 'running', status: 'running' },
        { ...unreadItem, id: 'idle', status: 'idle' },
      ]),
    ).toBe(3)
  })

  test('统一解析完整标题并将展示标题限制为 20 个 Unicode 字符', () => {
    const persistedTitle = '😀'.repeat(21)
    const item = {
      ...session('thread-title', 'F:\\CodeProject\\Pidex'),
      sessionName: persistedTitle,
      aiTitle: null,
      firstPrompt: '临时首条消息',
    }

    expect(sessionResolvedTitle(item, '当前会话回退标题')).toBe(persistedTitle)
    expect(sessionEditableTitle(item, '当前会话回退标题')).toBe(persistedTitle)

    const displayTitle = sessionDisplayTitle(item, '当前会话回退标题')
    expect(displayTitle).toBe(`${'😀'.repeat(19)}…`)
    expect(Array.from(displayTitle)).toHaveLength(SESSION_TITLE_MAX_LENGTH)
    expect(sessionDisplayTitle(null, `# ${persistedTitle}`)).toBe(`# ${'😀'.repeat(17)}…`)
  })

  test('优先显示用户和 AI 标题，并保留展示标题中的 Markdown', () => {
    const item = {
      ...session('thread-priority', 'F:\\CodeProject\\Pidex'),
      customTitle: null,
      aiTitle: '## AI 生成标题',
      sessionName: '数据库标题',
      firstPrompt: '首条消息',
    }

    expect(sessionDisplayTitle(item, '当前会话回退标题')).toBe('## AI 生成标题')
    expect(
      sessionDisplayTitle(
        {
          ...item,
          customTitle: '> # 用户标题',
        },
        '当前会话回退标题',
      ),
    ).toBe('> # 用户标题')
    expect(
      sessionResolvedTitle(
        {
          ...item,
          aiTitle: null,
          sessionName: '新对话',
        },
        '当前会话回退标题',
      ),
    ).toBe('当前会话回退标题')
  })

  test('项目环境归入编码分组的 Worktrees 入口', () => {
    const codingGroup = SETTINGS_GROUPS.find((group) => group.id === 'coding')
    const worktrees = SETTINGS_ITEMS.find((item) => item.routeId === 'worktrees')
    expect(codingGroup?.items.some((item) => item.routeId === 'worktrees')).toBe(true)
    expect(SETTINGS_ITEMS.some((item) => item.routeId === 'environment')).toBe(false)
    expect(worktrees?.rows.some((item) => item.title === '多环境')).toBe(true)
  })

  test('groups projects by stable project id even when folders share a path', () => {
    const sharedPath = 'C:\\shared'
    const model = buildSidebarViewModel({
      pendingPermissionSessionIds: new Set(),
      recentWorkspaces: [
        { name: 'One', path: sharedPath, projectId: 'project-one' },
        { name: 'Two', path: sharedPath, projectId: 'project-two' },
      ],
      removedWorkspaces: [],
      sessionPins: {},
      sessions: [
        { ...session('one', sharedPath), projectId: 'project-one' },
        { ...session('two', sharedPath), projectId: 'project-two' },
      ],
    })

    expect(model.projectWorkspaces.map((item) => item.projectId).sort()).toEqual([
      'project-one',
      'project-two',
    ])
  })

  test('pins projects independently by stable project id', () => {
    const sharedPath = 'C:\\shared'
    const model = buildSidebarViewModel({
      pendingPermissionSessionIds: new Set(),
      recentWorkspaces: [
        {
          name: 'Pinned',
          path: sharedPath,
          projectId: 'project-pinned',
          pinnedAt: '2026-07-18T08:00:00.000Z',
        },
        {
          name: 'Regular',
          path: sharedPath,
          projectId: 'project-regular',
          pinnedAt: null,
        },
      ],
      removedWorkspaces: [],
      sessionPins: {},
      sessions: [],
    })

    expect(model.pinnedWorkspaces.map((item) => item.projectId)).toEqual(['project-pinned'])
    expect(model.projectWorkspaces.map((item) => item.projectId)).toEqual(['project-regular'])
  })

  test('uses 会话 for standalone items and hides an empty branch', () => {
    const item = {
      ...session('thread-2', 'C:\\workspace', undefined, true),
      gitBranch: ' ',
    }
    const model = buildSidebarSessionHoverCardModel(
      item,
      '无项目会话',
      new Date('2026-07-18T03:00:00.000Z').getTime(),
    )
    expect(model.projectLabel).toBe('会话')
    expect(model.gitBranch).toBeNull()
    expect(
      formatSidebarSessionRelativeTime(
        '2026-07-16T03:00:00.000Z',
        new Date('2026-07-18T03:00:00.000Z').getTime(),
      ),
    ).toBe('2 天')
  })
})

function session(
  id: string,
  workspacePath: string,
  lastMessageAt = '2026-07-18T00:00:00.000Z',
  standalone = false,
  createdAt = '2026-07-18T00:00:00.000Z',
): SessionListItem {
  return {
    id,
    workspaceName: standalone ? '' : (workspacePath.split('\\').at(-1) ?? ''),
    workspacePath,
    standalone,
    createdAt,
    lastMessageAt,
    status: 'idle',
    archivedAt: null,
    pinnedAt: null,
    unreadAt: null,
  } as SessionListItem
}

describe('侧栏时间线投影', () => {
  // 假定当前日期 2026-08-01（星期六）
  const NOW = new Date('2026-08-01T12:00:00.000Z').getTime()

  function timelineSession(
    id: string,
    latestTurnStatus: SessionListItem['latestTurnStatus'],
    lastMessageAt: string | null = '2026-08-01T00:00:00.000Z',
    extras: Partial<SessionListItem> = {},
  ): SessionListItem {
    return {
      ...session(id, `C:\\${id}`, lastMessageAt ?? undefined),
      latestTurnStatus,
      unreadAt: null,
      ...extras,
    }
  }

  function focus(sessions: SessionListItem[], showPinned = false): SidebarTimelineModel {
    return buildSidebarTimelineModel({
      now: NOW,
      showPinned,
      sessions,
    })
  }

  test('等待问题、等待权限、计划待审批、完成未读始终进入关注投影，且不受日期窗口限制', () => {
    const model = focus([
      timelineSession('plan-approval', 'completed', '2026-05-01T00:00:00.000Z', {
        pendingPlanApproval: true,
      }),
      timelineSession('question', 'waiting-question', '2026-05-02T00:00:00.000Z'),
      timelineSession('permission', 'waiting-permission', '2026-05-03T00:00:00.000Z'),
      timelineSession('completed-unread', 'completed', '2026-05-04T00:00:00.000Z', {
        unreadAt: '2026-08-01T00:00:00.000Z',
      }),
    ])
    expect(model.attentionSessions.map((s) => s.id)).toEqual([
      'permission',
      'question',
      'plan-approval',
      'completed-unread',
    ])
    expect(model.prioritySessions.map((s) => s.id)).toEqual([
      'permission',
      'question',
      'plan-approval',
      'completed-unread',
    ])
    expect(model.pinnedSessions).toEqual([])
    expect(model.dateSections).toEqual([])
  })

  test('waiting-subagents、普通运行中和排队中进入进行中优先级(rank 2)，已读完成任务进入日期区', () => {
    const model = focus([
      timelineSession('subagents', 'waiting-subagents', '2026-08-01T01:00:00.000Z'),
      timelineSession('running', 'running', '2026-08-01T02:00:00.000Z'),
      timelineSession('read-completed', 'completed', '2026-08-01T00:00:00.000Z'),
      timelineSession('queued', 'queued', '2026-08-01T03:00:00.000Z'),
    ])
    expect(model.prioritySessions.map((s) => s.id)).toEqual(['queued', 'running', 'subagents'])
    expect(model.dateSections.map((s) => s.id)).toEqual(['day-0'])
    expect(model.dateSections[0]!.sessions.map((s) => s.id)).toEqual(['read-completed'])
  })

  test('同一优先级内按最近活动时间倒序，再以任务 ID 保证稳定顺序', () => {
    const model = focus([
      timelineSession('older-question', 'waiting-question', '2026-08-01T01:00:00.000Z'),
      timelineSession('newer-question', 'waiting-question', '2026-08-01T12:00:00.000Z'),
    ])
    expect(model.prioritySessions.map((s) => s.id)).toEqual(['newer-question', 'older-question'])
  })

  test('关注任务不会在日期组重复出现', () => {
    const model = focus([
      timelineSession('question', 'waiting-question', '2026-08-01T00:00:00.000Z'),
      timelineSession('normal', 'idle', '2026-08-01T00:00:00.000Z'),
    ])
    expect(model.prioritySessions.map((s) => s.id)).toEqual(['question'])
    expect(model.dateSections.map((s) => s.id)).toEqual(['day-0'])
    expect(model.dateSections[0]!.sessions.map((s) => s.id)).toEqual(['normal'])
  })

  test('清除未读后退出关注区，并在符合 7 天条件时回到日期区', () => {
    const unread = timelineSession('done', 'completed', '2026-08-01T00:00:00.000Z', {
      unreadAt: '2026-08-01T00:00:00.000Z',
    })
    const unreadModel = focus([unread])
    expect(unreadModel.attentionSessions.map((s) => s.id)).toEqual(['done'])

    const readModel = focus([{ ...unread, unreadAt: null }])
    expect(readModel.attentionSessions).toEqual([])
    expect(readModel.prioritySessions).toEqual([])
    expect(readModel.dateSections.map((s) => s.id)).toEqual(['day-0'])
    expect(readModel.dateSections[0]!.sessions.map((s) => s.id)).toEqual(['done'])
  })

  test('7 天以前的等待用户任务仍进入关注区', () => {
    const model = focus([
      timelineSession('old-question', 'waiting-question', '2026-04-01T00:00:00.000Z'),
    ])
    expect(model.attentionSessions.map((s) => s.id)).toEqual(['old-question'])
    expect(model.prioritySessions.map((s) => s.id)).toEqual(['old-question'])
    expect(model.dateSections).toEqual([])
  })

  test('showPinned=false 时置顶关注任务仍位于优先级分类，置顶普通任务仍按日期分类', () => {
    const model = focus([
      timelineSession('pinned-question', 'waiting-question', '2026-08-01T00:00:00.000Z', {
        pinnedAt: '2026-07-20T00:00:00.000Z',
      }),
      timelineSession('pinned-normal', 'idle', '2026-08-01T00:00:00.000Z', {
        pinnedAt: '2026-07-21T00:00:00.000Z',
      }),
      timelineSession('normal', 'idle', '2026-08-01T00:00:00.000Z'),
    ])
    expect(model.pinnedSessions).toEqual([])
    expect(model.prioritySessions.map((s) => s.id)).toEqual(['pinned-question'])
    expect(model.dateSections[0]!.sessions.map((s) => s.id)).toEqual(['pinned-normal', 'normal'])
  })

  test('showPinned=true 时置顶任务进入独立分组，并从优先级和日期分类去重', () => {
    const sessions = [
      timelineSession('pinned-question', 'waiting-question', '2026-08-01T00:00:00.000Z', {
        pinnedAt: '2026-07-20T00:00:00.000Z',
      }),
      timelineSession('pinned-unread', 'completed', '2026-08-01T01:00:00.000Z', {
        pinnedAt: '2026-07-21T00:00:00.000Z',
        unreadAt: '2026-08-01T01:00:00.000Z',
      }),
      timelineSession('pinned-normal', 'idle', '2026-08-01T02:00:00.000Z', {
        pinnedAt: '2026-07-22T00:00:00.000Z',
      }),
      timelineSession('normal', 'idle', '2026-08-01T03:00:00.000Z'),
    ]
    const model = focus(sessions, true)
    expect(model.pinnedSessions.map((s) => s.id).sort()).toEqual([
      'pinned-normal',
      'pinned-question',
      'pinned-unread',
    ])
    expect(model.prioritySessions).toEqual([])
    expect(model.dateSections[0]!.sessions.map((s) => s.id)).toEqual(['normal'])
  })

  test('attentionSessions 不受置顶开关影响，保证铃铛和批量操作状态稳定', () => {
    const sessions = [
      timelineSession('pinned-question', 'waiting-question', '2026-08-01T00:00:00.000Z', {
        pinnedAt: '2026-07-20T00:00:00.000Z',
      }),
      timelineSession('question', 'waiting-question', '2026-08-01T00:00:00.000Z'),
    ]
    expect(focus(sessions, false).attentionSessions.map((s) => s.id)).toEqual([
      'question',
      'pinned-question',
    ])
    expect(focus(sessions, true).attentionSessions.map((s) => s.id)).toEqual([
      'question',
      'pinned-question',
    ])
  })

  test('全部标为已读只选择 unreadAt 非空的关注任务', () => {
    const sessions = [
      timelineSession('unread', 'completed', '2026-08-01T00:00:00.000Z', {
        unreadAt: '2026-08-01T00:00:00.000Z',
      }),
      timelineSession('question', 'waiting-question', '2026-08-01T00:00:00.000Z'),
      timelineSession('plan-approval', 'completed', '2026-08-01T00:00:00.000Z', {
        pendingPlanApproval: true,
      }),
    ]
    const attention = focus(sessions).attentionSessions
    expect(sidebarAttentionUnreadSessions(attention).map((s) => s.id)).toEqual(['unread'])
  })

  test('批量归档覆盖显示的优先事项，等待与运行项由停止流程处理', () => {
    const sessions = [
      timelineSession('unread', 'completed', '2026-08-01T00:00:00.000Z', {
        unreadAt: '2026-08-01T00:00:00.000Z',
      }),
      timelineSession('question', 'waiting-question', '2026-08-01T00:00:00.000Z'),
      timelineSession('permission', 'waiting-permission', '2026-08-01T00:00:00.000Z'),
      timelineSession('plan-approval', 'completed', '2026-08-01T00:00:00.000Z', {
        pendingPlanApproval: true,
        unreadAt: '2026-08-01T00:00:00.000Z',
      }),
      timelineSession('running', 'running', '2026-08-01T00:00:00.000Z', {
        unreadAt: '2026-08-01T00:00:00.000Z',
      }),
    ]
    const attention = focus(sessions).attentionSessions
    expect(sidebarArchivableAttentionSessions(attention).map((s) => s.id)).toEqual([
      'question',
      'plan-approval',
      'permission',
      'unread',
      'running',
    ])
  })

  test('活动列表保留已读项与分组时间，追加新活动，删除归档和失效项', () => {
    const unread = timelineSession('unread', 'completed', '2026-08-01T01:00:00.000Z', {
      unreadAt: '2026-08-01T01:00:00.000Z',
    })
    const running = timelineSession('running', 'running', '2026-08-01T03:00:00.000Z')
    const recent = timelineSession('recent', 'idle', '2026-07-31T01:00:00.000Z')
    const initial = reconcileSidebarActivitySnapshot(null, [running, unread, recent])
    expect(initial.priorityIds).toEqual(['unread', 'running'])
    const read = { ...unread, unreadAt: null }
    const changed = [
      read,
      { ...running, latestTurnStatus: 'completed' as const },
      { ...recent, lastMessageAt: '2026-08-01T04:00:00.000Z' },
      timelineSession('new', 'waiting-question'),
    ]
    const retained = reconcileSidebarActivitySnapshot(initial, changed)
    expect(retained.priorityIds).toEqual(['unread', 'running', 'new'])
    const model = buildSidebarTimelineModel({
      now: NOW,
      sessions: changed,
      showPinned: false,
      snapshot: retained,
    })
    expect(model.prioritySessions.map((s) => s.id)).toEqual(['unread', 'running', 'new'])
    expect(model.dateSections[0]?.id).toBe('day-1')
    const cleared = reconcileSidebarActivitySnapshot(retained, changed, true)
    expect(cleared.priorityIds).toEqual(['new'])
    const refreshed = buildSidebarTimelineModel({
      now: NOW,
      sessions: changed,
      showPinned: false,
      snapshot: cleared,
    })
    expect(refreshed.dateSections[0]?.id).toBe('day-0')
    expect(
      reconcileSidebarActivitySnapshot(retained, [
        { ...read, archivedAt: '2026-08-01T04:00:00.000Z' },
      ]).priorityIds,
    ).toEqual([])
    expect(reconcileSidebarActivitySnapshot(null, changed).priorityIds).toEqual(['new'])
  })

  test('关闭优先事项后按日期展示并与置顶去重，筛选仅保留可见优先事项', () => {
    const pinned = timelineSession('pinned', 'waiting-question', '2026-08-01T01:00:00.000Z', {
      pinnedAt: '2026-08-01T01:00:00.000Z',
    })
    const chat = timelineSession('chat', 'running', '2026-08-01T02:00:00.000Z', {
      creationSurface: 'chat',
    })
    const sessions = [pinned, chat]
    const model = buildSidebarTimelineModel({
      now: NOW,
      sessions,
      showPinned: true,
      showPriority: false,
      snapshot: reconcileSidebarActivitySnapshot(null, sessions),
    })
    expect(model.prioritySessions).toEqual([])
    expect(model.pinnedSessions.map((s) => s.id)).toEqual(['pinned'])
    expect(model.dateSections.flatMap((section) => section.sessions.map((s) => s.id))).toEqual([
      'chat',
    ])
    const filtered = filterSidebarActivitySessions(sessions, { showChat: false })
    expect(
      buildSidebarTimelineModel({ now: NOW, sessions: filtered, showPinned: true })
        .prioritySessions,
    ).toEqual([])
  })

  test('待回复按同级时间排列，未读优先于运行中', () => {
    const model = focus([
      timelineSession('run', 'running', '2026-08-01T05:00:00.000Z'),
      timelineSession('unread', 'idle', '2026-08-01T01:00:00.000Z', {
        unreadAt: '2026-08-01T01:00:00.000Z',
      }),
      timelineSession('question', 'waiting-question', '2026-08-01T03:00:00.000Z'),
      timelineSession('plan', 'completed', '2026-08-01T04:00:00.000Z', {
        pendingPlanApproval: true,
      }),
    ])
    expect(model.prioritySessions.map((s) => s.id)).toEqual(['plan', 'question', 'unread', 'run'])
  })

  test('停止失败的聊天不归档，其余优先事项继续归档', async () => {
    const { archiveSidebarActivity } =
      await import('../src/features/layout/sidebar/SidebarActivityActions.js')
    const stopped: string[] = []
    let archived: readonly SessionListItem[] = []
    const failed = await archiveSidebarActivity(
      [
        timelineSession('run', 'running'),
        timelineSession('fail', 'waiting-permission'),
        timelineSession('read', 'completed'),
      ],
      async (id) => {
        stopped.push(id)
        if (id === 'fail') throw new Error('stop failed')
      },
      async (items) => {
        archived = items
        return true
      },
    )
    expect(stopped).toEqual(['run', 'fail'])
    expect(failed).toBe(1)
    expect(archived.map((s) => s.id)).toEqual(['run', 'read'])
  })

  test('助手摘要跳过用户和空消息，合并换行并限制长度', async () => {
    const { latestAssistantPreview } =
      await import('../src/features/layout/sidebar/UseSidebarActivityPreview.js')
    expect(
      latestAssistantPreview([
        { role: 'assistant', text: '上一条' },
        { role: 'assistant', text: '最新\n 回复' },
        { role: 'user', text: '新的问题' },
        { role: 'assistant', text: '  ' },
      ]),
    ).toBe('最新 回复')
    expect(latestAssistantPreview([{ role: 'assistant', text: 'a'.repeat(200) }])?.length).toBe(180)
    expect(latestAssistantPreview([{ role: 'user', text: '问题' }])).toBeNull()
  })

  test('今天和昨天标签正确', () => {
    const today = new Date('2026-08-01T10:00:00.000Z').getTime()
    const yesterday = new Date('2026-07-31T10:00:00.000Z').getTime()
    expect(labelForDayOffset(0, new Date(today))).toBe('今天')
    expect(labelForDayOffset(1, new Date(yesterday))).toBe('昨天')
  })

  test('假定星期六时偏移 2 至 6 分别得到星期四到星期日', () => {
    expect(labelForDayOffset(2, new Date('2026-07-30T00:00:00.000Z'))).toBe('星期四')
    expect(labelForDayOffset(3, new Date('2026-07-29T00:00:00.000Z'))).toBe('星期三')
    expect(labelForDayOffset(4, new Date('2026-07-28T00:00:00.000Z'))).toBe('星期二')
    expect(labelForDayOffset(5, new Date('2026-07-27T00:00:00.000Z'))).toBe('星期一')
    expect(labelForDayOffset(6, new Date('2026-07-26T00:00:00.000Z'))).toBe('星期日')
  })

  test('没有任务的星期二不会生成空分组，日期组按偏移 0→6 排列', () => {
    const model = focus([
      timelineSession('today', 'idle', '2026-08-01T00:00:00.000Z'),
      timelineSession('thu', 'idle', '2026-07-30T00:00:00.000Z'),
      timelineSession('wed', 'idle', '2026-07-29T00:00:00.000Z'),
      timelineSession('mon', 'idle', '2026-07-27T00:00:00.000Z'),
      timelineSession('sun', 'idle', '2026-07-26T00:00:00.000Z'),
      timelineSession('fri', 'idle', '2026-07-31T00:00:00.000Z'),
    ])
    expect(model.dateSections.map((s) => s.id)).toEqual([
      'day-0',
      'day-1',
      'day-2',
      'day-3',
      'day-5',
      'day-6',
    ])
    expect(model.dateSections.map((s) => s.label)).toEqual([
      '今天',
      '昨天',
      '星期四',
      '星期三',
      '星期一',
      '星期日',
    ])
  })

  test('第 6 天任务仍显示，第 7 天及更早任务被隐藏', () => {
    const model = focus([
      timelineSession('day6', 'idle', '2026-07-26T00:00:00.000Z'),
      timelineSession('day7', 'idle', '2026-07-25T00:00:00.000Z'),
    ])
    expect(model.dateSections.flatMap((s) => s.sessions).map((s) => s.id)).toEqual(['day6'])
  })

  test('跨月和跨年时仍按自然日分组', () => {
    // 当前为 2026-08-01，前 6 天跨越 7 月；再测一个跨年场景
    const model = focus([timelineSession('end-july', 'idle', '2026-07-26T23:00:00.000Z')])
    expect(model.dateSections[0]!.id).toBe('day-6')
    // 跨年：当前 2026-01-01，前 6 天跨越 2025
    const nyeModel = buildSidebarTimelineModel({
      now: new Date('2026-01-01T12:00:00.000Z').getTime(),
      showPinned: false,
      sessions: [timelineSession('old-year', 'idle', '2025-12-30T00:00:00.000Z')],
    })
    expect(nyeModel.dateSections[0]!.id).toBe('day-2')
  })

  test('日期组内按最近活动时间倒序', () => {
    const model = focus([
      timelineSession('older', 'idle', '2026-08-01T01:00:00.000Z'),
      timelineSession('newer', 'idle', '2026-08-01T12:00:00.000Z'),
    ])
    expect(model.dateSections[0]!.sessions.map((s) => s.id)).toEqual(['newer', 'older'])
  })

  test('无效时间的普通任务被隐藏，但无效时间的等待用户任务仍显示', () => {
    const model = focus([
      timelineSession('bad-normal', 'idle', '__bad__', {
        createdAt: '__invalid__',
      }),
      timelineSession('bad-priority', 'waiting-question', '__bad__', {
        createdAt: '__invalid__',
      }),
    ])
    expect(model.attentionSessions.map((s) => s.id)).toEqual(['bad-priority'])
    expect(model.prioritySessions.map((s) => s.id)).toEqual(['bad-priority'])
    expect(model.dateSections).toEqual([])
  })

  test('所有分组为空时返回空投影', () => {
    const model = focus([])
    expect(model.attentionSessions).toEqual([])
    expect(model.pinnedSessions).toEqual([])
    expect(model.prioritySessions).toEqual([])
    expect(model.dateSections).toEqual([])
  })

  test('filterSidebarActivitySessions 按 Work 和 Chat 来源正确过滤', () => {
    const workCoding = timelineSession('work-coding', 'idle', '2026-08-01T00:00:00.000Z', {
      creationSurface: 'coding',
    })
    const workWorking = timelineSession('work-working', 'idle', '2026-08-01T00:00:00.000Z', {
      creationSurface: 'working',
    })
    const workDefault = timelineSession('work-default', 'idle', '2026-08-01T00:00:00.000Z', {
      creationSurface: undefined,
    })
    const chat = timelineSession('chat-only', 'idle', '2026-08-01T00:00:00.000Z', {
      creationSurface: 'chat',
    })
    const archived = timelineSession('archived-item', 'idle', '2026-08-01T00:00:00.000Z', {
      archivedAt: '2026-08-01T00:00:00.000Z',
    })
    const all = [workCoding, workWorking, workDefault, chat, archived]

    // 默认全选
    expect(
      filterSidebarActivitySessions(all, { showWork: true, showChat: true }).map((s) => s.id),
    ).toEqual(['work-coding', 'work-working', 'work-default', 'chat-only'])

    // 只选 Work
    expect(
      filterSidebarActivitySessions(all, { showWork: true, showChat: false }).map((s) => s.id),
    ).toEqual(['work-coding', 'work-working', 'work-default'])

    // 只选 Chat
    expect(
      filterSidebarActivitySessions(all, { showWork: false, showChat: true }).map((s) => s.id),
    ).toEqual(['chat-only'])

    // 全不选
    expect(filterSidebarActivitySessions(all, { showWork: false, showChat: false })).toEqual([])
  })

  test('deriveSidebarActivityIndicatorState 正确计算 3 态指示器', () => {
    // 1. attention 状态：存在 waiting-question, waiting-permission, pendingPlanApproval 或 unread completed
    expect(
      deriveSidebarActivityIndicatorState([
        timelineSession('q', 'waiting-question'),
        timelineSession('r', 'running'),
      ]),
    ).toBe('attention')

    expect(
      deriveSidebarActivityIndicatorState([
        timelineSession('unread', 'completed', '2026-08-01T00:00:00.000Z', {
          unreadAt: '2026-08-01T00:00:00.000Z',
        }),
      ]),
    ).toBe('attention')

    expect(
      deriveSidebarActivityIndicatorState([
        timelineSession('unread-idle', 'idle', '2026-08-01T00:00:00.000Z', {
          unreadAt: '2026-08-01T00:00:00.000Z',
        }),
      ]),
    ).toBe('attention')

    // 2. active 状态：无 attention，但有 running / waiting-subagents / queued
    expect(
      deriveSidebarActivityIndicatorState([
        timelineSession('r', 'running'),
        timelineSession('done', 'completed'),
      ]),
    ).toBe('active')

    expect(deriveSidebarActivityIndicatorState([timelineSession('sub', 'waiting-subagents')])).toBe(
      'active',
    )

    // 3. idle 状态：普通 idle 或已读 completed
    expect(
      deriveSidebarActivityIndicatorState([
        timelineSession('i', 'idle'),
        timelineSession('done', 'completed'),
      ]),
    ).toBe('idle')
  })

  test('sliceSidebarTimelineModel 支持全局 10/+10 分页截断与空组过滤', () => {
    const sessions: SessionListItem[] = []
    for (let i = 0; i < 15; i++) {
      sessions.push(
        timelineSession(
          `priority-${i}`,
          'waiting-question',
          `2026-08-01T${String(i).padStart(2, '0')}:00:00.000Z`,
        ),
      )
    }
    for (let i = 0; i < 5; i++) {
      sessions.push(
        timelineSession(
          `pinned-${i}`,
          'idle',
          `2026-08-01T${String(i).padStart(2, '0')}:00:00.000Z`,
          {
            pinnedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
          },
        ),
      )
    }
    const model = focus(sessions, true)

    // 切片 limit = 10
    const slice10 = sliceSidebarTimelineModel(model, 10)
    expect(slice10.totalCount).toBe(20)
    expect(slice10.visibleCount).toBe(10)
    expect(slice10.hasMore).toBe(true)
    expect(slice10.prioritySessions.length).toBe(10)
    expect(slice10.pinnedSessions.length).toBe(0)

    // 切片 limit = 18
    const slice18 = sliceSidebarTimelineModel(model, 18)
    expect(slice18.visibleCount).toBe(18)
    expect(slice18.hasMore).toBe(true)
    expect(slice18.prioritySessions.length).toBe(15)
    expect(slice18.pinnedSessions.length).toBe(3)

    // 切片 limit = 25 (全部展示)
    const slice25 = sliceSidebarTimelineModel(model, 25)
    expect(slice25.visibleCount).toBe(20)
    expect(slice25.hasMore).toBe(false)
    expect(slice25.prioritySessions.length).toBe(15)
    expect(slice25.pinnedSessions.length).toBe(5)
  })

  test('clampTimelineVisibleLimit 数据减少时 clamp，实时增加与首次加载保留当前 limit', () => {
    // 首次加载：previousTotal 未定义 → 保留 currentLimit
    expect(
      clampTimelineVisibleLimit({
        previousTotal: undefined,
        nextTotal: 8,
        currentLimit: 10,
      }),
    ).toBe(10)

    // 实时增加：5 → 8，current 5 → 保持 5
    expect(
      clampTimelineVisibleLimit({
        previousTotal: 5,
        nextTotal: 8,
        currentLimit: 5,
      }),
    ).toBe(5)

    // 数据减少：20 → 5，current 20 → clamp 到 5
    expect(
      clampTimelineVisibleLimit({
        previousTotal: 20,
        nextTotal: 5,
        currentLimit: 20,
      }),
    ).toBe(5)

    // 数据持平：10 → 10，current 10 → 保持
    expect(
      clampTimelineVisibleLimit({
        previousTotal: 10,
        nextTotal: 10,
        currentLimit: 10,
      }),
    ).toBe(10)

    // 数据先减少到 0：20 → 0，current 20 → clamp 到 0
    expect(
      clampTimelineVisibleLimit({
        previousTotal: 20,
        nextTotal: 0,
        currentLimit: 20,
      }),
    ).toBe(0)

    // 数据从 0 再次增长：0 → 8，current 0 → 恢复到 initialLimit (10)
    expect(
      clampTimelineVisibleLimit({
        previousTotal: 0,
        nextTotal: 8,
        currentLimit: 0,
      }),
    ).toBe(10)

    // currentLimit 已小于 nextTotal：保持 currentLimit
    expect(
      clampTimelineVisibleLimit({
        previousTotal: 5,
        nextTotal: 8,
        currentLimit: 3,
      }),
    ).toBe(3)

    // currentLimit 越界（current > nextTotal）：clamp 到 nextTotal
    expect(
      clampTimelineVisibleLimit({
        previousTotal: 20,
        nextTotal: 5,
        currentLimit: 50,
      }),
    ).toBe(5)
  })
})

describe('聊天 header 项目归属', () => {
  const first: DesktopWorkspace = {
    projectId: 'project-a',
    name: 'A',
    path: 'F:/work/a',
    branchName: null,
  }
  const second: DesktopWorkspace = {
    projectId: 'project-b',
    name: 'B',
    path: 'F:/work/b',
    branchName: null,
  }
  test('以聊天项目 ID 为准，不使用恰好选中的其他工作区', () => {
    const active = { ...session('task', second.path), projectId: first.projectId }
    expect(resolveConversationProject(active, [first, second], second)).toBe(first)
    expect(resolveConversationProject(active, [second], second)).toBeNull()
  })
  test('无项目与未解析聊天没有项目入口', () => {
    expect(
      resolveConversationProject(
        { ...session('task', first.path), projectId: first.projectId, standalone: true },
        [first],
        first,
      ),
    ).toBeNull()
    expect(resolveConversationProject(null, [first], first)).toBeNull()
    expect(resolveConversationProject(session('task', ''), [first], first)).toBeNull()
  })
  test('旧路径项目复用规范化 key，当前工作区只能作为同项目回退', () => {
    const legacy = { ...first, projectId: undefined }
    const active = session('task', 'f:/WORK/a/')
    expect(resolveConversationProject(active, [legacy], second)).toBe(legacy)
    expect(resolveConversationProject(active, [], legacy)).toBe(legacy)
    expect(resolveConversationProject(active, [], second)).toBeNull()
  })
})
