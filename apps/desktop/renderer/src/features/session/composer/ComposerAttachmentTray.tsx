import {
  APP_ICON_SIZES,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZE,
} from '../../../components/ui/IconTokens.js'
import React from 'react'
import type { DesktopComposerAttachment } from '../../../../shared/Types.js'
import { cx } from '../../../utils/Cx.js'
import { resolveDraftAttachmentPreviewContent } from '../attachments/AttachmentPreviewSupport.js'
import {
  AlertCircle,
  Box,
  FileSpreadsheet,
  FileText,
  Music,
  Presentation,
  Video,
  X,
} from 'lucide-react'

/*
 * Composer attachment tray. The horizontal row hides its scrollbar through
 * `src/styles/primitives/composer.css` (vendor pseudo-elements are not
 * utilities); everything else is a static Tailwind class list.
 */
const TRAY_CLASS = cx(
  'composer-attachments composer-attachment-row',
  'tw:mb-2 tw:flex tw:max-w-full tw:items-center tw:gap-3 tw:overflow-x-auto tw:overflow-y-hidden',
  'tw:[overscroll-behavior-inline:contain]',
)
const CHIP_CLASS =
  'composer-attachment-chip tw:relative tw:size-18 tw:flex-none tw:overflow-hidden tw:rounded-3xl tw:transition-[border-color,background-color,transform] tw:duration-state tw:ease-standard'
const CHIP_INTERACTIVE_CLASS = 'tw:cursor-pointer'
const IMAGE_CHIP_CLASS = cx(
  CHIP_CLASS,
  'composer-attachment-chip--image tw:border tw:border-app-border-subtle tw:bg-app-editor',
  'tw:hover:scale-[1.02]',
  'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-2',
)
const FILE_CHIP_CLASS = cx(
  CHIP_CLASS,
  'composer-attachment-chip--file tw:flex tw:flex-col tw:items-start tw:justify-between tw:border tw:border-app-border tw:bg-app-panel tw:p-2',
  'tw:hover:border-app-border-strong tw:hover:bg-app-raised',
  'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-2',
)
const ATTACHMENT_IMAGE_CLASS =
  'composer-attachment-img tw:block tw:size-full tw:select-none tw:object-cover'
const ATTACHMENT_ERROR_BADGE_CLASS =
  'composer-attachment-error-badge tw:absolute tw:bottom-2 tw:left-2 tw:flex tw:size-5 tw:items-center tw:justify-center tw:rounded-full tw:bg-app-panel tw:text-app-text'
const REMOVE_BUTTON_CLASS = cx(
  'composer-attachment-remove-btn',
  'tw:flex tw:size-4.5 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full',
  'tw:bg-app-control tw:text-app-text-soft tw:shadow-sm',
  'tw:transition-[background-color,color] tw:duration-state tw:ease-standard',
  'tw:hover:bg-app-active tw:hover:text-app-text',
)
const REMOVE_BUTTON_OVERLAY_CLASS = cx(
  'composer-attachment-remove-btn composer-attachment-remove-btn--overlay',
  'tw:absolute tw:top-2 tw:right-2 tw:flex tw:size-4.5 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full',
  'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_45%,transparent)] tw:text-app-canvas',
  'tw:transition-[background-color,color] tw:duration-state tw:ease-standard',
  'tw:hover:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_75%,transparent)] tw:hover:text-app-canvas',
)
const TILE_TOP_CLASS =
  'composer-attachment-tile-top tw:flex tw:w-full tw:items-start tw:justify-between'
const BADGE_CLASS =
  'composer-attachment-badge tw:flex tw:size-6 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-sm tw:shadow-sm'
const TILE_ICON_CLASS = 'composer-attachment-tile-icon tw:block'
const ATTACHMENT_NAME_CLASS = cx(
  'composer-attachment-name',
  'tw:w-full tw:type-label tw:text-left tw:text-app-text-soft tw:select-none',
  'tw:truncate',
)

type Props = {
  attachments: DesktopComposerAttachment[]
  onOpen?: (attachment: DesktopComposerAttachment) => void
  onRemove?: (attachmentId: string) => void
}

