import React from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  ClipboardCheck,
  FileDiff,
  Globe2,
  Split,
  Hourglass,
  LoaderCircle,
  ListChecks,
  MessageCircleQuestion,
  NotepadText,
  Pencil,
  RotateCcw,
  Send,
  Shield,
  UserRoundPlus,
  type LucideIcon,
} from 'lucide-react'
import type {
  Attachment,
  Input,
  Item,
  LocalContextReference,
  ToolResultBlock,
} from '@pidex/shared/thread'
import { decodeResultCardEnvelope, type ResultCard } from '@pidex/shared/thread-result-card'
import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import type { DesktopDiffMarkerStyle } from '../../../../shared/Types.js'
import { desktopUserMessageInputToPreviewText } from '../../../../shared/DesktopUserMessage.js'
import type { ComposerEditorHandle, ComposerEditorProps } from '../composer/ComposerEditor.js'

import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'

import { Tooltip } from '../../../components/ui/Tooltip.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import {
  type KeyedDisclosureStore,
  useDisclosureExpanded,
} from '../../../components/ui/KeyedDisclosureStore.js'
import { CodeBlock } from '../../syntax/CodeBlock.js'
import { MarkdownMessage } from '../../markdown/index.js'
import { ConversationMarkdownErrorBoundary } from '../conversation/ConversationTurnErrorBoundary.js'
import { CollapsibleUserMarkdown } from '../conversation/CollapsibleUserMarkdown.js'
import { subagentStatusLabel } from '../subagents/SubagentStatusLabel.js'
import { useScrollEdgeState } from '../../../hooks/UseScrollEdgeState.js'
import { useConversationItemContext } from './ConversationItemContext.js'
import { useLiveItemTail } from '../state/UseLiveItemTail.js'
import { countStreamingItemRender } from '../state/StreamingPerfCounters.js'
import { WorkflowPlanCard, type OpenPlanInDockRequest } from '../workflow/WorkflowPlanCard.js'
import { AttachmentFilePill, AttachmentImageTile } from '../attachments/AttachmentRowPrimitives.js'
import { useToolArtifactImageSource } from './UseToolArtifactImageSource.js'
import {
  buildToolSemanticSummary,
  ToolActivityHeader,
  ToolActivityLabel,
  toolSemanticIcon,
  type ToolActivityIconKind,
  type ToolSemanticKind,
  type ToolSemanticSummary,
} from './ToolActivityPresentation.js'
import { isSchedulePlanTool, SchedulePlanCard } from './SchedulePlanCard.js'
import { QuestionItemView } from './QuestionItemView.js'
import { CopyButton } from './CopyButton.js'
import { isShellTool, ToolCommandCard, toolDetailKind } from './ToolCommandCard.js'
export { isShellTool } from './ToolCommandCard.js'
import { cx } from '../../../utils/Cx.js'
import { ResultCardView } from './ResultCardView.js'
import { safeCitationUrl } from './CitationUrl.js'

export {
  buildToolSemanticSummary,
  cleanCommandSummary,
  formatToolDuration,
  toolSemanticIcon,
} from './ToolActivityPresentation.js'
export type { ToolSemanticKind } from './ToolActivityPresentation.js'

const LazyExpandableFileMutationRow = React.lazy(async () => {
  const module = await import('./ExpandableFileMutationRow.js')
  return { default: module.ExpandableFileMutationRow }
})

const LazyComposerEditor = React.lazy(async () => {
  const module = await import('../composer/ComposerEditor.js')
  return {
    default: module.ComposerEditor as React.ForwardRefExoticComponent<
      ComposerEditorProps & React.RefAttributes<ComposerEditorHandle>
    >,
  }
})

const LazyThreadAttachmentRows = React.lazy(async () => {
  const module = await import('../attachments/AttachmentRows.js')
  return { default: module.ThreadAttachmentRows }
})

const LazyLocalContextRows = React.lazy(async () => {
  const module = await import('../attachments/LocalContextRows.js')
  return { default: module.LocalContextRows }
})

type ItemOf<T extends Item['type']> = Extract<Item, { type: T }>
type ToolItem = ItemOf<'tool'>

export type FileChangeDisplay = {
  additions: number | null
  deletions: number | null
  operation?: 'write' | 'create' | 'update' | 'delete'
  patch?: string | null
  path: string
}

export type FileMutationDisplay = {
  files: FileChangeDisplay[]
  state: ToolItem['state']
  toolItemId: string
  totalAdditions: number | null
  totalDeletions: number | null
}

export type PatchDisplay = {
  actionVersion?: number
  applyState?: 'applied' | 'undone'
  files: FileChangeDisplay[]
  id: string
  reversible?: boolean
  totalAdditions: number | null
  totalDeletions: number | null
}

export type PatchAction = 'undo' | 'reapply'

export function patchFilesForDisplay(
  files: readonly FileChangeDisplay[],
  expanded: boolean,
): readonly FileChangeDisplay[] {
  return expanded ? files : files.slice(0, 3)
}

export type ToolItemDisplay = {
  active: boolean
  canExpand: boolean
  collapsedLabel: string
  executionContent: string
  expandedLabel: string
  failed: boolean
  iconKind: ToolActivityIconKind
  resultText: string | null
  semanticSummary: ToolSemanticSummary | null
  statusLabel: string
  semanticKind: ToolSemanticKind
  toolLabel: string
}

export type StructuredToolDetail = {
  executionContent: string
  resultText: string | null
}

export type LifecycleToolDisplay = {
  active: boolean
  failed: boolean
  icon: LucideIcon
  label: string
  toolLabel: string
}

export type CanonicalItemDisclosure = {
  id: string
  store: KeyedDisclosureStore
}

export type ResolvedCanonicalItemDisclosure = {
  id: string
  expanded: boolean
  onExpandedChange: (id: string, expanded: boolean) => void
}

export type ReadThreadPatchDiff = (
  params: RpcParams<'thread/patch/diff'>,
) => Promise<RpcResult<'thread/patch/diff'>>

export type CanonicalItemRendererProps = {
  disclosure?: CanonicalItemDisclosure
  item: Item
  onApplyPatch?: (itemId: string, action: PatchAction, expectedVersion: number) => Promise<void>
  onOpenPatchReview?: (path?: string) => void
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void
  onOpenSubagent: (taskId: string) => void
  rightDockPlanEventId: string | null
  showAssistantActions?: boolean
  /** @default "standalone" — "grouped" applies tighter spacing inside a process group. */
  presentation?: 'standalone' | 'grouped'
  /** Thread scope used to resolve tool artifact content. */
  threadId?: string
}

