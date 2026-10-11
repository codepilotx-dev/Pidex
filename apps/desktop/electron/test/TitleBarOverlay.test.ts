import { describe, expect, test } from 'bun:test'
import {
  createWindowsTitleBarOverlay,
  WINDOWS_TITLE_BAR_HEIGHT,
  WINDOWS_TITLE_BAR_TRANSPARENT,
} from '../src/windows/TitleBarOverlay.js'

describe('Windows title bar overlay', () => {
  test('keeps the native controls transparent at the fixed logical height', () => {
    expect(createWindowsTitleBarOverlay('#202020')).toEqual({
      color: WINDOWS_TITLE_BAR_TRANSPARENT,
      symbolColor: '#202020',
      height: WINDOWS_TITLE_BAR_HEIGHT,
    })
    expect(WINDOWS_TITLE_BAR_TRANSPARENT).toBe('#00000000')
    expect(WINDOWS_TITLE_BAR_HEIGHT).toBe(36)
  })
})
