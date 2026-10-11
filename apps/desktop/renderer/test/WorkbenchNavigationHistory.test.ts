import { describe, expect, test } from 'bun:test'
import { NavigationType } from 'react-router-dom'
import {
  reduceWorkbenchNavigationHistory,
  type WorkbenchNavigationHistory,
} from '../src/features/layout/shell/UseWorkbenchRouteController.js'

function createHistory(key = 'initial'): WorkbenchNavigationHistory {
  return {
    entries: [key],
    index: 0,
  }
}

function transition(
  history: WorkbenchNavigationHistory,
  key: string,
  navigationType: NavigationType,
): WorkbenchNavigationHistory {
  return reduceWorkbenchNavigationHistory(history, key, navigationType)
}

describe('workbench navigation history', () => {
  test('tracks pushes and moves backward and forward through known entries', () => {
    const first = transition(createHistory(), 'search', NavigationType.Push)
    const second = transition(first, 'plugins', NavigationType.Push)
    const back = transition(second, 'search', NavigationType.Pop)
    const forward = transition(back, 'plugins', NavigationType.Pop)

    expect(second).toEqual({
      entries: ['initial', 'search', 'plugins'],
      index: 2,
    })
    expect(back.index).toBe(1)
    expect(forward.index).toBe(2)
  })

  test('truncates the forward branch after a new push', () => {
    const search = transition(createHistory(), 'search', NavigationType.Push)
    const plugins = transition(search, 'plugins', NavigationType.Push)
    const back = transition(plugins, 'search', NavigationType.Pop)
    const models = transition(back, 'models', NavigationType.Push)

    expect(models).toEqual({
      entries: ['initial', 'search', 'models'],
      index: 2,
    })
  })

  test('replaces the current entry without changing length or index', () => {
    const search = transition(createHistory(), 'search', NavigationType.Push)
    const replaced = transition(search, 'settings', NavigationType.Replace)

    expect(replaced).toEqual({
      entries: ['initial', 'settings'],
      index: 1,
    })
  })

  test('appends an unknown pop key as a safe new branch', () => {
    const search = transition(createHistory(), 'search', NavigationType.Push)
    const unknown = transition(search, 'external', NavigationType.Pop)

    expect(unknown).toEqual({
      entries: ['initial', 'search', 'external'],
      index: 2,
    })
  })

  test('exposes history boundaries through its index', () => {
    const initial = createHistory()
    const search = transition(initial, 'search', NavigationType.Push)

    expect(initial.index > 0).toBeFalse()
    expect(initial.index < initial.entries.length - 1).toBeFalse()
    expect(search.index > 0).toBeTrue()
    expect(search.index < search.entries.length - 1).toBeFalse()
  })
})
