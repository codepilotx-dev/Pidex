import {
  createContext,
  forwardRef,
  useContext,
  isValidElement,
  cloneElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import type React from 'react'
import { cx } from '../../utils/Cx.js'
import { useResolvedButtonSize } from './TabStripButtonContext.js'
import { Spinner, type SpinnerProps } from './Spinner.js'
import type { AppIconSize } from './IconTokens.js'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'text'
  | 'danger'
  | 'danger-outline'
  | 'subtle-accent'
  | 'accent'

export type ButtonColor =
  | 'accent'
  | 'accentSubtle'
  | 'danger'
  | 'dangerSolid'
  | 'ghost'
  | 'ghostSecondary'
  | 'outlineActive'
  | 'ghostActive'
  | 'ghostMuted'
  | 'ghostTertiary'
  | 'outline'
  | 'primary'
  | 'secondary'
  | 'text'

export type ButtonContentLayout = 'default' | 'balanced'
export type ButtonShape = 'default' | 'pill'
export type ButtonRadius = 'default' | 'large'

export type ButtonSize =
  | 'xs'
  | 'sm'
  | 'md'
  | 'lg'
  | 'compact'
  | 'composer'
  | 'composerSm'
  | 'composerUtility'
  | 'default'
  | 'icon'
  | 'iconLarge'
  | 'iconMd'
  | 'iconSm'
  | 'large'
  | 'medium'
  | 'tabStripAction'
  | 'toolbar'
  | 'toolbarLabel'

/* -------------------------------------------------------------------------------------------------
 * ButtonGroup Context
 * -----------------------------------------------------------------------------------------------*/
interface ButtonGroupContextValue {
  attached?: boolean
  disabled?: boolean
  shape?: ButtonShape
  size?: ButtonSize
  variant?: ButtonVariant
}

const ButtonGroupContext = createContext<ButtonGroupContextValue | null>(null)

/* -------------------------------------------------------------------------------------------------
 * Button Component Props
 * -----------------------------------------------------------------------------------------------*/
export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
  active?: boolean
  allowShrink?: boolean
  asChild?: boolean
  color?: ButtonColor
  contentLayout?: ButtonContentLayout
  fullWidth?: boolean
  iconSize?: AppIconSize
  isIconOnly?: boolean
  leftIcon?: ReactNode
  loading?: boolean
  loadingText?: ReactNode
  nativeTitle?: boolean
  radius?: ButtonRadius
  rightIcon?: ReactNode
  shape?: ButtonShape
  size?: ButtonSize
  uniform?: boolean
  variant?: ButtonVariant
}

/* -------------------------------------------------------------------------------------------------
 * Appearance Mappings (conforming to UI-Design / Codex specification)
 * -----------------------------------------------------------------------------------------------*/

