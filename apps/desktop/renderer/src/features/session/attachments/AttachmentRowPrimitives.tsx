import { AnimatePresence, LayoutGroup, motion, useIsPresent, type HTMLMotionProps } from 'motion/react'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import { ChevronUp, Image, ImageOff, X } from 'lucide-react'
import { createContext, forwardRef, isValidElement, useCallback, useContext, useId, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { AppContextMenu } from '../../../components/ui/AppContextMenu.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { desktopClient, desktopClipboard } from '../../../services/desktop-client/index.js'
import { openPathWithPreferredExternalTarget } from '../../../services/ExternalOpenTargetsStore.js'
import { Button } from '../../../components/ui/Button.js'
import { FileTypeIcon } from '../../layout/FileTypeIcon.js'
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
  'attachment-file-pill tw:relative tw:max-w-80 tw:flex-none tw:overflow-visible tw:rounded-full tw:border tw:border-app-border-subtle',
  'tw:bg-app-panel tw:text-app-text-soft tw:transition-colors tw:duration-state',
  'tw:hover:border-app-border tw:hover:bg-app-hover tw:hover:text-app-text',
)
const FILE_PILL_ERROR_CLASS =
  'tw:border-[color-mix(in_srgb,var(--cpx-sys-color-warning)_50%,transparent)] tw:text-app-warning'
const FILE_PILL_OPEN_CLASS = cx(
  'attachment-file-pill__open tw:inline-flex tw:h-7 tw:w-full tw:max-w-80 tw:min-w-0 tw:items-center tw:justify-start tw:gap-1.5',
  'tw:rounded-full tw:border-0 tw:bg-transparent tw:ps-2.5 tw:text-inherit tw:text-start',
  'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-2',
)
const FILE_PILL_OPEN_REMOVABLE_CLASS = 'tw:pe-7'
const FILE_PILL_OPEN_STATIC_CLASS = 'tw:pe-2.5'
const FILE_PILL_ICON_CLASS = 'attachment-file-pill__icon tw:shrink-0 tw:text-app-text-meta'
const FILE_PILL_TEXT_CLASS =
  'attachment-file-pill__text tw:flex tw:min-w-0 tw:items-baseline tw:gap-1 tw:type-caption'
const FILE_PILL_NAME_CLASS = 'attachment-file-pill__name tw:truncate tw:[font:inherit]'
const STACK_TRIGGER_CLASS = cx(
  'attachment-file-row__more tw:group tw:inline-flex tw:h-7 tw:flex-none tw:items-center',
  'tw:rounded-full tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:hover:text-app-text',
  'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-2',
)
const COLLAPSE_PILL_CLASS = cx(
  'attachment-file-row__collapse tw:inline-flex tw:h-7 tw:flex-none tw:items-center tw:justify-center tw:gap-1',
  'tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-panel tw:px-2.5',
  'tw:type-caption tw:text-app-text-soft tw:transition-colors tw:duration-state',
  'tw:hover:border-app-border tw:hover:bg-app-hover tw:hover:text-app-text',
  'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-2',
)
/*
 * `attachment-item-remove` is an IconButton: its ghost surface, radius and
 * shadow come from the shared button contract; only corner placement is local.
 */
const ATTACHMENT_REMOVE_CLASS =
  'attachment-item-remove tw:absolute tw:z-1 tw:-top-1.25 tw:-right-1.25'

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

const AttachmentMotionContext = createContext<{
  disabled: boolean
  report: (token: object, active: boolean) => void
} | null>(null)

function AttachmentTooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  const disabled = useContext(AttachmentMotionContext)?.disabled ?? false
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  return (
    <Tooltip
      content={content}
      open={!disabled && open}
      onOpenChange={(next) => setOpen(!disabled && next)}
      className={disabled ? 'tw:hidden' : undefined}
    >
      {children}
    </Tooltip>
  )
}

function useAttachmentMotionActivity() {
  const report = useContext(AttachmentMotionContext)?.report
  const layoutToken = useRef({})
  const animationToken = useRef({})
  const onLayoutAnimationStart = useCallback(() => report?.(layoutToken.current, true), [report])
  const onLayoutAnimationComplete = useCallback(() => report?.(layoutToken.current, false), [report])
  const onAnimationStart = useCallback(() => report?.(animationToken.current, true), [report])
  const onAnimationComplete = useCallback(() => report?.(animationToken.current, false), [report])
  useEffect(() => () => {
    report?.(layoutToken.current, false)
    report?.(animationToken.current, false)
  }, [report])
  return { onLayoutAnimationStart, onLayoutAnimationComplete, onAnimationStart, onAnimationComplete }
}

const AttachmentMotionDiv = forwardRef<HTMLDivElement, HTMLMotionProps<'div'>>(
  function AttachmentMotionDiv(props, ref) {
    const activity = useAttachmentMotionActivity()
    return <motion.div {...props} {...activity} ref={ref} />
  },
)

