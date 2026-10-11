import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchTabsState,
} from '../src/features/layout/dock/RightDockState.js'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BottomPanelToggleIcon,
  RightPanelToggleIcon,
  WorkspaceShellControls,
  resolveWorkspaceControlPresentation,
} from '../src/features/layout/dock/WorkspaceShellControls.js'

function renderControls(
  overrides: Partial<Parameters<typeof WorkspaceShellControls>[0]> = {},
): string {
  return renderToStaticMarkup(
    <WorkspaceShellControls
      onStepWorkspaceLayout={() => {}}
      onToggleTerminal={() => {}}
      showBottomPanel={true}
      showRightPanel={true}
      terminalAvailable={true}
      terminalVisible={false}
      workspaceLayout="chat"
      {...overrides}
    />,
  )
}

describe('WorkspaceShellControls', () => {
  test('renders both panel controls without a divider', () => {
    const html = renderControls()

    expect(html).toContain('workspace-shell-controls')
    expect(html).not.toContain('workspace-shell-controls__divider')
    expect(html).toContain('aria-label="打开底部面板 (Ctrl+`)"')
    expect(html).toContain('title="打开底部面板 (Ctrl+`)"')
    expect(html).toContain('aria-label="显示标签页 (Ctrl+Shift+B)"')
    expect(html).not.toContain('aria-label="进入完整视图"')
    expect(html).not.toContain('disabled=""')
  })

  test('empty workspace toggle reveals launcher without creating a browser tab', () => {
    let state = createDefaultWorkbenchTabsState()
    state = applyWorkbenchPanelAction(state, { type: 'setWorkspaceLayout', layout: 'chat' })
    const toggle = () => {
      state = applyWorkbenchPanelAction(state, { type: 'stepWorkspaceLayout' })
    }
    const element = WorkspaceShellControls({
      workspaceLayout: 'chat',
      terminalAvailable: false,
      terminalVisible: false,
      showBottomPanel: false,
      showRightPanel: true,
      onToggleTerminal: () => {},
      onStepWorkspaceLayout: toggle,
    }) as ReactElement<{ children: ReactElement<{ onClick: () => void; disabled?: boolean }>[] }>
    const control = element.props.children[1]!
    expect(control.props.onClick).toBe(toggle)
    expect(control.props.disabled).not.toBe(true)
    control.props.onClick()
    expect(state.right.open).toBe(true)
    expect(state.right.tabIds).toEqual([])
    expect(state.tabsById).toEqual({})
    expect(renderControls({ terminalAvailable: false, showBottomPanel: false })).not.toContain(
      'disabled=""',
    )
  })

  test('keeps tab entries hidden while the workspace shows the chat surface', () => {
    const html = renderControls({ workspaceLayout: 'chat' })

    expect(html).toContain('aria-label="显示标签页 (Ctrl+Shift+B)"')
    expect(html).toContain('aria-pressed="false"')
  })

  test('split view only offers hiding tabs', () => {
    const html = renderControls({ workspaceLayout: 'split' })

    expect(html).toContain('aria-label="隐藏标签页 (Ctrl+Shift+B)"')
    expect(html).toContain('title="隐藏标签页 (Ctrl+Shift+B)"')
    expect(html).not.toContain('aria-label="进入完整视图"')
    expect(html).toContain('aria-pressed="true"')
  })

  test('presentation helper stays in sync with the observable layout', () => {
    expect(resolveWorkspaceControlPresentation('chat')).toEqual({
      label: '显示标签页',
      pressed: false,
    })
    expect(resolveWorkspaceControlPresentation('split')).toEqual({
      label: '隐藏标签页',
      pressed: true,
    })
  })

  test('disables bottom panel toggle when terminal is unavailable', () => {
    const html = renderControls({ terminalAvailable: false })

    expect(html).toContain('disabled=""')
    expect(html).toContain('title="创建任务后可使用底部面板"')
  })

  test('returns null when neither panel is shown', () => {
    const html = renderControls({ showBottomPanel: false, showRightPanel: false })

    expect(html).toBe('')
  })
})

describe('Panel toggle icons', () => {
  test('BottomPanelToggleIcon renders expected path for open and closed states', () => {
    const openHtml = renderToStaticMarkup(<BottomPanelToggleIcon open={true} />)
    expect(openHtml).toContain('lucide-panel-bottom')
    expect(openHtml).toContain('data-open="true"')
    expect(openHtml).toContain('M3 15h18')

    const closedHtml = renderToStaticMarkup(<BottomPanelToggleIcon open={false} />)
    expect(closedHtml).toContain('data-open="false"')
  })

  test('RightPanelToggleIcon renders expected path for open and closed states', () => {
    const openHtml = renderToStaticMarkup(<RightPanelToggleIcon open={true} />)
    expect(openHtml).toContain('lucide-panel-right')
    expect(openHtml).toContain('data-open="true"')
    expect(openHtml).toContain('M15 3v18')

    const closedHtml = renderToStaticMarkup(<RightPanelToggleIcon open={false} />)
    expect(closedHtml).toContain('data-open="false"')
  })
})
