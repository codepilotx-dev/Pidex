import { useRef } from 'react'
import type React from 'react'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { cx } from '../../utils/Cx.js'

type Option<T extends string> = {
  value: T
  label: React.ReactNode
  disabled?: boolean
}

export type SegmentedControlSize = 'xs' | 'sm' | 'md' | 'lg'
export type SegmentedControlShape = 'default' | 'pill'

type Props<T extends string> = {
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  ariaLabel?: string
  className?: string
  overflowMode?: 'auto' | 'fit'
  semantics?: 'group' | 'tabs'
  variant?: 'default' | 'inset'
  size?: SegmentedControlSize
  shape?: SegmentedControlShape
  getTabId?: (value: T) => string
  getPanelId?: (value: T) => string
}

const SIZE_BOX_CLASS: Record<SegmentedControlSize, string> = {
  xs: 'tw:h-6 tw:min-h-6 tw:px-2 tw:py-0.5',
  sm: 'tw:h-[30px] tw:min-h-[30px] tw:px-2.5 tw:py-1',
  md: 'tw:h-9 tw:min-h-9 tw:px-3.5 tw:py-1.5',
  lg: 'tw:h-[42px] tw:min-h-[42px] tw:px-4.5 tw:py-2',
}

const RADIUS_CLASSES: Record<SegmentedControlShape, Record<SegmentedControlSize, string>> = {
  default: {
    xs: 'tw:rounded-item',
    sm: 'tw:rounded-sm',
    md: 'tw:rounded-md',
    lg: 'tw:rounded-md',
  },
  pill: {
    xs: 'tw:rounded-full',
    sm: 'tw:rounded-full',
    md: 'tw:rounded-full',
    lg: 'tw:rounded-full',
  },
}

const ROOT_GAP_CLASS: Record<SegmentedControlSize, string> = {
  xs: 'tw:gap-0.5',
  sm: 'tw:gap-1',
  md: 'tw:gap-1.5',
  lg: 'tw:gap-2',
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  overflowMode = 'auto',
  semantics = 'group',
  variant = 'default',
  size = 'xs',
  shape = 'default',
  getTabId,
  getPanelId,
}: Props<T>): React.ReactNode {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const isTabs = semantics === 'tabs'
  const resolvedSize = size ?? 'xs'
  const resolvedShape = shape ?? 'default'

  const rootClassName = cx(
    'segmented-control',
    'tw:inline-flex',
    overflowMode === 'auto' ? 'tw:min-w-0' : 'tw:w-max',
    overflowMode === 'auto' ? 'tw:max-w-full' : 'tw:max-w-none',
    'tw:items-center',
    ROOT_GAP_CLASS[resolvedSize],
    overflowMode === 'auto' ? 'tw:overflow-x-auto' : 'tw:overflow-visible',
    overflowMode === 'auto' ? 'tw:overflow-y-hidden' : false,
    variant === 'inset'
      ? cx(
          'tw:bg-app-underlay',
          resolvedShape === 'pill' ? 'tw:rounded-full' : 'tw:rounded-control',
          resolvedSize === 'lg' ? 'tw:p-1' : 'tw:p-0.5',
        )
      : false,
    className,
  )
  /*
   * 默认变体里 hover 仍要压过选中态（原始 SCSS 的 :hover:not(:disabled) 特异度更高），
   * 任意 variant 的 utility 在 Tailwind 输出中排在 data / aria 变体之后，正好复现该顺序；
   * inset 变体相反（选中态压过 hover），用普通 hover variant 即可。
   */
  const itemClassName = cx(
    'segmented-control-item tw:inline-flex tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:border tw:border-transparent tw:bg-transparent tw:text-app-text-meta tw:type-control',
    SIZE_BOX_CLASS[resolvedSize],
    RADIUS_CLASSES[resolvedShape][resolvedSize],
    'tw:transition-[background-color,border-color,box-shadow,color] tw:duration-feedback tw:ease-standard',
    'tw:data-[state=on]:text-app-text tw:aria-pressed:text-app-text tw:aria-selected:text-app-text',
    variant === 'inset'
      ? 'tw:not-disabled:hover:bg-app-hover tw:not-disabled:hover:text-app-text tw:data-[state=on]:bg-app-canvas tw:aria-pressed:bg-app-canvas tw:aria-selected:bg-app-canvas tw:data-[state=on]:shadow-sm tw:aria-pressed:shadow-sm tw:aria-selected:shadow-sm'
      : 'tw:[&:enabled:hover]:bg-app-hover tw:[&:enabled:hover]:text-app-text tw:data-[state=on]:bg-app-selected tw:aria-pressed:bg-app-selected tw:aria-selected:bg-app-selected',
    'tw:disabled:cursor-default tw:disabled:opacity-45',
    'tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus',
    // forced-colors 高亮来自 base.css 的 token 重映射（border-strong / selected → Highlight）。
    'tw:forced-colors:data-[state=on]:border-app-border-strong tw:forced-colors:data-[state=on]:bg-app-selected tw:forced-colors:data-[state=on]:text-app-on-accent tw:forced-colors:data-[state=on]:forced-color-adjust-none',
    'tw:forced-colors:aria-pressed:border-app-border-strong tw:forced-colors:aria-pressed:bg-app-selected tw:forced-colors:aria-pressed:text-app-on-accent tw:forced-colors:aria-pressed:forced-color-adjust-none',
    'tw:forced-colors:aria-selected:border-app-border-strong tw:forced-colors:aria-selected:bg-app-selected tw:forced-colors:aria-selected:text-app-on-accent tw:forced-colors:aria-selected:forced-color-adjust-none',
  )

  if (!isTabs) {
    return (
      <ToggleGroup.Root
        aria-label={ariaLabel}
        className={rootClassName}
        data-shape={resolvedShape}
        data-size={resolvedSize}
        data-variant={variant}
        onValueChange={(nextValue) => {
          // 当前组件始终要求有一个选中值；点击已选项时 Radix 会传空字符串，忽略即可。
          if (nextValue) onChange(nextValue as T)
        }}
        orientation="horizontal"
        type="single"
        value={value}
      >
        {options.map((option) => (
          <ToggleGroup.Item
            className={itemClassName}
            disabled={option.disabled}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    )
  }

  function selectByIndex(index: number): void {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    itemRefs.current[index]?.focus()
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    const nextIndex = segmentedTabIndexAfterKey(event.key, index, options.length)
    if (nextIndex === null) return
    event.preventDefault()
    selectByIndex(nextIndex)
  }

  return (
    <div
      aria-label={ariaLabel}
      className={rootClassName}
      data-shape={resolvedShape}
      data-size={resolvedSize}
      data-variant={variant}
      role="tablist"
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            aria-controls={getPanelId?.(option.value)}
            aria-selected={selected}
            className={itemClassName}
            disabled={option.disabled}
            id={getTabId?.(option.value)}
            key={option.value}
            onClick={() => {
              if (!option.disabled) onChange(option.value)
            }}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            ref={(element) => {
              itemRefs.current[index] = element
            }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function segmentedTabIndexAfterKey(
  key: string,
  index: number,
  optionCount: number,
): number | null {
  if (optionCount <= 0) return null
  if (key === 'ArrowRight') return (index + 1) % optionCount
  if (key === 'ArrowLeft') return (index - 1 + optionCount) % optionCount
  if (key === 'Home') return 0
  if (key === 'End') return optionCount - 1
  return null
}
