import React, { useEffect, useMemo, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { getDesktopAccentPresetColor, type DesktopAccentPreset } from '@pidex/shared/desktop-theme'

import { AnchoredPopover } from '../../components/ui/AnchoredPopover.js'
import { Input } from '../../components/ui/Input.js'
import { Button } from '../../components/ui/Button.js'
import { DisclosureController } from '../../components/ui/DisclosureController.js'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Select, type SelectOption } from '../../components/ui/Select.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import type {
  DesktopChromeTheme,
  DesktopDiffMarkerStyle,
  DesktopReviewDiffFile,
  DesktopThemeFontFace,
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from '../../../shared/Types.js'
import { defaultDesktopStoredSettings } from '../../../shared/SettingsSchema.js'
import {
  applySharedDesktopThemeFonts,
  resetAdvancedDesktopThemeSettings,
} from '../../../shared/Theme.js'
import { ReviewDiffReadOnlySplit } from '../review/diff/ReviewDiffSurface.js'
import { getThemesForVariant } from '../syntax/Theme.js'
import { useDesktopTheme } from '../theme/ThemeContext.js'
import {
  loadChromeThemeSeed,
  mergeChromeThemeSeed,
  applyChromeThemeAccentPreset,
} from '../theme/CodeThemeSeed.js'
import { deriveThemeVariables } from '../theme/ThemeVariables.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { ThemeFontPicker } from './ThemeFontPicker.js'
import { ThemePickerDropdown } from './ThemePickerDropdown.js'
import { useDesktopSettings } from './UseDesktopSettings.js'
import { useLocale } from '../i18n/LocaleProvider.js'

type Props = {
  onError?: (message: string) => void
}

type ThemeSettingsUpdater = (current: DesktopThemeSettings) => DesktopThemeSettings

const VARIANTS = ['light', 'dark'] as const
const DEFAULT_DIFF_MARKER_STYLE = defaultDesktopStoredSettings().diffMarkerStyle
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const ACCENT_PRESET_OPTIONS: Array<{ value: DesktopAccentPreset; label: string }> = [
  { value: 'default', label: '默认' },
  { value: 'blue', label: '蓝色' },
  { value: 'green', label: '绿色' },
  { value: 'yellow', label: '黄色' },
  { value: 'pink', label: '粉色' },
  { value: 'orange', label: '橙色' },
  { value: 'purple', label: '紫色' },
  { value: 'black', label: '黑色' },
  { value: 'custom', label: '自定义' },
]

function visualThemeSeedDelay(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const search = new URLSearchParams(window.location.search)
  if (!search.has('visualCase')) return Promise.resolve()
  const delay = Number.parseInt(search.get('visualThemeSeedDelayMs') ?? '', 10)
  if (!Number.isFinite(delay) || delay <= 0) return Promise.resolve()
  return new Promise((resolve) => window.setTimeout(resolve, Math.min(delay, 5_000)))
}

const THEME_MODE_OPTIONS: Array<{
  value: DesktopThemeMode
  label: string
}> = [
  { value: 'system', label: '系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

function NumberInput({
  ariaLabel,
  value,
  onChange,
  min,
  max,
}: {
  ariaLabel: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
}) {
  const [inputValue, setInputValue] = useState(String(value))

  useEffect(() => setInputValue(String(value)), [value])

  const commit = (): void => {
    const parsed = Number.parseInt(inputValue, 10)
    if (!Number.isFinite(parsed)) {
      setInputValue(String(value))
      return
    }
    const next = Math.min(max, Math.max(min, parsed))
    setInputValue(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className="appearance-number-input tw:flex tw:items-center tw:gap-2">
      <Input
        aria-label={ariaLabel}
        className="tw:w-16 tw:min-w-0 tw:rounded-md tw:border tw:border-app-border tw:bg-app-control tw:px-2 tw:text-right tw:text-app-text tw:type-body tw:shadow-none"
        max={max}
        min={min}
        size="compact"
        type="number"
        value={inputValue}
        onBlur={commit}
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setInputValue(String(value))
            event.currentTarget.blur()
          }
        }}
      />
      <span aria-hidden="true" className="tw:text-app-text-soft tw:type-body-sm">
        px
      </span>
    </div>
  )
}

