import { describe, expect, test } from 'bun:test'
import {
  AUTO_REVIEW_PERMISSION_CONFIG,
  DEFAULT_PERMISSION_CONFIG,
  FULL_ACCESS_PERMISSION_CONFIG,
  PERMISSION_PRESETS,
} from '@pidex/shared/thread'
import {
  PERMISSION_MODE_OPTIONS,
  permissionConfigForMode,
  permissionModeForConfig,
} from '../src/features/settings/SettingsStorage.js'
import { permissionPresetViewForConfig } from '../src/features/settings/PermissionPresetView.js'

describe('shared permission preset round-trip', () => {
  test('generates and re-identifies every shared preset exactly', () => {
    for (const preset of PERMISSION_PRESETS) {
      const generated = permissionConfigForMode(preset.id)
      expect(generated).toEqual(preset.config)
      expect(permissionModeForConfig(generated)).toBe(preset.id)
    }
    expect(permissionModeForConfig(DEFAULT_PERMISSION_CONFIG)).toBe('default')
    expect(permissionModeForConfig(AUTO_REVIEW_PERMISSION_CONFIG)).toBe('auto-review')
    expect(permissionModeForConfig(FULL_ACCESS_PERMISSION_CONFIG)).toBe('full-access')
  })

  test('full access recognition requires the user reviewer field', () => {
    expect(
      permissionModeForConfig({
        ...FULL_ACCESS_PERMISSION_CONFIG,
        approvalsReviewer: 'auto_review',
      }),
    ).toBe('custom')
    expect(
      permissionModeForConfig({
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
      }),
    ).toBe('full-access')
  })

  test('custom keeps the current config untouched and is never rewritten', () => {
    const customConfig = {
      sandboxMode: 'read-only' as const,
      approvalPolicy: 'untrusted' as const,
      approvalsReviewer: 'auto_review' as const,
    }
    const generated = permissionConfigForMode('custom', customConfig)
    expect(generated).toEqual(customConfig)
    expect(generated).not.toBe(customConfig)
    expect(permissionModeForConfig(customConfig)).toBe('custom')
    // A granular policy remains custom and round-trips without normalization.
    const granular = permissionConfigForMode('custom', {
      sandboxMode: 'workspace-write',
      approvalPolicy: {
        type: 'granular',
        sandboxApproval: true,
        rules: false,
        skillApproval: true,
        requestPermissions: true,
        mcpTools: true,
        mcpElicitations: false,
      },
      approvalsReviewer: 'user',
    })
    expect(granular.approvalPolicy).toEqual({
      type: 'granular',
      sandboxApproval: true,
      rules: false,
      skillApproval: true,
      requestPermissions: true,
      mcpTools: true,
      mcpElicitations: false,
    })
    expect(permissionModeForConfig(granular)).toBe('custom')
  })

  test('exposes the shared preset catalog labels and descriptions', () => {
    expect(PERMISSION_MODE_OPTIONS.map((option) => option.label)).toEqual([
      '请求批准',
      '帮我批准',
      '完全访问',
      '自定义',
    ])
    const labels = Object.fromEntries(
      PERMISSION_MODE_OPTIONS.map((option) => [option.value, option.label]),
    )
    expect(labels).toMatchObject({
      default: '请求批准',
      'auto-review': '帮我批准',
      'full-access': '完全访问',
      custom: '自定义',
    })
    expect(PERMISSION_MODE_OPTIONS[0]!.detail).toContain('安全操作直接执行')
    expect(PERMISSION_MODE_OPTIONS[0]!.detail).toContain('外部与风险操作由你批准')
    expect(PERMISSION_MODE_OPTIONS[1]!.detail).toContain('Guardian')
    expect(PERMISSION_MODE_OPTIONS[2]!.detail).toContain('不提供沙箱或网络隔离')
  })
})

describe('hidden permission preset display', () => {
  test('shows the actual configured preset and reason without offering it', () => {
    const view = permissionPresetViewForConfig(AUTO_REVIEW_PERMISSION_CONFIG, {
      enableAutoReviewPermissionMode: false,
      enableFullAccessPermissionMode: true,
    })
    expect(view.selection).toBe('auto-review')
    expect(view.label).toBe('帮我批准')
    expect(view.hidden).toBe(true)
    expect(view.unavailableReason).toContain('已在设置中关闭')
    expect(view.options.map((option) => option.value)).toEqual([
      'default',
      'full-access',
      'custom',
      'auto-review',
    ])
    const hiddenOption = view.options.find((option) => option.value === 'auto-review')
    expect(hiddenOption?.disabled).toBe(true)
    expect(hiddenOption?.detail).toBe(view.unavailableReason)
  })

  test('shows a hidden full-access config without rewriting the stored config', () => {
    const view = permissionPresetViewForConfig(FULL_ACCESS_PERMISSION_CONFIG, {
      enableAutoReviewPermissionMode: false,
      enableFullAccessPermissionMode: false,
    })
    expect(view.selection).toBe('full-access')
    expect(view.label).toBe('完全访问')
    expect(view.hidden).toBe(true)
    expect(view.unavailableReason).toContain('完全访问')
    expect(view.options.some((option) => option.value === 'full-access' && !option.disabled)).toBe(
      false,
    )
  })

  test('available presets stay selectable and custom is always offered', () => {
    const view = permissionPresetViewForConfig(DEFAULT_PERMISSION_CONFIG, {
      enableAutoReviewPermissionMode: true,
      enableFullAccessPermissionMode: true,
    })
    expect(view.hidden).toBe(false)
    expect(view.unavailableReason).toBeNull()
    expect(view.options.map((option) => option.value)).toEqual([
      'default',
      'auto-review',
      'full-access',
      'custom',
    ])
    expect(view.options.every((option) => !option.disabled)).toBe(true)
  })
})
