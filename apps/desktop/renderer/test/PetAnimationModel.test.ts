import { describe, expect, test } from 'bun:test'
import { PET_ANIMATIONS } from '../src/features/pet/PetAnimationModel'

describe('pet animation atlas contract', () => {
  test('maps all nine semantic rows and exact frame counts', () => {
    expect(
      Object.fromEntries(
        Object.entries(PET_ANIMATIONS).map(([name, animation]) => [
          name,
          [animation.row, animation.durations.length],
        ]),
      ),
    ).toEqual({
      idle: [0, 6],
      'running-right': [1, 8],
      'running-left': [2, 8],
      waving: [3, 4],
      jumping: [4, 5],
      failed: [5, 8],
      waiting: [6, 6],
      running: [7, 6],
      review: [8, 6],
    })
  })

  test('slows idle timing while non-idle animations repeat three times', () => {
    expect(PET_ANIMATIONS.idle.durations).toEqual([1680, 660, 660, 840, 840, 1920])
    for (const [name, animation] of Object.entries(PET_ANIMATIONS)) {
      if (name === 'idle') expect(animation.repeat).toBeNull()
      else expect(animation.repeat).toBe(3)
    }
  })
})
