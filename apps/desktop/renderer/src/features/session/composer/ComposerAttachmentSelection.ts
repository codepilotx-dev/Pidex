import type { DesktopComposerAttachment } from '../../../../shared/Types.js'

export async function selectDroppedComposerAttachments(
  files: FileList,
  pathForFile: (file: File) => string,
  grantPaths: (paths: string[]) => Promise<DesktopComposerAttachment[]>,
): Promise<DesktopComposerAttachment[]> {
  const paths: string[] = []
  const clipboardImages: File[] = []
  for (const file of Array.from(files)) {
    const path = pathForFile(file)
    if (path) paths.push(path)
    else if (file.type.startsWith('image/')) clipboardImages.push(file)
  }
  const [pathAttachments, images] = await Promise.all([
    grantPaths(paths),
    Promise.all(clipboardImages.map(readClipboardImageAttachment)),
  ])
  return [...pathAttachments, ...images]
}

export function mergeComposerAttachments(
  current: readonly DesktopComposerAttachment[],
  incoming: readonly DesktopComposerAttachment[],
): { accepted: DesktopComposerAttachment[]; error: string | null } {
  const existingKeys = new Set(current.map(composerAttachmentKey))
  const unique = incoming.filter((attachment) => {
    const key = composerAttachmentKey(attachment)
    if (existingKeys.has(key)) return false
    existingKeys.add(key)
    return true
  })
  const available = Math.max(0, 8 - current.length)
  const accepted = unique.slice(0, available)
  let error: string | null = null
  if (unique.length > available) {
    error = '每条消息最多添加 8 个附件项。'
    if (available > 0) accepted.splice(-1, 1, errorAttachment('attachment-limit', error))
  }
  const managedBytes = [...current, ...accepted]
    .filter((attachment) => attachment.storage !== 'local-path')
    .reduce((total, attachment) => total + attachment.sizeBytes, 0)
  if (managedBytes > 25 * 1024 * 1024 && accepted.length > 0) {
    error = '图片与托管附件总量不能超过 25 MiB。'
    accepted.splice(-1, 1, errorAttachment('attachment-size', error))
  }
  return { accepted, error: available === 0 ? error : null }
}

async function readClipboardImageAttachment(file: File): Promise<DesktopComposerAttachment> {
  if (file.size > 10 * 1024 * 1024) {
    return errorAttachment('clipboard-image-size', '图片超过 10 MiB 限制。', file)
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('剪贴板图片读取失败'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
  const prefix = `data:${file.type};base64,`
  if (!dataUrl.startsWith(prefix)) throw new Error('剪贴板图片格式不受支持')
  return {
    id: crypto.randomUUID(),
    name: file.name || 'clipboard-image.png',
    path: '',
    mediaType: file.type,
    sizeBytes: file.size,
    kind: 'image',
    status: 'ready',
    storage: 'managed',
    contentBase64: dataUrl.slice(prefix.length),
    previewDataUrl: dataUrl,
  }
}

function composerAttachmentKey(attachment: DesktopComposerAttachment): string {
  if (attachment.path) return `path:${attachment.path.toLocaleLowerCase()}`
  return `id:${attachment.id}`
}

function errorAttachment(prefix: string, error: string, file?: File): DesktopComposerAttachment {
  return {
    id: `${prefix}:${crypto.randomUUID()}`,
    name: file?.name || '附件未添加',
    path: '',
    mediaType: file?.type || 'application/octet-stream',
    sizeBytes: file?.size ?? 0,
    kind: file ? 'image' : 'binary',
    status: 'error',
    ...(file ? { storage: 'managed' as const } : {}),
    error,
  }
}
