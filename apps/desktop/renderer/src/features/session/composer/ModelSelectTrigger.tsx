import { APP_ICON_SIZES, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import React, { useEffect, useRef, useState } from 'react'
import { mergeRefs } from '../../../components/ui/floating/Primitives.js'
import { motion, type HTMLMotionProps } from 'motion/react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { cx } from '../../../utils/Cx.js'
import { ReasoningMenu } from './ReasoningMenu.js'
import type { ThinkingOption } from './ThinkingLevelPopover.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import { layoutTween, motionTransition } from '../../motion/MotionTransitions.js'
import { splitComposerModelName } from './ComposerModelName.js'

/*
 * Capsule trigger for the integrated model picker. The chevron follows the
 * capsule through the `group` utility so the hover hand-off does not need a
 * descendant selector. The capsule hugs its content with a 16rem cap, and the
 * existing motion layout animates width changes when the selected model changes,
 * so long names neither leave dead space nor snap the composer layout. Only
 * names beyond the cap collapse the vendor prefix and truncate.
 *
 * `compact` swaps the text/effort region for a single sparkle icon; the footer
 * space allocator decides when to request it, and `ModelPickerPopover`
 * re-exposes the reasoning control in its panel so the level stays editable.
 */
const CAPSULE_CLASS = cx(
  'composer-model-trigger-capsule tw:group tw:inline-flex tw:h-7 tw:min-w-0 tw:max-w-64 tw:cursor-pointer tw:select-none tw:items-center tw:gap-1.5',
  'tw:rounded-pill tw:pl-3 tw:pr-2 tw:text-app-text-soft',
  'tw:transition-[background-color,color] tw:duration-feedback tw:ease-standard',
  'tw:hover:bg-app-hover tw:hover:text-app-text',
)
const CAPSULE_IDLE_CLASS = 'tw:bg-transparent'
const CAPSULE_ACTIVE_CLASS = 'tw:bg-app-hover tw:text-app-text'
const NAME_BUTTON_CLASS = cx(
  'composer-model-trigger-name-btn tw:inline-flex tw:min-w-0 tw:cursor-pointer tw:items-center tw:border-0 tw:bg-transparent tw:p-0 tw:m-0',
  'tw:text-inherit tw:type-control tw:outline-none',
  'tw:focus-visible:rounded-xs tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-2',
)
const NAME_CLASS =
  'composer-model-trigger-name tw:flex tw:min-w-0 tw:items-center tw:tracking-[-0.01em]'
const NAME_PREFIX_CLASS =
  'composer-model-trigger-name-prefix tw:min-w-0 tw:truncate tw:shrink-[999] tw:text-app-text-meta'
const NAME_SEPARATOR_CLASS =
  'composer-model-trigger-name-separator tw:shrink-0 tw:text-app-text-meta'
const NAME_MODEL_CLASS = 'composer-model-trigger-name-model tw:min-w-0 tw:truncate'
const EFFORT_WRAP_CLASS =
  'composer-model-trigger-effort-wrap tw:inline-flex tw:shrink-0 tw:items-center'
const EFFORT_BUTTON_CLASS = cx(
  'composer-model-trigger-effort-btn tw:inline-flex tw:cursor-pointer tw:items-center tw:rounded-indicator tw:border-0',
  'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_5%,transparent)] tw:px-1.5 tw:py-px tw:text-app-text-soft tw:type-label',
  'tw:transition-[background-color,color] tw:duration-feedback tw:ease-standard',
  'tw:hover:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_12%,transparent)] tw:hover:text-app-text',
  'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-1',
)
const CHEVRON_WRAP_CLASS =
  'composer-model-trigger-chevron-wrap tw:inline-flex tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:text-app-text-meta tw:group-hover:text-app-text'
/** The secondary chevron yields to footer space before the allocator flips the capsule to its icon state. */
const CHEVRON_FOOTER_CLASS = 'composer-footer-secondary-chevron'
const CHEVRON_CLASS =
  'composer-model-trigger-chevron tw:transition-transform tw:duration-state tw:ease-standard'
const CHEVRON_OPEN_CLASS = 'tw:rotate-180 tw:text-app-text'
const COMPACT_ICON_CLASS = 'tw:shrink-0'

export type ModelReasoningControlProps = {
  thinkingLabel: string
  thinkingMode: string
  thinkingPreviewMode?: string | null
  thinkingOptions: ThinkingOption[]
  onThinkingChange: (mode: string) => void
  onThinkingPreviewChange?: (mode: string | null) => void
  /** Reports the menu being open or the trigger holding focus so callers can hold it. */
  onHeldChange?: (held: boolean) => void
  /** Controlled open state; the capsule trigger drives it so the layout stays stable. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}

/*
 * The reasoning-strength pill. Lives inside the model capsule in the full
 * state, and the model popover reuses the same control in its reasoning slot
 * once the footer allocator hides the label.
 */
export function ModelReasoningControl({
  thinkingLabel,
  thinkingMode,
  thinkingPreviewMode,
  thinkingOptions,
  onThinkingChange,
  onThinkingPreviewChange,
  onHeldChange,
  open: controlledOpen,
  onOpenChange,
  side = 'top',
  align = 'center',
  sideOffset = 8,
}: ModelReasoningControlProps): React.ReactNode {
  const [internalOpen, setInternalOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  useEffect(() => {
    onHeldChange?.(open || focused)
  }, [open, focused, onHeldChange])

  return (
    <ReasoningMenu
      open={open}
      onOpenChange={setOpen}
      thinkingMode={thinkingMode}
      thinkingPreviewMode={thinkingPreviewMode}
      thinkingOptions={thinkingOptions}
      onThinkingChange={onThinkingChange}
      onThinkingPreviewChange={onThinkingPreviewChange}
      side={side}
      sideOffset={sideOffset}
      align={align}
      trigger={
        <button
          type="button"
          className={EFFORT_BUTTON_CLASS}
          title="点击选择推理思考强度"
          aria-label={`推理思考强度：${thinkingLabel}`}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <span className="tw:grid tw:text-center tw:whitespace-nowrap">
            <span className="tw:col-start-1 tw:row-start-1">{thinkingLabel}</span>
            {['默认', ...thinkingOptions.map((option) => option.label)].map((label, index) => (
              <span
                key={index}
                aria-hidden="true"
                className="tw:invisible tw:col-start-1 tw:row-start-1"
              >
                {label}
              </span>
            ))}
          </span>
        </button>
      }
    />
  )
}

export type ModelSelectTriggerProps = Omit<HTMLMotionProps<'button'>, 'children'> & {
  modelName: string
  tooltipTitle?: string
  loading?: boolean
  isOpen?: boolean
  showThinkingOptions?: boolean
  thinkingLabel?: string
  thinkingMode?: string
  thinkingPreviewMode?: string | null
  thinkingOptions?: ThinkingOption[]
  onThinkingChange?: (mode: string) => void
  onThinkingPreviewChange?: (mode: string | null) => void
  /**
   * Render the single smart/reasoning icon instead of the model name and
   * reasoning label. The footer space allocator flips this when the text
   * capsule does not fit; clicking the icon still opens the model popover.
   */
  compact?: boolean
  /** Reports open reasoning menu or keyboard focus so the allocator holds this trigger. */
  onHeldChange?: (held: boolean) => void
  className?: string
  id?: string
}

export const ModelSelectTrigger = React.forwardRef<HTMLButtonElement, ModelSelectTriggerProps>(
  function ModelSelectTrigger(
    {
      modelName,
      tooltipTitle,
      loading: _loading,
      isOpen = false,
      showThinkingOptions = false,
      thinkingLabel,
      thinkingMode = 'default',
      thinkingPreviewMode,
      thinkingOptions = [],
      onThinkingChange,
      onThinkingPreviewChange,
      compact = false,
      onHeldChange,
      className = '',
      id = 'model-select-trigger',
      ...buttonProps
    },
    ref,
  ) {
    const [effortMenuOpen, setEffortMenuOpen] = useState(false)
    const [reasoningHeld, setReasoningHeld] = useState(false)
    const [focused, setFocused] = useState(false)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const reducedMotion = usePrefersReducedMotion()
    const transition = motionTransition(reducedMotion, layoutTween)

    const active = isOpen || effortMenuOpen
    const { prefix, model } = splitComposerModelName(modelName)
    useEffect(() => {
      onHeldChange?.(focused || reasoningHeld)
    }, [focused, reasoningHeld, onHeldChange])

    // The capsule always opens the model popover; compact keeps the name as
    // accessible text while the visible content becomes the icon.
    const nameButton = (
      <motion.button
        layout="position"
        transition={transition}
        type="button"
        id={id}
        ref={mergeRefs(ref, buttonRef)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={tooltipTitle}
        aria-label={
          showThinkingOptions && thinkingLabel
            ? `模型与推理设置：${modelName}，${thinkingLabel}`
            : `模型：${modelName}`
        }
        className={NAME_BUTTON_CLASS}
        {...buttonProps}
        onFocus={(event) => {
          setFocused(true)
          buttonProps.onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          buttonProps.onBlur?.(event)
        }}
      >
        {compact ? (
          <Sparkles aria-hidden="true" className={COMPACT_ICON_CLASS} size={APP_ICON_SIZES.md} />
        ) : (
          <span className={NAME_CLASS}>
            {prefix ? (
              <>
                <span className={NAME_PREFIX_CLASS}>{prefix}</span>
                <span className={NAME_SEPARATOR_CLASS}>/</span>
              </>
            ) : null}
            <span className={NAME_MODEL_CLASS}>{model}</span>
          </span>
        )}
      </motion.button>
    )

    return (
      <motion.div
        layout
        transition={transition}
        className={cx(CAPSULE_CLASS, active ? CAPSULE_ACTIVE_CLASS : CAPSULE_IDLE_CLASS, className)}
        data-compact={compact ? 'true' : undefined}
        onClick={(event) => {
          if (!(event.target as Element).closest('button')) buttonRef.current?.click()
        }}
      >
        {compact ? (
          nameButton
        ) : (
          <>
            {nameButton}
            {showThinkingOptions && thinkingLabel && onThinkingChange ? (
              <motion.div
                layout="position"
                transition={transition}
                className={EFFORT_WRAP_CLASS}
                onClick={(event) => event.stopPropagation()}
              >
                <ModelReasoningControl
                  thinkingLabel={thinkingLabel}
                  thinkingMode={thinkingMode}
                  thinkingPreviewMode={thinkingPreviewMode}
                  thinkingOptions={thinkingOptions}
                  onThinkingChange={onThinkingChange}
                  onThinkingPreviewChange={onThinkingPreviewChange}
                  onHeldChange={setReasoningHeld}
                  open={effortMenuOpen}
                  onOpenChange={setEffortMenuOpen}
                />
              </motion.div>
            ) : null}
          </>
        )}

        <motion.span
          layout="position"
          transition={transition}
          aria-hidden="true"
          className={cx(CHEVRON_WRAP_CLASS, CHEVRON_FOOTER_CLASS)}
        >
          <ChevronDown
            size={APP_ICON_SIZES.sm}
            strokeWidth={APP_ICON_STROKE_WIDTH}
            className={cx(CHEVRON_CLASS, isOpen && CHEVRON_OPEN_CLASS)}
          />
        </motion.span>
      </motion.div>
    )
  },
)
