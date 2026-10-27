import { useFieldState } from '../../hooks/UseFieldState.js'
import { CONFIG_UPDATED_EVENT, desktopClient } from '../../services/desktop-client/index.js'
import { useStore } from 'zustand/react'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { LocaleProvider } from '../i18n/LocaleProvider.js'
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from 'react'
import type { DrawerTab } from '../../UiTypes.js'
import type {
  DesktopDiffMarkerStyle,
  DesktopPermissionMode,
  DesktopPersonality,
  DesktopReviewView,
  DesktopReviewDelivery,
  DesktopSandboxMode,
  DesktopBrowserSitePermission,
  DesktopSidebarOrganization,
  DesktopSidebarSort,
  DesktopThinkingMode,
  DesktopWorkspace,
  ModelProviderID,
  ProjectAppearance,
  SidebarProductMode,
  SidebarSectionId,
  SidebarCustomization,
  SidebarCustomSection,
} from '../../../shared/Types.js'
import {
  DEFAULT_SIDEBAR_CUSTOMIZATION,
  SIDEBAR_STATE_VERSION,
} from '../../../shared/SettingsSchema.js'
import {
  type StoredDesktopSettings,
  permissionConfigForMode,
  permissionModeForConfig,
  readStoredDesktopSettings,
  storeDesktopSettings,
} from './SettingsStorage.js'

export type DesktopSettingsAccess = 'read-write' | 'read-only'

export type UseDesktopSettingsResult = {
  enableParetoCodeRouter: boolean
  enableFusionRouter: boolean
  enableAutoReviewPermissionMode: boolean
  enableFullAccessPermissionMode: boolean
  permissionMode: DesktopPermissionMode
  model: string
  generationModel: string
  organizationModel: string
  codingModel: string
  securityModel: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  recentWorkspaces: DesktopWorkspace[]
  projectAppearances: Record<string, ProjectAppearance>
  drawerTab: DrawerTab
  selectedModelPreset: string
  providerID: ModelProviderID
  providerBaseURL: string
  showContextUsage: boolean
  defaultOpenTargetId: string
  gitBranchPrefix: string
  gitPrMergeMethod: 'merge' | 'squash'
  gitShowPrIconsInSidebar: boolean
  gitDraftPullRequest: boolean
  gitAutoDeleteWorktree: boolean
  gitAutoDeleteWorktreeLimit: number
  allowForcePush: boolean
  commitMessagePrompt: string
  pullRequestPrompt: string
  sandboxMode: DesktopSandboxMode
  allowNetworkAccess: boolean
  installPidexDependencies: boolean
  workspaceDependenciesMigrated: boolean
  firstUseSetupCompleted: 0 | 1 | undefined
  personality: DesktopPersonality
  customInstructions: string
  enableMemory: boolean
  skipToolAidedChats: boolean
  githubMemorySyncEnabled: boolean
  githubMemoryRepository: string
  reviewView: DesktopReviewView
  reviewDelivery: DesktopReviewDelivery
  conversationWidth: StoredDesktopSettings['conversationWidth']
  diffMarkerStyle: DesktopDiffMarkerStyle
  rustSearchAndDiffKernels: boolean
  sidebarOrganization: DesktopSidebarOrganization
  sidebarProductMode: SidebarProductMode
  sidebarProjectSort: DesktopSidebarSort
  sidebarSort: DesktopSidebarSort
  sidebarTimelineEnabled: boolean
  sidebarTimelinePriorityEnabled: boolean
  sidebarActivityShowWork: boolean
  sidebarActivityShowChat: boolean
  sidebarShowScheduledSessions: boolean
  sidebarActivityShowScheduled: boolean
  sidebarActivityShowPinned: boolean
  sidebarActivityCoachmarkDismissed: boolean
  sidebarManualOrder: Record<string, string[]>
  sidebarSessionPins: Record<string, string>
  collapsedSidebarProjectPaths: string[]
  sidebarSectionOrder: SidebarSectionId[]
  browserAllowedSites: string[]
  collapsedSidebarSections: SidebarSectionId[]
  browserSitePermissions: DesktopBrowserSitePermission[]
  settingsLoaded: boolean
  setPermissionMode: (value: DesktopPermissionMode) => void
  setEnableAutoReviewPermissionMode: (value: boolean) => void
  setEnableFullAccessPermissionMode: (value: boolean) => void
  setModel: (value: string) => void
  setGenerationModel: (value: string) => void
  setOrganizationModel: (value: string) => void
  setCodingModel: (value: string) => void
  setSecurityModel: (value: string) => void
  setSessionName: (value: string) => void
  setThinkingMode: (value: DesktopThinkingMode) => void
  setSystemPrompt: (value: string) => void
  setAppendSystemPrompt: (value: string) => void
  setAdditionalDirectories: (value: string) => void
  setRecentWorkspaces: (
    value: DesktopWorkspace[] | ((current: DesktopWorkspace[]) => DesktopWorkspace[]),
  ) => void
  setProjectAppearances: (
    value:
      | Record<string, ProjectAppearance>
      | ((current: Record<string, ProjectAppearance>) => Record<string, ProjectAppearance>),
  ) => void
  setDrawerTab: (value: DrawerTab) => void
  setSelectedModelPreset: (value: string) => void
  setProviderID: (value: ModelProviderID) => void
  setProviderBaseURL: (value: string) => void
  setShowContextUsage: (value: boolean) => void
  setDefaultOpenTargetId: (value: string) => void
  setGitBranchPrefix: (value: string) => void
  setGitPrMergeMethod: (value: 'merge' | 'squash') => void
  setGitShowPrIconsInSidebar: (value: boolean) => void
  setGitDraftPullRequest: (value: boolean) => void
  setGitAutoDeleteWorktree: (value: boolean) => void
  setGitAutoDeleteWorktreeLimit: (value: number) => void
  setAllowForcePush: (value: boolean) => void
  setCommitMessagePrompt: (value: string) => void
  setPullRequestPrompt: (value: string) => void
  setSandboxMode: (value: DesktopSandboxMode) => void
  setAllowNetworkAccess: (value: boolean) => void
  setInstallPidexDependencies: (value: boolean) => void
  setPersonality: (value: DesktopPersonality) => void
  setCustomInstructions: (value: string) => void
  setEnableMemory: (value: boolean) => void
  setSkipToolAidedChats: (value: boolean) => void
  setGithubMemorySyncEnabled: (value: boolean) => void
  setGithubMemoryRepository: (value: string) => void
  setReviewView: (value: DesktopReviewView) => void
  setReviewDelivery: (value: DesktopReviewDelivery) => void
  setDiffMarkerStyle: (value: DesktopDiffMarkerStyle) => void
  setRustSearchAndDiffKernels: (value: boolean) => void
  setSidebarOrganization: (value: DesktopSidebarOrganization) => void
  setSidebarProductMode: (value: SidebarProductMode) => void
  setSidebarProjectSort: (value: DesktopSidebarSort) => void
  setSidebarSort: (value: DesktopSidebarSort) => void
  setSidebarTimelineEnabled: (value: boolean | ((current: boolean) => boolean)) => void
  setSidebarTimelinePriorityEnabled: (value: boolean | ((current: boolean) => boolean)) => void
  setSidebarActivityShowWork: (value: boolean | ((current: boolean) => boolean)) => void
  setSidebarActivityShowChat: (value: boolean | ((current: boolean) => boolean)) => void
  setSidebarShowScheduledSessions: (value: boolean | ((current: boolean) => boolean)) => void
  setSidebarActivityShowScheduled: (value: boolean | ((current: boolean) => boolean)) => void
  setSidebarActivityShowPinned: (value: boolean | ((current: boolean) => boolean)) => void
  setSidebarActivityCoachmarkDismissed: (value: boolean | ((current: boolean) => boolean)) => void
  setSidebarManualOrder: (
    value:
      Record<string, string[]> | ((current: Record<string, string[]>) => Record<string, string[]>),
  ) => void
  setSidebarSessionPins: (
    value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>),
  ) => void
  setCollapsedSidebarProjectPaths: (value: string[] | ((current: string[]) => string[])) => void
  setSidebarSectionOrder: (
    value: SidebarSectionId[] | ((current: SidebarSectionId[]) => SidebarSectionId[]),
  ) => void
  setBrowserAllowedSites: (value: string[]) => void
  setCollapsedSidebarSections: (
    value: SidebarSectionId[] | ((current: SidebarSectionId[]) => SidebarSectionId[]),
  ) => void
  sidebarCustomization: SidebarCustomization
  setSidebarCustomization: (
    value: SidebarCustomization | ((current: SidebarCustomization) => SidebarCustomization),
  ) => void
  syncExternalSettingsPatch: (patch: Partial<StoredDesktopSettings>) => void
  saveFirstUseSetupCompleted: (value: 0 | 1) => Promise<void>
  draft: DesktopSettingsDraft
  /** 与 `draft` 相同的动作，但 identity 稳定，供草稿字段订阅读取。 */
  draftActions: DesktopSettingsDraftActions
  flushDesktopSettings: () => Promise<void>
}

