import { describe, expect, test } from 'bun:test'
import { DEFAULT_DESKTOP_THEME_SETTINGS } from '../shared/Theme.js'
import {
  parseStartupThemeSeed,
  resolveStartupThemeSettings,
  STARTUP_THEME_QUERY_PARAM,
  withStartupThemeSeed,
} from '../src/startup/StartupThemeSeed.js'

function themedUrl(seed: unknown): string {
  const url = new URL('http://127.0.0.1:4210/?existing=kept#/new')
  url.searchParams.set(STARTUP_THEME_QUERY_PARAM, JSON.stringify(seed))
  return url.href
}

describe('startup theme seed', () => {
  test('seeds explicit dark settings before persisted settings resolve', () => {
    const url = themedUrl({
      version: 1,
      variant: 'dark',
      surface: '#121725',
      ink: '#f4f6ff',
    })

    expect(parseStartupThemeSeed(url)).toEqual({
      version: 1,
      variant: 'dark',
      surface: '#121725',
      ink: '#f4f6ff',
    })
    expect(resolveStartupThemeSettings(url)).toMatchObject({
      mode: 'dark',
      chromeThemes: {
        dark: { surface: '#121725', ink: '#f4f6ff' },
      },
    })
  })

  test('seeds explicit light settings when the system may be dark', () => {
    const settings = resolveStartupThemeSettings(
      themedUrl({
        version: 1,
        variant: 'light',
        surface: '#f5f4ef',
        ink: '#202124',
      }),
    )

    expect(settings.mode).toBe('light')
    expect(settings.chromeThemes.light).toMatchObject({
      surface: '#f5f4ef',
      ink: '#202124',
    })
  })

  test('ignores malformed, unsupported, and partially valid seeds', () => {
    const invalidUrls = [
      'http://127.0.0.1:4210/?cpx-startup-theme=%7Bbroken',
      themedUrl({
        version: 2,
        variant: 'dark',
        surface: '#121725',
        ink: '#f4f6ff',
      }),
      themedUrl({
        version: 1,
        variant: 'dark',
        surface: 'black',
        ink: '#f4f6ff',
      }),
    ]

    for (const url of invalidUrls) {
      expect(parseStartupThemeSeed(url)).toBeNull()
      expect(resolveStartupThemeSettings(url)).toEqual(DEFAULT_DESKTOP_THEME_SETTINGS)
    }
  })

  test('updates only the startup seed while preserving route and query state', () => {
    const updated = new URL(
      withStartupThemeSeed('http://127.0.0.1:4210/?existing=kept#/settings/appearance', {
        version: 1,
        variant: 'dark',
        surface: '#181818',
        ink: '#ffffff',
      }),
    )

    expect(updated.searchParams.get('existing')).toBe('kept')
    expect(updated.hash).toBe('#/settings/appearance')
    expect(JSON.parse(updated.searchParams.get(STARTUP_THEME_QUERY_PARAM) ?? 'null')).toMatchObject(
      { variant: 'dark', surface: '#181818' },
    )
  })

  test('loads the blocking bootstrap before the static splash styles', async () => {
    const [html, bootstrap] = await Promise.all([
      Bun.file(new URL('../index.html', import.meta.url)).text(),
      Bun.file(new URL('../public/startup-theme.js', import.meta.url)).text(),
    ])

    expect(html.indexOf('<script src="/startup-theme.js"></script>')).toBeLessThan(
      html.indexOf('<style>'),
    )
    expect(html).toContain('--startup-splash-background')
    expect(html).toContain('--cpx-sys-color-surface-canvas')
    expect(bootstrap).toContain(STARTUP_THEME_QUERY_PARAM)
    expect(bootstrap).toContain('root.dataset.theme = seed.variant')
    expect(bootstrap).toContain('meta[name="theme-color"]')
  })
})
