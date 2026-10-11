import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import {
  DESKTOP_AGENT_PERMISSION_MODES,
  isDesktopAgentPermissionMode,
  normalizeDesktopAgentPermissionMode,
  permissionPolicyForDesktopMode,
} from '../src/shims/core/agent/Permissions.js'
import type { AgentPermissionPolicy } from '../src/shims/core/agent/Permissions.js'
import type {
  DesktopDrawerTab,
  DesktopDiffMarkerStyle,
  DesktopPermissionMode,
  DesktopPersonality,
  ProjectAppearance,
  ProjectAppearanceColor,
  ProjectAppearanceIcon,
  DesktopReviewView,
  DesktopSandboxMode,
  DesktopShellSecurityLevel,
  DesktopSidebarOrganization,
  DesktopSidebarSort,
  DesktopStoredSettings,
  DesktopThinkingMode,
  DesktopWorkspace,
  LocalRouterMode,
  ModelProviderID,
  SidebarProductMode,
  SidebarSectionId,
  SidebarCustomization,
  SidebarCustomSection,
} from './Types.js'

export const DESKTOP_PERMISSION_MODES = new Set<DesktopPermissionMode>([
  ...DESKTOP_AGENT_PERMISSION_MODES,
])

export const DESKTOP_THINKING_MODES = new Set<DesktopThinkingMode>([
  'default',
  'enabled',
  'adaptive',
  'disabled',
])

export const DESKTOP_SANDBOX_MODES = new Set<DesktopSandboxMode>([
  'read-only',
  'workspace-write',
  'full-access',
  'danger-full-access',
])

export const DESKTOP_PERSONALITIES = new Set<DesktopPersonality>([
  'pragmatic',
  'friendly',
  'concise',
  'encouraging',
])

export const DESKTOP_REVIEW_VIEWS = new Set<DesktopReviewView>(['inline', 'split'])

export const DESKTOP_DIFF_MARKER_STYLES = new Set<DesktopDiffMarkerStyle>(['color', 'symbol'])

export const DESKTOP_REVIEW_DELIVERIES = new Set(['inline', 'detached'] as const)

export const DESKTOP_SIDEBAR_ORGANIZATIONS = new Set<DesktopSidebarOrganization>([
  'projects',
  'flat',
])

export const DESKTOP_SIDEBAR_SORTS = new Set<DesktopSidebarSort>(['priority', 'updated', 'manual'])

export const DESKTOP_SHELL_SECURITY_LEVELS = new Set<DesktopShellSecurityLevel>([
  'strict',
  'balanced',
  'relaxed',
])

export const DESKTOP_DRAWER_TABS = new Set<DesktopDrawerTab>([
  'files',
  'diff',
  'permissions',
  'toolLog',
  'settings',
])

export const MAX_RECENT_WORKSPACES = 5
export const MAX_REMOVED_WORKSPACES = 50
export const SIDEBAR_STATE_VERSION = 2

export const DEFAULT_SIDEBAR_DESTINATION_ORDER: readonly string[] = [
  'automations',
  'plugins',
  'providers',
  'sessionGroups',
]

/** 默认直接显示的入口是“已安排”与“插件”，其余可用入口先收进“更多”。 */
export const DEFAULT_SIDEBAR_HIDDEN_DESTINATION_IDS: readonly string[] = ['sessionGroups']

export const DEFAULT_SIDEBAR_CUSTOMIZATION: SidebarCustomization = {
  version: 1,
  sections: [],
  sectionOrder: [],
  pinnedSort: 'manual',
  destinationOrder: [...DEFAULT_SIDEBAR_DESTINATION_ORDER],
  hiddenDestinationIds: [...DEFAULT_SIDEBAR_HIDDEN_DESTINATION_IDS],
}

export const PROJECT_APPEARANCE_COLORS: readonly ProjectAppearanceColor[] = [
  'default',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
]

export const PROJECT_APPEARANCE_ICONS: readonly ProjectAppearanceIcon[] = [
  'folder',
  'dollar',
  'book',
  'graduation',
  'edit',
  'writing',
  'function',
  'terminal',
  'music',
  'popcorn',
  'customize',
  'palette',
  'stethoscope',
  'health',
  'plant',
  'suitcase',
  'chart',
  'kettlebell',
  'dumbbell',
  'logs',
  'scale',
  'globe',
  'wrench',
  'paw',
  'flask',
  'brain',
  'heart',
  'flower',
  'paintbrush',
  'plane',
]

export const DEFAULT_PROJECT_APPEARANCE: ProjectAppearance = {
  color: 'default',
  icon: 'folder',
}

const PROJECT_APPEARANCE_COLOR_SET = new Set(PROJECT_APPEARANCE_COLORS)
const PROJECT_APPEARANCE_ICON_SET = new Set(PROJECT_APPEARANCE_ICONS)

export const VALID_SIDEBAR_SECTION_IDS: readonly SidebarSectionId[] = [
  'pinned',
  'projects',
  'recent',
]