export function CanonicalUserInput({
  attachments,
  contextReferences,
  input,
  registerInputRow,
}: {
  attachments: readonly Attachment[]
  contextReferences: readonly LocalContextReference[]
  input: Input
  registerInputRow?: (inputId: string, node: HTMLElement | null) => void
}): React.ReactNode {
  const inputRef = React.useCallback(
    (node: HTMLElement | null) => registerInputRow?.(input.id, node),
    [input.id, registerInputRow],
  )
  const {
    canCopyFileReferenceContents,
    onCopyFileReferenceContents,
    onOpenFileReference,
    onOpenAttachment,
    onOpenLocalContext,
    onSubmitEditedUserMessage,
    sessionStatus,
    workspacePath,
  } = useConversationItemContext()
  const [editing, setEditing] = React.useState(false)
  const displayText = input.skills?.length
    ? desktopUserMessageInputToPreviewText({ text: input.content, skills: input.skills })
    : input.content
  const [draft, setDraft] = React.useState(input.content)
  const [retainedAttachmentIds, setRetainedAttachmentIds] = React.useState<string[]>(() => [
    ...(input.attachmentIds ?? []),
  ])
  const [retainedContextReferenceIds, setRetainedContextReferenceIds] = React.useState<string[]>(
    () => [...(input.contextReferenceIds ?? [])],
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const editorRef = React.useRef<ComposerEditorHandle | null>(null)
  const retainedAttachments = React.useMemo(
    () => attachments.filter((attachment) => retainedAttachmentIds.includes(attachment.id)),
    [attachments, retainedAttachmentIds],
  )
  const retainedContextReferences = React.useMemo(
    () =>
      contextReferences.filter((reference) => retainedContextReferenceIds.includes(reference.id)),
    [contextReferences, retainedContextReferenceIds],
  )
  const canSubmit =
    (draft.trim().length > 0 || Boolean(input.skills?.length)) &&
    !submitting &&
    sessionStatus !== 'running' &&
    sessionStatus !== 'waiting'

  React.useEffect(() => {
    setDraft(input.content)
    setRetainedAttachmentIds([...(input.attachmentIds ?? [])])
    setRetainedContextReferenceIds([...(input.contextReferenceIds ?? [])])
    setSubmitError(null)
    setEditing(false)
  }, [input.content, input.id])

  React.useEffect(() => {
    if (!editing) return
    const frame = window.requestAnimationFrame(() => editorRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [editing])

  const cancelEditing = (): void => {
    setDraft(input.content)
    setRetainedAttachmentIds([...(input.attachmentIds ?? [])])
    setRetainedContextReferenceIds([...(input.contextReferenceIds ?? [])])
    setSubmitError(null)
    setEditing(false)
  }

  const startEditing = (): void => {
    setDraft(input.content)
    setRetainedAttachmentIds([...(input.attachmentIds ?? [])])
    setRetainedContextReferenceIds([...(input.contextReferenceIds ?? [])])
    setSubmitError(null)
    setEditing(true)
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSubmitEditedUserMessage({
        text: draft.trim(),
        ...(input.skills ? { skills: input.skills } : {}),
        retainedAttachmentIds,
        retainedContextReferenceIds,
      })
      setEditing(false)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '消息发送失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  if (editing) {
    return (
      <article
        ref={inputRef}
        data-input-navigation-id={input.id}
        className="canonical-user-message canonical-user-message--editing"
      >
        <div className="canonical-user-message__editor-surface">
          {retainedAttachments.length > 0 ? (
            <React.Suspense fallback={null}>
              <LazyThreadAttachmentRows
                attachments={retainedAttachments}
                onOpen={onOpenAttachment}
                onRemove={(attachmentId) =>
                  setRetainedAttachmentIds((current) => current.filter((id) => id !== attachmentId))
                }
              />
            </React.Suspense>
          ) : null}
          {retainedContextReferences.length > 0 ? (
            <React.Suspense fallback={null}>
              <LazyLocalContextRows
                references={retainedContextReferences}
                onOpen={onOpenLocalContext}
                onRemove={(referenceId) =>
                  setRetainedContextReferenceIds((current) =>
                    current.filter((id) => id !== referenceId),
                  )
                }
              />
            </React.Suspense>
          ) : null}
          <React.Suspense fallback={null}>
            <LazyComposerEditor
              ariaDescribedBy={submitError ? `edit-error-${input.id}` : undefined}
              ariaExpanded={false}
              onChange={setDraft}
              onCompositionChange={() => undefined}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelEditing()
                  return true
                }
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void submit()
                  return true
                }
                return false
              }}
              onSelectionChange={() => undefined}
              placeholder="修改消息"
              ref={editorRef}
              value={draft}
            />
          </React.Suspense>
          {submitError ? (
            <p
              className="canonical-user-message__editor-error"
              id={`edit-error-${input.id}`}
              role="alert"
            >
              {submitError}
            </p>
          ) : null}
          <div className="canonical-user-message__editor-actions">
            <Button color="secondary" onClick={cancelEditing}>
              取消
            </Button>
            <Button
              color="primary"
              disabled={!canSubmit}
              loading={submitting}
              onClick={() => void submit()}
            >
              发送
            </Button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article ref={inputRef} data-input-navigation-id={input.id} className="canonical-user-message">
      {attachments.length > 0 ? (
        <React.Suspense fallback={null}>
          <LazyThreadAttachmentRows attachments={attachments} onOpen={onOpenAttachment} />
        </React.Suspense>
      ) : null}
      {contextReferences.length > 0 ? (
        <React.Suspense fallback={null}>
          <LazyLocalContextRows references={contextReferences} onOpen={onOpenLocalContext} />
        </React.Suspense>
      ) : null}
      <div className="canonical-user-message__bubble" data-user-message-bubble>
        <CollapsibleUserMarkdown
          inlinePrefix={
            input.skills?.length ? (
              <>
                {input.skills.map((skill) => (
                  <React.Fragment key={skill.path}>
                    <span className="composer-inline-skill-token">
                      <span className="composer-inline-skill-token-label">${skill.name}</span>
                    </span>{' '}
                  </React.Fragment>
                ))}
              </>
            ) : undefined
          }
          canCopyFileReferenceContents={canCopyFileReferenceContents}
          cwd={workspacePath}
          onCopyFileReferenceContents={onCopyFileReferenceContents}
          onOpenFileReference={onOpenFileReference}
          text={input.content}
        />
      </div>
      <div className="canonical-message-actions" aria-label="用户消息操作">
        <CopyButton text={displayText} />
        <Tooltip content="修改并重新发送">
          <Button
            isIconOnly
            aria-label="修改并重新发送"
            color="ghostSecondary"
            size="toolbar"
            title="修改并重新发送"
            onClick={startEditing}
          >
            <Pencil aria-hidden="true" size={APP_ICON_SIZE} />
          </Button>
        </Tooltip>
      </div>
    </article>
  )
}

/**
 * Reasoning and question disclosures reuse the ordinary activity row geometry
 * and hover/focus states.
 */
export const PROCESS_CARD_SUMMARY_CLASS =
  'canonical-process-card__summary cpx-agent-activity__item-header'

export function CanonicalItemRenderer({
  disclosure,
  ...props
}: CanonicalItemRendererProps): React.ReactNode {
  if (disclosure) {
    return <SubscribedCanonicalItemRenderer {...props} disclosure={disclosure} />
  }
  return <CanonicalItemRendererContent {...props} />
}

type CanonicalItemRendererContentProps = Omit<CanonicalItemRendererProps, 'disclosure'> & {
  disclosure?: ResolvedCanonicalItemDisclosure
}

/**
 * 流式期间同一 turn 会整体重渲染；只有 item 引用变化的条目才真正需要重渲染。
 * 比较器只比较会影响输出的字段，且依赖上层传入稳定回调（disclosure 由
 * SubscribedCanonicalItemRenderer 的 useMemo 固定），否则 memo 会失效。
 */
const CanonicalItemRendererContent = React.memo(
  CanonicalItemRendererContentComponent,
  areCanonicalItemRendererPropsEqual,
)

function areCanonicalItemRendererPropsEqual(
  previous: CanonicalItemRendererContentProps,
  next: CanonicalItemRendererContentProps,
): boolean {
  return (
    previous.item === next.item &&
    previous.threadId === next.threadId &&
    previous.presentation === next.presentation &&
    previous.rightDockPlanEventId === next.rightDockPlanEventId &&
    previous.showAssistantActions === next.showAssistantActions &&
    previous.disclosure === next.disclosure &&
    previous.onApplyPatch === next.onApplyPatch &&
    previous.onOpenPatchReview === next.onOpenPatchReview &&
    previous.onOpenPlanInRightDock === next.onOpenPlanInRightDock &&
    previous.onOpenSubagent === next.onOpenSubagent
  )
}

function SubscribedCanonicalItemRenderer({
  disclosure,
  ...props
}: Omit<CanonicalItemRendererProps, 'disclosure'> & {
  disclosure: CanonicalItemDisclosure
}): React.ReactNode {
  const expanded = useDisclosureExpanded(disclosure.store, disclosure.id)
  const resolvedDisclosure = React.useMemo<ResolvedCanonicalItemDisclosure>(
    () => ({
      id: disclosure.id,
      expanded,
      onExpandedChange: (id, nextExpanded) => disclosure.store.setExpanded(id, nextExpanded),
    }),
    [disclosure.id, disclosure.store, expanded],
  )
  return <CanonicalItemRendererContent {...props} disclosure={resolvedDisclosure} />
}

function CanonicalItemRendererContentComponent({
  disclosure,
  item,
  onApplyPatch,
  onOpenPatchReview,
  onOpenPlanInRightDock,
  onOpenSubagent,
  rightDockPlanEventId,
  showAssistantActions = false,
  presentation = 'standalone',
  threadId,
}: CanonicalItemRendererContentProps): React.ReactNode {
  switch (item.type) {
    case 'text':
      return (
        <TextItemView item={item} showAssistantActions={showAssistantActions} threadId={threadId} />
      )
    case 'reasoning':
      return <ReasoningItemView disclosure={disclosure} item={item} threadId={threadId} />
    case 'activity':
      return <ActivityItemView disclosure={disclosure} item={item} />
    case 'tool':
      if (isSchedulePlanTool(item)) return <SchedulePlanCard item={item} />
      return (
        <ToolItemView
          disclosure={disclosure}
          item={item}
          presentation={presentation}
          threadId={threadId}
        />
      )
    case 'plan':
      return (
        <WorkflowPlanCard
          eventId={item.id}
          summary={item.markdown}
          structured={item.structured}
          streaming={item.status === 'streaming'}
          isDocked={rightDockPlanEventId === item.id}
          onOpenInRightDock={onOpenPlanInRightDock}
          threadId={threadId}
        />
      )
    case 'execution-plan':
      return null
    case 'question':
      return <QuestionItemView disclosure={disclosure} item={item} />
    case 'patch':
      return (
        <PatchItemView item={item} onApplyPatch={onApplyPatch} onOpenReview={onOpenPatchReview} />
      )
    case 'subagent':
      return <SubagentItemView item={item} onOpen={onOpenSubagent} />
  }
}

