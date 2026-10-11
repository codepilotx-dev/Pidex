import type {
  DesktopSettingsPayload,
  DesktopSettingsValue,
} from '@pidex/shared/desktop-settings-ipc'

export const MAX_API_KEY_MATERIAL_LENGTH = 16_384

export type { DesktopSettingsPayload, DesktopSettingsValue }

export function normalizeDesktopSettingsPayload(value: unknown): DesktopSettingsPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('桌面设置参数无效')
  }
  try {
    const normalized: unknown = JSON.parse(JSON.stringify(value))
    if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)) {
      throw new Error('桌面设置参数无效')
    }
    return normalized as DesktopSettingsPayload
  } catch {
    throw new Error('桌面设置参数无效')
  }
}

export function requireApiKeyMaterial(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_API_KEY_MATERIAL_LENGTH
  ) {
    throw new Error('Agent 未返回有效的 API Key')
  }
  return value
}