export type UseDesktopRuntimeSettingsResult = Pick<
  UseDesktopSettingsResult,
  | 'settingsLoaded'
  | 'setPermissionMode'
  | 'setModel'
  | 'setProviderBaseURL'
  | 'setProviderID'
  | 'setThinkingMode'
  | 'setRecentWorkspaces'
  | 'setDrawerTab'
  | 'setSelectedModelPreset'
  | 'setReviewView'
  | 'setSidebarSessionPins'
  | 'setSidebarTimelineEnabled'
  | 'setSidebarProductMode'
  | 'setSidebarCustomization'
  | 'syncExternalSettingsPatch'
> & {
  values: StoredDesktopSettings
  permissionMode: DesktopPermissionMode
}

type DesktopSettingsState = {
  settings: UseDesktopSettingsResult
  runtime: UseDesktopRuntimeSettingsResult
}

type DesktopSettingsDraftSetter = <Key extends keyof StoredDesktopSettings>(
  key: Key,
  value:
    | StoredDesktopSettings[Key]
    | ((current: StoredDesktopSettings[Key]) => StoredDesktopSettings[Key]),
) => void

export type DesktopSettingsDraftActions = {
  setValue: DesktopSettingsDraftSetter
  save: () => Promise<StoredDesktopSettings>
  saveFields: (keys: readonly (keyof StoredDesktopSettings)[]) => Promise<StoredDesktopSettings>
  reset: () => void
  autoSave: () => void
}

export type DesktopSettingsDraft = {
  values: StoredDesktopSettings
  dirty: boolean
  saving: boolean
  setValue: DesktopSettingsDraftSetter
  save: (baseValues?: StoredDesktopSettings) => Promise<StoredDesktopSettings>
  saveFields: (keys: readonly (keyof StoredDesktopSettings)[]) => Promise<StoredDesktopSettings>
  reset: () => void
  autoSave: () => void
}

export function isSettingsSaveShortcut(event: {
  ctrlKey: boolean
  metaKey: boolean
  key: string
}): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's'
}

export function createSettingsSaveShortcutHandler(
  save: () => Promise<unknown>,
): (event: {
  ctrlKey: boolean
  metaKey: boolean
  key: string
  preventDefault: () => void
}) => Promise<boolean> {
  return async (event) => {
    if (!isSettingsSaveShortcut(event)) return false
    event.preventDefault()
    await save()
    return true
  }
}

export function createDesktopSettingsDraft(
  initialValues: StoredDesktopSettings,
  saveValues: (values: StoredDesktopSettings) => Promise<StoredDesktopSettings | void>,
): DesktopSettingsDraft {
  let values = cloneDesktopSettings(initialValues)
  const dirtyKeys = new Set<keyof StoredDesktopSettings>()
  let dirty = false

  return {
    get values() {
      return values
    },
    get dirty() {
      return dirty
    },
    saving: false,
    setValue(key, value) {
      values = updateDesktopSettingsValue(values, key, value)
      dirtyKeys.add(key)
      dirty = !desktopSettingsEqual(values, initialValues)
    },
    async save(baseValues = initialValues) {
      const snapshot = mergeDesktopSettingsDraft(baseValues, values, dirtyKeys)
      const saved = await saveValues(snapshot)
      values = saved ? cloneDesktopSettings(saved) : cloneDesktopSettings(snapshot)
      dirtyKeys.clear()
      dirty = false
      return values
    },
    async saveFields(keys) {
      const selected = new Set(keys)
      const snapshot = mergeDesktopSettingsDraft(initialValues, values, selected)
      const saved = await saveValues(snapshot)
      for (const key of keys)
        if (JSON.stringify(values[key]) === JSON.stringify(snapshot[key])) dirtyKeys.delete(key)
      initialValues = saved ? cloneDesktopSettings(saved) : snapshot
      values = mergeDesktopSettingsDraft(initialValues, values, dirtyKeys)
      dirty = dirtyKeys.size > 0
      return initialValues
    },
    reset() {
      values = cloneDesktopSettings(initialValues)
      dirtyKeys.clear()
      dirty = false
    },
    autoSave() {
      const snapshot = mergeDesktopSettingsDraft(initialValues, values, dirtyKeys)
      void saveValues(snapshot).then((saved) => {
        values = saved ? cloneDesktopSettings(saved) : cloneDesktopSettings(snapshot)
        dirtyKeys.clear()
        dirty = false
      })
    },
  }
}

/** 设置字段的订阅快照：Provider 每次提交后写入，供字段 selector 读取。 */
type DesktopSettingsFieldSnapshot = {
  settings: UseDesktopSettingsResult
  runtime: UseDesktopRuntimeSettingsResult
}

type DesktopSettingsFieldStore = StoreApi<DesktopSettingsFieldSnapshot>

type DesktopSettingsHotData = {
  desktopSettingsFieldStoreContext?: Context<DesktopSettingsFieldStore | null>
}

const hotData = import.meta.hot?.data as DesktopSettingsHotData | undefined

// 热更新时保留 Context 身份，避免已有 Provider 与更新后的 Hook 引用不同实例。
const DesktopSettingsFieldStoreContext =
  hotData?.desktopSettingsFieldStoreContext ?? createContext<DesktopSettingsFieldStore | null>(null)

if (import.meta.hot) {
  const data = import.meta.hot.data as DesktopSettingsHotData
  data.desktopSettingsFieldStoreContext = DesktopSettingsFieldStoreContext
}

export function DesktopSettingsProvider({
  children,
  access = 'read-write',
}: {
  children: ReactNode
  access?: DesktopSettingsAccess
}): ReactNode {
  const state = useDesktopSettingsState(access)
  const [fieldStore] = useState(() => createStore<DesktopSettingsFieldSnapshot>()(() => state))
  // Provider 是唯一写入口：提交后把最新快照写入字段 Store，避免渲染期写外部 Store。
  useEffect(() => {
    fieldStore.setState(state)
  })
  return createElement(
    DesktopSettingsFieldStoreContext.Provider,
    { value: fieldStore },
    createElement(LocaleProvider, { preference: state.runtime.values.language }, children),
  )
}

function useDesktopSettingsFieldStore(): DesktopSettingsFieldStore {
  const store = useContext(DesktopSettingsFieldStoreContext)
  if (!store) {
    throw new Error('useDesktopSettings 必须在 DesktopSettingsProvider 内使用')
  }
  return store
}

/** 按字段订阅设置；聚合字段用 `useShallow`，字段本身保持引用稳定。 */
export function useDesktopSettingsField<T>(selector: (state: UseDesktopSettingsResult) => T): T {
  return useStore(useDesktopSettingsFieldStore(), (state) => selector(state.settings))
}

/** 按字段订阅运行时设置。 */
export function useDesktopRuntimeSettingsField<T>(
  selector: (state: UseDesktopRuntimeSettingsResult) => T,
): T {
  return useStore(useDesktopSettingsFieldStore(), (state) => selector(state.runtime))
}

/** 按键订阅设置草稿值；只在该键变化时重渲染。 */
export function useDesktopSettingsDraftValue<Key extends keyof StoredDesktopSettings>(
  key: Key,
): StoredDesktopSettings[Key] {
  return useDesktopSettingsField((settings) => settings.draft.values[key])
}

export function useDesktopSettingsDraftDirty(): boolean {
  return useDesktopSettingsField((settings) => settings.draft.dirty)
}