function TextItemView({
  item,
  showAssistantActions,
  threadId,
}: {
  item: ItemOf<'text'>
  showAssistantActions: boolean
  threadId?: string
}): React.ReactNode {
  const {
    canCopyFileReferenceContents,
    onCopyFileReferenceContents,
    onOpenFileReference,
    onForkFromMessage,
    workspacePath,
  } = useConversationItemContext()
  const tail = useLiveItemTail(threadId, item.id)
  const text = tail ? item.text + tail : item.text

  if (item.status === 'streaming') countStreamingItemRender()
  if (!text.trim()) return null
  return (
    <article
      className={cx(
        'canonical-text-item tw:min-w-0 tw:text-app-text tw:type-reading',
        item.placement === 'process'
          ? 'canonical-text-item--process tw:text-app-text-soft'
          : 'canonical-text-item--result tw:w-full tw:bg-transparent tw:shadow-none',
      )}
      data-streaming={item.status === 'streaming' ? 'true' : undefined}
    >
      <ConversationMarkdownErrorBoundary contentKey={`${item.id}:${text}`}>
        <MarkdownMessage
          presentation="conversation"
          canCopyFileReferenceContents={canCopyFileReferenceContents}
          cwd={workspacePath}
          onCopyFileReferenceContents={onCopyFileReferenceContents}
          onOpenFileReference={onOpenFileReference}
          streaming={item.status === 'streaming'}
          text={text}
        />
      </ConversationMarkdownErrorBoundary>
      {showAssistantActions && item.status !== 'streaming' ? (
        <div className="canonical-message-actions canonical-message-actions--assistant">
          <CopyButton text={item.text} />
          {item.placement === 'result' && item.status === 'completed' && onForkFromMessage ? (
            <Tooltip content="在新聊天中继续">
              <Button
                isIconOnly
                aria-label="在新聊天中继续"
                color="ghostSecondary"
                size="toolbar"
                title="在新聊天中继续"
                onClick={(event) => {
                  event.stopPropagation()
                  onForkFromMessage({ itemId: item.id, turnId: item.turnId })
                }}
              >
                <Split
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function ReasoningItemView({
  disclosure,
  item,
  threadId,
}: {
  disclosure?: ResolvedCanonicalItemDisclosure
  item: ItemOf<'reasoning'>
  threadId?: string
}): React.ReactNode {
  const streaming = item.status === 'streaming'
  const tail = useLiveItemTail(threadId, item.id)
  const text = tail ? item.text + tail : item.text
  if (streaming) countStreamingItemRender()
  const [localExpanded, setLocalExpanded] = React.useState(streaming)
  const expanded = disclosure?.expanded ?? localExpanded
  const contentId = React.useId()

  React.useEffect(() => {
    if (!disclosure) setLocalExpanded(streaming)
  }, [disclosure, streaming])

  const setExpanded = (next: boolean): void => {
    if (disclosure) disclosure.onExpandedChange(disclosure.id, next)
    else setLocalExpanded(next)
  }

  return (
    <div
      className="canonical-process-card canonical-reasoning"
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        aria-controls={contentId}
        aria-expanded={expanded}
        className={cx(PROCESS_CARD_SUMMARY_CLASS, expanded && 'tw:text-app-text')}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {streaming ? (
          <LoaderCircle
            size={APP_ICON_SIZES.sm}
            className="canonical-spin"
            strokeWidth={APP_ICON_STROKE_WIDTH}
            aria-hidden="true"
          />
        ) : (
          <Check size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} aria-hidden="true" />
        )}
        <span>{streaming ? '正在思考' : '思考过程'}</span>
        <ChevronDown
          size={APP_ICON_SIZES.sm}
          className={cx(
            'canonical-process-card__chevron tw:transition-transform tw:duration-disclosure tw:ease-disclosure',
            expanded && 'tw:rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      <DisclosureContent
        contentClassName="canonical-process-card__body tw:bg-app-chrome"
        expanded={expanded}
        id={contentId}
        mountPolicy="until-exit"
      >
        <ConversationMarkdownErrorBoundary contentKey={`${item.id}:${text}`}>
          <MarkdownMessage
            presentation="conversation"
            text={text || '正在整理思路…'}
            streaming={streaming}
          />
        </ConversationMarkdownErrorBoundary>
      </DisclosureContent>
    </div>
  )
}

function ActivityItemView({
  disclosure,
  item,
}: {
  disclosure?: ResolvedCanonicalItemDisclosure
  item: ItemOf<'activity'>
}): React.ReactNode {
  const active = item.status === 'running'
  const canExpand = Boolean(item.detail || item.commands?.length)
  const [localExpanded, setLocalExpanded] = React.useState(active && canExpand)
  const requestedExpanded = disclosure?.expanded ?? localExpanded
  const expanded = canExpand && requestedExpanded
  const contentId = React.useId()

  React.useEffect(() => {
    if (!disclosure) setLocalExpanded(active && canExpand)
  }, [active, canExpand, disclosure])

  const setExpanded = (next: boolean): void => {
    if (disclosure) disclosure.onExpandedChange(disclosure.id, next)
    else setLocalExpanded(next)
  }

  return (
    <div
      className="cpx-agent-activity__item tw:min-w-0 tw:text-app-text-soft"
      data-expandable={canExpand ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        aria-controls={canExpand ? contentId : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        className={cx(
          'cpx-agent-activity__item-header',
          canExpand ? undefined : 'cpx-agent-activity__item-header--static',
        )}
        disabled={!canExpand}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {active ? (
          <LoaderCircle
            size={APP_ICON_SIZES.sm}
            className="cpx-agent-activity__icon canonical-spin"
            aria-hidden="true"
          />
        ) : item.status === 'error' ? (
          <CircleAlert
            size={APP_ICON_SIZES.sm}
            className="cpx-agent-activity__icon"
            aria-hidden="true"
          />
        ) : (
          <Check size={APP_ICON_SIZES.sm} className="cpx-agent-activity__icon" aria-hidden="true" />
        )}
        <span className="cpx-agent-activity__label">{item.title}</span>
        <ChevronRight
          size={APP_ICON_SIZES.sm}
          className="cpx-agent-activity__chevron"
          aria-hidden="true"
        />
      </button>
      <DisclosureContent
        contentClassName="cpx-agent-activity__details"
        expanded={expanded}
        id={contentId}
        mountPolicy="until-exit"
      >
        {canExpand ? (
          <>
            {item.detail ? <p>{item.detail}</p> : null}
            {item.commands?.map((command, index) => (
              <pre key={`${item.id}:command:${index}`}>
                <code>
                  {command.command}
                  {command.output ? `\n${command.output}` : ''}
                </code>
              </pre>
            ))}
          </>
        ) : null}
      </DisclosureContent>
    </div>
  )
}

export function ToolItemView({
  disclosure,
  item,
  presentation = 'standalone',
  threadId,
}: {
  disclosure?: ResolvedCanonicalItemDisclosure
  item: ToolItem
  presentation?: CanonicalItemRendererProps['presentation']
  threadId?: string
}): React.ReactNode {
  const view = React.useMemo(() => buildToolItemDisplay(item), [item])
  const [localExpanded, setLocalExpanded] = React.useState(false)
  const requestedExpanded = disclosure?.expanded ?? localExpanded
  const expanded = view.canExpand && requestedExpanded
  const SummaryIcon = toolSemanticIcon(view.iconKind)
  const contentId = React.useId()

  React.useEffect(() => {
    if (view.canExpand || !requestedExpanded) return
    if (disclosure) {
      disclosure.onExpandedChange(disclosure.id, false)
    } else {
      setLocalExpanded(false)
    }
  }, [disclosure, requestedExpanded, view.canExpand])

  return (
    <div
      className="cpx-agent-activity__item tw:min-w-0 tw:text-app-text-soft"
      data-expandable={view.canExpand ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
      data-presentation={presentation}
      data-state={item.state}
    >
      <ToolActivityHeader
        canExpand={view.canExpand}
        contentId={contentId}
        expanded={expanded}
        label={expanded ? view.expandedLabel : view.collapsedLabel}
        onToggle={() => {
          if (!view.canExpand) return
          if (disclosure) {
            disclosure.onExpandedChange(disclosure.id, !expanded)
          } else {
            setLocalExpanded(!expanded)
          }
        }}
      >
        {view.active ? (
          <LoaderCircle
            size={APP_ICON_SIZES.sm}
            className="canonical-spin cpx-agent-activity__icon"
            aria-hidden="true"
          />
        ) : item.state === 'interrupted' ? (
          <CircleStop
            size={APP_ICON_SIZES.sm}
            className="cpx-agent-activity__icon"
            aria-hidden="true"
          />
        ) : view.failed ? (
          <CircleAlert
            size={APP_ICON_SIZES.sm}
            className="cpx-agent-activity__icon"
            aria-hidden="true"
          />
        ) : (
          <SummaryIcon
            size={APP_ICON_SIZES.sm}
            className="cpx-agent-activity__icon"
            aria-hidden="true"
          />
        )}
        {view.semanticSummary ? (
          <ToolActivityLabel summary={view.semanticSummary} />
        ) : (
          <span className="cpx-agent-activity__label">
            {expanded ? view.expandedLabel : view.collapsedLabel}
          </span>
        )}
        <ChevronRight
          size={APP_ICON_SIZES.sm}
          className="cpx-agent-activity__chevron"
          aria-hidden="true"
        />
      </ToolActivityHeader>
      <DisclosureContent
        contentClassName="cpx-agent-activity__details"
        expanded={expanded}
        id={contentId}
        mountPolicy="until-exit"
      >
        <ToolExecutionCard
          expanded={expanded}
          item={item}
          presentation={presentation}
          threadId={threadId}
          view={view}
        />
      </DisclosureContent>
    </div>
  )
}

export function resolveShellTag(item: ToolItem): string | null {
  const rawTool = (item.tool ?? '').trim().toLowerCase()
  const toolLeaf = rawTool.split(/[./]/).at(-1) ?? ''

  // Check if input specifies shell
  if (item.input && typeof item.input === 'object') {
    const inputObj = item.input as Record<string, unknown>
    const shellField = typeof inputObj.shell === 'string' ? inputObj.shell.toLowerCase() : ''
    if (shellField.includes('pwsh') || shellField.includes('powershell')) return 'pwsh'
    if (shellField.includes('zsh')) return 'zsh'
    if (shellField.includes('bash')) return 'bash'
    if (shellField.includes('cmd')) return 'cmd'
    if (shellField.includes('fish')) return 'fish'
  }

  // Check command string prefix
  const command = (item.command ?? '').trim()
  if (/^pwsh(\.exe)?\b/i.test(command) || /^powershell(\.exe)?\b/i.test(command)) return 'pwsh'
  if (/^bash\b/i.test(command)) return 'bash'
  if (/^zsh\b/i.test(command)) return 'zsh'
  if (/^cmd(\.exe)?\s*\/c\b/i.test(command)) return 'cmd'

  // Check tool name
  if (toolLeaf === 'zsh') return 'zsh'
  if (toolLeaf === 'pwsh' || toolLeaf === 'powershell') return 'pwsh'
  if (toolLeaf === 'cmd') return 'cmd'
  if (toolLeaf === 'fish') return 'fish'
  if (toolLeaf === 'bash') return 'bash'
  if (
    toolLeaf === 'shell' ||
    toolLeaf === 'exec' ||
    toolLeaf === 'terminal' ||
    toolLeaf === 'run_command' ||
    toolLeaf === 'execute_command'
  ) {
    return 'Shell'
  }

  if (command) return 'Shell'

  return null
}

export function resolveToolContentLanguage(
  item: ToolItem,
  content: string,
): { language: string; headerLabel: string | null } {
  const shellTag = resolveShellTag(item)
  if (shellTag) {
    const lang = shellTag === 'pwsh' ? 'powershell' : shellTag === 'cmd' ? 'bat' : 'shellscript'
    return { language: lang, headerLabel: shellTag }
  }
  const trimmed = (content ?? '').trim()
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed)
      return { language: 'json', headerLabel: 'json' }
    } catch {
      // not valid JSON
    }
  }
  return { language: 'text', headerLabel: null }
}

export function resolveToolResultLanguage(resultText: string): {
  language: string
  headerLabel: string | null
} {
  const trimmed = (resultText ?? '').trim()
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed)
      return { language: 'json', headerLabel: 'json' }
    } catch {
      // not valid JSON
    }
  }
  return { language: 'text', headerLabel: null }
}

export const ToolExecutionCard = React.memo(function ToolExecutionCard({
  expanded = true,
  item,
  presentation = 'standalone',
  threadId,
  view,
}: {
  expanded?: boolean
  item: ToolItem
  presentation?: CanonicalItemRendererProps['presentation']
  threadId?: string
  view: ToolItemDisplay
}): React.ReactNode {
  const embedded = presentation === 'grouped'
  const executionLang = resolveToolContentLanguage(item, view.executionContent)
  const resultLang = view.resultText ? resolveToolResultLanguage(view.resultText) : null
  const detailKind = toolDetailKind(item)
  if (detailKind === 'command') {
    return (
      <ToolCommandCard
        key={`${threadId ?? ''}:${item.id}`}
        item={item}
        command={item.command?.trim() ? item.command : view.executionContent}
        output={view.resultText}
        statusLabel={view.statusLabel}
        expanded={expanded}
        grouped={embedded}
      >
        {item.resultBlocks?.length ? (
          <ToolResultBlocksView
            item={item}
            renderedResultText={view.resultText}
            threadId={threadId}
          />
        ) : null}
      </ToolCommandCard>
    )
  }

  return (
    <article
      className={cx(
        'canonical-command-shell md-code-surface tw:mx-0 tw:my-2 tw:min-w-0',
        embedded && 'canonical-command-shell--embedded tw:my-1',
      )}
      data-state={item.state}
    >
      <div className="canonical-command-shell__body tw:flex tw:min-w-0 tw:flex-col">
        {detailKind !== 'result' ? (
          <CodeBlock
            surface="embedded"
            showWrapControl
            ariaLabel="执行内容"
            headerLabel={executionLang.headerLabel}
            copyLabel="复制执行内容"
            code={view.executionContent}
            language={executionLang.language}
            streaming={view.active}
          />
        ) : null}
        {view.resultText && resultLang ? (
          <div className="canonical-command-shell__result tw:border-t tw:border-app-border-subtle">
            <CodeBlock
              surface="embedded"
              showWrapControl
              ariaLabel="返回结果"
              headerLabel={resultLang.headerLabel}
              copyLabel="复制返回结果"
              code={view.resultText}
              language={resultLang.language}
              streaming={view.active}
              wrapContent={(content) => (
                <CommandShellEmbeddedScroll>{content}</CommandShellEmbeddedScroll>
              )}
            />
          </div>
        ) : null}
        {item.resultBlocks?.length ? (
          <ToolResultBlocksView
            item={item}
            renderedResultText={view.resultText}
            threadId={threadId}
          />
        ) : null}
      </div>
      <footer className="canonical-command-shell__footer tw:flex tw:min-h-6 tw:items-center tw:justify-end tw:border-t-0 tw:bg-transparent tw:px-3 tw:pt-0 tw:pb-2">
        <span className="canonical-command-shell__status">
          {item.state === 'completed' ? (
            <Check size={APP_ICON_SIZES.sm} aria-hidden="true" />
          ) : item.state === 'error' || item.state === 'interrupted' ? (
            <CircleAlert size={APP_ICON_SIZES.sm} aria-hidden="true" />
          ) : (
            <LoaderCircle size={APP_ICON_SIZES.sm} className="canonical-spin" aria-hidden="true" />
          )}
          {view.statusLabel}
        </span>
      </footer>
    </article>
  )
})

function ToolResultBlocksView({
  item,
  renderedResultText,
  threadId,
}: {
  item: ToolItem
  renderedResultText?: string | null
  threadId?: string
}): React.ReactNode {
  const blocks = item.resultBlocks ?? []
  const filteredBlocks = blocks.filter((block) => {
    if (block.type === 'json') {
      if (isProcessEnvelope(block.value)) {
        return false
      }
    }
    if (block.type === 'text') {
      if (isProcessEnvelope(block.text)) {
        return false
      }
      if (renderedResultText) {
        const blockText = block.text.trim()
        const resultText = renderedResultText.trim()
        if (
          blockText &&
          (blockText === resultText ||
            resultText.split('\n').some((line) => line.trim() === blockText))
        ) {
          return false
        }
      }
    }
    return true
  })
  if (!filteredBlocks.length) return null
  return (
    <section className="canonical-tool-result-blocks" aria-label="结构化返回结果">
      {filteredBlocks.map((block, index) => (
        <ToolResultBlockView
          block={block}
          itemId={item.id}
          key={`${item.id}:result-block:${index}`}
          threadId={threadId}
        />
      ))}
    </section>
  )
}

function ToolResultBlockView({
  block,
  itemId,
  threadId,
}: {
  block: ToolResultBlock
  itemId: string
  threadId?: string
}): React.ReactNode {
  if (block.type === 'json' && isProcessEnvelope(block.value)) {
    return null
  }
  if (block.type === 'text' && isProcessEnvelope(block.text)) {
    return null
  }
  switch (block.type) {
    case 'text':
      return (
        <pre className="canonical-tool-result-block canonical-tool-result-block--text">
          <code>{block.text}</code>
        </pre>
      )
    case 'citation': {
      const url = safeCitationUrl(block.url)
      return (
        <div className="canonical-tool-result-block canonical-tool-result-block--citation">
          <Globe2 aria-hidden="true" size={APP_ICON_SIZES.sm} />
          {url ? (
            <a href={url} rel="noopener noreferrer" target="_blank">
              {block.title ?? url}
            </a>
          ) : (
            <span>{block.title ?? block.url}</span>
          )}
        </div>
      )
    }
    case 'json': {
      // Only an explicit Pidex envelope becomes a card; every other JSON
      // value (including forged or future-shaped envelopes) keeps the raw block.
      const envelope = decodeResultCardEnvelope(block.value)
      if (envelope) return <ResultCardView card={envelope.card} />
      return (
        <pre className="canonical-tool-result-block canonical-tool-result-block--json">
          <code>{formatUnknown(block.value)}</code>
        </pre>
      )
    }
    case 'artifact':
      return <ToolArtifactBlockView block={block} itemId={itemId} threadId={threadId} />
  }
}

function ToolArtifactBlockView({
  block,
  itemId,
  threadId,
}: {
  block: Extract<ToolResultBlock, { type: 'artifact' }>
  itemId: string
  threadId?: string
}): React.ReactNode {
  const isImage = /^image\//i.test(block.mimeType)
  const detail = `${block.mimeType}${block.size !== undefined ? ` · ${formatArtifactByteSize(block.size)}` : ''}`
  if (isImage) {
    return <ToolArtifactImageBlock block={block} itemId={itemId} threadId={threadId} />
  }
  return (
    <div className="canonical-tool-result-block canonical-tool-result-block--artifact">
      <AttachmentFilePill detail={detail} name={block.name} />
    </div>
  )
}

function ToolArtifactImageBlock({
  block,
  itemId,
  threadId,
}: {
  block: Extract<ToolResultBlock, { type: 'artifact' }>
  itemId: string
  threadId?: string
}): React.ReactNode {
  const state = useToolArtifactImageSource(threadId, block.artifactId, block.mimeType)
  return (
    <div
      className="canonical-tool-result-block canonical-tool-result-block--artifact"
      data-item-id={itemId}
    >
      <AttachmentImageTile
        errorMessage={state.status === 'error' ? state.message : undefined}
        name={block.name}
        source={state.status === 'ready' ? state.source : undefined}
        status={state.status}
      />
    </div>
  )
}

function formatArtifactByteSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function CommandShellEmbeddedScroll({ children }: { children: React.ReactNode }): React.ReactNode {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const edge = useScrollEdgeState(scrollerRef, { contentRef })
  return (
    <div
      className="canonical-command-shell__edge-fade tw:relative tw:min-w-0"
      data-at-end={edge.atEnd}
      data-at-start={edge.atStart}
      data-scrollable={edge.scrollable}
    >
      <div className="canonical-command-shell__scroller" ref={scrollerRef}>
        <div className="canonical-command-shell__scroll-content" ref={contentRef}>
          {children}
        </div>
      </div>
    </div>
  )
}

function PatchItemView({
  item,
  onApplyPatch,
  onOpenReview,
}: {
  item: ItemOf<'patch'>
  onApplyPatch?: CanonicalItemRendererProps['onApplyPatch']
  onOpenReview?: CanonicalItemRendererProps['onOpenPatchReview']
}): React.ReactNode {
  return (
    <PatchSummaryView
      onApplyPatch={onApplyPatch}
      onOpenReview={onOpenReview}
      patch={{
        actionVersion: item.actionVersion,
        applyState: item.applyState,
        files: item.files.map((file) => ({
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
          path: file.path,
        })),
        id: item.id,
        reversible: item.reversible,
        totalAdditions: item.totalAdditions,
        totalDeletions: item.totalDeletions,
      }}
    />
  )
}

export function PatchSummaryView({
  onApplyPatch,
  onOpenReview,
  patch,
}: {
  onApplyPatch?: CanonicalItemRendererProps['onApplyPatch']
  onOpenReview?: CanonicalItemRendererProps['onOpenPatchReview']
  patch: PatchDisplay
}): React.ReactNode {
  const [filesExpanded, setFilesExpanded] = React.useState(false)
  const [pendingAction, setPendingAction] = React.useState<PatchAction | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const hiddenFileCount = Math.max(0, patch.files.length - 3)
  const visibleFiles = patchFilesForDisplay(patch.files, false)
  const hiddenFiles = patch.files.slice(visibleFiles.length)
  const filesDisclosureId = React.useId()
  const patchAction: PatchAction = patch.applyState === 'undone' ? 'reapply' : 'undo'
  const canApplyPatch = patch.reversible === true && Boolean(onApplyPatch)

  React.useEffect(() => {
    if (hiddenFileCount === 0 && filesExpanded) setFilesExpanded(false)
  }, [filesExpanded, hiddenFileCount])

  const applyPatch = async (): Promise<void> => {
    if (!onApplyPatch || pendingAction) return
    setPendingAction(patchAction)
    setActionError(null)
    try {
      await onApplyPatch(patch.id, patchAction, patch.actionVersion ?? 0)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : patchAction === 'undo'
            ? '无法撤销文件修改'
            : '无法重新应用文件修改',
      )
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <article className="canonical-patch-card">
      <header className="canonical-patch-card__header">
        <span className="canonical-patch-card__icon" aria-hidden="true">
          <FileDiff size={APP_ICON_SIZES.sm} />
        </span>
        <span className="canonical-patch-card__summary">
          <strong>已编辑 {patch.files.length} 个文件</strong>
          <span>
            {patch.totalAdditions !== null ? (
              <span className="canonical-diff-add">+{patch.totalAdditions}</span>
            ) : null}
            {patch.totalDeletions !== null ? (
              <span className="canonical-diff-remove">-{patch.totalDeletions}</span>
            ) : null}
          </span>
        </span>
        <span className="canonical-patch-card__actions">
          {canApplyPatch ? (
            <Button
              color="primary"
              className="canonical-patch-card__action"
              loading={pendingAction === patchAction}
              onClick={() => void applyPatch()}
            >
              <RotateCcw aria-hidden="true" size={APP_ICON_SIZE} />
              {patchAction === 'undo' ? '撤销' : '重新应用'}
            </Button>
          ) : null}
          {onOpenReview ? (
            <Button
              color="secondary"
              className="canonical-patch-card__action"
              onClick={() =>
                onOpenReview(patch.files.length === 1 ? patch.files[0]?.path : undefined)
              }
            >
              审核
            </Button>
          ) : null}
        </span>
      </header>
      <div className="canonical-patch-card__files tw:grid">
        {visibleFiles.map((file) => (
          <PatchFileButton file={file} key={file.path} onOpenReview={onOpenReview} />
        ))}
        <DisclosureContent expanded={filesExpanded} id={filesDisclosureId} mountPolicy="until-exit">
          {hiddenFiles.map((file) => (
            <PatchFileButton file={file} key={file.path} onOpenReview={onOpenReview} />
          ))}
        </DisclosureContent>
      </div>
      {hiddenFileCount > 0 ? (
        <button
          aria-controls={filesDisclosureId}
          aria-expanded={filesExpanded}
          className="canonical-patch-card__disclosure"
          type="button"
          onClick={() => setFilesExpanded((expanded) => !expanded)}
        >
          {filesExpanded ? '收起文件' : `再显示 ${hiddenFileCount} 个文件`}
          {filesExpanded ? (
            <ChevronDown size={APP_ICON_SIZES.sm} aria-hidden="true" className="is-expanded" />
          ) : (
            <ChevronDown size={APP_ICON_SIZES.sm} aria-hidden="true" />
          )}
        </button>
      ) : null}
      {actionError ? (
        <p className="canonical-patch-card__error" role="alert">
          {actionError}
        </p>
      ) : null}
    </article>
  )
}

export function FileMutationItemView({
  diffMarkerStyle = 'color',
  disclosureStore,
  item,
  readThreadPatchDiff,
  threadId,
}: {
  diffMarkerStyle?: DesktopDiffMarkerStyle
  disclosureStore?: KeyedDisclosureStore
  item: ToolItem
  readThreadPatchDiff?: ReadThreadPatchDiff
  threadId?: string
}): React.ReactNode {
  const mutation = fileMutationDisplay(item)
  if (!mutation) return null
  const active = isActiveToolState(item.state)
  const failed = item.state === 'error' || item.state === 'interrupted'

  return (
    <div
      className="cpx-agent-activity__file-changes tw:grid tw:min-w-0 tw:text-app-text-soft"
      data-state={item.state}
    >
      {mutation.files.map((file, fileIndex) => {
        const disclosureId = `file-mutation:${item.id}:${fileIndex}`
        const canExpand =
          item.state === 'completed' &&
          Boolean(disclosureStore) &&
          Boolean(threadId) &&
          Boolean(readThreadPatchDiff) &&
          item.mutationDiffPaths?.some((path) => sameMutationPath(path, file.path)) === true
        if (!canExpand || !readThreadPatchDiff || !threadId) {
          return (
            <div
              className="cpx-agent-activity__item-header cpx-agent-activity__item-header--static"
              key={`${item.id}:${file.path}`}
            >
              {active ? (
                <LoaderCircle
                  size={APP_ICON_SIZES.sm}
                  className="canonical-spin cpx-agent-activity__icon"
                  aria-hidden="true"
                />
              ) : failed ? (
                <CircleAlert
                  size={APP_ICON_SIZES.sm}
                  className="cpx-agent-activity__icon"
                  aria-hidden="true"
                />
              ) : (
                <Pencil
                  size={APP_ICON_SIZES.sm}
                  className="cpx-agent-activity__icon"
                  aria-hidden="true"
                />
              )}
              <span className="cpx-agent-activity__label" title={file.path}>
                {fileMutationLabel(item.state, file.path, file.operation)}
              </span>
              <span className="cpx-agent-activity__review-indicator tw:inline-flex tw:flex-none tw:items-center tw:gap-2">
                {file.additions !== null ? (
                  <small className="canonical-diff-add">+{file.additions}</small>
                ) : null}
                {file.deletions !== null ? (
                  <small className="canonical-diff-remove">-{file.deletions}</small>
                ) : null}
              </span>
            </div>
          )
        }
        if (!disclosureStore) return null
        return (
          <React.Suspense
            fallback={
              <div className="cpx-agent-activity__item-header cpx-agent-activity__item-header--static">
                <Pencil
                  size={APP_ICON_SIZES.sm}
                  className="cpx-agent-activity__icon"
                  aria-hidden="true"
                />
                <span className="cpx-agent-activity__label" title={file.path}>
                  {fileMutationLabel(item.state, file.path, file.operation)}
                </span>
                <span className="cpx-agent-activity__review-indicator tw:inline-flex tw:flex-none tw:items-center tw:gap-2">
                  {file.additions !== null ? (
                    <small className="canonical-diff-add">+{file.additions}</small>
                  ) : null}
                  {file.deletions !== null ? (
                    <small className="canonical-diff-remove">-{file.deletions}</small>
                  ) : null}
                </span>
              </div>
            }
            key={`${item.id}:${file.path}`}
          >
            <LazyExpandableFileMutationRow
              diffMarkerStyle={diffMarkerStyle}
              disclosure={{ id: disclosureId, store: disclosureStore }}
              file={file}
              item={item}
              readThreadPatchDiff={readThreadPatchDiff}
              threadId={threadId}
            />
          </React.Suspense>
        )
      })}
    </div>
  )
}

function sameMutationPath(left: string, right: string): boolean {
  if (left === right) return true
  const normalize = (value: string): string =>
    value.replaceAll('\\', '/').toLocaleLowerCase('en-US')
  return normalize(left) === normalize(right)
}

function SubagentItemView({
  item,
  onOpen,
}: {
  item: ItemOf<'subagent'>
  onOpen: (taskId: string) => void
}): React.ReactNode {
  const changedFiles = item.result?.changedFiles ?? []
  return (
    <button
      className="canonical-subagent-card"
      type="button"
      onClick={() => onOpen(item.subagentTaskId)}
    >
      <Bot size={APP_ICON_SIZES.sm} aria-hidden="true" />
      <span>
        <strong>{item.displayName}</strong>
        <small>{item.task}</small>
        {item.descendantCount ? (
          <small>
            后代 {item.activeDescendantCount ?? 0}/{item.descendantCount} 正在进行
          </small>
        ) : null}
        {item.waitingForDescendants ? <small>等待后代结算</small> : null}
        {item.latestReport ? <small>{item.latestReport}</small> : null}
        {changedFiles.length > 0 ? (
          <small className="canonical-subagent-card__files">
            修改 {changedFiles.length} 个文件：
            {changedFiles.map((file) => file.path).join('、')}
          </small>
        ) : null}
      </span>
      <em>{subagentStatusLabel(item.status)}</em>
    </button>
  )
}

function toolStateLabel(state: ToolItem['state']): string {
  switch (state) {
    case 'pending':
      return '等待'
    case 'waiting-permission':
      return '等待授权'
    case 'running':
      return '运行中'
    case 'completed':
      return '成功'
    case 'error':
      return '失败'
    case 'interrupted':
      return '已中断'
  }
}

function nonBlank(value: string | null): string | null {
  return value && value.trim() ? value : null
}

export function buildToolItemDisplay(item: ToolItem, nowMs?: number): ToolItemDisplay {
  const command = nonBlank(item.command)
  const lifecycle = buildLifecycleToolDisplay(item)
  if (lifecycle) {
    return {
      active: lifecycle.active,
      canExpand: false,
      collapsedLabel: lifecycle.label,
      executionContent: lifecycle.label,
      expandedLabel: lifecycle.label,
      failed: lifecycle.failed,
      iconKind: 'tool',
      resultText: null,
      semanticSummary: null,
      statusLabel: toolStateLabel(item.state),
      semanticKind: 'tool',
      toolLabel: lifecycle.toolLabel,
    }
  }
  const structuredDetail = buildStructuredToolDetail(item)
  const formattedInput = formatToolInputForDisplay(item.tool, item.input)
  const safeInput =
    formattedInput.trim() && formattedInput.trim() !== 'null' ? formattedInput : null
  const fallbackExecution = item.title.trim() || item.tool
  const executionContent =
    structuredDetail?.executionContent ?? command ?? safeInput ?? fallbackExecution
  const rawResultText = structuredDetail
    ? structuredDetail.resultText
    : appendToolError(cleanCommandOutput(nonBlank(item.output)), nonBlank(item.error))
  const resultText = cleanCommandOutput(rawResultText)
  const active = isActiveToolState(item.state)
  const terminal = !active
  const semanticSummary = buildToolSemanticSummary(item, { nowMs })

  return {
    active,
    canExpand:
      toolDetailKind(item) === 'result'
        ? resultText !== null || Boolean(item.resultBlocks?.length)
        : terminal || resultText !== null,
    collapsedLabel: semanticSummary.collapsedLabel,
    executionContent,
    expandedLabel: semanticSummary.expandedLabel,
    failed: item.state === 'error' || item.state === 'interrupted',
    iconKind: semanticSummary.iconKind,
    resultText,
    semanticSummary,
    statusLabel: toolStateLabel(item.state),
    semanticKind: semanticSummary.kind,
    toolLabel: semanticSummary.toolLabel,
  }
}

function isActiveToolState(state: ToolItem['state']): boolean {
  return state === 'pending' || state === 'waiting-permission' || state === 'running'
}

function toolLeafName(tool: string): string {
  return (tool ?? '').trim().split(/[./]/).at(-1)?.toLowerCase() ?? ''
}

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function inputText(input: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function safeDisplayPath(value: string | null): string | null {
  if (!value) return null
  const normalized = value.replaceAll('\\', '/').replace(/^\.\/+/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (/^(?:[a-z]:\/|\/)/i.test(normalized) || parts.includes('..')) {
    return parts.at(-1) ?? null
  }
  return normalized || null
}

type LifecycleAction = {
  completed: string
  error: string
  icon: LucideIcon
  interrupted: string
  running: string
  toolLabel: string
}

const LIFECYCLE_ACTIONS: Readonly<Record<string, LifecycleAction>> = {
  update_plan: {
    completed: '已更新计划',
    error: '更新计划失败',
    icon: NotepadText,
    interrupted: '已中断更新计划',
    running: '正在更新计划',
    toolLabel: '更新计划',
  },
  submit_plan: {
    completed: '已提交计划',
    error: '提交计划失败',
    icon: ListChecks,
    interrupted: '已中断提交计划',
    running: '正在提交计划',
    toolLabel: '提交计划',
  },
  request_permissions: {
    completed: '已请求权限',
    error: '请求权限失败',
    icon: Shield,
    interrupted: '已中断请求权限',
    running: '正在请求权限',
    toolLabel: '请求权限',
  },
  request_user_input: {
    completed: '已发起提问',
    error: '提问失败',
    icon: MessageCircleQuestion,
    interrupted: '已中断提问',
    running: '正在询问问题',
    toolLabel: '提问',
  },
  spawn_agents: {
    completed: '已创建子代理',
    error: '创建子代理失败',
    icon: UserRoundPlus,
    interrupted: '已中断创建子代理',
    running: '正在创建子代理',
    toolLabel: '创建子代理',
  },
  wait_agents: {
    completed: '子代理已返回',
    error: '等待子代理失败',
    icon: Hourglass,
    interrupted: '已中断等待子代理',
    running: '正在等待子代理',
    toolLabel: '等待子代理',
  },
  send_agent: {
    completed: '已通知子代理',
    error: '通知子代理失败',
    icon: Send,
    interrupted: '已中断通知子代理',
    running: '正在通知子代理',
    toolLabel: '通知子代理',
  },
  stop_agent: {
    completed: '已停止子代理',
    error: '停止子代理失败',
    icon: CircleStop,
    interrupted: '已中断停止子代理',
    running: '正在停止子代理',
    toolLabel: '停止子代理',
  },
  finalize_result: {
    completed: '已提交子代理结果',
    error: '提交子代理结果失败',
    icon: ClipboardCheck,
    interrupted: '已中断提交子代理结果',
    running: '正在提交子代理结果',
    toolLabel: '提交子代理结果',
  },
}

export function buildLifecycleToolDisplay(item: ToolItem): LifecycleToolDisplay | null {
  const action = LIFECYCLE_ACTIONS[toolLeafName(item.tool)]
  if (!action) return null
  const active = isActiveToolState(item.state)
  return {
    active,
    failed: item.state === 'error' || item.state === 'interrupted',
    icon: action.icon,
    label:
      item.state === 'completed'
        ? action.completed
        : item.state === 'error'
          ? action.error
          : item.state === 'interrupted'
            ? action.interrupted
            : action.running,
    toolLabel: action.toolLabel,
  }
}

type ParsedToolOutput = {
  parsed: boolean
  text: string | null
  value: unknown
}

function parsedToolOutput(output: string | null): ParsedToolOutput {
  const text = nonBlank(output)
  if (!text) return { parsed: false, text: null, value: null }
  try {
    return { parsed: true, text, value: JSON.parse(text) as unknown }
  } catch {
    return { parsed: false, text, value: text }
  }
}

function appendToolError(result: string | null, error: string | null): string | null {
  if (result && error && result.trim() !== error.trim())
    return `${result}${result.endsWith('\n') ? '' : '\n'}${error}`
  return result ?? error
}

/**
 * 深度检测某个值是否为底层进程执行包装（exitCode / exit_code / stdout / stderr / signal / timedOut / truncated 等）。
 * 适用于对象、嵌套对象、JSON 字符串以及 Markdown 代码块格式。
 */
export function isProcessEnvelope(value: unknown): boolean {
  if (!value) return false
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const cleanStr = trimmed.startsWith('```')
      ? trimmed
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
          .trim()
      : trimmed
    if (cleanStr.startsWith('{') && cleanStr.endsWith('}')) {
      try {
        const parsed = JSON.parse(cleanStr)
        return isProcessEnvelope(parsed)
      } catch {
        // fall through to text heuristic
      }
    }
    if (
      (cleanStr.includes('"exitCode"') ||
        cleanStr.includes('"exit_code"') ||
        cleanStr.includes('exitCode:') ||
        cleanStr.includes('exit_code:')) &&
      (cleanStr.includes('"stdout"') ||
        cleanStr.includes('"stderr"') ||
        cleanStr.includes('"signal"') ||
        cleanStr.includes('"timedOut"') ||
        cleanStr.includes('stdout:') ||
        cleanStr.includes('stderr:'))
    ) {
      return true
    }
    return false
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.length > 0 && value.every((item) => isProcessEnvelope(item))
    }
    const rec = value as Record<string, unknown>
    if (
      'exitCode' in rec ||
      'exit_code' in rec ||
      'returncode' in rec ||
      'return_code' in rec ||
      'timedOut' in rec ||
      'timed_out' in rec ||
      'truncated' in rec ||
      ('stdout' in rec && ('stderr' in rec || 'signal' in rec))
    ) {
      return true
    }
    if (rec.result && typeof rec.result === 'object' && isProcessEnvelope(rec.result)) {
      return true
    }
  }
  return false
}

/**
 * 清洗工具执行输出：
 * 若输出为底层进程通信包装的 JSON（含 exitCode / stdout / stderr / timedOut 等），
 * 则智能提取出真实的 stdout / stderr 内容，彻底杜绝在终端卡片中露出内部 JSON 结构。
 */
export function cleanCommandOutput(rawText: string | null): string | null {
  const text = nonBlank(rawText)
  if (!text) return null
  const trimmed = text.trim()
  const cleanStr = trimmed.startsWith('```')
    ? trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()
    : trimmed
  if (cleanStr.startsWith('{') && cleanStr.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleanStr)
      if (isProcessEnvelope(parsed)) {
        const record = parsed.result && typeof parsed.result === 'object' ? parsed.result : parsed
        const stdout = typeof record.stdout === 'string' ? record.stdout : ''
        const stderr = typeof record.stderr === 'string' ? record.stderr : ''
        const combined = stdout + (stdout && stderr && !stdout.endsWith('\n') ? '\n' : '') + stderr
        return combined.trim() ? combined : null
      }
    } catch {
      // 保持原样文本
    }
  }
  return text
}

function isToolSearchName(tool: string): boolean {
  const normalized = tool.trim().toLowerCase()
  return normalized === 'toolsearch' || normalized === 'tool_search' || normalized === 'tool.search'
}

function outputField(output: ParsedToolOutput, key: string): unknown {
  return output.parsed ? inputRecord(output.value)[key] : undefined
}

function outputTextField(output: ParsedToolOutput, key: string): string | null {
  const value = outputField(output, key)
  return typeof value === 'string' ? value : null
}

function projectedOutputArray(
  output: ParsedToolOutput,
  keys: readonly string[],
  project: (value: unknown) => unknown | null,
): string | null {
  for (const key of keys) {
    const value = outputField(output, key)
    if (!Array.isArray(value)) continue
    return JSON.stringify(
      value.flatMap((candidate) => {
        const projected = project(candidate)
        return projected === null ? [] : [projected]
      }),
      null,
      2,
    )
  }
  return null
}

function projectSearchResult(value: unknown): unknown | null {
  if (typeof value === 'string') {
    return safeDisplayPath(value) ?? '<workspace-path>'
  }
  const candidate = inputRecord(value)
  const projected: Record<string, unknown> = {}
  const path = inputText(candidate, 'path', 'file_path', 'filePath')
  if (path) projected.path = safeDisplayPath(path) ?? '<workspace-path>'
  if (typeof candidate.line === 'number' && Number.isFinite(candidate.line)) {
    projected.line = candidate.line
  }
  if (typeof candidate.count === 'number' && Number.isFinite(candidate.count)) {
    projected.count = candidate.count
  }
  if (typeof candidate.text === 'string') projected.text = candidate.text
  for (const key of ['before', 'after'] as const) {
    if (Array.isArray(candidate[key])) {
      projected[key] = candidate[key].filter((line): line is string => typeof line === 'string')
    }
  }
  return Object.keys(projected).length ? projected : null
}

function projectToolSearchResult(value: unknown): unknown | null {
  const candidate = inputRecord(value)
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null
  return {
    name: candidate.name,
    ...(typeof candidate.description === 'string' ? { description: candidate.description } : {}),
  }
}

function structuredResult(
  output: ParsedToolOutput,
  projected: string | null,
  error: string | null,
): string | null {
  return appendToolError(projected ?? (!output.parsed ? output.text : null), error)
}

export function buildStructuredToolDetail(item: ToolItem): StructuredToolDetail | null {
  const leaf = toolLeafName(item.tool)
  const input = inputRecord(item.input)
  const output = parsedToolOutput(item.output)
  const error = nonBlank(item.error)

  switch (leaf) {
    case 'read':
      return {
        executionContent:
          safeDisplayPath(inputText(input, 'file_path', 'filePath', 'path')) ?? '未提供文件路径',
        resultText: structuredResult(output, outputTextField(output, 'content'), error),
      }
    case 'grep':
      return {
        executionContent: inputText(input, 'pattern', 'query') ?? '未提供搜索条件',
        resultText: structuredResult(
          output,
          projectedOutputArray(output, ['files', 'matches', 'counts'], projectSearchResult),
          error,
        ),
      }
    case 'glob':
      return {
        executionContent: inputText(input, 'pattern', 'glob') ?? '未提供匹配条件',
        resultText: structuredResult(
          output,
          projectedOutputArray(output, ['matches'], projectSearchResult),
          error,
        ),
      }
    case 'toolsearch':
    case 'tool_search':
      return {
        executionContent: inputText(input, 'query') ?? '未提供工具搜索条件',
        resultText: structuredResult(
          output,
          projectedOutputArray(output, ['tools'], projectToolSearchResult),
          error,
        ),
      }
    case 'skill_read':
      return {
        executionContent: inputText(input, 'name') ?? '未提供技能名称',
        resultText: structuredResult(output, outputTextField(output, 'content'), error),
      }
    default:
      if (!isToolSearchName(item.tool)) return null
      return {
        executionContent: inputText(input, 'query') ?? '未提供工具搜索条件',
        resultText: structuredResult(
          output,
          projectedOutputArray(output, ['tools'], projectToolSearchResult),
          error,
        ),
      }
  }
}

export function isStandaloneLifecycleTool(item: ToolItem): boolean {
  return buildLifecycleToolDisplay(item) !== null
}

export function LifecycleToolItemView({ item }: { item: ToolItem }): React.ReactNode {
  const display = buildLifecycleToolDisplay(item)
  if (!display) return null
  const LifecycleIcon = display.icon
  const card = lifecycleResultCard(item)
  return (
    <div className="canonical-lifecycle-entry tw:flex tw:min-w-0 tw:flex-col tw:gap-2">
      <div
        className="canonical-lifecycle-tool"
        data-state={item.state}
        role={display.active ? 'status' : undefined}
      >
        {display.failed ? (
          <CircleAlert size={APP_ICON_SIZES.sm} aria-hidden="true" />
        ) : (
          <span className="canonical-lifecycle-tool__icon">
            <LifecycleIcon size={APP_ICON_SIZES.sm} aria-hidden="true" />
            {display.active ? (
              <LifecycleIcon
                size={APP_ICON_SIZES.sm}
                className="canonical-lifecycle-tool__icon-flash"
                aria-hidden="true"
              />
            ) : null}
          </span>
        )}
        <span>{display.label}</span>
      </div>
      {card ? <ResultCardView card={card} /> : null}
    </div>
  )
}

/**
 * Lifecycle rows keep their compact status line; a delivery submitted by
 * finalize_result reuses the ordinary result card below it instead of the raw
 * JSON block.
 */
function lifecycleResultCard(item: ToolItem): ResultCard | null {
  if (toolLeafName(item.tool) !== 'finalize_result') return null
  for (const block of item.resultBlocks ?? []) {
    if (block.type !== 'json') continue
    const envelope = decodeResultCardEnvelope(block.value)
    if (envelope) return envelope.card
  }
  return null
}

export function isFileMutationTool(item: ToolItem): boolean {
  const leaf = toolLeafName(item.tool)
  return leaf === 'apply_patch' || leaf === 'write' || leaf === 'edit'
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function parsedOutputRecord(output: string | null): Record<string, unknown> {
  if (!output?.trim()) return {}
  try {
    const parsed = JSON.parse(output) as unknown
    return inputRecord(parsed)
  } catch {
    return {}
  }
}

function fileCandidates(value: unknown): FileChangeDisplay[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const record = inputRecord(candidate)
    const path = safeDisplayPath(inputText(record, 'path', 'file_path', 'filePath'))
    return path
      ? [
          {
            additions: nonNegativeInteger(record.additions),
            deletions: nonNegativeInteger(record.deletions),
            ...(record.operation === 'write' ||
            record.operation === 'create' ||
            record.operation === 'update' ||
            record.operation === 'delete'
              ? { operation: record.operation }
              : {}),
            path,
          },
        ]
      : []
  })
}

function mergeFileCandidates(
  preferred: readonly FileChangeDisplay[],
  fallback: readonly FileChangeDisplay[],
): FileChangeDisplay[] {
  const files = new Map<string, FileChangeDisplay>()
  for (const file of [...fallback, ...preferred]) {
    const current = files.get(file.path)
    files.set(file.path, {
      additions: file.additions ?? current?.additions ?? null,
      deletions: file.deletions ?? current?.deletions ?? null,
      ...((file.operation ?? current?.operation)
        ? { operation: file.operation ?? current?.operation }
        : {}),
      path: file.path,
    })
  }
  return [...files.values()]
}

export function fileMutationDisplay(item: ToolItem): FileMutationDisplay | null {
  if (!isFileMutationTool(item)) return null
  const input = inputRecord(item.input)
  const output = parsedOutputRecord(item.output)
  const outputSummary = inputRecord(output.summary)
  const inputSummary = inputRecord(input.summary)
  const activityFiles: FileChangeDisplay[] =
    item.activity?.type === 'file_change'
      ? item.activity.changes.map((change) => ({
          additions: nonNegativeInteger(change.additions),
          deletions: nonNegativeInteger(change.deletions),
          operation: change.operation,
          path: change.path,
        }))
      : []
  let files = mergeFileCandidates(
    activityFiles,
    mergeFileCandidates(
      fileCandidates(output.files),
      fileCandidates(input.affectedPaths ?? input.files),
    ),
  )
  if (files.length === 0) {
    const path = safeDisplayPath(
      inputText(output, 'path', 'file_path', 'filePath') ??
        inputText(input, 'file_path', 'filePath', 'path'),
    )
    if (path) files = [{ additions: null, deletions: null, path }]
  }
  if (files.length === 0) {
    files = [{ additions: null, deletions: null, path: '文件' }]
  }
  const totalAdditions = nonNegativeInteger(
    output.totalAdditions ??
      output.additions ??
      outputSummary.additions ??
      input.totalAdditions ??
      input.additions ??
      inputSummary.additions,
  )
  const totalDeletions = nonNegativeInteger(
    output.totalDeletions ??
      output.deletions ??
      outputSummary.deletions ??
      input.totalDeletions ??
      input.deletions ??
      inputSummary.deletions,
  )
  if (files.length === 1) {
    files = [
      {
        additions: files[0].additions ?? totalAdditions,
        deletions: files[0].deletions ?? totalDeletions,
        ...(files[0].operation ? { operation: files[0].operation } : {}),
        path: files[0].path,
      },
    ]
  }
  return {
    files,
    state: item.state,
    toolItemId: item.id,
    totalAdditions,
    totalDeletions,
  }
}

export function fileMutationLabel(
  state: ToolItem['state'],
  path: string,
  operation: FileChangeDisplay['operation'] = 'update',
): string {
  const action = operation === 'create' ? '创建' : operation === 'delete' ? '删除' : '编辑'
  if (state === 'completed') return `已${action} ${path}`
  if (state === 'error') return `${action}失败 ${path}`
  if (state === 'interrupted') return `已停止${action} ${path}`
  return `正在${action} ${path}`
}

function PatchFileButton({
  file,
  onOpenReview,
}: {
  file: FileChangeDisplay
  onOpenReview?: CanonicalItemRendererProps['onOpenPatchReview']
}): React.ReactNode {
  return (
    <button
      className="canonical-patch-card__file"
      onClick={() => onOpenReview?.(file.path)}
      title={file.path}
      type="button"
    >
      <span>{file.path}</span>
      {file.additions !== null ? (
        <small className="canonical-diff-add">+{file.additions}</small>
      ) : null}
      {file.deletions !== null ? (
        <small className="canonical-diff-remove">-{file.deletions}</small>
      ) : null}
    </button>
  )
}

export function syntheticPatchDisplay(items: readonly Item[]): PatchDisplay | null {
  const mutations = items.flatMap((item) => {
    if (item.type !== 'tool' || item.state !== 'completed') return []
    const display = fileMutationDisplay(item)
    if (!display) return []
    const files = display.files.filter((file) => file.path !== '文件')
    return files.length ? [{ ...display, files }] : []
  })
  if (mutations.length === 0) return null

  const files = new Map<string, FileChangeDisplay>()
  for (const mutation of mutations) {
    for (const file of mutation.files) {
      const current = files.get(file.path)
      files.set(file.path, {
        additions:
          current?.additions !== null && current?.additions !== undefined && file.additions !== null
            ? current.additions + file.additions
            : (current?.additions ?? file.additions),
        deletions:
          current?.deletions !== null && current?.deletions !== undefined && file.deletions !== null
            ? current.deletions + file.deletions
            : (current?.deletions ?? file.deletions),
        path: file.path,
      })
    }
  }
  const totalsKnown = mutations.every(
    (mutation) => mutation.totalAdditions !== null && mutation.totalDeletions !== null,
  )
  return {
    files: [...files.values()],
    id: 'synthetic-tool-patch',
    totalAdditions: totalsKnown
      ? mutations.reduce((total, mutation) => total + mutation.totalAdditions!, 0)
      : null,
    totalDeletions: totalsKnown
      ? mutations.reduce((total, mutation) => total + mutation.totalDeletions!, 0)
      : null,
  }
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatToolInputForDisplay(tool: string, input: unknown): string {
  const leaf = toolLeafName(tool)
  if (leaf === 'apply_patch' && input && typeof input === 'object' && !Array.isArray(input)) {
    const { patch: _patch, ...safeInput } = input as Record<string, unknown>
    return formatUnknown({
      ...safeInput,
      patch: '[补丁正文已隐藏]',
    })
  }
  if (
    (leaf === 'read' || leaf === 'grep' || leaf === 'glob') &&
    input &&
    typeof input === 'object' &&
    !Array.isArray(input)
  ) {
    const safeInput = { ...(input as Record<string, unknown>) }
    for (const key of ['file_path', 'filePath', 'path']) {
      if (typeof safeInput[key] === 'string') {
        safeInput[key] = safeDisplayPath(safeInput[key]) ?? '<workspace-path>'
      }
    }
    return formatUnknown(safeInput)
  }
  return formatUnknown(input)
}
