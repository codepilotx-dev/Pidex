import {
  DEFAULT_PERMISSION_CONFIG,
  AUTO_REVIEW_PERMISSION_CONFIG,
  FULL_ACCESS_PERMISSION_CONFIG,
} from '@pidex/shared/thread'
import { desktopClient } from '../../services/desktop-client/index.js'
import type {
  DesktopPermissionConfig,
  DesktopPermissionMode,
  DesktopStoredSettings,
  DesktopThinkingMode,
  LocalRouterMode,
} from '../../../shared/Types.js'
import { defaultDesktopStoredSettings } from '../../../shared/SettingsSchema.js'
export { MAX_RECENT_WORKSPACES, upsertRecentWorkspace } from '../../../shared/SettingsSchema.js'
export type { LocalRouterMode } from '../../../shared/Types.js'

export const PERMISSION_MODE_OPTIONS: Array<{
  value: DesktopPermissionMode
  label: string
  detail: string
}> = [
  {
    value: 'default',
    label: '默认权限',
    detail:
      '结构化文件工具限工作区；Shell 经安全规则和项目 Hook 后在本机执行，额外权限才请求批准。',
  },
  {
    value: 'auto-review',
    label: '自动审查',
    detail: 'Shell 经安全规则和项目 Hook 后在本机执行；需要审批的请求由 Guardian 自动审查。',
  },
  {
    value: 'full-access',
    label: '完全访问权限',
    detail:
      '内建文件工具可访问工作区外路径；Shell 在宿主执行。保留硬拒绝、Plan、规则和 Hook；需要新增授权时拒绝执行。',
  },
  {
    value: 'custom',
    label: 'Pidex 自定义策略',
    detail: '使用配置页中的文件访问范围、approval policy、reviewer 与 granular controls。',
  },
]

export function getVisiblePermissionModeOptions({
  enableAutoReviewPermissionMode,
  enableFullAccessPermissionMode,
}: {
  enableAutoReviewPermissionMode?: boolean
  enableFullAccessPermissionMode?: boolean
}): typeof PERMISSION_MODE_OPTIONS {
  return PERMISSION_MODE_OPTIONS.filter((option) => {
    if (option.value === 'auto-review') return enableAutoReviewPermissionMode
    if (option.value === 'full-access') return enableFullAccessPermissionMode
    return option.value === 'default' || option.value === 'custom'
  })
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

export function permissionModeForConfig(config: DesktopPermissionConfig): DesktopPermissionMode {
  if (config.sandboxMode === 'danger-full-access' && config.approvalPolicy === 'never')
    return 'full-access'
  if (
    config.sandboxMode === 'workspace-write' &&
    config.approvalPolicy === 'on-request' &&
    config.approvalsReviewer === 'auto_review'
  )
    return 'auto-review'
  if (
    config.sandboxMode === 'workspace-write' &&
    config.approvalPolicy === 'on-request' &&
    config.approvalsReviewer === 'user'
  )
    return 'default'
  return 'custom'
}

export function permissionConfigForMode(mode: DesktopPermissionMode): DesktopPermissionConfig {
  return {
    ...(mode === 'full-access'
      ? FULL_ACCESS_PERMISSION_CONFIG
      : mode === 'auto-review'
        ? AUTO_REVIEW_PERMISSION_CONFIG
        : DEFAULT_PERMISSION_CONFIG),
  }
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