function ColorControl({
  ariaLabel,
  value,
  onCommit,
}: {
  ariaLabel: string
  value: `#${string}`
  onCommit: (value: `#${string}`) => void
}) {
  const normalizedValue = value.toUpperCase() as `#${string}`
  const [draft, setDraft] = useState(normalizedValue)
  useEffect(() => setDraft(normalizedValue), [normalizedValue])

  const commit = (): void => {
    if (!HEX_COLOR.test(draft)) {
      setDraft(normalizedValue)
      return
    }
    const next = draft.toUpperCase() as `#${string}`
    setDraft(next)
    if (next !== normalizedValue) onCommit(next)
  }

  return (
    <div className="appearance-color-control tw:flex tw:h-7 tw:w-24 tw:shrink-0 tw:items-center tw:gap-2 tw:rounded-pill tw:border tw:border-app-border tw:bg-transparent tw:px-2 tw:text-app-text tw:has-[:focus-visible]:outline-solid tw:has-[:focus-visible]:outline-2 tw:has-[:focus-visible]:outline-offset-1 tw:has-[:focus-visible]:outline-app-focus">
      <AnchoredPopover
        data-popover-size="md"
        align="end"
        className="appearance-color-popover tw:p-1"
        contentLabel={`${ariaLabel}颜色选项`}
        contentRole="dialog"
        trigger={
          <button
            aria-label={`${ariaLabel}颜色选择器`}
            className="appearance-color-swatch"
            style={
              {
                '--appearance-color-swatch-background': normalizedValue,
              } as React.CSSProperties
            }
            type="button"
          />
        }
        size="md"
      >
        <ColorPalette
          value={normalizedValue}
          onChange={(next) => {
            setDraft(next)
            onCommit(next)
          }}
        />
      </AnchoredPopover>
      <input
        aria-label={ariaLabel}
        aria-invalid={!HEX_COLOR.test(draft) || undefined}
        className="appearance-color-input tw:min-w-0 tw:flex-1 tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:font-mono tw:text-[length:var(--cpx-sys-font-size-xs)] tw:tabular-nums tw:uppercase tw:outline-none"
        maxLength={7}
        spellCheck={false}
        type="text"
        value={draft}
        onBlur={commit}
        onChange={(event) => {
          const sanitized = sanitizeHexColor(event.target.value)
          setDraft(sanitized as `#${string}`)
          if (HEX_COLOR.test(sanitized)) {
            const next = sanitized.toUpperCase() as `#${string}`
            setDraft(next)
            onCommit(next)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(normalizedValue)
            event.currentTarget.blur()
          }
        }}
        style={{
          background: 'transparent',
          border: 0,
          borderRadius: 0,
          outline: 'none',
        }}
      />
    </div>
  )
}

function sanitizeHexColor(value: string): string {
  const characters = value.toUpperCase().replace(/[^#0-9A-F]/g, '')
  return `#${characters.replaceAll('#', '').slice(0, 6)}`
}

function hexToRgb(value: string): [number, number, number] {
  const normalized = value.replace('#', '').padEnd(6, '0')
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ]
}

function rgbToHex(red: number, green: number, blue: number): `#${string}` {
  const channel = (value: number): string =>
    Math.round(Math.max(0, Math.min(255, value)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  return `#${channel(red)}${channel(green)}${channel(blue)}`
}

function rgbToHsv(red: number, green: number, blue: number): [number, number, number] {
  const [r, g, b] = [red, green, blue].map((channel) => channel / 255)
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const delta = maximum - minimum
  let hue = 0
  if (delta !== 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6)
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2)
    else hue = 60 * ((r - g) / delta + 4)
  }
  return [hue < 0 ? hue + 360 : hue, maximum === 0 ? 0 : delta / maximum, maximum]
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const chroma = value * saturation
  const segment = hue / 60
  const intermediate = chroma * (1 - Math.abs((segment % 2) - 1))
  const [red, green, blue] =
    segment < 1
      ? [chroma, intermediate, 0]
      : segment < 2
        ? [intermediate, chroma, 0]
        : segment < 3
          ? [0, chroma, intermediate]
          : segment < 4
            ? [0, intermediate, chroma]
            : segment < 5
              ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate]
  const match = value - chroma
  return [(red + match) * 255, (green + match) * 255, (blue + match) * 255]
}

function ColorPalette({
  value,
  onChange,
}: {
  value: `#${string}`
  onChange: (value: `#${string}`) => void
}): React.ReactNode {
  const [hue, saturation, brightness] = rgbToHsv(...hexToRgb(value))
  const hueColor = rgbToHex(...hsvToRgb(hue, 1, 1))

  const updateSaturation = (event: React.PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const nextSaturation = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    const nextBrightness = Math.max(
      0,
      Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height),
    )
    event.currentTarget.setPointerCapture(event.pointerId)
    onChange(rgbToHex(...hsvToRgb(hue, nextSaturation, nextBrightness)))
  }

  return (
    <div className="appearance-color-palette">
      <div
        className="appearance-color-palette-square"
        style={{ '--appearance-picker-hue': hueColor } as React.CSSProperties}
        onPointerDown={updateSaturation}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            updateSaturation(event)
          }
        }}
      >
        <span
          className="appearance-color-palette-thumb"
          style={{
            left: `${saturation * 100}%`,
            top: `${(1 - brightness) * 100}%`,
          }}
        />
        <Slider.Root
          className="appearance-color-axis-slider tw:sr-only"
          max={100}
          min={0}
          value={[Math.round(saturation * 100)]}
          onValueChange={(values) => {
            const nextSaturation = values[0]
            if (nextSaturation === undefined) return
            onChange(rgbToHex(...hsvToRgb(hue, nextSaturation / 100, brightness)))
          }}
        >
          <Slider.Track>
            <Slider.Range />
          </Slider.Track>
          <Slider.Thumb
            aria-label="颜色饱和度"
            aria-valuetext={`${Math.round(saturation * 100)}%`}
            className="appearance-color-axis-thumb"
          />
        </Slider.Root>
        <Slider.Root
          className="appearance-color-axis-slider tw:sr-only"
          max={100}
          min={0}
          value={[Math.round(brightness * 100)]}
          onValueChange={(values) => {
            const nextBrightness = values[0]
            if (nextBrightness === undefined) return
            onChange(rgbToHex(...hsvToRgb(hue, saturation, nextBrightness / 100)))
          }}
        >
          <Slider.Track>
            <Slider.Range />
          </Slider.Track>
          <Slider.Thumb
            aria-label="颜色亮度"
            aria-valuetext={`${Math.round(brightness * 100)}%`}
            className="appearance-color-axis-thumb"
          />
        </Slider.Root>
      </div>
      <input
        aria-label="色相"
        className="appearance-color-hue"
        max={359}
        min={0}
        type="range"
        value={Math.round(hue)}
        onChange={(event) =>
          onChange(
            rgbToHex(...hsvToRgb(Number.parseInt(event.target.value, 10), saturation, brightness)),
          )
        }
      />
    </div>
  )
}

