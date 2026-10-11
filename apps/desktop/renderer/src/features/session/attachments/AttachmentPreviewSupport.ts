import type { DesktopComposerAttachment } from '../../../../shared/Types.js'

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export type DraftAttachmentPreviewContent = {
  kind: 'image' | 'text'
  data: string
  encoding: 'base64' | 'utf8'
}

export function resolveDraftAttachmentPreviewContent(
  attachment: DesktopComposerAttachment,
): DraftAttachmentPreviewContent | null {
  if (attachment.status !== 'ready' || attachment.truncated === true) return null

  if (attachment.kind === 'image' && SUPPORTED_IMAGE_MEDIA_TYPES.has(attachment.mediaType)) {
    const data =
      attachment.contentBase64 ?? extractBase64Data(attachment.previewDataUrl, attachment.mediaType)
    return data === null || data === undefined ? null : { kind: 'image', data, encoding: 'base64' }
  }

  if (
    (attachment.kind === 'text' || attachment.kind === 'document') &&
    typeof attachment.textContent === 'string'
  ) {
    return { kind: 'text', data: attachment.textContent, encoding: 'utf8' }
  }

  return null
}

function extractBase64Data(previewDataUrl: string | undefined, mediaType: string): string | null {
  if (!previewDataUrl) return null
  const prefix = `data:${mediaType};base64,`
  return previewDataUrl.startsWith(prefix) ? previewDataUrl.slice(prefix.length) : null
}
