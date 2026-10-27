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
import { cn } from '../../utils/Cn.js'
import { useResolvedButtonSize } from './TabStripButtonContext.js'
import { Spinner, type SpinnerProps } from './Spinner.js'
import type { AppIconSize } from './IconTokens.js'
import { mergeRefs } from './floating/Primitives.js'

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

/** `round` is the default corner family; `default` is an alias kept for callers. */
export type ButtonShape = 'round' | 'default' | 'pill'
export type ButtonRadius = 'default' | 'large'
export type ButtonPosition = 'sidebar'

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
  /** Named appearance preset; `sidebar` carries the whole sidebar entry look. */
  'data-position'?: ButtonPosition
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
 * Attribute contract
 * -----------------------------------------------------------------------------------------------*/

export const SPINNER_CLASS = 'tw:shrink-0'

export const ICON_SLOT_CLASS = 'tw:inline-flex tw:shrink-0 tw:items-center'

/*
 * Only real differences are emitted: `round` is the default corner family,
 * `default` layout is the absence of `data-layout`, and the default icon size is
 * the absence of `data-icon-size`.
 */
export type ButtonAppearance = {
  'data-color'?: ButtonColor
  'data-icon-only'?: true
  'data-grow'?: true
  'data-icon-size'?: AppIconSize
  'data-layout'?: Exclude<ButtonContentLayout, 'default'>
  'data-position'?: ButtonPosition
  'data-shape': Exclude<ButtonShape, 'default'>
  'data-shrink'?: true
  'data-size': ButtonSize
  'data-variant': ButtonVariant
}

