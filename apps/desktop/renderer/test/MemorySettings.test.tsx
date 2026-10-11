import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemorySettings } from '../src/features/settings/MemorySettings.js'
import { SETTINGS_ITEMS } from '../src/features/settings/SettingsRegistry.js'
import { DesktopSettingsProvider } from '../src/features/settings/UseDesktopSettings.js'

function renderMemorySettings(workspacePath: string | null): string {
  return renderToStaticMarkup(
    <DesktopSettingsProvider>
      <MemorySettings workspacePath={workspacePath} />
    </DesktopSettingsProvider>,
  )
}

describe('memory settings workspace scope', () => {
  test('shows the current workspace in a disabled input', () => {
    const html = renderMemorySettings('  D:\\CodeProject\\Current  ')

    expect(html).toContain('aria-label="当前工作区"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('value="D:\\CodeProject\\Current"')
    expect(html).toContain('项目记忆按当前工作区隔离')
    expect(html).not.toContain('Agent data directory / project memory')
  })

  test('keeps the global toggle and disables project actions without a workspace', () => {
    const html = renderMemorySettings(null)

    expect(html).toContain('启用记忆')
    expect(html).toContain('placeholder="未打开工作区"')
    expect(html).toContain('请先打开工作区后管理项目记忆')
    expect(html).toContain('请先打开工作区后查看召回记录')
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4)
  })

  test('describes the workspace as the current read-only scope', () => {
    const memorySettings = SETTINGS_ITEMS.find((item) => item.routeId === 'memory')

    expect(memorySettings?.description).toBe('自动记忆、当前工作区和召回时间线')
    expect(memorySettings?.rows.find((row) => row.title === '工作区')?.description).toBe(
      '显示当前工作区，项目记忆按工作区隔离',
    )
    expect(
      memorySettings?.rows.some((row) => row.description.includes('选择记忆所属的工作区')),
    ).toBeFalse()
  })
})
