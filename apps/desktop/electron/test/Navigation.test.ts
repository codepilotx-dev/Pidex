import { describe, expect, test } from 'bun:test'
import {
  isAllowedApplicationUrl,
  isApplicationOriginUrl,
  normalizeOrigin,
} from '../src/security/Navigation'

describe('desktop navigation', () => {
  test('启动页可以导航但不会被识别为正式应用页面', () => {
    const origin = normalizeOrigin('http://127.0.0.1:3210/')
    const startupPage = 'data:text/html;charset=utf-8,%3Chtml%3E'

    expect(isAllowedApplicationUrl(startupPage, origin)).toBe(true)
    expect(isApplicationOriginUrl(startupPage, origin)).toBe(false)
    expect(isApplicationOriginUrl('http://127.0.0.1:3210/session/1', origin)).toBe(true)
    expect(isApplicationOriginUrl('http://127.0.0.1:3211/', origin)).toBe(false)
  })
})
