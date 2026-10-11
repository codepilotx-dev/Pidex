import { APP_ICON_SIZES, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import React, { useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../../../utils/Cx.js'
import { ReasoningMenu } from './ReasoningMenu.js'
import type { ThinkingOption } from './ThinkingLevelPopover.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import { layoutTween, motionTransition } from '../../motion/MotionTransitions.js'

/*
 * Capsule trigger for the integrated model picker. The chevron follows the
 * capsule through the `group` utility so the hover hand-off does not need a
 * descendant selector.
 */
const CAPSULE_CLASS = cx(
  'composer-model-trigger-capsule tw:group tw:inline-flex tw:h-7 tw:cursor-pointer tw:select-none tw:items-center tw:gap-1.5',
  'tw:rounded-pill tw:pl-3 tw:pr-2 tw:text-app-text-soft',
  'tw:transition-[background-color,color] tw:duration-feedback tw:ease-standard',
  'tw:hover:bg-app-hover tw:hover:text-app-text',
)
const CAPSULE_IDLE_CLASS = 'tw:bg-transparent'
const CAPSULE_ACTIVE_CLASS = 'tw:bg-app-hover tw:text-app-text'
const NAME_BUTTON_CLASS = cx(
  'composer-model-trigger-name-btn tw:inline-flex tw:cursor-pointer tw:items-center tw:border-0 tw:bg-transparent tw:p-0 tw:m-0',
  'tw:text-inherit tw:type-control tw:outline-none',
  'tw:focus-visible:rounded-xs tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-2',
)
const NAME_CLASS = 'composer-model-trigger-name tw:max-w-40 tw:truncate tw:tracking-[-0.01em]'
const EFFORT_WRAP_CLASS = 'composer-model-trigger-effort-wrap tw:inline-flex tw:items-center'
const EFFORT_BUTTON_CLASS = cx(
  'composer-model-trigger-effort-btn tw:inline-flex tw:cursor-pointer tw:items-center tw:rounded-indicator tw:border-0',
  'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_5%,transparent)] tw:px-1.5 tw:py-px tw:text-app-text-soft tw:type-label',
  'tw:transition-[background-color,color] tw:duration-feedback tw:ease-standard',
  'tw:hover:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_12%,transparent)] tw:hover:text-app-text',
  'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-1',
)
const CHEVRON_WRAP_CLASS =
  'composer-model-trigger-chevron-wrap tw:inline-flex tw:cursor-pointer tw:items-center tw:justify-center tw:text-app-text-meta tw:group-hover:text-app-text'
const CHEVRON_CLASS =
  'composer-model-trigger-chevron tw:transition-transform tw:duration-state tw:ease-standard'
const CHEVRON_OPEN_CLASS = 'tw:rotate-180 tw:text-app-text'

export type ModelSelectTriggerProps = {
  modelName: string
  tooltipTitle?: string
  loading?: boolean
  isOpen?: boolean
  onToggleOpen?: () => void
  showThinkingOptions?: boolean
  thinkingLabel?: string
  thinkingMode?: string
  thinkingPreviewMode?: string | null
  thinkingOptions?: ThinkingOption[]
  onThinkingChange?: (mode: string) => void
  onThinkingPreviewChange?: (mode: string | null) => void
  className?: string
  id?: string
}

export const ModelSelectTrigger = React.forwardRef<HTMLDivElement, ModelSelectTriggerProps>(
  function ModelSelectTrigger(
    {
      modelName,
      tooltipTitle,
      isOpen = false,
      onToggleOpen,
      showThinkingOptions = false,
      thinkingLabel,
      thinkingMode = 'default',
      thinkingPreviewMode,
      thinkingOptions = [],
      onThinkingChange,
      onThinkingPreviewChange,
      className = '',
      id = 'model-select-trigger',
    },
    ref,
  ) {
    const [effortMenuOpen, setEffortMenuOpen] = useState(false)
    const reducedMotion = usePrefersReducedMotion()
    const transition = motionTransition(reducedMotion, layoutTween)

    const active = isOpen || effortMenuOpen

    return (
      <motion.div
        layout
        transition={transition}
        ref={ref}
        id={id}
        className={cx(CAPSULE_CLASS, active ? CAPSULE_ACTIVE_CLASS : CAPSULE_IDLE_CLASS, className)}
        onClick={onToggleOpen}
      >
        <motion.button
          layout="position"
          transition={transition}
          type="button"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          title={tooltipTitle}
          aria-label={
            showThinkingOptions && thinkingLabel
              ? `模型与推理设置：${modelName}，${thinkingLabel}`
              : `模型：${modelName}`
          }
          className={NAME_BUTTON_CLASS}
          onClick={(event) => {
            // Let the parent container's onClick handle it or trigger directly
            if (onToggleOpen) {
              event.stopPropagation()
              onToggleOpen()
            }
          }}
        >
          <span className={NAME_CLASS}>{modelName}</span>
        </motion.button>

        {showThinkingOptions && thinkingLabel && onThinkingChange ? (
          <motion.div
            layout="position"
            transition={transition}
            className={EFFORT_WRAP_CLASS}
            onClick={(event) => event.stopPropagation()}
          >
            <ReasoningMenu
              open={effortMenuOpen}
              onOpenChange={setEffortMenuOpen}
              thinkingMode={thinkingMode}
              thinkingPreviewMode={thinkingPreviewMode}
              thinkingOptions={thinkingOptions}
              onThinkingChange={onThinkingChange}
              onThinkingPreviewChange={onThinkingPreviewChange}
              side="top"
              sideOffset={8}
              align="center"
              trigger={
                <button
                  type="button"
                  className={EFFORT_BUTTON_CLASS}
                  title="点击选择推理思考强度"
                  aria-label={`推理思考强度：${thinkingLabel}`}
                >
                  <span className="tw:grid tw:text-center tw:whitespace-nowrap">
                    <span className="tw:col-start-1 tw:row-start-1">{thinkingLabel}</span>
                    {['默认', ...thinkingOptions.map((option) => option.label)].map(
                      (label, index) => (
                        <span
                          key={index}
                          aria-hidden="true"
                          className="tw:invisible tw:col-start-1 tw:row-start-1"
                        >
                          {label}
                        </span>
                      ),
                    )}
                  </span>
                </button>
              }
            />
          </motion.div>
        ) : null}

        <motion.span
          layout="position"
          transition={transition}
          aria-hidden="true"
          className={CHEVRON_WRAP_CLASS}
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
