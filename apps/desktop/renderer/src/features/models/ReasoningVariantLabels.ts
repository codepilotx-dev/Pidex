/**
 * Presentation vocabulary for model reasoning variants.
 *
 * Variant ids come from the provider catalogue (see the agent's `ThinkingLevel`
 * union) and carry no display name, so the Chinese labels live here and are
 * shared by every surface that offers a reasoning level.
 */
const REASONING_VARIANT_LABELS: Record<string, string> = {
  default: '默认',
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
}

export type VariantOption = {
  value: string
  label: string
}

/** Falls back to the raw variant id so new catalogue levels stay selectable. */
export function resolveVariantLabel(variantID: string): string {
  return REASONING_VARIANT_LABELS[variantID] ?? variantID
}

/**
 * Builds the selectable reasoning levels for one model, always keeping
 * `default` first so "no explicit variant" stays the leading choice.
 */
export function buildVariantOptions(
  variants: readonly string[] | undefined,
  defaultLabel = REASONING_VARIANT_LABELS.default,
): VariantOption[] {
  return [
    { value: 'default', label: defaultLabel },
    ...(variants ?? [])
      .filter((variantID) => variantID !== 'default')
      .map((variantID) => ({
        value: variantID,
        label: resolveVariantLabel(variantID),
      })),
  ]
}
