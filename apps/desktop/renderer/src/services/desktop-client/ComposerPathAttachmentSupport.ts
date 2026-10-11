import type {
  DesktopAttachmentIpcBridge,
  DesktopComposerPathGrant,
} from '@pidex/shared/desktop-attachment-ipc'
import type { DesktopComposerAttachment } from '../../../shared/Types.js'

const SNAPSHOT_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export async function composerAttachmentsFromPathGrants(
  grants: readonly DesktopComposerPathGrant[],
  bridge: Pick<DesktopAttachmentIpcBridge, 'readComposerPathGrant'>,
): Promise<DesktopComposerAttachment[]> {
  return Promise.all(grants.map((grant) => composerAttachmentFromPathGrant(grant, bridge)))
}

async function composerAttachmentFromPathGrant(
  grant: DesktopComposerPathGrant,
  bridge: Pick<DesktopAttachmentIpcBridge, 'readComposerPathGrant'>,
): Promise<DesktopComposerAttachment> {
  if (grant.pathKind === 'file' && SNAPSHOT_IMAGE_MEDIA_TYPES.has(grant.mediaType)) {
    if (grant.sizeBytes > MAX_IMAGE_BYTES) {
      return {
        id: crypto.randomUUID(),
        name: grant.name,
        path: grant.path,
        mediaType: grant.mediaType,
        sizeBytes: grant.sizeBytes,
        kind: 'image',
        status: 'error',
        storage: 'managed',
        error: '图片超过 10 MiB 限制。',
      }
    }
    try {
      const preview = await bridge.readComposerPathGrant({ grantId: grant.grantId })
      if (preview.kind !== 'image' || preview.encoding !== 'base64' || !preview.data) {
        throw new Error('图片内容不可用')
      }
      return {
        id: crypto.randomUUID(),
        name: grant.name,
        path: grant.path,
        mediaType: grant.mediaType,
        sizeBytes: grant.sizeBytes,
        kind: 'image',
        status: 'ready',
        storage: 'managed',
        contentBase64: preview.data,
        previewDataUrl: `data:${grant.mediaType};base64,${preview.data}`,
      }
    } catch {
      return {
        id: crypto.randomUUID(),
        name: grant.name,
        path: grant.path,
        mediaType: grant.mediaType,
        sizeBytes: grant.sizeBytes,
        kind: 'image',
        status: 'error',
        storage: 'managed',
        error: '图片读取失败，请重新添加。',
      }
    }
  }

  return {
    id: grant.grantId,
    name: grant.name,
    path: grant.path,
    mediaType: grant.mediaType,
    sizeBytes: grant.sizeBytes,
    kind: grant.pathKind === 'directory' ? 'document' : kindForMediaType(grant.mediaType),
    status: 'ready',
    storage: 'local-path',
    pathKind: grant.pathKind,
    localGrantId: grant.grantId,
  }
}

function kindForMediaType(mediaType: string): DesktopComposerAttachment['kind'] {
  if (mediaType.startsWith('text/')) return 'text'
  if (mediaType.startsWith('audio/')) return 'audio'
  if (mediaType.startsWith('video/')) return 'video'
  if (mediaType === 'application/pdf') return 'document'
  return 'binary'
}