export function useDesktopSettingsDraftSaving(): boolean {
  return useDesktopSettingsField((settings) => settings.draft.saving)
}

/** 稳定的草稿动作集合；identity 在挂载期内不变。 */
export function useDesktopSettingsDraftActions(): DesktopSettingsDraftActions {
  return useDesktopSettingsField((settings) => settings.draftActions)
}

function useDesktopSettingsState(
  access: DesktopSettingsAccess = 'read-write',
): DesktopSettingsState {
  const initial = readStoredDesktopSettings()
  const [stateStore] = useState(() =>
    createStore(() => ({
      enableParetoCodeRouter: (initial.enableParetoCodeRouter ?? false) as boolean,
      enableFusionRouter: (initial.enableFusionRouter ?? false) as boolean,
      enableAutoReviewPermissionMode: (initial.enableAutoReviewPermissionMode ?? false) as boolean,
      enableFullAccessPermissionMode: (initial.enableFullAccessPermissionMode ?? false) as boolean,
      model: initial.model,
      generationModel: initial.generationModel,
      organizationModel: initial.organizationModel,
      codingModel: initial.codingModel,
      securityModel: initial.securityModel,
      sessionName: initial.sessionName,
      thinkingMode: initial.thinkingMode as DesktopThinkingMode,
      systemPrompt: initial.systemPrompt,
      appendSystemPrompt: initial.appendSystemPrompt,
      additionalDirectories: initial.additionalDirectories,
      recentWorkspaces: initial.recentWorkspaces as DesktopWorkspace[],
      projectAppearances: initial.projectAppearances as Record<string, ProjectAppearance>,
      lastActiveWorkspacePath: initial.lastActiveWorkspacePath,
      removedWorkspaces: initial.removedWorkspaces,
      drawerTab: initial.drawerTab as DrawerTab,
      selectedModelPreset: initial.selectedModelPreset as string,
      providerID: initial.providerID as ModelProviderID,
      providerBaseURL: initial.providerBaseURL,
      showContextUsage: initial.showContextUsage,
      defaultOpenTargetId: initial.defaultOpenTargetId,
      gitBranchPrefix: initial.gitBranchPrefix,
      gitPrMergeMethod: initial.gitPrMergeMethod as 'merge' | 'squash',
      gitShowPrIconsInSidebar: initial.gitShowPrIconsInSidebar,
      gitDraftPullRequest: initial.gitDraftPullRequest,
      gitAutoDeleteWorktree: initial.gitAutoDeleteWorktree,
      gitAutoDeleteWorktreeLimit: initial.gitAutoDeleteWorktreeLimit,
      allowForcePush: initial.allowForcePush,
      commitMessagePrompt: initial.commitMessagePrompt,
      pullRequestPrompt: initial.pullRequestPrompt,
      sandboxMode: initial.sandboxMode as DesktopSandboxMode,
      allowNetworkAccess: initial.allowNetworkAccess,
      installPidexDependencies: initial.installPidexDependencies,
      workspaceDependenciesMigrated: initial.workspaceDependenciesMigrated,
      firstUseSetupCompleted: initial.firstUseSetupCompleted as 0 | 1 | undefined,
      personality: initial.personality as DesktopPersonality,
      customInstructions: initial.customInstructions,
      enableMemory: initial.enableMemory,
      skipToolAidedChats: initial.skipToolAidedChats,
      defaultModeRequestUserInput: initial.defaultModeRequestUserInput,
      githubMemorySyncEnabled: initial.githubMemorySyncEnabled,
      githubMemoryRepository: initial.githubMemoryRepository,
      reviewView: initial.reviewView as DesktopReviewView,
      reviewDelivery: initial.reviewDelivery as DesktopReviewDelivery,
      conversationWidth: initial.conversationWidth as StoredDesktopSettings['conversationWidth'],
      diffMarkerStyle: initial.diffMarkerStyle as DesktopDiffMarkerStyle,
      rustSearchAndDiffKernels: initial.rustSearchAndDiffKernels,
      sidebarOrganization: initial.sidebarOrganization as DesktopSidebarOrganization,
      sidebarProductMode: initial.sidebarProductMode as SidebarProductMode,
      sidebarProjectSort: initial.sidebarProjectSort as DesktopSidebarSort,
      sidebarSort: initial.sidebarSort as DesktopSidebarSort,
      sidebarTimelineEnabled: (initial.sidebarTimelineEnabled ?? false) as boolean,
      sidebarTimelinePriorityEnabled: (initial.sidebarTimelinePriorityEnabled ?? true) as boolean,
      sidebarActivityShowWork: (initial.sidebarActivityShowWork ?? true) as boolean,
      sidebarActivityShowChat: (initial.sidebarActivityShowChat ?? true) as boolean,
      sidebarShowScheduledSessions: (initial.sidebarShowScheduledSessions ?? true) as boolean,
      sidebarActivityShowScheduled: (initial.sidebarActivityShowScheduled ?? false) as boolean,
      sidebarActivityShowPinned: (initial.sidebarActivityShowPinned ?? false) as boolean,
      sidebarActivityCoachmarkDismissed: (initial.sidebarActivityCoachmarkDismissed ??
        false) as boolean,
      sidebarManualOrder: initial.sidebarManualOrder as Record<string, string[]>,
      sidebarSessionPins: initial.sidebarSessionPins as Record<string, string>,
      collapsedSidebarProjectPaths: initial.collapsedSidebarProjectPaths as string[],
      sidebarSectionOrder: initial.sidebarSectionOrder as SidebarSectionId[],
      browserAllowedSites: initial.browserAllowedSites as string[],
      collapsedSidebarSections: initial.collapsedSidebarSections as SidebarSectionId[],
      browserSitePermissions: initial.browserSitePermissions as DesktopBrowserSitePermission[],
      sidebarCustomization: (initial.sidebarCustomization ??
        DEFAULT_SIDEBAR_CUSTOMIZATION) as SidebarCustomization,
      settingsLoaded: false,
      draftValues: cloneDesktopSettings(initial) as StoredDesktopSettings,
      committedDraftValues: initial as StoredDesktopSettings,
      draftSaving: false,
    })),
  )
  const [enableParetoCodeRouter, setEnableParetoCodeRouter] = useFieldState(
    stateStore,
    'enableParetoCodeRouter',
  )
  const [enableFusionRouter, setEnableFusionRouter] = useFieldState(
    stateStore,
    'enableFusionRouter',
  )
  const [enableAutoReviewPermissionMode, setEnableAutoReviewPermissionMode] = useFieldState(
    stateStore,
    'enableAutoReviewPermissionMode',
  )
  const [enableFullAccessPermissionMode, setEnableFullAccessPermissionMode] = useFieldState(
    stateStore,
    'enableFullAccessPermissionMode',
  )
  const [model, setModel] = useFieldState(stateStore, 'model')
  const [generationModel, setGenerationModel] = useFieldState(stateStore, 'generationModel')
  const [organizationModel, setOrganizationModel] = useFieldState(stateStore, 'organizationModel')
  const [codingModel, setCodingModel] = useFieldState(stateStore, 'codingModel')
  const [securityModel, setSecurityModel] = useFieldState(stateStore, 'securityModel')
  const [sessionName, setSessionName] = useFieldState(stateStore, 'sessionName')
  const [thinkingMode, setThinkingMode] = useFieldState(stateStore, 'thinkingMode')
  const [systemPrompt, setSystemPrompt] = useFieldState(stateStore, 'systemPrompt')
  const [appendSystemPrompt, setAppendSystemPrompt] = useFieldState(
    stateStore,
    'appendSystemPrompt',
  )
  const [additionalDirectories, setAdditionalDirectories] = useFieldState(
    stateStore,
    'additionalDirectories',
  )
  const [recentWorkspaces, setRecentWorkspaces] = useFieldState(stateStore, 'recentWorkspaces')
  const [projectAppearances, setProjectAppearances] = useFieldState(
    stateStore,
    'projectAppearances',
  )
  const [lastActiveWorkspacePath, setLastActiveWorkspacePath] = useFieldState(
    stateStore,
    'lastActiveWorkspacePath',
  )
  const [removedWorkspaces, setRemovedWorkspaces] = useFieldState(stateStore, 'removedWorkspaces')
  const [drawerTab, setDrawerTab] = useFieldState(stateStore, 'drawerTab')
  const [selectedModelPreset, setSelectedModelPreset] = useFieldState(
    stateStore,
    'selectedModelPreset',
  )
  const [providerID, setProviderID] = useFieldState(stateStore, 'providerID')
  const [providerBaseURL, setProviderBaseURL] = useFieldState(stateStore, 'providerBaseURL')
  const [showContextUsage, setShowContextUsage] = useFieldState(stateStore, 'showContextUsage')
  const [defaultOpenTargetId, setDefaultOpenTargetId] = useFieldState(
    stateStore,
    'defaultOpenTargetId',
  )
  const [gitBranchPrefix, setGitBranchPrefix] = useFieldState(stateStore, 'gitBranchPrefix')
  const [gitPrMergeMethod, setGitPrMergeMethod] = useFieldState(stateStore, 'gitPrMergeMethod')
  const [gitShowPrIconsInSidebar, setGitShowPrIconsInSidebar] = useFieldState(
    stateStore,
    'gitShowPrIconsInSidebar',
  )
  const [gitDraftPullRequest, setGitDraftPullRequest] = useFieldState(
    stateStore,
    'gitDraftPullRequest',
  )
  const [gitAutoDeleteWorktree, setGitAutoDeleteWorktree] = useFieldState(
    stateStore,
    'gitAutoDeleteWorktree',
  )
  const [gitAutoDeleteWorktreeLimit, setGitAutoDeleteWorktreeLimit] = useFieldState(
    stateStore,
    'gitAutoDeleteWorktreeLimit',
  )
  const [allowForcePush, setAllowForcePush] = useFieldState(stateStore, 'allowForcePush')
  const [commitMessagePrompt, setCommitMessagePrompt] = useFieldState(
    stateStore,
    'commitMessagePrompt',
  )
  const [pullRequestPrompt, setPullRequestPrompt] = useFieldState(stateStore, 'pullRequestPrompt')
  const [sandboxMode, setSandboxMode] = useFieldState(stateStore, 'sandboxMode')
  const [allowNetworkAccess, setAllowNetworkAccess] = useFieldState(
    stateStore,
    'allowNetworkAccess',
  )
  const [installPidexDependencies, setInstallPidexDependencies] = useFieldState(
    stateStore,
    'installPidexDependencies',
  )
  const [workspaceDependenciesMigrated, setWorkspaceDependenciesMigrated] = useFieldState(
    stateStore,
    'workspaceDependenciesMigrated',
  )
  const [firstUseSetupCompleted, setFirstUseSetupCompleted] = useFieldState(
    stateStore,
    'firstUseSetupCompleted',
  )
  const [personality, setPersonality] = useFieldState(stateStore, 'personality')
  const [customInstructions, setCustomInstructions] = useFieldState(
    stateStore,
    'customInstructions',
  )
  const [enableMemory, setEnableMemory] = useFieldState(stateStore, 'enableMemory')
  const [skipToolAidedChats, setSkipToolAidedChats] = useFieldState(
    stateStore,
    'skipToolAidedChats',
  )
  const [defaultModeRequestUserInput, setDefaultModeRequestUserInput] = useFieldState(
    stateStore,
    'defaultModeRequestUserInput',
  )
  const [githubMemorySyncEnabled, setGithubMemorySyncEnabled] = useFieldState(
    stateStore,
    'githubMemorySyncEnabled',
  )
  const [githubMemoryRepository, setGithubMemoryRepository] = useFieldState(
    stateStore,
    'githubMemoryRepository',
  )
  const [reviewView, setReviewView] = useFieldState(stateStore, 'reviewView')
  const [reviewDelivery, setReviewDelivery] = useFieldState(stateStore, 'reviewDelivery')
  const [conversationWidth, setConversationWidth] = useFieldState(stateStore, 'conversationWidth')
  const [diffMarkerStyle, setDiffMarkerStyle] = useFieldState(stateStore, 'diffMarkerStyle')
  const [rustSearchAndDiffKernels, setRustSearchAndDiffKernels] = useFieldState(
    stateStore,
    'rustSearchAndDiffKernels',
  )
  const [sidebarOrganization, setSidebarOrganization] = useFieldState(
    stateStore,
    'sidebarOrganization',
  )
  const [sidebarProductMode, setSidebarProductMode] = useFieldState(
    stateStore,
    'sidebarProductMode',
  )
  const [sidebarProjectSort, setSidebarProjectSort] = useFieldState(
    stateStore,
    'sidebarProjectSort',
  )
  const [sidebarSort, setSidebarSort] = useFieldState(stateStore, 'sidebarSort')
  const [sidebarTimelineEnabled, setSidebarTimelineEnabled] = useFieldState(
    stateStore,
    'sidebarTimelineEnabled',
  )
  const [sidebarTimelinePriorityEnabled, setSidebarTimelinePriorityEnabled] = useFieldState(
    stateStore,
    'sidebarTimelinePriorityEnabled',
  )
  const [sidebarActivityShowWork, setSidebarActivityShowWork] = useFieldState(
    stateStore,
    'sidebarActivityShowWork',
  )
  const [sidebarActivityShowChat, setSidebarActivityShowChat] = useFieldState(
    stateStore,
    'sidebarActivityShowChat',
  )
  const [sidebarShowScheduledSessions, setSidebarShowScheduledSessions] = useFieldState(
    stateStore,
    'sidebarShowScheduledSessions',
  )
  const [sidebarActivityShowScheduled, setSidebarActivityShowScheduled] = useFieldState(
    stateStore,
    'sidebarActivityShowScheduled',
  )
  const [sidebarActivityShowPinned, setSidebarActivityShowPinned] = useFieldState(
    stateStore,
    'sidebarActivityShowPinned',
  )
  const [sidebarActivityCoachmarkDismissed, setSidebarActivityCoachmarkDismissed] = useFieldState(
    stateStore,
    'sidebarActivityCoachmarkDismissed',
  )
  const [sidebarManualOrder, setSidebarManualOrder] = useFieldState(
    stateStore,
    'sidebarManualOrder',
  )
  const [sidebarSessionPins, setSidebarSessionPins] = useFieldState(
    stateStore,
    'sidebarSessionPins',
  )
  const [collapsedSidebarProjectPaths, setCollapsedSidebarProjectPaths] = useFieldState(
    stateStore,
    'collapsedSidebarProjectPaths',
  )
  const [sidebarSectionOrder, setSidebarSectionOrder] = useFieldState(
    stateStore,
    'sidebarSectionOrder',
  )
  const [browserAllowedSites, setBrowserAllowedSites] = useFieldState(
    stateStore,
    'browserAllowedSites',
  )
  const [collapsedSidebarSections, setCollapsedSidebarSections] = useFieldState(
    stateStore,
    'collapsedSidebarSections',
  )
  const [browserSitePermissions, setBrowserSitePermissions] = useFieldState(
    stateStore,
    'browserSitePermissions',
  )
  const [sidebarCustomization, setSidebarCustomization] = useFieldState(
    stateStore,
    'sidebarCustomization',
  )
  const [settingsLoaded, setSettingsLoaded] = useFieldState(stateStore, 'settingsLoaded')
  const skipNextAutoSaveRef = useRef(false)
  const initialLoadRef = useRef(true)
  const [draftValues, setDraftValuesState] = useFieldState(stateStore, 'draftValues')
  const setDraftValues = useCallback(
    (
      update: StoredDesktopSettings | ((current: StoredDesktopSettings) => StoredDesktopSettings),
    ) => {
      setDraftValuesState((current) =>
        shareDesktopSettingsValues(
          current,
          typeof update === 'function' ? update(current) : update,
        ),
      )
    },
    [setDraftValuesState],
  )
  const [committedDraftValues, setCommittedDraftValues] = useFieldState(
    stateStore,
    'committedDraftValues',
  )
  const draftValuesRef = useRef(draftValues)
  draftValuesRef.current = draftValues
  const permissionMode = permissionModeForConfig(committedDraftValues.permissionConfig)
  const setPermissionMode = useCallback((value: DesktopPermissionMode) => {
    setCommittedDraftValues((current) => ({
      ...current,
      permissionConfig: permissionConfigForMode(value, current.permissionConfig),
    }))
  }, [])
  const draftDirtyKeysRef = useRef<Set<keyof StoredDesktopSettings>>(new Set())
  const [draftSaving, setDraftSaving] = useFieldState(stateStore, 'draftSaving')

  useEffect(() => {
    let mounted = true
    void desktopClient
      .getDesktopSettings()
      .then(async (loadedSettings) => {
        if (!mounted) return
        const settings =
          loadedSettings.sidebarStateVersion < SIDEBAR_STATE_VERSION
            ? {
                ...loadedSettings,
                sidebarStateVersion: SIDEBAR_STATE_VERSION,
                sidebarCustomization:
                  loadedSettings.sidebarCustomization ?? DEFAULT_SIDEBAR_CUSTOMIZATION,
              }
            : loadedSettings
        if (loadedSettings.sidebarStateVersion < SIDEBAR_STATE_VERSION) {
          if (access === 'read-write') {
            try {
              await desktopClient.saveDesktopSettings(settings)
            } catch {
              // Best-effort migration; an unchanged old version retries next load.
            }
          }
          if (!mounted) return
        }
        setEnableParetoCodeRouter(settings.enableParetoCodeRouter ?? false)
        setEnableFusionRouter(settings.enableFusionRouter ?? false)
        setEnableAutoReviewPermissionMode(settings.enableAutoReviewPermissionMode ?? false)
        setEnableFullAccessPermissionMode(settings.enableFullAccessPermissionMode ?? false)
        setModel(settings.model)
        setGenerationModel(settings.generationModel)
        setOrganizationModel(settings.organizationModel)
        setCodingModel(settings.codingModel)
        setSecurityModel(settings.securityModel)
        setSessionName(settings.sessionName)
        setThinkingMode(settings.thinkingMode)
        setSystemPrompt(settings.systemPrompt)
        setAppendSystemPrompt(settings.appendSystemPrompt)
        setAdditionalDirectories(settings.additionalDirectories)
        setRecentWorkspaces(settings.recentWorkspaces)
        setProjectAppearances(settings.projectAppearances)
        setLastActiveWorkspacePath(settings.lastActiveWorkspacePath)
        setRemovedWorkspaces(settings.removedWorkspaces)
        setDrawerTab(settings.drawerTab)
        setSelectedModelPreset(settings.selectedModelPreset)
        setProviderID(settings.providerID)
        setProviderBaseURL(settings.providerBaseURL)
        setShowContextUsage(settings.showContextUsage)
        setDefaultOpenTargetId(settings.defaultOpenTargetId)
        setGitBranchPrefix(settings.gitBranchPrefix)
        setGitPrMergeMethod(settings.gitPrMergeMethod)
        setGitShowPrIconsInSidebar(settings.gitShowPrIconsInSidebar)
        setGitDraftPullRequest(settings.gitDraftPullRequest)
        setGitAutoDeleteWorktree(settings.gitAutoDeleteWorktree)
        setGitAutoDeleteWorktreeLimit(settings.gitAutoDeleteWorktreeLimit)
        setAllowForcePush(settings.allowForcePush)
        setCommitMessagePrompt(settings.commitMessagePrompt)
        setPullRequestPrompt(settings.pullRequestPrompt)
        setSandboxMode(settings.sandboxMode)
        setAllowNetworkAccess(settings.allowNetworkAccess)
        setInstallPidexDependencies(settings.installPidexDependencies)
        setWorkspaceDependenciesMigrated(settings.workspaceDependenciesMigrated)
        setFirstUseSetupCompleted(settings.firstUseSetupCompleted)
        setPersonality(settings.personality)
        setCustomInstructions(settings.customInstructions)
        setEnableMemory(settings.enableMemory)
        setSkipToolAidedChats(settings.skipToolAidedChats)
        setDefaultModeRequestUserInput(settings.defaultModeRequestUserInput)
        setGithubMemorySyncEnabled(settings.githubMemorySyncEnabled)
        setGithubMemoryRepository(settings.githubMemoryRepository)
        setReviewView(settings.reviewView)
        setReviewDelivery(settings.reviewDelivery)
        setConversationWidth(settings.conversationWidth)
        setDiffMarkerStyle(settings.diffMarkerStyle)
        setRustSearchAndDiffKernels(settings.rustSearchAndDiffKernels)
        setSidebarOrganization(settings.sidebarOrganization)
        setSidebarProductMode(settings.sidebarProductMode)
        setSidebarProjectSort(settings.sidebarProjectSort)
        setSidebarSort(settings.sidebarSort)
        setSidebarTimelineEnabled(settings.sidebarTimelineEnabled)
        setSidebarTimelinePriorityEnabled(settings.sidebarTimelinePriorityEnabled)
        setSidebarActivityShowWork(settings.sidebarActivityShowWork ?? true)
        setSidebarActivityShowChat(settings.sidebarActivityShowChat ?? true)
        setSidebarShowScheduledSessions(settings.sidebarShowScheduledSessions ?? true)
        setSidebarActivityShowScheduled(settings.sidebarActivityShowScheduled ?? false)
        setSidebarActivityShowPinned(settings.sidebarActivityShowPinned ?? false)
        setSidebarActivityCoachmarkDismissed(settings.sidebarActivityCoachmarkDismissed ?? false)
        setSidebarManualOrder(settings.sidebarManualOrder)
        setSidebarSessionPins(settings.sidebarSessionPins)
        setCollapsedSidebarProjectPaths(settings.collapsedSidebarProjectPaths)
        setSidebarSectionOrder(settings.sidebarSectionOrder)
        setBrowserAllowedSites(settings.browserAllowedSites)
        setCollapsedSidebarSections(settings.collapsedSidebarSections)
        setBrowserSitePermissions(settings.browserSitePermissions)
        setSidebarCustomization(settings.sidebarCustomization ?? DEFAULT_SIDEBAR_CUSTOMIZATION)
        setCommittedDraftValues(settings)
        setDraftValues(cloneDesktopSettings(settings))
        draftDirtyKeysRef.current.clear()
        setSettingsLoaded(true)
      })
      .catch(() => {
        if (mounted) {
          setSettingsLoaded(true)
        }
      })
    return () => {
      mounted = false
    }
  }, [access])

  const effectiveSettings = useMemo<StoredDesktopSettings>(
    () => ({
      gitBoardState: committedDraftValues.gitBoardState ?? null,
      language: committedDraftValues.language,
      sidebarLayout: committedDraftValues.sidebarLayout,
      worktreeRoot: committedDraftValues.worktreeRoot,
      worktreeFetchUpstream: committedDraftValues.worktreeFetchUpstream,
      prWatchAutoMerge: committedDraftValues.prWatchAutoMerge,
      prWatchInstructions: committedDraftValues.prWatchInstructions,
      enableParetoCodeRouter,
      enableFusionRouter,
      enableAutoReviewPermissionMode,
      enableFullAccessPermissionMode,
      permissionConfig: committedDraftValues.permissionConfig,
      shellSecurityLevel: committedDraftValues.shellSecurityLevel,
      terminalProfileId: committedDraftValues.terminalProfileId,
      model,
      generationModel,
      organizationModel,
      codingModel,
      securityModel,
      sessionName,
      thinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
      recentWorkspaces,
      projectAppearances,
      lastActiveWorkspacePath,
      removedWorkspaces,
      drawerTab,
      selectedModelPreset,
      providerID,
      providerBaseURL,
      showContextUsage,
      defaultOpenTargetId,
      gitBranchPrefix,
      gitPrMergeMethod,
      gitShowPrIconsInSidebar,
      gitDraftPullRequest,
      gitAutoDeleteWorktree,
      gitAutoDeleteWorktreeLimit,
      allowForcePush,
      commitMessagePrompt,
      pullRequestPrompt,
      sandboxMode,
      allowNetworkAccess,
      installPidexDependencies,
      workspaceDependenciesMigrated,
      ...(firstUseSetupCompleted === undefined ? {} : { firstUseSetupCompleted }),
      'desktop.voice.preferredInputDeviceId':
        committedDraftValues['desktop.voice.preferredInputDeviceId'],
      personality,
      customInstructions,
      enableMemory,
      skipToolAidedChats,
      defaultModeRequestUserInput,
      githubMemorySyncEnabled,
      githubMemoryRepository,
      reviewView,
      reviewDelivery,
      conversationWidth,
      diffMarkerStyle,
      sidebarOrganization,
      sidebarProductMode,
      sidebarStateVersion: SIDEBAR_STATE_VERSION,
      sidebarProjectSort,
      sidebarSort,
      sidebarTimelineEnabled,
      sidebarTimelinePriorityEnabled,
      sidebarActivityShowWork,
      sidebarActivityShowChat,
      sidebarShowScheduledSessions,
      sidebarActivityShowScheduled,
      sidebarActivityShowPinned,
      sidebarActivityCoachmarkDismissed,
      sidebarManualOrder,
      sidebarSessionPins,
      collapsedSidebarProjectPaths,
      sidebarSectionOrder,
      rustSearchAndDiffKernels,
      browserAllowedSites,
      collapsedSidebarSections,
      browserSitePermissions,
      sidebarCustomization,
      pet: committedDraftValues.pet,
      notifications: committedDraftValues.notifications,
    }),
    [
      committedDraftValues.gitBoardState,
      committedDraftValues.language,
      committedDraftValues.sidebarLayout,
      committedDraftValues.worktreeRoot,
      committedDraftValues.worktreeFetchUpstream,
      committedDraftValues.prWatchAutoMerge,
      committedDraftValues.prWatchInstructions,
      enableParetoCodeRouter,
      enableFusionRouter,
      enableAutoReviewPermissionMode,
      enableFullAccessPermissionMode,
      committedDraftValues.permissionConfig,
      committedDraftValues.shellSecurityLevel,
      committedDraftValues.terminalProfileId,
      model,
      generationModel,
      organizationModel,
      codingModel,
      securityModel,
      sessionName,
      thinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
      recentWorkspaces,
      projectAppearances,
      lastActiveWorkspacePath,
      removedWorkspaces,
      drawerTab,
      selectedModelPreset,
      providerID,
      providerBaseURL,
      showContextUsage,
      defaultOpenTargetId,
      gitBranchPrefix,
      gitPrMergeMethod,
      gitShowPrIconsInSidebar,
      gitDraftPullRequest,
      gitAutoDeleteWorktree,
      gitAutoDeleteWorktreeLimit,
      allowForcePush,
      commitMessagePrompt,
      pullRequestPrompt,
      sandboxMode,
      allowNetworkAccess,
      installPidexDependencies,
      workspaceDependenciesMigrated,
      firstUseSetupCompleted,
      committedDraftValues['desktop.voice.preferredInputDeviceId'],
      personality,
      customInstructions,
      enableMemory,
      skipToolAidedChats,
      defaultModeRequestUserInput,
      githubMemorySyncEnabled,
      githubMemoryRepository,
      reviewView,
      reviewDelivery,
      conversationWidth,
      diffMarkerStyle,
      sidebarOrganization,
      sidebarProductMode,
      sidebarProjectSort,
      sidebarSort,
      sidebarTimelineEnabled,
      sidebarTimelinePriorityEnabled,
      sidebarActivityShowWork,
      sidebarActivityShowChat,
      sidebarShowScheduledSessions,
      sidebarActivityShowScheduled,
      sidebarActivityShowPinned,
      sidebarActivityCoachmarkDismissed,
      sidebarManualOrder,
      sidebarSessionPins,
      collapsedSidebarProjectPaths,
      sidebarSectionOrder,
      rustSearchAndDiffKernels,
      browserAllowedSites,
      collapsedSidebarSections,
      browserSitePermissions,
      sidebarCustomization,
      committedDraftValues.pet,
      committedDraftValues.notifications,
    ],
  )
  const effectiveSettingsRef = useRef(effectiveSettings)
  effectiveSettingsRef.current = effectiveSettings

  const draftDirty = draftDirtyKeysRef.current.size > 0

  useEffect(() => {
    if (!settingsLoaded) return
    // 初始加载的设置是 canonical snapshot，不回写
    if (initialLoadRef.current) {
      initialLoadRef.current = false
      return
    }
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false
      return
    }
    if (access !== 'read-write') return
    storeDesktopSettings(effectiveSettings)
  }, [effectiveSettings, settingsLoaded, access])

  useEffect(() => {
    if (!settingsLoaded || draftDirty) return
    setDraftValues(cloneDesktopSettings(effectiveSettings))
    draftDirtyKeysRef.current.clear()
  }, [draftDirty, effectiveSettings, settingsLoaded])

  const flushDesktopSettings = useCallback(async (): Promise<void> => {
    if (access !== 'read-write') return
    try {
      await desktopClient.saveDesktopSettings(effectiveSettings)
    } catch {
      // Persistence is best-effort; the next state change will retry.
    }
  }, [effectiveSettings, access])

  const setDraftValue = useCallback<DesktopSettingsDraftSetter>((key, value) => {
    const next = updateDesktopSettingsValue(draftValuesRef.current, key, value)
    if (desktopSettingsValueEqual(next[key], effectiveSettingsRef.current[key])) {
      draftDirtyKeysRef.current.delete(key)
    } else {
      draftDirtyKeysRef.current.add(key)
    }
    draftValuesRef.current = next
    setDraftValues(next)
  }, [])

  const applySettingsSnapshot = useCallback((snapshot: StoredDesktopSettings): void => {
    snapshot = shareDesktopSettingsValues(effectiveSettingsRef.current, snapshot)
    setEnableParetoCodeRouter(snapshot.enableParetoCodeRouter ?? false)
    setEnableFusionRouter(snapshot.enableFusionRouter ?? false)
    setEnableAutoReviewPermissionMode(snapshot.enableAutoReviewPermissionMode ?? false)
    setEnableFullAccessPermissionMode(snapshot.enableFullAccessPermissionMode ?? false)
    setModel(snapshot.model)
    setGenerationModel(snapshot.generationModel)
    setOrganizationModel(snapshot.organizationModel)
    setCodingModel(snapshot.codingModel)
    setSecurityModel(snapshot.securityModel)
    setSessionName(snapshot.sessionName)
    setThinkingMode(snapshot.thinkingMode)
    setSystemPrompt(snapshot.systemPrompt)
    setAppendSystemPrompt(snapshot.appendSystemPrompt)
    setAdditionalDirectories(snapshot.additionalDirectories)
    setRecentWorkspaces(snapshot.recentWorkspaces)
    setProjectAppearances(snapshot.projectAppearances)
    setLastActiveWorkspacePath(snapshot.lastActiveWorkspacePath)
    setRemovedWorkspaces(snapshot.removedWorkspaces)
    setDrawerTab(snapshot.drawerTab)
    setSelectedModelPreset(snapshot.selectedModelPreset)
    setProviderID(snapshot.providerID)
    setProviderBaseURL(snapshot.providerBaseURL)
    setShowContextUsage(snapshot.showContextUsage)
    setDefaultOpenTargetId(snapshot.defaultOpenTargetId)
    setGitBranchPrefix(snapshot.gitBranchPrefix)
    setGitPrMergeMethod(snapshot.gitPrMergeMethod)
    setGitShowPrIconsInSidebar(snapshot.gitShowPrIconsInSidebar)
    setGitDraftPullRequest(snapshot.gitDraftPullRequest)
    setGitAutoDeleteWorktree(snapshot.gitAutoDeleteWorktree)
    setGitAutoDeleteWorktreeLimit(snapshot.gitAutoDeleteWorktreeLimit)
    setAllowForcePush(snapshot.allowForcePush)
    setCommitMessagePrompt(snapshot.commitMessagePrompt)
    setPullRequestPrompt(snapshot.pullRequestPrompt)
    setSandboxMode(snapshot.sandboxMode)
    setAllowNetworkAccess(snapshot.allowNetworkAccess)
    setInstallPidexDependencies(snapshot.installPidexDependencies)
    setWorkspaceDependenciesMigrated(snapshot.workspaceDependenciesMigrated)
    setFirstUseSetupCompleted(snapshot.firstUseSetupCompleted)
    setPersonality(snapshot.personality)
    setCustomInstructions(snapshot.customInstructions)
    setEnableMemory(snapshot.enableMemory)
    setSkipToolAidedChats(snapshot.skipToolAidedChats)
    setDefaultModeRequestUserInput(snapshot.defaultModeRequestUserInput)
    setGithubMemorySyncEnabled(snapshot.githubMemorySyncEnabled)
    setGithubMemoryRepository(snapshot.githubMemoryRepository)
    setReviewView(snapshot.reviewView)
    setReviewDelivery(snapshot.reviewDelivery)
    setConversationWidth(snapshot.conversationWidth)
    setDiffMarkerStyle(snapshot.diffMarkerStyle)
    setSidebarOrganization(snapshot.sidebarOrganization)
    setSidebarProductMode(snapshot.sidebarProductMode)
    setSidebarProjectSort(snapshot.sidebarProjectSort)
    setSidebarSort(snapshot.sidebarSort)
    setSidebarTimelineEnabled(snapshot.sidebarTimelineEnabled)
    setSidebarTimelinePriorityEnabled(snapshot.sidebarTimelinePriorityEnabled)
    setSidebarActivityShowWork(snapshot.sidebarActivityShowWork ?? true)
    setSidebarActivityShowChat(snapshot.sidebarActivityShowChat ?? true)
    setSidebarShowScheduledSessions(snapshot.sidebarShowScheduledSessions ?? true)
    setSidebarActivityShowScheduled(snapshot.sidebarActivityShowScheduled ?? false)
    setSidebarActivityShowPinned(snapshot.sidebarActivityShowPinned ?? false)
    setSidebarActivityCoachmarkDismissed(snapshot.sidebarActivityCoachmarkDismissed ?? false)
    setSidebarManualOrder(snapshot.sidebarManualOrder)
    setSidebarSessionPins(snapshot.sidebarSessionPins)
    setCollapsedSidebarProjectPaths(snapshot.collapsedSidebarProjectPaths)
    setSidebarSectionOrder(snapshot.sidebarSectionOrder)
    setRustSearchAndDiffKernels(snapshot.rustSearchAndDiffKernels)
    setBrowserAllowedSites(snapshot.browserAllowedSites)
    setCollapsedSidebarSections(snapshot.collapsedSidebarSections)
    setBrowserSitePermissions(snapshot.browserSitePermissions)
    setSidebarCustomization(snapshot.sidebarCustomization ?? DEFAULT_SIDEBAR_CUSTOMIZATION)
    setCommittedDraftValues(snapshot)
  }, [])

  const syncExternalSettingsPatch = useCallback(
    (patch: Partial<StoredDesktopSettings>): void => {
      const next = mergeExternalDesktopSettingsPatch(
        effectiveSettingsRef.current,
        draftValuesRef.current,
        patch,
        draftDirtyKeysRef.current,
      )
      if (!next.settingsChanged && !next.draftChanged) {
        return
      }
      if (next.settingsChanged) {
        skipNextAutoSaveRef.current = true
        applySettingsSnapshot(next.settings)
      }
      if (next.draftChanged) {
        setDraftValues(next.draftValues)
      }
    },
    [applySettingsSnapshot],
  )

  const saveFirstUseSetupCompleted = useCallback(
    async (value: 0 | 1): Promise<void> => {
      // 先读取 Agent 当前投影，避免向导完成期间用旧的 Renderer snapshot
      // 覆盖刚由模型向导写入的 Provider 与最近模型选择。
      const current = await desktopClient.getDesktopSettings()
      const saved = await desktopClient.saveDesktopSettings({
        ...current,
        firstUseSetupCompleted: value,
      })
      syncExternalSettingsPatch(saved)
    },
    [syncExternalSettingsPatch],
  )

  useEffect(() => {
    return desktopClient.onDesktopSettingsChange((change) => {
      syncExternalSettingsPatch(change.settings)
    })
  }, [syncExternalSettingsPatch])

  useEffect(() => {
    const refresh = () => {
      void desktopClient
        .getDesktopSettings()
        .then(syncExternalSettingsPatch)
        .catch(() => undefined)
    }
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(CONFIG_UPDATED_EVENT, refresh)
  }, [syncExternalSettingsPatch])

  const saveDraft = useCallback(async (): Promise<StoredDesktopSettings> => {
    if (access !== 'read-write') {
      throw new Error('此窗口不允许保存桌面设置')
    }
    const snapshot = mergeDesktopSettingsDraft(
      effectiveSettingsRef.current,
      draftValuesRef.current,
      draftDirtyKeysRef.current,
    )
    setDraftSaving(true)
    try {
      const saved = await desktopClient.saveDesktopSettings(snapshot)
      const next = cloneDesktopSettings(saved)
      skipNextAutoSaveRef.current = true
      applySettingsSnapshot(next)
      setDraftValues(next)
      draftDirtyKeysRef.current.clear()
      return next
    } finally {
      setDraftSaving(false)
    }
  }, [applySettingsSnapshot, access])

  const resetDraft = useCallback((): void => {
    setDraftValues(cloneDesktopSettings(effectiveSettingsRef.current))
    draftDirtyKeysRef.current.clear()
  }, [])

  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft

  const fieldSaveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const saveFields = useCallback(
    (keys: readonly (keyof StoredDesktopSettings)[]) => {
      if (access !== 'read-write') return Promise.reject(new Error('此窗口不允许保存桌面设置'))
      const values = cloneDesktopSettings(draftValuesRef.current)
      const pending = fieldSaveQueue.current
        .catch(() => undefined)
        .then(async () => {
          const current = await desktopClient.getDesktopSettings()
          const saved = await desktopClient.saveDesktopSettings(
            mergeDesktopSettingsDraft(current, values, new Set(keys)),
          )
          for (const key of keys) {
            if (desktopSettingsValueEqual(draftValuesRef.current[key], values[key]))
              draftDirtyKeysRef.current.delete(key)
          }
          syncExternalSettingsPatch(saved)
          return saved
        })
      fieldSaveQueue.current = pending
      return pending
    },
    [syncExternalSettingsPatch, access],
  )

  const autoSave = useCallback(() => {
    setTimeout(() => {
      void saveDraftRef.current()
    }, 0)
  }, [])

  /** 草稿动作与页面状态分离：identity 稳定，消费者可按键订阅而无需整份 draft。 */
  const draftActions = useMemo<DesktopSettingsDraftActions>(
    () => ({
      setValue: setDraftValue,
      save: saveDraft,
      saveFields,
      reset: resetDraft,
      autoSave,
    }),
    [setDraftValue, saveDraft, saveFields, resetDraft, autoSave],
  )

  const draft = useMemo<DesktopSettingsDraft>(
    () => ({
      values: draftValues,
      dirty: draftDirty,
      saving: draftSaving,
      setValue: setDraftValue,
      save: saveDraft,
      saveFields,
      reset: resetDraft,
      autoSave,
    }),
    [
      draftDirty,
      draftSaving,
      draftValues,
      resetDraft,
      saveDraft,
      saveFields,
      setDraftValue,
      autoSave,
    ],
  )

  const runtime = useMemo<UseDesktopRuntimeSettingsResult>(
    () => ({
      values: effectiveSettings,
      permissionMode,
      settingsLoaded,
      setPermissionMode,
      setModel,
      setProviderBaseURL,
      setProviderID,
      setThinkingMode,
      setRecentWorkspaces,
      setDrawerTab,
      setSelectedModelPreset,
      setReviewView,
      setSidebarSessionPins,
      setSidebarTimelineEnabled,
      setSidebarProductMode,
      setSidebarCustomization,
      syncExternalSettingsPatch,
    }),
    [
      effectiveSettings,
      permissionMode,
      settingsLoaded,
      setPermissionMode,
      setSidebarProductMode,
      setSidebarCustomization,
      syncExternalSettingsPatch,
    ],
  )

  const settings: UseDesktopSettingsResult = {
    enableParetoCodeRouter,
    enableFusionRouter,
    enableAutoReviewPermissionMode,
    enableFullAccessPermissionMode,
    permissionMode,
    model,
    generationModel,
    organizationModel,
    codingModel,
    securityModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    recentWorkspaces,
    projectAppearances,
    drawerTab,
    selectedModelPreset,
    providerID,
    providerBaseURL,
    showContextUsage,
    defaultOpenTargetId,
    gitBranchPrefix,
    gitPrMergeMethod,
    gitShowPrIconsInSidebar,
    gitDraftPullRequest,
    gitAutoDeleteWorktree,
    gitAutoDeleteWorktreeLimit,
    allowForcePush,
    commitMessagePrompt,
    pullRequestPrompt,
    sandboxMode,
    allowNetworkAccess,
    installPidexDependencies,
    workspaceDependenciesMigrated,
    firstUseSetupCompleted,
    personality,
    customInstructions,
    enableMemory,
    skipToolAidedChats,
    githubMemorySyncEnabled,
    githubMemoryRepository,
    reviewView,
    reviewDelivery,
    conversationWidth,
    diffMarkerStyle,
    sidebarOrganization,
    sidebarProductMode,
    sidebarProjectSort,
    sidebarSort,
    sidebarTimelineEnabled,
    sidebarTimelinePriorityEnabled,
    sidebarActivityShowWork,
    sidebarActivityShowChat,
    sidebarShowScheduledSessions,
    sidebarActivityShowScheduled,
    sidebarActivityShowPinned,
    sidebarActivityCoachmarkDismissed,
    sidebarManualOrder,
    sidebarSessionPins,
    collapsedSidebarProjectPaths,
    sidebarSectionOrder,
    rustSearchAndDiffKernels,
    browserAllowedSites,
    collapsedSidebarSections,
    browserSitePermissions,
    settingsLoaded,
    setPermissionMode,
    setEnableAutoReviewPermissionMode,
    setEnableFullAccessPermissionMode,
    setModel,
    setGenerationModel,
    setOrganizationModel,
    setCodingModel,
    setSecurityModel,
    setSessionName,
    setThinkingMode,
    setSystemPrompt,
    setAppendSystemPrompt,
    setAdditionalDirectories,
    setRecentWorkspaces,
    setProjectAppearances,
    setDrawerTab,
    setSelectedModelPreset,
    setProviderID,
    setProviderBaseURL,
    setShowContextUsage,
    setDefaultOpenTargetId,
    setGitBranchPrefix,
    setGitPrMergeMethod,
    setGitShowPrIconsInSidebar,
    setGitDraftPullRequest,
    setGitAutoDeleteWorktree,
    setGitAutoDeleteWorktreeLimit,
    setAllowForcePush,
    setCommitMessagePrompt,
    setPullRequestPrompt,
    setSandboxMode,
    setAllowNetworkAccess,
    setInstallPidexDependencies,
    setPersonality,
    setCustomInstructions,
    setEnableMemory,
    setSkipToolAidedChats,
    setGithubMemorySyncEnabled,
    setGithubMemoryRepository,
    setReviewView,
    setReviewDelivery,
    setDiffMarkerStyle,
    setSidebarOrganization,
    setSidebarProductMode,
    setSidebarProjectSort,
    setSidebarSort,
    setSidebarTimelineEnabled,
    setSidebarTimelinePriorityEnabled,
    setSidebarActivityShowWork,
    setSidebarActivityShowChat,
    setSidebarShowScheduledSessions,
    setSidebarActivityShowScheduled,
    setSidebarActivityShowPinned,
    setSidebarActivityCoachmarkDismissed,
    setSidebarManualOrder,
    setSidebarSessionPins,
    setCollapsedSidebarProjectPaths,
    setSidebarSectionOrder,
    setRustSearchAndDiffKernels,
    setBrowserAllowedSites,
    setCollapsedSidebarSections,
    sidebarCustomization,
    setSidebarCustomization,
    syncExternalSettingsPatch,
    saveFirstUseSetupCompleted,
    draft,
    draftActions,
    flushDesktopSettings,
  }
  return { settings, runtime }
}

