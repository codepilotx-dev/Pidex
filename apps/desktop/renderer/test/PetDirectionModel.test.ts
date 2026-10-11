import { describe, expect, test } from 'bun:test'
import {
  resolvePetDragAnimation,
  resolvePetLookFrame,
} from '../src/features/pet/PetDirectionModel.js'

const MASCOT = {
  left: 100,
  top: 200,
  width: 192,
  height: 208,
}

describe('pet v2 pointer direction', () => {
  test('maps sixteen clockwise sectors into atlas rows 9 and 10', () => {
    const center = {
      x: MASCOT.left + MASCOT.width / 2,
      y: MASCOT.top + MASCOT.height / 2,
    }
    const radius = 100
    const frames = Array.from({ length: 16 }, (_, sector) => {
      const radians = (sector * 22.5 * Math.PI) / 180
      return resolvePetLookFrame(
        MASCOT,
        {
          x: center.x + Math.sin(radians) * radius,
          y: center.y - Math.cos(radians) * radius,
        },
        2,
      )
    })

    expect(frames).toEqual([
      { rowIndex: 9, columnIndex: 0 },
      { rowIndex: 9, columnIndex: 1 },
      { rowIndex: 9, columnIndex: 2 },
      { rowIndex: 9, columnIndex: 3 },
      { rowIndex: 9, columnIndex: 4 },
      { rowIndex: 9, columnIndex: 5 },
      { rowIndex: 9, columnIndex: 6 },
      { rowIndex: 9, columnIndex: 7 },
      { rowIndex: 10, columnIndex: 0 },
      { rowIndex: 10, columnIndex: 1 },
      { rowIndex: 10, columnIndex: 2 },
      { rowIndex: 10, columnIndex: 3 },
      { rowIndex: 10, columnIndex: 4 },
      { rowIndex: 10, columnIndex: 5 },
      { rowIndex: 10, columnIndex: 6 },
      { rowIndex: 10, columnIndex: 7 },
    ])
  })

  test('does not override v1 animation or a pointer at the mascot center', () => {
    const center = {
      x: MASCOT.left + MASCOT.width / 2,
      y: MASCOT.top + MASCOT.height / 2,
    }
    expect(resolvePetLookFrame(MASCOT, center, 2)).toBeNull()
    expect(resolvePetLookFrame(MASCOT, { x: 500, y: 500 }, 1)).toBeNull()
  })
})

describe('pet drag direction', () => {
  test('uses the four pixel movement threshold', () => {
    expect(resolvePetDragAnimation('idle', 3.99)).toBe('idle')
    expect(resolvePetDragAnimation('waiting', -3.99)).toBe('waiting')
    expect(resolvePetDragAnimation('idle', 4)).toBe('running-right')
    expect(resolvePetDragAnimation('idle', -4)).toBe('running-left')
  })
})
