import { describe, expect, test } from 'bun:test'
import type { RenderTurnEntry } from '@pidex/session-view'

import { findLatestConversationForkPoint } from '../src/features/session/workflow/fork/LatestConversationForkPoint.js'

function turn(
  turnId: string,
  items: Array<{ id: string; status: 'completed' | 'streaming' }>,
): RenderTurnEntry {
  return {
    id: turnId,
    assistantResultItems: items.map((item) => ({
      ...item,
      turnId,
    })),
  } as unknown as RenderTurnEntry
}

describe('标题菜单继续点', () => {
  test('选择最后一个已完成的 assistant result', () => {
    expect(
      findLatestConversationForkPoint([
        turn('turn-1', [{ id: 'item-1', status: 'completed' }]),
        turn('turn-2', [
          { id: 'item-2', status: 'completed' },
          { id: 'item-streaming', status: 'streaming' },
        ]),
      ]),
    ).toEqual({ itemId: 'item-2', turnId: 'turn-2' })
  })

  test('跳过仅有 streaming 结果的末尾 turn', () => {
    expect(
      findLatestConversationForkPoint([
        turn('turn-1', [{ id: 'item-1', status: 'completed' }]),
        turn('turn-2', [{ id: 'item-2', status: 'streaming' }]),
      ]),
    ).toEqual({ itemId: 'item-1', turnId: 'turn-1' })
  })

  test('空对话和没有完成结果的对话不可继续', () => {
    expect(findLatestConversationForkPoint([])).toBeNull()
    expect(
      findLatestConversationForkPoint([turn('turn-1', [{ id: 'item-1', status: 'streaming' }])]),
    ).toBeNull()
  })
})
