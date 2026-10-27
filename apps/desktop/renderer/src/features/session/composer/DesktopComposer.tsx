import { desktopClient } from '../../../services/desktop-client/index.js'
import { useEffect } from 'react'
import type React from 'react'
import type {
  DesktopComposerAttachment,
  DesktopContextUsage,
  DesktopModelMetadata,
  DesktopModelProviderSummary,
  DesktopPermissionMode,
  DesktopQueuePauseReason,
  DesktopQueuedFollowUp,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopThreadGoal,
  DesktopUserMessageInput,
  DesktopGoalSubmission,
  DesktopWorkspace,
  ModelProviderID,
} from '../../../../shared/Types.js'
import { THINKING_MODE_OPTIONS } from '../../settings/SettingsStorage.js'
import type { ModelPreset } from '../../../ModelPresets.js'
import type { Message } from '../../../UiTypes.js'
import { ComposerCard } from './ComposerCard.js'
import type {
  ComposerCapabilities,
  ComposerDeliveryIntent,
  ComposerBrowserContext,
  ComposerContextTask,
  ComposerDraftContentSnapshot,
  ComposerDraftKey,
  ComposerDocument,
  ComposerLayout,
  ComposerPlacement,
  ComposerRadiusVariant,
  ComposerSubmitShortcut,
  ComposerSurface,
  ComposerUtilityBarVariant,
  WorkingPlugin,
} from './ComposerTypes.js'
import { useDesktopComposerController } from './UseDesktopComposerController.js'
import { resolveAvailableCodingModel } from './CodingModelSelection.js'
import { hasTaskPlanningInvocation } from './ComposerSkillToken.js'

export { loadCachedRuntimeSkills } from './UseDesktopComposerController.js'
export { getDesktopComposerBranchName } from './ComposerWorkspacePresentation.js'
export type {
  ComposerCapabilities,
  ComposerCollaborationMode,
  ComposerExecutionMode,
  ComposerLayout,
  ComposerPlacement,
  ComposerRadiusVariant,
  ComposerStackMode,
  ComposerSubmitShortcut,
  ComposerUtilityBarVariant,
} from './ComposerTypes.js'

type ProviderModelOption = {
  providerID: ModelProviderID
  displayName: string
  modelPresets: ModelPreset[]
}

