import type { ThemeRegistration } from 'shiki'
import {
  DEFAULT_CHROME_THEMES,
  getDesktopAccentPresetColor,
  type DesktopAccentPreset,
} from '@pidex/shared/desktop-theme'

import type { DesktopChromeTheme, DesktopThemeVariant } from '../../../shared/Types.js'
import { isHighlightThemeSlug, loadHighlightTheme } from '../../../shared/themes/Manifest.js'

type ThemeWithChrome = ThemeRegistration & {
  chromeTheme?: Partial<DesktopChromeTheme>
}

export type DesktopChromeThemeSeed = Pick<
  DesktopChromeTheme,
  'accent' | 'ink' | 'semanticColors' | 'surface'
> &
  Partial<Pick<DesktopChromeTheme, 'contrast' | 'fonts'>>

const ACCENT_KEYS = [
  'activityBarBadge.background',
  'textLink.foreground',
  'editorCursor.foreground',
  'focusBorder',
  'button.background',
  'activityBar.activeBorder',
] as const

const ADDED_KEYS = [
  'gitDecoration.addedResourceForeground',
  'gitDecoration.untrackedResourceForeground',
  'terminal.ansiGreen',
  'terminal.ansiBrightGreen',
] as const
const REMOVED_KEYS = [
  'gitDecoration.deletedResourceForeground',
  'terminal.ansiRed',
  'terminal.ansiBrightRed',
] as const
const SKILL_KEYS = ['charts.purple', 'terminal.ansiMagenta', 'terminal.ansiBrightMagenta'] as const

export async function loadChromeThemeSeed(
  slug: string,
  variant: DesktopThemeVariant,
): Promise<DesktopChromeThemeSeed> {
  if (!isHighlightThemeSlug(slug)) {
    throw new Error(`Unknown Codex highlight theme: ${slug}`)
  }
  return deriveChromeThemeSeed(await loadHighlightTheme(slug), variant)
}

export function deriveChromeThemeSeed(
  registration: ThemeRegistration,
  variant: DesktopThemeVariant,
): DesktopChromeThemeSeed {
  // Ported from Codex mtn/htn/gtn/vtn/btn (webview bundle byte 2,873,815).
  const theme = registration as ThemeWithChrome
  const defaults = DEFAULT_CHROME_THEMES[variant]
  const colors = asStringMap(theme.colors)
  const surface =
    firstColor(colors, [
      'editor.background',
      'sideBar.background',
      'editorGroupHeader.tabsBackground',
      'panel.background',
      'activityBar.background',
    ]) ?? defaults.surface
  const ink =
    firstColor(colors, [
      'editor.foreground',
      'sideBarTitle.foreground',
      'sideBar.foreground',
      'foreground',
    ]) ?? defaults.ink
  const accent = findAccent(theme, surface, ink) ?? defaults.accent
  const semanticColors = {
    diffAdded:
      firstColor(colors, ADDED_KEYS) ??
      findSemanticColor(theme, surface, ink, { min: 80, max: 170 }, 125) ??
      defaults.semanticColors.diffAdded,
    diffRemoved:
      firstColor(colors, REMOVED_KEYS) ??
      findSemanticColor(theme, surface, ink, { min: 345, max: 15 }, 0) ??
      defaults.semanticColors.diffRemoved,
    skill:
      firstColor(colors, SKILL_KEYS) ??
      findSemanticColor(theme, surface, ink, { min: 210, max: 320 }, 265) ??
      (!colorsAreSimilar(accent, surface) && !colorsAreSimilar(accent, ink)
        ? accent
        : defaults.semanticColors.skill),
  }

  return applyChromeOverride(
    {
      surface,
      ink,
      accent,
      semanticColors,
    },
    theme.chromeTheme,
  )
}

export function mergeChromeThemeSeed(
  current: DesktopChromeTheme,
  seed: DesktopChromeThemeSeed,
): DesktopChromeTheme {
  return {
    ...current,
    ...seed,
    accentPreset: 'custom',
    fonts: mergeSeedFonts(current.fonts, seed.fonts),
    semanticColors: {
      ...current.semanticColors,
      ...seed.semanticColors,
    },
  }
}

