import { describe, expect, test } from 'bun:test'
import {
  createSidebarStateResetPatch,
  DEFAULT_PROJECT_APPEARANCE,
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
  PROJECT_APPEARANCE_COLORS,
  PROJECT_APPEARANCE_ICONS,
  SIDEBAR_STATE_VERSION,
} from '../shared/SettingsSchema'

describe('侧边栏布局设置', () => {
  test('默认新版，缺失或无效配置回退新版，经典配置往返保留原侧栏状态', () => {
    expect(defaultDesktopStoredSettings().sidebarLayout).toBe('modern')
    for (const sidebarLayout of [undefined, null, '', 'old']) {
      expect(
        normalizeDesktopStoredSettings({ sidebarLayout: sidebarLayout as never }).sidebarLayout,
      ).toBe('modern')
    }
    const classic = normalizeDesktopStoredSettings({
      sidebarLayout: 'classic',
      sidebarStateVersion: SIDEBAR_STATE_VERSION,
      sidebarSessionPins: { 'session-1': '2026-10-03T01:00:00.000Z' },
      sidebarManualOrder: { all: ['session-2', 'session-1'] },
    })
    expect(normalizeDesktopStoredSettings(JSON.parse(JSON.stringify(classic)))).toMatchObject({
      sidebarLayout: 'classic',
      sidebarStateVersion: SIDEBAR_STATE_VERSION,
      sidebarSessionPins: { 'session-1': '2026-10-03T01:00:00.000Z' },
      sidebarManualOrder: { all: ['session-2', 'session-1'] },
    })
  })
})

describe('界面语言设置', () => {
  test('旧设置默认跟随系统，且只接受已支持的语言', () => {
    expect(normalizeDesktopStoredSettings({}).language).toBe('system')
    expect(normalizeDesktopStoredSettings({ language: 'en-US' }).language).toBe('en-US')
    expect(normalizeDesktopStoredSettings({ language: 'ja-JP' as never }).language).toBe('system')
  })
})

describe('工作空间依赖项迁移', () => {
  test('默认等待一次性迁移并持久化完成标记', () => {
    expect(defaultDesktopStoredSettings()).toMatchObject({
      installPidexDependencies: true,
      workspaceDependenciesMigrated: false,
    })
    expect(
      normalizeDesktopStoredSettings({
        installPidexDependencies: false,
        workspaceDependenciesMigrated: true,
      }),
    ).toMatchObject({
      installPidexDependencies: false,
      workspaceDependenciesMigrated: true,
    })
  })
})

describe('首次模型配置向导', () => {
  test('只保留数值 0 和 1，并让缺失或无效值继续走旧用户迁移', () => {
    expect(defaultDesktopStoredSettings().firstUseSetupCompleted).toBeUndefined()
    expect(
      normalizeDesktopStoredSettings({
        firstUseSetupCompleted: 0,
      }).firstUseSetupCompleted,
    ).toBe(0)
    expect(
      normalizeDesktopStoredSettings({
        firstUseSetupCompleted: 1,
      }).firstUseSetupCompleted,
    ).toBe(1)

    for (const value of [true, false, '0', '1', 2, -1]) {
      expect(
        normalizeDesktopStoredSettings({
          firstUseSetupCompleted: value as never,
        }).firstUseSetupCompleted,
      ).toBeUndefined()
    }
  })
})

describe('专用模型设置迁移', () => {
  test('将旧任务模型映射到四类专用模型且不保留旧字段', () => {
    const settings = normalizeDesktopStoredSettings({
      smallFastModel: 'openai/gpt-fast',
      fastModel: 'openai/gpt-fallback',
      defaultModel: 'openai/gpt-default',
      deepModel: 'openai/gpt-deep',
      planExecutionModel: 'openai/gpt-code',
      reviewModel: 'openai/gpt-safe',
    })

    expect(settings).toMatchObject({
      generationModel: 'openai/gpt-fast',
      organizationModel: 'openai/gpt-fast',
      codingModel: 'openai/gpt-code',
      securityModel: 'openai/gpt-safe',
    })
    expect('smallFastModel' in settings).toBe(false)
    expect('planExecutionModel' in settings).toBe(false)
    expect('reviewModel' in settings).toBe(false)
  })

  test('已有专用模型优先于旧任务模型', () => {
    expect(
      normalizeDesktopStoredSettings({
        generationModel: 'anthropic/claude-new',
        codingModel: 'anthropic/claude-code',
        smallFastModel: 'openai/gpt-old',
        planExecutionModel: 'openai/gpt-old-code',
      }),
    ).toMatchObject({
      generationModel: 'anthropic/claude-new',
      codingModel: 'anthropic/claude-code',
    })
    expect(
      normalizeDesktopStoredSettings({
        reviewModel: 'openai/gpt-review',
      }).codingModel,
    ).toBe('openai/gpt-review')
  })
})

