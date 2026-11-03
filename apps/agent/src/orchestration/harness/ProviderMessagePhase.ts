import { readMessagePhase } from '@pidex/shared/thread'

/** Tracks the same output slots that pi-ai exposes as contentIndex. */
export function createProviderMessagePhaseReader() {
  const slots = new Map<number, number>()
  let nextIndex = 0
  return (value: unknown) => {
    if (!value || typeof value !== 'object') return undefined
    const event = value as Record<string, unknown>
    if (event.type === 'response.created') {
      slots.clear()
      nextIndex = 0
      return { type: 'provider_text_reset' as const }
    }
    if (event.type !== 'response.output_item.added' && event.type !== 'response.output_item.done')
      return undefined
    if (typeof event.output_index !== 'number' || !event.item || typeof event.item !== 'object')
      return undefined
    const item = event.item as Record<string, unknown>
    if (!['message', 'reasoning', 'function_call', 'custom_tool_call'].includes(String(item.type)))
      return undefined
    if (!slots.has(event.output_index)) slots.set(event.output_index, nextIndex++)
    const phase = readMessagePhase(item.phase)
    return item.type === 'message' && phase
      ? {
          type: 'provider_text_phase' as const,
          contentIndex: slots.get(event.output_index)!,
          phase,
        }
      : undefined
  }
}
