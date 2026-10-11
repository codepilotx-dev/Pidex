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
import { mockThreadHistoryPage } from './FixtureShared.js'
import { permissionModeFromDesktopConfig } from './FixtureRuntime.js'
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
import type { EventEnvelope, ProtocolCapability, RpcParams, RpcResult } from '@pidex/agent-protocol'
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

const BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY = 'pidex.desktop.appearance.v6'
const LEGACY_BROWSER_APPEARANCE_SETTINGS_STORAGE_KEYS = [
  'pidex.desktop.appearance.v3',
  'pidex.desktop.appearance.v5',
] as const

export function emptyBrowserState(): DesktopBrowserState {
  return {
    open: false,
    url: '',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    allowedSites: [],
    sitePermissions: [],
  }
}

export function defaultMockThemeSettings(): DesktopThemeSettings {
  return normalizeDesktopThemeSettings(DEFAULT_DESKTOP_THEME_SETTINGS)
}

export function readBrowserThemeSettings(storage?: Storage): DesktopThemeSettings {
  try {
    for (const key of LEGACY_BROWSER_APPEARANCE_SETTINGS_STORAGE_KEYS) {
      storage?.removeItem(key)
    }
    const value = storage?.getItem(BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY)
    return value ? normalizeDesktopThemeSettings(JSON.parse(value)) : defaultMockThemeSettings()
  } catch {
    return defaultMockThemeSettings()
  }
}

export function mockModelProvider(providerID: ModelProviderID): DesktopModelProviderSummary {
  return {
    providerID,
    kind: 'openai-compatible',
    displayName: 'Browser Mock',
    defaultModels: [],
    apiKeyConfigured: false,
  }
}

export function cleanGitStatus() {
  return {
    branchName: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    clean: true,
    files: [],
  }
}

export function emptyReviewDiff(): DesktopReviewDiffResult {
  return {
    scopes: [
      { scope: 'unstaged', changedFiles: 0, additions: 0, deletions: 0 },
      { scope: 'staged', changedFiles: 0, additions: 0, deletions: 0 },
    ],
    activeScope: 'unstaged',
    files: [],
    status: cleanGitStatus(),
  }
}

export function mockWorkspace(path: string): DesktopWorkspace {
  return {
    path,
    name: path ? (path.split(/[\\/]/).filter(Boolean).at(-1) ?? path) : '浏览器 Mock',
    branchName: null,
  }
}

/**
 * Browser fixtures still enter the same canonical Turn renderer as real Agent
 * sessions. The adapter lives at the mock transport boundary so production
 * conversation code never falls back to the legacy flattened timeline.
 */

const VISUAL_ATTACHMENT_DATA = new Map<
  string,
  {
    data: string
    encoding: 'base64' | 'utf8'
  }
>([
  [
    'visual-rich-image-1',
    {
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      encoding: 'base64',
    },
  ],
  [
    'visual-rich-image-2',
    {
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      encoding: 'base64',
    },
  ],
  [
    'visual-rich-text-1',
    {
      data: '# 附件说明\n\n用于验证编辑重发时保留附件。',
      encoding: 'utf8',
    },
  ],
  [
    'visual-rich-text-2',
    {
      data: '长文件名附件用于验证窄窗口截断。',
      encoding: 'utf8',
    },
  ],
])

export function readBrowserFixtureAttachment(attachmentId: string): RpcResult<'attachment/read'> {
  if (attachmentId === 'visual-rich-image-error') {
    throw new Error('视觉用例模拟附件读取失败。')
  }
  const source = VISUAL_ATTACHMENT_DATA.get(attachmentId)
  if (!source) throw new Error('浏览器 mock 模式无法读取历史附件。')
  const metadata = VISUAL_ATTACHMENT_METADATA.get(attachmentId)
  const kind =
    metadata?.kind ?? (source.encoding === 'base64' ? ('image' as const) : ('text' as const))
  const name = metadata?.name ?? (kind === 'image' ? `${attachmentId}.png` : `${attachmentId}.md`)
  return {
    attachment: {
      id: attachmentId,
      kind,
      name,
      mediaType: metadata?.mediaType ?? (kind === 'image' ? 'image/png' : 'text/markdown'),
      sizeBytes: source.data.length,
      sha256: `visual-${attachmentId}`,
      createdAt: Date.now(),
    },
    data: source.data,
    encoding: source.encoding,
    range: {
      offset: 0,
      length: source.data.length,
      total: source.data.length,
    },
  }
}

const VISUAL_ATTACHMENT_METADATA = new Map<
  string,
  {
    kind: 'image' | 'text'
    mediaType: string
    name: string
  }