function cloneDesktopSettings(settings: StoredDesktopSettings): StoredDesktopSettings {
  return {
    ...settings,
    recentWorkspaces: settings.recentWorkspaces.map((workspace) => ({
      ...workspace,
    })),
    projectAppearances: Object.fromEntries(
      Object.entries(settings.projectAppearances).map(([projectId, appearance]) => [
        projectId,
        { ...appearance },
      ]),
    ),
    removedWorkspaces: settings.removedWorkspaces.map((workspace) => ({
      ...workspace,
    })),
    sidebarManualOrder: Object.fromEntries(
      Object.entries(settings.sidebarManualOrder).map(([scopeKey, sessionIds]) => [
        scopeKey,
        [...sessionIds],
      ]),
    ),
    sidebarSessionPins: { ...settings.sidebarSessionPins },
    collapsedSidebarProjectPaths: [...settings.collapsedSidebarProjectPaths],
    sidebarSectionOrder: [...settings.sidebarSectionOrder],
    browserAllowedSites: [...settings.browserAllowedSites],
    collapsedSidebarSections: [...settings.collapsedSidebarSections],
    browserSitePermissions: settings.browserSitePermissions.map((permission) => ({
      ...permission,
    })),
    sidebarCustomization: settings.sidebarCustomization
      ? {
          ...settings.sidebarCustomization,
          sections: settings.sidebarCustomization.sections.map((s) => ({
            ...s,
            itemKeys: [...s.itemKeys],
          })),
          sectionOrder: [...settings.sidebarCustomization.sectionOrder],
          destinationOrder: [...settings.sidebarCustomization.destinationOrder],
          hiddenDestinationIds: [...settings.sidebarCustomization.hiddenDestinationIds],
        }
      : DEFAULT_SIDEBAR_CUSTOMIZATION,
    pet: { ...settings.pet },
  }
}

