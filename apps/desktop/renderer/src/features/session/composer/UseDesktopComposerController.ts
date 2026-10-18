import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  DesktopComposerAttachment,
  DesktopInstalledSkill,
  DesktopModelMetadata,
  DesktopPermissionMode,
  DesktopUserMessageInput,
  DesktopGoalSubmission,
  DesktopWorkspace,
  ThreadCreationSurface,
} from '../../../../shared/Types.js'
import { hasBlockingComposerAttachmentErrors } from '../../../../shared/DesktopUserMessage.js'
import { toUserErrorMessage } from '../../../utils/Errors.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { permissionPresetView } from '../../settings/PermissionPresetView.js'
import type { Message } from '../../../UiTypes.js'
import type {
  ComposerDraft,
  ComposerDraftContentSnapshot,
  ComposerDraftKey,
  ComposerDeliveryIntent,
  ComposerDocumentToken,
  ComposerSkillInvocation,
  ComposerPlacement,
  ComposerSubmitOutcome,
  ComposerSurface,
  WorkingPlugin,
} from './ComposerTypes.js'
import { createComposerDocument } from './ComposerTypes.js'
import { createTaskSession, executeComposerSubmitTransaction } from './ComposerSubmitTransaction.js'
import { composerDraftStore } from './ComposerDraftStore.js'
import { annotationAttachments } from '../../browser/BrowserAnnotationDraft.js'
import {
  createComposerDocumentWithSkill,
  skillInvocationsFromComposerDocument,
} from './ComposerSkillToken.js'
import {
  planTaskFromInput,
  skillToComposerCommand,
  type ComposerSkillCommand,
} from './ComposerSlashCommands.js'
import { getDesktopComposerBranchName } from './ComposerWorkspacePresentation.js'

type ControllerOptions = {
  input: string
  messages: Message[]
  hasConversationMessages?: boolean
  placement: ComposerPlacement
  draftKey: ComposerDraftKey
  routedSessionId: string | null
  permissionMode: DesktopPermissionMode
  enableAutoReviewPermissionMode: boolean
  enableFullAccessPermissionMode: boolean
  planModeActive: boolean
  sessionBusy: boolean
  modelConfigured: boolean
  selectedModelMetadata?: DesktopModelMetadata
  workspace: DesktopWorkspace | null
  attachments: DesktopComposerAttachment[]
  subagentMode: boolean
  surface?: ComposerSurface
  workingPlugin?: WorkingPlugin | null
  onWorkingPluginChange?: (plugin: WorkingPlugin | null) => void
  onAttachmentsChange: (attachments: DesktopComposerAttachment[]) => void
  onAppendAttachmentsForDraft?: (
    draftKey: ComposerDraftKey,
    attachments: DesktopComposerAttachment[],
  ) => void
  onRemoveAttachmentForDraft?: (draftKey: ComposerDraftKey, attachmentId: string) => void
  onDraftAccepted?: (
    draftKey: ComposerDraftKey,
    snapshot: ComposerDraftContentSnapshot,
  ) => boolean | void
  createSessionForWorkspace: (
    target?: DesktopWorkspace | null,
    initialSessionName?: string,
    projectlessPrompt?: string,
    creationSurface?: ThreadCreationSurface,
  ) => Promise<string | null>
  /** Global error notification for failures that block sending. */
  onError?: (message: string) => void
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
}

export function resolveActiveComposerSkillToken(
  _workingPlugin: WorkingPlugin | null | undefined,
  selectedSkillToken: ComposerSkillCommand | null,
  _skillCommands: readonly ComposerSkillCommand[],
): ComposerSkillCommand | null {
  return selectedSkillToken
}

export type ResolveComposerCanSubmitInput = {
  workingPluginSkillUnavailable: boolean
  hasContent: boolean
  hasAttachmentErrors: boolean
  unsupportedAttachmentReason: string | null
  modelConfigured: boolean
  isSubmitting: boolean
  placement: ComposerPlacement
  routedSessionId: string | null
}

export function resolveComposerCanSubmit({
  workingPluginSkillUnavailable,
  hasContent,
  hasAttachmentErrors,
  unsupportedAttachmentReason,
  modelConfigured,
  isSubmitting,
  placement,
  routedSessionId,
}: ResolveComposerCanSubmitInput): boolean {
  return (
    !workingPluginSkillUnavailable &&
    hasContent &&
    !hasAttachmentErrors &&
    !unsupportedAttachmentReason &&
    modelConfigured &&
    !isSubmitting &&
    (placement === 'new-session' || Boolean(routedSessionId))
  )
}

