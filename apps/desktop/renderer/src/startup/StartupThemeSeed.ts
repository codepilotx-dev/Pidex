import type { DesktopThemeSettings, DesktopThemeVariant } from '../../shared/Types.js'
import { DEFAULT_DESKTOP_THEME_SETTINGS } from '../../shared/Theme.js'

export const STARTUP_THEME_QUERY_PARAM = 'cpx-startup-theme'

export type StartupThemeSeed = {
  version: 1
  variant: DesktopThemeVariant
  surface: `#${string}`
  ink: `#${string}`
}

export function parseStartupThemeSeed(url: string): StartupThemeSeed | null {
  try {
    const raw = new URL(url).searchParams.get(STARTUP_THEME_QUERY_PARAM)
    if (!raw) return null
    const seed = JSON.parse(raw) as Partial<StartupThemeSeed> | null
    if (
      seed?.version !== 1 ||
      (seed.variant !== 'light' && seed.variant !== 'dark') ||
      !isHexColor(seed.surface) ||
      !isHexColor(seed.ink)
    )
      return null
    return seed as StartupThemeSeed
  } catch {
    return null
  }
}

export function resolveStartupThemeSettings(url: string): DesktopThemeSettings {
  const seed = parseStartupThemeSeed(url)
  if (!seed) return cloneDefaultSettings()
  return {
    ...cloneDefaultSettings(),
    mode: seed.variant,
    chromeThemes: {
      ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes,
      [seed.variant]: {
        ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes[seed.variant],
        fonts: {
          ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes[seed.variant].fonts,
        },
        semanticColors: {
          ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes[seed.variant].semanticColors,
        },
        surface: seed.surface,
        ink: seed.ink,
      },
    },
  }
}

export function withStartupThemeSeed(url: string, seed: StartupThemeSeed): string {
  const target = new URL(url)
  target.searchParams.set(STARTUP_THEME_QUERY_PARAM, JSON.stringify(seed))
  return target.href
}

function cloneDefaultSettings(): DesktopThemeSettings {
  return {
    ...DEFAULT_DESKTOP_THEME_SETTINGS,
    chromeThemes: {
      light: {
        ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.light,
        fonts: { ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.light.fonts },
        semanticColors: {
          ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.light.semanticColors,
        },
      },
      dark: {
        ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.dark,
        fonts: { ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.dark.fonts },
        semanticColors: {
          ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.dark.semanticColors,
        },
      },
    },
    codeThemeIds: { ...DEFAULT_DESKTOP_THEME_SETTINGS.codeThemeIds },
    fontSizes: { ...DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes },
  }
}

function isHexColor(value: unknown): value is `#${string}` {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}