export type DesktopComposerProps = {
  input: string
  messages: Message[]
  hasConversationMessages?: boolean
  placement: ComposerPlacement
  draftKey: ComposerDraftKey
  capabilities?: Partial<ComposerCapabilities>
  submitShortcut?: ComposerSubmitShortcut
  surface?: ComposerSurface
  layout?: ComposerLayout
  radiusVariant?: ComposerRadiusVariant
  utilityBarVariant?: ComposerUtilityBarVariant
  workingPlugin?: WorkingPlugin | null
  onWorkingPluginChange?: (plugin: WorkingPlugin | null) => void
  onWorkingPluginAvailabilityChange?: (available: boolean) => void
  onSkillTokenActivate?: (skill: { name: string; path: string }) => void
  /** 首次提交仍在创建会话：冻结输入区并隐藏停止入口。 */
  creationPending?: boolean
  placeholder?: string
  routedSessionId: string | null
  sessionStatus: DesktopSessionStatus
  permissionMode: DesktopPermissionMode
  planModeActive: boolean
  enableAutoReviewPermissionMode: boolean
  enableFullAccessPermissionMode: boolean
  codingModel?: string
  modelVariant?: string
  modelVariantOptions?: { value: string; label: string }[]
  onModelVariantChange?: (value: string) => void
  thinkingMode: DesktopThinkingMode
  selectedProviderID?: ModelProviderID
  selectedModelPreset: string
  modelSelectionError?: string | null
  onRetryModelSelection?: () => void
  modelConfigured: boolean
  modelCatalogLoading?: boolean
  selectedModelMetadata?: DesktopModelMetadata
  showThinkingOptions: boolean
  deepSeekThinkingControls: boolean
  showContextUsage: boolean
  contextUsage: DesktopContextUsage | null
  modelPresets: ModelPreset[]
  providerOptions: ProviderModelOption[]
  allProviders?: readonly DesktopModelProviderSummary[]
  recentWorkspaces: DesktopWorkspace[]
  contextTasks?: ComposerContextTask[]
  browserContext?: ComposerBrowserContext | null
  workspace: DesktopWorkspace | null
  attachments: DesktopComposerAttachment[]
  onAttachmentsChange: (attachments: DesktopComposerAttachment[]) => void
  onAppendAttachmentsForDraft?: (
    draftKey: ComposerDraftKey,
    attachments: DesktopComposerAttachment[],
  ) => void
  onRemoveAttachmentForDraft?: (draftKey: ComposerDraftKey, attachmentId: string) => void
  onOpenAttachment?: (attachment: DesktopComposerAttachment) => void
  onDraftAccepted?: (
    draftKey: ComposerDraftKey,
    snapshot: ComposerDraftContentSnapshot,
  ) => boolean | void
  onChooseWorkspace: () => Promise<DesktopWorkspace | null>
  onInputChange: (value: string) => void
  onInterrupt: () => Promise<void>
  onProviderModelChange: (providerID: ModelProviderID, modelPresetID: string) => void
  onProviderOpen?: (providerID: ModelProviderID) => void
  onProviderSearch?: (providerID: ModelProviderID, query: string) => void
  onOpenWorkspace: (workspace: DesktopWorkspace) => Promise<DesktopWorkspace | null>
  onCloneGithub: () => void
  onClearWorkspace: () => void
  onOpenMcpSettings?: () => void
  onOpenModelSettings?: () => void
  onOpenSideChat?: () => void
  onForkConversation?: () => void
  canForkConversation?: boolean
  onArchiveConversation?: () => void
  onBranchSelect: (branch: string) => Promise<void>
  onCreateBranch: () => void
  onStartReview?: (
    target: { type: 'uncommittedChanges' } | { type: 'baseBranch'; branch: string },
  ) => void
  onPermissionChange: (value: DesktopPermissionMode) => void | Promise<void>
  onPlanModeChange: (active: boolean) => void | Promise<void>
  onThinkingChange: (value: DesktopThinkingMode) => void
  createSessionForWorkspace: (
    target?: DesktopWorkspace | null,
    initialSessionName?: string,
    projectlessPrompt?: string,
  ) => Promise<string | null>
  submitToSession: (
    targetSessionId: string,
    value: DesktopUserMessageInput,
    options?: {
      delivery?: ComposerDeliveryIntent
      inputId?: string
      goal?: DesktopGoalSubmission
      propagateError?: boolean
    },
  ) => Promise<'sent' | 'queued' | 'steered' | null>
  queuedFollowUps?: DesktopQueuedFollowUp[]
  queuePauseReason?: DesktopQueuePauseReason | null
  onFollowUpEdit?: (followUpId: string, input: DesktopUserMessageInput) => void
  onFollowUpRemove?: (followUpId: string) => void
  onFollowUpResume?: () => void
  threadGoal?: DesktopThreadGoal | null
  /** Global error notification for failures that block sending. */
  onError?: (message: string) => void
  /** Current route path used to decide whether a failed creation should navigate back. */
  readPathname?: () => string
  onGoalPause?: () => void
  onGoalResume?: () => void
  onGoalComplete?: () => void
  onGoalClear?: () => void
  subagentMode?: boolean
}