describe('语音输入设备设置', () => {
  test('默认跟随系统设备并保留有效设备 ID', () => {
    expect(defaultDesktopStoredSettings()['desktop.voice.preferredInputDeviceId']).toBe('')
    expect(
      normalizeDesktopStoredSettings({
        'desktop.voice.preferredInputDeviceId': 'microphone-1',
      })['desktop.voice.preferredInputDeviceId'],
    ).toBe('microphone-1')
    expect(
      normalizeDesktopStoredSettings({
        'desktop.voice.preferredInputDeviceId': 42 as never,
      })['desktop.voice.preferredInputDeviceId'],
    ).toBe('')
  })
})

describe('宠物设置归一化', () => {
  test('提供安全默认值并限制尺寸与宠物 ID', () => {
    expect(defaultDesktopStoredSettings().pet).toEqual({
      enabled: false,
      selectedPetId: null,
      size: 112,
      notifyAttention: true,
      notifyCompletion: true,
      notifyFailure: true,
    })
    expect(
      normalizeDesktopStoredSettings({
        pet: {
          enabled: true,
          selectedPetId: '../unsafe',
          size: 500,
          notifyCompletion: false,
        },
      }).pet,
    ).toEqual({
      enabled: true,
      selectedPetId: null,
      size: 224,
      notifyAttention: true,
      notifyCompletion: false,
      notifyFailure: true,
    })
    expect(
      normalizeDesktopStoredSettings({
        pet: { selectedPetId: 'little-whale', size: 40 },
      }).pet,
    ).toMatchObject({
      selectedPetId: 'little-whale',
      size: 80,
    })
  })
})

describe('系统通知设置归一化', () => {
  test('提供安全默认值：完成仅失焦，其余默认开启', () => {
    expect(defaultDesktopStoredSettings().notifications).toEqual({
      completion: 'unfocused',
      permissions: true,
      questions: true,
      errors: true,
    })
  })

  test('完整保存并往返保留全部字段', () => {
    const saved = {
      completion: 'always',
      permissions: false,
      questions: true,
      errors: false,
    }
    expect(normalizeDesktopStoredSettings({ notifications: saved }).notifications).toEqual(saved)
  })

  test('旧配置缺字段时按字段回填默认值', () => {
    expect(
      normalizeDesktopStoredSettings({
        notifications: { completion: 'never' },
      }).notifications,
    ).toEqual({
      completion: 'never',
      permissions: true,
      questions: true,
      errors: true,
    })
    expect(normalizeDesktopStoredSettings({ notifications: {} }).notifications).toEqual(
      defaultDesktopStoredSettings().notifications,
    )
  })

  test('非法 completion 值回退 unfocused，非对象输入整体回退默认', () => {
    expect(
      normalizeDesktopStoredSettings({
        notifications: { completion: 'sometimes' },
      }).notifications.completion,
    ).toBe('unfocused')
    expect(normalizeDesktopStoredSettings({ notifications: 'on' }).notifications).toEqual(
      defaultDesktopStoredSettings().notifications,
    )
    expect(normalizeDesktopStoredSettings({}).notifications).toEqual(
      defaultDesktopStoredSettings().notifications,
    )
  })
})