function updateDesktopSettingsValue<Key extends keyof StoredDesktopSettings>(
  current: StoredDesktopSettings,
  key: Key,
  value:
    | StoredDesktopSettings[Key]
    | ((currentValue: StoredDesktopSettings[Key]) => StoredDesktopSettings[Key]),
): StoredDesktopSettings {
  const currentValue = current[key]
  const nextValue =
    typeof value === 'function'
      ? (value as (currentValue: StoredDesktopSettings[Key]) => StoredDesktopSettings[Key])(
          currentValue,
        )
      : value
  return {
    ...current,
    [key]: cloneDesktopSettingsValue(nextValue),
  } as StoredDesktopSettings
}

/** 全量回读保留未变化字段的引用，避免无关设置触发字段订阅。 */
function shareDesktopSettingsValues(
  current: StoredDesktopSettings,
  next: StoredDesktopSettings,
): StoredDesktopSettings {
  const shared = { ...next }
  for (const key of Object.keys(next) as (keyof StoredDesktopSettings)[]) {
    if (desktopSettingsValueEqual(current[key], next[key])) {
      ;(shared as Record<keyof StoredDesktopSettings, unknown>)[key] = current[key]
    }
  }
  return desktopSettingsEqual(current, shared) ? current : shared
}

function desktopSettingsValueEqual(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right)
}