function ThemeModeCard({
  mode,
  selected,
  label,
  onSelect,
}: {
  mode: DesktopThemeMode
  selected: boolean
  label: string
  onSelect: () => void
}) {
  return (
    <label
      className="appearance-mode-card tw:group tw:relative tw:flex tw:min-w-0 tw:flex-col tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:cursor-pointer"
      data-mode={mode}
      data-state={selected ? 'checked' : 'unchecked'}
    >
      <input
        checked={selected}
        className="tw:peer tw:absolute tw:inset-0 tw:z-2 tw:size-full tw:m-0 tw:cursor-pointer tw:border-0 tw:p-0 tw:opacity-0"
        name="appearance-theme"
        type="radio"
        value={mode}
        onChange={onSelect}
      />
      <span
        aria-hidden="true"
        className="appearance-mode-visual tw:relative tw:box-border tw:block tw:aspect-4/3 tw:w-full tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:transition-[border-color] tw:duration-state tw:ease-standard tw:peer-focus-visible:outline-solid tw:peer-focus-visible:outline-2 tw:peer-focus-visible:outline-offset-2 tw:peer-focus-visible:outline-app-focus tw:group-data-[state=checked]:border-2 tw:group-data-[state=checked]:border-app-text tw:[&>svg]:block tw:[&>svg]:size-full"
      >
        <ThemeModePreview mode={mode} />
      </span>
      <span className="appearance-mode-label tw:block tw:max-w-full tw:truncate tw:text-center tw:type-body tw:group-data-[state=checked]:text-app-text">
        {label}
      </span>
    </label>
  )
}

function ThemeModePreview({ mode }: { mode: DesktopThemeMode }): React.ReactNode {
  if (mode === 'system') {
    return (
      <svg viewBox="0 0 170 120">
        <defs>
          <clipPath id="appearance-system-preview-sheet">
            <path d="M7 42a8 8 0 0 1 8-8h140a8 8 0 0 1 8 8v78H7V42Z" />
          </clipPath>
        </defs>
        <g clipPath="url(#appearance-system-preview-sheet)">
          <path fill="#f3f3f3" d="M7 34h78v86H7z" />
          <path fill="#393939" d="M85 34h78v86H85z" />
          <path fill="#cdcdcd" d="M73 59h12v6H73a3 3 0 0 1 0-6Z" />
          <path fill="#767676" d="M85 59h9a3 3 0 0 1 0 6h-9Z" />
          <path fill="#dfdfdf" d="M53 68h32v3H53z" />
          <path fill="#8f8f8f" d="M85 68h32v3H85z" />
          <path fill="#fff" d="M26 84a7 7 0 0 1 7-7h52v43H26V84Z" />
          <path fill="#4f4f4f" d="M85 77h52a7 7 0 0 1 7 7v36H85V77Z" />
          <path fill="#dfdfdf" d="M32 88a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6H35a3 3 0 0 1-3-3Z" />
          <path fill="#767676" d="M103 88a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6h-29a3 3 0 0 1-3-3Z" />
          <path fill="#f3f3f3" d="M32 96h53v2H32zM26 105h59v1H26z" />
          <path fill="#767676" d="M85 96h53v2H85zM85 105h59v1H85z" />
          <path fill="#dfdfdf" d="M32 114a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6H35a3 3 0 0 1-3-3Z" />
          <path fill="#767676" d="M103 114a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6h-29a3 3 0 0 1-3-3Z" />
        </g>
      </svg>
    )
  }

  const dark = mode === 'dark'
  return (
    <svg viewBox="0 0 170 120">
      <path fill={dark ? '#9f9f9f' : '#cdcdcd'} d="M49 26h72a3 3 0 0 1 0 6H49a3 3 0 0 1 0-6Z" />
      <path fill={dark ? '#8f8f8f' : '#dfdfdf'} d="M28 35h114a2 2 0 0 1 0 4H28a2 2 0 0 1 0-4Z" />
      <path fill="#fff" d="M15 52a8 8 0 0 1 8-8h124a8 8 0 0 1 8 8v68H15V52Z" />
      <path fill="#dfdfdf" d="M22 59a3 3 0 0 1 3-3h39a3 3 0 0 1 0 6H25a3 3 0 0 1-3-3Z" />
      <path fill="#f3f3f3" d="M22 67h65v2H22zM15 76h140v1H15z" />
      <path fill="#dfdfdf" d="M22 83a3 3 0 0 1 3-3h39a3 3 0 0 1 0 6H25a3 3 0 0 1-3-3Z" />
      <path fill="#f3f3f3" d="M22 91h65v2H22zM15 100h140v1H15z" />
      <path fill="#dfdfdf" d="M22 107a3 3 0 0 1 3-3h39a3 3 0 0 1 0 6H25a3 3 0 0 1-3-3Z" />
      <path fill="#f3f3f3" d="M22 115h65v2H22z" />
    </svg>
  )
}