export function defaultDesktopStoredSettings(): DesktopStoredSettings {
  return {
    language: 'system',
    enableParetoCodeRouter: false,
    enableFusionRouter: false,
    enableAutoReviewPermissionMode: false,
    enableFullAccessPermissionMode: false,
    permissionConfig: { ...DEFAULT_PERMISSION_CONFIG },
    shellSecurityLevel: 'balanced',
    terminalProfileId: null,
    model: '',
    generationModel: '',
    organizationModel: '',
    codingModel: '',
    securityModel: '',
    sessionName: '',
    thinkingMode: 'default',
    systemPrompt: '',
    appendSystemPrompt: '',
    additionalDirectories: '',
    recentWorkspaces: [],
    projectAppearances: {},
    drawerTab: 'files',
    selectedModelPreset: '',
    providerID: '',
    providerBaseURL: '',
    showContextUsage: true,
    defaultOpenTargetId: 'auto',
    gitBranchPrefix: 'pidex/',
    gitPrMergeMethod: 'merge',
    gitShowPrIconsInSidebar: true,
    gitDraftPullRequest: true,
    gitAutoDeleteWorktree: true,
    gitAutoDeleteWorktreeLimit: 15,
    worktreeRoot: '',
    worktreeFetchUpstream: false,
    prWatchAutoMerge: false,
    prWatchInstructions: '',
    allowForcePush: false,
    commitMessagePrompt: '',
    pullRequestPrompt: '',
    installPidexDependencies: true,
    workspaceDependenciesMigrated: false,
    'desktop.voice.preferredInputDeviceId': '',
    personality: 'pragmatic',
    customInstructions: '',
    enableMemory: false,
    lastActiveWorkspacePath: '',
    removedWorkspaces: [],
    skipToolAidedChats: false,
    defaultModeRequestUserInput: false,
    githubMemorySyncEnabled: false,
    githubMemoryRepository: '',
    reviewView: 'inline',
    reviewDelivery: 'inline',
    conversationWidth: 'default',
    diffMarkerStyle: 'color',
    rustSearchAndDiffKernels: false,
    sidebarLayout: 'modern',
    sidebarOrganization: 'projects',
    sidebarProductMode: 'coding',
    sidebarStateVersion: SIDEBAR_STATE_VERSION,
    sidebarProjectSort: 'priority',
    sidebarSort: 'priority',
    sidebarTimelineEnabled: false,
    sidebarTimelinePriorityEnabled: true,
    sidebarActivityShowWork: true,
    sidebarActivityShowChat: true,
    sidebarShowScheduledSessions: true,
    sidebarActivityShowScheduled: false,
    sidebarActivityShowPinned: false,
    sidebarActivityCoachmarkDismissed: false,
    sidebarManualOrder: {},
    sidebarSessionPins: {},
    collapsedSidebarProjectPaths: [],
    sidebarSectionOrder: [...VALID_SIDEBAR_SECTION_IDS],
    browserAllowedSites: [],
    collapsedSidebarSections: ['projects', 'recent'],
    browserSitePermissions: [],
    sidebarCustomization: DEFAULT_SIDEBAR_CUSTOMIZATION,
    pet: {
      enabled: false,
      selectedPetId: null,
      size: 112,
      notifyAttention: true,
      notifyCompletion: true,
      notifyFailure: true,
    },
    notifications: {
      completion: 'unfocused',
      permissions: true,
      questions: true,
      errors: true,
    },
  }
}