export function applyChromeThemeAccentPreset(
  current: DesktopChromeTheme,
  preset: DesktopAccentPreset,
  variant: DesktopThemeVariant,
  themeAccent?: DesktopChromeTheme['accent'],
): DesktopChromeTheme {
  if (preset === 'custom' && (current.accentPreset ?? 'custom') === 'custom') return current
  const accent = getDesktopAccentPresetColor(preset, variant) ?? themeAccent
  return accent ? { ...current, accent, accentPreset: preset } : current
}

function mergeSeedFonts(
  current: DesktopChromeTheme['fonts'],
  seed: DesktopChromeTheme['fonts'] | undefined,
): DesktopChromeTheme['fonts'] {
  if (seed == null) return current
  const familyChanged = (key: 'ui' | 'code'): boolean =>
    seed[key] !== undefined && seed[key] !== current[key]
  return {
    ...current,
    ...seed,
    // A family change without a matching face patch must drop the stale face
    // instead of applying e.g. a JetBrains Mono face to another family.
    uiFace:
      seed.uiFace !== undefined
        ? seed.uiFace
        : familyChanged('ui')
          ? null
          : (current.uiFace ?? null),
    codeFace:
      seed.codeFace !== undefined
        ? seed.codeFace
        : familyChanged('code')
          ? null
          : (current.codeFace ?? null),
  }
}

function applyChromeOverride(
  seed: DesktopChromeThemeSeed,
  override: Partial<DesktopChromeTheme> | undefined,
): DesktopChromeThemeSeed {
  if (!override) return seed
  return {
    ...seed,
    ...(normalizeHex(override.accent) && { accent: normalizeHex(override.accent)! }),
    ...(normalizeHex(override.surface) && {
      surface: normalizeHex(override.surface)!,
    }),
    ...(normalizeHex(override.ink) && { ink: normalizeHex(override.ink)! }),
    ...(typeof override.contrast === 'number' &&
      Number.isFinite(override.contrast) && {
        contrast: Math.min(100, Math.max(0, override.contrast)),
      }),
    ...(override.fonts && {
      fonts: {
        ui: normalizeFont(override.fonts.ui, null),
        code: normalizeFont(override.fonts.code, null),
      },
    }),
    semanticColors: {
      diffAdded: normalizeHex(override.semanticColors?.diffAdded) ?? seed.semanticColors.diffAdded,
      diffRemoved:
        normalizeHex(override.semanticColors?.diffRemoved) ?? seed.semanticColors.diffRemoved,
      skill: normalizeHex(override.semanticColors?.skill) ?? seed.semanticColors.skill,
    },
  }
}

function normalizeFont(value: unknown, fallback: string | null): string | null {
  if (value === null) return null
  return typeof value === 'string' ? value : fallback
}

function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function firstColor(
  colors: Record<string, string>,
  keys: readonly string[],
): `#${string}` | undefined {
  for (const key of keys) {
    const color = normalizeHex(colors[key])
    if (color) return color
  }
}

function findAccent(
  theme: ThemeRegistration,
  surface: `#${string}`,
  ink: `#${string}`,
): `#${string}` | undefined {
  const colors = asStringMap(theme.colors)
  for (const key of ACCENT_KEYS) {
    const color = normalizeHex(colors[key], {
      minimumAlpha: 0.45,
      minimumChromaticRange: 24,
    })
    if (color && !colorsAreSimilar(color, surface) && !colorsAreSimilar(color, ink)) {
      return color
    }
  }

  let result: `#${string}` | undefined
  let bestScore = -1
  for (const entry of themeEntries(theme)) {
    const color = normalizeHex(entry?.settings?.foreground, {
      minimumAlpha: 0.45,
      minimumChromaticRange: 24,
    })
    if (!color || colorsAreSimilar(color, surface) || colorsAreSimilar(color, ink)) {
      continue
    }
    const score = colorScore(color, surface, ink)
    if (score > bestScore) {
      result = color
      bestScore = score
    }
  }
  return result
}