export function useDesktopComposerController({
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
  sessionBusy,
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
}: ControllerOptions) {
  const navigate = useNavigate()
  const [goalModeEnabled, updateGoalModeEnabled] = useState(() =>
    Boolean(composerDraftStore.get(draftKey).goalModeEnabled),
  )
  function setGoalModeEnabled(enabled: boolean): void {
    composerDraftStore.update(draftKey, (draft) => ({ ...draft, goalModeEnabled: enabled }))
    updateGoalModeEnabled(enabled)
  }
  const [isComposing, setIsComposing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSubmitOutcome, setLastSubmitOutcome] = useState<ComposerSubmitOutcome | null>(null)
  const [fileAttachmentsAvailable, setFileAttachmentsAvailable] = useState(false)
  const [, setDraftStoreVersion] = useState(0)
  const composingRef = useRef(false)
  const submittingRef = useRef(false)
  const attachmentGenerationRef = useRef(new Map<ComposerDraftKey, number>())
  const initialDraftRef = useRef(composerDraftStore.get(draftKey))
  const draftClientIdRef = useRef(initialDraftRef.current.clientId)
  const activeDraftKeyRef = useRef<ComposerDraftKey>(draftKey)
  const [skillCommands, setSkillCommands] = useState<ComposerSkillCommand[]>([])
  const [runtimeSkillsLoaded, setRuntimeSkillsLoaded] = useState(false)
  const [runtimeSkillsError, setRuntimeSkillsError] = useState<string | null>(null)
  const [skillsReloadVersion, setSkillsReloadVersion] = useState(0)
  const [selectedSkillTokens, setSelectedSkillTokens] = useState<ComposerSkillCommand[]>(() =>
    restoreSkillTokens(draftSkills(initialDraftRef.current), []),
  )
  const [contextTokens, setContextTokens] = useState<ComposerDocumentToken[]>(() =>
    contextTokensFromDocument(initialDraftRef.current.document.tokens),
  )

  const activeSkillToken = selectedSkillTokens[0] ?? null
  const selectedSkillToken = activeSkillToken
  const activeSkills = useMemo(
    () =>
      selectedSkillTokens.map((command) => ({
        name: command.skill.name,
        path: command.skill.path,
      })),
    [selectedSkillTokens],
  )
  const composerDocument = useMemo(() => {
    return createComposerDocumentWithSkill(input, activeSkills, contextTokens)
  }, [activeSkills, contextTokens, input])
  const workingPluginSkillUnavailable = false

  const submissionAttachments = annotationAttachments({
    ...composerDraftStore.get(draftKey),
    attachments,
  })
  const hasAttachmentErrors = hasBlockingComposerAttachmentErrors(submissionAttachments)
  const unsupportedAttachmentReason = getUnsupportedAttachmentReason(
    submissionAttachments,
    selectedModelMetadata,
  )
  const hasComposerContent =
    Boolean(input.trim()) ||
    Boolean(composerDraftStore.get(draftKey).browserAnnotations?.length) ||
    attachments.length > 0 ||
    activeSkillToken !== null ||
    contextTokens.length > 0
  const goalSubmitDisabledReason =
    goalModeEnabled && sessionBusy
      ? '当前任务正在执行，请等待本轮结束后提交目标'
      : goalModeEnabled && !input.trim()
        ? '请输入目标内容'
        : null
  const canSubmit =
    !goalSubmitDisabledReason &&
    resolveComposerCanSubmit({
      workingPluginSkillUnavailable,
      hasContent: hasComposerContent,
      hasAttachmentErrors,
      unsupportedAttachmentReason,
      modelConfigured,
      isSubmitting,
      placement,
      routedSessionId,
    })
  const attachmentIds = useMemo(
    () => new Set(attachments.map((attachment) => attachment.id)),
    [attachments],
  )
  const branchName = getDesktopComposerBranchName(workspace)
  const permissionView = useMemo(
    () =>
      permissionPresetView(permissionMode, {
        enableAutoReviewPermissionMode,
        enableFullAccessPermissionMode,
      }),
    [permissionMode, enableAutoReviewPermissionMode, enableFullAccessPermissionMode],
  )
  // The configured preset is always shown as-is. A preset hidden by a feature
  // toggle is surfaced with its unavailable reason and never rewritten here.
  const permissionOptions = permissionView.options
  const effectivePermissionMode = permissionView.selection
  const hasConversationMessages =
    hasConversationMessagesOverride ?? messages.some((message) => message.role !== 'system')

  useEffect(() => {
    let cancelled = false
    void desktopClient.isComposerFileAttachmentAvailable().then(
      (available) => {
        if (!cancelled) setFileAttachmentsAvailable(available)
      },
      () => {
        if (!cancelled) setFileAttachmentsAvailable(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Execution location is only offered when creating a task in a project. A failed
  useEffect(
    () =>
      composerDraftStore.subscribe(() => {
        setDraftStoreVersion((value) => value + 1)
        const currentDraft = composerDraftStore.get(draftKey)
        draftClientIdRef.current = currentDraft.clientId
        updateGoalModeEnabled(Boolean(currentDraft.goalModeEnabled))
        setSelectedSkillTokens(restoreSkillTokens(draftSkills(currentDraft), skillCommands))
        setContextTokens((current) =>
          sameContextTokens(current, contextTokensFromDocument(currentDraft.document.tokens)),
        )
      }),
    [draftKey, skillCommands],
  )

  useEffect(() => {
    if (activeDraftKeyRef.current === draftKey) return
    activeDraftKeyRef.current = draftKey
    const nextDraft = composerDraftStore.get(draftKey)
    updateGoalModeEnabled(Boolean(nextDraft.goalModeEnabled))
    setSelectedSkillTokens(restoreSkillTokens(draftSkills(nextDraft), skillCommands))
    setContextTokens(contextTokensFromDocument(nextDraft.document.tokens))
    setLastSubmitOutcome(null)
    draftClientIdRef.current = nextDraft.clientId
  }, [draftKey, skillCommands])

  useEffect(() => {
    composerDraftStore.update(draftKey, (current) => ({
      ...current,
      clientId: draftClientIdRef.current,
      document: composerDocument,
      attachments,
      collaborationMode: planModeActive ? 'plan' : 'default',
    }))
  }, [activeSkills, attachments, composerDocument, draftKey, planModeActive])

  useEffect(() => {
    if (subagentMode) {
      setSkillCommands([])
      setSelectedSkillTokens([])
      setRuntimeSkillsLoaded(true)
      return
    }
    let cancelled = false
    let generation = 0
    const load = (forceReload = false) => {
      const request = ++generation
      setRuntimeSkillsLoaded(false)
      setRuntimeSkillsError(null)
      setSkillCommands([])
      return loadCachedRuntimeSkills(workspace?.path, forceReload)
        .then((skills) => skills.map(skillToComposerCommand))
        .then((commands) => {
          if (!cancelled && request === generation) {
            setSkillCommands(commands)
            setRuntimeSkillsLoaded(true)
            setSelectedSkillTokens(
              restoreSkillTokens(draftSkills(composerDraftStore.get(draftKey)), commands),
            )
          }
        })
        .catch((error) => {
          if (!cancelled && request === generation) {
            setRuntimeSkillsError(toUserErrorMessage(error))
            setRuntimeSkillsLoaded(true)
          }
        })
    }
    void load(skillsReloadVersion > 0)
    const unsubscribe = desktopClient.onRuntimeSkillsUpdated(() => {
      void load(true)
    })
    const unsubscribePlugins = desktopClient.onPluginsUpdated(() => {
      void load(true)
    })
    return () => {
      cancelled = true
      unsubscribe()
      unsubscribePlugins()
    }
  }, [draftKey, subagentMode, workspace?.path, skillsReloadVersion])

  function handleSubmit(delivery: ComposerDeliveryIntent = 'default'): void {
    if (subagentMode && planTaskFromInput(input) !== null) {
      onError?.('子 Agent 不能切换计划模式')
      return
    }
    if (submittingRef.current || composingRef.current || !modelConfigured || !canSubmit) {
      return
    }
    submittingRef.current = true
    setIsSubmitting(true)
    setLastSubmitOutcome(null)
    composerDraftStore.clearSubmitOutcome(draftKey)
    void performSubmit(delivery).finally(() => {
      submittingRef.current = false
      setIsSubmitting(false)
    })
  }

  async function performSubmit(delivery: ComposerDeliveryIntent): Promise<void> {
    const sourceDraftKey = draftKey
    const snapshot: ComposerDraftContentSnapshot = {
      text: input,
      attachments: [...attachments],
    }

    const draft: ComposerDraft = {
      ...composerDraftStore.get(sourceDraftKey),
      clientId: draftClientIdRef.current,
      document: composerDocument ?? createComposerDocument(input),
      attachments,
      skills: draftSkills(composerDraftStore.get(sourceDraftKey)),
      skillInvocation: undefined,
      collaborationMode: planModeActive ? 'plan' : 'default',
      goalModeEnabled,
    }
    composerDraftStore.set(sourceDraftKey, draft)
    const isNewSession = placement === 'new-session'
    const outcome = await executeComposerSubmitTransaction({
      draft,
      targetSessionId: isNewSession ? null : routedSessionId,
      createSession: isNewSession
        ? (initialSessionName, projectlessPrompt) =>
            createTaskSession({
              onError,
              create: () =>
                createSessionForWorkspace(
                  workspace,
                  initialSessionName,
                  projectlessPrompt,
                  surface === 'working' || surface === 'chat' || surface === 'coding'
                    ? surface
                    : undefined,
                ),
            })
        : undefined,
      // Keep navigation before submission so the routed page owns all
      // streaming state from the first response event onward.
      navigateToSession: (nextSessionId) => {
        const targetDraftKey: ComposerDraftKey = `session:${nextSessionId}`
        const handoff = composerDraftStore.handoff(sourceDraftKey, targetDraftKey)
        if (handoff && activeDraftKeyRef.current === sourceDraftKey) {
          draftClientIdRef.current = handoff.replacement.clientId
        }
        navigate(sessionPath(nextSessionId))
      },
      submitToSession: async (targetSessionId, value, metadata) => {
        const result = await submitToSession(targetSessionId, value, {
          delivery,
          inputId: metadata.inputId,
          propagateError: true,
          goal: metadata.goal,
        })
        if (!result) throw new Error('发送失败，请重试')
        return result === 'queued' ? 'queued' : 'sent'
      },
    })
    setLastSubmitOutcome(outcome)

    if (outcome.status === 'failed') {
      const failureDraftKey: ComposerDraftKey = outcome.sessionId
        ? `session:${outcome.sessionId}`
        : sourceDraftKey
      composerDraftStore.setSubmitOutcome(failureDraftKey, outcome)
      if (outcome.phase === 'send') {
        onError?.(outcome.message)
      }
      return
    }

    const acceptedDraftKey: ComposerDraftKey = isNewSession
      ? `session:${outcome.sessionId}`
      : sourceDraftKey
    const clearContent = onDraftAccepted
      ? onDraftAccepted(acceptedDraftKey, snapshot) !== false
      : true
    const nextDraft = composerDraftStore.completeSubmission(acceptedDraftKey, draft.clientId, {
      clearContent,
      browserAnnotations: draft.browserAnnotations,
    })
    composerDraftStore.clearSubmitOutcome(acceptedDraftKey)
    if (activeDraftKeyRef.current === acceptedDraftKey) {
      if (clearContent) {
        setSelectedSkillTokens([])
        setGoalModeEnabled(false)
      }
      draftClientIdRef.current = nextDraft.clientId
    }
    if (workingPlugin) onWorkingPluginChange?.(null)
  }

  async function handleAddFiles(files: FileList): Promise<void> {
    if (files.length === 0) return
    const targetDraftKey = draftKey
    const generation = nextAttachmentGeneration(attachmentGenerationRef.current, targetDraftKey)
    const { selectDroppedComposerAttachments } = await import('./ComposerAttachmentSelection.js')
    const selected = await selectDroppedComposerAttachments(
      files,
      (file) => desktopClient.getComposerFilePath(file),
      (paths) => desktopClient.grantComposerFilePaths(paths),
    )
    await appendAttachments(targetDraftKey, selected, generation)
  }

  async function handleAddFilePaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    const targetDraftKey = draftKey
    const generation = nextAttachmentGeneration(attachmentGenerationRef.current, targetDraftKey)
    const selected = await desktopClient.grantComposerFilePaths(paths)
    await appendAttachments(targetDraftKey, selected, generation)
  }

  async function appendAttachments(
    targetDraftKey: ComposerDraftKey,
    nextAttachments: DesktopComposerAttachment[],
    generation: number,
  ): Promise<void> {
    if (nextAttachments.length === 0) return
    const { mergeComposerAttachments } = await import('./ComposerAttachmentSelection.js')
    if (attachmentGenerationRef.current.get(targetDraftKey) !== generation) return
    const { accepted, error } = mergeComposerAttachments(attachments, nextAttachments)
    if (error) {
      const outcome: ComposerSubmitOutcome = {
        status: 'failed',
        phase: 'prepare',
        message: error,
      }
      setLastSubmitOutcome(outcome)
      composerDraftStore.setSubmitOutcome(targetDraftKey, outcome)
    }
    if (onAppendAttachmentsForDraft) {
      onAppendAttachmentsForDraft(targetDraftKey, accepted)
      return
    }
    onAttachmentsChange([
      ...attachments,
      ...accepted.filter((attachment) => !attachmentIds.has(attachment.id)),
    ])
  }

  function handleRemoveAttachment(attachmentId: string): void {
    if (onRemoveAttachmentForDraft) {
      onRemoveAttachmentForDraft(draftKey, attachmentId)
      return
    }
    onAttachmentsChange(attachments.filter((attachment) => attachment.id !== attachmentId))
  }

  async function handleCompact(): Promise<void> {
    if (!routedSessionId) throw new Error('请先创建任务后再压缩上下文')
    setLastSubmitOutcome(null)
    composerDraftStore.clearSubmitOutcome(draftKey)
    await desktopClient.compactSession(routedSessionId)
  }

  function handleCommandError(message: string): void {
    const outcome: ComposerSubmitOutcome = {
      status: 'failed',
      phase: 'prepare',
      message,
      sessionId: routedSessionId ?? undefined,
    }
    setLastSubmitOutcome(outcome)
    composerDraftStore.setSubmitOutcome(draftKey, outcome)
  }

  return {
    branchName,
    canSubmit,

    effectivePermissionMode,
    fileAttachmentsAvailable,
    goalModeEnabled,
    handleAddFiles,
    handleAddFilePaths,
    handleCommandError,
    handleCompact,
    handleRemoveAttachment,
    handleComposerDocumentChange: (document: ComposerDraft['document']) => {
      composerDraftStore.update(draftKey, (current) => ({ ...current, document }))
      setContextTokens(contextTokensFromDocument(document.tokens))
      const skills = skillInvocationsFromComposerDocument(document)
      const currentSkills = draftSkills(composerDraftStore.get(draftKey))
      if (
        skills.length === currentSkills.length &&
        skills.every((skill, index) => sameSkillInvocation(skill, currentSkills[index]))
      )
        return
      composerDraftStore.setSkills(draftKey, skills)
      setSelectedSkillTokens(restoreSkillTokens(skills, skillCommands))
      if (!skills.length && workingPlugin) onWorkingPluginChange?.(null)
    },
    handleSkillDeselect: () => {
      composerDraftStore.setSkills(draftKey, [])
      setSelectedSkillTokens([])
    },
    handleSkillSelect: (skill: ComposerSkillCommand) => {
      const nextDraft = composerDraftStore.addSkill(draftKey, {
        name: skill.skill.name,
        path: skill.skill.path,
      })
      setSelectedSkillTokens(restoreSkillTokens(draftSkills(nextDraft), skillCommands))
    },
    handleSubmit,
    handleCompositionEnd: () => {
      composingRef.current = false
      setIsComposing(false)
    },
    handleCompositionStart: () => {
      composingRef.current = true
      setIsComposing(true)
    },
    hasConversationMessages,
    isComposing,
    isSubmitting,
    lastSubmitOutcome: composerDraftStore.getSubmitOutcome(draftKey) ?? lastSubmitOutcome,
    permissionOptions,
    permissionUnavailableReason: permissionView.unavailableReason,
    selectedSkillToken,
    activeSkillToken,
    composerDocument,
    setGoalModeEnabled,
    skillCommands,
    skillCatalogLoading: !runtimeSkillsLoaded,
    skillCatalogError: runtimeSkillsError,
    reloadSkillCatalog: () => setSkillsReloadVersion((version) => version + 1),
    taskPlanningAvailable: false,
    unsupportedAttachmentReason: goalSubmitDisabledReason ?? unsupportedAttachmentReason,
  }
}

export function contextTokensFromDocument(
  tokens: readonly ComposerDocumentToken[],
): ComposerDocumentToken[] {
  return tokens.filter(
    (token) =>
      token.kind === 'skill' ||
      token.kind === 'thread' ||
      token.kind === 'browser' ||
      token.kind === 'plugin',
  )
}

function sameContextTokens(
  current: ComposerDocumentToken[],
  next: ComposerDocumentToken[],
): ComposerDocumentToken[] {
  return current.length === next.length &&
    current.every((token, index) => {
      const candidate = next[index]
      return (
        candidate &&
        token.id === candidate.id &&
        token.kind === candidate.kind &&
        token.label === candidate.label &&
        token.value === candidate.value &&
        token.from === candidate.from &&
        token.to === candidate.to
      )
    })
    ? current
    : next
}

const runtimeSkillCache = new Map<string, DesktopInstalledSkill[]>()
const runtimeSkillRequests = new Map<string, Promise<DesktopInstalledSkill[]>>()

export function loadCachedRuntimeSkills(
  workspacePath?: string,
  forceReload = false,
  loader: (
    workspacePath?: string,
    forceReload?: boolean,
  ) => Promise<DesktopInstalledSkill[]> = async (path, force) => {
    const result = await desktopClient.listRuntimeSkills(path, {
      forceReload: force,
    })
    if (result.state !== 'ready') throw new Error(result.error)
    return result.data.filter((skill) => skill.enabled)
  },
): Promise<DesktopInstalledSkill[]> {
  const key = workspacePath?.trim() || '__no_workspace__'
  if (forceReload) {
    runtimeSkillCache.delete(key)
    runtimeSkillRequests.delete(key)
  }
  const cached = runtimeSkillCache.get(key)
  if (cached) return Promise.resolve(cached)
  const pending = runtimeSkillRequests.get(key)
  if (pending) return pending
  const request = loader(workspacePath, forceReload)
    .then((skills) => {
      const enabled = skills.filter((skill) => skill.enabled)
      if (runtimeSkillRequests.get(key) === request) {
        runtimeSkillCache.set(key, enabled)
        runtimeSkillRequests.delete(key)
      }
      return enabled
    })
    .catch((error) => {
      if (runtimeSkillRequests.get(key) === request) runtimeSkillRequests.delete(key)
      throw error
    })
  runtimeSkillRequests.set(key, request)
  return request
}

function getUnsupportedAttachmentReason(
  attachments: DesktopComposerAttachment[],
  metadata: DesktopModelMetadata | undefined,
): string | null {
  if (attachments.length === 0 || !metadata?.modalities?.input) return null
  const supportedInputs = new Set(metadata.modalities.input)
  const unsupported = attachments.find((attachment) => {
    if (attachment.status === 'error') return false
    if (attachment.storage === 'local-path') return false
    return !supportedInputs.has(attachment.kind)
  })
  if (!unsupported) return null
  const modelLabel = metadata.label ?? metadata.name ?? metadata.id
  return `${modelLabel} 不支持 ${attachmentKindLabel(unsupported.kind)} 附件`
}

function attachmentKindLabel(kind: DesktopComposerAttachment['kind']): string {
  switch (kind) {
    case 'image':
      return '图片'
    case 'document':
      return '文档'
    case 'text':
      return '文本'
    case 'audio':
      return '音频'
    case 'video':
      return '视频'
    case 'binary':
      return '文件'
  }
}

function sessionPath(sessionId: string): string {
  return `/threads/${encodeURIComponent(sessionId)}`
}

function draftSkills(draft: ComposerDraft): ComposerSkillInvocation[] {
  return (
    draft.skills ??
    (draft.skillInvocation
      ? [draft.skillInvocation]
      : skillInvocationsFromComposerDocument(draft.document))
  )
}

function restoreSkillTokens(
  skills: ComposerSkillInvocation[],
  commands: ComposerSkillCommand[],
): ComposerSkillCommand[] {
  return skills.map((skill) => restoreSkillToken(skill, commands)!)
}

function restoreSkillToken(
  invocation: ComposerDraft['skillInvocation'],
  commands: ComposerSkillCommand[],
): ComposerSkillCommand | null {
  if (!invocation) return null
  const command = commands.find(
    (item) => item.skill.name === invocation.name && item.skill.path === invocation.path,
  )
  return {
    id: `skill:${invocation.name}`,
    trigger: invocation.name,
    title: command?.title ?? invocation.name,
    description: command?.description ?? '',
    source: 'skill',
    skill: {
      name: invocation.name,
      path: invocation.path,
      scope: command?.skill.scope ?? 'repo',
      source: command?.skill.source ?? 'workspace',
    },
  }
}

function sameSkillInvocation(
  left: ComposerDraft['skillInvocation'] | null | undefined,
  right: ComposerDraft['skillInvocation'] | null | undefined,
): boolean {
  return left?.name === right?.name && left?.path === right?.path
}

function nextAttachmentGeneration(
  generations: Map<ComposerDraftKey, number>,
  draftKey: ComposerDraftKey,
): number {
  const next = (generations.get(draftKey) ?? 0) + 1
  generations.set(draftKey, next)
  return next
}
