import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Dropdown, matchesDropdownSearch } from '../src/components/ui/floating/Dropdown.js'
import { ContextMenu, menuKeyDown, selectMenuItem } from '../src/components/ui/floating/Menu.js'
import { computeFloatingPosition } from '../src/components/ui/floating/UseFloatingPosition.js'
import { buildPopoverSizingStyle } from '../src/components/ui/PopoverSizing.js'
import { ReasoningMenu } from '../src/features/session/composer/ReasoningMenu.js'
import { DropdownActions } from '../src/components/ui/DropdownActions.js'
import { describe, expect, test } from 'bun:test'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

describe('Codex CPX design system token contract', () => {
  test('floating surfaces share the three UI-Design widths', () => {
    expect(buildPopoverSizingStyle({ size: 'sm' })).toEqual({ '--popover-width': '220px' })
    expect(buildPopoverSizingStyle({ size: 'md' })).toEqual({ '--popover-width': '280px' })
    expect(buildPopoverSizingStyle({ size: 'lg' })).toEqual({ '--popover-width': '360px' })
    expect(buildPopoverSizingStyle()).toEqual(buildPopoverSizingStyle({ size: 'md' }))
  })
  test('guards interaction semantics and visual ownership without broad exceptions', async () => {
    const [checker, manifestText] = await Promise.all([
      Bun.file(new URL('../scripts/CheckStyleContracts.ts', import.meta.url)).text(),
      Bun.file(new URL('../style-contracts.json', import.meta.url)).text(),
    ])
    const manifest = JSON.parse(manifestText) as {
      interactionContract: { interactiveRowAllowedFiles: string[] }
    }

    expect(manifest.interactionContract.interactiveRowAllowedFiles).toEqual([
      'src/components/ui/DropdownActions.tsx',
      'src/components/ui/PopoverItem.tsx',
      'src/components/ui/SearchablePopoverContent.tsx',
      'src/features/session/summary/ThreadSummaryPanel.tsx',
    ])
    expect(checker).toContain('feature styles must not target .ui-button')
    expect(checker).toContain('legacy interactive-row escape modifier is forbidden')
    expect(checker).toContain('Button must not represent persistent pressed/selected state')
    expect(checker).toContain('Popover radio-group trigger must not use Button')
    expect(checker).toContain('stale interactive-row allowed file')
  })

  test('governs feature colors through precise, stale-detectable exceptions', async () => {
    const [checker, manifestText, guidance] = await Promise.all([
      Bun.file(new URL('../scripts/CheckStyleContracts.ts', import.meta.url)).text(),
      Bun.file(new URL('../style-contracts.json', import.meta.url)).text(),
      Bun.file(new URL('../../../../docs/design/renderer-color-system.md', import.meta.url)).text(),
    ])
    const manifest = JSON.parse(manifestText) as {
      featureColorContract: {
        roots: string[]
        componentTokenExceptions: Array<{ file: string; token: string; reason: string }>
        literalColorExceptions: Array<{ file: string; value: string; reason: string }>
        colorMixExceptions: Array<{ file: string; localProperty: string; reason: string }>
      }
    }

    expect(manifest.featureColorContract.roots).toEqual(['src/styles/features', 'src/styles/lazy'])
    for (const exception of [
      ...manifest.featureColorContract.componentTokenExceptions,
      ...manifest.featureColorContract.literalColorExceptions,
      ...manifest.featureColorContract.colorMixExceptions,
    ]) {
      expect(exception.file).not.toContain('*')
      expect(exception.reason.length).toBeGreaterThan(15)
    }
    expect(checker).toContain('feature styles must use system semantic colors')
    expect(checker).toContain('feature styles must not use literal color')
    expect(checker).toContain('feature color-mix must not combine multiple semantic/local colors')
    expect(checker).toContain('stale feature component-token exception')
    expect(checker).toContain('stale feature literal-color exception')
    expect(checker).toContain('stale feature color-mix exception')
    expect(guidance).toContain('系统语义颜色')
    expect(guidance).toContain('组件私有实现')
    expect(guidance).toContain('Agent 选择流程')
  })

  test('exports component tokens for all 13 components', async () => {
    const stylesheet = await Bun.file(
      new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
    ).text()
    const tokens = Array.from(
      stylesheet.matchAll(/^\s*(--cpx-comp-[\w-]+):/gm),
      (match) => match[1],
    )

    expect(tokens.length).toBeGreaterThan(50)
    expect(tokens).toContain('--cpx-comp-dropdown-trigger-bg')
    expect(tokens).toContain('--cpx-comp-dropdown-menu-bg')
    expect(tokens).toContain('--cpx-comp-dropdown-item-hover-bg')
    expect(tokens).toContain('--cpx-comp-button-bg')
    expect(tokens).toContain('--cpx-comp-button-primary-bg')
    expect(tokens).toContain('--cpx-comp-input-bg')
    expect(tokens).toContain('--cpx-comp-input-border')
    expect(tokens).toContain('--cpx-comp-sidebar-bg')
    expect(tokens).toContain('--cpx-comp-dock-bg')
    expect(tokens).toContain('--cpx-comp-terminal-bg')
    expect(tokens).toContain('--cpx-comp-diff-inserted-line-bg')
  })

  test('maps Dropdown states and searchable gutters through shared contracts', async () => {
    const [tokens, popover, rows, select, searchablePopover, projectSwitcher, branchSwitcher] =
      await Promise.all([
        Bun.file(
          new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
        ).text(),
        Bun.file(new URL('../src/styles/popover.css', import.meta.url)).text(),
        Bun.file(new URL('../src/styles/components/interactive-row.css', import.meta.url)).text(),
        Bun.file(new URL('../src/components/ui/Select.tsx', import.meta.url)).text(),
        Bun.file(
          new URL('../src/components/ui/SearchablePopoverContent.tsx', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/features/session/composer/ProjectSwitcherPopover.tsx', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/features/session/composer/BranchSelectPopover.tsx', import.meta.url),
        ).text(),
      ])

    expectSourceContains(
      tokens,
      '--cpx-comp-dropdown-menu-border: var(--cpx-sys-color-border-default)',
    )
    expectSourceContains(tokens, '--cpx-comp-dropdown-item-pressed-bg: var(--cpx-sys-color-active)')
    expectSourceContains(popover, ".popover-surface[data-theme-component='dropdown-surface']")
    expectSourceContains(popover, '--cpx-comp-row-hover-bg: var(--cpx-comp-dropdown-item-hover-bg)')
    expectSourceContains(rows, '--cpx-comp-row-selected-bg, var(--cpx-sys-color-selected)')
    expectSourceContains(rows, '.popover-item[aria-selected="true"]')
    expectSourceContains(rows, '.settings-dropdown-item:has(.settings-dropdown-item-indicator)')
    expectSourceContains(rows, '.permission-select-item:has(.permission-select-item-indicator)')
    expectSourceContains(rows, '--cpx-comp-row-bg, transparent')
    expectSourceContains(rows, '--cpx-comp-row-hover-bg')
    expectSourceContains(rows, '--cpx-comp-row-pressed-bg')
    expectSourceContains(
      rows,
      '.settings-dropdown-item[data-state="checked"]:has(.settings-dropdown-item-indicator)',
    )
    expectSourceContains(
      rows,
      '.permission-select-item[data-state="checked"]:has(.permission-select-item-indicator)',
    )
    expectSourceContains(
      rows,
      '):where([data-highlighted]:not(:hover):not(:focus-visible):not(:active))',
    )
    expectSourceContains(select, '<Dropdown.Root')
    expectSourceNotContains(select, 'activeIndex')
    expectSourceNotContains(select, 'data-state=')
    // The searchable gutter moved from popover.scss into the component it
    // belongs to; `tw:p-1` is the shared 4px menu surface padding.
    expectSourceContains(
      await Bun.file(new URL('../src/components/ui/floating/Dropdown.tsx', import.meta.url)).text(),
      'className="popover-search-region tw:flex-none tw:bg-transparent tw:p-1"',
    )
    expectSourceContains(searchablePopover, 'onSearchValueChange={onSearchChange}')
    expectSourceNotContains(searchablePopover, 'handleKeyDown')
    expectSourceNotContains(projectSwitcher, 'listClassName="popover-section"')
    expectSourceContains(branchSwitcher, 'listClassName="branch-popover-list-scroll"')
    expectSourceNotContains(branchSwitcher, 'branch-popover-list-scroll popover-section')
  })

  test('keeps the permission Select on shared rich-menu geometry', async () => {
    const [rows, composerControls] = await Promise.all([
      Bun.file(new URL('../src/styles/components/interactive-row.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/composer-controls.css', import.meta.url)).text(),
    ])

    expect(rows).toMatch(
      /\.interactive-row--rich,[\s\S]*?\.permission-select-item\s*\{[\s\S]*?--interactive-row-current-min-height:/,
    )
    expect(rows).toMatch(
      /\.permission-select-scroll-content\s*\{[\s\S]*?gap: var\(--cpx-comp-row-gap-y\);/,
    )
    expect(composerControls).not.toMatch(/\.permission-select-item-icon\s*\{[^}]*padding-right:/)
    expect(composerControls).not.toMatch(/\.permission-select-item-body\s*\{[^}]*padding-right:/)
  })

  test('keeps diff backgrounds separate from raw decoration colors', async () => {
    const stylesheet = await Bun.file(
      new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
    ).text()

    expectSourceContains(
      stylesheet,
      '--cpx-comp-diff-inserted-line-bg: var(--cpx-sys-color-diff-added-line)',
    )
    expectSourceContains(
      stylesheet,
      '--cpx-comp-diff-inserted-text-bg: var(--cpx-sys-color-diff-added-text)',
    )
    expectSourceContains(
      stylesheet,
      '--cpx-comp-diff-removed-line-bg: var(--cpx-sys-color-diff-removed-line)',
    )
    expectSourceContains(
      stylesheet,
      '--cpx-comp-diff-removed-text-bg: var(--cpx-sys-color-diff-removed-text)',
    )
  })

  test('does not reintroduce removed theme compatibility aliases', async () => {
    const sources = await Promise.all(
      ['../src/features/theme/ThemeVariables.ts', '../src/styles/design-system/tokens.css'].map(
        (path) => Bun.file(new URL(path, import.meta.url)).text(),
      ),
    )
    const removedAliasPattern =
      /--(?:color-bg(?:-[\w-]+)?|surface-[\w-]+|state-[\w-]+|border-(?:subtle|muted|control|strong)|color-text(?:-(?:strong|meta|soft|mute|muted|placeholder|disabled|on-accent))?)(?=['"]?\s*:)/

    for (const source of sources) {
      expect(source.match(removedAliasPattern)).toBeNull()
    }
  })

  test('keeps primary/secondary buttons distinct and settings rows height-free', async () => {
    const [buttons, settings, settingsRow, tokens] = await Promise.all([
      Bun.file(new URL('../src/components/ui/Button.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/settings.css', import.meta.url)).text(),
      Bun.file(new URL('../src/features/settings/SettingsRow.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
      ).text(),
    ])

    // primary：foreground 实底、反色文字；secondary：5% 弱背景、透明边框。
    expectSourceContains(
      buttons,
      'tw:border-app-border-strong tw:bg-app-primary-action tw:text-app-primary-action-foreground',
    )
    expectSourceContains(tokens, '--cpx-comp-button-primary-bg: var(--cpx-sys-color-fg-primary);')
    expectSourceContains(
      tokens,
      '--cpx-comp-button-primary-fg: var(--cpx-sys-color-surface-canvas);',
    )
    expectSourceContains(
      buttons,
      'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_5%,transparent)]',
    )
    expectSourceContains(buttons, 'tw:border-transparent tw:text-app-text')
    // 设置行不再锁死 64px：行本身不携带固定高度，高度由 12px 块级内边距
    // 驱动（compact 档 8px）；`+` 兄弟行的 0.5px 分隔线仍是共享几何。
    expect(settings).not.toMatch(/\.settings-row\s*\{[\s\S]*?min-height: 64px;/)
    expectSourceContains(settingsRow, "size === 'compact' ? 'tw:py-2' : 'tw:py-3'")
    expect(settingsRow).not.toMatch(/tw:(?:h|min-h)-/)
    expect(settings).toMatch(/\.settings-row \+ \.settings-row[\s\S]*?height: 0\.5px;/)
  })

  test('keeps settings navigation and responsive rows on one alignment contract', async () => {
    const [sidebar, settings, navigation] = await Promise.all([
      Bun.file(new URL('../src/styles/primitives/sidebar.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/settings.css', import.meta.url)).text(),
      Bun.file(new URL('../src/features/settings/SettingsNav.tsx', import.meta.url)).text(),
    ])

    // 设置导航与侧栏共用 8px 内边距契约：导航滚动区从该共享变量取
    // padding-inline，不再有独立的 settings-nav gutter 变量。
    expectSourceContains(sidebar, '--sidebar-inline-gutter: var(--cpx-sys-space-2);')
    expect(sidebar).toMatch(
      /\.settings-nav-scroll-content\s*\{[\s\S]*?padding-inline: var\(--sidebar-inline-gutter\);/,
    )
    expect(settings).toMatch(
      /@container \(max-width: 42rem\)[\s\S]*?\.settings-management-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    )
    expect(settings).not.toMatch(/@media \(max-width: 900px\)[\s\S]*?\.settings-row\s*\{/)
    // `_settings-billing.scss` 已随迁移删除；用量页不再拥有行级样式，设置行的
    // 唯一几何来源是 `SettingsRow.tsx` + 共享分隔线。这里改为对合并后的
    // `primitives/settings.css` 做同一「不得新增裸行/控制区覆盖」检查。
    expect(settings).not.toMatch(/(?:^|[\r\n])\s*\.settings-row,\s*$/m)
    expect(settings).not.toMatch(/(?:^|[\r\n])\s*\.settings-row-control\s*\{/m)
    // 迁移后内边距/间距由 TSX utility 承担：导航滚动区 = space-2 内边距 +
    // space-4 分组间距（原 `--settings-nav-inline-gutter` 语义）。
    const navScrollClass =
      navigation.match(/contentClassName="(settings-nav-scroll-content [^"]*)"/)?.[1] ?? ''
    expect(navScrollClass).toContain('tw:px-2')
    expect(navScrollClass).toContain('tw:gap-4')
  })

  test('keeps provider and extension management on shared settings geometry', async () => {
    const [settings, providerCatalog, plugins, extensionRow, skillDialog, mcpDialog, pluginDialog] =
      await Promise.all([
        Bun.file(new URL('../src/styles/primitives/settings.css', import.meta.url)).text(),
        Bun.file(new URL('../src/features/models/ProviderCatalog.tsx', import.meta.url)).text(),
        Bun.file(
          new URL('../src/features/settings/plugins/PluginsSettingsPage.tsx', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/features/settings/plugins/ExtensionManagementRow.tsx', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/features/settings/plugins/SkillDetailsDialog.tsx', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/features/settings/plugins/McpEditorDialog.tsx', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/features/plugins/PluginDetailsDialog.tsx', import.meta.url),
        ).text(),
      ])

    expectSourceContains(settings, '.settings-management-list')
    expectSourceContains(settings, '.settings-management-dialog-row')
    expectSourceNotContains(providerCatalog, 'settings-management-list')
    expectSourceContains(providerCatalog, 'model-center-catalog-list')
    expectSourceContains(extensionRow, 'settings-management-row')
    // 供应商目录按平铺网格展示，不再包裹大卡片管理列表外框。
    expectSourceNotContains(providerCatalog, 'repeat(auto-fill')
    expectSourceContains(plugins, 'settings-content-inner plugins-settings-content')
    expect(plugins).not.toMatch(/tw:(?:max-w-\[60rem\]|px-8|py-16)/)
    for (const dialog of [skillDialog, mcpDialog]) {
      expectSourceNotContains(dialog, 'tw:rounded-3xl')
      expect(dialog).not.toMatch(/Dialog\.Content[\s\S]{0,300}permission-modal(?:\s|")/)
    }
    // `.plugin-details-dialog` 复用共享弹窗表面（`ui-dialog-surface` /
    // `settings-management-dialog`）：自身的 utility 列表不得出现边框、背景、
    // 圆角或阴影，等价于原 marketplace.scss 的规则块检查。
    const pluginDialogSurface =
      pluginDialog.match(/settings-management-dialog plugin-details-dialog ([^'"\n]*)/)?.[1] ?? ''
    expect(pluginDialogSurface.length).toBeGreaterThan(0)
    expect(pluginDialogSurface).not.toMatch(/tw:(?:border(?:-|\s|$)|rounded|shadow|bg-)/)
  })

  test('keeps primary routes and workbench panels on their shared alignment axes', async () => {
    const [automationView, pets, pullRequests, setup, review, browser, primaryPageCss] = await Promise.all([
      Bun.file(new URL('../src/features/automation/AutomationView.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/features/pet/PetCatalogPage.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/pull-requests/PullRequestsPlaceholder.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/features/models/setup/ModelSetupPage.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/review/workspace/WorkspaceReviewSidebar.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/features/browser/DesktopBrowserPanel.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/primary-page.css', import.meta.url)).text(),
    ])

    // 自动化页只通过共享 PrimaryPageLayout 渲染，不再覆盖其内部结构类名。
    expectSourceContains(automationView, '<PrimaryPageLayout')
    expect(automationView).not.toMatch(/primary-page-layout__(?:header|body)/)
    expectSourceContains(pets, '<PrimaryPageLayout')
    expectSourceContains(pullRequests, '<PrimaryPageLayout')
    expectSourceContains(primaryPageCss, 'padding-bottom: var(--cpx-sys-space-8);')
    // 模型引导页的两行网格改由 TSX utility 承担（原 `_model-setup.scss` 规则）。
    expectSourceContains(setup, 'tw:grid-rows-[36px_minmax(0,1fr)]')
    expectSourceContains(review, 'tw:px-4 tw:py-4 tw:type-control')
    // 状态行保留语义类名与 alert 角色，迁移只在其上追加 utility。
    expect(browser).toMatch(/className="browser-status-row[^"]*"[\s\S]*?role="alert"/)
  })

  test('keeps prominent elevation distinct from flat and transient surfaces', async () => {
    const [systemTokens, componentTokens, cards, composer, summary, rightDock] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/tokens.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/components/card.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/composer-shell.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/session.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/layout-right-dock.css', import.meta.url)).text(),
    ])

    expect(systemTokens.match(/--cpx-sys-shadow-prominent:/g)).toHaveLength(1)
    expectSourceContains(
      systemTokens,
      '--cpx-sys-shadow-raised: inset 0 1px 0 rgba(255, 255, 255, 0.7);',
    )
    expectSourceContains(
      componentTokens,
      '--cpx-comp-composer-shadow: var(--cpx-sys-shadow-prominent);',
    )
    expect(cards).toMatch(/\.composer\s*\{[\s\S]*?box-shadow: var\(--cpx-comp-composer-shadow\);/)
    expectSourceNotContains(composer, 'box-shadow: var(--cpx-sys-shadow-floating)')
    expect(summary).toMatch(
      /\.thread-summary-panel\s*\{[\s\S]*?box-shadow: var\(--cpx-sys-shadow-prominent\);/,
    )
    expect(summary).toMatch(
      /\.thread-summary-popover \.thread-summary-panel,[\s\S]*?box-shadow: none;/,
    )
    expectSourceNotContains(rightDock, '--cpx-sys-shadow-prominent')
  })

  test('keeps high-frequency motion immediate and CSS/Motion timings aligned', async () => {
    const [systemTokens, motionTransitions] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/tokens.css', import.meta.url)).text(),
      Bun.file(new URL('../src/features/motion/MotionTransitions.ts', import.meta.url)).text(),
    ])

    for (const [role, duration] of [
      ['instant', '0ms'],
      ['feedback', '160ms'],
      ['exit', '160ms'],
      ['state', '160ms'],
      ['enter', '160ms'],
      ['panel', '220ms'],
      ['loading', '900ms'],
    ]) {
      expectSourceContains(systemTokens, `--cpx-sys-motion-${role}: ${duration};`)
    }

    expectSourceContains(motionTransitions, 'duration: 0.16,')
    expect(motionTransitions.match(/duration: 0\.16,/g)).toHaveLength(4)
    expectSourceContains(motionTransitions, 'duration: 0.22,')
    expectSourceContains(motionTransitions, "duration: 0.9,\n  ease: 'linear'")
  })

  test('keeps the radius scale optical correction and roles canonical', async () => {
    const [
      systemTokens,
      componentTokens,
      tailwind,
      buttons,
      composer,
      conversation,
      summary,
      cards,
      rightDock,
    ] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/tokens.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/tailwind.css', import.meta.url)).text(),
      Bun.file(new URL('../src/components/ui/Button.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/composer-shell.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/conversation.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/session.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/components/card.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/layout-right-dock.css', import.meta.url)).text(),
    ])

    expect(systemTokens.match(/--cpx-sys-radius-optical-scale:/g)).toHaveLength(1)
    expect(systemTokens.match(/--cpx-sys-corner-shape:/g)).toHaveLength(1)
    expectSourceContains(systemTokens, '--cpx-sys-radius-optical-scale: 1;')
    expectSourceNotContains(systemTokens, '--cpx-sys-radius-optical-scale: 1.25;')
    expectSourceContains(systemTokens, '--cpx-sys-corner-shape: round;')
    expectSourceNotContains(systemTokens, '--cpx-sys-corner-shape: superellipse(1.5);')
    const expectedSizes: Record<string, string> = {
      '2xs': '5px',
      xs: '5px',
      sm: '8px',
      md: '10px',
      lg: '14px',
      xl: '18px',
      '2xl': '18px',
      '3xl': '24px',
      '4xl': '24px',
      full: '9999px',
    }
    for (const [size, value] of Object.entries(expectedSizes)) {
      expect(systemTokens.match(new RegExp(`--cpx-sys-radius-${size}:`, 'g'))).toHaveLength(1)
      expectSourceContains(systemTokens, `--cpx-sys-radius-${size}: ${value};`)
    }
    for (const [role, size] of [
      ['indicator', 'xs'],
      ['compact', 'xs'],
      ['control', 'md'],
      ['container', 'lg'],
      ['floating', 'lg'],
      ['prominent', 'xl'],
      ['pill', 'full'],
    ]) {
      expect(systemTokens.match(new RegExp(`--cpx-sys-radius-${role}:`, 'g'))).toHaveLength(1)
      expectSourceContains(systemTokens, `--cpx-sys-radius-${role}: var(--cpx-sys-radius-${size});`)
    }
    for (const size of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'full']) {
      expectSourceContains(tailwind, `--radius-${size}: var(--cpx-sys-radius-${size});`)
    }
    expectSourceNotContains(tailwind, 'corner-shape: var(--cpx-sys-corner-shape);')
    expectSourceContains(
      componentTokens,
      '--cpx-comp-modal-radius: var(--cpx-sys-radius-prominent);',
    )
    expectSourceContains(
      componentTokens,
      '--cpx-comp-sidebar-item-radius: var(--cpx-sys-radius-item);',
    )

    // 圆角由语义角色 utility 表达，不再使用按档位缩放的局部变量。
    expectSourceNotContains(buttons, '--button-radius-scale')
    expect(buttons).toMatch(/tw:rounded-(?:lg|md|2xl|full)/)
    expectSourceNotContains(buttons, '@supports (corner-shape: superellipse(1.5))')
    expectSourceContains(composer, '--composer-radius: var(--cpx-sys-radius-prominent);')
    expect(composer).toMatch(
      /\.composer-stack\[data-composer-layout=['"]single-line['"]\]\[data-composer-radius-variant=['"]default['"]\]\s*\{\s*--composer-radius: var\(--cpx-sys-radius-pill\);/,
    )
    expect(composer).toMatch(
      /\.composer-stack\[data-composer-radius-variant=['"]single-line['"]\]\s*\{\s*--composer-radius: var\(--cpx-sys-radius-prominent\);/,
    )
    expect(composer).toMatch(
      /\.composer-stack\[data-composer-radius-variant=['"]compact['"]\]\s*\{\s*--composer-radius: var\(--cpx-sys-radius-container\);/,
    )
    expectSourceNotContains(composer, 'var(--cpx-sys-radius-optical-scale)')
    expect(composer).not.toMatch(
      /\.composer-stack\[data-placement=['"]new-session['"]\][^{]*\{[^}]*--composer-radius/,
    )
    expectSourceContains(
      composer,
      '.composer-stack .composer-editor-content',
    )
    expectSourceContains(
      composer,
      '.composer-stack[data-composer-utility-bar-variant="home"][data-surface="coding"]',
    )
    expectSourceContains(
      composer,
      '.composer-stack[data-composer-utility-bar-variant="home"][data-surface="working"]',
    )
    expectSourceContains(
      composer,
      '.composer-stack[data-composer-layout="multiline"][data-composer-radius-variant="default"]',
    )
    expectSourceNotContains(composer, 'calc(var(--cpx-sys-radius-xl) * 2)')
    expect(conversation.match(/border-radius: var\(--cpx-sys-radius-2xl\);/g)).toHaveLength(1)
    expectSourceContains(conversation, 'border-radius: var(--user-message-bubble-radius);')
    expectSourceNotContains(conversation, 'var(--cpx-sys-radius-optical-scale)')
    expectSourceContains(conversation, 'corner-shape: var(--cpx-sys-corner-shape);')
    expectSourceContains(summary, 'border-radius: var(--cpx-sys-radius-prominent);')
    expectSourceContains(summary, 'corner-shape: var(--cpx-sys-corner-shape);')
    expectSourceNotContains(cards, '--cpx-sys-radius-prominent')
    expectSourceNotContains(rightDock, '--cpx-sys-radius-prominent')
  })

  test('keeps user messages and compact summary popovers on dedicated semantics', async () => {
    const [systemTokens, conversation, summary, threadSummary] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/tokens.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/conversation.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/session.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/session/summary/ThreadSummaryPanel.tsx', import.meta.url),
      ).text(),
    ])

    expect(systemTokens.match(/--cpx-sys-color-message-user-bg:/g)).toHaveLength(1)
    expect(systemTokens).toMatch(
      /--cpx-sys-color-message-user-bg:\s*color-mix\(\s*in srgb,\s*var\(--cpx-sys-color-fg-primary\)\s*5%,\s*transparent\s*\)\s*;/,
    )
    expect(conversation.match(/--cpx-sys-color-message-user-bg/g)).toHaveLength(1)
    expectSourceContains(conversation, 'background: var(--cpx-sys-color-message-user-bg);')
    expectSourceNotContains(conversation, 'var(--cpx-sys-color-surface-panel) 78%')

    expect(summary.match(/--thread-summary-inline-width:/g)).toHaveLength(1)
    expect(summary).toMatch(
      /\.thread-summary-popover\s*\{[\s\S]*?--thread-summary-inline-width: calc\(var\(--cpx-sys-space-1\) \* 75\);/,
    )
    expect(threadSummary).toContain('thread-summary-popover tw:w-[var(--thread-summary-inline-width)]')
    expect(threadSummary).toContain('tw:[&]:p-0')
    expect(threadSummary).toContain('thread-summary-panel tw:w-full tw:flex tw:min-h-0 tw:flex-col tw:gap-1')
    expect(threadSummary).toContain('tw:overflow-y-auto tw:py-2')
    expect(threadSummary).toContain('tw:pb-2 tw:last:pb-0')
    expect(threadSummary).toContain('tw:max-w-[calc(100vw-24px)]')
    expect(threadSummary).not.toContain('thread-summary-inline tw:absolute')
    expect(conversation).not.toContain('--conversation-shift-offset')
  })

  test('keeps component tokens private to shared component styles', async () => {
    const [
      systemTokens,
      tokens,
      rightDock,
      sidebar,
      chrome,
      workbenchShell,
      workbenchLayout,
      tabStrip,
      dockFrame,
      panelSurface,
      modal,
      popover,
      tooltip,
    ] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/tokens.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/features/layout-right-dock.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/sidebar.css', import.meta.url)).text(),
      Bun.file(new URL('../src/features/layout/MenuBar.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/layout/shell/WorkbenchShellView.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/features/layout-workbench.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/layout/tabs/WorkbenchTabStrip.tsx', import.meta.url),
      ).text(),
      Bun.file(
        new URL('../src/features/layout/dock/WorkbenchDockFrame.tsx', import.meta.url),
      ).text(),
      Bun.file(
        new URL('../src/features/layout/panels/WorkbenchPanelSurface.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/modal.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/popover.css', import.meta.url)).text(),
      Bun.file(new URL('../src/components/ui/Tooltip.tsx', import.meta.url)).text(),
    ])

    // Window chrome and workspace regions stay independently addressable while
    // panels follow the workspace surface by default.
    expectSourceContains(
      systemTokens,
      '--cpx-sys-color-workbench-titlebar-bg: var(--cpx-sys-color-workbench-sidebar-bg);',
    )
    expectSourceContains(
      systemTokens,
      '--cpx-sys-color-workbench-sidebar-bg: var(--cpx-ref-gray-2);',
    )
    expectSourceContains(
      systemTokens,
      '--cpx-sys-color-workbench-main-bg: var(--cpx-sys-color-surface-canvas);',
    )
    expectSourceContains(
      systemTokens,
      '--cpx-sys-color-workbench-panel-bg: var(--cpx-sys-color-workbench-main-bg);',
    )
    expectSourceNotContains(
      systemTokens,
      '--cpx-sys-color-workbench-panel-bg: var(--cpx-sys-color-surface-recessed);',
    )

    // Verify token definitions in codex-semantic-tokens.css
    expectSourceContains(tokens, '--cpx-comp-dock-bg: var(--cpx-sys-color-workbench-panel-bg);')
    expectSourceContains(tokens, '--cpx-comp-dock-border: var(--cpx-sys-color-border-subtle);')
    expectSourceContains(
      tokens,
      '--cpx-comp-sidebar-bg: var(--cpx-sys-color-workbench-sidebar-bg);',
    )
    expectSourceContains(
      tokens,
      '--cpx-comp-workbench-panel-bg: var(--cpx-sys-color-workbench-panel-bg);',
    )
    expectSourceContains(
      tokens,
      '--cpx-comp-workbench-main-surface-bg: var(--cpx-sys-color-workbench-main-bg);',
    )
    expectSourceContains(tokens, '--cpx-comp-sidebar-border: 0;')
    expectSourceContains(tokens, '--cpx-comp-modal-bg: var(--cpx-sys-color-surface-raised);')
    expectSourceContains(
      tokens,
      '--cpx-comp-modal-border: 1px solid var(--cpx-sys-color-border-subtle);',
    )

    // Feature styles consume public system semantics instead of component aliases.
    expectSourceNotContains(rightDock, '--cpx-comp-dock-bg')
    expectSourceNotContains(rightDock, '--cpx-comp-dock-border')
    expectSourceNotContains(rightDock, '--cpx-comp-dock-tab-radius')
    expectSourceNotContains(sidebar, '--cpx-comp-sidebar-bg')
    expectSourceNotContains(sidebar, '--cpx-comp-sidebar-border')
    expectSourceNotContains(sidebar, '--cpx-comp-sidebar-item-active-bg')
    expectSourceNotContains(sidebar, 'sidebar-sticky-section-clip')
    expectSourceContains(rightDock, '--cpx-sys-color-workbench-panel-bg')
    // 标题栏与工作区表面已改用映射到同一系统语义的 utility：MenuBar 取
    // titlebar 表面，工作台主体取 main 表面并保留左侧分隔边框。
    expectSourceContains(chrome, 'tw:bg-app-titlebar')
    expectSourceContains(workbenchShell, 'tw:bg-app-main')
    expectSourceContains(workbenchShell, 'tw:border-l tw:border-app-border')
    expect(workbenchLayout).not.toMatch(/\.desktop-workspace-panel--bottom\s*\{[^}]*border-top:/)

    // Panel and toolbar borders moved out of the dock stylesheet into the
    // components that render them, still on public system semantics.
    expectSourceContains(tabStrip, 'tw:rounded-md')
    expectSourceContains(dockFrame, 'tw:border-l tw:border-app-border')
    expectSourceContains(dockFrame, 'tw:border-t tw:border-app-border')
    expectSourceContains(panelSurface, 'tw:border-b tw:border-app-border-subtle')
    expectSourceContains(modal, '--cpx-comp-modal-bg')
    expectSourceContains(modal, '--cpx-comp-modal-shadow')
    expectSourceContains(popover, '--cpx-comp-dropdown-menu-bg')
    // Tooltip 表面迁到组件 utility，仍消费 `--cpx-comp-tooltip-*` 对应的
    // raised 表面与 floating 阴影。
    expectSourceContains(tooltip, 'tw:bg-app-raised')
    expectSourceContains(tooltip, 'tw:shadow-lg')
  })
})

describe('UI-Design native floating behavior', () => {
  test('action definitions render the selected check in the trailing cell', () => {
    const html = renderToStaticMarkup(
      createElement(
        Dropdown.Root,
        { mode: 'menu' },
        createElement(DropdownActions, {
          actions: [
            { kind: 'item', label: '手动排序', checked: true, onSelect: () => {} },
            { kind: 'item', label: '最近更新', checked: false, onSelect: () => {} },
          ],
        }),
      ),
    )
    expect(html.match(/\bpopover-item-check\b/g)).toHaveLength(1)
    expect(html).toMatch(/popover-item-trailing[^>]*>\s*<svg/)
  })
  test('search fills the available frame width at every preset without intrinsic sizing', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const html = renderToStaticMarkup(
        createElement(
          Dropdown.Root,
          { defaultOpen: true },
          createElement(
            Dropdown.Content,
            { size, showSearch: true },
            createElement(Dropdown.Item, { value: 'a' }, 'A'),
          ),
        ),
      )
      expect(html).toContain(`data-popover-size="${size}"`)
      expect(html).toContain('tw:w-full tw:max-w-full tw:box-border')
    }
  })
  test('action menus do not inherit the select list height cap', () => {
    const render = (mode: 'menu' | 'select') =>
      renderToStaticMarkup(
        createElement(
          Dropdown.Root,
          { mode, defaultOpen: true },
          createElement(Dropdown.Content, null, createElement(Dropdown.Item, { value: 'a' }, 'A')),
        ),
      )
    expect(render('menu')).not.toContain('tw:max-h-[220px]')
    expect(render('select')).toContain('tw:max-h-[220px]')
  })
  test('asChild delegates row layout instead of spreading native flex spacing into rich rows', () => {
    const html = renderToStaticMarkup(
      createElement(
        Dropdown.Root,
        { value: 'project' },
        createElement(
          Dropdown.Item,
          { value: 'project', asChild: true },
          createElement('div', { className: 'interactive-row popover-item' }, '项目'),
        ),
      ),
    )
    expect(html).toContain('interactive-row popover-item')
    expect(html).toContain('role="option"')
    expect(html).toContain('aria-selected="true"')
    expect(html).not.toContain('tw:justify-between')
    expect(html).not.toContain('tw:flex')
    expect(html).not.toContain('tw:px-2.5')
  })
  test('composer reasoning uses native selection menus; model panel keeps a flush frame', async () => {
    const reasoning = renderToStaticMarkup(
      createElement(ReasoningMenu, {
        trigger: createElement('button', null, '默认'),
        thinkingMode: 'default',
        thinkingOptions: [{ value: 'default', label: '默认' }],
        onThinkingChange: () => {},
      }),
    )
    expect(reasoning).toContain('aria-haspopup="listbox"')
    const model = await Bun.file(
      new URL('../src/features/session/composer/ModelPickerPopover.tsx', import.meta.url),
    ).text()
    expectSourceContains(model, 'style={{ padding: 0 }}')
  })
  test('portal action submenus own their layout and delegated popovers do not add padding', async () => {
    const [actions, popover, profile] = await Promise.all([
      Bun.file(new URL('../src/components/ui/DropdownActions.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/components/ui/floating/Popover.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/features/settings/ProfileSettings.tsx', import.meta.url)).text(),
    ])
    expect(actions).toContain('popover-surface popover popover-menu--grid tw:text-app-text')
    expect(popover).toContain("asChild ? '' : 'tw:p-3.5'")
    expect(profile).toContain('style={{ padding: 0 }}')
  })
  test('search filters text and descriptions, supports Chinese and clearing', () => {
    expect(matchesDropdownSearch('  FEAT ', 'feature/项目')).toBe(true)
    expect(matchesDropdownSearch('项目', 'feature/项目')).toBe(true)
    expect(matchesDropdownSearch('工作目录', '项目', '工作目录说明')).toBe(true)
    expect(matchesDropdownSearch('unknown', '项目', '工作目录说明')).toBe(false)
    expect(matchesDropdownSearch('', '项目')).toBe(true)
  })

  test('selection updates values; actions do not; cancelling keeps the menu open', () => {
    const calls: string[] = []
    selectMenuItem(
      () => calls.push('action'),
      () => calls.push('close'),
    )
    expect(calls).toEqual(['action', 'close'])
    calls.length = 0
    selectMenuItem(
      (event) => event.preventDefault(),
      () => calls.push('close'),
      () => calls.push('value'),
    )
    expect(calls).toEqual(['value'])
    calls.length = 0
    selectMenuItem(
      undefined,
      () => calls.push('close'),
      () => calls.push('value'),
    )
    expect(calls).toEqual(['value', 'close'])
  })

  test('native roles distinguish action menus, selects, disabled items and check/radio state', () => {
    const select = renderToStaticMarkup(
      createElement(
        Dropdown.Root,
        { disabled: true },
        createElement(Dropdown.Trigger, null, '选择'),
        createElement(Dropdown.Item, { value: 'a', disabled: true }, 'A'),
      ),
    )
    expect(select).toContain('aria-haspopup="listbox"')
    expect(select).toContain('role="option"')
    expect(select).toContain('aria-disabled="true"')
    const menu = renderToStaticMarkup(
      createElement(
        Dropdown.Root,
        { mode: 'menu' },
        createElement(Dropdown.Trigger, null, '动作'),
        createElement(Dropdown.Item, null, '执行'),
        createElement(
          ContextMenu.CheckboxItem,
          { checked: true },
          createElement(ContextMenu.ItemIndicator, null, '勾选'),
        ),
        createElement(
          ContextMenu.RadioGroup,
          { value: 'b' },
          createElement(
            ContextMenu.RadioItem,
            { value: 'a' },
            createElement(ContextMenu.ItemIndicator, null, '未选'),
          ),
          createElement(
            ContextMenu.RadioItem,
            { value: 'b' },
            createElement(ContextMenu.ItemIndicator, null, '单选'),
          ),
        ),
      ),
    )
    expect(menu).toContain('aria-haspopup="menu"')
    expect(menu).toContain('role="menuitem"')
    expect(menu).toContain('role="menuitemcheckbox" aria-checked="true"')
    expect(menu).toContain('勾选')
    expect(menu).toContain('单选')
    expect(menu).not.toContain('未选')
  })

  test('menu keyboard navigation excludes nested menus and leaves inputs and IME alone', () => {
    const previousDocument = globalThis.document
    const fakeDocument = { activeElement: null as unknown }
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
    try {
      let clicks = 0
      const surface = { querySelectorAll: () => [first, second, nested] }
      const item = (parent: unknown) => ({
        closest: () => parent,
        matches: () => false,
        getAttribute: () => 'menuitem',
        focus() {
          fakeDocument.activeElement = this
        },
        click() {
          clicks++
        },
      })
      const first = item(surface),
        second = item(surface),
        nested = item({})
      const key = (
        key: string,
        target: unknown = fakeDocument.activeElement ?? first,
        composing = false,
      ) => {
        let prevented = false
        menuKeyDown({
          key,
          target,
          currentTarget: surface,
          defaultPrevented: false,
          nativeEvent: { isComposing: composing, keyCode: 0 },
          preventDefault() {
            prevented = true
          },
        } as Parameters<typeof menuKeyDown>[0])
        return prevented
      }
      key('Home')
      expect(fakeDocument.activeElement).toBe(first)
      key('End')
      expect(fakeDocument.activeElement).toBe(second)
      key('ArrowDown')
      expect(fakeDocument.activeElement).toBe(first)
      key('ArrowUp')
      expect(fakeDocument.activeElement).toBe(second)
      key('Enter')
      key(' ')
      expect(clicks).toBe(2)
      expect(key('ArrowDown', second, true)).toBe(false)
      expect(key('ArrowDown', { matches: () => true })).toBe(false)
      expect(fakeDocument.activeElement).toBe(second)
    } finally {
      if (previousDocument === undefined) delete (globalThis as { document?: Document }).document
      else
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        })
    }
  })

  test('positions external anchors, flips vertically/horizontally and respects boundary padding', () => {
    const base = {
      anchorRect: { left: 700, right: 760, top: 550, bottom: 580, width: 60, height: 30 },
      contentWidth: 280,
      contentHeight: 200,
      viewportWidth: 800,
      viewportHeight: 600,
    }
    expect(computeFloatingPosition({ ...base, placement: 'bottom-end' })).toEqual({
      top: 344,
      left: 480,
      actualPlacement: 'top-end',
    })
    expect(computeFloatingPosition({ ...base, placement: 'right-start' })).toEqual({
      top: 392,
      left: 414,
      actualPlacement: 'left-start',
    })
    expect(
      computeFloatingPosition({ ...base, placement: 'bottom-start', avoidCollisions: false }),
    ).toEqual({ top: 586, left: 700, actualPlacement: 'bottom-start' })
    expect(
      computeFloatingPosition({
        ...base,
        placement: 'bottom-start',
        collisionPadding: { right: 20 },
      }).left,
    ).toBe(500)
  })

  test('native layered dismissal, controlled search and submenu focus stay in shared components', async () => {
    const [primitives, dropdown, menus, manifest, overlays] = await Promise.all([
      Bun.file(new URL('../src/components/ui/floating/Primitives.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/components/ui/floating/Dropdown.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/components/ui/floating/Menu.tsx', import.meta.url)).text(),
      Bun.file(new URL('../package.json', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/overlays.css', import.meta.url)).text(),
    ])
    expect(primitives).toContain('layers[layers.length - 1] !== layer')
    expect(primitives).toContain('handlers.current.additionalRefs.some')
    expect(primitives).toContain('event.isComposing || event.keyCode === 229')
    expect(primitives).toContain('onCloseAutoFocus')
    expect(primitives).toContain('element.showPopover()')
    expect(primitives).toContain('shieldedEscapes.has(event)')
    expect(primitives).toContain('event.defaultPrevented')
    expect(dropdown).toContain("useControllableState(searchValue, '', onSearchValueChange)")
    expect(dropdown).toContain('role="status"')
    expect(menus).toContain('next ? 120 : 140')
    expect(menus).toContain('sub.triggerRef.current?.focus()')
    expect(overlays).toContain(":root[data-reduce-motion='on']")
    for (const name of ['dropdown-menu', 'popover', 'context-menu', 'select', 'tooltip'])
      expect(manifest).not.toContain(`@radix-ui/react-${name}`)
  })
})
