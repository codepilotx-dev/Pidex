import { describe, expect, test } from 'bun:test'
import { scaleDesktopBrowserBounds } from '../src/browser/BrowserBounds.js'
import {
  nextPageZoomPercent,
  normalizePageZoomPercent,
  resolvePageZoomShortcut,
} from '../src/windows/PageZoom.js'

type ShortcutInput = Parameters<typeof resolvePageZoomShortcut>[0]

const shortcut = (key: string, overrides: Partial<ShortcutInput> = {}): ShortcutInput => ({
  alt: false,
  code: '',
  control: true,
  key,
  meta: false,
  type: 'keyDown',
  ...overrides,
})

describe('page zoom', () => {
  test('maps app zoom shortcuts without claiming unrelated input', () => {
    expect(resolvePageZoomShortcut(shortcut('='))).toBe('in')
    expect(resolvePageZoomShortcut(shortcut('+'))).toBe('in')
    expect(resolvePageZoomShortcut(shortcut('', { code: 'NumpadAdd' }))).toBe('in')
    expect(resolvePageZoomShortcut(shortcut('-'))).toBe('out')
    expect(resolvePageZoomShortcut(shortcut('', { code: 'NumpadSubtract' }))).toBe('out')
    expect(resolvePageZoomShortcut(shortcut('0'))).toBe('reset')
    expect(resolvePageZoomShortcut(shortcut('', { code: 'Numpad0' }))).toBe('reset')
    expect(resolvePageZoomShortcut(shortcut('+', { control: false }))).toBeNull()
    expect(resolvePageZoomShortcut(shortcut('+', { alt: true }))).toBeNull()
    expect(resolvePageZoomShortcut(shortcut('+', { meta: true }))).toBeNull()
    expect(resolvePageZoomShortcut(shortcut('+', { type: 'keyUp' }))).toBeNull()
  })

  test('keeps zoom on ten-percent steps and inside the supported range', () => {
    expect(normalizePageZoomPercent(157)).toBe(160)
    expect(nextPageZoomPercent(50, 'out')).toBe(50)
    expect(nextPageZoomPercent(200, 'in')).toBe(200)
    expect(nextPageZoomPercent(170, 'reset')).toBe(100)
  })

  test('converts zoomed renderer CSS bounds back to Electron DIP', () => {
    expect(scaleDesktopBrowserBounds({ x: 10, y: 20, width: 300, height: 200 }, 1.5)).toEqual({
      x: 15,
      y: 30,
      width: 450,
      height: 300,
    })
  })
})