/* Height, padding, gap and min-height */
const SIZE_BOX_CLASS: Record<ButtonSize, { standard: string; iconOnly: string; iconSize: number }> =
  {
    xs: {
      standard: 'tw:h-6 tw:min-h-6 tw:px-2 tw:gap-1',
      iconOnly: 'tw:w-6 tw:h-6 tw:min-h-6 tw:p-0',
      iconSize: 12,
    },
    sm: {
      standard: 'tw:h-[30px] tw:min-h-[30px] tw:px-2.5 tw:gap-1.5',
      iconOnly: 'tw:w-[30px] tw:h-[30px] tw:min-h-[30px] tw:p-0',
      iconSize: 14,
    },
    md: {
      standard: 'tw:h-9 tw:min-h-9 tw:px-3.5 tw:gap-2',
      iconOnly: 'tw:w-9 tw:h-9 tw:min-h-9 tw:p-0',
      iconSize: 16,
    },
    lg: {
      standard: 'tw:h-[42px] tw:min-h-[42px] tw:px-4.5 tw:gap-2.5',
      iconOnly: 'tw:w-[42px] tw:h-[42px] tw:min-h-[42px] tw:p-0',
      iconSize: 18,
    },
    // Legacy aliases
    compact: {
      standard: 'tw:h-6 tw:min-h-6 tw:px-2 tw:gap-1',
      iconOnly: 'tw:w-6 tw:h-6 tw:min-h-6 tw:p-0',
      iconSize: 12,
    },
    composer: {
      standard: 'tw:h-7 tw:min-h-7 tw:px-2 tw:gap-1.5',
      iconOnly: 'tw:w-7 tw:h-7 tw:min-h-7 tw:p-0',
      iconSize: 16,
    },
    composerSm: {
      standard: 'tw:h-7 tw:min-h-7 tw:px-1.5 tw:gap-1',
      iconOnly: 'tw:w-7 tw:h-7 tw:min-h-7 tw:p-0',
      iconSize: 12,
    },
    composerUtility: {
      standard: 'tw:h-7 tw:min-h-7 tw:px-1.5 tw:gap-1.5',
      iconOnly: 'tw:w-7 tw:h-7 tw:min-h-7 tw:p-0',
      iconSize: 16,
    },
    default: {
      standard: 'tw:h-6 tw:min-h-6 tw:px-2 tw:gap-1',
      iconOnly: 'tw:w-6 tw:h-6 tw:min-h-6 tw:p-0',
      iconSize: 16,
    },
    icon: {
      standard: 'tw:h-7 tw:min-h-7 tw:px-1 tw:gap-1',
      iconOnly: 'tw:w-7 tw:h-7 tw:min-h-7 tw:p-0',
      iconSize: 16,
    },
    iconLarge: {
      standard: 'tw:h-9 tw:min-h-9 tw:px-0 tw:gap-2',
      iconOnly: 'tw:w-9 tw:h-9 tw:min-h-9 tw:p-0',
      iconSize: 20,
    },
    iconMd: {
      standard: 'tw:h-6 tw:min-h-6 tw:px-0.5 tw:gap-1',
      iconOnly: 'tw:w-6 tw:h-6 tw:min-h-6 tw:p-0',
      iconSize: 12,
    },
    iconSm: {
      standard: 'tw:h-6 tw:min-h-6 tw:px-0.5 tw:gap-1',
      iconOnly: 'tw:w-6 tw:h-6 tw:min-h-6 tw:p-0',
      iconSize: 12,
    },
    large: {
      standard: 'tw:h-9 tw:min-h-9 tw:px-5 tw:gap-2',
      iconOnly: 'tw:w-9 tw:h-9 tw:min-h-9 tw:p-0',
      iconSize: 20,
    },
    medium: {
      standard: 'tw:h-8 tw:min-h-8 tw:px-4 tw:gap-1.5',
      iconOnly: 'tw:w-8 tw:h-8 tw:min-h-8 tw:p-0',
      iconSize: 16,
    },
    tabStripAction: {
      standard: 'tw:h-9 tw:min-h-9 tw:px-2 tw:gap-1.5',
      iconOnly: 'tw:w-9 tw:h-9 tw:min-h-9 tw:p-0',
      iconSize: 16,
    },
    toolbar: {
      standard: 'tw:h-7 tw:min-h-7 tw:px-2 tw:gap-1.5',
      iconOnly: 'tw:w-7 tw:h-7 tw:min-h-7 tw:p-0',
      iconSize: 16,
    },
    toolbarLabel: {
      standard: 'tw:h-7 tw:min-h-7 tw:px-2.5 tw:gap-1.5',
      iconOnly: 'tw:w-7 tw:h-7 tw:min-h-7 tw:p-0',
      iconSize: 16,
    },
  }

/* Radius specification: 5px (xs), 8px (sm), 10px (md/lg), pill (rounded-full) */
const RADIUS_CLASSES: Record<ButtonShape, Record<ButtonSize, string>> = {
  default: {
    xs: 'tw:rounded-xs',
    sm: 'tw:rounded-sm',
    md: 'tw:rounded-md',
    lg: 'tw:rounded-md',
    compact: 'tw:rounded-xs',
    composer: 'tw:rounded-full',
    composerSm: 'tw:rounded-full',
    composerUtility: 'tw:rounded-full',
    default: 'tw:rounded-full',
    icon: 'tw:rounded-sm',
    iconLarge: 'tw:rounded-md',
    iconMd: 'tw:rounded-xs',
    iconSm: 'tw:rounded-xs',
    large: 'tw:rounded-full',
    medium: 'tw:rounded-md',
    tabStripAction: 'tw:rounded-md',
    toolbar: 'tw:rounded-sm',
    toolbarLabel: 'tw:rounded-sm',
  },
  pill: {
    xs: 'tw:rounded-full',
    sm: 'tw:rounded-full',
    md: 'tw:rounded-full',
    lg: 'tw:rounded-full',
    compact: 'tw:rounded-full',
    composer: 'tw:rounded-full',
    composerSm: 'tw:rounded-full',
    composerUtility: 'tw:rounded-full',
    default: 'tw:rounded-full',
    icon: 'tw:rounded-full',
    iconLarge: 'tw:rounded-full',
    iconMd: 'tw:rounded-full',
    iconSm: 'tw:rounded-full',
    large: 'tw:rounded-full',
    medium: 'tw:rounded-full',
    tabStripAction: 'tw:rounded-full',
    toolbar: 'tw:rounded-full',
    toolbarLabel: 'tw:rounded-full',
  },
}