>([
  [
    'visual-rich-image-1',
    {
      kind: 'image',
      mediaType: 'image/png',
      name: '工作台布局.png',
    },
  ],
  [
    'visual-rich-image-2',
    {
      kind: 'image',
      mediaType: 'image/png',
      name: '窄窗口对照.png',
    },
  ],
  [
    'visual-rich-text-1',
    {
      kind: 'text',
      mediaType: 'text/markdown',
      name: '附件说明.md',
    },
  ],
  [
    'visual-rich-text-2',
    {
      kind: 'text',
      mediaType: 'text/markdown',
      name: '用于验证窄窗口中文件名会正确截断而不会撑宽整个会话页面的特别长附件名称.md',
    },
  ],
])

export function mockSessionSnapshot(
  sessionId: string,
  workspace: DesktopWorkspace,
  options: CreateDesktopSessionOptions,
): DesktopSessionSnapshot {
  const now = new Date().toISOString()
  const collaborationMode = resolveCollaborationMode({
    collaborationMode: options.collaborationMode,
    planModeActive: options.planModeActive,
  })
  const planModeActive = planModeActiveFromCollaborationMode(collaborationMode)
  const permissionConfig =
    options.permissionConfig ?? desktopPermissionModeToPermissionConfig('default')
  const permissionMode = permissionModeFromDesktopConfig(permissionConfig)
  return {
    item: {
      id: sessionId,
      sessionName: options.sessionName ?? null,
      aiTitle: null,
      workspaceName: workspace.name,
      storageSource: 'local',
      workspacePath: workspace.path,
      standalone: !options.workspacePath,
      permissionMode,
      collaborationMode,
      planModeActive,
      model: options.model ?? null,
      thinkingMode: options.thinkingMode ?? 'default',
      hasSystemPrompt: Boolean(options.systemPrompt),
      hasAppendSystemPrompt: Boolean(options.appendSystemPrompt),
      additionalDirectoryCount: options.additionalDirectories?.length ?? 0,
      status: 'idle',
      createdAt: now,
      lastMessageAt: null,
    },
    workspace,
    settings: {
      permissionConfig,
      collaborationMode,
      planModeActive,
      model: options.model,
      sessionName: options.sessionName,
      thinkingMode: options.thinkingMode ?? 'default',
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
      additionalDirectories: options.additionalDirectories ?? [],
    },
    view: {
      messages: [],
      toolLog: [],
      pendingPermissions: [],
      contextUsage: null,
    },
    events: [],
    workflowEvents: [],
    reviewComments: [],
    updatedAt: now,
  }
}

const PERFORMANCE_TURN_COUNTS = new Set([10, 100, 250, 500])
const PERFORMANCE_SESSION_COUNTS = new Set([10, 30, 50, 100])

export type BrowserPerformanceFixture = {
  activeSessionId: string
  sessions: DesktopSessionSnapshot[]
}

