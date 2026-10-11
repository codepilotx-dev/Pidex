import type { Attachment, LocalContextReference } from '@pidex/shared/thread'
import type { DesktopComposerAttachment } from '../../../../shared/Types.js'
import type { UserAttachmentPreviewTab } from '../../layout/dock/RightDockState.js'
import { resolveDraftAttachmentPreviewContent } from './AttachmentPreviewSupport.js'

export function createThreadAttachmentPreviewTab(
  attachment: Attachment,
): UserAttachmentPreviewTab | null {
  if (attachment.kind !== 'image' && attachment.kind !== 'text') return null
  return {
    id: 'user-attachment-preview',
    kind: 'attachment-preview',
    attachment: {
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
    },
    source: { storage: 'thread', attachmentId: attachment.id },
  }
}

export function createDraftAttachmentPreviewTab(
  attachment: DesktopComposerAttachment,
): UserAttachmentPreviewTab | null {
  if (attachment.storage === 'local-path' && attachment.localGrantId) {
    return {
      id: 'user-attachment-preview',
      kind: 'attachment-preview',
      attachment: {
        id: attachment.id,
        kind:
          attachment.pathKind === 'directory'
            ? 'directory'
            : attachment.kind === 'image' || attachment.kind === 'text'
              ? attachment.kind
              : 'binary',
        name: attachment.name,
        mediaType: attachment.mediaType,
        sizeBytes: attachment.sizeBytes,
      },
      source: { storage: 'draft-path', grantId: attachment.localGrantId },
    }
  }
  const content = resolveDraftAttachmentPreviewContent(attachment)
  return content ? createDraftTab(attachment, content.kind, content.data, content.encoding) : null
}

export function createThreadLocalContextPreviewTab(
  threadId: string,
  reference: LocalContextReference,
): UserAttachmentPreviewTab {
  return {
    id: 'user-attachment-preview',
    kind: 'attachment-preview',
    attachment: {
      id: reference.id,
      kind: reference.kind === 'directory' ? 'directory' : 'binary',
      name: reference.name,
      mediaType: 'application/octet-stream',
      sizeBytes: 0,
    },
    source: {
      storage: 'thread-path',
      threadId,
      referenceId: reference.id,
    },
  }
}

export type ThreadArtifactPreviewInput = {
  artifactId: string
  name: string
  mimeType: string
  sizeBytes: number | null
  previewKind: 'image' | 'text' | 'binary'
}

export function createThreadArtifactPreviewTab(
  threadId: string,
  artifact: ThreadArtifactPreviewInput,
): UserAttachmentPreviewTab {
  return {
    id: 'user-attachment-preview',
    kind: 'attachment-preview',
    attachment: {
      id: artifact.artifactId,
      kind:
        artifact.previewKind === 'image' || artifact.previewKind === 'text'
          ? artifact.previewKind
          : 'binary',
      name: artifact.name,
      mediaType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes ?? 0,
    },
    source: {
      storage: 'artifact',
      threadId,
      artifactId: artifact.artifactId,
    },
  }
}

export function canPreviewDraftAttachment(attachment: DesktopComposerAttachment): boolean {
  return createDraftAttachmentPreviewTab(attachment) !== null
}

function createDraftTab(
  attachment: DesktopComposerAttachment,
  kind: 'image' | 'text',
  data: string,
  encoding: 'base64' | 'utf8',
): UserAttachmentPreviewTab {
  return {
    id: 'user-attachment-preview',
    kind: 'attachment-preview',
    attachment: {
      id: attachment.id,
      kind,
      name: attachment.name,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
    },
    source: { storage: 'draft', data, encoding },
  }
}
