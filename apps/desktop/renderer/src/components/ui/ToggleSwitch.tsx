import { forwardRef } from 'react'
import * as Switch from '@radix-ui/react-switch'
import { cx } from '../../utils/Cx.js'

type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel?: string
  /** 由 SettingsRow 的 control 渲染函数注入，可访问名来自行标题。 */
  ariaLabelledby?: string
  ariaDescribedby?: string | null
  disabled?: boolean
}

export const ToggleSwitch = forwardRef<HTMLButtonElement, Props>(function ToggleSwitch(
  { checked, onChange, ariaLabel, ariaLabelledby, ariaDescribedby, disabled = false },
  ref,
) {
  return (
    <Switch.Root
      ref={ref}
      aria-describedby={ariaDescribedby}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      className={cx(
        'toggle-switch tw:relative tw:box-border tw:h-5 tw:w-8 tw:shrink-0 tw:cursor-pointer tw:rounded-full tw:border tw:border-app-border tw:bg-app-text/10 tw:p-0',
        'tw:transition-[background-color,border-color,opacity] tw:duration-state tw:ease-standard',
        'tw:not-disabled:hover:bg-app-text/20',
        'tw:active:bg-app-selected',
        // 选中态用 not-disabled 收口，保证禁用态的灰底压过强调色（原始 SCSS 靠源码顺序取胜）。
        'tw:data-[state=checked]:not-disabled:border-[color-mix(in_srgb,var(--cpx-sys-color-accent)_72%,var(--cpx-sys-color-border-default))]',
        'tw:data-[state=checked]:not-disabled:bg-app-accent tw:aria-checked:not-disabled:bg-app-accent',
        'tw:data-[state=checked]:not-disabled:hover:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_8%,var(--cpx-sys-color-accent))]',
        'tw:aria-checked:not-disabled:hover:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_8%,var(--cpx-sys-color-accent))]',
        'tw:data-[state=checked]:not-disabled:active:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_14%,var(--cpx-sys-color-accent))]',
        'tw:aria-checked:not-disabled:active:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_14%,var(--cpx-sys-color-accent))]',
        'tw:disabled:cursor-default tw:disabled:border-app-border-subtle tw:disabled:text-app-text-disabled tw:disabled:opacity-50 tw:disabled:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-disabled)_12%,var(--cpx-sys-color-surface-panel))]',
        'tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus',
      )}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    >
      <Switch.Thumb
        className={cx(
          'toggle-knob tw:absolute tw:top-px tw:left-px tw:box-border tw:size-4 tw:rounded-full tw:border tw:shadow-sm tw:translate-x-0',
          'tw:transition-[background-color,border-color,translate] tw:duration-state tw:ease-standard',
          'tw:data-[state=checked]:translate-x-3',
          'tw:data-[disabled]:shadow-none',
        )}
      />
    </Switch.Root>
  )
})