export function normalizeDesktopStoredSettings(value: unknown): DesktopStoredSettings {
  const parsed = value && typeof value === 'object' ? (value as Partial<DesktopStoredSettings>) : {}
  const defaults = defaultDesktopStoredSettings()
  const permissionMode = normalizeDesktopPermissionMode(parsed.permissionMode)
  const legacyPermissionProfile = normalizeDesktopPermissionProfile(
    parsed.permissionProfile,
    ':workspace',
  )
  const legacyTimelineOnlySettings =
    parsed.sidebarTimelineEnabled === undefined &&
    parsed.sidebarTimelinePriorityEnabled === undefined
  const timelineMigratedFromLegacyPriorityFilter =
    legacyTimelineOnlySettings && parsed.sidebarPriorityFilterEnabled === true
  const sandboxMode = isDesktopSandboxMode(parsed.sandboxMode)
    ? parsed.sandboxMode === 'full-access'
      ? 'danger-full-access'
      : parsed.sandboxMode
    : legacyPermissionProfile.includes('danger')
      ? 'danger-full-access'
      : legacyPermissionProfile.includes('read-only')
        ? 'read-only'
        : 'workspace-write'
  const rawPermissionConfig =
    parsed.permissionConfig && typeof parsed.permissionConfig === 'object'
      ? parsed.permissionConfig
      : null
  const permissionConfig = rawPermissionConfig
    ? {
        sandboxMode: isDesktopSandboxMode(rawPermissionConfig.sandboxMode)
          ? rawPermissionConfig.sandboxMode
          : sandboxMode,
        approvalPolicy: normalizeDesktopApprovalPolicy(
          rawPermissionConfig.approvalPolicy,
          normalizeDesktopApprovalPolicy(parsed.approvalPolicy, 'on-request'),
        ),
        approvalsReviewer: normalizeDesktopApprovalsReviewer(
          rawPermissionConfig.approvalsReviewer,
          normalizeDesktopApprovalsReviewer(parsed.approvalsReviewer, 'user'),
        ),
      }
    : {
        sandboxMode,
        approvalPolicy: normalizeDesktopApprovalPolicy(parsed.approvalPolicy, 'on-request'),
        approvalsReviewer: normalizeDesktopApprovalsReviewer(parsed.approvalsReviewer, 'user'),
      }
  return {
    language:
      parsed.language === 'zh-CN' || parsed.language === 'en-US' ? parsed.language : 'system',
    enableParetoCodeRouter:
      typeof parsed.enableParetoCodeRouter === 'boolean'
        ? parsed.enableParetoCodeRouter
        : defaults.enableParetoCodeRouter,
    enableFusionRouter:
      typeof parsed.enableFusionRouter === 'boolean'
        ? parsed.enableFusionRouter
        : defaults.enableFusionRouter,
    enableAutoReviewPermissionMode:
      typeof parsed.enableAutoReviewPermissionMode === 'boolean'
        ? parsed.enableAutoReviewPermissionMode
        : permissionMode === 'auto-review'
          ? true
          : defaults.enableAutoReviewPermissionMode,
    enableFullAccessPermissionMode:
      typeof parsed.enableFullAccessPermissionMode === 'boolean'
        ? parsed.enableFullAccessPermissionMode
        : permissionMode === 'full-access'
          ? true
          : defaults.enableFullAccessPermissionMode,
    permissionConfig,
    shellSecurityLevel: DESKTOP_SHELL_SECURITY_LEVELS.has(
      parsed.shellSecurityLevel as DesktopShellSecurityLevel,
    )
      ? (parsed.shellSecurityLevel as DesktopShellSecurityLevel)
      : defaults.shellSecurityLevel,
    terminalProfileId:
      parsed.terminalProfileId === null || typeof parsed.terminalProfileId === 'string'
        ? parsed.terminalProfileId
        : defaults.terminalProfileId,
    model: migrateModelAlias(stringOrDefault(parsed.model, defaults.model)),
    generationModel: stringOrDefault(
      parsed.generationModel,
      stringOrDefault(
        parsed.smallFastModel,
        stringOrDefault(parsed.fastModel, defaults.generationModel),
      ),
    ),
    organizationModel: stringOrDefault(
      parsed.organizationModel,
      stringOrDefault(
        parsed.smallFastModel,
        stringOrDefault(parsed.fastModel, defaults.organizationModel),
      ),
    ),
    codingModel: stringOrDefault(
      parsed.codingModel,
      stringOrDefault(
        parsed.planExecutionModel,
        stringOrDefault(
          parsed.deepModel,
          stringOrDefault(
            parsed.defaultModel,
            stringOrDefault(parsed.reviewModel, defaults.codingModel),
          ),
        ),
      ),
    ),
    securityModel: stringOrDefault(
      parsed.securityModel,
      stringOrDefault(parsed.reviewModel, defaults.securityModel),
    ),
    sessionName: stringOrDefault(parsed.sessionName, defaults.sessionName),
    thinkingMode: isDesktopThinkingMode(parsed.thinkingMode)
      ? parsed.thinkingMode
      : defaults.thinkingMode,
    systemPrompt: stringOrDefault(parsed.systemPrompt, defaults.systemPrompt),
    appendSystemPrompt: stringOrDefault(parsed.appendSystemPrompt, defaults.appendSystemPrompt),
    additionalDirectories: stringOrDefault(
      parsed.additionalDirectories,
      defaults.additionalDirectories,
    ),
    recentWorkspaces: normalizeDesktopWorkspaces(parsed.recentWorkspaces),
    projectAppearances: normalizeProjectAppearances(parsed.projectAppearances),
    drawerTab: isDesktopDrawerTab(parsed.drawerTab) ? parsed.drawerTab : defaults.drawerTab,
    selectedModelPreset: stringOrDefault(parsed.selectedModelPreset, defaults.selectedModelPreset),
    providerID:
      parsed.providerID === 'anthropic'
        ? defaults.providerID
        : typeof parsed.providerID === 'string'
          ? parsed.providerID.trim()
          : defaults.providerID,
    providerBaseURL: stringOrDefault(parsed.providerBaseURL, defaults.providerBaseURL),
    showContextUsage:
      typeof parsed.showContextUsage === 'boolean'
        ? parsed.showContextUsage
        : defaults.showContextUsage,
    defaultOpenTargetId: stringOrDefault(parsed.defaultOpenTargetId, defaults.defaultOpenTargetId),
    gitBranchPrefix: stringOrDefault(parsed.gitBranchPrefix, defaults.gitBranchPrefix),
    worktreeRoot: stringOrDefault(parsed.worktreeRoot, defaults.worktreeRoot),
    worktreeFetchUpstream: parsed.worktreeFetchUpstream === true,
    prWatchAutoMerge: parsed.prWatchAutoMerge === true,
    prWatchInstructions: stringOrDefault(parsed.prWatchInstructions, defaults.prWatchInstructions),
    gitPrMergeMethod: isDesktopGitPrMergeMethod(parsed.gitPrMergeMethod)
      ? parsed.gitPrMergeMethod
      : defaults.gitPrMergeMethod,
    gitShowPrIconsInSidebar:
      typeof parsed.gitShowPrIconsInSidebar === 'boolean'
        ? parsed.gitShowPrIconsInSidebar
        : defaults.gitShowPrIconsInSidebar,
    gitDraftPullRequest:
      typeof parsed.gitDraftPullRequest === 'boolean'
        ? parsed.gitDraftPullRequest
        : defaults.gitDraftPullRequest,
    gitAutoDeleteWorktree:
      typeof parsed.gitAutoDeleteWorktree === 'boolean'
        ? parsed.gitAutoDeleteWorktree
        : defaults.gitAutoDeleteWorktree,
    gitAutoDeleteWorktreeLimit: normalizeGitWorktreeLimit(
      parsed.gitAutoDeleteWorktreeLimit,
      defaults.gitAutoDeleteWorktreeLimit,
    ),
    allowForcePush:
      typeof parsed.allowForcePush === 'boolean' ? parsed.allowForcePush : defaults.allowForcePush,
    commitMessagePrompt: stringOrDefault(parsed.commitMessagePrompt, defaults.commitMessagePrompt),
    pullRequestPrompt: stringOrDefault(parsed.pullRequestPrompt, defaults.pullRequestPrompt),
    installPidexDependencies:
      typeof parsed.installPidexDependencies === 'boolean'
        ? parsed.installPidexDependencies
        : defaults.installPidexDependencies,
    workspaceDependenciesMigrated:
      typeof parsed.workspaceDependenciesMigrated === 'boolean'
        ? parsed.workspaceDependenciesMigrated
        : defaults.workspaceDependenciesMigrated,
    ...(parsed.firstUseSetupCompleted === 0 || parsed.firstUseSetupCompleted === 1
      ? { firstUseSetupCompleted: parsed.firstUseSetupCompleted }
      : {}),
    'desktop.voice.preferredInputDeviceId': stringOrDefault(
      parsed['desktop.voice.preferredInputDeviceId'],
      defaults['desktop.voice.preferredInputDeviceId'],
    ),
    personality: isDesktopPersonality(parsed.personality)
      ? parsed.personality
      : defaults.personality,
    customInstructions: stringOrDefault(parsed.customInstructions, defaults.customInstructions),
    enableMemory:
      typeof parsed.enableMemory === 'boolean' ? parsed.enableMemory : defaults.enableMemory,
    lastActiveWorkspacePath:
      typeof parsed.lastActiveWorkspacePath === 'string'
        ? parsed.lastActiveWorkspacePath
        : defaults.lastActiveWorkspacePath,
    removedWorkspaces: normalizeRemovedWorkspaces(
      parsed.removedWorkspaces,
      defaults.removedWorkspaces,
    ),
    skipToolAidedChats:
      typeof parsed.skipToolAidedChats === 'boolean'
        ? parsed.skipToolAidedChats
        : defaults.skipToolAidedChats,
    defaultModeRequestUserInput:
      typeof parsed.defaultModeRequestUserInput === 'boolean'
        ? parsed.defaultModeRequestUserInput
        : defaults.defaultModeRequestUserInput,
    githubMemorySyncEnabled:
      typeof parsed.githubMemorySyncEnabled === 'boolean'
        ? parsed.githubMemorySyncEnabled
        : defaults.githubMemorySyncEnabled,
    githubMemoryRepository: stringOrDefault(
      parsed.githubMemoryRepository,
      defaults.githubMemoryRepository,
    ),
    reviewView: isDesktopReviewView(parsed.reviewView) ? parsed.reviewView : defaults.reviewView,
    reviewDelivery:
      parsed.reviewDelivery === 'inline' || parsed.reviewDelivery === 'detached'
        ? parsed.reviewDelivery
        : defaults.reviewDelivery,
    conversationWidth:
      parsed.conversationWidth === 'narrow' || parsed.conversationWidth === 'wide'
        ? parsed.conversationWidth
        : defaults.conversationWidth,
    diffMarkerStyle: isDesktopDiffMarkerStyle(parsed.diffMarkerStyle)
      ? parsed.diffMarkerStyle
      : defaults.diffMarkerStyle,
    rustSearchAndDiffKernels:
      typeof parsed.rustSearchAndDiffKernels === 'boolean'
        ? parsed.rustSearchAndDiffKernels
        : defaults.rustSearchAndDiffKernels,
    sidebarLayout: parsed.sidebarLayout === 'classic' ? 'classic' : 'modern',
    sidebarOrganization: isDesktopSidebarOrganization(parsed.sidebarOrganization)
      ? parsed.sidebarOrganization
      : defaults.sidebarOrganization,
    sidebarProductMode: isSidebarProductMode(parsed.sidebarProductMode)
      ? parsed.sidebarProductMode
      : defaults.sidebarProductMode,
    sidebarStateVersion:
      typeof parsed.sidebarStateVersion === 'number' &&
      Number.isInteger(parsed.sidebarStateVersion) &&
      parsed.sidebarStateVersion >= 0
        ? parsed.sidebarStateVersion
        : 0,
    sidebarProjectSort: normalizeDesktopSidebarSort(
      parsed.sidebarProjectSort,
      defaults.sidebarProjectSort,
    ),
    sidebarSort: normalizeDesktopSidebarSort(parsed.sidebarSort, defaults.sidebarSort),
    sidebarTimelineEnabled: timelineMigratedFromLegacyPriorityFilter
      ? true
      : typeof parsed.sidebarTimelineEnabled === 'boolean'
        ? parsed.sidebarTimelineEnabled
        : defaults.sidebarTimelineEnabled,
    sidebarTimelinePriorityEnabled: timelineMigratedFromLegacyPriorityFilter
      ? true
      : typeof parsed.sidebarTimelinePriorityEnabled === 'boolean'
        ? parsed.sidebarTimelinePriorityEnabled
        : defaults.sidebarTimelinePriorityEnabled,
    sidebarActivityShowWork:
      typeof parsed.sidebarActivityShowWork === 'boolean'
        ? parsed.sidebarActivityShowWork
        : defaults.sidebarActivityShowWork,
    sidebarActivityShowChat:
      typeof parsed.sidebarActivityShowChat === 'boolean'
        ? parsed.sidebarActivityShowChat
        : defaults.sidebarActivityShowChat,
    sidebarShowScheduledSessions:
      typeof parsed.sidebarShowScheduledSessions === 'boolean'
        ? parsed.sidebarShowScheduledSessions
        : defaults.sidebarShowScheduledSessions,
    sidebarActivityShowScheduled: parsed.sidebarActivityShowScheduled === true,
    sidebarActivityShowPinned:
      typeof parsed.sidebarActivityShowPinned === 'boolean'
        ? parsed.sidebarActivityShowPinned
        : defaults.sidebarActivityShowPinned,
    sidebarActivityCoachmarkDismissed:
      typeof parsed.sidebarActivityCoachmarkDismissed === 'boolean'
        ? parsed.sidebarActivityCoachmarkDismissed
        : defaults.sidebarActivityCoachmarkDismissed,
    sidebarManualOrder: normalizeSidebarManualOrder(
      parsed.sidebarManualOrder,
      defaults.sidebarManualOrder,
    ),
    sidebarSessionPins: normalizeStringRecord(
      parsed.sidebarSessionPins,
      defaults.sidebarSessionPins,
    ),
    collapsedSidebarProjectPaths: normalizeUniqueStringList(
      parsed.collapsedSidebarProjectPaths,
      defaults.collapsedSidebarProjectPaths,
    ),
    sidebarSectionOrder: [...VALID_SIDEBAR_SECTION_IDS],
    browserAllowedSites: normalizeStringList(
      parsed.browserAllowedSites,
      defaults.browserAllowedSites,
    ),
    collapsedSidebarSections: normalizeStringList(
      parsed.collapsedSidebarSections,
      defaults.collapsedSidebarSections,
    ).filter(
      (id, index, arr) =>
        (VALID_SIDEBAR_SECTION_IDS as readonly string[]).includes(id) && arr.indexOf(id) === index,
    ) as SidebarSectionId[],
    browserSitePermissions: normalizeBrowserSitePermissions(
      parsed.browserSitePermissions,
      parsed.browserAllowedSites,
    ),
    sidebarCustomization: normalizeSidebarCustomization(
      parsed.sidebarCustomization,
      defaults.sidebarCustomization,
    ),
    pet: normalizePetSettings(parsed.pet, defaults.pet),
    notifications: normalizeSystemNotificationSettings(
      parsed.notifications,
      defaults.notifications,
    ),
  }
}

