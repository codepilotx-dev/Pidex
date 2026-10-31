import React, { useEffect, useId, useRef, useState } from 'react'
import { Popover } from '../../../components/ui/floating/Popover.js'
import { InfoTooltip } from '../../../components/ui/InfoTooltip.js'
import { cx } from '../../../utils/Cx.js'
import {
  ContextThinkingSignalIcon,
  type ContextCapacityTier,
} from './ContextThinkingSignalIcon.js'

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
  tier?: ContextCapacityTier
  trigger?: React.ReactElement
}

const SECTION_TITLE_CLASS = 'tw:type-label tw:text-app-text'
const OPTION_CHIP_BASE = cx(
  'tw:inline-flex tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-indicator tw:border tw:px-2.5 tw:py-1 tw:type-caption',
  'tw:transition-[background-color,border-color,color] tw:duration-feedback tw:ease-standard',
)
const OPTION_CHIP_SELECTED = cx(
  'tw:border-app-border-strong tw:bg-app-selected tw:text-app-text',
)
const OPTION_CHIP_IDLE = cx(
  'tw:border-app-border-subtle tw:bg-transparent tw:text-app-text-soft tw:hover:bg-app-hover tw:hover:text-app-text',
)

export type ModelRuntimeParametersContentProps = {
  physicalWindow?: number
  physicalInputLimit?: number
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
  maxContextTokens,
  onMaxContextTokensChange,
  showThinkingOptions = true,
  thinkingMode = 'default',
  thinkingOptions = [],
  onThinkingChange,
}: ModelRuntimeParametersContentProps): React.ReactElement {
  const customInputId = useId()
  const isCustomValue =
    maxContextTokens !== null &&
    maxContextTokens !== undefined &&
    !CONTEXT_LIMIT_PRESETS.some((p) => p.tokens === maxContextTokens)

  const [customKInput, setCustomKInput] = useState<string>(() =>
    isCustomValue && maxContextTokens ? String(maxContextTokens / 1000) : '',
  )

  useEffect(() => {
    if (isCustomValue && maxContextTokens) {
      setCustomKInput(String(maxContextTokens / 1000))
    } else if (maxContextTokens === null) {
      setCustomKInput('')
    }
  }, [maxContextTokens, isCustomValue])

  const maxK = Math.min(physicalInputLimit ?? physicalWindow ?? 10_000_000, 10_000_000) / 1000
  const [inputError, setInputError] = useState('')
  const lastSubmitted = useRef<number | null | undefined>(maxContextTokens)
  useEffect(() => { lastSubmitted.current = maxContextTokens }, [maxContextTokens])

  const handleCommitCustomK = (): void => {
    const trimmed = customKInput.trim()
    if (!trimmed) {
      // 空值不提交，但要给出可见反馈，避免看起来“保存成功”。
      setInputError(`请输入 0.001 至 ${maxK} K，最多三位小数`)
      return
    }
    const tokens = parseContextLimitK(trimmed, maxK * 1000)
    if (tokens === null) {
      setInputError(`请输入 0.001 至 ${maxK} K，最多三位小数`)
      return
    }
    setInputError('')
    setCustomKInput(String(tokens / 1000))
    if (lastSubmitted.current === tokens) return
    lastSubmitted.current = tokens
    onMaxContextTokensChange(tokens)
  }

  const presetLimit = physicalInputLimit ?? physicalWindow
  const filteredPresets = CONTEXT_LIMIT_PRESETS.filter(
    (preset) => preset.tokens === null || !presetLimit || preset.tokens <= presetLimit,
  )

  return (
    <div className="tw:flex tw:flex-col" onClick={(event) => event.stopPropagation()}>
      {/* Upper Section: Reasoning / Thinking Intensity */}
      <div className="tw:flex tw:flex-col tw:gap-2">
        <span className={SECTION_TITLE_CLASS}>推理思考强度</span>
        {showThinkingOptions && thinkingOptions.length > 0 && onThinkingChange ? (
          <div className="tw:flex tw:flex-wrap tw:gap-1.5">
            {thinkingOptions.map((option) => {
              const isSelected = option.value === thinkingMode
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onThinkingChange(option.value)}
                  className={cx(
                    OPTION_CHIP_BASE,
                    isSelected ? OPTION_CHIP_SELECTED : OPTION_CHIP_IDLE,
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
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
        <div className="tw:flex tw:items-center tw:gap-1.5">
          <span className={SECTION_TITLE_CLASS}>最大上下文限制</span>
          <InfoTooltip
            content="新上限从下一轮对话起生效；若调低后的上限低于当前已用上下文，下一轮发送前按自动压缩设置压缩或阻止发送，该次摘要请求本身仍需处理当前已有上下文（也可选择新建或分叉会话）。"
            size={14}
            ariaLabel="最大上下文限制说明"
          />
        </div>

        {/* Presets */}
        <div className="tw:flex tw:flex-wrap tw:gap-1.5">
          {filteredPresets.map((preset) => {
            const isSelected = maxContextTokens === preset.tokens
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setCustomKInput('')
                  onMaxContextTokensChange(preset.tokens)
                }}
                className={cx(
                  OPTION_CHIP_BASE,
                  isSelected ? OPTION_CHIP_SELECTED : OPTION_CHIP_IDLE,
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>

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
              aria-invalid={Boolean(inputError)}
              aria-describedby={inputError ? `${customInputId}-error` : undefined}
              value={customKInput}
              onChange={(e) => setCustomKInput(e.target.value)}
              onBlur={handleCommitCustomK}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setCustomKInput(maxContextTokens ? String(maxContextTokens / 1000) : '')
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
              )}
            />
            <span className="tw:pointer-events-none tw:absolute tw:right-2 tw:type-caption tw:text-app-text-meta">
              tokens
            </span>
          </div>
        </div>
        {inputError ? <span id={`${customInputId}-error`} role="alert" className="tw:type-caption tw:text-app-text-soft">{inputError}</span> : null}
        <span className="tw:type-caption tw:text-app-text-meta">参数修改从下一轮生效；进行中的轮次继续使用启动时的预算。</span>
      </div>
    </div>
  )
}

export function ModelRuntimeParametersPopover({
  modelName,
  physicalWindow,
  physicalInputLimit,
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
  tier,
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
      aria-label={`模型运行时参数设置：${modelName}；思考：${thinkingOptions.find((option) => option.value === thinkingMode)?.label ?? thinkingMode}；上下文：${maxContextTokens == null ? '模型默认' : `${maxContextTokens / 1000}K`}`}
      title="模型运行时参数：思考强度与上下文限制"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cx(
        'composer-signal-trigger-btn tw:inline-flex tw:size-7 tw:cursor-pointer tw:items-center tw:justify-center',
        'tw:rounded-pill tw:border-0 tw:bg-transparent tw:text-app-text-soft',
        'tw:transition-[background-color,color] tw:duration-feedback tw:ease-standard',
        'tw:hover:bg-app-hover tw:hover:text-app-text',
        open && 'tw:bg-app-hover tw:text-app-text',
      )}
    >
      <ContextThinkingSignalIcon
        tier={tier}
        maxContextTokens={maxContextTokens}
        physicalWindow={physicalWindow}
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

export function parseContextLimitK(value: string, maxTokens: number): number | null {
  if (!value.trim()) return null
  const tokens = Number(value) * 1000
  if (!Number.isFinite(tokens) || !Number.isInteger(tokens) || tokens < 1) return null
  return Math.min(tokens, maxTokens, 10_000_000)
}
