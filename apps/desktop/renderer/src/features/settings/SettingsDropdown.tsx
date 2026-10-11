import type React from 'react'
import { Select, type SelectOption } from '../../components/ui/Select.js'
import type { PopoverSizingProps } from '../../components/ui/PopoverSizing.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { cx } from '../../utils/Cx.js'

type Option = SelectOption<string> & {
  label: string
  detail?: string
}

type Props = {
  value: string
  options: readonly Option[]
  onChange: (value: string) => void
  ariaLabel?: string
  disabled?: boolean
  variant?: 'default' | 'theme'
  searchable?: boolean
  searchPlaceholder?: string
  showSelectedIndicator?: boolean
  triggerClassName?: string
  /** Fired with the next open state; keeps user-gesture-driven side effects. */
  onOpenChange?: (open: boolean) => void
} & PopoverSizingProps

/** Settings compatibility wrapper. New feature code uses the shared Select. */
export function SettingsDropdown({
  onChange,
  ariaLabel = '选择选项',
  triggerClassName,
  variant,
  ...props
}: Props): React.ReactNode {
  const { t } = useLocale()
  return (
    <Select
      {...props}
      options={props.options.map((option) => ({
        ...option,
        label: t(option.label),
        detail: option.detail ? t(option.detail) : undefined,
      }))}
      ariaLabel={t(ariaLabel)}
      /* The theme picker sizes its own trigger; every other settings dropdown
         stays inside the shared 48vw ceiling. */
      triggerClassName={cx(
        variant === 'theme' ? undefined : 'tw:max-w-[min(360px,48vw)] tw:max-[900px]:max-w-none',
        triggerClassName,
      )}
      variant={variant}
      onValueChange={onChange}
    />
  )
}
