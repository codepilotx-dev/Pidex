import type {
  DesktopPermissionConfig,
  DesktopPermissionMode,
  DesktopStoredSettings,
  DesktopThinkingMode,
  LocalRouterMode,
} from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { defaultDesktopStoredSettings } from '../../../shared/SettingsSchema.js'
import {
  permissionConfigForSelection,
  permissionPresetSelection,
  visiblePermissionPresetOptions,
  type PermissionPresetVisibility,
} from './PermissionPresetView.js'
export {
  permissionPresetDescription,
  permissionPresetLabel,
  permissionPresetUnavailableReason,
  permissionPresetView,
  permissionPresetViewForConfig,
  type PermissionPresetOptionView,
  type PermissionPresetView,
  type PermissionPresetVisibility,
} from './PermissionPresetView.js'
export { MAX_RECENT_WORKSPACES, upsertRecentWorkspace } from '../../../shared/SettingsSchema.js'
export type { LocalRouterMode } from '../../../shared/Types.js'

/** Preset catalog options; labels and descriptions come from the shared catalog. */
export const PERMISSION_MODE_OPTIONS: Array<{
  value: DesktopPermissionMode
  label: string
  detail: string
}> = visiblePermissionPresetOptions({
  enableAutoReviewPermissionMode: true,
  enableFullAccessPermissionMode: true,
})

export function getVisiblePermissionModeOptions(
  visibility: PermissionPresetVisibility,
): typeof PERMISSION_MODE_OPTIONS {
  return visiblePermissionPresetOptions(visibility)
}

export const THINKING_MODE_OPTIONS: Array<{
  value: DesktopThinkingMode
  label: string
}> = [
  { value: 'disabled', label: '低' },
  { value: 'default', label: '中' },
  { value: 'adaptive', label: '高' },
  { value: 'enabled', label: '超高' },
]

export const DESKTOP_SETTINGS_STORAGE_KEY = 'claude-code-desktop-settings'

export type StoredDesktopSettings = DesktopStoredSettings

export function defaultDesktopSettings(): StoredDesktopSettings {
  return defaultDesktopStoredSettings()
}

/**
 * A config is exactly one shared preset only when all three stored fields match.
 * Full access with an automatic reviewer is custom, never full access.
 */
export function permissionModeForConfig(config: DesktopPermissionConfig): DesktopPermissionMode {
  return permissionPresetSelection(config)
}

export function permissionConfigForMode(
  mode: DesktopPermissionMode,
  current?: DesktopPermissionConfig,
): DesktopPermissionConfig {
  return permissionConfigForSelection(mode, current)
}

export function readStoredDesktopSettings(): StoredDesktopSettings {
  return defaultDesktopSettings()
}

export function storeDesktopSettings(settings: StoredDesktopSettings): void {
  void desktopClient.saveDesktopSettings(settings)
}

export function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function parseAdditionalDirectories(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