describe('高级权限设置归一化', () => {
  test('Shell 安全级别默认平衡并只保留合法档位', () => {
    expect(defaultDesktopStoredSettings().shellSecurityLevel).toBe('balanced')
    for (const shellSecurityLevel of ['strict', 'balanced', 'relaxed'] as const) {
      expect(normalizeDesktopStoredSettings({ shellSecurityLevel }).shellSecurityLevel).toBe(
        shellSecurityLevel,
      )
    }
    expect(
      normalizeDesktopStoredSettings({
        shellSecurityLevel: 'future' as never,
      }).shellSecurityLevel,
    ).toBe('balanced')
  })

  test('完整保存并回填 granular PermissionConfig', () => {
    const granular = {
      type: 'granular' as const,
      sandboxApproval: false,
      rules: true,
      skillApproval: false,
      requestPermissions: true,
      mcpTools: false,
      mcpElicitations: false,
    }
    const settings = normalizeDesktopStoredSettings({
      permissionMode: 'custom',
      sandboxMode: 'danger-full-access',
      permissionProfile: ':danger-full-access',
      approvalPolicy: granular,
      approvalsReviewer: 'auto_review',
    })
    expect(settings).toMatchObject({
      permissionConfig: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: granular,
        approvalsReviewer: 'auto_review',
      },
    })
    expect(settings).not.toHaveProperty('permissionMode')
    expect(settings).not.toHaveProperty('permissionProfile')
    expect(settings).not.toHaveProperty('sandboxMode')
    expect(settings).not.toHaveProperty('approvalPolicy')
    expect(settings).not.toHaveProperty('approvalsReviewer')
  })

  test('旧 permissionProfile 可回填 sandboxMode', () => {
    expect(
      normalizeDesktopStoredSettings({ permissionMode: 'custom', permissionProfile: ':read-only' })
        .permissionConfig.sandboxMode,
    ).toBe('read-only')
    expect(
      normalizeDesktopStoredSettings({ permissionMode: 'custom', sandboxMode: 'full-access' })
        .permissionConfig.sandboxMode,
    ).toBe('danger-full-access')
  })

  test('旧 on-failure 审批策略迁移为 on-request', () => {
    expect(
      normalizeDesktopStoredSettings({ approvalPolicy: 'on-failure' }).permissionConfig
        .approvalPolicy,
    ).toBe('on-request')
  })
})

describe('集成终端设置归一化', () => {
  test('默认自动选择 Shell，并只保留字符串 profile ID', () => {
    expect(defaultDesktopStoredSettings().terminalProfileId).toBeNull()
    expect(
      normalizeDesktopStoredSettings({ terminalProfileId: 'windows-pwsh' }).terminalProfileId,
    ).toBe('windows-pwsh')
    expect(
      normalizeDesktopStoredSettings({ terminalProfileId: 42 as never }).terminalProfileId,
    ).toBeNull()
  })
})

