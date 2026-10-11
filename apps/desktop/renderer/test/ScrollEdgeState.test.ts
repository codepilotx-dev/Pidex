import { describe, expect, test } from 'bun:test'

import { resolveScrollEdgeState, SCROLL_EDGE_EPSILON } from '../src/hooks/UseScrollEdgeState.js'

describe('resolveScrollEdgeState', () => {
  test('non-scrollable content is both at the start and the end', () => {
    expect(
      resolveScrollEdgeState({
        scrollTop: 0,
        scrollHeight: 200,
        clientHeight: 200,
      }),
    ).toEqual({ atStart: true, atEnd: true, scrollable: false })
  })

  test('scrollable content at the top fades only the bottom edge', () => {
    expect(
      resolveScrollEdgeState({
        scrollTop: 0,
        scrollHeight: 600,
        clientHeight: 200,
      }),
    ).toEqual({ atStart: true, atEnd: false, scrollable: true })
  })

  test('scrollable content in the middle fades both edges', () => {
    expect(
      resolveScrollEdgeState({
        scrollTop: 200,
        scrollHeight: 600,
        clientHeight: 200,
      }),
    ).toEqual({ atStart: false, atEnd: false, scrollable: true })
  })

  test('scrollable content at the bottom fades only the top edge', () => {
    expect(
      resolveScrollEdgeState({
        scrollTop: 400,
        scrollHeight: 600,
        clientHeight: 200,
      }),
    ).toEqual({ atStart: false, atEnd: true, scrollable: true })
  })

  test('tolerates fractional scroll positions within the epsilon', () => {
    expect(
      resolveScrollEdgeState({
        scrollTop: 0.4,
        scrollHeight: 600.6,
        clientHeight: 200,
      }),
    ).toEqual({ atStart: true, atEnd: false, scrollable: true })
    expect(
      resolveScrollEdgeState({
        scrollTop: 399.6,
        scrollHeight: 600.4,
        clientHeight: 200,
      }),
    ).toEqual({ atStart: false, atEnd: true, scrollable: true })
    expect(
      resolveScrollEdgeState(
        {
          scrollTop: 2,
          scrollHeight: 600,
          clientHeight: 200,
        },
        1,
      ),
    ).toEqual({ atStart: false, atEnd: false, scrollable: true })
  })

  test('accepts a custom epsilon for boundary hysteresis', () => {
    expect(
      resolveScrollEdgeState({ scrollTop: 3, scrollHeight: 600, clientHeight: 200 }, 4),
    ).toEqual({ atStart: true, atEnd: false, scrollable: true })
    expect(
      resolveScrollEdgeState({ scrollTop: 3, scrollHeight: 600, clientHeight: 200 }, 2),
    ).toEqual({ atStart: false, atEnd: false, scrollable: true })
  })

  test('content size changes flip scrollability without breaking edges', () => {
    expect(
      resolveScrollEdgeState({
        scrollTop: 0,
        scrollHeight: 200,
        clientHeight: 200,
      }),
    ).toEqual({ atStart: true, atEnd: true, scrollable: false })
    expect(
      resolveScrollEdgeState({
        scrollTop: 0,
        scrollHeight: 600,
        clientHeight: 200,
      }),
    ).toEqual({ atStart: true, atEnd: false, scrollable: true })
    expect(
      resolveScrollEdgeState({
        scrollTop: 400,
        scrollHeight: 200,
        clientHeight: 200,
      }),
    ).toEqual({ atStart: true, atEnd: true, scrollable: false })
  })

  test('clamps negative or empty measurements', () => {
    expect(
      resolveScrollEdgeState({
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
      }),
    ).toEqual({ atStart: true, atEnd: true, scrollable: false })
    expect(
      resolveScrollEdgeState({
        scrollTop: -5,
        scrollHeight: 100,
        clientHeight: 200,
      }),
    ).toEqual({ atStart: true, atEnd: true, scrollable: false })
    expect(SCROLL_EDGE_EPSILON).toBe(1)
  })
})