export function createSidebarStateResetPatch(
  settings: DesktopStoredSettings,
): Partial<DesktopStoredSettings> {
  return {
    recentWorkspaces: settings.recentWorkspaces.map((workspace) => ({
      ...workspace,
      pinnedAt: null,
    })),
    sidebarOrganization: 'projects',
    sidebarProductMode: settings.sidebarProductMode,
    sidebarStateVersion: SIDEBAR_STATE_VERSION,
    sidebarProjectSort: 'priority',
    sidebarSort: 'priority',
    sidebarTimelineEnabled: false,
    sidebarTimelinePriorityEnabled: true,
    sidebarActivityShowWork: true,
    sidebarActivityShowChat: true,
    sidebarShowScheduledSessions: true,
    sidebarActivityShowScheduled: false,
    sidebarActivityShowPinned: false,
    sidebarActivityCoachmarkDismissed: settings.sidebarActivityCoachmarkDismissed ?? false,
    sidebarManualOrder: {},
    sidebarSessionPins: {},
    collapsedSidebarProjectPaths: [],
    sidebarSectionOrder: [...VALID_SIDEBAR_SECTION_IDS],
    collapsedSidebarSections: ['projects', 'recent'],
  }
}

function isSidebarProductMode(value: unknown): value is SidebarProductMode {
  return value === 'coding' || value === 'working' || value === 'chat'
}