describe('侧边栏设置归一化', () => {
  test('提供侧栏默认值并保留合法组织与排序设置', () => {
    const defaults = normalizeDesktopStoredSettings({})
    expect(defaults).toMatchObject({
      sidebarOrganization: 'projects',
      sidebarProjectSort: 'priority',
      sidebarSort: 'priority',
      sidebarProductMode: 'coding',
      sidebarStateVersion: 0,
      sidebarSessionPins: {},
      collapsedSidebarProjectPaths: [],
      sidebarSectionOrder: ['pinned', 'projects', 'recent'],
      collapsedSidebarSections: ['projects', 'recent'],
    })

    expect(normalizeDesktopStoredSettings({ sidebarSort: 'recent' }).sidebarSort).toBe('updated')
    expect(normalizeDesktopStoredSettings({ sidebarSort: 'updated' }).sidebarSort).toBe('updated')
    expect(normalizeDesktopStoredSettings({ sidebarSort: 'created' }).sidebarSort).toBe('updated')
    expect(normalizeDesktopStoredSettings({ sidebarSort: 'invalid' }).sidebarSort).toBe('priority')
    expect(
      normalizeDesktopStoredSettings({ sidebarProjectSort: 'recent' }).sidebarProjectSort,
    ).toBe('updated')
    expect(
      normalizeDesktopStoredSettings({ sidebarProjectSort: 'created' }).sidebarProjectSort,
    ).toBe('updated')
    expect(
      normalizeDesktopStoredSettings({ sidebarProjectSort: 'manual' }).sidebarProjectSort,
    ).toBe('manual')
    expect(
      normalizeDesktopStoredSettings({ sidebarProjectSort: 'invalid' }).sidebarProjectSort,
    ).toBe('priority')
    expect(
      normalizeDesktopStoredSettings({ sidebarOrganization: 'flat' }).sidebarOrganization,
    ).toBe('flat')
  })

  test('规范化并过滤会话置顶与折叠项目路径', () => {
    const settings = normalizeDesktopStoredSettings({
      sidebarSessionPins: {
        ' se\u0301ssion ': ' 2026-07-18T01:00:00Z ',
        séssion: 'duplicate',
        empty: ' ',
        invalid: 123,
      },
      collapsedSidebarProjectPaths: [' C:\\Cafe\u0301 ', 'C:\\Café', '', 123, ' C:\\Other '],
    })

    expect(settings.sidebarSessionPins).toEqual({
      séssion: '2026-07-18T01:00:00.000Z',
    })
    expect(settings.collapsedSidebarProjectPaths).toEqual(['C:\\Café', 'C:\\Other'])
  })

  test('丢弃旧 section order 并恢复固定区段顺序', () => {
    expect(
      normalizeDesktopStoredSettings({
        sidebarSectionOrder: [' recent ', 'invalid', 'recent', 'pinned', 123],
      }).sidebarSectionOrder,
    ).toEqual(['pinned', 'projects', 'recent'])
  })

  test('规范化并保留手动顺序', () => {
    expect(
      normalizeDesktopStoredSettings({
        sidebarManualOrder: {
          ' proje\u0301ct ': [' se\u0301ssion ', 'séssion', '', 123],
          invalid: 'not-an-array',
        },
      }).sidebarManualOrder,
    ).toEqual({
      projéct: ['séssion'],
    })
  })

  test('保留合法的产品模式并回退非法值', () => {
    for (const sidebarProductMode of ['coding', 'working', 'chat'] as const) {
      expect(
        normalizeDesktopStoredSettings({
          sidebarProductMode,
          sidebarStateVersion: SIDEBAR_STATE_VERSION,
        }),
      ).toMatchObject({
        sidebarProductMode,
        sidebarStateVersion: SIDEBAR_STATE_VERSION,
      })
    }
    expect(
      normalizeDesktopStoredSettings({
        sidebarProductMode: 'invalid',
      }).sidebarProductMode,
    ).toBe('coding')
  })

  test('一次性重置只替换侧边栏状态并保留工作空间和其他设置', () => {
    const settings = normalizeDesktopStoredSettings({
      model: 'keep-model',
      sidebarProductMode: 'chat',
      recentWorkspaces: [
        {
          path: 'F:\\CodeProject\\Pidex',
          name: 'Pidex',
          pinnedAt: '2026-07-25T01:00:00.000Z',
        },
      ],
      sidebarOrganization: 'flat',
      sidebarProjectSort: 'updated',
      sidebarSort: 'manual',
      sidebarManualOrder: { all: ['session-1'] },
      sidebarSessionPins: { 'session-1': '2026-07-25T01:00:00.000Z' },
      collapsedSidebarProjectPaths: ['F:\\CodeProject\\Pidex'],
      sidebarSectionOrder: ['recent', 'projects', 'pinned'],
      collapsedSidebarSections: ['pinned'],
    })

    const reset = { ...settings, ...createSidebarStateResetPatch(settings) }
    expect(reset).toMatchObject({
      model: 'keep-model',
      sidebarProductMode: 'chat',
      sidebarStateVersion: SIDEBAR_STATE_VERSION,
      sidebarOrganization: 'projects',
      sidebarProjectSort: 'priority',
      sidebarSort: 'priority',
      sidebarManualOrder: {},
      sidebarSessionPins: {},
      collapsedSidebarProjectPaths: [],
      sidebarSectionOrder: ['pinned', 'projects', 'recent'],
      collapsedSidebarSections: ['projects', 'recent'],
    })
    expect(reset.recentWorkspaces).toMatchObject([
      {
        path: 'F:\\CodeProject\\Pidex',
        name: 'Pidex',
        pinnedAt: null,
      },
    ])
  })
  test('在默认设置中时间线默认关闭且优先事项开启', () => {
    const settings = normalizeDesktopStoredSettings({})
    expect(settings.sidebarTimelineEnabled).toBe(false)
    expect(settings.sidebarTimelinePriorityEnabled).toBe(true)
  })

  test('时间线非法值回退关闭，优先事项非法值回退开启', () => {
    expect(normalizeDesktopStoredSettings({}).sidebarTimelineEnabled).toBe(false)
    expect(
      normalizeDesktopStoredSettings({
        sidebarTimelineEnabled: 'yes',
      }).sidebarTimelineEnabled,
    ).toBe(false)
    expect(
      normalizeDesktopStoredSettings({
        sidebarTimelineEnabled: 1,
      }).sidebarTimelineEnabled,
    ).toBe(false)
    expect(
      normalizeDesktopStoredSettings({
        sidebarTimelinePriorityEnabled: 'yes',
      }).sidebarTimelinePriorityEnabled,
    ).toBe(true)
    expect(
      normalizeDesktopStoredSettings({
        sidebarTimelinePriorityEnabled: 1,
      }).sidebarTimelinePriorityEnabled,
    ).toBe(true)
  })

  test('旧优先级筛选开关迁移为时间线开启且优先级勾选', () => {
    const settings = normalizeDesktopStoredSettings({
      sidebarPriorityFilterEnabled: true,
    })
    expect(settings.sidebarTimelineEnabled).toBe(true)
    expect(settings.sidebarTimelinePriorityEnabled).toBe(true)
    expect(normalizeDesktopStoredSettings(settings).sidebarTimelineEnabled).toBe(true)
  })

  test('新字段存在时旧优先级筛选开关不再覆盖时间线设置', () => {
    const settings = normalizeDesktopStoredSettings({
      sidebarPriorityFilterEnabled: true,
      sidebarTimelineEnabled: false,
      sidebarTimelinePriorityEnabled: false,
    })
    expect(settings.sidebarTimelineEnabled).toBe(false)
    expect(settings.sidebarTimelinePriorityEnabled).toBe(false)
  })

  test('迁移不会清除其他侧栏设置', () => {
    const settings = normalizeDesktopStoredSettings({
      sidebarPriorityFilterEnabled: true,
      sidebarOrganization: 'flat',
      sidebarSort: 'updated',
      sidebarSessionPins: { 'session:one': '2026-08-01T00:00:00.000Z' },
      sidebarManualOrder: { pinned: ['session:one'] },
    })
    expect(settings.sidebarTimelineEnabled).toBe(true)
    expect(settings.sidebarOrganization).toBe('flat')
    expect(settings.sidebarSort).toBe('updated')
    expect(settings.sidebarSessionPins).toEqual({
      'session:one': '2026-08-01T00:00:00.000Z',
    })
    expect(settings.sidebarManualOrder).toEqual({
      pinned: ['session:one'],
    })
  })

  test('重置侧栏状态会关闭时间线并保留已关闭的引导状态', () => {
    const settings = normalizeDesktopStoredSettings({
      sidebarTimelineEnabled: true,
      sidebarTimelinePriorityEnabled: true,
      sidebarActivityCoachmarkDismissed: true,
      sidebarActivityShowWork: false,
    })
    expect(settings.sidebarActivityCoachmarkDismissed).toBe(true)
    expect(settings.sidebarActivityShowWork).toBe(false)
    const reset = {
      ...settings,
      ...createSidebarStateResetPatch(settings),
    }
    expect(reset.sidebarTimelineEnabled).toBe(false)
    expect(reset.sidebarTimelinePriorityEnabled).toBe(true)
    expect(reset.sidebarActivityCoachmarkDismissed).toBe(true)
  })
})