/* Direct-child icon size per tier (`--button-icon-size*`) */
const SIZE_ICON_CLASS: Record<ButtonSize, string> = {
  xs: 'tw:[&>svg]:size-icon-sm',
  sm: 'tw:[&>svg]:size-icon-sm',
  md: 'tw:[&>svg]:size-icon',
  lg: 'tw:[&>svg]:size-icon-lg',
  compact: 'tw:[&>svg]:size-icon-sm',
  composer: 'tw:[&>svg]:size-icon',
  composerSm: 'tw:[&>svg]:size-icon-sm',
  composerUtility: 'tw:[&>svg]:size-icon',
  default: 'tw:[&>svg]:size-icon-md',
  icon: 'tw:[&>svg]:size-icon',
  iconLarge: 'tw:[&>svg]:size-icon-lg',
  iconMd: 'tw:[&>svg]:size-icon-sm',
  iconSm: 'tw:[&>svg]:size-icon-sm',
  large: 'tw:[&>svg]:size-icon-lg',
  medium: 'tw:[&>svg]:size-icon',
  tabStripAction: 'tw:[&>svg]:size-icon',
  toolbar: 'tw:[&>svg]:size-icon',
  toolbarLabel: 'tw:[&>svg]:size-icon',
}

const ICON_OVERRIDE_ICON_CLASS: Record<AppIconSize, string> = {
  sm: 'tw:[&>svg]:size-icon-sm',
  md: 'tw:[&>svg]:size-icon-md',
  lg: 'tw:[&>svg]:size-icon-lg',
}

/*
 * Text buttons scale both icon axes with the label using the UI locale's unit,
 * keeps square icon slots; artwork is excluded.
 */
const TEXT_ICON_CLASS = cx(
  "tw:[&>svg:not([data-icon-kind='artwork'])]:size-[var(--inline-icon-size,1em)]",
  "tw:[&>span>svg:not([data-icon-kind='artwork'])]:size-[var(--inline-icon-size,1em)]",
  'tw:[&>.ui-spinner]:size-[var(--inline-icon-size,1em)]',
)

const ICON_OVERRIDE_SPINNER_SIZE: Record<AppIconSize, SpinnerProps['size']> = {
  sm: 'small',
  md: 'medium',
  lg: 'large',
}

const SIZE_SPINNER_SIZE: Record<ButtonSize, SpinnerProps['size']> = {
  xs: 'small',
  sm: 'small',
  md: 'medium',
  lg: 'large',
  compact: 'small',
  composer: 'medium',
  composerSm: 'small',
  composerUtility: 'medium',
  default: 'medium',
  icon: 'medium',
  iconLarge: 'large',
  iconMd: 'small',
  iconSm: 'small',
  large: 'large',
  medium: 'medium',
  tabStripAction: 'medium',
  toolbar: 'medium',
  toolbarLabel: 'medium',
}

/* Variant visual states */
const PRIMARY_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-app-primary-action-hover',
  'tw:data-[state=open]:bg-app-primary-action-hover',
  'tw:data-[active]:bg-app-primary-action-hover',
  'tw:[&:active:not(:disabled)]:bg-app-primary-action-hover',
)