function normalizePetSettings(
  value: unknown,
  fallback: DesktopStoredSettings['pet'],
): DesktopStoredSettings['pet'] {
  const pet =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<DesktopStoredSettings['pet']>)
      : {}
  const rawSize =
    typeof pet.size === 'number' && Number.isFinite(pet.size) ? Math.round(pet.size) : fallback.size
  const selectedPetId =
    typeof pet.selectedPetId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(pet.selectedPetId)
      ? pet.selectedPetId
      : null
  return {
    enabled: typeof pet.enabled === 'boolean' ? pet.enabled : fallback.enabled,
    selectedPetId,
    size: Math.min(224, Math.max(80, rawSize)),
    notifyAttention:
      typeof pet.notifyAttention === 'boolean' ? pet.notifyAttention : fallback.notifyAttention,
    notifyCompletion:
      typeof pet.notifyCompletion === 'boolean' ? pet.notifyCompletion : fallback.notifyCompletion,
    notifyFailure:
      typeof pet.notifyFailure === 'boolean' ? pet.notifyFailure : fallback.notifyFailure,
  }
}

function normalizeSystemNotificationSettings(
  value: unknown,
  fallback: DesktopStoredSettings['notifications'],
): DesktopStoredSettings['notifications'] {
  const notifications =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<DesktopStoredSettings['notifications']>)
      : {}
  const completion = notifications.completion
  const normalizedCompletion =
    completion === 'always' || completion === 'unfocused' || completion === 'never'
      ? completion
      : fallback.completion
  return {
    completion: normalizedCompletion,
    permissions:
      typeof notifications.permissions === 'boolean'
        ? notifications.permissions
        : fallback.permissions,
    questions:
      typeof notifications.questions === 'boolean' ? notifications.questions : fallback.questions,
    errors: typeof notifications.errors === 'boolean' ? notifications.errors : fallback.errors,
  }
}