const AttachmentMotionSpan = forwardRef<HTMLSpanElement, HTMLMotionProps<'span'>>(
  function AttachmentMotionSpan(props, ref) {
    const activity = useAttachmentMotionActivity()
    return <motion.span {...props} {...activity} ref={ref} />
  },
)

const FILE_ROW_TRANSITION = { type: 'spring', duration: 0.3, bounce: 0 } as const

export function AttachmentFileRow({
  ariaLabel,
  children,
  defaultExpanded = false,
}: {
  ariaLabel: string
  children: ReactNode
  defaultExpanded?: boolean
}): React.ReactNode {
  const childList = Array.isArray(children) ? children : [children]
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [animating, setAnimating] = useState(false)
  const activeAnimations = useRef(new Set<object>())
  const report = useCallback((token: object, active: boolean) => {
    if (active) activeAnimations.current.add(token)
    else activeAnimations.current.delete(token)
    setAnimating(activeAnimations.current.size > 0)
  }, [])
  const reducedMotion = usePrefersReducedMotion()
  const groupId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState<number>()
  const remainingCount = Math.max(0, childList.length - 2)
  const isExpanded = expanded && remainingCount > 0
  const transition = reducedMotion ? { duration: 0 } : FILE_ROW_TRANSITION
  const motionContext = useMemo(
    () => ({ disabled: animating && !reducedMotion, report }),
    [animating, reducedMotion, report],
  )
  const fileId = (child: ReactNode, index: number) =>
    `file-${isValidElement(child) ? child.key ?? index : index}`


  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    // Measure intrinsic content, never the animated viewport or transformed file cards.
    const measure = () => setContentHeight(content.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [isExpanded, children])

  return (
    <AttachmentMotionContext.Provider value={motionContext}>
      <LayoutGroup id={groupId}>
        <AttachmentMotionDiv
          aria-label={ariaLabel}
          role="group"
          data-expanded={isExpanded || undefined}
          className="tw:relative tw:w-full tw:min-w-0"
          initial={false}
          animate={{
            height: reducedMotion ? 'auto' : contentHeight ?? 'auto',
            overflow: 'hidden',
            transitionEnd: { height: 'auto', overflow: 'visible' },
          }}
          transition={transition}
        >
          <div ref={contentRef} className="tw:flex tw:w-full tw:items-start tw:gap-2">
            <div
              className="attachment-horizontal-row__content tw:relative tw:flex tw:min-w-0 tw:flex-1 tw:flex-wrap tw:items-center tw:justify-end tw:gap-2"
            >
              <AnimatePresence initial={false} mode="popLayout">
                {childList.slice(0, isExpanded ? childList.length : 2).map((child, index) => (
                  <AttachmentMotionDiv
                    key={fileId(child, index)}
                    className="tw:relative tw:max-w-full tw:flex-none"
                    layout={reducedMotion ? false : index < 2 ? 'position' : true}
                    layoutId={reducedMotion || index < 2 || index >= 4 ? undefined : fileId(child, index)}
                    initial={reducedMotion || index < 4 ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: reducedMotion || index >= 4 ? 0 : 1 }}
                    transition={transition}
                    style={{ borderRadius: 'var(--cpx-sys-radius-pill)' }}
                  >
                    <AttachmentFileMotionContent animateLayout={!reducedMotion && index >= 2}>
                      {child}
                    </AttachmentFileMotionContent>
                  </AttachmentMotionDiv>
                ))}
              </AnimatePresence>
            </div>
            {remainingCount > 0 ? (
              <AttachmentTooltip content={isExpanded ? '收起文件列表' : `展开其余 ${remainingCount} 个文件`}>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? '收起文件列表' : `展开其余 ${remainingCount} 个文件`}
                  className={cx(
                    isExpanded ? COLLAPSE_PILL_CLASS : STACK_TRIGGER_CLASS,
                    'tw:overflow-visible',
                  )}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp
                        aria-hidden="true"
                        size={APP_ICON_SIZES.sm}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                      <span>收起</span>
                    </>
                  ) : (
                    <span className="tw:relative tw:flex tw:items-center">
                      {childList.slice(2, 4).map((child, stackIndex) => {
                        const index = stackIndex + 2
                        const props = isValidElement(child)
                          ? (child as ReactElement<AttachmentFilePillProps>).props
                          : undefined
                        return (
                          <AttachmentMotionSpan
                            key={fileId(child, index)}
                            aria-hidden="true"
                            layoutId={reducedMotion ? undefined : fileId(child, index)}
                            transition={transition}
                            className={cx(
                              'attachment-file-row__stack-card tw:flex tw:h-7 tw:w-7 tw:shrink-0 tw:items-center tw:justify-center',
                              'tw:rounded-full tw:border tw:border-app-border-subtle tw:shadow-sm',
                              'tw:group-hover:border-app-border',
                              'tw:relative',
                              stackIndex === 1 &&
                                'tw:-ms-4.5 tw:transition-[margin-inline-start] tw:duration-state tw:ease-standard tw:group-hover:-ms-2.5',
                            )}
                            style={{
                              zIndex: stackIndex,
                              borderRadius: 'var(--cpx-sys-radius-pill)',
                            }}
                          >
                            <AttachmentMotionSpan
                              className="tw:flex tw:size-full tw:items-center tw:justify-center"
                              layout={reducedMotion ? false : 'position'}
                              transition={transition}
                            >
                              <FileTypeIcon
                                aria-hidden="true"
                                className={FILE_PILL_ICON_CLASS}
                                path={props?.path ?? props?.name ?? ''}
                                size={APP_ICON_SIZE}
                                strokeWidth={APP_ICON_STROKE_WIDTH}
                              />
                            </AttachmentMotionSpan>
                          </AttachmentMotionSpan>
                        )
                      })}
                      <span
                        aria-hidden="true"
                        className="attachment-file-row__stack-card tw:relative tw:z-2 tw:-ms-4.5 tw:flex tw:h-7 tw:shrink-0 tw:items-center tw:justify-center tw:gap-0.5 tw:rounded-full tw:border tw:border-app-border-subtle tw:px-1.5 tw:shadow-sm tw:transition-[margin-inline-start] tw:duration-state tw:ease-standard tw:group-hover:-ms-2.5 tw:group-hover:border-app-border"
                      >
                        <span className="tw:type-caption tw:tabular-nums tw:text-app-text-meta">
                          +{remainingCount}
                        </span>
                      </span>
                    </span>
                  )}
                </button>
              </AttachmentTooltip>
            ) : null}
          </div>
        </AttachmentMotionDiv>
      </LayoutGroup>
    </AttachmentMotionContext.Provider>
  )
}

