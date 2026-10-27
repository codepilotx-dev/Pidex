import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createContext } from 'react'
import { defaultDesktopSettings } from '../src/features/settings/SettingsStorage.js'
import {
  DesktopSettingsProvider,
  useDesktopRuntimeSettingsField,
  useDesktopSettingsField,
  type UseDesktopRuntimeSettingsResult,
  type UseDesktopSettingsResult,
} from '../src/features/settings/UseDesktopSettings.js'

describe('desktop settings provider', () => {
  test('preserves both context instances when the module is hot reloaded', async () => {
    const source = await Bun.file(
      new URL('../src/features/settings/UseDesktopSettings.ts', import.meta.url),
    ).text()
    const initialization = source.slice(
      source.indexOf('type DesktopSettingsHotData ='),
      source.indexOf('export function DesktopSettingsProvider('),
    )
    const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(
      initialization.replaceAll('import.meta.hot', 'hot') +
        '\nreturn [DesktopSettingsFieldStoreContext]',
    )
    const initialize = new Function('hot', 'createContext', script)
    const hot = { data: {} }
    const initial = initialize(hot, createContext)
    const reloaded = initialize(hot, createContext)
    expect(reloaded[0]).toBe(initial[0])
    const cold = initialize(undefined, createContext)
    expect(cold[0]).not.toBe(initial[0])
  })

  test.each(['read-write', 'read-only'] as const)(
    'shares settings and runtime state between consumers with %s access',
    (access) => {
      const settings: UseDesktopSettingsResult[] = []
      const runtime: UseDesktopRuntimeSettingsResult[] = []
      function Consumer() {
        settings.push(useDesktopSettingsField((state) => state))
        runtime.push(useDesktopRuntimeSettingsField((state) => state))
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
      useDesktopSettingsField((state) => state)
      return null
    }

    expect(() => renderToStaticMarkup(<Consumer />)).toThrow(
      'useDesktopSettings 必须在 DesktopSettingsProvider 内使用',
    )
  })

  test('requires a provider for runtime settings instead of creating fallback state', () => {
    function Consumer() {
      useDesktopRuntimeSettingsField((state) => state)
      return null
    }

    expect(() => renderToStaticMarkup(<Consumer />)).toThrow(
      'useDesktopSettings 必须在 DesktopSettingsProvider 内使用',
    )
  })
})
