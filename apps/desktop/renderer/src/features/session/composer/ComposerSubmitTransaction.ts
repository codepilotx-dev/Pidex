import type { DesktopGoalSubmission, DesktopUserMessageInput } from '../../../../shared/Types.js'
import { hasBlockingComposerAttachmentErrors } from '../../../../shared/DesktopUserMessage.js'
import { toUserErrorMessage } from '../../../utils/Errors.js'
import type {
  ComposerDraft,
  ComposerSubmitOutcome,
  PreparedComposerSubmission,
} from './ComposerTypes.js'
import { cloneDraft } from './ComposerDraftStore.js'
import {
  hasTaskPlanningInvocation,
  skillInvocationsFromComposerDocument,
} from './ComposerSkillToken.js'
import {
  goalTaskFromInput,
  grillTaskFromInput,
  planTaskFromInput,
} from './ComposerSlashCommands.js'
import {
  annotationAttachments,
  validateAnnotationCapacity,
} from '../../browser/BrowserAnnotationDraft.js'

export type ComposerDeliveryStatus = 'sent' | 'queued'

type SubmitTransactionOptions = {
  draft: ComposerDraft
  targetSessionId?: string | null
  /** 校验通过、开始创建前调用；用于在校验失败前不登记任何临时状态。 */
  onPrepared?: (prepared: PreparedComposerSubmission) => void
  createSession?: (
    initialSessionName?: string,
    projectlessPrompt?: string,
  ) => Promise<string | null>
  onSessionCreated?: (sessionId: string) => void
  submitToSession: (
    sessionId: string,
    input: DesktopUserMessageInput,
    metadata: { inputId: string; goal?: DesktopGoalSubmission },
  ) => Promise<ComposerDeliveryStatus | void>
}

export function prepareComposerSubmission(
  draft: ComposerDraft,
): PreparedComposerSubmission | ComposerSubmitOutcome {
  const snapshot = cloneDraft(draft)
  const goalTask = goalTaskFromInput(snapshot.document.text)
  const planTask = planTaskFromInput(snapshot.document.text)
  const grillTask = grillTaskFromInput(snapshot.document.text)
  if (planTask !== null || grillTask !== null || goalTask !== null) {
    const directTask = planTask ?? grillTask ?? goalTask!
    const prefixLength = snapshot.document.text.indexOf(directTask)
    snapshot.document = {
      text: directTask,
      tokens: snapshot.document.tokens.map((token) => ({
        ...token,
        from: Math.max(0, Math.min(directTask.length, token.from - prefixLength)),
        to: Math.max(0, Math.min(directTask.length, token.to - prefixLength)),
      })),
    }
    snapshot.goalModeEnabled = goalTask !== null
    snapshot.collaborationMode =
      goalTask !== null ? 'default' : planTask !== null ? 'plan' : 'grill'
  }
  if (Object.keys(snapshot.browserAnnotationFeedback ?? {}).length)
    return failed('prepare', '请先保存或取消正在编辑的批注反馈')
  try {
    validateAnnotationCapacity(snapshot)
  } catch (error) {
    return failed('prepare', error instanceof Error ? error.message : '批注附件不可用')
  }
  const attachments = annotationAttachments(snapshot)
  const text = serializeComposerDocument(snapshot.document)
  if (snapshot.goalModeEnabled && !snapshot.document.text.trim()) {
    return failed('prepare', '请输入目标内容')
  }
  if (snapshot.goalModeEnabled && snapshot.document.text.trim().length > 4000)
    return failed('prepare', '目标内容不能超过 4000 字符')
  const skills =
    snapshot.skills ??
    (snapshot.skillInvocation
      ? [snapshot.skillInvocation]
      : skillInvocationsFromComposerDocument(snapshot.document))
  const hasContent = Boolean(text.trim()) || attachments.length > 0 || skills.length > 0
  const planning = hasTaskPlanningInvocation(snapshot.document, skills)
  const grilling = grillTask !== null || snapshot.collaborationMode === 'grill'
  if (goalTask === null && (planning || grilling)) snapshot.goalModeEnabled = false

  if (!hasContent) {
    return failed('prepare', '请输入消息或添加附件')
  }
  if (hasBlockingComposerAttachmentErrors(snapshot.attachments)) {
    return failed('prepare', '请先移除或修复不可用的附件')
  }

  return {
    clientId: snapshot.clientId,
    input: {
      text,
      taskMode:
        !snapshot.goalModeEnabled &&
        grillTask === null &&
        (planning || planTask !== null || snapshot.collaborationMode === 'plan')
          ? 'plan'
          : !snapshot.goalModeEnabled && grilling
            ? 'grill'
            : 'chat',
      attachments,
      ...(skills.length ? { skills } : {}),
    },
    sessionName: skills.length
      ? `${skills.map((skill) => `$${skill.name}`).join(' ')} ${text}`.trim()
      : undefined,
    ...(snapshot.goalModeEnabled
      ? {
          goal: {
            objective: snapshot.document.text.trim(),
            ...(typeof snapshot.goalTokenBudget === 'number'
              ? { tokenBudget: snapshot.goalTokenBudget }
              : {}),
          },
        }
      : {}),
  }
}