function normalizeBrowserSitePermissions(
  value: unknown,
  legacyAllowedSites: unknown,
): DesktopStoredSettings['browserSitePermissions'] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const record = item as {
          origin?: unknown
          decision?: unknown
          updatedAt?: unknown
        }
        if (record.decision !== 'allow' && record.decision !== 'deny') return []
        const origin = normalizeBrowserPermissionOrigin(record.origin)
        if (!origin) return []
        return [
          {
            origin,
            decision: record.decision as 'allow' | 'deny',
            updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
          },
        ]
      })
      .filter(
        (item, index, items) =>
          items.findIndex((candidate) => candidate.origin === item.origin) === index,
      )
  }
  return normalizeStringList(legacyAllowedSites, []).flatMap((site) => {
    const origin = normalizeBrowserPermissionOrigin(site)
    return origin
      ? [
          {
            origin,
            decision: 'allow' as const,
            updatedAt: '',
          },
        ]
      : []
  })
}

function normalizeBrowserPermissionOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed === 'file://') return trimmed
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }
  return parsed.origin
}

export function normalizeDesktopPermissionProfile(value: unknown, fallback = ':workspace'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function normalizeDesktopApprovalPolicy(
  value: unknown,
  fallback: DesktopStoredSettings['approvalPolicy'] = 'on-request',
): DesktopStoredSettings['approvalPolicy'] {
  if (value === 'on-failure') return 'on-request'
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const policy = value as Record<string, unknown>
    const keys = [
      'sandboxApproval',
      'rules',
      'skillApproval',
      'requestPermissions',
      'mcpTools',
      'mcpElicitations',
    ] as const
    if (policy.type === 'granular' && keys.every((key) => typeof policy[key] === 'boolean')) {
      return {
        type: 'granular',
        sandboxApproval: policy.sandboxApproval as boolean,
        rules: policy.rules as boolean,
        skillApproval: policy.skillApproval as boolean,
        requestPermissions: policy.requestPermissions as boolean,
        mcpTools: policy.mcpTools as boolean,
        mcpElicitations: policy.mcpElicitations as boolean,
      }
    }
  }
  return value === 'untrusted' || value === 'on-request' || value === 'never' ? value : fallback
}

export function normalizeDesktopApprovalsReviewer(
  value: unknown,
  fallback: DesktopStoredSettings['approvalsReviewer'] = 'user',
): DesktopStoredSettings['approvalsReviewer'] {
  if (value === 'auto') return 'auto_review'
  return value === 'user' || value === 'auto_review' ? value : fallback
}

export function normalizeDesktopWorkspaces(value: unknown): DesktopWorkspace[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const workspace = item as Partial<DesktopWorkspace>
    if (workspace.isStandalone) return []
    if (typeof workspace.name !== 'string') return []
    if (typeof workspace.path !== 'string') return []
    return [
      {
        projectId: typeof workspace.projectId === 'string' ? workspace.projectId : undefined,
        name: workspace.name,
        path: workspace.path,
        ...(typeof workspace.lastOpenedAt === 'string'
          ? { lastOpenedAt: workspace.lastOpenedAt }
          : {}),
        primaryFolderId:
          typeof workspace.primaryFolderId === 'string' ? workspace.primaryFolderId : undefined,
        folders: normalizeProjectFolders(workspace.folders),
        projectSettings: normalizeProjectSettings(workspace.projectSettings),
        branchName: typeof workspace.branchName === 'string' ? workspace.branchName : null,
        isGitRepo: typeof workspace.isGitRepo === 'boolean' ? workspace.isGitRepo : undefined,
        pinnedAt: typeof workspace.pinnedAt === 'string' ? workspace.pinnedAt : null,
      },
    ]
  })
}

export function normalizeRemovedWorkspaces(
  value: unknown,
  fallback: DesktopStoredSettings['removedWorkspaces'],
): DesktopStoredSettings['removedWorkspaces'] {
  if (!Array.isArray(value)) return fallback
  return value
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const record = item as {
        projectId?: unknown
        path?: unknown
        name?: unknown
        removedAt?: unknown
      }
      if (typeof record.path !== 'string') return []
      if (typeof record.name !== 'string') return []
      return [
        {
          path: record.path,
          ...(typeof record.projectId === 'string' ? { projectId: record.projectId } : {}),
          name: record.name,
          removedAt:
            typeof record.removedAt === 'string' ? record.removedAt : new Date().toISOString(),
        },
      ]
    })
    .slice(0, MAX_REMOVED_WORKSPACES)
}

export function isDesktopDiffMarkerStyle(value: unknown): value is DesktopDiffMarkerStyle {
  return DESKTOP_DIFF_MARKER_STYLES.has(value as DesktopDiffMarkerStyle)
}

export function isDesktopSidebarOrganization(value: unknown): value is DesktopSidebarOrganization {
  return DESKTOP_SIDEBAR_ORGANIZATIONS.has(value as DesktopSidebarOrganization)
}

export function isDesktopSidebarSort(value: unknown): value is DesktopSidebarSort {
  return DESKTOP_SIDEBAR_SORTS.has(value as DesktopSidebarSort)
}

function normalizeDesktopSidebarSort(
  value: unknown,
  fallback: DesktopSidebarSort,
): DesktopSidebarSort {
  if (value === 'recent' || value === 'created') return 'updated'
  return isDesktopSidebarSort(value) ? value : fallback
}