function findSemanticColor(
  theme: ThemeRegistration,
  surface: `#${string}`,
  ink: `#${string}`,
  hueRange: { min: number; max: number },
  targetHue: number,
): `#${string}` | undefined {
  let result: `#${string}` | undefined
  let bestScore = -1
  for (const color of themeCandidateColors(theme)) {
    if (colorsAreSimilar(color, surface) || colorsAreSimilar(color, ink)) {
      continue
    }
    const hue = colorHue(parseColor(color)!)
    if (hue == null || !hueInRange(hue, hueRange)) continue
    const score = colorScore(color, surface, ink) - hueDistance(hue, targetHue) * 2
    if (score > bestScore) {
      result = color
      bestScore = score
    }
  }
  return result
}

function themeEntries(theme: ThemeRegistration) {
  return [
    ...(Array.isArray(theme.tokenColors) ? theme.tokenColors : []),
    ...(Array.isArray(theme.settings) ? theme.settings : []),
  ]
}

function themeCandidateColors(theme: ThemeRegistration): `#${string}`[] {
  const result = new Set<`#${string}`>()
  const values = [
    ...Object.values(asStringMap(theme.colors)),
    ...themeEntries(theme).map((entry) => entry?.settings?.foreground),
  ]
  for (const value of values) {
    const color = normalizeHex(value)
    if (color) result.add(color)
  }
  return [...result]
}

function normalizeHex(
  value: unknown,
  options: {
    minimumAlpha?: number
    minimumChromaticRange?: number
  } = {},
): `#${string}` | undefined {
  if (typeof value !== 'string') return
  const color = parseColor(value)
  if (!color) return
  const { minimumAlpha = 0.98, minimumChromaticRange = 0 } = options
  if (color.alpha < minimumAlpha || chromaticRange(color) < minimumChromaticRange) {
    return
  }
  return `#${[color.red, color.green, color.blue]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

function parseColor(value: string) {
  const color = value.trim()
  if (!/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color)) return
  return {
    alpha: color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) / 255 : 1,
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
  }
}

type ParsedColor = NonNullable<ReturnType<typeof parseColor>>

function colorsAreSimilar(left: string, right: string): boolean {
  const a = parseColor(left)
  const b = parseColor(right)
  return a != null && b != null && colorDistance(a, b) < 42
}

function colorDistance(left: ParsedColor, right: ParsedColor): number {
  return Math.sqrt(
    (left.red - right.red) ** 2 + (left.green - right.green) ** 2 + (left.blue - right.blue) ** 2,
  )
}

function chromaticRange(color: ParsedColor): number {
  return Math.max(color.red, color.green, color.blue) - Math.min(color.red, color.green, color.blue)
}

function colorScore(color: `#${string}`, surface: `#${string}`, ink: `#${string}`): number {
  const candidate = parseColor(color)
  const background = parseColor(surface)
  const foreground = parseColor(ink)
  if (!candidate || !background || !foreground) return 0
  return (
    chromaticRange(candidate) +
    colorDistance(candidate, background) / 4 +
    colorDistance(candidate, foreground) / 4
  )
}

function colorHue(color: ParsedColor): number | undefined {
  const red = color.red / 255
  const green = color.green / 255
  const blue = color.blue / 255
  const maximum = Math.max(red, green, blue)
  const delta = maximum - Math.min(red, green, blue)
  if (delta === 0) return
  const hue =
    maximum === red
      ? (((green - blue) / delta) % 6) * 60
      : maximum === green
        ? ((blue - red) / delta + 2) * 60
        : ((red - green) / delta + 4) * 60
  return (hue + 360) % 360
}

function hueInRange(hue: number, range: { min: number; max: number }): boolean {
  return range.min <= range.max
    ? hue >= range.min && hue <= range.max
    : hue >= range.min || hue <= range.max
}

function hueDistance(left: number, right: number): number {
  const distance = Math.abs(left - right)
  return Math.min(distance, 360 - distance)
}