export function createBrowserPerformanceFixture(): BrowserPerformanceFixture | null {
  if (import.meta.env.MODE !== 'performance' || typeof window === 'undefined') {
    return null
  }

  const search = new URLSearchParams(window.location.search)
  const performanceCase = search.get('performanceCase')
  if (performanceCase !== 'desktop-ux' && performanceCase !== 'nested-scroll-edge-fade') {
    return null
  }

  const turns = fixtureCount(search.get('performanceTurns'), PERFORMANCE_TURN_COUNTS, 250)
  const sessionCount = fixtureCount(
    search.get('performanceSessions'),
    PERFORMANCE_SESSION_COUNTS,
    30,
  )
  const includeNestedScrollFixture = performanceCase === 'nested-scroll-edge-fade'
  const baseTime = Date.UTC(2026, 6, 30, 8, 0, 0)
  const sessions: DesktopSessionSnapshot[] = []

  for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
    const sessionId = `performance-session-${String(sessionIndex + 1).padStart(3, '0')}`
    const workspace = mockWorkspace(
      `F:\\CodeProject\\PerformanceFixture\\project-${String(
        Math.floor(sessionIndex / 20) + 1,
      ).padStart(2, '0')}`,
    )
    const snapshot = mockSessionSnapshot(sessionId, workspace, {
      sessionName: `性能会话 ${String(sessionIndex + 1).padStart(3, '0')}`,
      thinkingMode: 'adaptive',
    })
    const sessionTurns = sessionIndex === 0 ? turns : Math.min(turns, 10)
    const messages: DesktopSessionSnapshot['view']['messages'] = []

    for (let turnIndex = 0; turnIndex < sessionTurns; turnIndex += 1) {
      const createdAt = new Date(
        baseTime + sessionIndex * 3_600_000 + turnIndex * 2_000,
      ).toISOString()
      messages.push(
        {
          id: `${sessionId}-user-${turnIndex}`,
          role: 'user',
          text: `第 ${turnIndex + 1} 轮：检查桌面端性能路径 ${sessionIndex + 1}。`,
          createdAt,
        },
        {
          id: `${sessionId}-assistant-${turnIndex}`,
          role: 'assistant',
          text:
            `会话 ${sessionIndex + 1} 的第 ${turnIndex + 1} 轮完成。\n\n` +
            '- 保持会话投影稳定\n' +
            '- 验证侧栏与输入响应\n\n' +
            '```ts\nconst fixture = "deterministic"\n```',
          createdAt: new Date(Date.parse(createdAt) + 1_000).toISOString(),
        },
      )
    }

    // 首个会话的末轮插入一批工具项，为嵌套滚动边界渐隐场景提供
    // 可滚动的 process group（12 个 Bash 工具项超出 14rem 折叠高度）。
    if (includeNestedScrollFixture && sessionIndex === 0 && sessionTurns > 0) {
      const lastTurnIndex = sessionTurns - 1
      const lastUser = messages[lastTurnIndex * 2]!
      const toolEvents: DesktopSessionEvent[] = []
      for (let toolIndex = 0; toolIndex < 12; toolIndex += 1) {
        const toolId = `${sessionId}-tool-${lastTurnIndex}-${toolIndex}`
        const createdAt = new Date(
          Date.parse(lastUser.createdAt) + 120 + toolIndex * 40,
        ).toISOString()
        toolEvents.push(
          {
            id: toolId,
            sessionId,
            type: 'tool_call',
            content: `Bash: bun run --cwd apps/desktop/renderer test --run ${toolIndex}`,
            createdAt,
            metadata: {
              toolName: 'Bash',
              toolUseId: toolId,
              command: `bun run --cwd apps/desktop/renderer test --run ${toolIndex}`,
              activity: { type: 'command', kind: 'test' },
            },
          },
          {
            id: `${toolId}-output`,
            sessionId,
            type: 'tool_output_delta',
            content: `第 ${toolIndex + 1} 项验证输出：保持会话投影稳定。`,
            createdAt: new Date(Date.parse(createdAt) + 20).toISOString(),
            metadata: { toolName: 'Bash', toolUseId: toolId },
          },
        )
      }
      snapshot.events = messages.map((message) => ({
        id: message.id,
        sessionId,
        type: 'message' as const,
        role: message.role,
        content: message.text,
        createdAt: message.createdAt,
        metadata: message.metadata,
      }))
      snapshot.events.splice(lastTurnIndex * 2 + 1, 0, ...toolEvents)
    }

    snapshot.view.messages = messages
    snapshot.item.lastMessageAt = messages.at(-1)?.createdAt ?? snapshot.item.createdAt
    snapshot.updatedAt = snapshot.item.lastMessageAt
    sessions.push(snapshot)
  }

  return {
    activeSessionId: sessions[0]!.item.id,
    sessions,
  }
}

function fixtureCount(raw: string | null, allowed: ReadonlySet<number>, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return allowed.has(parsed) ? parsed : fallback
}

