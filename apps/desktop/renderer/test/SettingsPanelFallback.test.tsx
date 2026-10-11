import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsPage } from '../src/features/settings/SettingsPage.js'
import { SettingsPanelFallback } from '../src/features/settings/SettingsPanelFallback.js'

describe('SettingsPanelFallback', () => {
  test('renders the pending section label above a skeleton card', () => {
    const html = renderToStaticMarkup(<SettingsPanelFallback label="常规" />)

    expect(html).toContain('settings-page-title')
    expect(html).toContain('常规')
    expect(html).toContain('ui-skeleton-region')
    expect(html).toContain('settings-card')
    expect(html).toContain('ui-skeleton-block')
  })

  test('stays silent and busy when the section label is not resolved yet', () => {
    const html = renderToStaticMarkup(<SettingsPanelFallback />)

    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('settings-page-title')
  })
})

describe('SettingsPage lazy panels', () => {
  test('suspends with the general section title while the resolved panel chunk loads', () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        activeTab="does-not-exist"
        workspacePath={null}
        onUseSkill={() => {}}
        onError={() => {}}
        onNotice={() => {}}
      />,
    )

    expect(html).toContain('常规')
    expect(html).toContain('ui-skeleton-region')
  })

  test('suspends with the requested section title for a registered tab', () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        activeTab="git"
        workspacePath={null}
        onUseSkill={() => {}}
        onError={() => {}}
        onNotice={() => {}}
      />,
    )

    expect(html).toContain('Git')
  })
})
