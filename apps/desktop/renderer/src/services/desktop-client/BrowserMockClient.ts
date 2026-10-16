import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_API_METHODS,
  DESKTOP_SETTINGS_CHANGE_CHANNEL,
  DESKTOP_SESSION_STORE_CHANGE_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
  DESKTOP_UPDATE_STATUS_CHANNEL,
  DESKTOP_WORKFLOW_EVENT_CHANNEL,
  type DesktopApiMethod,
} from '../../../shared/IpcChannels.js'
import { encodeDesktopBridgeArgs } from '../../../shared/DesktopBridgeArgs.js'
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from '../../../shared/SettingsSchema.js'
import {
  collaborationModeFromPlanModeActive,
  planModeActiveFromCollaborationMode,
  resolveCollaborationMode,
} from '../../shims/core/agent/SessionContract.js'
import type { CatalogProvider, ModelRef, Project } from '@pidex/shared'
import type {
  PermissionConfig,
  SubagentProjection,
  ThreadListItem,
  ThreadSettings,
  ThreadSettingsPatch,
  ThreadSnapshot,
} from '@pidex/shared/thread'
import {
  type EventEnvelope,
  type JsonValue,
  type ProtocolCapability,
  type PluginSummary,
  type RpcParams,
  type RpcResult,
} from '@pidex/agent-protocol'
import {
  DEFAULT_DESKTOP_THEME_SETTINGS,
  normalizeDesktopThemeSettings,
} from '../../../shared/Theme.js'
import { desktopUserMessageInputToPreviewText } from '../../../shared/DesktopUserMessage.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopApi,
  DesktopBrowserState,
  DesktopDataLocationMigrationResult,
  DesktopDataLocationState,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopFileRevision,
  DesktopFileSaveResult,
  DesktopModelSelection,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopApiKeySummary,
  DesktopModelMetadata,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopReviewDiffResult,
  DesktopReviewSource,
  DesktopSessionEvent,
  DesktopSessionCatalogStatus,
  DesktopSessionMetadataPatch,
  DesktopRuntimeStatus,
  DesktopGithubAuthMode,
  DesktopGithubAuthStatus,
  DesktopGithubLoginStatus,
  DesktopGithubProfileOverviewResult,
  DesktopGithubRepositoryListResult,
  DesktopGitStatus,
  DesktopGitOperationResult,
  DesktopPullRequestResult,
  DesktopSettingsChange,
  DesktopSessionStoreChange,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopThemeSettings,
  DesktopSubagentRead,
  DesktopUpdateStatus,
  DesktopUserMessageInput,
  DesktopWorkspace,
  ModelProviderID,
} from '../../../shared/Types.js'
import {
  agentEventsFromNotification,
  agentQuestionIdFromRequestId,
  agentThreadListItemToDesktopSnapshot,
  agentThreadSnapshotToDesktop,
  desktopPermissionModeToPermissionConfig,
  projectToDesktopWorkspace,
} from '../AgentThreadAdapter.js'
import { createAgentRpcClient, type AgentRpcSubscription } from '../AgentRpcClient.js'

import {
  cleanGitStatus,
  createBrowserPerformanceFixture,
  createBrowserVisualFixture,
  emptyBrowserState,
  emptyReviewDiff,
  githubLoginFailure,
  mockCopilotLogin,
  mockGithubLogin,
  mockModelProvider,
  mockSessionSnapshot,
  mockWorkspace,
  readBrowserFixtureAttachment,
  readBrowserThemeSettings,
  requireMockSession,
} from './Fixtures.js'
import { bridgeWindowMaximized, mockAuthStatus, mockRuntimeStatus } from './FixtureRuntime.js'
import type {
  DesktopAttachmentApi,
  DesktopAutomationApi,
  DesktopCalendarApi,
  DesktopClientEnvironment,
  DesktopComputerApi,
  DesktopLocalContextApi,
  DesktopModelProviderRefreshApi,
  DesktopPluginApi,
  DesktopRuntimeCapabilityApi,
  DesktopSpeechApi,
  DesktopSpeechStatus,
} from './Types.js'

const BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY = 'pidex.desktop.appearance.v6'

const BROWSER_UNAVAILABLE_SPEECH_STATUS = {
  state: 'unsupported',
  provider: 'sensevoice-llamacpp',
  runtimeVersion: '0.1.9',
  model: 'sensevoice-small-q8',
  variant: null,
  maxDurationMs: 120_000,
  maxAudioBytes: 4_194_304,
  error: {
    code: 'SPEECH_PLATFORM_UNSUPPORTED',
    message: '浏览器预览环境不支持本地语音听写。',
  },
} as const satisfies DesktopSpeechStatus

function noop(): void {}

function mcpUnavailable(): never {
  const error = new Error(
    'MCP_UNAVAILABLE: 浏览器 mock 模式无法连接 Agent MCP 运行时。',
  ) as Error & { code: string }
  error.code = 'MCP_UNAVAILABLE'
  throw error
}