export function serializeComposerDocument(document: ComposerDraft['document']): string {
  const references = document.tokens
    .filter(
      (token) => token.kind === 'thread' || token.kind === 'browser' || token.kind === 'plugin',
    )
    .sort((left, right) => left.from - right.from)
  let text = ''
  let cursor = 0
  for (const token of references) {
    const offset = Math.max(cursor, Math.min(document.text.length, token.from))
    text += document.text.slice(cursor, offset)
    text +=
      token.kind === 'plugin'
        ? `[@${escapeMarkdownLabel(token.label)}](${token.value})`
        : `[${escapeMarkdownLabel(token.label)}](<${token.value.replace(/>/gu, '%3E')}>)`
    cursor = offset
  }
  return text + document.text.slice(cursor)
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\\[\]])/gu, '\\$1')
}

export async function executeComposerSubmitTransaction({
  draft,
  targetSessionId,
  onPrepared,
  createSession,
  onSessionCreated,
  submitToSession,
}: SubmitTransactionOptions): Promise<ComposerSubmitOutcome> {
  const prepared = prepareComposerSubmission(draft)
  if ('status' in prepared) return prepared
  onPrepared?.(prepared)

  let sessionId = targetSessionId ?? null
  if (!sessionId) {
    if (!createSession) {
      return failed('prepare', '缺少可用的会话目标')
    }
    try {
      sessionId = await createSession(prepared.sessionName, prepared.input.text)
    } catch (error) {
      return failed('create', errorMessageOf(error))
    }
    if (!sessionId) {
      return failed('create', '无法创建新会话')
    }
    onSessionCreated?.(sessionId)
  }

  try {
    const deliveryStatus = await submitToSession(sessionId, prepared.input, {
      inputId: prepared.clientId,
      ...(prepared.goal ? { goal: prepared.goal } : {}),
    })
    return {
      status: deliveryStatus === 'queued' ? 'queued' : 'sent',
      sessionId,
    }
  } catch (error) {
    return failed('send', errorMessageOf(error), sessionId)
  }
}

function failed(
  phase: 'prepare' | 'create' | 'send',
  message: string,
  sessionId?: string,
): ComposerSubmitOutcome {
  return {
    status: 'failed',
    phase,
    message,
    sessionId,
  }
}

/**
 * Creates the task for a new-session submit. A failure here blocks sending, so it is
 * reported exactly once through the global error channel; recovery is another submit,
 * never an inline control.
 */
export async function createTaskSession(input: {
  create: () => Promise<string | null>
  onError?: (message: string) => void
}): Promise<string | null> {
  try {
    const sessionId = await input.create()
    if (!sessionId) input.onError?.('无法创建任务，请重试或选择本地目录。')
    return sessionId
  } catch (error) {
    input.onError?.(toUserErrorMessage(error, 'thread-create'))
    throw error
  }
}

function errorMessageOf(error: unknown): string {
  return toUserErrorMessage(error)
}