const THEME_PREVIEW_DIFF = {
  path: 'theme-preview.ts',
  status: 'modified',
  additions: 4,
  deletions: 3,
  isUntracked: false,
  hunks: [
    {
      id: 'theme-preview-hunk',
      header: '@@ -201,5 +201,6 @@',
      oldStart: 201,
      oldLines: 5,
      newStart: 201,
      newLines: 6,
      patch: [
        ' const themePreview: ThemeConfig = {',
        '-  surface: "sidebar",',
        '-  accent: "#2563eb",',
        '-  contrast: 42,',
        '+  surface: "sidebar-elevated",',
        '+  accent: "#0ea5e9",',
        '+  contrast: 68,',
        '+  density: "compact",',
        ' };',
      ].join('\n'),
      lines: [
        {
          id: 'theme-preview-context-open',
          type: 'context',
          oldLine: 201,
          newLine: 201,
          content: 'const themePreview: ThemeConfig = {',
          raw: ' const themePreview: ThemeConfig = {',
        },
        {
          id: 'theme-preview-removed-surface',
          type: 'removed',
          oldLine: 202,
          newLine: null,
          content: '  surface: "sidebar",',
          raw: '-  surface: "sidebar",',
        },
        {
          id: 'theme-preview-removed-accent',
          type: 'removed',
          oldLine: 203,
          newLine: null,
          content: '  accent: "#2563eb",',
          raw: '-  accent: "#2563eb",',
        },
        {
          id: 'theme-preview-removed-contrast',
          type: 'removed',
          oldLine: 204,
          newLine: null,
          content: '  contrast: 42,',
          raw: '-  contrast: 42,',
        },
        {
          id: 'theme-preview-added-surface',
          type: 'added',
          oldLine: null,
          newLine: 202,
          content: '  surface: "sidebar-elevated",',
          raw: '+  surface: "sidebar-elevated",',
        },
        {
          id: 'theme-preview-added-accent',
          type: 'added',
          oldLine: null,
          newLine: 203,
          content: '  accent: "#0ea5e9",',
          raw: '+  accent: "#0ea5e9",',
        },
        {
          id: 'theme-preview-added-contrast',
          type: 'added',
          oldLine: null,
          newLine: 204,
          content: '  contrast: 68,',
          raw: '+  contrast: 68,',
        },
        {
          id: 'theme-preview-added-density',
          type: 'added',
          oldLine: null,
          newLine: 205,
          content: '  density: "compact",',
          raw: '+  density: "compact",',
        },
        {
          id: 'theme-preview-context-close',
          type: 'context',
          oldLine: 205,
          newLine: 206,
          content: '};',
          raw: ' };',
        },
      ],
    },
  ],
} satisfies DesktopReviewDiffFile

function ThemePreview({
  variant,
  theme,
  codeThemeId,
  markerStyle,
  labelPrefix = '',
}: {
  variant: DesktopThemeVariant
  theme: DesktopChromeTheme
  codeThemeId: string
  markerStyle: DesktopDiffMarkerStyle
  labelPrefix?: string
}) {
  const variables = deriveThemeVariables({ codeThemeId, theme, variant })
  const style = {
    ...variables,
  } as React.CSSProperties

  return (
    <div
      aria-label={`${labelPrefix}${variant === 'light' ? '浅色' : '深色'}主题差异预览`}
      className="appearance-diff-preview tw:mx-0 tw:mt-0 tw:mb-4 tw:block tw:overflow-hidden tw:rounded-lg tw:bg-app-editor"
      data-variant={variant}
      style={style}
    >
      <ReviewDiffReadOnlySplit
        ariaLabel={`${labelPrefix}${variant === 'light' ? '浅色' : '深色'}主题差异代码`}
        diffMarkerStyle={markerStyle}
        file={THEME_PREVIEW_DIFF}
        showWordDiff
        syntaxThemeId={codeThemeId}
        wrapLines={false}
      />
    </div>
  )
}

