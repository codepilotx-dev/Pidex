import type { RenderTurnEntry } from '@pidex/session-view'

export type LatestConversationForkPoint = {
  itemId: string
  turnId: string
}

export function findLatestConversationForkPoint(
  turns: readonly RenderTurnEntry[],
): LatestConversationForkPoint | null {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex]
    if (!turn) continue
    for (let itemIndex = turn.assistantResultItems.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.assistantResultItems[itemIndex]
      if (item?.status !== 'completed') continue
      return { itemId: item.id, turnId: item.turnId }
    }
  }
  return null
}
