import React, { useEffect, useId, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { Popover } from '../../../components/ui/floating/Popover.js'
import { Chip } from '../../../components/ui/Chip.js'
import { InfoTooltip } from '../../../components/ui/InfoTooltip.js'
import { StopSlider } from '../../../components/ui/StopSlider.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
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
  const minimumTokens = Math.max(1, minimumContextTokens ?? 1)
  const presetLimit = physicalInputLimit ?? physicalWindow
  const stops = CONTEXT_LIMIT_PRESETS.flatMap((preset) =>
    preset.tokens === null ||
    preset.tokens < minimumTokens ||
    (presetLimit && preset.tokens > presetLimit)
      ? []
      : [{ label: preset.label, tokens: preset.tokens }],
  )

  const contextEnabled = maxContextTokens !== null && maxContextTokens !== undefined
  const isCustomValue = contextEnabled && !stops.some((stop) => stop.tokens === maxContextTokens)
  const sliderIndex = isCustomValue
    ? nearestStopIndex(maxContextTokens, stops)
    : Math.max(
        0,
        stops.findIndex((stop) => stop.tokens === maxContextTokens),
      )

  const [customKInput, setCustomKInput] = useState<string>(() =>
    isCustomValue && maxContextTokens ? String(maxContextTokens / 1000) : '',
  )

  useEffect(() => {
    if (isCustomValue && maxContextTokens) {
      setCustomKInput(String(maxContextTokens / 1000))
    } else if (!contextEnabled) {
      setCustomKInput('')
    }
  }, [maxContextTokens, isCustomValue, contextEnabled])

  // 关掉开关不清空记忆，重新打开时回到上一次显式选择的额度。
  const lastChosen = useRef<number | null>(null)
  useEffect(() => {
    if (contextEnabled) lastChosen.current = maxContextTokens ?? null
  }, [maxContextTokens, contextEnabled])

  const maxK = Math.min(physicalInputLimit ?? physicalWindow ?? 10_000_000, 10_000_000) / 1000
  const rangeHint =
    minimumTokens > maxK * 1000
      ? '当前模型输入空间不足以容纳必要上下文，请调整模型或工具配置'
      : `请输入 ${minimumTokens / 1000} 至 ${maxK} K，最多三位小数`
  const [inputError, setInputError] = useState('')
  const lastSubmitted = useRef<number | null | undefined>(maxContextTokens)
  useEffect(() => {
    lastSubmitted.current = maxContextTokens
  }, [maxContextTokens])

  const handleCommitCustomK = (): void => {
    const trimmed = customKInput.trim()
    if (!trimmed) {
      // 空值不提交，但要给出可见反馈，避免看起来“保存成功”。
      setInputError(rangeHint)
      return
    }
    const tokens = parseContextLimitK(trimmed, maxK * 1000, minimumTokens)
    if (tokens === null) {
      setInputError(rangeHint)
      return
    }
    setInputError('')
    setCustomKInput(String(tokens / 1000))
    if (lastSubmitted.current === tokens) return
    lastSubmitted.current = tokens
    onMaxContextTokensChange(tokens)
  }

  const handleContextToggle = (enabled: boolean): void => {
    setInputError('')
    if (!enabled) {
      setCustomKInput('')
      onMaxContextTokensChange(null)
      return
    }
    if (minimumTokens > maxK * 1000) {
      setInputError(rangeHint)
      return
    }
    const remembered = lastChosen.current
    onMaxContextTokensChange(
      remembered && remembered >= minimumTokens && remembered <= maxK * 1000
        ? remembered
        : (stops[stops.length - 1]?.tokens ?? maxK * 1000),
    )
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
  const contextLabel =
    contextDraft !== null && stops[contextDraft]
      ? stops[contextDraft].label
      : formatContextLimitLabel(maxContextTokens)

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
              content="控制每次请求的输入规模，避免跨入更高的长上下文计费档位；系统会提前按预算的 80% 或模型安全输入上限触发压缩。自动压缩关闭、无法压缩或压缩请求本身超预算时暂停，不自动提高预算。设置从下一轮生效并按模型记忆；Token 数含估算，不能保证供应商最终计费档位。"
              size={14}
              ariaLabel="上下文预算说明"
            />
          </div>
          <div className="tw:flex tw:items-center tw:gap-1.5">
            <span className={HEADING_VALUE_CLASS}>{contextLabel}</span>
            <ToggleSwitch
              checked={contextEnabled}
              onChange={handleContextToggle}
              ariaLabel="启用上下文预算（关闭时使用模型默认预算）"
            />
          </div>
        </div>

        {stops.length > 0 ? (
          <div className="tw:flex tw:flex-col tw:gap-2">
            <StopSlider
              labels={stops.map((stop) => stop.label)}
              value={sliderIndex}
              disabled={!contextEnabled}
              muted={isCustomValue}
              ariaLabel="上下文预算"
              ariaValueText={contextLabel}
              onDraftChange={setContextDraft}
              onCommit={(index) => {
                const stop = stops[index]
                if (!stop) return
                setCustomKInput('')
                setInputError('')
                onMaxContextTokensChange(stop.tokens)
              }}
            />
            {isCustomValue ? (
              <span className="tw:type-caption tw:text-app-text-meta">
                当前为自定义额度，拖动滑块可切回档位。
              </span>
            ) : null}
          </div>
        ) : null}

        {minimumContextTokens !== undefined ? (
          <span
            role={contextEnabled && maxContextTokens < minimumTokens ? 'alert' : undefined}
            className={cx(
              'tw:type-caption',
              contextEnabled && maxContextTokens < minimumTokens
                ? 'tw:text-app-warning'
                : 'tw:text-app-text-meta',
            )}
          >
            {`当前系统与工具开销估算要求预算至少 ${minimumTokens / 1000}K（含提前压缩余量）；新输入仍需额外空间，低于此值不能保存。`}
          </span>
        ) : (
          <span className="tw:type-caption tw:text-app-text-meta">
            当前模型的必要上下文开销尚未估算，发送前仍会检查预算是否足够。
          </span>
        )}

        {/* Custom Input */}
        <div className="tw:mt-1 tw:flex tw:items-center tw:gap-2 tw:pt-1">
          <label
            htmlFor={customInputId}
            className="tw:shrink-0 tw:type-caption tw:text-app-text-soft"
          >
            自定义 (K):
          </label>
          <div className="tw:relative tw:flex tw:flex-1 tw:items-center">
            <input
              id={customInputId}
              type="text"
              inputMode="decimal"
              placeholder={physicalWindow ? `最大 ${maxK}` : '自定义'}
              disabled={!contextEnabled}
              aria-invalid={Boolean(inputError)}
              aria-describedby={inputError ? `${customInputId}-error` : undefined}
              value={customKInput}
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
                'tw:w-full tw:rounded-indicator tw:border tw:border-app-border-subtle tw:bg-transparent',
                'tw:px-2 tw:py-1 tw:pr-14 tw:type-caption tw:text-app-text tw:outline-none',
                'tw:transition-colors tw:duration-feedback tw:ease-standard',
                'tw:focus:border-app-focus tw:focus:outline-none',
                'tw:disabled:cursor-default tw:disabled:opacity-50',
              )}
            />
            <span className="tw:pointer-events-none tw:absolute tw:right-2 tw:type-caption tw:text-app-text-meta">
              tokens
            </span>
          </div>
        </div>
        {inputError ? (
          <span
            id={`${customInputId}-error`}
            role="alert"
            className="tw:type-caption tw:text-app-text-soft"
          >
            {inputError}
          </span>
        ) : null}
        <span className="tw:type-caption tw:text-app-text-meta">
          参数修改从下一轮生效；进行中的轮次继续使用启动时的预算。
        </span>
      </div>
    </div>
  )
}

function nearestStopIndex(tokens: number | null | undefined, stops: { tokens: number }[]): number {
  if (!tokens || stops.length === 0) return 0
  let best = 0
  for (let index = 1; index < stops.length; index += 1) {
    if (Math.abs(stops[index]!.tokens - tokens) < Math.abs(stops[best]!.tokens - tokens)) {
      best = index
    }
  }
  return best
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
