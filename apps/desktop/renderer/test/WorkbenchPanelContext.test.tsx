import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import type { WorkbenchTabRenderContext } from '../src/features/layout/tabs/WorkbenchTabRegistry.js'

if (process.env.PIDEX_PANEL_CONTEXT_TEST === '1') {
  let captured: WorkbenchTabRenderContext | undefined
  mock.module('../src/features/layout/tabs/WorkbenchTabRegistry.js', () => ({
    getWorkbenchTabDefinition: () => ({
      render: (_tab: unknown, context: WorkbenchTabRenderContext) => {
        captured = context
        return null
      },
    }),
    getWorkbenchLauncherDefinitions: () => [],
    createLauncherTab: () => null,
    getWorkbenchLauncherPresentation: () => null,
  }))
  mock.module('../src/features/layout/tabs/WorkbenchTabStrip.js', () => ({
    WorkbenchTabStrip: () => null,
    workbenchTabDomId: (id: string) => id,
  }))
  const { WorkbenchPanel } = await import('../src/features/layout/dock/RightDock.js')
  test('panels inherit shared context and retain local actions', () => {
    const noop = () => {}
    const goal = { goal: null, onSaveGoal: async () => {} }
    const plan = { onOpenPlan: noop }
    const browser = { marker: 'browser' }
    const shared = {
      goal,
      plan,
      browser,
      review: {
        onToggleReviewView: noop,
        onClose: () => {
          throw new Error('shared close')
        },
      },
      files: { marker: 'files' },
      sideChat: { available: true, activeTabId: null },
      terminal: { marker: 'terminal' },
    } as unknown as WorkbenchTabRenderContext
    for (const target of ['right', 'bottom'] as const) {
      const events: unknown[] = []
      const props = {
        panelContext: shared,
        target,
        state: { open: true, activeTabId: 'goal', tabIds: ['goal'] },
        tabsById: { goal: { id: 'goal', kind: 'goal' } },
        sessionId: 'thread',
        width: 400,
        height: 300,
        minWidth: 200,
        maxWidth: 800,
        onClose: () => events.push('close'),
        onOpenReviewFile: (path: string) => events.push(path),
        onFileLoadError: (event: unknown) => events.push(event),
        onOpenFileFromBrowser: noop,
        onPreviewFile: noop,
        onOpenTab: noop,
        onPinTab: noop,
        onRecreateSideChat: () => events.push('recreate'),
      } as unknown as ComponentProps<typeof WorkbenchPanel>
      renderToStaticMarkup(<WorkbenchPanel {...props} />)
      expect(captured?.goal).toBe(goal)
      expect(captured?.plan).toBe(plan)
      expect(captured?.browser).toBe(browser)
      expect(captured?.files).toMatchObject({ marker: 'files' })
      expect(captured?.terminal).toMatchObject({ marker: 'terminal' })
      expect(captured?.sideChat.activeTabId).toBe('goal')
      captured!.review.onClose()
      captured!.review.onOpenReviewFile?.('file.ts')
      captured!.sideChat.onRecreate({ id: 'chat', kind: 'side-chat', threadId: 'child' } as never)
      captured!.files.onLoadError?.({ id: 'file' } as never, new Error('load'), 'load' as never)
      expect(events.slice(0, 3)).toEqual(['close', 'file.ts', 'recreate'])
      expect(events[3]).toMatchObject({ target })
    }
  })
} else {
  test('shared panel context regression runs with isolated registry mocks', () => {
    const result = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, PIDEX_PANEL_CONTEXT_TEST: '1' },
    })
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0)
  })
}