function AttachmentFileMotionContent({
  children,
  animateLayout,
}: {
  children: ReactNode
  animateLayout: boolean
}): React.ReactNode {
  const isPresent = useIsPresent()
  return (
    <motion.div
      inert={!isPresent ? true : undefined}
      aria-hidden={!isPresent || undefined}
      layout={animateLayout ? 'position' : false}
      transition={animateLayout ? FILE_ROW_TRANSITION : { duration: 0 }}
    >
      {children}
    </motion.div>
  )
}

type AttachmentImageTileProps = {
  containerRef?: React.Ref<HTMLDivElement>
  errorMessage?: string
  name: string
  onOpen?: () => void
  onRemove?: () => void
  source?: string
  status: 'loading' | 'ready' | 'error'
}

export function AttachmentImageTile({
  containerRef,
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
        <ImageOff aria-hidden="true" size="var(--inline-icon-size, 1em)" />
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
    <div
      ref={containerRef}
      className="attachment-image-tile"
      data-status={status}
      title={errorMessage ?? name}
    >
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
  path?: string
  detail?: string
  error?: boolean
  name: string
  onOpen?: () => void
  onRemove?: () => void
}

export function AttachmentFilePill({
  path,
  error = false,
  name,
  onOpen,
  onRemove,
}: AttachmentFilePillProps): React.ReactNode {
  const tooltipDisabled = useContext(AttachmentMotionContext)?.disabled ?? false
  const content = (
    <>
      <FileTypeIcon
        aria-hidden="true"
        className={FILE_PILL_ICON_CLASS}
        path={path ?? name}
        size={APP_ICON_SIZE}
        strokeWidth={APP_ICON_STROKE_WIDTH}
      />
      <span className={FILE_PILL_TEXT_CLASS}>
        <span className={FILE_PILL_NAME_CLASS}>{name}</span>
      </span>
    </>
  )

  const pill = (
    <div
      className={cx(FILE_PILL_CLASS, error && FILE_PILL_ERROR_CLASS)}
      data-removable={onRemove ? 'true' : undefined}
      data-status={error ? 'error' : 'ready'}
      title={tooltipDisabled || path ? undefined : name}
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
  if (!path) return pill
  return (
    <AppContextMenu
      layout="flex"
      includeEditActions={false}
      actions={[
        {
          kind: 'item',
          label: '打开',
          disabled: !onOpen || error,
          onSelect: () => onOpen?.(),
        },
        {
          kind: 'item',
          label: '使用首选应用打开',
          disabled: error,
          onSelect: () => {
            void openPathWithPreferredExternalTarget(path).catch(() => undefined)
          },
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: '复制路径',
          onSelect: () => {
            void desktopClipboard.writeText(path).catch(() => undefined)
          },
        },
        {
          kind: 'item',
          label: '在文件资源管理器中显示',
          disabled: error,
          onSelect: () => {
            void desktopClient.revealPathInFolder(path).catch(() => undefined)
          },
        },
      ]}
      trigger={<div className="tw:min-w-0 tw:max-w-80 tw:flex-none"><AttachmentTooltip content={path}>{pill}</AttachmentTooltip></div>}
    />
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
