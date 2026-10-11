import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import type { DesktopUserMessageInput } from '../../../shared/Types.js'

const MAX_ATTACHMENTS_PER_MESSAGE = 8
type AgentAttachmentUpload = RpcParams<'attachment/import'>['uploads'][number]
type AgentAttachmentReadResult = RpcResult<'attachment/read'>

export async function buildAgentAttachmentUploads(
  input: DesktopUserMessageInput,
  readAttachment: (attachmentId: string) => Promise<AgentAttachmentReadResult>,
): Promise<AgentAttachmentUpload[]> {
  const retainedAttachmentIds = [...new Set((input.retainedAttachmentIds ?? []).filter(Boolean))]
  const seenDraftAttachmentIds = new Set<string>()
  const draftAttachments = (input.attachments ?? []).filter((attachment) => {
    if (attachment.storage === 'local-path') return false
    if (retainedAttachmentIds.includes(attachment.id) || seenDraftAttachmentIds.has(attachment.id))
      return false
    seenDraftAttachmentIds.add(attachment.id)
    return true
  })
  const retainedContextReferenceIds = new Set(
    (input.retainedContextReferenceIds ?? []).filter(Boolean),
  )
  const localPathCount = new Set(
    (input.attachments ?? [])
      .filter((attachment) => attachment.storage === 'local-path')
      .map((attachment) => attachment.path.toLocaleLowerCase()),
  ).size
  if (
    retainedAttachmentIds.length +
      retainedContextReferenceIds.size +
      draftAttachments.length +
      localPathCount >
    MAX_ATTACHMENTS_PER_MESSAGE
  ) {
    throw new Error(`每次最多发送 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件。`)
  }

  const retainedUploads = await Promise.all(
    retainedAttachmentIds.map(async (attachmentId) => {
      const result = await readAttachment(attachmentId)
      const { attachment, data, encoding } = result
      if (attachment.kind === 'image') {
        if (encoding !== 'base64' || !data) {
          throw new Error(`图片附件 ${attachment.name} 缺少内容。`)
        }
        return {
          kind: 'image' as const,
          name: attachment.name,
          mediaType: attachment.mediaType,
          data,
          encoding,
        }
      }
      return {
        kind: 'text' as const,
        name: attachment.name,
        mediaType: attachment.mediaType || 'text/plain',
        data,
        encoding,
      }
    }),
  )
  const draftUploads = draftAttachments.map<AgentAttachmentUpload>((attachment) => {
    if (attachment.status !== 'ready') {
      throw new Error(`附件 ${attachment.name} 尚未准备完成。`)
    }
    if (attachment.kind === 'image') {
      const data =
        attachment.contentBase64 ?? attachment.previewDataUrl?.replace(/^data:[^;]+;base64,/, '')
      if (!data) throw new Error(`图片附件 ${attachment.name} 缺少内容。`)
      return {
        kind: 'image',
        name: attachment.name,
        mediaType: attachment.mediaType,
        data,
        encoding: 'base64',
      }
    }
    if (typeof attachment.textContent !== 'string' || attachment.truncated) {
      throw new Error(`附件 ${attachment.name} 不是完整的 UTF-8 文本或受支持图片。`)
    }
    return {
      kind: 'text',
      name: attachment.name,
      mediaType: attachment.mediaType || 'text/plain',
      data: attachment.textContent,
      encoding: 'utf8',
    }
  })
  return [...retainedUploads, ...draftUploads]
}