const ACCENT_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent)_90%,transparent)]',
  'tw:data-[state=open]:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent)_90%,transparent)]',
  'tw:data-[active]:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent)_90%,transparent)]',
  'tw:[&:active:not(:disabled)]:bg-[color-mix(in_srgb,var(--cpx-sys-color-accent)_80%,transparent)]',
)

const SECONDARY_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:border-app-border-strong',
  'tw:[&:enabled:hover]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_10%,transparent)]',
  'tw:data-[state=open]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_10%,transparent)]',
  'tw:data-[active]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_10%,transparent)]',
  'tw:[&:active:not(:disabled)]:bg-app-active',
)

const OUTLINE_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:border-app-border-strong',
  'tw:[&:enabled:hover]:text-app-text',
  'tw:[&:enabled:hover]:bg-app-hover',
  'tw:data-[state=open]:bg-app-hover',
  'tw:data-[active]:bg-app-hover',
  'tw:[&:active:not(:disabled)]:bg-app-active',
)

const GHOST_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:text-app-text',
  'tw:[&:enabled:hover]:bg-app-hover',
  'tw:data-[state=open]:bg-app-hover',
  'tw:data-[active]:bg-app-hover',
  'tw:[&:active:not(:disabled)]:bg-app-active',
)

const TEXT_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:text-app-text',
  'tw:[&:enabled:hover]:bg-transparent',
  'tw:data-[state=open]:text-app-text',
  'tw:data-[state=open]:bg-transparent',
  'tw:data-[active]:text-app-text',
  'tw:data-[active]:bg-transparent',
  'tw:[&:active:not(:disabled)]:text-app-text',
  'tw:[&:active:not(:disabled)]:bg-transparent',
)

const SUBTLE_ACCENT_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:bg-app-accent-subtle-hover',
  'tw:data-[state=open]:bg-app-accent-subtle-hover',
  'tw:data-[active]:bg-app-accent-subtle-hover',
  'tw:[&:active:not(:disabled)]:bg-app-accent-subtle-active',
)

const DANGER_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:brightness-110',
  'tw:data-[state=open]:brightness-110',
  'tw:data-[active]:brightness-110',
  'tw:[&:active:not(:disabled)]:brightness-95',
)

const DANGER_OUTLINE_STATE_CLASS = cx(
  'tw:[&:enabled:hover]:border-app-danger',
  'tw:[&:enabled:hover]:bg-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_12%,transparent)]',
  'tw:data-[state=open]:bg-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_12%,transparent)]',
  'tw:data-[active]:bg-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_12%,transparent)]',
)

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: cx(
    'tw:border-app-border-strong tw:bg-app-primary-action tw:text-app-primary-action-foreground tw:shadow-xs',
    PRIMARY_STATE_CLASS,
  ),
  accent: cx(
    'tw:border-transparent tw:bg-app-accent tw:text-app-on-accent tw:shadow-xs',
    ACCENT_STATE_CLASS,
  ),
  secondary: cx(
    'tw:border-transparent tw:text-app-text tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_5%,transparent)] tw:shadow-xs',
    SECONDARY_STATE_CLASS,
  ),
  outline: cx(
    'tw:border-app-border-subtle tw:bg-transparent tw:text-app-text-soft',
    OUTLINE_STATE_CLASS,
  ),
  ghost: cx('tw:border-transparent tw:bg-transparent tw:text-app-text-soft', GHOST_STATE_CLASS),
  text: cx('tw:border-transparent tw:bg-transparent tw:text-app-text-soft', TEXT_STATE_CLASS),
  danger: cx(
    'tw:border-transparent tw:bg-app-danger tw:text-app-on-accent tw:shadow-xs',
    DANGER_STATE_CLASS,
  ),
  'danger-outline': cx(
    'tw:border-[color-mix(in_srgb,var(--cpx-sys-color-charts-red)_35%,transparent)] tw:bg-transparent tw:text-app-chart-red',
    DANGER_OUTLINE_STATE_CLASS,
  ),
  'subtle-accent': cx(
    'tw:border-app-accent-border tw:bg-app-accent-subtle tw:text-app-accent-fg',
    SUBTLE_ACCENT_STATE_CLASS,
  ),
}