describe('项目外观本地设置归一化', () => {
  test('默认不为任何项目创建外观覆盖', () => {
    expect(defaultDesktopStoredSettings().projectAppearances).toEqual({})
    expect(PROJECT_APPEARANCE_COLORS).toContain('default')
    expect(PROJECT_APPEARANCE_ICONS).toHaveLength(30)
    expect(PROJECT_APPEARANCE_ICONS).toContain('folder')
  })

  test('保留合法语义 ID，并过滤空项目 ID 和非对象记录', () => {
    const settings = normalizeDesktopStoredSettings({
      projectAppearances: {
        ' project:one ': { color: 'purple', icon: 'plane' },
        '': { color: 'red', icon: 'flask' },
        '   ': { color: 'blue', icon: 'function' },
        'project:invalid-record': 'purple',
      },
    })

    expect(settings.projectAppearances).toEqual({
      'project:one': { color: 'purple', icon: 'plane' },
    })
  })

  test('非法颜色和图标分别回退默认值，规范化项目 ID 后保留首项', () => {
    const settings = normalizeDesktopStoredSettings({
      projectAppearances: {
        ' proje\u0301ct:cafe ': { color: 'not-a-color', icon: 'not-an-icon' },
        'projéct:cafe': { color: 'green', icon: 'flask' },
        'project:color-only': { color: 'blue', icon: 123 },
        'project:icon-only': { color: null, icon: 'terminal' },
      },
      recentWorkspaces: [
        {
          projectId: 'project:color-only',
          path: 'F:\\CodeProject\\ColorOnly',
          name: 'ColorOnly',
          pinnedAt: '2026-07-25T01:00:00.000Z',
        },
      ],
    })

    expect(settings.projectAppearances).toEqual({
      'projéct:cafe': DEFAULT_PROJECT_APPEARANCE,
      'project:color-only': { color: 'blue', icon: 'folder' },
      'project:icon-only': { color: 'default', icon: 'terminal' },
    })
    expect(settings.recentWorkspaces).toMatchObject([
      {
        projectId: 'project:color-only',
        pinnedAt: '2026-07-25T01:00:00.000Z',
      },
    ])
  })
})

