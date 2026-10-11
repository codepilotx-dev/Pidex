import { describe, expect, test } from 'bun:test'
import { advancePetThrow, estimatePetThrowVelocity } from '../src/windows/PetOverlayThrow.js'

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 }
const BOUNDS = { x: 500, y: 400, width: 356, height: 320 }

describe('pet overlay throw', () => {
  test('uses only the latest 160ms sample window', () => {
    expect(
      estimatePetThrowVelocity([
        { x: -500, y: 0, timestampMs: 0 },
        { x: 0, y: 0, timestampMs: 100 },
        { x: 60, y: 0, timestampMs: 250 },
      ]),
    ).toEqual({ x: 1_200, y: 0 })
  })

  test('requires 4px travel and 320px/s release speed', () => {
    expect(
      estimatePetThrowVelocity([
        { x: 0, y: 0, timestampMs: 0 },
        { x: 3, y: 0, timestampMs: 5 },
      ]),
    ).toEqual({ x: 0, y: 0 })
    expect(
      estimatePetThrowVelocity([
        { x: 0, y: 0, timestampMs: 0 },
        { x: 4, y: 0, timestampMs: 20 },
      ]),
    ).toEqual({ x: 0, y: 0 })
  })

  test('caps raw speed at 1600px/s before the 3x multiplier', () => {
    const velocity = estimatePetThrowVelocity([
      { x: 0, y: 0, timestampMs: 0 },
      { x: 1_000, y: 0, timestampMs: 10 },
    ])
    expect(velocity).toEqual({ x: 4_800, y: 0 })
  })

  test('caps frame dt at 32ms and applies exact 16ms friction', () => {
    const capped = advancePetThrow(BOUNDS, { x: 1_000, y: 0 }, 100, 100, WORK_AREA)
    expect(capped.bounds.x).toBe(532)
    expect(capped.velocity.x).toBeCloseTo(774.4)

    const frame = advancePetThrow(BOUNDS, { x: 1_000, y: 0 }, 16, 16, WORK_AREA)
    expect(frame.velocity.x).toBeCloseTo(880)
  })

  test('bounces from all four work-area edges at 0.7 strength', () => {
    const right = advancePetThrow({ ...BOUNDS, x: 1_560 }, { x: 1_000, y: 0 }, 16, 16, WORK_AREA)
    const left = advancePetThrow({ ...BOUNDS, x: 4 }, { x: -1_000, y: 0 }, 16, 16, WORK_AREA)
    const bottom = advancePetThrow({ ...BOUNDS, y: 756 }, { x: 0, y: 1_000 }, 16, 16, WORK_AREA)
    const top = advancePetThrow({ ...BOUNDS, y: 4 }, { x: 0, y: -1_000 }, 16, 16, WORK_AREA)

    expect(right.bounds.x).toBe(1_564)
    expect(right.velocity.x).toBeCloseTo(-616)
    expect(left.bounds.x).toBe(0)
    expect(left.velocity.x).toBeCloseTo(616)
    expect(bottom.bounds.y).toBe(760)
    expect(bottom.velocity.y).toBeCloseTo(-616)
    expect(top.bounds.y).toBe(0)
    expect(top.velocity.y).toBeCloseTo(616)
  })

  test('stops below 65px/s or after 900ms total', () => {
    expect(advancePetThrow(BOUNDS, { x: 70, y: 0 }, 16, 16, WORK_AREA)).toMatchObject({
      stopped: true,
      velocity: { x: 0, y: 0 },
    })
    expect(advancePetThrow(BOUNDS, { x: 1_000, y: 0 }, 8, 900, WORK_AREA)).toMatchObject({
      stopped: true,
      velocity: { x: 0, y: 0 },
    })
  })
})
