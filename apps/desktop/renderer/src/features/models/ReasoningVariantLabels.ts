/**
 * Presentation vocabulary for model reasoning variants.
 *
 * Variant ids come from the provider catalogue. With the two-layer
 * `optionSpecs` model the agent now returns the concrete value strings (e.g.
 * `disabled`, `enabled`, `none`, `high`, `max`) in the order declared by
 * `reasoningLevel.values`. The order and the ids are authoritative, so this
 * module only adds display names for the values that have a known semantic
 * meaning and falls back to the raw id for anything else.
 */
const REASONING_VARIANT_LABELS: Record<string, string> = {
  default: '默认',
  off: '关闭',
  none: '关闭',
  disabled: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
  enabled: '开启',
  adaptive: '自适应',
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
 * Builds the selectable reasoning levels for one model.
 *
 * The agent returns `Model.Info.variants` in the exact order declared by
 * `optionSpecs.reasoningLevel.values` (or the legacy seven-level order when no
 * explicit values exist). Render them in that order and use the actual variant
 * id as the value; unknown ids are displayed verbatim rather than mapped onto a
 * fixed semantic scale.
 *
 * Returns `undefined` when the model advertises no variants so callers keep
 * their existing fallback (default thinking modes), instead of forcing an empty
 * variant menu.
 */
export function buildVariantOptions(
  variants: readonly string[] | undefined,
): VariantOption[] | undefined {
  if (!variants || variants.length === 0) return undefined
  return variants.map((variantID) => ({
    value: variantID,
    label: resolveVariantLabel(variantID),
  }))
}