export function DesktopComposer({
  input,
  messages,
  hasConversationMessages: hasConversationMessagesOverride,
  placement,
  draftKey,
  capabilities,
  submitShortcut,
  surface,
  layout,
  radiusVariant,
  utilityBarVariant,
  workingPlugin,
  onWorkingPluginChange,
  onWorkingPluginAvailabilityChange,
  onSkillTokenActivate,
  placeholder: placeholderOverride,
  creationPending = false,
  routedSessionId,
  sessionStatus,
  permissionMode,
  planModeActive,
  enableAutoReviewPermissionMode,
  enableFullAccessPermissionMode,
  codingModel,
  thinkingMode,
  modelVariant,
  modelVariantOptions,
  onModelVariantChange,
  selectedProviderID,
  selectedModelPreset,
  modelSelectionError,
  onRetryModelSelection,
  modelConfigured,
  modelCatalogLoading = false,
  selectedModelMetadata,
  showThinkingOptions,
  deepSeekThinkingControls,
  showContextUsage,
  contextUsage,
  modelPresets,
  providerOptions,
  allProviders,
  recentWorkspaces,
  contextTasks,
  browserContext,
  workspace,
  attachments,
  onAttachmentsChange,
  onAppendAttachmentsForDraft,
  onRemoveAttachmentForDraft,
  onOpenAttachment,
  onDraftAccepted,
  onChooseWorkspace,
  onInputChange,
  onInterrupt,
  onProviderModelChange,
  onProviderOpen,
  onProviderSearch,
  onOpenWorkspace,
  onCloneGithub,
  onClearWorkspace,
  onOpenMcpSettings,
  onOpenModelSettings,
  onOpenSideChat,
  onForkConversation,
  canForkConversation,
  onArchiveConversation,
  onBranchSelect,
  onCreateBranch,
  onStartReview,
  onPermissionChange,
  onPlanModeChange,
  onThinkingChange,
  createSessionForWorkspace,
  submitToSession,
  onError,
  readPathname,
  queuedFollowUps,
  queuePauseReason,
  onFollowUpEdit,
  onFollowUpRemove,
  onFollowUpResume,
  threadGoal,
  onGoalPause,
  onGoalResume,
  onGoalComplete,
  onGoalClear,
  subagentMode = false,
}: DesktopComposerProps): React.ReactNode {
  const effectiveCapabilities = { ...capabilities, dictation: capabilities?.dictation ?? true }
  const {
    branchName,
    canSubmit,
    effectivePermissionMode,
    fileAttachmentsAvailable,
    goalModeEnabled,
    handleAddFiles,
    handleAddFilePaths,
    handleCommandError,
    handleCompact,
    handleComposerDocumentChange,
    handleRemoveAttachment,
    handleSkillDeselect,
    handleSkillSelect,
    handleSubmit,
    handleCompositionEnd,
    handleCompositionStart,
    hasConversationMessages,
    isSubmitting,
    lastSubmitOutcome,
    permissionOptions,
    permissionUnavailableReason,
    activeSkillToken,
    composerDocument,
    setGoalModeEnabled,
    skillCommands,
    skillCatalogLoading,
    skillCatalogError,
    reloadSkillCatalog,
    taskPlanningAvailable,
    unsupportedAttachmentReason,
  } = useDesktopComposerController({
    input,
    messages,
    hasConversationMessages: hasConversationMessagesOverride,
    placement,
    draftKey,
    routedSessionId,
    permissionMode,
    enableAutoReviewPermissionMode,
    enableFullAccessPermissionMode,
    planModeActive,
    sessionBusy: sessionStatus === 'running' || sessionStatus === 'waiting',
    modelConfigured,
    selectedModelMetadata,
    workspace,
    attachments,
    subagentMode,
    surface,
    workingPlugin,
    onWorkingPluginChange,
    onAttachmentsChange,
    onAppendAttachmentsForDraft,
    onRemoveAttachmentForDraft,
    onDraftAccepted,
    createSessionForWorkspace,
    submitToSession,
    onError,
    readPathname,
  })

  useEffect(() => {
    onWorkingPluginAvailabilityChange?.(taskPlanningAvailable)
  }, [onWorkingPluginAvailabilityChange, taskPlanningAvailable])

  const taskPlanningSelected = hasTaskPlanningInvocation(composerDocument)
  useEffect(() => {
    if (!taskPlanningSelected) return
    if (goalModeEnabled) setGoalModeEnabled(false)
    if (!planModeActive)
      void Promise.resolve(onPlanModeChange(true)).catch((error: unknown) =>
        onError?.(error instanceof Error ? error.message : '计划模式未更新'),
      )
  }, [
    taskPlanningSelected,
    planModeActive,
    goalModeEnabled,
    onPlanModeChange,
    setGoalModeEnabled,
    onError,
  ])

  useEffect(() => {
    if (workingPlugin && planModeActive)
      void Promise.resolve(onPlanModeChange(false)).catch((error: unknown) =>
        onError?.(error instanceof Error ? error.message : '计划模式未更新'),
      )
  }, [onPlanModeChange, planModeActive, workingPlugin, onError])

  function handleWorkingPluginChange(plugin: WorkingPlugin | null): void {
    onWorkingPluginChange?.(plugin)
  }

  async function handlePlanModeChange(active: boolean): Promise<void> {
    await onPlanModeChange(active)
    if (active) setGoalModeEnabled(false)
    if (active && workingPlugin) onWorkingPluginChange?.(null)
  }

  function handleSkillSelectWithWorkingPluginClear(
    skill: Parameters<typeof handleSkillSelect>[0],
  ): void {
    if (workingPlugin) onWorkingPluginChange?.(null)
    handleSkillSelect(skill)
  }

  function handleComposerDocumentChangeWithInput(document: ComposerDocument): void {
    handleComposerDocumentChange(document)
    onInputChange(document.text)
  }

  useEffect(() => {
    if (modelSelectionError) {
      if (onError) {
        onError(modelSelectionError)
      } else if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('desktop:error', { detail: modelSelectionError }))
      }
    }
  }, [modelSelectionError, onError, routedSessionId, draftKey])

  return (
    <ComposerCard
      draftKey={draftKey}
      input={input}
      canSubmit={canSubmit}
      sessionStatus={sessionStatus}
      permissionMode={effectivePermissionMode}
      permissionUnavailableReason={permissionUnavailableReason}
      planModeActive={planModeActive}
      placement={placement}
      capabilities={{
        ...effectiveCapabilities,
        fileAttachments:
          fileAttachmentsAvailable && (effectiveCapabilities?.fileAttachments ?? true),
      }}
      submitShortcut={submitShortcut}
      surface={surface}
      layout={layout}
      radiusVariant={radiusVariant}
      utilityBarVariant={utilityBarVariant}
      workingPlugin={workingPlugin}
      onWorkingPluginChange={handleWorkingPluginChange}
      submitting={isSubmitting}
      creationPending={creationPending}
      submitOutcome={lastSubmitOutcome}
      goalModeEnabled={goalModeEnabled}
      onGoalModeChange={setGoalModeEnabled}
      modelVariant={modelVariant}
      modelVariantOptions={modelVariantOptions}
      onModelVariantChange={onModelVariantChange}
      thinkingMode={thinkingMode}
      selectedProviderID={selectedProviderID ?? 'anthropic'}
      selectedModelPreset={selectedModelPreset}
      modelConfigured={modelConfigured}
      modelCatalogLoading={modelCatalogLoading}
      submitDisabledReason={unsupportedAttachmentReason ?? modelSelectionError ?? undefined}
      showThinkingOptions={showThinkingOptions}
      deepSeekThinkingControls={deepSeekThinkingControls}
      showContextUsage={showContextUsage}
      contextUsage={contextUsage}
      modelPresets={modelPresets}
      providerOptions={providerOptions}
      allProviders={allProviders}
      permissionOptions={permissionOptions}
      thinkingOptions={THINKING_MODE_OPTIONS}
      branchName={branchName}
      branches={workspace?.branches ?? []}
      recentWorkspaces={recentWorkspaces}
      contextTasks={contextTasks}
      browserContext={browserContext}
      workspace={workspace}
      attachments={attachments}
      skillCommands={skillCommands}
      skillCatalogLoading={skillCatalogLoading}
      skillCatalogError={skillCatalogError}
      onReloadSkillCatalog={reloadSkillCatalog}
      document={composerDocument}
      selectedSkillToken={activeSkillToken ?? undefined}
      hasConversationMessages={hasConversationMessages}
      placeholder={
        placeholderOverride ??
        (modelCatalogLoading
          ? '加载模型列表中……'
          : hasConversationMessages
            ? '要求后续变更'
            : '随心输入')
      }
      onChooseWorkspace={() => void onChooseWorkspace()}
      onInputChange={onInputChange}
      onDocumentChange={handleComposerDocumentChangeWithInput}
      onSkillTokenActivate={onSkillTokenActivate}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onInterrupt={async () => {
        try {
          await onInterrupt()
        } catch (error) {
          handleCommandError(error instanceof Error ? error.message : String(error))
          throw error
        }
      }}
      onProviderModelChange={onProviderModelChange}
      onProviderOpen={onProviderOpen}
      onProviderSearch={onProviderSearch}
      onAddFiles={(files) => void handleAddFiles(files)}
      onAddFilePaths={handleAddFilePaths}
      onRemoveAttachment={handleRemoveAttachment}
      onOpenAttachment={onOpenAttachment}
      onOpenWorkspace={(workspaceItem) => void onOpenWorkspace(workspaceItem)}
      onCloneGithub={onCloneGithub}
      onClearWorkspace={onClearWorkspace}
      onOpenMcpSettings={onOpenMcpSettings}
      onOpenModelSettings={onOpenModelSettings}
      onOpenSideChat={onOpenSideChat}
      onForkConversation={onForkConversation}
      canForkConversation={canForkConversation}
      onArchiveConversation={onArchiveConversation}
      onBranchSelect={(branch) => void onBranchSelect(branch)}
      onCreateBranch={onCreateBranch}
      onStartReview={onStartReview}
      onPermissionChange={onPermissionChange}
      onPlanModeChange={handlePlanModeChange}
      onSubmit={handleSubmit}
      onCompact={handleCompact}
      queuedCompactionSupported={desktopClient.supportsQueuedCompaction()}
      onCancelCompaction={async () => {
        const operation = contextUsage?.compactionOperation
        if (routedSessionId && operation)
          await desktopClient.cancelCompaction(routedSessionId, operation.operationId)
      }}
      onCommandError={handleCommandError}
      onThinkingChange={onThinkingChange}
      onSkillSelect={handleSkillSelectWithWorkingPluginClear}
      routedSessionId={routedSessionId}
      contextDropdownSide="top"
      queuedFollowUps={queuedFollowUps}
      queuePauseReason={queuePauseReason}
      onFollowUpEdit={onFollowUpEdit}
      onFollowUpRemove={onFollowUpRemove}
      onFollowUpResume={onFollowUpResume}
      threadGoal={threadGoal}
      onGoalPause={onGoalPause}
      onGoalResume={onGoalResume}
      onGoalComplete={onGoalComplete}
      onGoalClear={onGoalClear}
    />
  )
}
