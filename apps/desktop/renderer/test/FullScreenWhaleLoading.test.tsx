import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FullScreenWhaleLoading } from '../src/components/ui/FullScreenWhaleLoading.js'
import {
  resolveModelSetupLoadingLabel,
  SetupBootState,
} from '../src/features/models/setup/RequireConfiguredModel.js'

describe('FullScreenWhaleLoading', () => {
  test('renders the shared whale contract without a button spinner', () => {
    const html = renderToStaticMarkup(<FullScreenWhaleLoading label="正在读取模型配置…" />)

    expect(html).toContain('class="full-screen-whale-loader"')
    expect(html).toContain('data-full-screen-loading="true"')
    expect(html).toContain('data-loading-label="正在读取模型配置…"')
    expect(html).toContain('src="/pidex-mark-green.svg"')
    expect(html).toContain('full-screen-whale-loader__base')
    expect(html).toContain('full-screen-whale-loader__overlay')
    expect(html).toContain('full-screen-whale-loader__status-viewport')
    expect(html).not.toContain('ui-button-spinner')
  })

  test('exposes the status region semantics and hides decorative art', () => {
    const html = renderToStaticMarkup(<FullScreenWhaleLoading label="正在打开模型设置…" />)

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-atomic="true"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('正在打开模型设置…')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('alt=""')
  })

  test('SetupBootState delegates to the full-screen whale loader', () => {
    const html = renderToStaticMarkup(<SetupBootState label="正在读取桌面设置…" />)

    expect(html).toContain('data-full-screen-loading="true"')
    expect(html).toContain('data-loading-label="正在读取桌面设置…"')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('ui-button-spinner')
  })

  test('renders contained variant without fullscreen attribute and with contained class', () => {
    const html = renderToStaticMarkup(
      <FullScreenWhaleLoading label="正在加载会话内容…" variant="contained" />,
    )

    expect(html).toContain('class="full-screen-whale-loader full-screen-whale-loader--contained"')
    expect(html).not.toContain('data-full-screen-loading="true"')
    expect(html).toContain('data-loading-variant="contained"')
    expect(html).toContain('data-loading-label="正在加载会话内容…"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
  })

  test('resolves real-stage labels from provider and settings state', () => {
    expect(resolveModelSetupLoadingLabel(false, false)).toBe('正在读取模型配置…')
    expect(resolveModelSetupLoadingLabel(false, true)).toBe('正在读取模型配置…')
    expect(resolveModelSetupLoadingLabel(true, false)).toBe('正在读取桌面设置…')
    expect(resolveModelSetupLoadingLabel(true, true)).toBe('正在准备模型设置…')
  })
})