/**
 * Side-by-side preview of the one shared font set in both variants. The
 * comparison only switches colors; the font tokens come from the same shared
 * settings, which is exactly what the preview is meant to make visible. Each
 * pane is already self-evidently light or dark, so neither carries a label.
 */
function SharedFontPreview({
  settings,
  markerStyle,
  variants,
}: {
  settings: DesktopThemeSettings
  markerStyle: DesktopDiffMarkerStyle
  variants: readonly DesktopThemeVariant[]
}) {
  return (
    <div className="appearance-font-preview tw:grid tw:gap-4 tw:p-4 tw:@max-[760px]:grid-cols-1 tw:@[761px]:grid-cols-2">
      {variants.map((variant) => (
        <ThemePreview
          codeThemeId={settings.codeThemeIds[variant]}
          key={variant}
          labelPrefix="字体"
          markerStyle={markerStyle}
          theme={settings.chromeThemes[variant]}
          variant={variant}
        />
      ))}
    </div>
  )
}

function VariantThemeEditor({
  section,
  variant,
  settings,
  onUpdate,
  onError,
  needsThemeSeeds = true,
}: {
  section: 'visual' | 'advanced'
  variant: DesktopThemeVariant
  settings: DesktopThemeSettings
  onUpdate: (updater: ThemeSettingsUpdater) => void
  onError: (message: string) => void
  needsThemeSeeds?: boolean
}) {
  const chromeTheme = settings.chromeThemes[variant]
  const { t } = useLocale()
  const accentPreset = chromeTheme.accentPreset ?? 'custom'
  const codeThemeId = settings.codeThemeIds[variant]
  const variantLabel = variant === 'light' ? '浅色' : '深色'
  const themes = useMemo(() => getThemesForVariant(variant), [variant])
  const [themeSeeds, setThemeSeeds] = useState<
    Record<string, Pick<DesktopChromeTheme, 'surface' | 'ink' | 'accent'>>
  >({})
  const [themeSeedsReady, setThemeSeedsReady] = useState(false)
  const accentOptions: SelectOption<DesktopAccentPreset>[] = ACCENT_PRESET_OPTIONS.map((option) => {
    const color = getDesktopAccentPresetColor(option.value, variant)
    return {
      value: option.value,
      label: t(option.value === 'black' && variant === 'dark' ? '白色' : option.label),
      disabled: option.value === 'custom' && accentPreset !== 'custom' && !themeSeeds[codeThemeId],
      icon: color ? (
        <span
          aria-hidden="true"
          className="appearance-accent-dot tw:size-3 tw:shrink-0 tw:rounded-pill tw:border tw:border-app-border-subtle"
          style={{ backgroundColor: color }}
        />
      ) : undefined,
    }
  })

  useEffect(() => {
    if (section !== 'visual') {
      // Advanced editors never show the theme picker; loading every code
      // theme seed there would only delay the appearance page.
      setThemeSeedsReady(true)
      return
    }
    if (!needsThemeSeeds) {
      // A hidden disclosure keeps the card mounted; the seeds load once it
      // becomes visible again.
      setThemeSeedsReady(true)
      return
    }
    let cancelled = false
    setThemeSeedsReady(false)
    void Promise.allSettled(
      themes.map(async (theme) => {
        await visualThemeSeedDelay()
        return {
          slug: theme.slug,
          seed: await loadChromeThemeSeed(theme.slug, variant),
        }
      }),
    ).then((results) => {
      if (cancelled) return
      const entries = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      )
      setThemeSeeds(
        Object.fromEntries(
          entries.map(({ slug, seed }) => [
            slug,
            {
              surface: seed.surface,
              ink: seed.ink,
              accent: seed.accent,
            },
          ]),
        ),
      )
      setThemeSeedsReady(true)
      if (entries.length !== results.length) {
        onError('部分代码主题预览加载失败，请重试')
      }
    })
    return () => {
      cancelled = true
    }
  }, [themes, variant, section, needsThemeSeeds])

  const updateChromeTheme = (patch: Partial<DesktopChromeTheme>): void => {
    onUpdate((current) => {
      const currentTheme = current.chromeThemes[variant]
      return {
        ...current,
        chromeThemes: {
          ...current.chromeThemes,
          [variant]: { ...currentTheme, ...patch },
        },
      }
    })
  }

  return (
    <article
      aria-busy={section === 'visual' && needsThemeSeeds && !themeSeedsReady}
      className="appearance-theme-editor settings-card tw:overflow-hidden tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none tw:[&>.settings-row]:min-h-12"
      data-section={section}
    >
      <SettingsRow
        title={`${variantLabel}主题`}
        control={
          section === 'visual' ? (
            <ThemePickerDropdown
              ariaLabel={`${variantLabel}代码主题`}
              onChange={(nextId) => {
                const nextCodeThemeId =
                  nextId as DesktopThemeSettings['codeThemeIds'][typeof variant]
                void Promise.resolve(loadChromeThemeSeed(nextCodeThemeId, variant))
                  .then((seed) => {
                    onUpdate((current) => {
                      const currentTheme = current.chromeThemes[variant]
                      return {
                        ...current,
                        codeThemeIds: {
                          ...current.codeThemeIds,
                          [variant]: nextCodeThemeId,
                        },
                        chromeThemes: {
                          ...current.chromeThemes,
                          [variant]: mergeChromeThemeSeed(currentTheme, seed),
                        },
                      }
                    })
                  })
                  .catch((error) => {
                    onError(error instanceof Error ? error.message : '无法加载代码主题')
                  })
              }}
              themeSeeds={themeSeeds}
              themes={themes}
              value={codeThemeId}
              variant={variant}
            />
          ) : undefined
        }
      />

      <div className="appearance-theme-editor-rows tw:[&>.settings-row]:px-4 tw:@max-[760px]:[&_.settings-row]:items-start tw:@max-[760px]:[&_.settings-row-control]:w-full tw:@max-[760px]:[&_.settings-row-control]:justify-start">
        {section === 'visual' ? (
          <>
            <SettingsRow
              title="强调色"
              size="compact"
              control={
                <div className="appearance-accent-control tw:flex tw:items-center tw:gap-2">
                  <Select
                    ariaLabel={t(`${variantLabel}强调色预设`)}
                    options={accentOptions}
                    showSelectedIndicator
                    triggerClassName="appearance-accent-select tw:h-7 tw:min-h-7 tw:w-auto tw:min-w-0 tw:max-w-[min(360px,48vw)] tw:rounded-pill"
                    value={accentPreset}
                    size="sm"
                    onValueChange={(preset) =>
                      onUpdate((current) => ({
                        ...current,
                        chromeThemes: {
                          ...current.chromeThemes,
                          [variant]: applyChromeThemeAccentPreset(
                            current.chromeThemes[variant],
                            preset,
                            variant,
                            themeSeeds[current.codeThemeIds[variant]]?.accent,
                          ),
                        },
                      }))
                    }
                  />
                  {accentPreset === 'custom' ? (
                    <ColorControl
                      ariaLabel={`${variantLabel}强调色`}
                      value={chromeTheme.accent}
                      onCommit={(accent) => updateChromeTheme({ accent, accentPreset: 'custom' })}
                    />
                  ) : null}
                </div>
              }
            />
            <SettingsRow
              title="背景"
              size="compact"
              control={
                <ColorControl
                  ariaLabel={`${variantLabel}背景色`}
                  value={chromeTheme.surface}
                  onCommit={(surface) => updateChromeTheme({ surface })}
                />
              }
            />
            <SettingsRow
              title="前景"
              size="compact"
              control={
                <ColorControl
                  ariaLabel={`${variantLabel}前景色`}
                  value={chromeTheme.ink}
                  onCommit={(ink) => updateChromeTheme({ ink })}
                />
              }
            />
          </>
        ) : null}
        {section === 'advanced' ? (
          <SettingsRow
            title="对比度"
            size="compact"
            control={
              <label className="appearance-contrast-control">
                <input
                  aria-label={`${variantLabel}对比度`}
                  max={100}
                  min={0}
                  style={
                    {
                      '--appearance-slider-accent': chromeTheme.accent,
                      '--appearance-slider-surface': chromeTheme.surface,
                    } as React.CSSProperties
                  }
                  type="range"
                  value={chromeTheme.contrast}
                  onChange={(event) =>
                    updateChromeTheme({
                      contrast: Number.parseInt(event.target.value, 10),
                    })
                  }
                />
                <output>{chromeTheme.contrast}</output>
              </label>
            }
          />
        ) : null}
      </div>
    </article>
  )
}