export function createBrowserVisualFixture(): DesktopSessionSnapshot | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const visualCase = new URLSearchParams(window.location.search).get('visualCase')
  if (
    visualCase !== 'rich' &&
    visualCase !== 'permission' &&
    visualCase !== 'review' &&
    visualCase !== 'turn-nav' &&
    visualCase !== 'execution-plan' &&
    visualCase !== 'scroll-edge'
  ) {
    return null
  }

  const sessionId = `visual-${visualCase}`
  const workspace = mockWorkspace('F:\\CodeProject\\Pidex-Ts')
  const snapshot = mockSessionSnapshot(sessionId, workspace, {
    workspacePath: workspace.path,
    sessionName:
      visualCase === 'rich'
        ? 'Codex 富消息工作台'
        : visualCase === 'permission'
          ? '权限与计划'
          : visualCase === 'turn-nav'
            ? '用户消息导航'
            : visualCase === 'execution-plan'
              ? '执行计划弹层'
              : visualCase === 'scroll-edge'
                ? '滚动边界与会话扩展'
                : 'Review 与 Diff',
    collaborationMode: {
      mode: visualCase === 'permission' ? 'plan' : 'default',
    },
    planModeActive: visualCase === 'permission',
    thinkingMode: 'adaptive',
  })
  const baseTime = Date.now()
  const timestamp = (offsetMs: number): string => new Date(baseTime + offsetMs).toISOString()
  const createdAt = timestamp(0)
  const richUserMessage = [
    '请把外围内容一起校准到 Codex 的阅读轴：',
    '',
    '1. 用户消息保持靠右且按内容收缩。',
    '2. 图片附件与文件附件位于正文气泡之外。',
    '3. 图片保持稳定缩略图尺寸。',
    '4. 文件附件在窄窗口中安全截断。',
    '5. 长消息只折叠文字正文。',
    '6. 附件行不参与正文折叠高度。',
    '7. 编辑态占满同一条阅读轴。',
    '8. 编辑时允许移除历史附件。',
    '9. 取消编辑恢复原始附件集合。',
    '10. 重发时复制保留的历史附件。',
    '11. 不直接复用已经绑定的附件 ID。',
    '12. 图片读取失败时显示明确占位。',
    '13. 长文件名不撑宽页面。',
    '14. 附件行内部允许横向滚动。',
    '15. 查看态气泡继续保持 77% 上限。',
    '16. 窄窗口也不能切换成整行气泡。',
    '17. 连续英文与 URL 可以安全断行。',
    '18. 文件变更卡跟随 48rem 正文宽度。',
    '19. 文件路径需要省略但增删统计不能被压缩。',
    '20. 卡片操作在窄窗口中换到第二行。',
    '21. Composer 的普通文件改为紧凑胶囊。',
    '22. 键盘焦点、错误和加载状态继续清晰可见。',
  ].join('\n')
  const richAssistantMarkdown = [
    '# Markdown 阅读排版',
    '',
    '## 阅读节奏',
    '',
    '正文段落使用舒展的行高与稳定的块间距，让较长回复保持清晰。',
    '',
    '第二段包含 **强调文字**、`theme token` 和连续内容，用于核对中英文混排。',
    '路由 `/new` 保持代码样式，源码 `../../components/ui/Tooltip.js` 保持文件引用。',
    '',
    '普通软换行继续保留 breaks: true，',
    '第二行不会获得标题与说明的分组间距。',
    '',
    '**1. 粗体标题与提交标识** `3efbbd978`',
    '说明内容与标题分组显示，并继续允许在窄容器中自然折行。',
    '后续说明仍按 breaks: true 保留普通换行。',
    '',
    '> 引用内容保留 Pidex 主题色，同时采用更柔和的留白和圆角。',
    '',
    '### 结构清单',
    '',
    '- 固定 Codex 语义表面',
    '',
    '  同一列表项的补充段落保持独立但不割裂。',
    '',
    '  - 紧凑摘要继续使用三行适配',
    '  - 普通表格跟随正文阅读带，代码块使用宽内容带',
    '',
    '  ```ts',
    '  const nestedWideBlock = "align with the conversation reading column"',
    '  ```',
    '- 高亮主题按需加载',
    '',
    '| 排版元素 | 处理方式 |',
    '| --- | --- |',
    '| 正文 | 统一行高和段距 |',
    '| 表格 | 保持表格结构，并在窄容器内自动折行 |',
    '| 长路径 | apps/desktop/renderer/src/features/layout/panels/responsive-layout-verification/WorkbenchPanelPresenceWithExtremelyLongUnbrokenFilename.tsx |',
    '',
    '```ts',
    'const theme = mode === "dark" ? "codex-dark" : "codex-light"',
    'const responsiveFixturePath = "F:\\CodeProject\\Pidex\\apps\\desktop\\renderer\\src\\features\\layout\\panels\\WorkbenchPanelPresence.tsx?verification=live-resize-without-css-scale-and-with-local-code-scrolling"',
    '```',
    '',
    '已完成工作台结构梳理。',
  ].join('\n')
  const events: DesktopSessionEvent[] = [
    {
      id: `${sessionId}-user`,
      sessionId,
      type: 'message',
      role: 'user',
      content:
        visualCase === 'review'
          ? '请审查主题重构并确认 diff。'
          : visualCase === 'turn-nav'
            ? '第一轮：梳理 Codex 导航轨。'
            : visualCase === 'rich'
              ? richUserMessage
              : '把核心工作台重构成 Codex 风格，并保留现有 Agent 边界。',
      createdAt,
      metadata:
        visualCase === 'rich'
          ? {
              attachments: [
                {
                  id: 'visual-rich-image-1',
                  kind: 'image',
                  name: '工作台布局.png',
                  mediaType: 'image/png',
                  sizeBytes: 684,
                },
                {
                  id: 'visual-rich-image-2',
                  kind: 'image',
                  name: '窄窗口对照.png',
                  mediaType: 'image/png',
                  sizeBytes: 684,
                },
                {
                  id: 'visual-rich-image-error',
                  kind: 'image',
                  name: '读取失败.png',
                  mediaType: 'image/png',
                  sizeBytes: 0,
                },
                {
                  id: 'visual-rich-text-1',
                  kind: 'text',
                  name: '附件说明.md',
                  mediaType: 'text/markdown',
                  sizeBytes: 62,
                },
                {
                  id: 'visual-rich-text-2',
                  kind: 'text',
                  name: '用于验证窄窗口中文件名会正确截断而不会撑宽整个会话页面的特别长附件名称.md',
                  mediaType: 'text/markdown',
                  sizeBytes: 48,
                },
              ],
            }
          : undefined,
    },
    {
      id: `${sessionId}-assistant`,
      sessionId,
      type: 'message',
      role: 'assistant',
      content: visualCase === 'turn-nav' ? '第一轮已完成。' : richAssistantMarkdown,
      createdAt: timestamp(visualCase === 'rich' ? 4_500 : 2_000),
      metadata: visualCase === 'rich' ? { streaming: false } : undefined,
    },
  ]

  if (visualCase === 'turn-nav') {
    for (let turn = 2; turn <= 4; turn += 1) {
      events.push(
        {
          id: `${sessionId}-user-${turn}`,
          sessionId,
          type: 'message',
          role: 'user',
          content: `第 ${turn} 轮：继续校准交互和视觉。`,
          createdAt: timestamp(turn * 3_000),
        },
        {
          id: `${sessionId}-assistant-${turn}`,
          sessionId,
          type: 'message',
          role: 'assistant',
          content:
            turn === 4
              ? '第 4 轮已完成。\n\n- 卡片固定 320px\n- padding 为 8px\n- 摘要最多三行'
              : `第 ${turn} 轮已完成。`,
          createdAt: timestamp(turn * 3_000 + 1_000),
        },
      )
    }
    events.push({
      id: `${sessionId}-patch`,
      sessionId,
      type: 'file_patch',
      content: '更新用户消息导航轨',
      createdAt: timestamp(13_000),
      metadata: {
        turnScoped: true,
        files: [
          { path: 'apps/desktop/renderer/src/features/session/ConversationTurnNavRail.tsx' },
          { path: 'apps/desktop/renderer/src/styles/primitives/conversation.css' },
          { path: 'apps/desktop/renderer/src/components/ui/Tooltip.tsx' },
        ],
      },
    })
  }

  if (visualCase === 'scroll-edge') {
    // 14 个 Bash 工具项组成可滚动的 process group；执行计划提供
    // 16 步可滚动的 steps。两者都用于验证滚动边界渐隐状态。
    for (let toolIndex = 0; toolIndex < 14; toolIndex += 1) {
      const toolId = `${sessionId}-tool-${toolIndex}`
      events.push(
        {
          id: toolId,
          sessionId,
          type: 'tool_call',
          content: `Bash: bun run --cwd apps/desktop/renderer test --run ${toolIndex}`,
          createdAt: timestamp(300 + toolIndex * 40),
          metadata:
            toolIndex === 0
              ? {
                  toolName: 'Read',
                  toolUseId: toolId,
                  activity: {
                    type: 'read',
                    subject: 'file',
                    target: {
                      displayLabel: 'src/ConversationPage.tsx',
                      workspacePath: 'src/ConversationPage.tsx',
                    },
                  },
                }
              : {
                  toolName: 'Bash',
                  toolUseId: toolId,
                  command: `bun run --cwd apps/desktop/renderer test --run ${toolIndex}`,
                  activity: { type: 'command', kind: 'test' },
                },
        },
        {
          id: `${toolId}-output`,
          sessionId,
          type: 'tool_output_delta',
          content: `第 ${toolIndex + 1} 项验证输出：保持会话投影稳定。`,
          createdAt: timestamp(320 + toolIndex * 40),
          metadata: { toolName: 'Bash', toolUseId: toolId },
        },
      )
    }
    events.push({
      id: `${sessionId}-execution-plan`,
      sessionId,
      type: 'execution-plan',
      content: '按序完成滚动边界验证。',
      createdAt: timestamp(1_500),
      metadata: {
        steps: Array.from({ length: 16 }, (_, index) => ({
          step: `滚动边界第 ${index + 1} 步：验证嵌套滚动容器顶部与底部的渐隐状态。`,
          status: index < 2 ? 'completed' : index === 2 ? 'in_progress' : 'pending',
        })),
        status: 'streaming',
      },
    })
  }

  if (visualCase === 'execution-plan') {
    events.push({
      id: `${sessionId}-execution-plan`,
      sessionId,
      type: 'execution-plan',
      content: '按序完成主题重构并接入工作台。',
      createdAt: timestamp(3_000),
      metadata: {
        steps: [
          {
            step: '把会话正文改造成 Codex 语义表面，并固定主题色板与圆角基线。',
            status: 'completed',
          },
          {
            step: '将计划弹层从胶囊包含块解耦，改为相对完整摘要区域自适应居中。',
            status: 'in_progress',
          },
          {
            step: '验证窄窗口下弹层按可用正文宽度收缩、长步骤文本正常换行且无横向溢出。',
            status: 'pending',
          },
        ],
        status: 'streaming',
      },
    })
    events.push({
      id: `${sessionId}-patch`,
      sessionId,
      type: 'file_patch',
      content: '重构主题与工作台样式',
      createdAt: timestamp(5_000),
      metadata: {
        turnScoped: true,
        files: [
          { path: 'apps/desktop/renderer/shared/Theme.ts' },
          { path: 'apps/desktop/renderer/src/styles/features/primary-page.css' },
          { path: 'apps/desktop/renderer/src/styles/primitives/session.css' },
        ],
      },
    })
  }

  if (visualCase === 'rich' || visualCase === 'review') {
    events.push(
      {
        id: `${sessionId}-tool`,
        sessionId,
        type: 'tool_call',
        content:
          visualCase === 'rich' ? 'Read: src/ConversationPage.tsx' : 'Bash: bun run typecheck',
        createdAt: timestamp(3_000),
        metadata:
          visualCase === 'rich'
            ? {
                toolName: 'Read',
                toolUseId: 'visual-tool-1',
                activity: {
                  type: 'read',
                  subject: 'file',
                  target: {
                    displayLabel: 'src/ConversationPage.tsx',
                    workspacePath: 'src/ConversationPage.tsx',
                  },
                },
              }
            : {
                toolName: 'Bash',
                toolUseId: 'visual-tool-1',
                command: 'bun run typecheck',
                activity: { type: 'command', kind: 'test' },
              },
      },
      {
        id: `${sessionId}-tool-output`,
        sessionId,
        type: 'tool_output_delta',
        content: '63 tests passed\nrenderer build complete',
        createdAt: timestamp(4_000),
        metadata: { toolName: 'Bash', toolUseId: 'visual-tool-1' },
      },
      ...(visualCase === 'rich'
        ? [
            {
              id: `${sessionId}-tool-2`,
              sessionId,
              type: 'tool_call' as const,
              content: 'Bash: bun run build:renderer',
              createdAt: timestamp(4_100),
              metadata: {
                toolName: 'Bash',
                toolUseId: 'visual-tool-2',
                command: 'bun run build:renderer',
                activity: { type: 'command', kind: 'generic' },
              },
            },
            {
              id: `${sessionId}-tool-output-2`,
              sessionId,
              type: 'tool_output_delta' as const,
              content: 'renderer build complete',
              createdAt: timestamp(4_200),
              metadata: { toolName: 'Bash', toolUseId: 'visual-tool-2' },
            },
          ]
        : []),
      {
        id: `${sessionId}-patch`,
        sessionId,
        type: 'file_patch',
        content: '更新 Codex 主题与工作台样式',
        createdAt: timestamp(5_000),
        metadata: {
          turnScoped: true,
          files: [
            { path: 'apps/desktop/renderer/shared/Theme.ts', additions: 18, deletions: 4 },
            {
              path: 'apps/desktop/renderer/src/styles/tailwind.css',
              additions: 7,
              deletions: 2,
            },
            {
              path: 'apps/desktop/renderer/src/features/session/attachments/AttachmentRows.tsx',
              additions: 146,
              deletions: 0,
            },
            {
              path: 'apps/desktop/renderer/src/features/session/timeline/CanonicalItemRenderer.tsx',
              additions: 94,
              deletions: 31,
            },
            {
              path: 'apps/desktop/renderer/src/features/layout/panels/responsive-layout-verification/ExtremelyLongPatchFileNameThatMustTruncateWithoutCompressingTheChangeCounters.tsx',
              additions: 22,
              deletions: 8,
            },
          ],
        },
      },
    )
  }

  if (visualCase === 'permission') {
    events.push({
      id: `${sessionId}-plan`,
      sessionId,
      type: 'proposed_plan',
      role: 'assistant',
      content:
        '# 实施计划\n\n1. 固定 Codex Light / Dark\n2. 生成 91 主题白名单\n3. 验证权限、Plan 与 Dock',
      createdAt: timestamp(3_000),
    })
    snapshot.view.pendingPermissions = [
      {
        requestId: `${sessionId}-permission`,
        toolName: 'Bash',
        requestKind: 'shell-command',
        description: '允许运行 renderer 验收命令',
        input: { command: 'bun run --cwd apps/desktop/renderer test' },
      },
    ]
  }

  snapshot.events = events
  snapshot.view.messages = events
    .filter((event) => event.type === 'message')
    .map((event) => ({
      id: event.id,
      role: event.role as 'user' | 'assistant',
      text: event.content,
      createdAt: event.createdAt,
      streaming: false,
      metadata: event.metadata,
    }))
  snapshot.item.status = 'idle'
  snapshot.item.lastMessageAt = events.at(-1)?.createdAt ?? createdAt
  snapshot.updatedAt = snapshot.item.lastMessageAt
  return snapshot
}