export function mergeExternalDesktopSettingsPatch(
  currentSettings: StoredDesktopSettings,
  currentDraftValues: StoredDesktopSettings,
  patch: Partial<StoredDesktopSettings>,
  dirtyKeys: ReadonlySet<keyof StoredDesktopSettings> = new Set(),
): {
  settings: StoredDesktopSettings
  draftValues: StoredDesktopSettings
  settingsChanged: boolean
  draftChanged: boolean
} {
  const settings = cloneDesktopSettings({
    ...currentSettings,
    ...patch,
  })
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => !dirtyKeys.has(key as keyof StoredDesktopSettings)),
  )
  const draftValues = cloneDesktopSettings({
    ...currentDraftValues,
    ...cleanPatch,
  })
  return {
    settings,
    draftValues,
    settingsChanged: !desktopSettingsEqual(settings, currentSettings),
    draftChanged: !desktopSettingsEqual(draftValues, currentDraftValues),
  }
}

function mergeDesktopSettingsDraft(
  baseValues: StoredDesktopSettings,
  draftValues: StoredDesktopSettings,
  dirtyKeys: ReadonlySet<keyof StoredDesktopSettings>,
): StoredDesktopSettings {
  const next = cloneDesktopSettings(baseValues)
  for (const key of dirtyKeys) {
    ;(next as Record<keyof StoredDesktopSettings, unknown>)[key] = cloneDesktopSettingsValue(
      draftValues[key],
    )
  }
  return next
}

function cloneDesktopSettingsValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === 'object' ? { ...item } : item))
  }
  return value
}

function desktopSettingsEqual(left: StoredDesktopSettings, right: StoredDesktopSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
