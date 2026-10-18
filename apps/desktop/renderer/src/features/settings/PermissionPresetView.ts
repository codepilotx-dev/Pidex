import {
  CUSTOM_PERMISSION_PRESET,
  PERMISSION_PRESETS,
  PERMISSION_PRESET_OPTIONS,
  matchPermissionPreset,
  permissionConfigForPreset,
  type PermissionPreset,
  type PermissionPresetSelection,
} from '@pidex/shared/thread'
import type { DesktopPermissionConfig, DesktopPermissionMode } from '../../../shared/Types.js'

/**
 * Renderer view over the shared permission preset catalog.
 *
 * The preset identity (`sandboxMode`, `approvalPolicy`, `approvalsReviewer`)
 * and every generated config come from `@pidex/shared/thread`; this module only
 * adapts them to the desktop mode vocabulary and to the feature flags that
 * control whether a preset is offered. A preset hidden by a feature flag is
 * still displayed as the actual stored configuration — never rewritten.
 */
export type PermissionPresetVisibility = {
  enableAutoReviewPermissionMode?: boolean
  enableFullAccessPermissionMode?: boolean
}

export type PermissionPresetOptionView = {
  value: DesktopPermissionMode
  label: string
  detail: string
  disabled?: boolean
}

export type PermissionPresetView = {
  selection: PermissionPresetSelection
  label: string
  detail: string
  /** True when the stored selection is one of the presets hidden by feature flags. */
  hidden: boolean
  /** Human-readable availability note; null when the selection is available. */
  unavailableReason: string | null
  /** Visible options for menus. The hidden current selection is appended disabled. */
  options: PermissionPresetOptionView[]
}

const presetFor = (selection: PermissionPresetSelection): PermissionPreset | null =>
  PERMISSION_PRESETS.find((preset) => preset.id === selection) ?? null

export function permissionPresetSelection(
  config: DesktopPermissionConfig,
): PermissionPresetSelection {
  return matchPermissionPreset(config)
}

/** Always returns the stored config for the preset; custom keeps the current config. */
export function permissionConfigForSelection(
  selection: PermissionPresetSelection,
  current?: DesktopPermissionConfig,
): DesktopPermissionConfig {
  return permissionConfigForPreset(selection, current)
}

export function permissionPresetLabel(selection: PermissionPresetSelection): string {
  return presetFor(selection)?.label ?? CUSTOM_PERMISSION_PRESET.label
}

export function permissionPresetDescription(selection: PermissionPresetSelection): string {
  return presetFor(selection)?.description ?? CUSTOM_PERMISSION_PRESET.description
}

export function permissionPresetUnavailableReason(
  selection: PermissionPresetSelection,
  visibility: PermissionPresetVisibility,
): string | null {
  if (selection === 'auto-review' && !visibility.enableAutoReviewPermissionMode)
    return '“帮我批准”预设已在设置中关闭；当前配置保持不变。'
  if (selection === 'full-access' && !visibility.enableFullAccessPermissionMode)
    return '“完全访问”预设已在设置中关闭；当前配置保持不变。'
  return null
}

export function visiblePermissionPresetOptions(
  visibility: PermissionPresetVisibility,
): PermissionPresetOptionView[] {
  return PERMISSION_PRESET_OPTIONS.filter((option) => {
    if (option.id === 'auto-review') return Boolean(visibility.enableAutoReviewPermissionMode)
    if (option.id === 'full-access') return Boolean(visibility.enableFullAccessPermissionMode)
    return true
  }).map((option) => ({
    value: option.id,
    label: option.label,
    detail: option.description,
  }))
}

/** Resolves the actual stored selection plus the options a permission menu may show. */
export function permissionPresetView(
  selection: PermissionPresetSelection,
  visibility: PermissionPresetVisibility,
): PermissionPresetView {
  const unavailableReason = permissionPresetUnavailableReason(selection, visibility)
  const options = visiblePermissionPresetOptions(visibility)
  if (unavailableReason) {
    options.push({
      value: selection,
      label: permissionPresetLabel(selection),
      detail: unavailableReason,
      disabled: true,
    })
  }
  return {
    selection,
    label: permissionPresetLabel(selection),
    detail: permissionPresetDescription(selection),
    hidden: unavailableReason !== null,
    unavailableReason,
    options,
  }
}

export function permissionPresetViewForConfig(
  config: DesktopPermissionConfig,
  visibility: PermissionPresetVisibility,
): PermissionPresetView {
  return permissionPresetView(matchPermissionPreset(config), visibility)
}
