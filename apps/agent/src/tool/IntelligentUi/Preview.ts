import { VISUALIZATION_MAX_SOURCE, type VisualizationPreview } from '@pidex/shared/visualization'

export function visualizationPreview(
  input: unknown,
): Pick<
  VisualizationPreview,
  'title' | 'summary' | 'initialHeight' | 'css' | 'html' | 'cssComplete'
> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  const text = (key: string, max: number) =>
    typeof value[key] === 'string' ? (value[key] as string).slice(0, max) : ''
  const css = text('css', VISUALIZATION_MAX_SOURCE / 2)
  const html = text('html', VISUALIZATION_MAX_SOURCE / 2)
  return {
    title: text('title', 200),
    summary: text('summary', 4000),
    initialHeight:
      typeof value.initialHeight === 'number' && Number.isFinite(value.initialHeight)
        ? Math.max(50, Math.min(4000, value.initialHeight))
        : 240,
    css,
    html,
    cssComplete: typeof value.css === 'string' && typeof value.html === 'string',
  }
}