const BASE_CLASS = cx(
  'ui-button',
  'tw:box-border tw:inline-flex tw:items-center tw:justify-center',
  'tw:type-control tw:whitespace-nowrap tw:select-none tw:cursor-pointer',
  'tw:transition-[background-color,border-color,color,opacity,transform,box-shadow] tw:duration-150 tw:ease-out',
  'tw:[&>svg]:block tw:[&>svg]:shrink-0',
  'tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-app-accent tw:focus-visible:ring-offset-2 tw:focus-visible:ring-offset-app-main',
  'tw:disabled:cursor-not-allowed tw:disabled:opacity-40 tw:disabled:active:scale-100 tw:disabled:pointer-events-none',
  'tw:aria-disabled:cursor-not-allowed tw:aria-disabled:opacity-40 tw:aria-disabled:active:scale-100 tw:aria-disabled:pointer-events-none',
  'tw:aria-pressed:bg-app-selected tw:aria-pressed:text-app-text',
)

function resolveVariant(variant?: ButtonVariant, color?: ButtonColor): ButtonVariant {
  if (variant) return variant
  if (!color) return 'secondary'
  if (color === 'text') return 'text'
  if (color === 'primary') return 'primary'
  if (color === 'accent') return 'accent'
  if (color === 'accentSubtle') return 'subtle-accent'
  if (color === 'dangerSolid') return 'danger'
  if (color === 'danger') return 'danger-outline'
  if (color === 'outline' || color === 'outlineActive') return 'outline'
  if (
    color === 'ghost' ||
    color === 'ghostSecondary' ||
    color === 'ghostActive' ||
    color === 'ghostMuted' ||
    color === 'ghostTertiary'
  ) {
    return 'ghost'
  }
  return 'secondary'
}

/* -------------------------------------------------------------------------------------------------
 * Button Component
 * -----------------------------------------------------------------------------------------------*/
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    active = false,
    allowShrink = false,
    asChild = false,
    children,
    className,
    color,
    contentLayout = 'default',
    disabled = false,
    fullWidth = false,
    iconSize,
    isIconOnly = false,
    leftIcon,
    loading = false,
    loadingText,
    nativeTitle = true,
    radius,
    rightIcon,
    shape: propShape,
    size: propSize = 'default',
    type = 'button',
    uniform = false,
    variant: propVariant,
    ...buttonProps
  },
  ref,
): React.ReactNode {
  const groupContext = useContext(ButtonGroupContext)

  const rawSize = propSize ?? groupContext?.size ?? 'default'
  const resolvedSize = useResolvedButtonSize(rawSize)
  const variant = resolveVariant(propVariant ?? groupContext?.variant, color)
  const shape =
    propShape ?? (radius === 'large' ? 'pill' : undefined) ?? groupContext?.shape ?? 'default'
  const isDisabled = disabled || loading || Boolean(groupContext?.disabled)
  const isIcon = isIconOnly || uniform

  const isCustomPadding = /(?:^|\s)tw:(?:p|px|pl)-/.test(className ?? '')
  const sizeMeta = SIZE_BOX_CLASS[resolvedSize] ?? SIZE_BOX_CLASS.default
  const sizeClass = isIcon
    ? sizeMeta.iconOnly
    : isCustomPadding
      ? sizeMeta.standard.replace(new RegExp('\\btw:px-\\S+', 'g'), '').trim()
      : sizeMeta.standard
  const radiusClass = RADIUS_CLASSES[shape][resolvedSize] ?? RADIUS_CLASSES.default.default
  const variantClass = VARIANT_CLASS[variant] ?? VARIANT_CLASS.secondary

  const spinnerSize = iconSize
    ? ICON_OVERRIDE_SPINNER_SIZE[iconSize]
    : SIZE_SPINNER_SIZE[resolvedSize]

  const spinner = (
    <Spinner className="ui-button-spinner tw:shrink-0" size={spinnerSize} aria-hidden="true" />
  )

  const iconClasses = isIcon
    ? iconSize
      ? ICON_OVERRIDE_ICON_CLASS[iconSize]
      : SIZE_ICON_CLASS[resolvedSize]
    : TEXT_ICON_CLASS

  const baseClasses = cx(
    BASE_CLASS,
    variant !== 'text' && 'tw:active:scale-[0.98]',
    contentLayout === 'balanced' ? 'tw:grid tw:grid-cols-[1fr_auto_1fr]' : 'tw:inline-flex',
    sizeClass,
    radiusClass,
    variantClass,
    isIcon && 'icon-button tw:aspect-square tw:shrink-0',
    fullWidth && 'tw:w-full',
    allowShrink && 'tw:min-w-0',
    iconClasses,
    className,
  )

  const renderContent = () => {
    if (loading) {
      if (loadingText) {
        return (
          <>
            {spinner}
            <span>{loadingText}</span>
          </>
        )
      }
      if (isIcon) {
        return spinner
      }
      return (
        <>
          {spinner}
          {children}
        </>
      )
    }

    if (leftIcon || rightIcon) {
      return (
        <>
          {leftIcon ? (
            <span className="tw:inline-flex tw:shrink-0 tw:items-center">{leftIcon}</span>
          ) : null}
          {children}
          {rightIcon ? (
            <span className="tw:inline-flex tw:shrink-0 tw:items-center">{rightIcon}</span>
          ) : null}
        </>
      )
    }

    return children
  }

  if (asChild && isValidElement(children)) {
    const childElement = children as ReactElement<
      HTMLAttributes<HTMLElement> & { disabled?: boolean }
    >
    return cloneElement(childElement, {
      className: cx(baseClasses, childElement.props.className),
      'aria-busy': loading ? true : undefined,
      'aria-disabled': isDisabled ? true : undefined,
    })
  }

  return (
    <button
      {...buttonProps}
      ref={ref}
      aria-busy={loading ? true : undefined}
      aria-label={
        isIcon && buttonProps.title ? buttonProps.title : (buttonProps['aria-label'] ?? undefined)
      }
      className={baseClasses}
      data-active={active || buttonProps['data-active'] || undefined}
      data-allow-shrink={allowShrink || undefined}
      data-color={color ?? variant}
      data-content-layout={contentLayout}
      data-icon-only={isIcon || undefined}
      data-icon-size={iconSize}
      data-loading={loading || undefined}
      data-radius={radius ?? (shape === 'pill' ? 'large' : 'default')}
      data-shape={shape}
      data-size={resolvedSize}
      data-uniform={uniform || isIcon || undefined}
      data-variant={variant}
      disabled={isDisabled}
      title={nativeTitle ? buttonProps.title : undefined}
      type={type}
    >
      {renderContent()}
    </button>
  )
})