const normalizeShape = (shape: ButtonShape | undefined): Exclude<ButtonShape, 'default'> =>
  shape === 'pill' ? 'pill' : 'round'

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
  const position = buttonProps['data-position']

  const resolvedSize = useResolvedButtonSize(propSize ?? groupContext?.size ?? 'default')
  const variant = resolveVariant(propVariant ?? groupContext?.variant, color)
  const shape = normalizeShape(
    propShape ?? (radius === 'large' ? 'pill' : undefined) ?? groupContext?.shape,
  )
  const isDisabled = disabled || loading || Boolean(groupContext?.disabled)
  const isIcon = isIconOnly || uniform

  const spinnerSize = iconSize
    ? ICON_OVERRIDE_SPINNER_SIZE[iconSize]
    : SIZE_SPINNER_SIZE[resolvedSize]
  const spinner = <Spinner className={SPINNER_CLASS} size={spinnerSize} aria-hidden="true" />

  /* The caller's class is the only class a Button emits. */
  const hostClass = cn(className) || undefined

  /*
   * Ghost aliases map to the `ghost` variant; the alias itself survives as
   * `data-color` so the tertiary ink difference stays a real attribute.
   */
  const colorAttribute =
    variant === 'ghost' && color && color !== 'ghostSecondary' && color !== 'ghostActive'
      ? color
      : undefined

  const appearance: ButtonAppearance = {
    'data-color': colorAttribute,
    'data-grow': fullWidth || undefined,
    'data-shrink': allowShrink || undefined,
    'data-icon-only': isIcon || undefined,
    'data-icon-size': iconSize,
    'data-layout': contentLayout === 'balanced' ? 'balanced' : undefined,
    'data-position': position,
    'data-shape': shape,
    'data-size': resolvedSize,
    'data-variant': variant,
  } as ButtonAppearance

  const renderContent = (): ReactNode => {
    if (loading) {
      if (loadingText) {
        return (
          <>
            {spinner}
            <span>{loadingText}</span>
          </>
        )
      }
      if (isIconOnly) return spinner
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
          {leftIcon ? <span className={ICON_SLOT_CLASS}>{leftIcon}</span> : null}
          {children}
          {rightIcon ? <span className={ICON_SLOT_CLASS}>{rightIcon}</span> : null}
        </>
      )
    }

    return children
  }

  if (asChild && isValidElement(children)) {
    const childElement = children as ReactElement<
      HTMLAttributes<HTMLElement> & { disabled?: boolean }
    >
    const childRef = (childElement as any).ref
    return cloneElement(childElement, {
      ref: ref || childRef ? (mergeRefs(ref, childRef) as any) : undefined,
      className: cn(hostClass, childElement.props.className) || undefined,
      'aria-busy': loading ? true : undefined,
      'aria-disabled': isDisabled ? true : undefined,
      'data-active':
        active ||
        buttonProps['data-active'] ||
        (childElement.props as any)['data-active'] ||
        undefined,
      ...appearance,
    } as any)
  }

  return (
    <button
      {...buttonProps}
      {...appearance}
      ref={ref}
      aria-busy={loading ? true : undefined}
      aria-label={
        isIcon && buttonProps.title ? buttonProps.title : (buttonProps['aria-label'] ?? undefined)
      }
      className={hostClass}
      data-active={active || buttonProps['data-active'] || undefined}
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
 * Shared button styles
 * -----------------------------------------------------------------------------------------------*/

/*
 * Every appearance rule a Button owns lives here once and is mounted by the
 * renderer root (`<ButtonStyles />`). Only native tags carrying the emitted
 * attributes are matched, so native business rows, cards and other controls are
 * never restyled and no identity class is needed.
 *
 * The block sits in the `primitives` cascade layer; caller utilities stay in
 * `utilities`, so an explicit `className` keeps overriding these defaults.
 */
const BUTTON_STYLES = String.raw`
@layer primitives {
  /* Every shared Button reads one control typography role, never a local font. */
  :is(button, a)[data-size][data-variant] {
    --button-padding-inline: var(--cpx-comp-button-padding-inline);
    box-sizing: border-box;
    display: inline-flex;
    min-inline-size: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--cpx-sys-radius-full);
    margin: 0;
    padding: var(--cpx-comp-button-padding-block) var(--button-padding-inline);
    background: transparent;
    color: var(--cpx-sys-color-fg-secondary);
    white-space: nowrap;
    font: var(--cpx-sys-type-control);
    letter-spacing: var(--cpx-sys-letter-spacing-control);
    text-decoration: none;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-app-region: no-drag;
    transition-property: background-color, border-color, color, opacity, transform, box-shadow;
    transition-duration: var(--cpx-sys-motion-feedback);
    transition-timing-function: var(--cpx-sys-ease-standard);
  }

  :is(button, a)[data-size][data-variant]:focus-visible {
    outline: 2px solid var(--cpx-sys-color-border-focus);
    outline-offset: 2px;
  }

  /*
   * A shrinking label keeps the size's own inline padding on each side instead
   * of collapsing into the border. The size sets --button-padding-inline.
   */
  :is(button, a)[data-size][data-variant][data-shrink] {
    min-inline-size: 0;
    padding-inline: max(
      var(--button-padding-inline),
      calc((100% - var(--button-padding-inline) * 2) * 0.9)
    );
  }

  :is(button, a)[data-size][data-variant][data-grow] {
    inline-size: 100%;
  }

  /* Disabled and loading buttons keep their state rules but take no pointer. */
  :is(button, a)[data-size][data-variant]:is(:disabled, [aria-disabled='true']) {
    cursor: not-allowed;
    opacity: 0.4;
    pointer-events: none;
  }

  :is(button, a)[data-size][data-variant][aria-pressed='true'] {
    color: var(--cpx-sys-color-fg-primary);
  }

  :is(button, a)[data-size][data-variant][aria-pressed='true']:not(:hover) {
    background: var(--cpx-sys-color-selected);
  }

  /* Size tiers: height, inline padding, gap and corner family. */
  :is(button, a)[data-size][data-variant][data-size='xs'],
  :is(button, a)[data-size][data-variant][data-size='compact'] {
    --button-box-size: 1.5rem;
    --button-padding-inline: var(--cpx-comp-button-padding-inline-compact);
    block-size: var(--button-box-size);
    gap: var(--cpx-sys-space-1);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-xs);
  }

  :is(button, a)[data-size][data-variant][data-size='default'] {
    --button-box-size: 1.5rem;
    --button-padding-inline: var(--cpx-comp-button-padding-inline-compact);
    block-size: var(--button-box-size);
    gap: var(--cpx-sys-space-1);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-full);
  }

  :is(button, a)[data-size][data-variant][data-size='iconMd'],
  :is(button, a)[data-size][data-variant][data-size='iconSm'] {
    --button-box-size: 1.5rem;
    --button-padding-inline: 0.125rem;
    block-size: var(--button-box-size);
    gap: var(--cpx-sys-space-1);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-xs);
  }

  :is(button, a)[data-size][data-variant][data-size='sm'] {
    --button-box-size: 1.875rem;
    --button-padding-inline: 0.625rem;
    block-size: var(--button-box-size);
    gap: var(--cpx-comp-button-gap-compact);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-sm);
  }

  :is(button, a)[data-size][data-variant][data-size='composer'] {
    --button-box-size: var(--cpx-comp-button-size-toolbar);
    --button-padding-inline: var(--cpx-sys-space-2);
    block-size: var(--button-box-size);
    gap: var(--cpx-comp-button-gap);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-full);
  }

  :is(button, a)[data-size][data-variant][data-size='composerSm'] {
    --button-box-size: var(--cpx-comp-button-size-toolbar);
    --button-padding-inline: 0.375rem;
    block-size: var(--button-box-size);
    gap: var(--cpx-sys-space-1);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-full);
  }

  :is(button, a)[data-size][data-variant][data-size='composerUtility'] {
    --button-box-size: var(--cpx-comp-button-size-toolbar);
    --button-padding-inline: 0.375rem;
    block-size: var(--button-box-size);
    gap: var(--cpx-comp-button-gap);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-full);
  }

  :is(button, a)[data-size][data-variant][data-size='icon'] {
    --button-box-size: var(--cpx-comp-button-size-toolbar);
    --button-padding-inline: var(--cpx-sys-space-1);
    block-size: var(--button-box-size);
    gap: var(--cpx-sys-space-1);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-sm);
  }

  :is(button, a)[data-size][data-variant][data-size='toolbar'] {
    --button-box-size: var(--cpx-comp-button-size-toolbar);
    --button-padding-inline: var(--cpx-sys-space-2);
    block-size: var(--button-box-size);
    gap: var(--cpx-comp-button-gap-compact);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-sm);
  }

  :is(button, a)[data-size][data-variant][data-size='toolbarLabel'] {
    --button-box-size: var(--cpx-comp-button-size-toolbar);
    --button-padding-inline: 0.625rem;
    block-size: var(--button-box-size);
    gap: var(--cpx-comp-button-gap-compact);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-sm);
  }

  :is(button, a)[data-size][data-variant][data-size='medium'] {
    --button-box-size: var(--cpx-comp-button-size-medium);
    --button-padding-inline: var(--cpx-sys-space-4);
    block-size: var(--button-box-size);
    gap: var(--cpx-comp-button-gap);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-md);
  }

  :is(button, a)[data-size][data-variant][data-size='md'] {
    --button-box-size: var(--cpx-comp-button-size-large);
    --button-padding-inline: 0.875rem;
    block-size: var(--button-box-size);
    gap: var(--cpx-sys-space-2);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-md);
  }

  :is(button, a)[data-size][data-variant][data-size='lg'] {
    --button-box-size: 2.625rem;
    --button-padding-inline: 1.125rem;
    block-size: var(--button-box-size);
    gap: var(--cpx-comp-button-gap);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-md);
  }

  :is(button, a)[data-size][data-variant][data-size='iconLarge'] {
    --button-box-size: var(--cpx-comp-button-size-large);
    --button-padding-inline: 0;
    block-size: var(--button-box-size);
    gap: var(--cpx-sys-space-2);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-md);
  }

  :is(button, a)[data-size][data-variant][data-size='large'] {
    --button-box-size: var(--cpx-comp-button-size-large);
    --button-padding-inline: var(--cpx-sys-space-5);
    block-size: var(--button-box-size);
    gap: var(--cpx-sys-space-2);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-full);
  }

  :is(button, a)[data-size][data-variant][data-size='tabStripAction'] {
    --button-box-size: var(--cpx-comp-button-size-large);
    --button-padding-inline: var(--cpx-sys-space-2);
    block-size: var(--button-box-size);
    gap: var(--cpx-comp-button-gap-compact);
    padding-inline: var(--button-padding-inline);
    border-radius: var(--cpx-sys-radius-md);
  }

  /*
   * The pill shape collapses every tier into a capsule. Other shapes keep the
   * tier's own corner family; round is the default and still emits the attribute.
   */
  :is(button, a)[data-size][data-variant][data-shape='pill'] {
    border-radius: var(--cpx-sys-radius-full);
  }

  /* Icon slots, direct icons and spinners align and scale with the button. */
  :is(button, a)[data-size][data-variant] > :is(svg, span) {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
  }

  :is(button, a)[data-size][data-variant]:is([data-size='xs'], [data-size='sm'], [data-size='compact'], [data-size='composerSm'], [data-size='iconMd'], [data-size='iconSm']) > svg:not([data-icon-kind='artwork']) {
    inline-size: var(--cpx-sys-icon-size-sm);
    block-size: var(--cpx-sys-icon-size-sm);
  }

  :is(button, a)[data-size][data-variant]:is([data-size='default'], [data-size='md'], [data-size='composer'], [data-size='composerUtility'], [data-size='icon'], [data-size='medium'], [data-size='tabStripAction'], [data-size='toolbar'], [data-size='toolbarLabel']) > svg:not([data-icon-kind='artwork']) {
    inline-size: var(--cpx-sys-icon-size);
    block-size: var(--cpx-sys-icon-size);
  }

  :is(button, a)[data-size][data-variant]:is([data-size='lg'], [data-size='iconLarge'], [data-size='large']) > svg:not([data-icon-kind='artwork']) {
    inline-size: var(--cpx-sys-icon-size-lg);
    block-size: var(--cpx-sys-icon-size-lg);
  }


  /* An explicit icon size wins over the tier; artwork keeps its own box. */
  :is(button, a)[data-size][data-variant][data-icon-size='sm'] > svg:not([data-icon-kind='artwork']) {
    inline-size: var(--cpx-sys-icon-size-sm);
    block-size: var(--cpx-sys-icon-size-sm);
  }

  :is(button, a)[data-size][data-variant][data-icon-size='md'] > svg:not([data-icon-kind='artwork']) {
    inline-size: var(--cpx-sys-icon-size);
    block-size: var(--cpx-sys-icon-size);
  }

  :is(button, a)[data-size][data-variant][data-icon-size='lg'] > svg:not([data-icon-kind='artwork']) {
    inline-size: var(--cpx-sys-icon-size-lg);
    block-size: var(--cpx-sys-icon-size-lg);
  }

  /* Label icons (and nested slots) scale with the label instead of the tier. */
  :is(button, a)[data-size][data-variant]:not([data-icon-only]) :is(svg, span) > svg:not([data-icon-kind='artwork']) {
    inline-size: var(--inline-icon-size, 1em);
    block-size: var(--inline-icon-size, 1em);
  }

  :is(button, a)[data-size][data-variant]:not([data-icon-only]) > .ui-spinner {
    inline-size: var(--inline-icon-size, 1em);
    block-size: var(--inline-icon-size, 1em);
  }

  /* A trailing chevron belongs to the label, so it follows the font size. */
  :is(button, a)[data-size][data-variant]:not([data-icon-only]) > :is(.lucide-chevron-down, .lucide-chevron-up, .lucide-chevron-right):last-child {
    inline-size: var(--inline-icon-size, 1em);
    block-size: var(--inline-icon-size, 1em);
  }

  /* Icon-only buttons are square and carry no inline padding. */
  :is(button, a)[data-size][data-variant][data-icon-only] {
    --button-box-size: var(--cpx-comp-button-size-toolbar);
    aspect-ratio: 1;
    block-size: var(--button-box-size);
    padding: 0;
  }

  :is(button, a)[data-size][data-variant][data-icon-only]:is([data-size='xs'], [data-size='compact'], [data-size='default'], [data-size='iconMd'], [data-size='iconSm']) {
    --button-box-size: var(--cpx-comp-button-size-compact);
  }

  :is(button, a)[data-size][data-variant][data-icon-only][data-size='sm'] {
    --button-box-size: 1.875rem;
  }

  :is(button, a)[data-size][data-variant][data-icon-only]:is([data-size='composer'], [data-size='composerSm'], [data-size='composerUtility'], [data-size='icon'], [data-size='toolbar'], [data-size='toolbarLabel']) {
    --button-box-size: var(--cpx-comp-button-size-toolbar);
  }

  :is(button, a)[data-size][data-variant][data-icon-only][data-size='medium'] {
    --button-box-size: var(--cpx-comp-button-size-medium);
  }

  :is(button, a)[data-size][data-variant][data-icon-only]:is([data-size='md'], [data-size='lg'], [data-size='iconLarge'], [data-size='large'], [data-size='tabStripAction']) {
    --button-box-size: var(--cpx-comp-button-size-large);
  }

  /* A balanced label centers its text between symmetric icon slots. */
  :is(button, a)[data-size][data-variant][data-layout='balanced'] {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
  }

  /* Variant surfaces. */
  :is(button, a)[data-size][data-variant][data-variant='primary'] {
    border-color: var(--cpx-sys-color-border-strong);
    background: var(--cpx-comp-button-primary-bg);
    color: var(--cpx-comp-button-primary-fg);
    box-shadow: var(--cpx-sys-shadow-resting);
  }

  :is(button, a)[data-size][data-variant][data-variant='primary']:hover:not(:disabled, [aria-disabled='true']),
  :is(button, a)[data-size][data-variant][data-variant='primary'][data-state='open'],
  :is(button, a)[data-size][data-variant][data-variant='primary'][data-active] {
    background: var(--cpx-comp-button-primary-hover-bg);
  }

  :is(button, a)[data-size][data-variant][data-variant='accent'] {
    border-color: transparent;
    background: var(--cpx-sys-color-accent);
    color: var(--cpx-sys-color-fg-on-accent);
    box-shadow: var(--cpx-sys-shadow-resting);
  }

  :is(button, a)[data-size][data-variant][data-variant='accent']:hover:not(:disabled, [aria-disabled='true']),
  :is(button, a)[data-size][data-variant][data-variant='accent'][data-state='open'],
  :is(button, a)[data-size][data-variant][data-variant='accent'][data-active] {
    background: var(--cpx-comp-button-accent-hover-bg);
  }

  :is(button, a)[data-size][data-variant][data-variant='secondary'] {
    border-color: transparent;
    background: var(--cpx-comp-button-bg);
    color: var(--cpx-comp-button-fg);
    box-shadow: var(--cpx-sys-shadow-resting);
  }

  :is(button, a)[data-size][data-variant][data-variant='secondary']:hover:not(:disabled, [aria-disabled='true']) {
    border-color: var(--cpx-sys-color-border-strong);
    background: var(--cpx-comp-button-secondary-hover-bg);
  }

  :is(button, a)[data-size][data-variant][data-variant='secondary']:is([data-state='open'], [data-active]) {
    background: var(--cpx-comp-button-secondary-hover-bg);
  }

  :is(button, a)[data-size][data-variant][data-variant='outline'] {
    border-color: var(--cpx-sys-color-border-subtle);
    background: transparent;
    color: var(--cpx-sys-color-fg-secondary);
  }

  :is(button, a)[data-size][data-variant][data-variant='outline']:hover:not(:disabled, [aria-disabled='true']) {
    border-color: var(--cpx-sys-color-border-strong);
    background: var(--cpx-sys-color-hover);
    color: var(--cpx-sys-color-fg-primary);
  }

  :is(button, a)[data-size][data-variant][data-variant='outline']:is([data-state='open'], [data-active]) {
    background: var(--cpx-sys-color-hover);
    color: var(--cpx-sys-color-fg-primary);
  }

  :is(button, a)[data-size][data-variant]:is([data-variant='ghost'], [data-variant='text']) {
    border-color: transparent;
    background: transparent;
    color: var(--cpx-sys-color-fg-secondary);
  }

  :is(button, a)[data-size][data-variant]:is([data-variant='ghost'], [data-variant='text']):hover:not(:disabled, [aria-disabled='true']) {
    background: var(--cpx-sys-color-hover);
    color: var(--cpx-sys-color-fg-primary);
  }

  :is(button, a)[data-size][data-variant]:is([data-variant='ghost'], [data-variant='text']):is([data-state='open'], [data-active]) {
    background: var(--cpx-sys-color-hover);
    color: var(--cpx-sys-color-fg-primary);
  }

  /* Text variants stay transparent on hover; only their ink changes. */
  :is(button, a)[data-size][data-variant][data-variant='text']:hover:not(:disabled, [aria-disabled='true']),
  :is(button, a)[data-size][data-variant][data-variant='text']:is([data-state='open'], [data-active]) {
    background: transparent;
    color: var(--cpx-sys-color-fg-primary);
  }

  :is(button, a)[data-size][data-variant][data-variant='danger'] {
    border-color: transparent;
    background: var(--cpx-sys-color-danger);
    color: var(--cpx-sys-color-fg-on-accent);
    box-shadow: var(--cpx-sys-shadow-resting);
  }

  :is(button, a)[data-size][data-variant][data-variant='danger']:hover:not(:disabled, [aria-disabled='true']),
  :is(button, a)[data-size][data-variant][data-variant='danger']:is([data-state='open'], [data-active]) {
    filter: brightness(1.1);
  }

  :is(button, a)[data-size][data-variant][data-variant='danger-outline'] {
    border-color: var(--cpx-comp-button-danger-outline-border);
    background: transparent;
    color: var(--cpx-sys-color-charts-red);
  }

  :is(button, a)[data-size][data-variant][data-variant='danger-outline']:hover:not(:disabled, [aria-disabled='true']) {
    border-color: var(--cpx-sys-color-danger);
    background: var(--cpx-comp-button-danger-outline-hover-bg);
  }

  :is(button, a)[data-size][data-variant][data-variant='danger-outline']:is([data-state='open'], [data-active]) {
    background: var(--cpx-comp-button-danger-outline-hover-bg);
  }

  :is(button, a)[data-size][data-variant][data-variant='subtle-accent'] {
    border-color: var(--cpx-sys-color-accent-subtle-border);
    background: var(--cpx-sys-color-accent-subtle-bg);
    color: var(--cpx-sys-color-accent-fg);
  }

  :is(button, a)[data-size][data-variant][data-variant='subtle-accent']:hover:not(:disabled, [aria-disabled='true']),
  :is(button, a)[data-size][data-variant][data-variant='subtle-accent']:is([data-state='open'], [data-active]) {
    background: var(--cpx-sys-color-accent-subtle-hover-bg);
  }

  /* Ghost aliases keep the tertiary ink used by sidebar and summary actions. */
  :is(button, a)[data-size][data-variant][data-color='ghost'],
  :is(button, a)[data-size][data-variant][data-color='ghostTertiary'] {
    color: var(--cpx-sys-color-fg-tertiary);
  }

  :is(button, a)[data-size][data-variant][data-color='ghostSecondary'] {
    color: var(--cpx-sys-color-fg-secondary);
  }

  :is(button, a)[data-size][data-variant][data-color='ghostActive'] {
    color: var(--cpx-sys-color-fg-primary);
  }

  @media (forced-colors: active) {
    :is(button, a)[data-size][data-variant][data-variant='primary'] {
      border-color: ButtonText;
      background: ButtonFace;
      color: ButtonText;
    }

    :is(button, a)[data-size][data-variant][data-variant='secondary'] {
      border-color: ButtonText;
      background: transparent;
    }

    :is(button, a)[data-size][data-variant][data-variant='text'] {
      border-color: transparent;
      background: transparent;
      color: ButtonText;
    }
  }

  /*
   * The sidebar preset carries the whole sidebar entry look: ink, hover, expanded
   * and selected states. It binds to the attribute rather than to a container, so
   * the right dock can request the same look directly.
   */
  :is(button, a)[data-size][data-variant][data-position='sidebar'] {
    color: var(--cpx-sys-color-fg-secondary);
  }

  :is(button, a)[data-size][data-variant][data-position='sidebar']:hover,
  :is(button, a)[data-size][data-variant][data-position='sidebar'][data-state='open'] {
    background: var(--cpx-sys-color-hover);
    color: var(--cpx-sys-color-fg-primary);
  }

  :is(button, a)[data-size][data-variant][data-position='sidebar']:is([data-active]:not(:hover), [aria-pressed='true']) {
    background: var(--cpx-sys-color-selected);
    color: var(--cpx-sys-color-fg-primary);
  }

  :is(button, a)[data-size][data-variant][data-position='sidebar']:is(:disabled, [aria-disabled='true']) {
    background: transparent;
    color: var(--cpx-sys-color-fg-disabled);
  }

  /* ButtonGroup: orientation, gap, segment seams and hover stacking. */
  [role='group'][data-orientation][data-attached] {
    display: inline-flex;
    gap: var(--cpx-sys-space-2);
  }

  [role='group'][data-orientation='horizontal'][data-attached] {
    flex-direction: row;
    align-items: center;
  }

  [role='group'][data-orientation='vertical'][data-attached] {
    flex-direction: column;
    align-items: stretch;
  }

  [role='group'][data-attached]:not([data-attached='false']) {
    gap: 0;
  }

  [role='group'][data-attached]:not([data-attached='false']) > :not(:first-child) {
    z-index: var(--cpx-sys-z-local);
  }

  [role='group'][data-attached]:not([data-attached='false']) > :is(:hover, :focus-visible) {
    z-index: var(--cpx-sys-z-sticky);
  }

  [role='group'][data-attached]:not([data-attached='false'])[data-orientation='horizontal'] > :not(:first-child) {
    margin-inline-start: -1px;
    border-start-start-radius: 0;
    border-end-start-radius: 0;
  }

  [role='group'][data-attached]:not([data-attached='false'])[data-orientation='horizontal'] > :not(:last-child) {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
  }

  [role='group'][data-attached]:not([data-attached='false'])[data-orientation='vertical'] > :not(:first-child) {
    margin-block-start: -1px;
    border-start-start-radius: 0;
    border-start-end-radius: 0;
  }

  [role='group'][data-attached]:not([data-attached='false'])[data-orientation='vertical'] > :not(:last-child) {
    border-end-start-radius: 0;
    border-end-end-radius: 0;
  }
}
`

/** Mounts the shared button stylesheet once at the renderer root. */
export function ButtonStyles(): React.ReactNode {
  return <style dangerouslySetInnerHTML={{ __html: BUTTON_STYLES }} />
}

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
  className,
  disabled,
  orientation = 'horizontal',
  shape,
  size,
  variant,
  ...props
}: ButtonGroupProps): React.ReactNode {
  return (
    <ButtonGroupContext.Provider value={{ attached, disabled, shape, size, variant }}>
      <div
        role="group"
        {...props}
        className={cn(className) || undefined}
        data-attached={attached ? '' : 'false'}
        data-orientation={orientation}
      >
        {children}
      </div>
    </ButtonGroupContext.Provider>
  )
}

ButtonGroup.displayName = 'ButtonGroup'