/**
 * 浅色与深色共用的字体设置行：UI 字体与代码字体共用同一张卡片，各占一行，
 * 不再在两种配色的主题卡片里各出现一次同一个共用值。
 */
function SharedFontRow({
  title,
  ariaLabel,
  kind,
  placeholder,
  family,
  face,
  onCommit,
}: {
  title: string
  ariaLabel: string
  kind: 'ui' | 'code'
  placeholder: string
  family: string | null
  face: DesktopThemeFontFace | null
  onCommit: (family: string | null, face: DesktopThemeFontFace | null) => void
}) {
  return (
    <SettingsRow
      control={
        <ThemeFontPicker
          ariaLabel={ariaLabel}
          controls="both"
          face={face}
          family={family}
          kind={kind}
          placeholder={placeholder}
          onCommit={onCommit}
        />
      }
      title={title}
    />
  )
}

export function AppearanceSettings({ onError }: Props): React.ReactNode {
  const theme = useDesktopTheme()
  const desktopSettings = useDesktopSettings()
  const { t } = useLocale()
  const [resetting, setResetting] = useState(false)
  const [resetFailed, setResetFailed] = useState(false)
  const { settings, resolvedVariant } = theme.draft
  const visibleVariants = settings.mode === 'system' ? VARIANTS : ([resolvedVariant] as const)
  const hasAdvancedChanges =
    JSON.stringify(resetAdvancedDesktopThemeSettings(settings)) !== JSON.stringify(settings) ||
    desktopSettings.draft.values.diffMarkerStyle !== DEFAULT_DIFF_MARKER_STYLE

  const reportError = onError ?? (() => undefined)

  const saveThemeSettings = (updater: ThemeSettingsUpdater): void => {
    void theme.draft.updateAndAutoSave(updater).catch((error) => {
      reportError(error instanceof Error ? error.message : '外观设置保存失败')
    })
  }

  const updateThemeSettings = (patch: Partial<DesktopThemeSettings>): void => {
    saveThemeSettings((current) => ({ ...current, ...patch }))
  }

  const updateDiffMarkerStyle = (diffMarkerStyle: DesktopDiffMarkerStyle): void => {
    desktopSettings.draft.setValue('diffMarkerStyle', diffMarkerStyle)
    desktopSettings.draft.autoSave()
  }

  const resetAdvancedSettings = async (): Promise<void> => {
    setResetting(true)
    desktopSettings.draft.setValue('diffMarkerStyle', DEFAULT_DIFF_MARKER_STYLE)
    const results = await Promise.allSettled([
      theme.draft.updateAndAutoSave(resetAdvancedDesktopThemeSettings),
      desktopSettings.draft.save(),
    ])
    const failed = results.some((result) => result.status === 'rejected')
    setResetFailed(failed)
    setResetting(false)
    if (failed) {
      reportError(t('部分高级设置重置失败，请重试'))
    }
  }

  return (
    <SettingsContentArea>
      <div className="settings-content-inner appearance-settings tw:[&>.settings-section>.appearance-shared-fonts]:mt-4 tw:[&>.settings-section>.appearance-theme-editors]:mt-4 tw:[&>.settings-section]:grid tw:[&>.settings-section]:gap-4 tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
            {t('外观')}
          </h2>
        </div>

        <SettingsSection bare title="视觉样式">
          <div className="settings-card tw:overflow-hidden tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none tw:[&>.settings-row]:px-4">
            <SettingsRow
              title="模式"
              control={
                <div
                  aria-label="外观模式"
                  className="appearance-mode-gallery tw:grid tw:w-68 tw:max-w-full tw:grid-cols-3 tw:gap-3"
                  role="radiogroup"
                  onKeyDown={(event) => {
                    const keyOffsets: Partial<Record<string, number>> = {
                      ArrowLeft: -1,
                      ArrowUp: -1,
                      ArrowRight: 1,
                      ArrowDown: 1,
                    }
                    const currentIndex = THEME_MODE_OPTIONS.findIndex(
                      (option) => option.value === settings.mode,
                    )
                    let nextIndex = currentIndex
                    if (event.key === 'Home') nextIndex = 0
                    else if (event.key === 'End') {
                      nextIndex = THEME_MODE_OPTIONS.length - 1
                    } else if (keyOffsets[event.key]) {
                      nextIndex =
                        (currentIndex + (keyOffsets[event.key] ?? 0) + THEME_MODE_OPTIONS.length) %
                        THEME_MODE_OPTIONS.length
                    } else {
                      return
                    }

                    event.preventDefault()
                    const nextMode = THEME_MODE_OPTIONS[nextIndex]?.value
                    if (!nextMode) return
                    const nextInput = event.currentTarget.querySelector<HTMLInputElement>(
                      `input[value="${nextMode}"]`,
                    )
                    nextInput?.focus()
                    nextInput?.click()
                  }}
                >
                  {THEME_MODE_OPTIONS.map((option) => (
                    <ThemeModeCard
                      key={option.value}
                      label={option.label}
                      mode={option.value}
                      selected={settings.mode === option.value}
                      onSelect={() => {
                        saveThemeSettings((current) => ({
                          ...current,
                          mode: option.value,
                        }))
                      }}
                    />
                  ))}
                </div>
              }
            />
            <SharedFontPreview
              markerStyle={desktopSettings.draft.values.diffMarkerStyle}
              settings={settings}
              variants={visibleVariants}
            />
          </div>
          <div className="settings-card tw:overflow-hidden tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none tw:[&>.settings-row]:px-4">
            <SharedFontRow
              ariaLabel={t('界面字体')}
              face={settings.fonts.uiFace ?? null}
              family={settings.fonts.ui}
              kind="ui"
              placeholder="ui-sans-serif, system-ui, sans-serif"
              title="UI 字体"
              onCommit={(ui, uiFace) =>
                saveThemeSettings((current) =>
                  applySharedDesktopThemeFonts(current, { ui, uiFace }),
                )
              }
            />
            <SharedFontRow
              ariaLabel={t('代码字体')}
              face={settings.fonts.codeFace ?? null}
              family={settings.fonts.code}
              kind="code"
              placeholder="ui-monospace, SFMono-Regular, Consolas, monospace"
              title="代码字体"
              onCommit={(code, codeFace) =>
                saveThemeSettings((current) =>
                  applySharedDesktopThemeFonts(current, { code, codeFace }),
                )
              }
            />
          </div>
          <div className="appearance-theme-editors tw:grid tw:gap-5">
            {visibleVariants.map((variant) => (
              <VariantThemeEditor
                section="visual"
                key={variant}
                settings={settings}
                variant={variant}
                onError={reportError}
                onUpdate={saveThemeSettings}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection bare>
          <DisclosureController
            contentClassName="appearance-advanced-content tw:flex tw:flex-col tw:gap-4"
            renderTrigger={({ expanded, contentId, toggle }) => (
              <SettingsSection.Header
                title={
                  <button
                    aria-controls={contentId}
                    aria-expanded={expanded}
                    className="appearance-advanced-trigger tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:hover:text-app-text tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus"
                    onClick={toggle}
                    type="button"
                  >
                    {t('高级')}
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                }
                actions={
                  hasAdvancedChanges || resetting || resetFailed ? (
                    <Button
                      color="ghostTertiary"
                      disabled={resetting || theme.draft.saving || desktopSettings.draft.saving}
                      loading={resetting}
                      onClick={() => {
                        void resetAdvancedSettings()
                      }}
                      size="compact"
                    >
                      {t('重置高级设置')}
                    </Button>
                  ) : undefined
                }
              />
            )}
          >
            <div className="settings-card tw:overflow-hidden tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none">
              <SettingsRow
                title="界面字号"
                control={
                  <NumberInput
                    ariaLabel="界面字号"
                    max={16}
                    min={11}
                    value={settings.fontSizes.ui}
                    onChange={(ui) =>
                      saveThemeSettings((current) => ({
                        ...current,
                        fontSizes: { ...current.fontSizes, ui },
                      }))
                    }
                  />
                }
              />
              <SettingsRow
                title="代码字号"
                control={
                  <NumberInput
                    ariaLabel="代码字号"
                    max={24}
                    min={8}
                    value={settings.fontSizes.code}
                    onChange={(code) =>
                      saveThemeSettings((current) => ({
                        ...current,
                        fontSizes: { ...current.fontSizes, code },
                      }))
                    }
                  />
                }
              />
            </div>
            <div className="appearance-theme-editors tw:grid tw:gap-5">
              {visibleVariants.map((variant) => (
                <VariantThemeEditor
                  section="advanced"
                  key={variant}
                  needsThemeSeeds={false}
                  settings={settings}
                  variant={variant}
                  onError={reportError}
                  onUpdate={saveThemeSettings}
                />
              ))}
            </div>
            <div className="settings-card tw:overflow-hidden tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none">
              <SettingsRow
                autoSave
                title="减少动态效果"
                description="跟随系统，或始终开启、关闭界面动画"
                control={
                  <SegmentedControl
                    ariaLabel="减少动态效果选项"
                    options={[
                      { value: 'system', label: '系统' },
                      { value: 'on', label: '开启' },
                      { value: 'off', label: '关闭' },
                    ]}
                    value={settings.reduceMotion}
                    onChange={(reduceMotion) => updateThemeSettings({ reduceMotion })}
                  />
                }
              />
              <SettingsRow
                autoSave
                title="使用指针光标"
                description="悬停按钮、菜单等交互元素时显示手形指针"
                control={
                  <ToggleSwitch
                    ariaLabel="使用指针光标"
                    checked={settings.pointerCursorEnabled}
                    onChange={(pointerCursorEnabled) =>
                      updateThemeSettings({ pointerCursorEnabled })
                    }
                  />
                }
              />
              <SettingsRow
                autoSave
                title="差异标记"
                description="使用彩色背景，或在更改行显示 + / - 符号"
                control={
                  <SegmentedControl
                    ariaLabel="差异标记选项"
                    options={[
                      { value: 'color', label: '颜色' },
                      { value: 'symbol', label: '+/-' },
                    ]}
                    value={desktopSettings.draft.values.diffMarkerStyle}
                    onChange={updateDiffMarkerStyle}
                  />
                }
              />
              {navigator.platform.toLowerCase().includes('mac') ? (
                <SettingsRow
                  autoSave
                  title="字体平滑"
                  description="在 macOS 上优化浅色文字边缘"
                  control={
                    <ToggleSwitch
                      ariaLabel="字体平滑"
                      checked={settings.fontSmoothingEnabled}
                      onChange={(fontSmoothingEnabled) =>
                        updateThemeSettings({ fontSmoothingEnabled })
                      }
                    />
                  }
                />
              ) : null}
            </div>
          </DisclosureController>
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}