Button.displayName = 'Button'

/* -------------------------------------------------------------------------------------------------
 * ButtonGroup Component Props
 * -----------------------------------------------------------------------------------------------*/
export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  attached?: boolean
  children: ReactNode
  disabled?: boolean
  orientation?: 'horizontal' | 'vertical'
  shape?: ButtonShape
  size?: ButtonSize
  variant?: ButtonVariant
}

/* -------------------------------------------------------------------------------------------------
 * ButtonGroup Component
 * -----------------------------------------------------------------------------------------------*/
export function ButtonGroup({
  attached = true,
  children,
  className = '',
  disabled,
  orientation = 'horizontal',
  shape,
  size,
  variant,
  ...props
}: ButtonGroupProps): React.ReactNode {
  const isHorizontal = orientation === 'horizontal'

  const groupClasses = cx(
    'ui-button-group tw:inline-flex',
    isHorizontal ? 'tw:flex-row tw:items-center' : 'tw:flex-col tw:items-stretch',
    attached
      ? isHorizontal
        ? 'tw:[&>*:not(:first-child)]:rounded-l-none tw:[&>*:not(:last-child)]:rounded-r-none tw:[&>*:not(:first-child)]:-ml-px tw:[&>*:hover]:z-10 tw:[&>*:focus-visible]:z-20'
        : 'tw:[&>*:not(:first-child)]:rounded-t-none tw:[&>*:not(:last-child)]:rounded-b-none tw:[&>*:not(:first-child)]:-mt-px tw:[&>*:hover]:z-10 tw:[&>*:focus-visible]:z-20'
      : 'tw:gap-2',
    className,
  )

  return (
    <ButtonGroupContext.Provider value={{ attached, disabled, shape, size, variant }}>
      <div role="group" className={groupClasses} {...props}>
        {children}
      </div>
    </ButtonGroupContext.Provider>
  )
}

ButtonGroup.displayName = 'ButtonGroup'
