import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  claimDynamicModuleReload,
  isDynamicModuleLoadError,
  RouteErrorPageContent,
} from '../src/features/routing/RouteErrorPage.js'

describe('RouteErrorPage', () => {
  test('recognizes common dynamic module load errors', () => {
    const messages = [
      'Failed to fetch dynamically imported module: http://127.0.0.1/module.tsx',
      'error loading dynamically imported module: http://localhost/module.js',
      'Importing a module script failed.',
      'Load failed for module with source “http://localhost/module.js”.',
    ]

    for (const message of messages) {
      expect(isDynamicModuleLoadError(new TypeError(message))).toBe(true)
      expect(isDynamicModuleLoadError(message)).toBe(true)
    }
  })

  test('does not classify ordinary errors as dynamic module failures', () => {
    expect(isDynamicModuleLoadError(new Error('Request failed with status 500'))).toBe(false)
    expect(
      isDynamicModuleLoadError({
        message: 'Failed to fetch dynamically imported module',
      }),
    ).toBe(false)
    expect(isDynamicModuleLoadError(null)).toBe(false)
  })

  test('claims one automatic reload within the cooldown window', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const error = new TypeError(
      'Failed to fetch dynamically imported module: http://localhost/module.js',
    )

    expect(claimDynamicModuleReload(error, storage, 100_000)).toBe(true)
    expect([...values.values()]).toEqual(['100000'])
    expect(claimDynamicModuleReload(error, storage, 129_999)).toBe(false)
    expect(claimDynamicModuleReload(error, storage, 130_000)).toBe(true)
    expect([...values.values()]).toEqual(['130000'])
  })

  test('does not auto reload ordinary errors or when storage cannot persist', () => {
    const ordinaryError = new Error('Request failed with status 500')
    const dynamicError = new TypeError(
      'Failed to fetch dynamically imported module: http://localhost/module.js',
    )
    const unavailableStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable')
      },
    }

    expect(claimDynamicModuleReload(ordinaryError, unavailableStorage)).toBe(false)
    expect(claimDynamicModuleReload(dynamicError, unavailableStorage)).toBe(false)
    expect(claimDynamicModuleReload(dynamicError, undefined)).toBe(false)
  })

  test('renders a safe recovery action for dynamic module failures', () => {
    const sensitiveUrl = 'http://127.0.0.1:3808/src/features/private/SecretModule.tsx'
    const html = renderToStaticMarkup(
      <RouteErrorPageContent
        error={new TypeError(`Failed to fetch dynamically imported module: ${sensitiveUrl}`)}
      />,
    )

    expect(html).toContain('界面模块未加载完成')
    expect(html).toContain('应用可能正在更新，请重新加载后继续。')
    expect(html).toContain('<button')
    expect(html).toContain('重新加载')
    expect(html).not.toContain(sensitiveUrl)
    expect(html).not.toContain('SecretModule')
  })

  test('renders a safe generic message without exposing the error', () => {
    const sensitiveMessage = 'Unexpected failure at F:\\private\\workspace\\credentials.ts'
    const html = renderToStaticMarkup(<RouteErrorPageContent error={new Error(sensitiveMessage)} />)

    expect(html).toContain('页面暂时无法显示')
    expect(html).toContain('应用遇到临时问题，请重新加载后继续。')
    expect(html).toContain('重新加载')
    expect(html).not.toContain(sensitiveMessage)
    expect(html).not.toContain('credentials.ts')
  })
})