test('不再持久化 GitHub OAuth 客户端与认证服务地址', () => {
  const settings = normalizeDesktopStoredSettings({
    githubOAuthClientId: 'legacy-client-id',
    authBaseUrl: 'https://legacy.example.com',
  })

  expect('githubOAuthClientId' in settings).toBe(false)
  expect('authBaseUrl' in settings).toBe(false)
})

describe('聊天宽度', () => {
  test('保留三个档位，旧设置及非法值回落默认宽度', () => {
    expect(defaultDesktopStoredSettings().conversationWidth).toBe('default')
    expect(normalizeDesktopStoredSettings({}).conversationWidth).toBe('default')
    for (const conversationWidth of ['default', 'narrow', 'wide'] as const) {
      expect(normalizeDesktopStoredSettings({ conversationWidth }).conversationWidth).toBe(
        conversationWidth,
      )
    }
    for (const conversationWidth of ['full', '', 1250, null]) {
      expect(normalizeDesktopStoredSettings({ conversationWidth }).conversationWidth).toBe(
        'default',
      )
    }
  })
})

test('日程会话显示默认开启、保留关闭状态并随侧栏重置恢复', () => {
  expect(defaultDesktopStoredSettings().sidebarShowScheduledSessions).toBe(true)
  expect(normalizeDesktopStoredSettings({}).sidebarShowScheduledSessions).toBe(true)
  expect(
    normalizeDesktopStoredSettings({ sidebarShowScheduledSessions: 'false' })
      .sidebarShowScheduledSessions,
  ).toBe(true)
  const settings = normalizeDesktopStoredSettings({ sidebarShowScheduledSessions: false })
  expect(normalizeDesktopStoredSettings(settings).sidebarShowScheduledSessions).toBe(false)
  expect(createSidebarStateResetPatch(settings).sidebarShowScheduledSessions).toBe(true)
})

test('活动日程筛选默认关闭，独立于普通侧栏并保留显式偏好', () => {
  const defaults = normalizeDesktopStoredSettings({})
  expect(defaults.sidebarActivityShowScheduled).toBe(false)
  expect(defaults.sidebarShowScheduledSessions).toBe(true)
  const saved = normalizeDesktopStoredSettings({
    sidebarTimelinePriorityEnabled: false,
    sidebarActivityShowScheduled: true,
    sidebarShowScheduledSessions: false,
  })
  expect(saved.sidebarTimelinePriorityEnabled).toBe(false)
  expect(saved.sidebarActivityShowScheduled).toBe(true)
  expect(saved.sidebarShowScheduledSessions).toBe(false)
  expect(createSidebarStateResetPatch(saved).sidebarActivityShowScheduled).toBe(false)
})
