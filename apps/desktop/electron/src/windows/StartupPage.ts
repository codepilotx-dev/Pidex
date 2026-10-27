import {
  deriveDesktopSurfaceUnder,
  type DesktopChromeTheme,
  type DesktopThemeSettingsV8,
} from '@pidex/shared/desktop-theme'
import type { DesktopStartupThemeSeed } from '@pidex/shared/desktop-appearance-ipc'

export type StartupStatusKind = 'progress' | 'terminal-error'

export interface StartupPageOptions {
  logoDataUrl: string
  variant: 'light' | 'dark'
  theme: Pick<DesktopChromeTheme, 'surface' | 'ink' | 'accent'> & {
    surfaceUnder: string
  }
}

export function deriveSurfaceUnder(
  surface: string,
  ink: string,
  dark: boolean,
  contrast = dark ? 60 : 40,
): string {
  return deriveDesktopSurfaceUnder(surface, ink, dark ? 'dark' : 'light', contrast)
}

export const RENDERER_STARTUP_THEME_QUERY_PARAM = 'cpx-startup-theme'

export function createRendererApplicationUrl(
  applicationOrigin: string,
  startupTheme: Omit<StartupPageOptions, 'logoDataUrl'>,
): string {
  const target = new URL(applicationOrigin)
  const seed: DesktopStartupThemeSeed = {
    version: 1,
    variant: startupTheme.variant,
    surface: startupTheme.theme.surface,
    ink: startupTheme.theme.ink,
  }
  target.searchParams.set(RENDERER_STARTUP_THEME_QUERY_PARAM, JSON.stringify(seed))
  return target.href
}

export function resolveStartupPageTheme(
  settings: DesktopThemeSettingsV8,
  systemVariant: 'light' | 'dark',
): Omit<StartupPageOptions, 'logoDataUrl'> {
  const variant = settings.mode === 'system' ? systemVariant : settings.mode
  const { surface, ink, accent, contrast } = settings.chromeThemes[variant]
  const dark = variant === 'dark'
  const surfaceUnder = deriveSurfaceUnder(surface, ink, dark, contrast)
  return {
    variant,
    theme: { surface, ink, accent, surfaceUnder },
  }
}