export function normalizeSidebarCustomization(
  value: unknown,
  fallback: SidebarCustomization = DEFAULT_SIDEBAR_CUSTOMIZATION,
): SidebarCustomization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }
  const raw = value as Record<string, unknown>
  const version = typeof raw.version === 'number' ? raw.version : 1
  if (version > 1) {
    return value as SidebarCustomization
  }

  const rawSections = Array.isArray(raw.sections) ? raw.sections : []
  const sections: SidebarCustomSection[] = []
  const sectionIdSet = new Set<string>()

  for (const s of rawSections) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue
    const sec = s as Record<string, unknown>
    const id = typeof sec.id === 'string' && sec.id.trim() ? sec.id.trim() : null
    if (!id || sectionIdSet.has(id)) continue
    sectionIdSet.add(id)
    const title = typeof sec.title === 'string' ? sec.title : '新建分组'
    const itemKeys = Array.isArray(sec.itemKeys)
      ? sec.itemKeys.filter((k): k is string => typeof k === 'string' && Boolean(k))
      : []
    const sort: 'manual' | 'updated' = sec.sort === 'updated' ? 'updated' : 'manual'
    const collapsed = Boolean(sec.collapsed)
    sections.push({ id, title, itemKeys, sort, collapsed })
  }

  const rawOrder = Array.isArray(raw.sectionOrder)
    ? raw.sectionOrder.filter((id): id is string => typeof id === 'string')
    : []
  const sectionOrder: string[] = []
  const orderSet = new Set<string>()
  for (const id of rawOrder) {
    if (!orderSet.has(id)) {
      orderSet.add(id)
      sectionOrder.push(id)
    }
  }
  for (const sec of sections) {
    if (!orderSet.has(sec.id)) {
      orderSet.add(sec.id)
      sectionOrder.push(sec.id)
    }
  }

  const pinnedSort: 'manual' | 'updated' = raw.pinnedSort === 'updated' ? 'updated' : 'manual'

  const rawDestOrder = Array.isArray(raw.destinationOrder)
    ? raw.destinationOrder.filter((id): id is string => typeof id === 'string')
    : []
  const destinationOrder: string[] = []
  const destOrderSet = new Set<string>()
  for (const id of rawDestOrder) {
    if (!destOrderSet.has(id)) {
      destOrderSet.add(id)
      destinationOrder.push(id)
    }
  }
  for (const id of DEFAULT_SIDEBAR_DESTINATION_ORDER) {
    if (!destOrderSet.has(id)) {
      destOrderSet.add(id)
      destinationOrder.push(id)
    }
  }

  const hiddenDestinationIds = Array.isArray(raw.hiddenDestinationIds)
    ? normalizeUniqueStringList(raw.hiddenDestinationIds, [])
    : [...DEFAULT_SIDEBAR_HIDDEN_DESTINATION_IDS]

  return {
    version: 1,
    sections,
    sectionOrder,
    pinnedSort,
    showProjectsInRecents: raw.showProjectsInRecents === true,
    destinationOrder,
    hiddenDestinationIds,
  }
}

export function upsertRecentWorkspace(
  workspaces: DesktopWorkspace[],
  workspace: DesktopWorkspace,
): DesktopWorkspace[] {
  if (workspace.isStandalone) return workspaces
  const index = workspaces.findIndex((item) =>
    workspace.projectId
      ? item.projectId === workspace.projectId
      : !item.projectId && item.path === workspace.path,
  )
  if (index >= 0) {
    // Update in-place without changing position
    const next = [...workspaces]
    next[index] = {
      ...workspace,
      pinnedAt:
        workspace.pinnedAt !== undefined ? workspace.pinnedAt : (next[index].pinnedAt ?? null),
    }
    return next
  }
  // Append new workspace to the end
  return [...workspaces, workspace].slice(-MAX_RECENT_WORKSPACES)
}

function normalizeProjectFolders(
  value: DesktopWorkspace['folders'] | undefined,
): DesktopWorkspace['folders'] {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((folder) => {
    if (
      !folder ||
      typeof folder.id !== 'string' ||
      typeof folder.name !== 'string' ||
      typeof folder.path !== 'string' ||
      (folder.role !== 'primary' && folder.role !== 'secondary')
    ) {
      return []
    }
    return [
      {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        role: folder.role,
        availability:
          folder.availability === 'missing' ? ('missing' as const) : ('available' as const),
        order: typeof folder.order === 'number' ? folder.order : 0,
        createdAt: typeof folder.createdAt === 'number' ? folder.createdAt : 0,
        updatedAt: typeof folder.updatedAt === 'number' ? folder.updatedAt : 0,
      },
    ]
  })
}

function normalizeProjectSettings(
  value: DesktopWorkspace['projectSettings'] | undefined,
): DesktopWorkspace['projectSettings'] {
  if (!value || typeof value.instructions !== 'string' || typeof value.version !== 'number') {
    return undefined
  }
  return {
    defaultModel: value.defaultModel ?? null,
    instructions: value.instructions,
    // Older persisted settings predate the field and mean the automatic default.
    executionEnvironment: value.executionEnvironment === 'local' ? 'local' : 'auto',
    version: value.version,
  }
}

export function mergeDesktopBrowserAllowedSites(current: string[], incoming: string[]): string[] {
  return [...current, ...incoming].filter((site, index, sites) => sites.indexOf(site) === index)
}

export function isDesktopPermissionMode(value: unknown): value is DesktopPermissionMode {
  return isDesktopAgentPermissionMode(value)
}

