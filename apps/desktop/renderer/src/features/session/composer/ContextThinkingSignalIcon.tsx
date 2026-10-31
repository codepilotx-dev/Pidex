import React from 'react'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { cx } from '../../../utils/Cx.js'

export type ContextCapacityTier = 'cyan' | 'jade' | 'amber' | 'violet'

export function getContextCapacityTier(
  maxContextTokens?: number | null,
  physicalWindow?: number,
): ContextCapacityTier {
  const effective = maxContextTokens
    ? Math.min(maxContextTokens, physicalWindow ?? maxContextTokens)
    : (physicalWindow ?? 128_000)

  if (effective <= 128_000) return 'cyan'
  if (effective <= 256_000) return 'jade'
  if (effective <= 500_000) return 'amber'
  return 'violet'
}

export const CONTEXT_TIER_TEXT_CLASSES: Record<ContextCapacityTier, string> = {
  cyan: 'tw:text-app-context-cyan',
  jade: 'tw:text-app-context-jade',
  amber: 'tw:text-app-context-amber',
  violet: 'tw:text-app-context-violet',
}

export function resolveSignalActiveBars(
  showThinkingOptions: boolean,
  thinkingMode: string,
  thinkingOptions: { value: string }[],
): number {
  if (!showThinkingOptions) return 0
  const normalized = thinkingMode.toLowerCase()
  if (normalized === 'disabled' || normalized === 'off' || normalized === 'none') return 0

  const activeOptions = thinkingOptions.filter(
    (o) => !['disabled', 'off', 'none'].includes(o.value.toLowerCase()),
  )
  if (activeOptions.length > 0) {
    const idx = activeOptions.findIndex((o) => o.value === thinkingMode)
    if (idx >= 0) {
      return Math.max(1, Math.min(5, Math.round(((idx + 1) / activeOptions.length) * 5)))
    }
  }

  switch (normalized) {
    case 'minimal':
      return 1
    case 'low':
      return 2
    case 'medium':
      return 3
    case 'high':
      return 4
    case 'max':
    case 'enabled':
      return 5
    default:
      return 3
  }
}

export type ContextThinkingSignalIconProps = {
  tier?: ContextCapacityTier
  maxContextTokens?: number | null
  physicalWindow?: number
  thinkingMode?: string
  thinkingOptions?: { value: string; label: string }[]
  showThinkingOptions?: boolean
  size?: number
  className?: string
}

export function ContextThinkingSignalIcon({
  tier: explicitTier,
  maxContextTokens,
  physicalWindow,
  thinkingMode = 'default',
  thinkingOptions = [],
  showThinkingOptions = true,
  size = APP_ICON_SIZES.md,
  className = '',
}: ContextThinkingSignalIconProps): React.ReactElement {
  const tier = explicitTier ?? getContextCapacityTier(maxContextTokens, physicalWindow)
  const tierClass = CONTEXT_TIER_TEXT_CLASSES[tier]
  const activeBars = resolveSignalActiveBars(showThinkingOptions, thinkingMode, thinkingOptions)
  const isThinkingOff = activeBars === 0

  // 5 signal bars from left to right:
  // x: 1.5, 4.5, 7.5, 10.5, 13.5
  // y: 12, 9.5, 7, 4.5, 2
  // height: 3, 5.5, 8, 10.5, 13
  const bars = [
    { x: 1.5, y: 12, width: 2, height: 3 },
    { x: 4.5, y: 9.5, width: 2, height: 5.5 },
    { x: 7.5, y: 7, width: 2, height: 8 },
    { x: 10.5, y: 4.5, width: 2, height: 10.5 },
    { x: 13.5, y: 2, width: 2, height: 13 },
  ]

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cx('tw:inline-block tw:shrink-0', tierClass, className)}
      aria-hidden="true"
    >
      {bars.map((bar, index) => {
        const isActive = !isThinkingOff && index < activeBars
        return (
          <rect
            key={index}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={0.8}
            fill="currentColor"
            style={
              !isThinkingOff && !isActive
                ? { fill: 'var(--cpx-sys-color-fg-tertiary)' }
                : undefined
            }
          />
        )
      })}
      {isThinkingOff ? (
        <line
          x1="2"
          y1="14"
          x2="14"
          y2="2"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  )
}