/* --- Taskboard 浏览器视觉 fixture（只读） --- */

const VISUAL_REVIEW_GENERATION = 'visual-review-generation'
const VISUAL_REVIEW_REVISION = 'visual-review-revision'
const VISUAL_REVIEW_SMALL_PATH = 'apps/desktop/renderer/test/CodexStyleContracts.test.ts'
const VISUAL_REVIEW_LARGE_PATH =
  'apps/desktop/renderer/src/features/review/diff/WorkspaceReviewDiff.tsx'
const VISUAL_REVIEW_ADDED_PATH = 'apps/desktop/renderer/src/features/review/status-added.ts'
const VISUAL_REVIEW_DELETED_PATH = 'apps/desktop/renderer/src/features/review/status-deleted.ts'

export function isBrowserVisualReviewCase(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('visualCase') === 'review'
  )
}

function createBrowserVisualReviewLargePatch(): string {
  const changedPairs = 520
  const lines = [`@@ -1,${changedPairs} +1,${changedPairs} @@`]
  for (let line = 1; line <= changedPairs; line += 1) {
    lines.push(`-const previousValue${line} = "before-${line}"`)
    lines.push(`+const currentValue${line} = "after-${line}"`)
  }
  return lines.join('\n')
}

function createBrowserVisualReviewSmallPatch(): string {
  const context = [
    "import { describe, expect, test } from 'bun:test'",
    '',
    "describe('Codex semantic token contract', () => {",
    "  test('exports semantic color tokens', async () => {",
  ]
  const removed = [
    '    expect(tokens).toHaveLength(117)',
    '    expect(new Set(tokens).size).toBe(117)',
    '    expect(stylesheet).toContain("--color-decoration-added")',
  ]
  const added = [
    '    expect(tokens).toHaveLength(121)',
    '    expect(new Set(tokens).size).toBe(121)',
    "    expect(tokens).toContain('--cpx-comp-input-bg')",
    "    expect(tokens).toContain('--cpx-comp-dropdown-menu-bg')",
    "    expect(tokens).toContain('--cpx-sys-color-surface-canvas')",
    "    expect(tokens).toContain('--cpx-comp-workbench-panel-bg')",
    "    expect(tokens).toContain('--cpx-sys-color-surface-control')",
    "    expect(tokens).toContain('--cpx-sys-color-surface-raised')",
    '  })',
    '',
    "  test('keeps diff backgrounds separate from raw decoration colors', async () => {",
    '    const stylesheet = await Bun.file(',
    '      new URL(',
    "        '../src/styles/design-system/codex-semantic-tokens.scss',",
    '        import.meta.url,',
    '      ),',
    '    ).text()',
    '',
    '    expect(stylesheet).toContain(',
    "      '--cpx-comp-diff-inserted-line-bg: var(--cpx-sys-color-diff-added-line)',",
    '    )',
    '    expect(stylesheet).toContain(',
    "      '--cpx-comp-diff-inserted-text-bg: var(--cpx-sys-color-diff-added-text)',",
    '    )',
    '    expect(stylesheet).toContain(',
    "      '--cpx-comp-diff-removed-line-bg: var(--cpx-sys-color-diff-removed-line)',",
    '    )',
    '    expect(stylesheet).toContain(',
    "      '--cpx-comp-diff-removed-text-bg: var(--cpx-sys-color-diff-removed-text)',",
    '    )',
    '  })',
  ]
  return [
    '@@ -1,7 +1,35 @@',
    ...context.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join('\n')
}

const VISUAL_REVIEW_LARGE_PATCH = createBrowserVisualReviewLargePatch()
const VISUAL_REVIEW_SMALL_PATCH = createBrowserVisualReviewSmallPatch()

export function browserVisualReviewSummary(source: DesktopReviewSource) {
  if (!isBrowserVisualReviewCase()) return null
  const changedLines = 1_074
  return {
    snapshot: {
      projectId: 'visual-review-project',
      generation: VISUAL_REVIEW_GENERATION,
      source,
      repositoryRoot: 'F:\\CodeProject\\Pidex-Ts',
      headSha: '1111111111111111111111111111111111111111',
      baseSha: null,
      files: [
        {
          path: VISUAL_REVIEW_SMALL_PATH,
          previousPath: null,
          status: 'modified' as const,
          additions: 31,
          deletions: 3,
          changedLines: 34,
          changedBytes: 2_400,
          binary: false,
          revision: VISUAL_REVIEW_REVISION,
        },
        {
          path: VISUAL_REVIEW_LARGE_PATH,
          previousPath: null,
          status: 'modified' as const,
          additions: 520,
          deletions: 520,
          changedLines: 1_040,
          changedBytes: 48_000,
          binary: false,
          revision: VISUAL_REVIEW_REVISION,
        },
        {
          path: VISUAL_REVIEW_ADDED_PATH,
          previousPath: null,
          status: 'added' as const,
          additions: 1,
          deletions: 0,
          changedLines: 1,
          changedBytes: 32,
          binary: false,
          revision: VISUAL_REVIEW_REVISION,
        },
        {
          path: VISUAL_REVIEW_DELETED_PATH,
          previousPath: null,
          status: 'deleted' as const,
          additions: 0,
          deletions: 1,
          changedLines: 1,
          changedBytes: 32,
          binary: false,
          revision: VISUAL_REVIEW_REVISION,
        },
      ],
      totals: {
        files: 4,
        additions: 552,
        deletions: 524,
        changedLines: changedLines + 2,
        changedBytes: 50_464,
      },
      largeDiffMode: false,
    },
    cacheState: 'fresh' as const,
  }
}

export function browserVisualReviewFileDiff(source: DesktopReviewSource, path: string) {
  if (!isBrowserVisualReviewCase()) return null
  const summary = browserVisualReviewSummary(source)!
  const file = summary.snapshot.files.find((candidate) => candidate.path === path)
  if (!file) return null
  const smallFile = path === VISUAL_REVIEW_SMALL_PATH
  const largeFile = path === VISUAL_REVIEW_LARGE_PATH
  const patch = smallFile
    ? VISUAL_REVIEW_SMALL_PATCH
    : largeFile
      ? VISUAL_REVIEW_LARGE_PATCH
      : path === VISUAL_REVIEW_ADDED_PATH
        ? '@@ -0,0 +1 @@\n+export const added = true'
        : '@@ -1 +0,0 @@\n-export const removed = true'
  const header = smallFile
    ? '@@ -1,7 +1,35 @@'
    : largeFile
      ? '@@ -1,520 +1,520 @@'
      : path === VISUAL_REVIEW_ADDED_PATH
        ? '@@ -0,0 +1 @@'
        : '@@ -1 +0,0 @@'
  return {
    file,
    revision: VISUAL_REVIEW_REVISION,
    patch,
    hunks: [
      {
        id: `visual-review-${file.status}-hunk`,
        header,
        oldStart: path === VISUAL_REVIEW_ADDED_PATH ? 0 : 1,
        oldLines: smallFile ? 7 : largeFile ? 520 : file.status === 'deleted' ? 1 : 0,
        newStart: path === VISUAL_REVIEW_DELETED_PATH ? 0 : 1,
        newLines: smallFile ? 35 : largeFile ? 520 : file.status === 'added' ? 1 : 0,
        patch,
      },
    ],
    renderable: true,
    tooLargeReason: null,
  }
}

export function requireMockSession(
  sessions: Map<string, DesktopSessionSnapshot>,
  sessionId: string,
): DesktopSessionSnapshot {
  const snapshot = sessions.get(sessionId)
  if (!snapshot) throw new Error(`Mock session not found: ${sessionId}`)
  return snapshot
}

export function mockCopilotLogin() {
  return {
    state: 'idle' as const,
    deviceCode: null,
    verificationUrl: null,
    error: null,
    auth: null,
    elapsedMs: 0,
  }
}

export function mockGithubLogin(mode: DesktopGithubAuthMode = 'browser') {
  return {
    loginId: null,
    mode,
    state: 'failed' as const,
    authorizationUrl: null,
    userCode: null,
    verificationUri: null,
    expiresAt: null,
    error: '浏览器 mock 模式无法完成 GitHub 登录。',
    auth: null,
    elapsedMs: 0,
  }
}

export function githubLoginFailure(
  error: string,
  loginId: string | null = null,
  mode: DesktopGithubAuthMode = 'browser',
): DesktopGithubLoginStatus {
  return {
    loginId,
    mode,
    state: 'failed',
    authorizationUrl: null,
    userCode: null,
    verificationUri: null,
    expiresAt: null,
    error,
    auth: null,
    elapsedMs: 0,
  }
}

export function noop(): void {}

// 以下两个 helper 迁移到 fixtureShared.ts，仅由 Agent 路径静态引用，
// 避免把完整 Mock fixture 带入 Electron 首屏。
export { mockThreadHistoryPage, permissionModeFromDesktopConfig }
