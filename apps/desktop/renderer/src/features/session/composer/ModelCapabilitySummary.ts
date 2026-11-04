import type { DesktopModelMetadata } from '../../../../shared/Types.js'

/**
 * 上下文窗口按常用口径压缩成 1M / 256K 这类短标签。
 * 1024 的整数倍按 KiB 展示（64K、256K），其余按十进制口径取整（200K）。
 */
export function formatContextWindowLabel(contextWindow?: number): string | null {
  if (!contextWindow || contextWindow <= 0) return null
  if (contextWindow >= 1_000_000) {
    const millions = Math.round((contextWindow / 1_000_000) * 10) / 10
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}M`
  }
  const kib = contextWindow / 1024
  if (Number.isInteger(kib)) return `${kib}K`
  return `${Math.round(contextWindow / 1000)}K`
}

export type ModelCapabilityBadge = {
  kind: 'context' | 'vision' | 'reasoning'
  label: string
  title: string
}

/**
 * 模型选择器悬停时展示的能力标签，顺序固定为「上下文 → 视觉 → 推理」。
 * 上下文保留文字，视觉与推理只用图标，因此标签必须带可访问名称。
 * 工具调用几乎全量支持，不占用行尾宽度。
 */
export function modelCapabilityBadges(
  metadata?: DesktopModelMetadata | null,
): ModelCapabilityBadge[] {
  if (!metadata) return []
  const badges: ModelCapabilityBadge[] = []
  const contextWindow = metadata.contextWindow
  const context = formatContextWindowLabel(contextWindow)
  if (context && contextWindow) {
    badges.push({
      kind: 'context',
      label: context,
      title: `上下文窗口 ${contextWindow.toLocaleString('en-US')} tokens`,
    })
  }
  if (metadata.vision) {
    badges.push({ kind: 'vision', label: '视觉', title: '支持图片输入' })
  }
  if (metadata.reasoning || (metadata.variants?.length ?? 0) > 0) {
    badges.push({ kind: 'reasoning', label: '推理', title: '支持推理思考' })
  }
  return badges
}
