import { describe, expect, test } from 'bun:test'
import {
  MAX_API_KEY_MATERIAL_LENGTH,
  normalizeDesktopSettingsPayload,
  requireApiKeyMaterial,
} from '../src/settings/DesktopSettingsContract'

describe('Desktop IPC 设置契约', () => {
  test('只接受普通设置对象', () => {
    expect(normalizeDesktopSettingsPayload({ providerID: 'openai' })).toEqual({
      providerID: 'openai',
    })
    expect(
      normalizeDesktopSettingsPayload({
        providerID: 'openai',
        ignored: undefined,
      }),
    ).toEqual({ providerID: 'openai' })
    expect(() => normalizeDesktopSettingsPayload(null)).toThrow('桌面设置参数无效')
    expect(() => normalizeDesktopSettingsPayload([])).toThrow('桌面设置参数无效')
  })

  test('限制进入系统剪贴板的 API Key 长度', () => {
    expect(requireApiKeyMaterial('sk-valid')).toBe('sk-valid')
    expect(() => requireApiKeyMaterial('')).toThrow('Agent 未返回有效的 API Key')
    expect(() => requireApiKeyMaterial('x'.repeat(MAX_API_KEY_MATERIAL_LENGTH + 1))).toThrow(
      'Agent 未返回有效的 API Key',
    )
  })
})
