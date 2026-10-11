import { FileText, Image, ImageOff, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../../../components/ui/Button.js'
import { cx } from '../../../utils/Cx.js'
import {
  APP_ICON_SIZE,
  APP_ICON_SIZES,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/IconTokens.js'

/*
 * Shared attachment rows. The image tile keeps its geometry in
 * `src/styles/primitives/composer.css`: `.canonical-user-message` overrides the
 * tile width/height and the image's object-fit from the features layer, and a
 * utility would outrank that override. The `__detail` bullet stays there too —
 * it is a `::before` pseudo-element.
 */
const HORIZONTAL_ROW_CLASS = cx(
  'attachment-horizontal-row tw:max-w-full tw:w-full tw:overflow-x-auto tw:overflow-y-hidden',
  'tw:[overscroll-behavior-inline:contain]',
)
const HORIZONTAL_ROW_REVERSE_CLASS = 'tw:[direction:rtl]'
const HORIZONTAL_ROW_CONTENT_CLASS =
  'attachment-horizontal-row__content tw:w-max tw:min-w-min tw:flex tw:items-center tw:gap-2'
const HORIZONTAL_ROW_CONTENT_REVERSE_CLASS = 'tw:min-w-full tw:justify-end tw:[direction:ltr]'
const TILE_OPEN_CLASS = cx(
  'attachment-image-tile__open tw:flex tw:size-full tw:min-w-0 tw:min-h-0 tw:items-center tw:justify-center',
  'tw:overflow-hidden tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit',
  'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-2',
)
const TILE_FALLBACK_CLASS =
  'attachment-image-tile__fallback tw:flex tw:size-full tw:items-center tw:justify-center tw:text-app-text-soft'
const TILE_LOADING_CLASS =
  'attachment-image-tile__loading tw:flex tw:size-full tw:items-center tw:justify-center tw:bg-app-editor'
const TILE_ERROR_CLASS = cx(
  'attachment-image-tile__error tw:flex tw:size-full tw:flex-col tw:items-center tw:justify-center tw:gap-1',
  'tw:text-app-warning tw:type-caption',
)
const FILE_PILL_CLASS = cx(
  'attachment-file-pill tw:relative tw:max-w-80 tw:flex-none tw:overflow-visible tw:rounded-full tw:border',
  'tw:bg-app-raised tw:text-app-text',
)
const FILE_PILL_ERROR_CLASS =
  'tw:border-[color-mix(in_srgb,var(--cpx-sys-color-warning)_50%,transparent)]'
const FILE_PILL_OPEN_CLASS = cx(
  'attachment-file-pill__open tw:inline-flex tw:w-full tw:max-w-80 tw:min-w-0 tw:items-center tw:justify-start tw:gap-2',
  'tw:rounded-full tw:border-0 tw:bg-transparent tw:py-2 tw:ps-3 tw:text-inherit tw:text-start',
  'tw:hover:bg-app-hover',
  'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-2',
)
const FILE_PILL_OPEN_REMOVABLE_CLASS = 'tw:pe-6'
const FILE_PILL_OPEN_STATIC_CLASS = 'tw:pe-3'
const FILE_PILL_ICON_CLASS = 'attachment-file-pill__icon tw:shrink-0 tw:text-app-text'
const FILE_PILL_TEXT_CLASS =
  'attachment-file-pill__text tw:flex tw:min-w-0 tw:items-baseline tw:gap-1 tw:type-row-title'
const FILE_PILL_NAME_CLASS = 'attachment-file-pill__name tw:truncate tw:[font:inherit]'
const FILE_PILL_DETAIL_CLASS =
  'attachment-file-pill__detail tw:min-w-0 tw:truncate tw:type-caption tw:text-app-text-meta'
const FILE_PILL_DETAIL_ERROR_CLASS = 'tw:text-app-warning'
/*
 * `attachment-item-remove` is an IconButton: its ghost surface, radius and
 * shadow come from the shared button contract, while the stylesheet only adds
 * the corner placement and the surface it takes on hover.
 */
const ATTACHMENT_REMOVE_CLASS =
  'attachment-item-remove tw:absolute tw:z-1 tw:-top-1.25 tw:-right-1.25 tw:hover:bg-app-control tw:hover:text-app-text'

type AttachmentHorizontalRowProps = {
  ariaLabel: string
  children: ReactNode
  reverse?: boolean
}

export function AttachmentHorizontalRow({
  ariaLabel,
  children,
  reverse = false,
}: AttachmentHorizontalRowProps): React.ReactNode {
  return (
    <div
      aria-label={ariaLabel}
      className={cx(HORIZONTAL_ROW_CLASS, reverse && HORIZONTAL_ROW_REVERSE_CLASS)}
      data-reverse={reverse || undefined}
      role="group"
    >
      <div
        className={cx(
          HORIZONTAL_ROW_CONTENT_CLASS,
          reverse && HORIZONTAL_ROW_CONTENT_REVERSE_CLASS,
        )}
      >
        {children}
      </div>
    </div>
  )
}

type AttachmentImageTileProps = {
  errorMessage?: string
  name: string
  onOpen?: () => void
  onRemove?: () => void
  source?: string
  status: 'loading' | 'ready' | 'error'
}

export function AttachmentImageTile({
  errorMessage,
  name,
  onOpen,
  onRemove,
  source,
  status,
}: AttachmentImageTileProps): React.ReactNode {
  const content =
    status === 'loading' ? (
      <span aria-label={`${name} 正在加载`} className={TILE_LOADING_CLASS} />
    ) : status === 'error' ? (
      <span className={TILE_ERROR_CLASS}>
        <ImageOff aria-hidden="true" size={APP_ICON_SIZE} />
        <span>加载失败</span>
      </span>
    ) : source ? (
      <img alt={name} className="attachment-image-tile__image" src={source} />
    ) : (
      <span className={TILE_FALLBACK_CLASS}>
        <Image aria-hidden="true" size={APP_ICON_SIZE} />
      </span>
    )

  return (
    <div className="attachment-image-tile" data-status={status} title={errorMessage ?? name}>
      {onOpen ? (
        <button
          aria-label={`打开 ${name}`}
          className={TILE_OPEN_CLASS}
          onClick={onOpen}
          type="button"
        >
          {content}
        </button>
      ) : (
        <span className={TILE_OPEN_CLASS}>{content}</span>
      )}
      {onRemove ? <AttachmentRemoveButton name={name} onRemove={onRemove} /> : null}
    </div>
  )
}

type AttachmentFilePillProps = {
  detail?: string
  error?: boolean
  name: string
  onOpen?: () => void
  onRemove?: () => void
}

export function AttachmentFilePill({
  detail,
  error = false,
  name,
  onOpen,
  onRemove,
}: AttachmentFilePillProps): React.ReactNode {
  const content = (
    <>
      <FileText aria-hidden="true" className={FILE_PILL_ICON_CLASS} size={APP_ICON_SIZE} />
      <span className={FILE_PILL_TEXT_CLASS}>
        <span className={FILE_PILL_NAME_CLASS}>{name}</span>
        {detail ? (
          <span className={cx(FILE_PILL_DETAIL_CLASS, error && FILE_PILL_DETAIL_ERROR_CLASS)}>
            {detail}
          </span>
        ) : null}
      </span>
    </>
  )

  return (
    <div
      className={cx(FILE_PILL_CLASS, error && FILE_PILL_ERROR_CLASS)}
      data-removable={onRemove ? 'true' : undefined}
      data-status={error ? 'error' : 'ready'}
      title={detail ? `${name} · ${detail}` : name}
    >
      {onOpen ? (
        <button
          aria-label={`打开 ${name}`}
          className={cx(
            FILE_PILL_OPEN_CLASS,
            onRemove ? FILE_PILL_OPEN_REMOVABLE_CLASS : FILE_PILL_OPEN_STATIC_CLASS,
          )}
          onClick={onOpen}
          type="button"
        >
          {content}
        </button>
      ) : (
        <span
          className={cx(
            FILE_PILL_OPEN_CLASS,
            onRemove ? FILE_PILL_OPEN_REMOVABLE_CLASS : FILE_PILL_OPEN_STATIC_CLASS,
          )}
        >
          {content}
        </span>
      )}
      {onRemove ? <AttachmentRemoveButton name={name} onRemove={onRemove} /> : null}
    </div>
  )
}

function AttachmentRemoveButton({
  name,
  onRemove,
}: {
  name: string
  onRemove: () => void
}): React.ReactNode {
  return (
    <Button
      isIconOnly
      className={ATTACHMENT_REMOVE_CLASS}
      color="ghostSecondary"
      onClick={(event) => {
        event.stopPropagation()
        onRemove()
      }}
      size="iconMd"
      title={`移除 ${name}`}
    >
      <X aria-hidden="true" size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
    </Button>
  )
}
