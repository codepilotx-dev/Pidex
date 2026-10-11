import React, { useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Dropdown as DropdownMenu } from '../../components/ui/floating/Dropdown.js'
import { Dropdown } from '../../components/ui/Dropdown.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { APP_ICON_SIZES, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { buildPopoverSizingStyle } from '../../components/ui/PopoverSizing.js'
import { cx } from '../../utils/Cx.js'
import { ensureThemePreviewContrast } from '../theme/ThemeVariables.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import type { DesktopChromeTheme, DesktopThemeVariant } from '../../../shared/Types.js'

export type ThemePickerOption = {
  slug: string
  label: string
}

export type ThemePickerDropdownProps = {
  ariaLabel?: string
  disabled?: boolean
  onChange: (slug: string) => void
  themeSeeds: Record<string, Pick<DesktopChromeTheme, 'surface' | 'ink' | 'accent'>>
  themes: readonly ThemePickerOption[]
  triggerClassName?: string
  value: string
  variant: DesktopThemeVariant
}

export function ThemeBadge({
  seed,
  className,
}: {
  seed?: Pick<DesktopChromeTheme, 'surface' | 'ink' | 'accent'>
  className?: string
}) {
  const fgColor = seed ? ensureThemePreviewContrast(seed) : 'var(--cpx-sys-color-fg-secondary)'
  return (
    <span
      aria-hidden="true"
      className={cx(
        'appearance-theme-badge tw:inline-flex tw:size-5 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full tw:type-label tw:select-none tw:border tw:border-app-border-subtle',
        className,
      )}
      style={
        seed
          ? {
              backgroundColor: seed.surface,
              color: fgColor,
              borderColor: `color-mix(in srgb, ${seed.ink} 22%, transparent)`,
            }
          : {
              backgroundColor: 'var(--cpx-sys-color-surface-panel)',
              color: 'var(--cpx-sys-color-fg-secondary)',
            }
      }
    >
      Aa
    </span>
  )
}

export function ThemePickerDropdown({
  ariaLabel = '选择代码主题',
  disabled = false,
  onChange,
  themeSeeds,
  themes,
  triggerClassName,
  value,
  variant,
}: ThemePickerDropdownProps): React.ReactNode {
  const { t } = useLocale()

  const defaultSlug = variant === 'light' ? 'codex-new-light' : 'codex-new-dark'
  const isDefault = value === defaultSlug

  const otherThemes = useMemo(
    () => themes.filter((theme) => theme.slug !== defaultSlug),
    [themes, defaultSlug],
  )

  const activeTheme = themes.find((theme) => theme.slug === value)
  const activeSeed = themeSeeds[value]
  const defaultSeed = themeSeeds[defaultSlug]

  const triggerLabel = isDefault ? t('Pidex') : (activeTheme?.label ?? value)

  const triggerButton = (
    <button
      aria-label={t(ariaLabel)}
      className={cx(
        'settings-dropdown settings-dropdown-trigger appearance-theme-trigger tw:inline-flex tw:min-h-7 tw:w-auto tw:min-w-44 tw:max-w-64 tw:items-center tw:justify-between tw:gap-2 tw:rounded-pill tw:border tw:border-app-border tw:bg-app-control tw:px-2.5 tw:py-0 tw:text-app-text tw:type-control tw:cursor-pointer tw:outline-none tw:transition-[background-color,border-color,color] tw:hover:border-app-border-strong tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus',
        triggerClassName,
      )}
      data-theme-component="dropdown-trigger"
      disabled={disabled}
      type="button"
    >
      <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
        <ThemeBadge seed={activeSeed} />
        <span className="ui-select-value tw:min-w-0 tw:truncate tw:type-row-title">
          {triggerLabel}
        </span>
      </span>
      <ChevronDown
        className="tw:text-app-text-soft tw:shrink-0"
        size={APP_ICON_SIZES.sm}
        strokeWidth={APP_ICON_STROKE_WIDTH}
      />
    </button>
  )

  return (
    <Dropdown
      align="end"
      avoidCollisions
      collisionPadding={6}
      side="bottom"
      sideOffset={4}
      size="sm"
      trigger={triggerButton}
    >
      {/* 1. 顶层项：Pidex */}
      <PopoverItem
        icon={<ThemeBadge seed={defaultSeed} />}
        onClick={() => onChange(defaultSlug)}
        selected={isDefault}
        withCheck
      >
        {t('Pidex')}
      </PopoverItem>

      {/* 2. 二级子菜单：Codex 主题 */}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger
          className="popover-item popover-sub-trigger tw:w-full tw:min-w-0 tw:items-center tw:text-left"
          tabIndex={-1}
        >
          <span className="popover-item-leading">
            <span className="popover-item-icon">
              <ThemeBadge />
            </span>
          </span>
          <span className="popover-item-label">{t('Codex 主题')}</span>
          <span className="popover-item-trailing">
            <ChevronRight
              className="popover-item-arrow"
              size={APP_ICON_SIZES.sm}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent
            aria-label={t('Codex 主题列表')}
            className="popover-surface popover popover-sub-content tw:p-1 tw:max-h-80 tw:overflow-y-auto"
            collisionPadding={6}
            data-theme-component="dropdown-surface"
            sideOffset={4}
            size="sm"
            style={buildPopoverSizingStyle({ size: 'sm' })}
          >
            <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-0.5">
              {otherThemes.map((theme) => (
                <PopoverItem
                  key={theme.slug}
                  icon={<ThemeBadge seed={themeSeeds[theme.slug]} />}
                  onClick={() => onChange(theme.slug)}
                  selected={value === theme.slug}
                  withCheck
                >
                  {theme.label}
                </PopoverItem>
              ))}
            </div>
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
    </Dropdown>
  )
}
