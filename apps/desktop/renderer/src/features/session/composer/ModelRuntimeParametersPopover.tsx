import React, { useEffect, useId, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { Popover } from '../../../components/ui/floating/Popover.js'
import { Chip } from '../../../components/ui/Chip.js'
import { InfoTooltip } from '../../../components/ui/InfoTooltip.js'
import { StopSlider } from '../../../components/ui/StopSlider.js'
import { cx } from '../../../utils/Cx.js'
import { resolveThinkingLabel } from './ThinkingLevelPopover.js'

export type ContextLimitPreset = {
  label: string
  tokens: number | null
}

export const CONTEXT_LIMIT_PRESETS: ContextLimitPreset[] = [
  { label: '模型默认', tokens: null },
  { label: '64K', tokens: 64_000 },
  { label: '128K', tokens: 128_000 },
  { label: '200K', tokens: 200_000 },
  { label: '256K', tokens: 256_000 },
  { label: '500K', tokens: 500_000 },
  { label: '1M', tokens: 1_000_000 },
]

export type ModelRuntimeParametersPopoverProps = {
  modelName: string
  physicalWindow?: number
  /** 模型物理输入上界（扣除输出预留与安全余量），预设与自定义值按它过滤/夹紧。 */
  physicalInputLimit?: number
  minimumContextTokens?: number
  maxContextTokens?: number | null
  onMaxContextTokensChange: (tokens: number | null) => void

  showThinkingOptions?: boolean
  thinkingMode?: string
  thinkingOptions?: { value: string; label: string }[]
  onThinkingChange?: (mode: string) => void

  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  onHeldChange?: (held: boolean) => void
  trigger?: React.ReactElement
}

const SECTION_TITLE_CLASS = 'tw:type-label tw:text-app-text'
const HEADING_ROW_CLASS = 'tw:flex tw:items-center tw:justify-between tw:gap-2'
const HEADING_VALUE_CLASS = 'tw:type-caption tw:text-app-text-soft'

export function formatContextLimitLabel(tokens: number | null | undefined): string {
  return tokens == null ? '模型默认' : `${tokens / 1000}K`
}

export function ModelRuntimeParametersSummary({
  maxContextTokens,
  thinkingMode = 'default',
  thinkingOptions = [],
  showThinkingOptions = true,
}: Pick<
  ModelRuntimeParametersPopoverProps,
  'maxContextTokens' | 'thinkingMode' | 'thinkingOptions' | 'showThinkingOptions'
>): React.ReactElement {
  return (
    <span className="tw:inline-flex tw:h-7 tw:shrink-0 tw:items-center tw:gap-2 tw:px-2 tw:whitespace-nowrap tw:type-control">
      {showThinkingOptions ? (
        <span>{resolveThinkingLabel(thinkingOptions, thinkingMode)}</span>
      ) : null}
      {maxContextTokens != null ? (
        <Chip variant="info">{formatContextLimitLabel(maxContextTokens)}</Chip>
      ) : !showThinkingOptions ? (
        <SlidersHorizontal size={APP_ICON_SIZES.md} aria-hidden="true" />
      ) : null}
    </span>
  )
}

export type ModelRuntimeParametersContentProps = {
  physicalWindow?: number
  physicalInputLimit?: number
  minimumContextTokens?: number
  maxContextTokens?: number | null
  onMaxContextTokensChange: (tokens: number | null) => void
  showThinkingOptions?: boolean
  thinkingMode?: string
  thinkingOptions?: { value: string; label: string }[]
  onThinkingChange?: (mode: string) => void
}

export function ModelRuntimeParametersContent({
  physicalWindow,
  physicalInputLimit,
  minimumContextTokens,
  maxContextTokens,
  onMaxContextTokensChange,
  showThinkingOptions = true,
  thinkingMode = 'default',
  thinkingOptions = [],
  onThinkingChange,
}: ModelRuntimeParametersContentProps): React.ReactElement {
  const customInputId = useId()
  const customInputRef = useRef<HTMLInputElement>(null)
  const minimumTokens = Math.max(1, minimumContextTokens ?? 1)
  const presetLimit = physicalInputLimit ?? physicalWindow

  const numericPresets = CONTEXT_LIMIT_PRESETS.flatMap((preset) =>
    preset.tokens === null ||
    preset.tokens < minimumTokens ||
    (presetLimit && preset.tokens > presetLimit)
      ? []
      : [{ label: preset.label, tokens: preset.tokens }],
  )

  type BudgetStop = {
    key: 'default' | 'preset' | 'custom'
    label: string
    tokens: number | null
  }

  const stops: BudgetStop[] = [
    { key: 'default', label: '默认', tokens: null },
    ...numericPresets.map((preset) => ({
      key: 'preset' as const,
      label: preset.label,
      tokens: preset.tokens,
    })),
    { key: 'custom', label: '自定义', tokens: null },
  ]

  const matchedPresetIndex = numericPresets.findIndex(
    (preset) => preset.tokens === maxContextTokens,
  )
  const isDefaultValue = maxContextTokens === null || maxContextTokens === undefined
  const isPresetValue = matchedPresetIndex !== -1
  const isCustomValue = !isDefaultValue && !isPresetValue

  const [isCustomMode, setIsCustomMode] = useState<boolean>(() => isCustomValue)
  const lastSubmitted = useRef<number | null | undefined>(maxContextTokens)

  useEffect(() => {
    // 只有当 maxContextTokens 的变更来自外部（非本组件刚刚提交的值）时，才同步重置 isCustomMode
    if (maxContextTokens !== lastSubmitted.current) {
      lastSubmitted.current = maxContextTokens
      setIsCustomMode(!isDefaultValue && !isPresetValue)
    }
  }, [maxContextTokens, isDefaultValue, isPresetValue])

  const customStopIndex = stops.length - 1
  const sliderIndex = isCustomMode ? customStopIndex : isDefaultValue ? 0 : 1 + matchedPresetIndex

  const [customKInput, setCustomKInput] = useState<string>(() =>
    isCustomValue && maxContextTokens ? String(maxContextTokens / 1000) : '',
  )

  useEffect(() => {
    if (isCustomValue && maxContextTokens) {
      setCustomKInput(String(maxContextTokens / 1000))
    } else if (!isCustomMode) {
      setCustomKInput('')
    }
  }, [maxContextTokens, isCustomValue, isCustomMode])

  const maxK = Math.min(physicalInputLimit ?? physicalWindow ?? 10_000_000, 10_000_000) / 1000
  const rangeHint =
    minimumTokens > maxK * 1000
      ? '可用空间不足，请调整模型或工具配置'
      : `请输入 ${minimumTokens / 1000} 至 ${maxK} K`
  const [inputError, setInputError] = useState('')
  const lastCustomK = useRef<string>(
    isCustomValue && maxContextTokens ? String(maxContextTokens / 1000) : '',
  )

  useEffect(() => {
    if (isCustomValue && maxContextTokens) {
      lastCustomK.current = String(maxContextTokens / 1000)
    }
  }, [maxContextTokens, isCustomValue])

  const handleCommitCustomK = (): void => {
    const trimmed = customKInput.trim()
    if (!trimmed) {
      if (isCustomMode) {
        setInputError(rangeHint)
      }
      return
    }
    const tokens = parseContextLimitK(trimmed, maxK * 1000, minimumTokens)
    if (tokens === null) {
      setInputError(rangeHint)
      return
    }
    setInputError('')
    setCustomKInput(String(tokens / 1000))
    lastCustomK.current = String(tokens / 1000)

    // 如果数值和预设档位重复了，失焦提交后才弹回到对应预设档位
    const matched = numericPresets.find((p) => p.tokens === tokens)
    if (matched) {
      setIsCustomMode(false)
    } else {
      setIsCustomMode(true)
    }

    if (lastSubmitted.current === tokens) return
    lastSubmitted.current = tokens
    onMaxContextTokensChange(tokens)
  }

  const handleSliderCommit = (index: number): void => {
    const stop = stops[index]
    if (!stop) return
    setInputError('')
    if (stop.key === 'default') {
      setIsCustomMode(false)
      setCustomKInput('')
      lastSubmitted.current = null
      onMaxContextTokensChange(null)
    } else if (stop.key === 'preset') {
      setIsCustomMode(false)
      setCustomKInput('')
      lastSubmitted.current = stop.tokens
      onMaxContextTokensChange(stop.tokens)
    } else {
      // 自定义档：保持处于自定义模式，绝不弹回上一档
      setIsCustomMode(true)
      let initialK = customKInput.trim() || lastCustomK.current
      if (!initialK) {
        if (maxContextTokens) {
          initialK = String(maxContextTokens / 1000)
        } else if (numericPresets.length > 0) {
          initialK = String(numericPresets[numericPresets.length - 1]!.tokens / 1000)
        } else {
          initialK = String(maxK)
        }
      }
      setCustomKInput(initialK)
      lastCustomK.current = initialK
      // 输入框聚焦全选，供用户直接输入
      setTimeout(() => {
        customInputRef.current?.focus()
        customInputRef.current?.select()
      }, 0)
    }
  }

  const thinkingIndex = Math.max(
    0,
    thinkingOptions.findIndex((option) => option.value === thinkingMode),
  )
  const [thinkingDraft, setThinkingDraft] = useState<number | null>(null)
  const thinkingLabel =
    (thinkingDraft !== null ? thinkingOptions[thinkingDraft]?.label : undefined) ??
    resolveThinkingLabel(thinkingOptions, thinkingMode)
  const [contextDraft, setContextDraft] = useState<number | null>(null)

  const activeStop = contextDraft !== null ? stops[contextDraft] : null
  const effectiveKey = activeStop
    ? activeStop.key
    : isCustomMode
      ? 'custom'
      : isDefaultValue
        ? 'default'
        : 'preset'

  const isInputDisabled = effectiveKey !== 'custom'
  const showKUnit = effectiveKey !== 'default'

  const displayInputValue = activeStop
    ? activeStop.key === 'default'
      ? '默认'
      : activeStop.key === 'preset'
        ? String((activeStop.tokens ?? 0) / 1000)
        : customKInput || lastCustomK.current || ''
    : isCustomMode
      ? customKInput
      : isDefaultValue
        ? '默认'
        : String((maxContextTokens ?? 0) / 1000)

  const contextAriaValue = effectiveKey === 'default' ? '默认' : `${displayInputValue}K`

  return (
    <div className="tw:flex tw:flex-col" onClick={(event) => event.stopPropagation()}>
      {/* Upper Section: Reasoning / Thinking Intensity */}
      <div className="tw:flex tw:flex-col tw:gap-2">
        <div className={HEADING_ROW_CLASS}>
          <span className={SECTION_TITLE_CLASS}>推理思考强度</span>
          {showThinkingOptions && thinkingOptions.length > 0 ? (
            <span className={HEADING_VALUE_CLASS}>{thinkingLabel}</span>
          ) : null}
        </div>
        {showThinkingOptions && thinkingOptions.length > 0 ? (
          <StopSlider
            labels={thinkingOptions.map((option) => option.label)}
            value={thinkingIndex}
            disabled={thinkingOptions.length === 1 || !onThinkingChange}
            ariaLabel="推理思考强度"
            ariaValueText={thinkingLabel}
            onDraftChange={setThinkingDraft}
            onCommit={(index) => {
              const option = thinkingOptions[index]
              if (option) onThinkingChange?.(option.value)
            }}
          />
        ) : (
          <span className="tw:type-caption tw:text-app-text-meta">
            当前模型不支持配置推理思考强度
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="tw:my-3.5 tw:h-px tw:bg-app-border-subtle" />

      {/* Lower Section: Max Context Tokens */}
      <div className="tw:flex tw:flex-col tw:gap-2">
        <div className={HEADING_ROW_CLASS}>
          <div className="tw:flex tw:items-center tw:gap-1.5">
            <span className={SECTION_TITLE_CLASS}>上下文预算</span>
            <InfoTooltip
              content="控制单次请求上下文规模，超限时触发压缩或暂停。发送前自动检查预算是否充足；修改从下一轮生效，当前轮次沿用已有预算。"
              size={14}
              ariaLabel="上下文预算说明"
            />
          </div>
          <div className="tw:flex tw:items-center tw:gap-1">
            <input
              ref={customInputRef}
              id={customInputId}
              type="text"
              inputMode="decimal"
              placeholder={physicalWindow ? `最大 ${maxK}` : '自定义'}
              disabled={isInputDisabled}
              aria-label="上下文预算数值（K）"
              aria-invalid={Boolean(inputError)}
              aria-describedby={inputError ? `${customInputId}-error` : undefined}
              value={displayInputValue}
              onChange={(e) => setCustomKInput(e.target.value)}
              onBlur={handleCommitCustomK}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setCustomKInput(
                    isCustomValue && maxContextTokens ? String(maxContextTokens / 1000) : '',
                  )
                  setInputError('')
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCommitCustomK()
                }
              }}
              className={cx(
                'tw:h-6 tw:w-20 tw:rounded-indicator tw:border tw:border-app-border-subtle tw:bg-transparent',
                'tw:px-2 tw:type-caption tw:text-app-text tw:outline-none tw:text-right',
                'tw:transition-colors tw:duration-feedback tw:ease-standard',
                'tw:focus:border-app-focus tw:focus:outline-none',
                'tw:disabled:cursor-default tw:disabled:opacity-60',
              )}
            />
            {showKUnit ? <span className="tw:type-caption tw:text-app-text-soft">k</span> : null}
          </div>
        </div>

        <div className="tw:flex tw:flex-col tw:gap-2">
          <StopSlider
            labels={stops.map((stop) => stop.label)}
            value={sliderIndex}
            ariaLabel="上下文预算"
            ariaValueText={contextAriaValue}
            onDraftChange={setContextDraft}
            onCommit={handleSliderCommit}
          />
        </div>

        {inputError ? (
          <span
            id={`${customInputId}-error`}
            role="alert"
            className="tw:type-caption tw:text-app-warning"
          >
            {inputError}
          </span>
        ) : maxContextTokens !== null && maxContextTokens < minimumTokens ? (
          <span role="alert" className="tw:type-caption tw:text-app-warning">
            {`系统必要开销约 ${minimumTokens / 1000}K，预算不能低于此值。`}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function ModelRuntimeParametersPopover({
  modelName,
  physicalWindow,
  physicalInputLimit,
  minimumContextTokens,
  maxContextTokens,
  onMaxContextTokensChange,
  showThinkingOptions = true,
  thinkingMode = 'default',
  thinkingOptions = [],
  onThinkingChange,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  side = 'top',
  align = 'end',
  sideOffset = 8,
  onHeldChange,
  trigger: customTrigger,
}: ModelRuntimeParametersPopoverProps): React.ReactElement {
  const [internalOpen, setInternalOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const handleOpenChange = (nextOpen: boolean): void => {
    if (isControlled) {
      controlledOnOpenChange?.(nextOpen)
    } else {
      setInternalOpen(nextOpen)
    }
  }

  useEffect(() => {
    onHeldChange?.(open || focused)
  }, [open, focused, onHeldChange])

  const defaultTrigger = (
    <button
      type="button"
      aria-label={`模型运行时参数设置：${modelName}；思考：${showThinkingOptions ? resolveThinkingLabel(thinkingOptions, thinkingMode) : '不支持'}；上下文预算：${formatContextLimitLabel(maxContextTokens)}`}
      title="模型运行时参数：思考强度与上下文限制"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cx(
        'composer-signal-trigger-btn tw:inline-flex tw:h-7 tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:p-0',
        'tw:rounded-pill tw:border-0 tw:bg-transparent tw:text-app-text-soft',
        'tw:transition-[background-color,color] tw:duration-feedback tw:ease-standard',
        'tw:hover:bg-app-hover tw:hover:text-app-text',
        'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-2',
        open && 'tw:bg-app-hover tw:text-app-text',
      )}
    >
      <ModelRuntimeParametersSummary
        maxContextTokens={maxContextTokens}
        thinkingMode={thinkingMode}
        thinkingOptions={thinkingOptions}
        showThinkingOptions={showThinkingOptions}
      />
    </button>
  )

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>{customTrigger ?? defaultTrigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="composer-runtime-params-popover-content tw:w-80 tw:p-3.5"
        >
          <ModelRuntimeParametersContent
            physicalWindow={physicalWindow}
            physicalInputLimit={physicalInputLimit}
            minimumContextTokens={minimumContextTokens}
            maxContextTokens={maxContextTokens}
            onMaxContextTokensChange={onMaxContextTokensChange}
            showThinkingOptions={showThinkingOptions}
            thinkingMode={thinkingMode}
            thinkingOptions={thinkingOptions}
            onThinkingChange={onThinkingChange}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function parseContextLimitK(
  value: string,
  maxTokens: number,
  minimumTokens = 1,
): number | null {
  if (!value.trim()) return null
  const tokens = Number(value) * 1000
  if (!Number.isFinite(tokens) || !Number.isInteger(tokens) || tokens < 1) return null
  const bounded = Math.min(tokens, maxTokens, 10_000_000)
  return bounded < minimumTokens ? null : bounded
}
