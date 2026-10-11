import type { Attachment, AttachmentKind } from '@pidex/core/attachments/Types.js'
import type {
  DesktopComposerAttachment,
  DesktopUserMessageInput,
  DesktopUserMessageContent,
} from './Types.js'

export function hasBlockingComposerAttachmentErrors(
  attachments: DesktopComposerAttachment[] | undefined,
): boolean {
  return (attachments ?? []).some((attachment) => attachment.status === 'error')
}

export function desktopUserMessageInputToPreviewText(input: DesktopUserMessageInput): string {
  const text = input.text.trim()
  const attachments = input.attachments ?? []
  const parts = [
    ...(input.skills?.map((skill) => `$${skill.name}`) ?? []),
    formatCanonicalSkillInvocation(input.skillInvocation, text),
  ]
  if (attachments.length > 0) {
    const attachmentSummary = attachments.map((attachment) => `[${attachment.name}]`).join(' ')
    parts.push(attachmentSummary)
  }
  return parts.filter(Boolean).join(' ')
}

/**
 * Convert a UI-rich DesktopComposerAttachment to the neutral Attachment
 * type used across the protocol and runtime boundary.
 *
 * Strips UI-only fields (id, status, error, previewDataUrl, truncated).
 */
export function desktopAttachmentToAttachment(input: DesktopComposerAttachment): Attachment {
  return {
    kind: input.kind as AttachmentKind,
    name: input.name,
    path: input.path,
    mediaType: input.mediaType,
    sizeBytes: input.sizeBytes,
    contentBase64: input.contentBase64,
    textContent: input.textContent,
  }
}

/**
 * Convert a DesktopUserMessageInput (with UI-rich attachments) to the
 * neutral DesktopUserMessageContent (with core Attachment[]).
 *
 * This is the replacement for the old `buildDesktopUserMessageContent`
 * which produced Anthropic ContentBlockParam[].
 */
export function buildDesktopUserMessageContent(
  input: DesktopUserMessageInput,
): DesktopUserMessageContent {
  const text = input.text.trim()

  return {
    text: formatCanonicalSkillInvocation(input.skillInvocation, text),
    attachments: (input.attachments ?? [])
      .filter((a) => a.status !== 'error' && a.storage !== 'local-path')
      .map(desktopAttachmentToAttachment),
  }
}

export function formatCanonicalSkillInvocation(
  invocation: { name: string; args?: string } | undefined,
  text = '',
): string {
  const body = text.trim()
  if (!invocation) return body
  const args = invocation.args?.trim()
  const command = [`$${invocation.name}`, args].filter(Boolean).join(' ')
  return [command, body].filter(Boolean).join('\n\n')
}
