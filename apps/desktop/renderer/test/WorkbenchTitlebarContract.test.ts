import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

const rendererRoot = resolve(import.meta.dir, '..')

function readRendererFile(path: string): string {
  return readFileSync(resolve(rendererRoot, path), 'utf8')
}

describe('workbench chrome contract', () => {
  test('keeps the renderer title bar at a deterministic logical height', () => {
    const shell = readRendererFile('src/features/layout/shell/WorkbenchShellView.tsx')
    const menuBar = readRendererFile('src/features/layout/MenuBar.tsx')
    const tokens = readRendererFile('src/styles/design-system/tokens.css')
    const tailwind = readRendererFile('src/styles/tailwind.css')

    // 36px 菜单栏高度来自 --chrome-h，经 tw:h-chrome 作用到菜单栏与其标题栏。
    expectSourceContains(tokens, '--chrome-h: 36px')
    expectSourceContains(tailwind, '--height-chrome: var(--chrome-h)')
    expectSourceContains(shell, 'desktop-menubar tw:h-chrome tw:shrink-0 tw:bg-app-titlebar')
    expectSourceContains(menuBar, 'menubar-titlebar tw:flex tw:h-chrome')
    expectSourceNotContains(shell, 'updateTitleBarOverlay')
    expectSourceNotContains(shell, 'getBoundingClientRect().height')
    expectSourceContains(tokens, '--application-menubar-height: 36px')
    expectSourceNotContains(tokens, 'env(titlebar-area-height')
  })

  test('keeps application chrome separate from the workspace toolbar', () => {
    const menuBar = readRendererFile('src/features/layout/MenuBar.tsx')
    const auxiliaryTitlebar = readRendererFile(
      'src/features/layout/auxiliary/AuxiliaryTitlebar.tsx',
    )
    const workspaceHeader = readRendererFile(
      'src/features/layout/workspace-header/DesktopWorkspaceHeader.tsx',
    )
    const tailwind = readRendererFile('src/styles/tailwind.css')
    const layout = readRendererFile('src/features/layout/shell/DesktopLayout.tsx')

    // 标题栏底色只由 titlebar surface 提供；工作区工具栏继续使用 workspace 高度变量。
    expectSourceContains(
      tailwind,
      '--color-app-titlebar: var(--cpx-sys-color-workbench-titlebar-bg);',
    )
    expectSourceContains(tailwind, '--height-toolbar: var(--workspace-toolbar-height);')
    expectSourceContains(menuBar, 'menubar-titlebar tw:flex tw:h-chrome')
    expectSourceContains(auxiliaryTitlebar, 'auxiliary-titlebar tw:flex tw:h-chrome')
    expectSourceContains(workspaceHeader, 'tw:h-[var(--workspace-header-height)]')
    expectSourceContains(workspaceHeader, 'tw:absolute')
    expectSourceContains(workspaceHeader, 'tw:before:bg-transparent')
    expectSourceContains(workspaceHeader, 'tw:data-[divider]:before:border-app-border-subtle')
    expectSourceNotContains(workspaceHeader, 'workbench-titlebar-bg')
    expectSourceContains(layout, '<DesktopWorkspaceHeader')
    expectSourceContains(layout, 'desktop-main-route__header-spacer')
  })

  test('keeps route content out of the application menu bar', () => {
    const menuBar = readRendererFile('src/features/layout/MenuBar.tsx')
    const windowControlsIndex = menuBar.indexOf('<WindowControls')

    expectSourceNotContains(menuBar, 'workspaceHeader')
    expectSourceNotContains(menuBar, 'menubar-workspace-header')
    expect(windowControlsIndex).toBeGreaterThan(menuBar.indexOf('</Menubar.Root>'))
    for (const label of ['文件', '编辑', '查看', '窗口', '帮助']) {
      expectSourceContains(menuBar, `label="${label}"`)
    }
  })

  test('keeps high-frequency edit and settings drafts out of the workbench shell', () => {
    const layout = readRendererFile('src/features/layout/shell/DesktopLayout.tsx')
    const menuBar = readRendererFile('src/features/layout/MenuBar.tsx')

    expectSourceContains(layout, 'useDesktopRuntimeSettings()')
    expectSourceNotContains(layout, 'useDesktopSettings()')
    expectSourceNotContains(layout, 'useEditCommands()')
    expectSourceContains(menuBar, 'useEditCommands()')
  })
})

describe('workbench resize commit contract', () => {
  test('commits panel ratios synchronously without layout-state feedback', () => {
    const controller = readRendererFile('src/features/layout/shell/UseWorkbenchShellController.ts')
    const desktopLayout = readRendererFile('src/features/layout/UseDesktopLayout.ts')

    expectSourceNotContains(controller, 'startTransition')
    expectSourceContains(controller, 'commitRightDockRangeRatio(rightDockWidthToRangeRatio(')
    expectSourceContains(controller, 'setRightDockWidthRatio(legacyRatio)')
    expectSourceContains(controller, 'setBottomPanelHeightRatio(nextRatio)')
    expectSourceContains(controller, 'rightPanelLiveResizeRef.current.previewSize(')
    expectSourceContains(controller, 'bottomPanelLiveResizeRef.current.previewSize(')
    expectSourceContains(controller, 'settleTimerRef.current = setTimeout(')
    // 原生缩放状态由 resizeActivityCoordinator 统一维护（按窗口 + revision +
    // 看门狗），不再是易失布尔 ref；旧版 Electron 的布尔信号在入口处合成事件。
    expectSourceNotContains(controller, 'nativeResizeActiveRef')
    expectSourceContains(controller, 'resizeActivityCoordinator.applyNativeActivity(activity)')
    expectSourceContains(controller, 'handleResizePhase(activity.phase)')
    expectSourceContains(controller, 'onWindowResizeStateChanged?.(resizing =>')
    expectSourceContains(controller, 'resizeActivityFromLegacy(resizing, legacyRevision)')
    expectSourceContains(
      controller,
      'if (!resizeActivityCoordinator.isResizing()) scheduleFallbackSettlement()',
    )
    expectSourceContains(controller, 'resizeActivityCoordinator.reset()')
    expectSourceContains(controller, 'NON_NATIVE_RESIZE_SETTLE_MS = 500')
    expectSourceContains(controller, 'rightPanelLiveResizeRef.current.previewSize(null)')
    expectSourceContains(controller, 'bottomPanelLiveResizeRef.current.previewSize(null)')
    expectSourceNotContains(desktopLayout, 'viewportWidth')
  })
})