function resolveFileCategory(name: string, kind: string): { bg: string; icon: React.ReactNode } {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) {
    return {
      bg: '#1a73e8',
      icon: <FileSpreadsheet className={TILE_ICON_CLASS} size={APP_ICON_SIZE} />,
    }
  }
  if (['pptx', 'ppt', 'key'].includes(ext)) {
    return {
      bg: '#9061f9',
      icon: <Presentation className={TILE_ICON_CLASS} size={APP_ICON_SIZE} />,
    }
  }
  if (
    [
      'ts',
      'tsx',
      'js',
      'jsx',
      'json',
      'py',
      'go',
      'rs',
      'c',
      'cpp',
      'html',
      'css',
      'sql',
      'sh',
    ].includes(ext)
  ) {
    return {
      bg: '#00bba7',
      icon: <Box className={TILE_ICON_CLASS} size={APP_ICON_SIZE} />,
    }
  }
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext) || kind === 'audio') {
    return {
      bg: '#f59e0b',
      icon: <Music className={TILE_ICON_CLASS} size={APP_ICON_SIZE} />,
    }
  }
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext) || kind === 'video') {
    return {
      bg: '#ef4444',
      icon: <Video className={TILE_ICON_CLASS} size={APP_ICON_SIZE} />,
    }
  }
  return {
    bg: '#6b7280',
    icon: <FileText className={TILE_ICON_CLASS} size={APP_ICON_SIZE} />,
  }
}

export function ComposerAttachmentTray({ attachments, onOpen, onRemove }: Props): React.ReactNode {
  if (attachments.length === 0) return null

  return (
    <div aria-label="已添加附件" className={TRAY_CLASS}>
      {attachments.map((attachment) => {
        const previewable = resolveDraftAttachmentPreviewContent(attachment) !== null
        const isImage = attachment.kind === 'image'
        const imgSrc =
          attachment.previewDataUrl ||
          (attachment.contentBase64
            ? `data:${attachment.mediaType};base64,${attachment.contentBase64}`
            : '')

        if (isImage && imgSrc) {
          return (
            <div
              className={cx(IMAGE_CHIP_CLASS, previewable && onOpen && CHIP_INTERACTIVE_CLASS)}
              id={`chip-${attachment.id}`}
              key={attachment.id}
              onClick={previewable && onOpen ? () => onOpen(attachment) : undefined}
              onKeyDown={
                previewable && onOpen
                  ? (e) => {
                      if (e.key === 'Enter') onOpen(attachment)
                    }
                  : undefined
              }
              role={previewable && onOpen ? 'button' : undefined}
              tabIndex={previewable && onOpen ? 0 : undefined}
              title={attachment.error ?? attachment.name}
            >
              <img
                alt={attachment.name}
                className={ATTACHMENT_IMAGE_CLASS}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
                src={imgSrc}
              />
              {attachment.status === 'error' && (
                <div
                  className={ATTACHMENT_ERROR_BADGE_CLASS}
                  title={attachment.error ?? '加载失败'}
                >
                  <AlertCircle size={APP_ICON_SIZE} />
                </div>
              )}
              {onRemove && (
                <button
                  aria-label={`移除附件 ${attachment.name}`}
                  className={REMOVE_BUTTON_OVERLAY_CLASS}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(attachment.id)
                  }}
                  title="移除附件"
                  type="button"
                >
                  <X size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </button>
              )}
            </div>
          )
        }

        const category = resolveFileCategory(attachment.name, attachment.kind)
        return (
          <div
            className={cx(FILE_CHIP_CLASS, previewable && onOpen && CHIP_INTERACTIVE_CLASS)}
            id={`chip-${attachment.id}`}
            key={attachment.id}
            onClick={previewable && onOpen ? () => onOpen(attachment) : undefined}
            onKeyDown={
              previewable && onOpen
                ? (e) => {
                    if (e.key === 'Enter') onOpen(attachment)
                  }
                : undefined
            }
            role={previewable && onOpen ? 'button' : undefined}
            tabIndex={previewable && onOpen ? 0 : undefined}
            title={attachment.error ?? attachment.name}
          >
            <div className={TILE_TOP_CLASS}>
              <div
                className={BADGE_CLASS}
                style={{ backgroundColor: category.bg, color: '#ffffff' }}
              >
                {category.icon}
              </div>
              {onRemove && (
                <button
                  aria-label={`移除附件 ${attachment.name}`}
                  className={REMOVE_BUTTON_CLASS}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(attachment.id)
                  }}
                  title="移除附件"
                  type="button"
                >
                  <X size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </button>
              )}
            </div>
            <span className={ATTACHMENT_NAME_CLASS}>{attachment.name}</span>
          </div>
        )
      })}
    </div>
  )
}
