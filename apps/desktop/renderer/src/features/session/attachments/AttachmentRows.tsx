import type { Attachment } from '@pidex/shared/thread'
import {
  AttachmentFilePill,
  AttachmentHorizontalRow,
  AttachmentImageTile,
} from './AttachmentRowPrimitives.js'
import { useThreadAttachmentImageSource } from './UseThreadAttachmentImageSource.js'
import { useBrowserAnnotationManifest } from './UseBrowserAnnotationManifest.js'
import { BrowserAnnotationCard } from '../../browser/BrowserAnnotationCards.js'
import type { BrowserAnnotation } from '@pidex/shared/browser-annotation'

type ThreadAttachmentRowsProps = {
  attachments: readonly Attachment[]
  onOpen?: (attachment: Attachment) => void
  onRemove?: (attachmentId: string) => void
}

export function ThreadAttachmentRows({
  attachments,
  onOpen,
  onRemove,
}: ThreadAttachmentRowsProps): React.ReactNode {
  const manifest = useBrowserAnnotationManifest(attachments)
  const screenshot = (a: BrowserAnnotation) =>
    attachments.find(
      (image) =>
        image.name === a.screenshotName &&
        image.kind === 'image' &&
        image.mediaType === 'image/png',
    )
  const used = new Set(
    manifest?.annotations.flatMap((a) => {
      const image = screenshot(a)
      return image ? [image.id] : []
    }),
  )
  const images = attachments.filter(
    (attachment) => attachment.kind === 'image' && !used.has(attachment.id),
  )
  const files = attachments.filter(
    (attachment) => attachment.kind !== 'image' && attachment.id !== manifest?.id,
  )

  if (attachments.length === 0) return null

  return (
    <div className="thread-attachment-rows tw:grid tw:min-w-0 tw:gap-2">
      {manifest ? (
        <div className="browser-annotation-cards">
          {manifest.annotations.map((a) => {
            const image = screenshot(a)
            return image ? (
              <SentBrowserAnnotation key={a.id} annotation={a} image={image} />
            ) : (
              <BrowserAnnotationCard key={a.id} annotation={a} />
            )
          })}
        </div>
      ) : null}
      {images.length > 0 ? (
        <AttachmentHorizontalRow ariaLabel="图片附件" reverse>
          {images.map((attachment) => (
            <ThreadAttachmentImageTile
              attachment={attachment}
              key={attachment.id}
              onOpen={onOpen}
              onRemove={onRemove}
            />
          ))}
        </AttachmentHorizontalRow>
      ) : null}
      {files.length > 0 ? (
        <AttachmentHorizontalRow ariaLabel="文件附件" reverse>
          {files.map((attachment) => (
            <AttachmentFilePill
              detail={formatAttachmentDetail(attachment)}
              key={attachment.id}
              name={attachment.name}
              onOpen={onOpen ? () => onOpen(attachment) : undefined}
              onRemove={onRemove ? () => onRemove(attachment.id) : undefined}
            />
          ))}
        </AttachmentHorizontalRow>
      ) : null}
    </div>
  )
}
function SentBrowserAnnotation({
  annotation,
  image,
}: {
  annotation: BrowserAnnotation
  image: Attachment
}) {
  const state = useThreadAttachmentImageSource(image)
  return (
    <BrowserAnnotationCard
      annotation={annotation}
      source={state.status === 'ready' ? state.source : undefined}
    />
  )
}

function ThreadAttachmentImageTile({
  attachment,
  onOpen,
  onRemove,
}: {
  attachment: Attachment
  onOpen?: (attachment: Attachment) => void
  onRemove?: (attachmentId: string) => void
}): React.ReactNode {
  const state = useThreadAttachmentImageSource(attachment)

  return (
    <AttachmentImageTile
      errorMessage={state.status === 'error' ? state.message : undefined}
      name={attachment.name}
      onOpen={onOpen ? () => onOpen(attachment) : undefined}
      onRemove={onRemove ? () => onRemove(attachment.id) : undefined}
      source={state.status === 'ready' ? state.source : undefined}
      status={state.status}
    />
  )
}

function formatAttachmentDetail(attachment: Attachment): string {
  const size = formatByteSize(attachment.sizeBytes)
  return `${attachment.mediaType} · ${size}`
}

function formatByteSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}
