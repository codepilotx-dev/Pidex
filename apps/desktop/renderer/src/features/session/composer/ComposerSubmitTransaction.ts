import type { DesktopGoalSubmission, DesktopUserMessageInput } from '../../../../shared/Types.js'
import { hasBlockingComposerAttachmentErrors } from '../../../../shared/DesktopUserMessage.js'
import { toUserErrorMessage } from '../../../utils/Errors.js'
import type {
  ComposerDraft,
  ComposerSubmitOutcome,
  PreparedComposerSubmission,
} from './ComposerTypes.js'
import { cloneDraft } from './ComposerDraftStore.js'
import { skillInvocationsFromComposerDocument } from './ComposerSkillToken.js'
import { planTaskFromInput } from './ComposerSlashCommands.js'
import {
  annotationAttachments,
  validateAnnotationCapacity,
} from '../../browser/BrowserAnnotationDraft.js'

export type ComposerDeliveryStatus = 'sent' | 'queued'

type SubmitTransactionOptions = {
  draft: ComposerDraft
  targetSessionId?: string | null
  createSession?: (
    initialSessionName?: string,
    projectlessPrompt?: string,
  ) => Promise<string | null>
  navigateToSession?: (sessionId: string) => void
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
  const planTask = planTaskFromInput(snapshot.document.text)
  if (planTask !== null) {
    const prefixLength = snapshot.document.text.indexOf(planTask)
    snapshot.document = {
      text: planTask,
      tokens: snapshot.document.tokens.map((token) => ({
        ...token,
        from: Math.max(0, Math.min(planTask.length, token.from - prefixLength)),
        to: Math.max(0, Math.min(planTask.length, token.to - prefixLength)),
      })),
    }
    snapshot.goalModeEnabled = false
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
  const skills =
    snapshot.skills ??
    (snapshot.skillInvocation
      ? [snapshot.skillInvocation]
      : skillInvocationsFromComposerDocument(snapshot.document))
  const hasContent = Boolean(text.trim()) || attachments.length > 0 || skills.length > 0

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
      taskMode: planTask !== null || snapshot.collaborationMode === 'plan' ? 'plan' : 'chat',
      attachments,
      ...(skills.length ? { skills } : {}),
    },
    sessionName: skills.length
      ? `${skills.map((skill) => `$${skill.name}`).join(' ')} ${text}`.trim()
      : undefined,
    ...(snapshot.goalModeEnabled ? { goal: { objective: snapshot.document.text.trim() } } : {}),
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
  createSession,
  navigateToSession,
  submitToSession,
}: SubmitTransactionOptions): Promise<ComposerSubmitOutcome> {
  const prepared = prepareComposerSubmission(draft)
  if ('status' in prepared) return prepared

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
    navigateToSession?.(sessionId)
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