export function normalizeDesktopPermissionMode(value: unknown): DesktopPermissionMode {
  return normalizeDesktopAgentPermissionMode(typeof value === 'string' ? value : undefined)
}

export function desktopPermissionPolicyForMode(
  mode: DesktopPermissionMode | undefined,
): AgentPermissionPolicy {
  return permissionPolicyForDesktopMode(mode)
}

export function isDesktopThinkingMode(value: unknown): value is DesktopThinkingMode {
  return typeof value === 'string' && DESKTOP_THINKING_MODES.has(value as DesktopThinkingMode)
}

export function isDesktopSandboxMode(value: unknown): value is DesktopSandboxMode {
  return typeof value === 'string' && DESKTOP_SANDBOX_MODES.has(value as DesktopSandboxMode)
}

export function isDesktopPersonality(value: unknown): value is DesktopPersonality {
  return typeof value === 'string' && DESKTOP_PERSONALITIES.has(value as DesktopPersonality)
}

export function isDesktopReviewView(value: unknown): value is DesktopReviewView {
  return typeof value === 'string' && DESKTOP_REVIEW_VIEWS.has(value as DesktopReviewView)
}

export function isDesktopDrawerTab(value: unknown): value is DesktopDrawerTab {
  return typeof value === 'string' && DESKTOP_DRAWER_TABS.has(value as DesktopDrawerTab)
}

export const DESKTOP_GIT_PR_MERGE_METHODS = new Set<'merge' | 'squash'>(['merge', 'squash'])

export function isDesktopGitPrMergeMethod(value: unknown): value is 'merge' | 'squash' {
  return typeof value === 'string' && DESKTOP_GIT_PR_MERGE_METHODS.has(value as 'merge' | 'squash')
}

export function normalizeGitWorktreeLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

export function isModelProviderID(value: unknown): value is ModelProviderID {
  return typeof value === 'string' && value.trim().length > 0
}

export { isLocalRouterMode, normalizeLocalRouterMode } from './Types.js'
export type { LocalRouterMode } from './Types.js'

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  return value.filter((item) => typeof item === 'string')
}

function normalizeUtf8String(value: string): string {
  return value.normalize('NFC').trim()
}

function normalizeUniqueStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const normalized = value.flatMap((item) => {
    if (typeof item !== 'string') return []
    const normalizedItem = normalizeUtf8String(item)
    return normalizedItem ? [normalizedItem] : []
  })
  return normalized.filter((item, index) => normalized.indexOf(item) === index)
}

function normalizeStringRecord(
  value: unknown,
  fallback: Record<string, string>,
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...fallback }
  }
  const normalized: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') continue
    const key = normalizeUtf8String(rawKey)
    const normalizedValue = normalizeUtf8String(rawValue)
    const timestamp = Date.parse(normalizedValue)
    if (!key || !normalizedValue || Number.isNaN(timestamp) || key in normalized) {
      continue
    }
    normalized[key] = new Date(timestamp).toISOString()
  }
  return normalized
}

export function normalizeProjectAppearances(value: unknown): Record<string, ProjectAppearance> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: Record<string, ProjectAppearance> = {}
  for (const [rawProjectId, rawAppearance] of Object.entries(value)) {
    const projectId = normalizeUtf8String(rawProjectId)
    if (
      !projectId ||
      projectId in normalized ||
      !rawAppearance ||
      typeof rawAppearance !== 'object' ||
      Array.isArray(rawAppearance)
    ) {
      continue
    }
    const appearance = rawAppearance as Record<string, unknown>
    normalized[projectId] = {
      color: PROJECT_APPEARANCE_COLOR_SET.has(appearance.color as ProjectAppearanceColor)
        ? (appearance.color as ProjectAppearanceColor)
        : DEFAULT_PROJECT_APPEARANCE.color,
      icon: PROJECT_APPEARANCE_ICON_SET.has(appearance.icon as ProjectAppearanceIcon)
        ? (appearance.icon as ProjectAppearanceIcon)
        : DEFAULT_PROJECT_APPEARANCE.icon,
    }
  }
  return normalized
}

function normalizeSidebarSectionOrder(value: unknown): SidebarSectionId[] {
  const normalized = normalizeUniqueStringList(value, []).filter((id): id is SidebarSectionId =>
    (VALID_SIDEBAR_SECTION_IDS as readonly string[]).includes(id),
  )
  return [...normalized, ...VALID_SIDEBAR_SECTION_IDS.filter((id) => !normalized.includes(id))]
}

function normalizeSidebarManualOrder(
  value: unknown,
  fallback: Record<string, string[]>,
): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }
  const normalized: Record<string, string[]> = {}
  for (const [rawScopeKey, sessionIds] of Object.entries(value)) {
    if (!Array.isArray(sessionIds)) continue
    const scopeKey = normalizeUtf8String(rawScopeKey)
    if (!scopeKey || scopeKey in normalized) continue
    const deduped = normalizeUniqueStringList(sessionIds, [])
    if (deduped.length > 0) {
      normalized[scopeKey] = deduped
    }
  }
  return normalized
}

function migrateModelAlias(model: string): string {
  switch (model) {
    case 'haiku':
      return 'fast'
    case 'sonnet':
      return 'default'
    case 'opus':
    case 'best':
      return 'deep'
    case 'opusplan':
      return 'plan'
    case 'sonnet[1m]':
      return 'default[1m]'
    case 'opus[1m]':
      return 'deep[1m]'
    default:
      return model
  }
}
