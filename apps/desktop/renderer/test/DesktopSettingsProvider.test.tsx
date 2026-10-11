import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultDesktopSettings } from '../src/features/settings/SettingsStorage.js'
import {
  DesktopSettingsProvider,
  useDesktopRuntimeSettings,
  useDesktopSettings,
  type UseDesktopRuntimeSettingsResult,
  type UseDesktopSettingsResult,
} from '../src/features/settings/UseDesktopSettings.js'

describe('desktop settings provider', () => {
  test.each(['read-write', 'read-only'] as const)(
    'shares settings and runtime state between consumers with %s access',
    (access) => {
      const settings: UseDesktopSettingsResult[] = []
      const runtime: UseDesktopRuntimeSettingsResult[] = []
      function Consumer() {
        settings.push(useDesktopSettings())
        runtime.push(useDesktopRuntimeSettings())
        return null
      }

      renderToStaticMarkup(
        <DesktopSettingsProvider access={access}>
          <Consumer />
          <Consumer />
        </DesktopSettingsProvider>,
      )

      expect(settings).toHaveLength(2)
      expect(runtime).toHaveLength(2)
      expect(settings[0]).toBe(settings[1])
      expect(runtime[0]).toBe(runtime[1])
      expect(settings[0].model).toBe(defaultDesktopSettings().model)
      expect(settings[0].sidebarShowScheduledSessions).toBe(true)
      expect(typeof settings[0].setSidebarShowScheduledSessions).toBe('function')
      expect(runtime[0].values.sidebarShowScheduledSessions).toBe(true)
      expect(runtime[0].values.model).toBe(settings[0].model)
      expect(runtime[0].values.sidebarLayout).toBe('modern')
      expect(runtime[0].setModel).toBe(settings[0].setModel)
    },
  )

  test('requires a provider for desktop settings instead of creating fallback state', () => {
    function Consumer() {
      useDesktopSettings()
      return null
    }

    expect(() => renderToStaticMarkup(<Consumer />)).toThrow(
      'useDesktopSettings 必须在 DesktopSettingsProvider 内使用',
    )
  })

  test('requires a provider for runtime settings instead of creating fallback state', () => {
    function Consumer() {
      useDesktopRuntimeSettings()
      return null
    }

    expect(() => renderToStaticMarkup(<Consumer />)).toThrow(
      'useDesktopRuntimeSettings 必须在 DesktopSettingsProvider 内使用',
    )
  })
})