export function createBrowserMockDesktopClient(
  storage?: Storage,
): DesktopApi &
  DesktopRuntimeCapabilityApi &
  DesktopAttachmentApi &
  DesktopLocalContextApi &
  DesktopSpeechApi &
  DesktopAutomationApi &
  DesktopCalendarApi &
  DesktopModelProviderRefreshApi &
  DesktopPluginApi &
  DesktopComputerApi {
  let settings: DesktopStoredSettings = defaultDesktopStoredSettings()
  const visualFixture = createBrowserVisualFixture()
  const performanceFixture = createBrowserPerformanceFixture()
  const modelPickerVisualFixture =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('visualModelPicker') === '1'
  if (visualFixture || performanceFixture) {
    settings = { ...settings, providerID: 'mock', model: 'mock' }
  }
  if (visualFixture?.item.id === 'visual-scroll-edge' || performanceFixture) {
    settings = { ...settings, collapsedSidebarSections: [] }
  }
  let configDocument: Record<string, JsonValue> = {
    desktop: { ...settings } as unknown as JsonValue,
  }
  let configVersion = '0'.repeat(64)
  let selectedProfile: string | null = null
  let themeSettings: DesktopThemeSettings = readBrowserThemeSettings(storage)
  let browserState: DesktopBrowserState = emptyBrowserState()
  let githubLoginMode: DesktopGithubAuthMode = 'browser'
  const sessions = new Map<string, DesktopSessionSnapshot>()
  const sideChatSessionIds = new Set<string>()
  let activeSessionId: string | null = null
  const sessionStoreListeners = new Set<(change: DesktopSessionStoreChange) => void>()
  const settingsListeners = new Set<(change: DesktopSettingsChange) => void>()
  let mockPluginGeneration = 1
  let mockTaskPlanningPlugin: PluginSummary = {
    id: 'task-planning',
    name: '任务规划',
    version: '1.0.0',
    description: '澄清目标、拆解工作并生成可执行的任务规划。',
    developerName: 'Pidex',
    category: 'Productivity',
    source: 'bundled',
    installationPolicy: 'INSTALLED_BY_DEFAULT',
    installed: true,
    enabled: true,
    status: 'ready',
    capabilities: ['task-planning'],
    skills: ['task-planning'],
  }
  const mockTaskPlanningDetails: RpcResult<'plugin/getDetails'>['details'] = {
    pluginId: 'task-planning',
    longDescription:
      '澄清目标与约束，将复杂工作拆分为里程碑和可执行任务，并梳理依赖、风险与验收标准。',
    displayCapabilities: ['Planning'],
    defaultPrompts: [
      '帮我把这个目标拆解成可执行的任务计划。',
      '梳理这个项目的里程碑、依赖和主要风险。',
      '为这项工作补充清晰的验收标准。',
    ],
    skills: [
      {
        id: 'task-planning',
        name: '任务规划',
        description:
          'Clarify goals and constraints, then turn complex work into an actionable plan with milestones, dependencies, risks, and acceptance criteria.',
      },
    ],
  }
  let mockComputerState: RpcResult<'computer/state'> = {
    enabled: false,
    available: false,
    ownerThreadId: null,
    ownerTurnId: null,
    targetName: null,
    busy: false,
    permissions: [],
  }

  const provider = {
    ...mockModelProvider(settings.providerID),
    ...(visualFixture || performanceFixture ? { defaultModels: ['mock'] } : {}),
    ...(performanceFixture ? { apiKeyConfigured: true } : {}),
    ...(modelPickerVisualFixture
      ? {
          apiKeyConfigured: true,
          logoURL: '/favicon.png',
          modelMetadata: {
            mock: {
              id: 'mock',
              name: 'Browser Mock',
              reasoning: true,
              variants: ['low', 'medium', 'high'],
            },
          },
        }
      : {}),
  }
  const providerCatalogVisualFixture: DesktopModelProviderSummary[] | null =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('visualProviderCatalog') === 'logos'
      ? [
          ['mock', 'Loaded Logo', '/favicon.png'],
          ['visual-logo-error', 'Fallback Logo', '/missing-provider-logo.svg'],
          ['visual-logo-3', 'Provider Three', undefined],
          ['visual-logo-4', 'Provider Four', undefined],
          ['visual-logo-5', 'Provider Five', undefined],
          ['visual-logo-6', 'Provider Six', undefined],
        ].map(([providerID, displayName, logoURL]) => ({
          ...mockModelProvider(providerID as ModelProviderID),
          displayName,
          logoURL,
          modelCount: 1,
          providerKind: 'builtin' as const,
          catalogOrigin: 'pi-bundled' as const,
        }))
      : null
  const providerState = (): DesktopModelProviderState => ({
    selectedProviderID: settings.providerID,
    provider,
    model: settings.model,
    baseURL: settings.providerBaseURL || provider.baseURL,
    apiKeyConfigured: Boolean(performanceFixture),
    apiKeySource: null,
    modelConfigured: Boolean(settings.model),
    configurationMessage: '浏览器 mock 模式不会读取真实模型配置。',
    models: provider.defaultModels,
    modelMetadata: provider.modelMetadata,
  })
  const visualSessionReadDelayMs =
    import.meta.env.DEV && typeof window !== 'undefined'
      ? Math.min(
          2_000,
          Math.max(
            0,
            Number.parseInt(
              new URLSearchParams(window.location.search).get('visualSessionReadDelayMs') ?? '0',
              10,
            ) || 0,
          ),
        )
      : 0
  if (visualFixture) {
    sessions.set(visualFixture.item.id, visualFixture)
    activeSessionId = visualFixture.item.id
    if (new URLSearchParams(window.location.search).get('visualSwitchTargets') === '1') {
      for (const [suffix, title, userText, replyText] of [
        ['b', '切换目标 B', '这是会话 B', '会话 B 已加载。'],
        ['c', '切换目标 C', '这是会话 C', '会话 C 已加载。'],
      ] as const) {
        const sessionId = `visual-switch-${suffix}`
        const target = mockSessionSnapshot(sessionId, visualFixture.workspace, {
          workspacePath: visualFixture.workspace.path,
          sessionName: title,
        })
        const createdAt = new Date().toISOString()
        target.view.messages = [
          {
            id: `${sessionId}-user`,
            role: 'user',
            text: userText,
            createdAt,
          },
          {
            id: `${sessionId}-assistant`,
            role: 'assistant',
            text: replyText,
            createdAt,
          },
        ]
        target.item.lastMessageAt = createdAt
        target.updatedAt = createdAt
        sessions.set(sessionId, target)
      }
    }
    if (visualFixture.item.id === 'visual-scroll-edge') {
      // 26 个会话让“最近”分组超过分组上限，供会话扩展/折叠动画验证。
      for (let index = 2; index <= 26; index += 1) {
        const sessionId = `visual-scroll-edge-${String(index).padStart(2, '0')}`
        const target = mockSessionSnapshot(sessionId, visualFixture.workspace, {
          workspacePath: visualFixture.workspace.path,
          sessionName: `滚动边界会话 ${index}`,
        })
        const createdAt = new Date(Date.now() - index * 60_000).toISOString()
        target.view.messages = [
          {
            id: `${sessionId}-user`,
            role: 'user',
            text: `第 ${index} 个会话。`,
            createdAt,
          },
          {
            id: `${sessionId}-assistant`,
            role: 'assistant',
            text: `会话 ${index} 已加载。`,
            createdAt,
          },
        ]
        target.item.lastMessageAt = createdAt
        target.updatedAt = createdAt
        sessions.set(sessionId, target)
      }
    }
  }
  if (performanceFixture) {
    for (const snapshot of performanceFixture.sessions) {
      sessions.set(snapshot.item.id, snapshot)
    }
    activeSessionId = performanceFixture.activeSessionId
  }

  return {
    getSpeechStatus: async () => BROWSER_UNAVAILABLE_SPEECH_STATUS,
    installSpeech: async () => BROWSER_UNAVAILABLE_SPEECH_STATUS,
    transcribeSpeech: async () => {
      throw new Error('浏览器预览环境不支持本地语音听写。')
    },
    cancelSpeech: async () => false,
    onSpeechStatusUpdated: () => () => {},
    openMicrophonePrivacySettings: async () => {},
    readAttachment: async (attachmentId) => readBrowserFixtureAttachment(attachmentId),
    submitVisualizationFollowUp: async () => {
      throw new Error('浏览器模拟环境不支持可视化追问。')
    },
    readArtifact: async () => {
      throw new Error('浏览器模拟环境不支持 artifact 读取。')
    },
    readLocalContextPath: async () => {
      throw new Error('浏览器模拟环境不支持本地路径上下文。')
    },
    listLocalContextPath: async () => {
      throw new Error('浏览器模拟环境不支持本地路径上下文。')
    },
    saveAttachmentToDownloads: async (input) => ({ fileName: input.name }),
    readDraftComposerPath: async () => {
      throw new Error('浏览器模拟环境不支持本地路径预览。')
    },
    listDraftComposerPath: async () => {
      throw new Error('浏览器模拟环境不支持本地目录预览。')
    },
    getRuntimeCapabilities: async () =>
      (await import('@pidex/agent-protocol/capabilities')).Capabilities,
    pauseQuestion: async () => {},
    approvalReviewState: async () => ({ manualAllows: 0, denials: [] }),
    retryApproval: async () => {},
    listApprovalRules: async () => ({ rules: [] }),
    revokeApprovalRule: async () => {},
    listAutomations: async () => ({ automations: [] }),
    listAutomationRuns: async () => ({ runs: [] }),
    readAutomation: async () => {
      throw new Error('浏览器模拟环境中不存在该自动化。')
    },
    createAutomation: async () => {
      throw new Error('浏览器模拟环境不保存自动化。')
    },
    updateAutomation: async () => {
      throw new Error('浏览器模拟环境不保存自动化。')
    },
    deleteAutomation: async () => {
      throw new Error('浏览器模拟环境不保存自动化。')
    },
    runAutomation: async () => {
      throw new Error('浏览器模拟环境不执行自动化。')
    },
    markAutomationRunRead: async () => {
      throw new Error('浏览器模拟环境中不存在该运行。')
    },
    markAllAutomationRunsRead: async () => ({ updatedCount: 0 }),
    previewAutomationSchedule: async (input) => ({
      canonicalRrule:
        input.schedule.mode === 'custom'
          ? input.schedule.rrule
          : `FREQ=${input.schedule.mode.toUpperCase()}`,
      summary: '浏览器自动化预览',
      nextRunAt: [],
    }),
    listCalendarOccurrences: async () => ({ occurrences: [], truncated: false }),
    readScheduledTask: async () => {
      throw new Error('浏览器模拟环境中不存在该计划任务。')
    },
    createScheduledTask: async () => {
      throw new Error('浏览器模拟环境不保存计划任务。')
    },
    updateScheduledTask: async () => {
      throw new Error('浏览器模拟环境不保存计划任务。')
    },
    deleteScheduledTask: async () => {
      throw new Error('浏览器模拟环境不保存计划任务。')
    },
    runScheduledTask: async () => {
      throw new Error('浏览器模拟环境不执行计划任务。')
    },
    readSchedulePlan: async () => {
      throw new Error('浏览器模拟环境中不存在该规划草案。')
    },
    commitSchedulePlan: async () => {
      throw new Error('浏览器模拟环境不保存规划草案。')
    },
    readScheduleDraft: async () => {
      throw new Error('浏览器模拟环境中不存在该任务规划草案。')
    },
    commitScheduleDraft: async () => {
      throw new Error('浏览器模拟环境不保存任务规划草案。')
    },
    cancelScheduleDraft: async () => {
      throw new Error('浏览器模拟环境不保存任务规划草案。')
    },
    feedbackScheduleDraft: async () => {
      throw new Error('浏览器模拟环境不保存任务规划草案。')
    },
    getAuthStatus: async () => mockAuthStatus(),
    getRuntimeStatus: async () => mockRuntimeStatus(),
    diagnoseDesktopToolchain: async () => {
      const runtimeStatus = mockRuntimeStatus()
      return {
        enabled: settings.installPidexDependencies,
        root: runtimeStatus.toolchainRoot,
        managedRoot: runtimeStatus.managedToolchainRoot,
        packagedRoot: runtimeStatus.packagedToolchainRoot,
        pathEntries: runtimeStatus.toolchainPathEntries,
        binaries: runtimeStatus.toolchainBinaries,
      }
    },
    reinstallDesktopToolchain: async () => {
      const runtimeStatus = mockRuntimeStatus()
      return {
        ok: true,
        root: runtimeStatus.managedToolchainRoot,
        copiedFrom: null,
        diagnostics: {
          enabled: settings.installPidexDependencies,
          root: runtimeStatus.toolchainRoot,
          managedRoot: runtimeStatus.managedToolchainRoot,
          packagedRoot: runtimeStatus.packagedToolchainRoot,
          pathEntries: runtimeStatus.toolchainPathEntries,
          binaries: runtimeStatus.toolchainBinaries,
        },
      }
    },
    deleteDesktopToolchain: async () => {
      const runtimeStatus = mockRuntimeStatus()
      return {
        ok: true,
        root: runtimeStatus.managedToolchainRoot,
        copiedFrom: null,
        diagnostics: {
          enabled: settings.installPidexDependencies,
          root: null,
          managedRoot: runtimeStatus.managedToolchainRoot,
          packagedRoot: runtimeStatus.packagedToolchainRoot,
          pathEntries: [],
          binaries: runtimeStatus.toolchainBinaries,
        },
      }
    },
    readConfig: async (params) => ({
      config: configDocument,
      origins: {},
      ...(params?.includeLayers
        ? {
            layers: [
              {
                kind: 'user' as const,
                displayName: '用户配置',
                filePath: 'C:/Users/mock/.pidex/config.json',
                version: configVersion,
                writable: true,
                trusted: true,
                config: configDocument,
              },
            ],
          }
        : {}),
      diagnostics: [],
      profileState: {
        activeProfile: null,
        selectedProfile,
        restartRequired: selectedProfile !== null,
      },
    }),
    writeConfigBatch: async (params) => {
      for (const edit of params.edits) {
        let target = configDocument
        for (const part of edit.keyPath.slice(0, -1)) {
          const next = target[part]
          if (!next || typeof next !== 'object' || Array.isArray(next)) target[part] = {}
          target = target[part] as Record<string, JsonValue>
        }
        const leaf = edit.keyPath.at(-1)!
        if (edit.value === null) delete target[leaf]
        else target[leaf] = edit.value
      }
      configVersion = (configVersion[0] === '0' ? '1' : '0').repeat(64)
      return {
        status: 'ok',
        version: configVersion,
        filePath: params.filePath ?? 'C:/Users/mock/.pidex/config.json',
      }
    },
    listConfigProfiles: async () => ({
      profileState: {
        activeProfile: null,
        selectedProfile,
        restartRequired: selectedProfile !== null,
      },
      profiles: [],
      profilesDirectory: 'C:/Users/mock/.pidex/profiles',
    }),
    selectConfigProfile: async (profileId) => {
      selectedProfile = profileId
      if (profileId === null) delete configDocument.profile
      else configDocument.profile = profileId
      configVersion = (configVersion[0] === '0' ? '1' : '0').repeat(64)
      return {
        status: 'ok',
        version: configVersion,
        filePath: 'C:/Users/mock/.pidex/config.json',
        profileState: {
          activeProfile: null,
          selectedProfile,
          restartRequired: selectedProfile !== null,
        },
      }
    },
    getDesktopSettings: async () => settings,
    saveDesktopSettings: async (next) => {
      settings = { ...settings, ...next }
      emitSettingsChange()
      return settings
    },
    listProjectMemories: async (workspacePath) => ({
      memoryDir: `${workspacePath || 'mock'}/.pidex-memory/`,
      entrypointPath: `${workspacePath || 'mock'}/.pidex-memory/MEMORY.md`,
      memories: [],
    }),
    readProjectMemory: async (_workspacePath, relativePath) => ({
      relativePath,
      absolutePath: relativePath,
      description: null,
      size: 0,
      mtimeMs: 0,
      content: '',
    }),
    saveProjectMemory: async (input) => ({
      relativePath: input.relativePath,
      absolutePath: input.relativePath,
      description: null,
      size: input.content.length,
      mtimeMs: Date.now(),
    }),
    deleteProjectMemory: async () => {},
    resetProjectMemory: async () => {},
    listProjectMemoryRecalls: async (workspacePath) => ({
      recallLogPath: `${workspacePath || 'mock'}/.pidex-memory/.recall-events.jsonl`,
      recalls: [],
    }),
    listUserMemories: async () => ({
      memoryDir: 'mock/user-memory/',
      profilePath: 'mock/user-memory/profile.memory.md',
      preferencesPath: 'mock/user-memory/preferences.json',
      eventsPath: 'mock/user-memory/memory_events.jsonl',
      conversationIndexPath: 'mock/user-memory/conversation_index.sqlite',
      memories: [],
    }),
    readUserMemory: async (relativePath) => ({
      relativePath,
      absolutePath: relativePath,
      description: null,
      size: 0,
      mtimeMs: 0,
      content: '',
    }),
    saveUserMemory: async (input) => ({
      relativePath: input.relativePath,
      absolutePath: input.relativePath,
      description: null,
      size: input.content.length,
      mtimeMs: Date.now(),
    }),
    deleteUserMemory: async () => {},
    resetUserMemory: async () => {},
    generateTaskSuggestions: async () => {
      throw new Error('TASK_SUGGESTIONS_UNAVAILABLE')
    },
    exportUserMemory: async () => ({
      memoryDir: 'mock/user-memory/',
      files: [],
    }),
    importUserMemory: async (input) => ({
      memoryDir: 'mock/user-memory/',
      files: input.files,
    }),
    getBrowserState: async () => browserState,
    openBrowser: async (url) => {
      browserState = {
        ...browserState,
        open: true,
        url: url ?? browserState.url,
        allowedSites: settings.browserAllowedSites,
        sitePermissions: settings.browserSitePermissions,
      }
      return browserState
    },
    navigateBrowser: async (url) => {
      browserState = { ...browserState, open: true, url }
      return browserState
    },
    reloadBrowser: async () => browserState,
    goBackBrowser: async () => browserState,
    goForwardBrowser: async () => browserState,
    closeBrowser: async () => {
      browserState = emptyBrowserState()
      return browserState
    },
    setBrowserBounds: async () => browserState,
    clearBrowserAllowedSites: async () => {
      settings = { ...settings, browserAllowedSites: [], browserSitePermissions: [] }
      browserState = { ...browserState, allowedSites: [], sitePermissions: [] }
      return browserState
    },
    readPluginAsset: async () => null,
    listPlugins: async () => ({
      plugins: [mockTaskPlanningPlugin],
      generation: mockPluginGeneration,
      updatedAt: Date.now(),
    }),
    getPluginDetails: async (pluginId) =>
      pluginId === mockTaskPlanningPlugin.id ? mockTaskPlanningDetails : null,
    installPlugin: async () => {
      throw new Error('演示客户端不执行插件下载，请连接 Agent。')
    },
    uninstallPlugin: async () => {
      throw new Error('演示客户端不执行插件移除，请连接 Agent。')
    },
    setPluginEnabled: async (pluginId, enabled) => {
      if (pluginId !== mockTaskPlanningPlugin.id) {
        throw new Error('PLUGIN_NOT_FOUND')
      }
      mockPluginGeneration += 1
      mockTaskPlanningPlugin = { ...mockTaskPlanningPlugin, enabled }
      return mockTaskPlanningPlugin
    },
    onPluginsUpdated: () => () => {},
    getComputerState: async () => mockComputerState,
    discoverComputerApps: async () => ({ apps: [] }),
    configureComputer: async (input) => {
      mockComputerState = {
        ...mockComputerState,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.decision && input.appId
          ? {
              permissions:
                input.decision === 'remove'
                  ? mockComputerState.permissions.filter(
                      (permission) => permission.appId !== input.appId,
                    )
                  : [
                      ...mockComputerState.permissions.filter(
                        (permission) => permission.appId !== input.appId,
                      ),
                      { appId: input.appId, name: input.appId, decision: input.decision },
                    ],
            }
          : {}),
      }
      return mockComputerState
    },
    stopComputer: async () => ({ ok: true }),
    onComputerChanged: () => () => {},
    listSkillsCatalog: async (options) => ({
      skills: [],
      page: options?.page ?? 0,
      perPage: options?.perPage ?? 20,
      total: 0,
      hasMore: false,
    }),
    installSkill: async (skill) => ({
      id: typeof skill === 'string' ? skill : skill.id,
      slug: typeof skill === 'string' ? skill : skill.id,
      installed: false,
      installPath: '',
    }),
    listMcpServers: async () => mcpUnavailable(),
    getMcpRuntimeStatus: async () => mcpUnavailable(),
    saveMcpServer: async () => mcpUnavailable(),
    removeMcpServer: async () => mcpUnavailable(),
    setMcpServerEnabled: async () => mcpUnavailable(),
    reloadMcpConfiguration: async () => mcpUnavailable(),
    startMcpOAuth: async () => mcpUnavailable(),
    getMcpOAuthStatus: async () => mcpUnavailable(),
    logoutMcpOAuth: async () => mcpUnavailable(),
    listOpenTargets: async () => [
      { id: 'file-explorer', label: 'File Explorer', kind: 'file-explorer' },
    ],
    listExternalOpenTargets: async () => [
      {
        id: 'file-explorer',
        label: 'File Explorer',
        kind: 'file-explorer',
        preferred: true,
      },
    ],
    openPathWithTarget: async () => {},
    openPathWithDefaultTarget: async () => {},
    revealPathInFolder: async () => {},
    refreshModelProviders: async () => {},
    listModelProviders: async () => providerCatalogVisualFixture ?? [provider],
    getModelProviderState: async () => providerState(),
    fetchProviderModels: async () => ({ models: provider.defaultModels }),
    saveModelProvider: async (options) => {
      settings = {
        ...settings,
        providerID: options.providerID,
        model: options.id ?? settings.model,
      }
      return providerState()
    },
    getRecentNewThreadModel: async () =>
      settings.model ? ({ providerID: settings.providerID, id: settings.model } as ModelRef) : null,
    saveRecentNewThreadModel: async (model) => {
      settings = {
        ...settings,
        providerID: model.providerID,
        model: model.id,
      }
    },
    resolveFirstAvailableModel: async () =>
      provider.defaultModels.length > 0
        ? ({
            providerID: settings.providerID,
            id: provider.defaultModels[0]!,
          } as ModelRef)
        : null,
    saveProviderApiKey: async () => providerState(),
    deleteProviderApiKey: async () => providerState(),
    listProviderCredentials: async () => [],
    createApiKey: async (input) =>
      ({
        id: crypto.randomUUID(),
        providerId: input.providerId,
        kind: 'api-key',
        label: input.label,
        maskedValue: '••••mock',
        enabled: true,
        active: true,
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }) as never,
    updateApiKey: async (input) =>
      ({
        id: input.credentialId,
        providerId: provider.providerID,
        kind: 'api-key',
        label: input.label ?? 'Mock key',
        maskedValue: '••••mock',
        enabled: true,
        active: true,
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }) as never,
    setActiveProviderCredential: async (_providerId, credentialId) =>
      ({
        id: credentialId,
        providerId: provider.providerID,
        kind: 'api-key',
        label: 'Mock key',
        enabled: true,
        active: true,
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }) as never,
    setProviderCredentialEnabled: async (credentialId, enabled) =>
      ({
        id: credentialId,
        providerId: provider.providerID,
        kind: 'api-key',
        label: 'Mock key',
        enabled,
        active: enabled,
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }) as never,
    reorderApiKeys: async () => [],
    testApiKey: async () => ({ ok: true, message: 'API Key 可用。' }),
    deleteProviderCredential: async () => [],
    readProviderCredentialStore: async () => ({
      store: 'auth-json',
      portable: true,
      credentialCount: 1,
      migrationRequired: false,
    }),
    updateProviderCredentialStore: async (store) => ({
      store,
      portable: store === 'auth-json',
      credentialCount: 1,
      migrationRequired: false,
      migratedCredentials: 1,
    }),
    testModelProvider: async (providerID, model) =>
      ({
        providerId: providerID as RpcParams<'provider/test'>['providerId'],
        status: 'reachable',
        testedAt: Date.now(),
        latencyMs: 12,
        model: (model ?? {
          providerID,
          id: 'mock-model',
        }) as Extract<RpcResult<'provider/test'>, { status: 'reachable' }>['model'],
      }) as RpcResult<'provider/test'>,
    previewModelHealth: async () => ({
      totalRequests: 0,
      excludedProviders: [],
    }),
    startModelHealth: async (operationId) => ({
      run: {
        runId: operationId,
        status: 'completed',
        startedAt: Date.now(),
        completedAt: Date.now(),
        counts: {
          total: 0,
          queued: 0,
          running: 0,
          healthy: 0,
          failed: 0,
          cancelled: 0,
        },
        excludedProviders: [],
        items: [],
      },
    }),
    readModelHealth: async () => ({ run: null }),
    cancelModelHealth: async () => ({
      run: {
        runId: 'mock',
        status: 'cancelled',
        startedAt: Date.now(),
        completedAt: Date.now(),
        counts: {
          total: 0,
          queued: 0,
          running: 0,
          healthy: 0,
          failed: 0,
          cancelled: 0,
        },
        excludedProviders: [],
        items: [],
      },
    }),
    createProvider: async () => undefined,
    updateProvider: async () => undefined,
    deleteProvider: async () => undefined,
    discoverProviderModels: async () => [],
    startAuthSession: async (target) =>
      ({
        id: crypto.randomUUID(),
        target,
        status: 'complete',
        notices: [
          {
            type: 'info',
            message: '浏览器 mock 模式不会启动真实授权。',
          },
        ],
        createdAt: Date.now(),
        expiresAt: Date.now() + 300_000,
      }) as never,
    respondAuthSession: async () => {
      throw new Error('浏览器 mock 模式没有等待中的授权提示。')
    },
    getAuthSessionStatus: async () => {
      throw new Error('浏览器 mock 模式没有活动授权会话。')
    },
    cancelAuthSession: async () => {
      throw new Error('浏览器 mock 模式没有活动授权会话。')
    },
    getCopilotAuthStatus: async () => ({ authenticated: false }),
    startCopilotLogin: async () => mockCopilotLogin(),
    pollCopilotLogin: async () => mockCopilotLogin(),
    cancelCopilotLogin: async () => ({ cancelled: true }),
    getGithubAuthStatus: async () => ({
      configured: false,
      authenticated: false,
      user: null,
    }),
    startGithubLogin: async (input) => {
      githubLoginMode = input.mode
      return mockGithubLogin(githubLoginMode)
    },
    pollGithubLogin: async () => mockGithubLogin(githubLoginMode),
    logoutGithub: async () => ({
      configured: false,
      authenticated: false,
      user: null,
    }),
    listGithubRepositories: async () => ({ ok: true, repositories: [] }),
    getGithubProfileOverview: async () => ({
      ok: false,
      error: '浏览器 mock 模式未连接 GitHub。',
    }),
    setGithubUserStatus: async () => ({
      ok: false,
      error: '浏览器 mock 模式未连接 GitHub。',
    }),
    clearGithubUserStatus: async () => ({
      ok: true,
      status: null,
    }),
    cloneGithubRepository: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会克隆仓库。',
    }),
    listProjects: async (folderPath) => {
      if (folderPath) return [{ ...mockWorkspace(folderPath), projectId: `mock:${folderPath}` }]
      return []
    },
    updateProject: async (input) => ({
      ...mockWorkspace(''),
      projectId: input.projectId,
      name: input.name,
    }),
    editProject: async (input) => ({
      ...mockWorkspace(input.paths[0] ?? ''),
      projectId: input.projectId,
      name: input.name,
      folders: input.paths.map((path, order) => ({
        id: path,
        name: path,
        path,
        role: order === 0 ? ('primary' as const) : ('secondary' as const),
        availability: 'available' as const,
        order,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
    }),
    restoreProject: async (projectId) => ({ ...mockWorkspace(''), projectId }),
    chooseProjectFolders: async () => [],
    removeProject: async () => ({ archivedThreadCount: 0 }),
    addProjectFolder: async (projectId, path) => ({
      ...mockWorkspace(path),
      projectId,
    }),
    removeProjectFolder: async (projectId) => ({
      ...mockWorkspace(''),
      projectId,
    }),
    setPrimaryProjectFolder: async (projectId) => ({
      ...mockWorkspace(''),
      projectId,
    }),
    updateProjectSettings: async (input) => ({
      ...mockWorkspace(''),
      projectId: input.projectId,
      projectSettings: {
        defaultModel: input.defaultModel ?? null,
        instructions: input.instructions ?? '',
        executionEnvironment: input.executionEnvironment ?? 'auto',
        version: input.expectedVersion + 1,
      },
    }),
    listProjectSources: async () => [],
    importProjectSources: async () => [],
    addProjectSourceReference: async () => [],
    readProjectSource: async () => {
      throw new Error('浏览器模拟模式没有可预览的项目来源。')
    },
    removeProjectSource: async () => false,
    chooseProjectFolder: async () => null,
    chooseWorkspace: async () => null,
    openWorkspace: async (workspacePath) => mockWorkspace(workspacePath),
    getWorkspaceContext: async (workspacePath) => mockWorkspace(workspacePath),
    checkoutWorkspaceBranch: async (workspacePath, branchName) => ({
      ...mockWorkspace(workspacePath),
      branchName,
    }),
    getWorkspaceGitStatus: async () => ({ ok: true, status: cleanGitStatus() }),
    createWorkspaceBranch: async (input) => ({
      ok: true,
      workspace: {
        ...mockWorkspace(input.workspacePath),
        branchName: input.branchName,
      },
      status: { ...cleanGitStatus(), branchName: input.branchName },
    }),
    commitWorkspaceChanges: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会提交文件。',
    }),
    pushWorkspaceBranch: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会推送分支。',
    }),
    discardWorkspaceChanges: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会放弃文件改动。',
    }),
    restoreSessionTurnChanges: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会恢复对话轮次改动。',
    }),
    createPullRequest: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会创建 Pull Request。',
    }),
    listThreadPullRequests: async (threadIds) => ({
      ok: true,
      threads: threadIds.map((threadId) => ({ threadId, items: [] })),
    }),
    linkThreadPullRequest: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会关联 Pull Request。',
    }),
    unlinkThreadPullRequest: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会解除 Pull Request 关联。',
    }),
    getWorkspaceReviewDiff: async () => emptyReviewDiff(),
    applyWorkspaceReviewOperation: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会修改 git 暂存区。',
    }),
    listWorkspaceFiles: async (_workspacePath, directoryPath = '.') => {
      const tree: DesktopFileEntry[] = [
        { name: 'apps', path: 'apps', type: 'directory', depth: 0 },
        { name: 'packages', path: 'packages', type: 'directory', depth: 0 },
        { name: 'README.md', path: 'README.md', type: 'file', depth: 0 },
        { name: 'desktop', path: 'apps/desktop', type: 'directory', depth: 1 },
        { name: 'renderer', path: 'apps/desktop/renderer', type: 'directory', depth: 2 },
        {
          name: 'package.json',
          path: 'apps/desktop/renderer/package.json',
          type: 'file',
          depth: 3,
        },
      ]
      const parent = directoryPath === '' ? '.' : directoryPath.replaceAll('\\', '/')
      return tree.filter((entry) => {
        const separator = entry.path.lastIndexOf('/')
        const entryParent = separator < 0 ? '.' : entry.path.slice(0, separator)
        return entryParent === parent
      })
    },
    readWorkspaceFile: async (_workspacePath, filePath) => ({
      path: filePath,
      content:
        filePath === 'README.md'
          ? '# Pidex\n\n**可编辑的 Markdown** 与 `inline code`。\n\n- 无序列表项目\n\n| 优化点 | 说明 |\n| --- | --- |\n| 缓存命中优化 | 稳定复用前缀 |\n\n```text\nbun run build\n```\n'
          : '',
      truncated: false,
      sizeBytes:
        filePath === 'README.md'
          ? new TextEncoder().encode(
              '# Pidex\n\n**可编辑的 Markdown** 与 `inline code`。\n\n- 无序列表项目\n\n| 优化点 | 说明 |\n| --- | --- |\n| 缓存命中优化 | 稳定复用前缀 |\n\n```text\nbun run build\n```\n',
            ).byteLength
          : 0,
      readonly: false,
      revision: { mtimeMs: 0, sha256: '' },
    }),
    readOptionalWorkspaceFile: async () => null,
    saveWorkspaceFile: async (input) => ({
      outcome: 'saved',
      revision: input.expectedRevision,
    }),
    watchWorkspaceFile: async () => {},
    unwatchWorkspaceFile: async () => {},
    isComposerFileAttachmentAvailable: async () => false,
    chooseComposerFiles: async () => [],
    grantComposerFilePaths: async () => [],
    getComposerFilePath: () => '',
    getWorkspaceDiff: async () => ({
      patch: '',
    }),
    getThemeSettings: async () => themeSettings,
    saveThemeSettings: async (next) => {
      themeSettings = normalizeDesktopThemeSettings(next)
      try {
        storage?.setItem(BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY, JSON.stringify(themeSettings))
      } catch {
        // Browser preview persistence is best-effort.
      }
    },
    canRestorePreviousAppearance: async () => false,
    restorePreviousAppearance: async () => themeSettings,
    applyNewDesignTheme: async () => {
      themeSettings = normalizeDesktopThemeSettings({
        ...themeSettings,
        chromeThemes: {
          light: {
            ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.light,
            fonts: {
              ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.light.fonts,
              code: themeSettings.chromeThemes.light.fonts.code,
              codeFace: themeSettings.chromeThemes.light.fonts.codeFace,
            },
          },
          dark: {
            ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.dark,
            fonts: {
              ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.dark.fonts,
              code: themeSettings.chromeThemes.dark.fonts.code,
              codeFace: themeSettings.chromeThemes.dark.fonts.codeFace,
            },
          },
        },
        fontSizes: {
          ...themeSettings.fontSizes,
          ui: 14,
        },
      })
      try {
        storage?.setItem(BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY, JSON.stringify(themeSettings))
      } catch {
        // Browser preview persistence is best-effort.
      }
      return themeSettings
    },
    createSession: async (options) => {
      const workspace = options.workspacePath
        ? mockWorkspace(options.workspacePath)
        : mockWorkspace('')
      const sessionId = `browser-mock-${sessions.size + 1}`
      const snapshot = mockSessionSnapshot(sessionId, workspace, options)
      sessions.set(sessionId, snapshot)
      activeSessionId = sessionId
      emitSessionStoreChange()
      return {
        sessionId,
        workspace,
        standalone: !options.workspacePath,
      }
    },
    createSideChat: async (input) => {
      const source = requireMockSession(sessions, input.sourceThreadId)
      const threadId = `browser-mock-side-chat-${crypto.randomUUID()}`
      const createdAt = Date.now()
      const includeVisualTimeline =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('visualSideChatSecondMessage') === '1' &&
        sideChatSessionIds.size > 0
      const sideChatMessages = includeVisualTimeline
        ? [
            {
              id: `${threadId}-user`,
              role: 'user' as const,
              text: '帮我检查这个函数的边界条件。',
              createdAt: new Date(createdAt).toISOString(),
            },
            {
              id: `${threadId}-assistant`,
              role: 'assistant' as const,
              text: '已检查：空输入和分页边界都需要单独处理。',
              createdAt: new Date(createdAt + 1).toISOString(),
            },
          ]
        : []
      sessions.set(threadId, {
        ...source,
        item: {
          ...source.item,
          id: threadId,
          sessionName: '侧边聊天',
          aiTitle: null,
          customTitle: null,
          firstPrompt: null,
          archivedAt: new Date(-1).toISOString(),
          status: 'idle',
          createdAt: new Date(createdAt).toISOString(),
        },
        view: {
          ...source.view,
          messages: sideChatMessages,
          toolLog: [],
          pendingPermissions: [],
          contextUsage: null,
        },
        events: [],
        workflowEvents: [],
        queuedFollowUps: [],
        updatedAt: new Date(createdAt + sideChatMessages.length).toISOString(),
      })
      sideChatSessionIds.add(threadId)
      return {
        sideChat: {
          threadId,
          sourceThreadId: input.sourceThreadId,
          inheritedThroughTurnId: null,
          createdAt,
        },
      }
    },
    discardSideChat: async (input) => {
      sessions.delete(input.threadId)
      sideChatSessionIds.delete(input.threadId)
      return { ok: true as const }
    },
    listSessions: async (options) =>
      [...sessions.values()].filter(
        (snapshot) =>
          !sideChatSessionIds.has(snapshot.item.id) &&
          (options?.archived === true
            ? Boolean(snapshot.item.archivedAt)
            : !snapshot.item.archivedAt),
      ),
    getSessionCatalogStatus: async () => ({ state: 'ready' }),
    getSession: async (sessionId) => {
      if (visualSessionReadDelayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, visualSessionReadDelayMs))
      }
      const snapshot = sessions.get(sessionId)
      if (!snapshot) throw new Error(`Mock session not found: ${sessionId}`)
      return snapshot
    },
    getActiveSessionId: async () => activeSessionId,
    setActiveSession: async (sessionId) => {
      activeSessionId = sessionId
      emitSessionStoreChange()
    },
    publishCanonicalSessionStatus: (_threadId, _status) => {
      // The browser preview has no agent turn lifecycle behind its mock sessions,
      // so there is no canonical projection to overlay here.
    },
    markSessionRead: async (sessionId, readThroughAt) => {
      const snapshot = sessions.get(sessionId)
      if (!snapshot) throw new Error(`Mock session not found: ${sessionId}`)
      const unreadAt = snapshot.item.unreadAt
      if (!unreadAt || Date.parse(unreadAt) > Date.parse(readThroughAt)) {
        return snapshot.item
      }
      const next = {
        ...snapshot,
        item: { ...snapshot.item, unreadAt: null },
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next.item
    },
    markSessionUnread: async (sessionId, unreadAt) => {
      const snapshot = sessions.get(sessionId)
      if (!snapshot) throw new Error(`Mock session not found: ${sessionId}`)
      const unreadTimestamp = Date.parse(unreadAt)
      if (!Number.isFinite(unreadTimestamp) || unreadTimestamp < 0) {
        throw new Error('INVALID_UNREAD_AT')
      }
      const currentTimestamp = snapshot.item.unreadAt ? Date.parse(snapshot.item.unreadAt) : 0
      const nextUnreadAt = new Date(Math.max(currentTimestamp, unreadTimestamp)).toISOString()
      const next = {
        ...snapshot,
        item: { ...snapshot.item, unreadAt: nextUnreadAt },
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next.item
    },
    updateSessionMetadata: async (sessionId, patch) => {
      const snapshot = sessions.get(sessionId)
      if (!snapshot) throw new Error(`Mock session not found: ${sessionId}`)
      const next = {
        ...snapshot,
        item: { ...snapshot.item, ...patch },
        updatedAt: new Date().toISOString(),
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next
    },
    renameSession: async (sessionId, name) => {
      const snapshot = sessions.get(sessionId)
      if (!snapshot) throw new Error(`Unknown desktop session: ${sessionId}`)
      const next = {
        ...snapshot,
        item: { ...snapshot.item, sessionName: name },
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next
    },
    saveSessionReviewComment: async (input) => requireMockSession(sessions, input.sessionId),
    resolveSessionReviewComment: async (input) => requireMockSession(sessions, input.sessionId),
    deleteSessionReviewComment: async (input) => requireMockSession(sessions, input.sessionId),
    setSessionPermissionMode: async (sessionId, mode) => {
      const snapshot = requireMockSession(sessions, sessionId)
      const permissionConfig = desktopPermissionModeToPermissionConfig(mode)
      const next = {
        ...snapshot,
        item: { ...snapshot.item, permissionMode: mode },
        settings: { ...snapshot.settings, permissionConfig },
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next
    },
    setSessionPlanModeActive: async (sessionId, active) => {
      const snapshot = requireMockSession(sessions, sessionId)
      const collaborationMode = collaborationModeFromPlanModeActive(active)
      const next = {
        ...snapshot,
        item: { ...snapshot.item, collaborationMode, planModeActive: active },
        settings: {
          ...snapshot.settings,
          collaborationMode,
          planModeActive: active,
        },
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next
    },
    setSessionLocalRouterMode: async (sessionId, mode) => {
      const snapshot = requireMockSession(sessions, sessionId)
      const next = {
        ...snapshot,
        item: { ...snapshot.item, localRouterMode: mode },
        settings: { ...snapshot.settings, localRouterMode: mode },
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next
    },
    openExternalURL: async (url) => {
      globalThis.open?.(url, '_blank', 'noopener,noreferrer')
    },
    sendUserMessage: async () => {},
    respondToPermission: async () => {},
    interruptSession: async () => {},
    disposeSession: async (sessionId) => {
      sessions.delete(sessionId)
      if (activeSessionId === sessionId) {
        activeSessionId = [...sessions.keys()][0] ?? null
      }
      emitSessionStoreChange()
    },
    minimizeWindow: async () => {
      await window.DesktopBridge?.minimize()
    },
    toggleWindowMaximized: async () => (await window.DesktopBridge?.toggleMaximize()) ?? false,
    closeWindow: async () => {
      await window.DesktopBridge?.close()
    },
    isWindowMaximized: async () => bridgeWindowMaximized(),
    newWindow: async () => {},
    openDevTools: async () => {},
    closeDevTools: async () => {},
    openSettings: async () => {},
    logOut: async () => {},
    exitApp: async () => {},
    getDataLocation: async (): Promise<DesktopDataLocationState> => ({
      defaultDataDir: '',
      currentDataDir: '',
      pendingDataDir: null,
      controlSource: 'default',
      isEnvControlled: false,
    }),
    chooseDataLocation: async (): Promise<DesktopDataLocationMigrationResult | null> => null,
    onAgentEvent: () => noop,
    onWorkflowEvent: () => noop,
    onUiCommand: () => noop,
    onSessionStoreChange: (callback) => {
      sessionStoreListeners.add(callback)
      return () => {
        sessionStoreListeners.delete(callback)
      }
    },
    onReconciliationError: () => noop,
    onDesktopSettingsChange: (callback) => {
      settingsListeners.add(callback)
      return () => {
        settingsListeners.delete(callback)
      }
    },
    checkForUpdates: async () => {},
    downloadUpdate: async () => {},
    quitAndInstall: async () => {},
    onUpdateStatusChange: () => noop,
    listDebugBuiltinTools: async () => ({
      toolNames: [],
      enabled: [],
      hasProbeInput: [],
    }),
    runDebugToolProbe: async (mode) => ({
      runId: 'browser-mock-probe',
      mode,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      totalTools: 0,
      passed: 0,
      failed: 0,
      permissionDenied: 0,
      skippedByEnvironment: 0,
      items: [],
    }),
    cancelDebugToolProbe: async () => {},
    submitSessionFollowUp: async (_sessionId, _input, delivery) =>
      delivery === 'steer' ? ('steered' as const) : ('queued' as const),
    updateQueuedFollowUp: async () =>
      mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    removeQueuedFollowUp: async () =>
      mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    resumeQueuedFollowUps: async () =>
      mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    supportsQueuedCompaction: () => false,
    cancelCompaction: async () => {},
    compactSession: async () => {},
    getSessionPromptPreview: async () => null,
    rollbackSession: async () => ({
      snapshot: mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
      restoredFiles: [],
    }),
    getSessionGoal: async () => null,
    setSessionGoal: async () => ({
      id: 'goal:mock',
      threadId: 'mock',
      objective: '',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      version: 1,
      completedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    clearSessionGoal: async () => true,
    listThreadBookmarks: async (sessionId) => ({
      threadId: sessionId,
      inputIds: [],
      version: 0,
    }),
    setThreadBookmark: async (sessionId, input) => ({
      threadId: sessionId,
      inputIds: input.bookmarked ? [input.inputId] : [],
      version: 1,
    }),
    startSessionReview: async (sessionId, target) => ({
      threadId: sessionId,
      turnId: `mock-review-${Date.now()}`,
      delivery: 'inline',
      source:
        target.type === 'baseBranch'
          ? { kind: 'branch', baseBranch: target.branch }
          : target.type === 'commit'
            ? { kind: 'commit', commitSha: target.sha }
            : { kind: 'unstaged' },
    }),
    listRuntimePermissionProfiles: async () => ({
      state: 'unavailable',
      data: null,
      error: 'Browser mock does not support catalog queries.',
    }),
    setSessionPermissionProfile: async () =>
      mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    listRuntimeSkills: async () => ({
      state: 'unavailable',
      data: null,
      error: '浏览器预览环境不支持读取本机技能目录。',
    }),
    readRuntimeSkill: async () => {
      throw new Error('浏览器预览环境不支持读取本机技能详情。')
    },
    setRuntimeSkillEnabled: async () => {
      throw new Error('浏览器预览环境不支持修改本机技能状态。')
    },
    onRuntimeSkillsUpdated: () => () => {},
  }

  function emitSessionStoreChange(): void {
    const change: DesktopSessionStoreChange = {
      activeSessionId,
      sessions: [...sessions.values()],
    }
    for (const listener of sessionStoreListeners) {
      listener(change)
    }
  }

  function emitSettingsChange(): void {
    const change: DesktopSettingsChange = { settings }
    for (const listener of settingsListeners) {
      listener(change)
    }
  }
}
