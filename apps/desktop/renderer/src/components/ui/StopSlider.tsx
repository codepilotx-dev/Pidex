import React, { useRef, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { cx } from '../../utils/Cx.js'
import './StopSlider.css'

/** 与 .stop-slider-thumb 的尺寸一致；填充宽度按它扣除两端，让滑块中心落在档位点上。 */
const THUMB_SIZE = 28

export type StopSliderProps = {
  /** 每个档位的无障碍名称，数量即档位数。 */
  labels: string[]
  value: number
  disabled?: boolean
  /** 当前值不落在任何档位（例如自定义额度）时置灰，但仍可拖动切回档位。 */
  muted?: boolean
  ariaLabel: string
  /** 读屏朗读的当前值，通常比档位名更完整（如「128K」）。 */
  ariaValueText: string
  /** 松手、点击或键盘操作时提交一次；拖动过程不写回。 */
  onCommit: (index: number) => void
  /** 拖动中的临时档位（null 表示未在拖动），供调用方实时展示待提交的值。 */
  onDraftChange?: (index: number | null) => void
  className?: string
  showLabels?: boolean
}

/**
 * 离散档位滑块：胖胶囊轨道 + 内嵌档位圆点 + 圆形滑块。
 * 拖动只更新本地视觉稿，onValueCommit 时才提交，避免一次拖动写穿成多次持久化。
 */
export function StopSlider({
  labels,
  value,
  disabled = false,
  muted = false,
  ariaLabel,
  ariaValueText,
  onCommit,
  onDraftChange,
  className,
  showLabels = false,
}: StopSliderProps): React.ReactElement {
  const rootRef = useRef<HTMLSpanElement>(null)
  const committedRef = useRef(false)
  const [draft, setDraft] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const isSingleStop = labels.length <= 1
  const effectiveDisabled = disabled || isSingleStop
  const lastIndex = Math.max(0, labels.length - 1)
  const index = isSingleStop ? 1 : Math.min(Math.max(draft ?? value, 0), lastIndex)
  const progress = isSingleStop ? 1 : lastIndex === 0 ? 0 : index / lastIndex
  const fillWidth = isSingleStop
    ? '100%'
    : index === 0
      ? '0px'
      : `calc(${THUMB_SIZE / 2}px + (100% - ${THUMB_SIZE}px) * ${progress})`

  const updateDraft = (next: number | null): void => {
    if (isSingleStop) return
    setDraft(next)
    onDraftChange?.(next)
  }

  const indexAtPoint = (clientX: number): number => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect || lastIndex === 0 || isSingleStop) return 0
    const offset = clientX - rect.left - THUMB_SIZE / 2
    const usable = rect.width - THUMB_SIZE
    return Math.min(lastIndex, Math.max(0, Math.round((offset / usable) * lastIndex)))
  }

  return (
    <div className={cx('stop-slider-field', className)}>
      <Slider.Root
        ref={rootRef}
        className="stop-slider"
        min={0}
        // Radix 用 max - min 计算位置，单档也需要非零内部范围。
        max={Math.max(1, lastIndex)}
        step={1}
        value={[isSingleStop ? 1 : index]}
        disabled={effectiveDisabled}
        data-muted={muted && !effectiveDisabled ? 'true' : undefined}
        onPointerDown={() => {
          committedRef.current = false
        }}
        onPointerMove={(event) => {
          if (effectiveDisabled || event.pointerType === 'touch') return
          // 轨道上的圆点被 Root 覆盖，用坐标反馈悬停，避免圆点截获拖拽。
          setHovered(indexAtPoint(event.clientX))
        }}
        onPointerLeave={() => setHovered(null)}
        onPointerUp={(event) => {
          setHovered(null)
          if (effectiveDisabled || committedRef.current) return
          // 指针点选（尤其落在档位圆点上）有时不会触发 onValueCommit：显式提交指针处的档位，
          // 否则会出现「滑块跳到新档但页脚仍旧值、重开丢失」的不一致。
          committedRef.current = true
          const target = indexAtPoint(event.clientX)
          updateDraft(null)
          if (target !== value || muted) onCommit(target)
        }}
        onKeyDown={() => {
          committedRef.current = false
        }}
        onValueChange={(next) => updateDraft(next[0] ?? 0)}
        onValueCommit={(next) => {
          if (effectiveDisabled || committedRef.current) return
          const committed = next[0] ?? 0
          committedRef.current = true
          updateDraft(null)
          if (committed !== value || muted) onCommit(committed)
        }}
      >
        <Slider.Track className="stop-slider-track">
          <span className="stop-slider-fill" style={{ width: fillWidth }} />
          <span
            aria-hidden="true"
            className={cx('stop-slider-stops', isSingleStop && 'tw:justify-end')}
          >
            {labels.map((label, stopIndex) => (
              <span
                key={`${label}:${stopIndex}`}
                className="stop-slider-stop"
                data-filled={isSingleStop || stopIndex <= index ? 'true' : undefined}
                data-hovered={!effectiveDisabled && hovered === stopIndex ? 'true' : undefined}
              />
            ))}
          </span>
        </Slider.Track>
        <Slider.Thumb
          className="stop-slider-thumb"
          aria-label={ariaLabel}
          aria-valuemax={Math.max(1, lastIndex)}
          aria-valuetext={ariaValueText}
        />
      </Slider.Root>
      {/* 档位文案说明每格代表什么（默认隐藏，标题处已有实时反馈） */}
      {showLabels ? (
        <div
          aria-hidden="true"
          className={cx('stop-slider-labels', isSingleStop && 'tw:justify-end')}
        >
          {labels.map((label, stopIndex) => (
            <span
              key={`${label}:${stopIndex}`}
              className="stop-slider-label"
              data-active={!effectiveDisabled && !muted && stopIndex === index ? 'true' : undefined}
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
