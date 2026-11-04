import { describe, expect, test } from 'bun:test'
import {
  isAllowedApplicationUrl,
  isApplicationOriginUrl,
  normalizeOrigin,
} from '../src/security/Navigation'

describe('desktop navigation', () => {
  test('主窗口只允许应用 origin，拒绝旧 data 启动页', () => {
    const origin = normalizeOrigin('http://127.0.0.1:3210/')
    const startupPage = 'data:text/html;charset=utf-8,%3Chtml%3E'

    expect(isAllowedApplicationUrl(startupPage, origin)).toBe(false)
    expect(isApplicationOriginUrl(startupPage, origin)).toBe(false)
    expect(isApplicationOriginUrl('http://127.0.0.1:3210/session/1', origin)).toBe(true)
    expect(isApplicationOriginUrl('http://127.0.0.1:3211/', origin)).toBe(false)
  })
})
