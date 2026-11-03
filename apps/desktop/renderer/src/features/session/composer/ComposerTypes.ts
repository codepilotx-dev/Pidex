import type {
  DesktopComposerAttachment,
  DesktopGoalSubmission,
  DesktopUserMessageInput,
} from '../../../../shared/Types.js'

export type ComposerPlacement = 'new-session' | 'thread' | 'side-task'

export function parseGoalTokenBudget(input: string): number | null | undefined {
  if (!input.trim()) return null
  const value = Number(input)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export type GoalBudgetAppend =
  | { status: 'empty' }
  | { status: 'invalid' | 'overflow' }
  | { status: 'valid'; tokens: number; nextTotal: number }

/**
 * Turns the appended token count typed by the user into the new total budget. The
 * wire field stays the total, so the addition has to fit a safe integer here.
 */
export function resolveGoalBudgetAppend(savedBudget: number, input: string): GoalBudgetAppend {
  if (!input.trim()) return { status: 'empty' }
  const tokens = parseGoalTokenBudget(input)
  if (typeof tokens !== 'number' || tokens <= 0) return { status: 'invalid' }
  const nextTotal = savedBudget + tokens
  if (!Number.isSafeInteger(nextTotal)) return { status: 'overflow' }
  return { status: 'valid', tokens, nextTotal }
}

export type ComposerLayout = 'single-line' | 'multiline'

export type ComposerRadiusVariant = 'default' | 'single-line' | 'compact'

export type ComposerUtilityBarVariant = 'default' | 'home'

/** 新建页展示上下文；thread 内不设置，保持现有行为。 */
export type ComposerSurface = 'coding' | 'working' | 'chat'

/** Reserved for future Working plugins; the former task planner was removed. */
export type WorkingPlugin = never

export type ComposerExecutionMode = 'local' | 'worktree' | 'cloud'

export type ComposerCollaborationMode = 'default' | 'plan' | 'grill'

export type ComposerSubmitShortcut = 'enter' | 'multiline-ctrl-enter' | 'ctrl-enter'

export type ComposerDeliveryIntent = 'default' | 'follow-up'

export type ComposerStackMode =
  | { kind: 'input' }
  | { kind: 'permission'; requestId: string }
  | { kind: 'question'; requestId: string }
  | { kind: 'mcp'; requestId: string }

export type ComposerCapabilities = {
  localExecution: boolean
  worktreeExecution: boolean
  cloudExecution: boolean
  remoteHost: boolean
  fileAttachments: boolean
  clipboardBlobAttachments: boolean
  skills: boolean
  plugins: boolean
  mcpResources: boolean
  ideContext: boolean
  dictation: boolean
  voiceMode: boolean
  review: boolean
  goals: boolean
  status: boolean
}

/**
 * Capabilities backed by the current renderer and desktop client. Features
 * without a real data source stay false so consumers can omit them entirely.
 */
export const DEFAULT_COMPOSER_CAPABILITIES: Readonly<ComposerCapabilities> = Object.freeze({
  localExecution: true,
  worktreeExecution: false,
  cloudExecution: false,
  remoteHost: false,
  fileAttachments: true,
  clipboardBlobAttachments: false,
  skills: true,
  plugins: false,
  mcpResources: false,
  ideContext: false,
  dictation: false,
  voiceMode: false,
  review: true,
  goals: true,
  status: true,
})

export function resolveComposerCapabilities(
  overrides: Partial<ComposerCapabilities> = {},
): ComposerCapabilities {
  return {
    ...DEFAULT_COMPOSER_CAPABILITIES,
    ...overrides,
  }
}

export type ComposerTokenKind =
  | 'skill'
  | 'file'
  | 'thread'
  | 'browser'
  | 'agent'
  | 'plugin'
  | 'prompt-macro'
  | 'slash-command'
  | 'mode'

export type ComposerDocumentToken = {
  id: string
  kind: ComposerTokenKind
  name?: string
  label: string
  value: string
  from: number
  to: number
}

/**
 * Neutral editor document. ProseMirror owns its internal state, while this
 * shape is the serializable draft boundary shared by every placement.
 */
export type ComposerDocument = {
  text: string
  tokens: ComposerDocumentToken[]
}

export function isComposerInputEmpty(
  text: string,
  tokens: readonly ComposerDocumentToken[],
  attachments: readonly DesktopComposerAttachment[],
): boolean {
  return text.length === 0 && tokens.length === 0 && attachments.length === 0
}

export type ComposerContextTask = {
  id: string
  title: string
  workspaceName?: string
}

export type ComposerBrowserContext = {
  title: string
  url: string
}

export type ComposerDraftKey = 'home' | `session:${string}` | `side-chat:${string}`

export type ComposerSkillInvocation = {
  name: string
  path: string
}

export type ComposerLaunchSettings = {
  /** 开启后由 Agent 从选定分支创建托管工作树，不切换源目录分支。 */
  createWorktree: boolean
  /** `null` 表示项目当前分支；此处选择只更新草稿，发送时才生效。 */
  branch: string | null
}

/** 一次尚未完成的会话创建，用同一个 operationId 让重试复用已创建的工作树。 */
export type ComposerLaunchAttempt = {
  projectKey: string
  signature: string
  operationId: string
}

export type ComposerDraft = {
  clientId: string
  document: ComposerDocument
  attachments: DesktopComposerAttachment[]
  browserAnnotations?: import('@pidex/shared/browser-annotation').BrowserAnnotation[]
  browserAnnotationImages?: DesktopComposerAttachment[]
  browserAnnotationFeedback?: Record<string, string>
  browserAnnotationEditors?: Record<
    string,
    {
      documentId: string
      editor: import('@pidex/shared/browser-annotation').BrowserAnnotationEditor
    }
  >
  skillInvocation?: ComposerSkillInvocation
  skills?: ComposerSkillInvocation[]
  goalModeEnabled?: boolean
  goalTokenBudget?: number | null
  collaborationMode: ComposerCollaborationMode
  suggestionOrigin?: string
  /** 发起设置按首页草稿所属项目分别保存，切换项目不串用。 */
  launchSettingsByProject?: Record<string, ComposerLaunchSettings>
  launchAttempt?: ComposerLaunchAttempt
}

export type ComposerDraftContentSnapshot = {
  text: string
  attachments: DesktopComposerAttachment[]
}

export type ComposerSubmitFailurePhase = 'prepare' | 'create' | 'send'

export type ComposerSubmitOutcome =
  | { status: 'sent'; sessionId: string }
  | { status: 'queued'; sessionId: string }
  | {
      status: 'failed'
      phase: ComposerSubmitFailurePhase
      message: string
      sessionId?: string
    }

export function isInlineComposerFailure(
  outcome: ComposerSubmitOutcome | null | undefined,
): outcome is Extract<ComposerSubmitOutcome, { status: 'failed' }> {
  return outcome?.status === 'failed' && outcome.phase === 'prepare'
}

export type PreparedComposerSubmission = {
  clientId: string
  input: DesktopUserMessageInput
  sessionName?: string
  goal?: DesktopGoalSubmission
}

export type ComposerAttachmentState =
  | { status: 'loading'; generation: number }
  | { status: 'ready'; generation: number }
  | { status: 'error'; generation: number; message: string }

export function createComposerDocument(text = ''): ComposerDocument {
  return { text, tokens: [] }
}
