import { ConversationItemContext } from './ConversationItemContext.js'
import { ModelSwitchDivider } from './ModelSwitchDivider.js'
import { ReasoningStatusHeading } from './ReasoningStatusHeading.js'
import { cx } from '../../../utils/Cx.js'
import { historicalDeliveryText } from './StructuredDeliveryText.js'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import React from 'react'
import { VisualizationView } from '../../visualization/VisualizationView.js'
import { ChevronRight, CircleAlert, LoaderCircle, RotateCcw, type LucideIcon } from 'lucide-react'
import type { RenderBlocker, RenderTurnEntry } from '@pidex/session-view'
import type { Item } from '@pidex/shared/thread'
import type { DesktopDiffMarkerStyle } from '../../../../shared/Types.js'
import type { VirtualizerHandle } from 'virtua'
import { FullScreenWhaleLoading } from '../../../components/ui/FullScreenWhaleLoading.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../components/ui/Collapsible.js'
import {
  type KeyedDisclosureStore,
  useDisclosureExpanded,
} from '../../../components/ui/KeyedDisclosureStore.js'

import {
  CanonicalItemRenderer,
  CanonicalUserInput,
  FileMutationItemView,
  isFileMutationTool,
  isStandaloneLifecycleTool,
  LifecycleToolItemView,
  PatchSummaryView,
  syntheticPatchDisplay,
  type CanonicalItemRendererProps,
  type PatchAction,
  type ReadThreadPatchDiff,
} from './CanonicalItemRenderer.js'
import { toolSemanticIcon } from './ToolActivityPresentation.js'
import { ConversationTurnErrorBoundary } from '../conversation/ConversationTurnErrorBoundary.js'
import {
  SessionTimelineView,
  captureThreadHistoryAnchor,
  type ThreadTimelineNavigationHandle,
} from './SessionTimelineView.js'
import {
  isProcessItemActive,
  processItemPathState,
  summarizeTurnProcessItems,
  summarizeTurnWork,
  type ProcessSummary,
  type ProcessSemanticKind,
  type TurnWorkSummary,
} from './SummarizeProcessItems.js'
import {
  getTimelineDisclosureStore,
  releaseTimelineDisclosureStore,
  retainTimelineDisclosureStore,
} from './TimelineDisclosureState.js'
import type { OpenPlanInDockRequest } from '../workflow/WorkflowPlanCard.js'
import type { RegisterConversationTurnRow } from '../conversation/UseConversationTurnRowVisibility.js'
import { questionTimelineItems } from './QuestionItemView.js'

export type ProcessActivityProjection =
  { kind: 'groupable'; item: Item } | { kind: 'standalone'; item: Item } | { kind: 'hidden' }

export type ProcessUnit =
  | { kind: 'group'; key: string; items: Item[] }
  | { kind: 'activity'; key: string; item: Item }
  | { kind: 'standalone'; key: string; item: Item }

export type ProcessActivityModel = {
  activeGroupKey: string | null
  showThinkingFallback: boolean
  units: ProcessUnit[]
}

type RawProcessUnit =
  { kind: 'group'; key: string; items: Item[] } | { kind: 'standalone'; key: string; item: Item }

export type TimelineDisclosureProps = ProcessSummary & {
  canExpand?: boolean
  children?: React.ReactNode
  defaultExpanded?: boolean
  disclosure?: { store: KeyedDisclosureStore; id: string }
}

export type CanonicalThreadViewProps = {
  turns: RenderTurnEntry[]
  threadId: string
  active: boolean
  loading: boolean
  /** 首次提交尚未出现时，不展示整块加载画面，只保留已提交消息。 */
  deferInitialLoading?: boolean
  loadingOlder: boolean
  hasOlder: boolean
  error: string | null
  historyError?: string | null
  initialScrollOffset?: number
  layoutResizeActive?: boolean
  listRef: React.RefObject<VirtualizerHandle | null>
  navigationRef: React.Ref<ThreadTimelineNavigationHandle>
  scrollRef: React.RefObject<HTMLElement | null>
  onScroll?: (scrollTop: number) => void
  onCanReturnToBottomChange: (canReturnToBottom: boolean) => void
  onLoadOlder: (beforeCommit?: () => () => void) => Promise<void>
  onReload: () => Promise<void>
  onApplyPatch?: (itemId: string, action: PatchAction, expectedVersion: number) => Promise<void>
  onOpenPatchReview?: (path?: string) => void
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void
  onOpenSubagent: (taskId: string) => void
  registerTurnRow?: RegisterConversationTurnRow
  dockedPlanItemId: string | null
  latestPlanItemId?: string | null
  pendingPlanItemId?: string | null
  diffMarkerStyle?: DesktopDiffMarkerStyle
  readThreadPatchDiff?: ReadThreadPatchDiff
}

const PROCESS_SUMMARY_DEFER_MS = 1_000

export function CanonicalProcessGroup({
  active,
  canExpand = true,
  children,
  defaultExpanded = false,
  disclosure,
  failed,
  kind,
  label,
  summaryKey,
}: TimelineDisclosureProps): React.ReactNode {
  const [localExpanded, setLocalExpanded] = React.useState(defaultExpanded)
  const subscribe = React.useCallback(
    (listener: () => void) =>
      disclosure ? disclosure.store.subscribe(disclosure.id, listener) : () => {},
    [disclosure?.store, disclosure?.id],
  )
  const getSnapshot = React.useCallback(
    () => (disclosure ? disclosure.store.getSnapshot(disclosure.id) : localExpanded),
    [disclosure?.store, disclosure?.id, localExpanded],
  )
  const expanded = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const setExpanded = (value: boolean) => {
    if (disclosure) disclosure.store.setExpanded(disclosure.id, value)
    else setLocalExpanded(value)
  }
  const contentId = React.useId()
  const visibleLabel = useDeferredProcessSummary(label, summaryKey, active)
  const datastate = active ? 'active' : failed ? 'failed' : 'completed'
  const SummaryIcon = processSummaryIcon(active ? 'thinking' : failed ? 'failed' : kind)
  const summaryContent = (
    <>
      {active ? (
        <LoaderCircle size={APP_ICON_SIZES.sm} className="canonical-spin" aria-hidden="true" />
      ) : failed ? (
        <CircleAlert size={APP_ICON_SIZES.sm} aria-hidden="true" />
      ) : (
        <SummaryIcon size={APP_ICON_SIZES.sm} aria-hidden="true" />
      )}
      <span className="cpx-agent-activity__summary">{visibleLabel}</span>
      {canExpand ? (
        <ChevronRight
          size={APP_ICON_SIZES.sm}
          className="cpx-agent-activity__chevron"
          aria-hidden="true"
        />
      ) : null}
    </>
  )

  return (
    <Collapsible open={canExpand && expanded} onOpenChange={setExpanded} asChild>
      <div
        className="cpx-agent-activity"
        data-expandable={canExpand ? 'true' : 'false'}
        data-expanded={expanded ? 'true' : 'false'}
        data-state={datastate}
      >
        {canExpand ? (
          <CollapsibleTrigger asChild>
            <button
              aria-controls={contentId}
              aria-expanded={expanded}
              aria-label={visibleLabel || '处理过程'}
              className="cpx-agent-activity__header"
              type="button"
            >
              {summaryContent}
            </button>
          </CollapsibleTrigger>
        ) : (
          <div
            aria-live={active ? 'polite' : undefined}
            className="cpx-agent-activity__header"
            role={active ? 'status' : undefined}
          >
            {summaryContent}
          </div>
        )}
        <CollapsibleContent
          expanded={canExpand && expanded}
          contentClassName="cpx-agent-activity__content"
          id={contentId}
        >
          <ScrollArea
            className="cpx-agent-activity__list tw:min-w-0 tw:[scrollbar-width:thin]"
            contentClassName="cpx-agent-activity__list-content tw:relative tw:grid tw:gap-[var(--conversation-grouped-item-gap,var(--cpx-sys-space-1))]"
          >
            {children}
          </ScrollArea>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function processSummaryIcon(kind: ProcessSemanticKind): LucideIcon {
  if (kind === 'thinking') return LoaderCircle
  if (kind === 'failed') return CircleAlert
  return toolSemanticIcon(kind)
}

function useDeferredProcessSummary(label: string, summaryKey: string, defer: boolean): string {
  const [visible, setVisible] = React.useState(() => ({ label, summaryKey }))
  const lastCommitAt = React.useRef(Date.now())

  React.useEffect(() => {
    if (visible.summaryKey === summaryKey) return
    const commit = (): void => {
      lastCommitAt.current = Date.now()
      setVisible({ label, summaryKey })
    }
    if (!defer) {
      commit()
      return
    }
    const remaining = PROCESS_SUMMARY_DEFER_MS - (Date.now() - lastCommitAt.current)
    if (remaining <= 0) {
      commit()
      return
    }
    const timeout = window.setTimeout(commit, remaining)
    return () => window.clearTimeout(timeout)
  }, [defer, label, summaryKey, visible.summaryKey])

  return defer && visible.summaryKey !== summaryKey ? visible.label : label
}

function groupProcessItems(items: readonly Item[]): RawProcessUnit[] {
  const units: RawProcessUnit[] = []
  let pendingItems: Item[] = []
  const flush = (): void => {
    const [single] = pendingItems
    if (!single) return
    units.push({
      kind: 'group',
      key: `process-group:${single.id}`,
      items: pendingItems,
    })
    pendingItems = []
  }

  for (const item of items) {
    const projection = projectProcessItem(item)
    switch (projection.kind) {
      case 'groupable':
        pendingItems.push(projection.item)
        break
      case 'hidden':
        break
      case 'standalone':
        flush()
        units.push({
          kind: 'standalone',
          key: `process-standalone:${projection.item.id}`,
          item: projection.item,
        })
        break
    }
  }
  flush()
  return units
}

export function buildProcessActivityModel(
  items: readonly Item[],
  {
    activitySliceClosed,
    hasBlockingRequest = false,
    turnActive,
  }: {
    activitySliceClosed: boolean
    hasBlockingRequest?: boolean
    turnActive: boolean
  },
): ProcessActivityModel {
  const rawUnits = groupProcessItems(items)
  const lastUnitIndex = rawUnits.length - 1
  const sliceActive = turnActive && !activitySliceClosed
  let activeGroupKey: string | null = null

  const units = rawUnits.map((unit, unitIndex): ProcessUnit => {
    if (unit.kind === 'standalone') return unit
    const [single] = unit.items
    const isLatestActiveUnit = sliceActive && unitIndex === lastUnitIndex
    const containsActiveItem = unit.items.some(isProcessItemActive)
    if (isLatestActiveUnit) activeGroupKey = unit.key
    if (single && unit.items.length === 1 && !containsActiveItem && !isLatestActiveUnit) {
      return {
        kind: 'activity',
        key: `process-item:${single.id}`,
        item: single,
      }
    }
    return unit
  })

  const lastUnit = rawUnits.at(-1)
  const showThinkingFallback =
    sliceActive &&
    !hasBlockingRequest &&
    (!lastUnit || (lastUnit.kind === 'standalone' && !isProcessItemActive(lastUnit.item)))

  return { activeGroupKey, showThinkingFallback, units }
}

export function projectProcessItem(item: Item): ProcessActivityProjection {
  if (item.type === 'reasoning') return { kind: 'hidden' }
  if (item.type === 'text') return { kind: 'standalone', item }
  if (item.type === 'activity' && item.activity === 'context-compression') {
    return { kind: 'standalone', item }
  }
  if (item.type === 'tool' && isStandaloneLifecycleTool(item)) {
    return { kind: 'standalone', item }
  }
  if (
    item.type === 'plan' ||
    item.type === 'execution-plan' ||
    item.type === 'question' ||
    item.type === 'patch'
  ) {
    return { kind: 'standalone', item }
  }
  return { kind: 'groupable', item }
}

export function CanonicalTurnActivity({
  canCollapse,
  children,
  expanded,
  onExpandedChange,
  summary,
}: {
  canCollapse: boolean
  children?: React.ReactNode
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  summary: TurnWorkSummary | null
}): React.ReactNode {
  const contentId = React.useId()
  const hasContent = children != null
  const disclosureEnabled = canCollapse && hasContent && summary != null
  const contentVisible = hasContent && (!disclosureEnabled || expanded)
  const content = hasContent ? (
    <div className="canonical-turn-activity__content">{children}</div>
  ) : null

  if (!summary) {
    return content
  }

  const summaryContent = (
    <>
      <span className="tw:min-w-0 tw:truncate">{summary.label}</span>
      {disclosureEnabled ? (
        <ChevronRight
          size={APP_ICON_SIZES.sm}
          aria-hidden="true"
          className={cx(
            'canonical-turn-activity__chevron tw:size-[var(--inline-icon-size,1em)] tw:flex-none tw:transition-transform tw:duration-disclosure tw:ease-disclosure',
            expanded ? 'tw:rotate-90' : 'tw:rotate-0',
          )}
        />
      ) : null}
    </>
  )

  return (
    <Collapsible open={contentVisible} onOpenChange={onExpandedChange} asChild>
      <section
        className="canonical-turn-activity"
        data-expandable={disclosureEnabled ? 'true' : 'false'}
        data-expanded={contentVisible ? 'true' : 'false'}
        data-state={summary.kind}
      >
        {disclosureEnabled ? (
          <CollapsibleTrigger asChild>
            <button
              aria-controls={contentId}
              aria-expanded={expanded}
              aria-label={`${expanded ? '收起' : '展开'}处理过程：${summary.label}`}
              className={cx(
                'canonical-turn-activity__summary tw:inline-flex tw:min-h-8 tw:w-fit tw:max-w-full tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit',
                'tw:cursor-pointer tw:transition-colors tw:duration-state tw:ease-out tw:hover:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus',
              )}
              type="button"
            >
              {summaryContent}
            </button>
          </CollapsibleTrigger>
        ) : (
          <div className="canonical-turn-activity__summary tw:inline-flex tw:min-h-8 tw:w-fit tw:max-w-full tw:items-center tw:gap-2 tw:p-0 tw:text-left tw:text-inherit">
            {summaryContent}
          </div>
        )}
        <div
          aria-hidden="true"
          className="canonical-turn-activity__divider tw:w-full tw:border-t tw:border-app-border-subtle"
        />
        <CollapsibleContent
          expanded={contentVisible}
          contentClassName="canonical-turn-activity__content"
          id={contentId}
        >
          {children}
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

export function useTurnElapsedSeconds(turn: RenderTurnEntry['turn'], active: boolean): number {
  const [now, setNow] = React.useState(Date.now)

  React.useEffect(() => {
    setNow(Date.now())
    if (!active || turn.startedAt == null) return
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [active, turn.id, turn.startedAt])

  return resolveTurnElapsedSeconds(turn, active, now)
}

export function resolveTurnElapsedSeconds(
  turn: RenderTurnEntry['turn'],
  active: boolean,
  now: number,
): number {
  if (turn.startedAt == null) return turn.elapsedSeconds
  if (!active) {
    const terminalElapsed =
      turn.finishedAt == null
        ? 0
        : Math.floor(Math.max(0, turn.finishedAt - turn.startedAt) / 1_000)
    return Math.max(turn.elapsedSeconds, terminalElapsed)
  }
  return Math.max(turn.elapsedSeconds, Math.floor(Math.max(0, now - turn.startedAt) / 1_000))
}

const CanonicalTurnActivityController = React.memo(function CanonicalTurnActivityController({
  active,
  canCollapse,
  forceExpanded,
  children,
  disclosureId,
  hasWork,
  store,
  turn,
}: {
  active: boolean
  canCollapse: boolean
  children?: React.ReactNode
  disclosureId: string
  forceExpanded?: boolean
  hasWork: boolean
  store: KeyedDisclosureStore
  turn: RenderTurnEntry['turn']
}): React.ReactNode {
  const storedExpanded = useDisclosureExpanded(store, disclosureId)
  const elapsedSeconds = useTurnElapsedSeconds(turn, active)
  const summary = hasWork ? summarizeTurnWork(turn.status, elapsedSeconds) : null

  return (
    <CanonicalTurnActivity
      canCollapse={canCollapse}
      expanded={!canCollapse || forceExpanded === true || storedExpanded}
      onExpandedChange={(expanded) => {
        if (!forceExpanded) store.setExpanded(disclosureId, expanded)
      }}
      summary={summary}
    >
      {children}
    </CanonicalTurnActivity>
  )
})

export function useTimelineDisclosureState(threadId: string): KeyedDisclosureStore {
  const store = React.useMemo(() => getTimelineDisclosureStore(threadId), [threadId])
  React.useEffect(() => {
    const retainedStore = retainTimelineDisclosureStore(threadId)
    return () => releaseTimelineDisclosureStore(retainedStore)
  }, [store, threadId])
  return store
}

function CanonicalThreadViewComponent({
  turns,
  threadId,
  active,
  loading,
  deferInitialLoading = false,
  loadingOlder,
  hasOlder,
  error,
  historyError,
  initialScrollOffset,
  layoutResizeActive,
  listRef,
  navigationRef,
  scrollRef,
  onScroll,
  onCanReturnToBottomChange,
  onLoadOlder,
  onReload,
  onApplyPatch,
  onOpenPatchReview,
  onOpenPlanInRightDock,
  onOpenSubagent,
  registerTurnRow,
  dockedPlanItemId,
  latestPlanItemId = null,
  pendingPlanItemId = null,
  diffMarkerStyle = 'color',
  readThreadPatchDiff,
}: CanonicalThreadViewProps): React.ReactNode {
  const itemContext = React.useContext(ConversationItemContext)
  const lastInput = turns
    .flatMap((turn) => turn.userItems)
    .findLast((input) => input.origin !== 'goal-continuation')
  const editableInputId =
    lastInput && turns.find((turn) => turn.turn.id === lastInput.turnId)?.userItems.length === 1
      ? lastInput.id
      : null
  const editContext = React.useMemo(
    () => (itemContext ? { ...itemContext, editableInputId } : null),
    [itemContext, editableInputId],
  )
  const disclosureState = useTimelineDisclosureState(threadId)
  const loadOlderPreservingAnchor = React.useCallback(async (): Promise<void> => {
    await onLoadOlder(() => captureThreadHistoryAnchor(listRef.current, scrollRef.current))
  }, [listRef, onLoadOlder, scrollRef])
  const renderTurn = React.useCallback(
    (entry: RenderTurnEntry, index: number): React.ReactElement => (
      <CanonicalTurnRow
        diffMarkerStyle={diffMarkerStyle}
        disclosureState={disclosureState}
        entry={entry}
        previousModel={turns[index - 1]?.turn.model}
        key={entry.id}
        onApplyPatch={onApplyPatch}
        onOpenPatchReview={onOpenPatchReview}
        onOpenPlanInRightDock={onOpenPlanInRightDock}
        onOpenSubagent={onOpenSubagent}
        registerTurnRow={registerTurnRow}
        dockedPlanItemId={dockedPlanItemId}
        latestPlanItemId={latestPlanItemId}
        pendingPlanItemId={pendingPlanItemId}
        readThreadPatchDiff={readThreadPatchDiff}
        threadId={threadId}
      />
    ),
    [
      disclosureState,
      diffMarkerStyle,
      onApplyPatch,
      onOpenPatchReview,
      onOpenPlanInRightDock,
      onOpenSubagent,
      registerTurnRow,
      dockedPlanItemId,
      latestPlanItemId,
      pendingPlanItemId,
      readThreadPatchDiff,
      threadId,
      turns,
    ],
  )

  if (loading && turns.length === 0 && !deferInitialLoading) {
    return <FullScreenWhaleLoading label="正在加载会话内容…" variant="contained" />
  }

  if (error && turns.length === 0) {
    return (
      <div
        className="canonical-thread-state canonical-thread-state--error tw:mx-auto tw:flex tw:min-h-40 tw:w-[min(var(--page-content-max-width),var(--session-content-w))] tw:items-center tw:justify-center tw:gap-2 tw:p-6 tw:text-app-text-soft tw:type-body-sm"
        role="alert"
      >
        <CircleAlert size="var(--inline-icon-size, 1em)" aria-hidden="true" />
        <span className="tw:grid">
          <strong>无法加载会话</strong>
          <small className="tw:max-w-[520px] tw:wrap-anywhere">{error}</small>
        </span>
        <button
          className="tw:inline-flex tw:min-h-[34px] tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-control tw:border tw:border-app-border-subtle tw:bg-app-panel tw:px-3 tw:py-2 tw:text-app-text"
          type="button"
          onClick={() => void onReload()}
        >
          <RotateCcw size="var(--inline-icon-size, 1em)" aria-hidden="true" />
          重试
        </button>
      </div>
    )
  }

  return (
    <div
      className="canonical-thread-view tw:w-full tw:min-w-0"
      data-canonical-thread-id={threadId}
      data-canonical-turn-count={turns.length}
    >
      {hasOlder ? (
        <div className="canonical-history-control tw:mx-auto tw:mt-3 tw:mb-1 tw:flex tw:w-[min(var(--page-content-max-width),var(--session-content-w))] tw:justify-center">
          <button
            className="tw:inline-flex tw:min-h-8 tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-control tw:border-0 tw:bg-transparent tw:px-3 tw:py-1 tw:text-app-text-soft tw:type-body-sm tw:transition-colors tw:duration-state tw:ease-out tw:hover:bg-app-hover tw:hover:text-app-text tw:disabled:cursor-wait tw:disabled:opacity-65"
            type="button"
            disabled={loadingOlder}
            onClick={() => void loadOlderPreservingAnchor()}
          >
            {loadingOlder ? (
              <LoaderCircle
                size={APP_ICON_SIZES.sm}
                className="canonical-spin"
                aria-hidden="true"
              />
            ) : null}
            {loadingOlder ? '正在加载' : historyError ? '重试加载更早的对话' : '加载更早的对话'}
          </button>
        </div>
      ) : null}
      {historyError ? (
        <p role="status" className="tw:text-center tw:text-app-text-meta tw:type-caption">
          {historyError}
        </p>
      ) : null}
      <ConversationItemContext.Provider value={editContext}>
        <SessionTimelineView
          key={threadId}
          count={turns.length}
          initialScrollOffset={initialScrollOffset}
          layoutResizeActive={layoutResizeActive}
          items={turns}
          listRef={listRef}
          navigationRef={navigationRef}
          onCanReturnToBottomChange={onCanReturnToBottomChange}
          onScroll={onScroll}
          scrollRef={scrollRef}
          scrollToBottom={active}
          sessionKey={threadId}
          renderItem={renderTurn}
        />
      </ConversationItemContext.Provider>
    </div>
  )
}

export const CanonicalThreadView = React.memo(CanonicalThreadViewComponent)

const CanonicalTurnRow = React.memo(function CanonicalTurnRow({
  disclosureState,
  diffMarkerStyle,
  entry,
  previousModel,
  onApplyPatch,
  onOpenPatchReview,
  onOpenPlanInRightDock,
  onOpenSubagent,
  registerTurnRow,
  dockedPlanItemId,
  latestPlanItemId,
  pendingPlanItemId,
  readThreadPatchDiff,
  threadId,
}: {
  disclosureState: KeyedDisclosureStore
  entry: RenderTurnEntry
  previousModel?: RenderTurnEntry['turn']['model']
  diffMarkerStyle: DesktopDiffMarkerStyle
  onApplyPatch?: CanonicalThreadViewProps['onApplyPatch']
  onOpenPatchReview?: CanonicalThreadViewProps['onOpenPatchReview']
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void
  onOpenSubagent: (taskId: string) => void
  registerTurnRow?: RegisterConversationTurnRow
  dockedPlanItemId: string | null
  latestPlanItemId?: string | null
  pendingPlanItemId?: string | null
  readThreadPatchDiff?: ReadThreadPatchDiff
  threadId: string
}): React.ReactNode {
  return (
    <div
      className="session-turn-row canonical-turn-row tw:mx-auto tw:w-full tw:min-w-0"
      data-component="conversation-turn"
      data-turn-navigation-id={entry.id}
    >
      <ConversationTurnErrorBoundary turnId={entry.id}>
        <ModelSwitchDivider previousModel={previousModel} model={entry.turn.model} />
        <CanonicalConversationTurn
          disclosureState={disclosureState}
          diffMarkerStyle={diffMarkerStyle}
          entry={entry}
          registerInputRow={registerTurnRow}
          onApplyPatch={onApplyPatch}
          onOpenPatchReview={onOpenPatchReview}
          onOpenPlanInRightDock={onOpenPlanInRightDock}
          onOpenSubagent={onOpenSubagent}
          dockedPlanItemId={dockedPlanItemId}
          latestPlanItemId={latestPlanItemId}
          pendingPlanItemId={pendingPlanItemId}
          readThreadPatchDiff={readThreadPatchDiff}
          threadId={threadId}
        />
      </ConversationTurnErrorBoundary>
    </div>
  )
})

function CanonicalConversationTurnComponent({
  isSubagent = false,
  disclosureState,
  diffMarkerStyle = 'color',
  entry,
  registerInputRow,
  onApplyPatch,
  onOpenPatchReview,
  onOpenPlanInRightDock,
  onOpenSubagent,
  dockedPlanItemId,
  latestPlanItemId,
  pendingPlanItemId,
  readThreadPatchDiff,
  threadId,
}: {
  isSubagent?: boolean
  disclosureState: KeyedDisclosureStore
  entry: RenderTurnEntry
  registerInputRow?: RegisterConversationTurnRow
  diffMarkerStyle?: DesktopDiffMarkerStyle
  onApplyPatch?: CanonicalThreadViewProps['onApplyPatch']
  onOpenPatchReview?: CanonicalThreadViewProps['onOpenPatchReview']
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void
  onOpenSubagent: (taskId: string) => void
  dockedPlanItemId: string | null
  latestPlanItemId?: string | null
  pendingPlanItemId?: string | null
  readThreadPatchDiff?: ReadThreadPatchDiff
  threadId?: string
}): React.ReactNode {
  const disclosure = (id: string) => ({ id, store: disclosureState })
  const renderItem = (
    item: RenderTurnEntry['items'][number],
    options: {
      disclosureId?: string
      presentation?: CanonicalItemRendererProps['presentation']
      showAssistantActions?: boolean
    } = {},
  ) => (
    <CanonicalItemRenderer
      disclosure={
        options.disclosureId
          ? disclosure(options.disclosureId)
          : item.type === 'question'
            ? disclosure(`question:${item.id}`)
            : undefined
      }
      item={item}
      key={item.id}
      onApplyPatch={onApplyPatch}
      onOpenPatchReview={onOpenPatchReview}
      onOpenPlanInRightDock={onOpenPlanInRightDock}
      onOpenSubagent={onOpenSubagent}
      presentation={options.presentation}
      dockedPlanItemId={dockedPlanItemId}
      latestPlanItemId={latestPlanItemId}
      pendingPlanItemId={pendingPlanItemId}
      showAssistantActions={options.showAssistantActions}
      threadId={threadId}
    />
  )
  const renderProcessItem = (
    item: RenderTurnEntry['processItems'][number],
    presentation: NonNullable<CanonicalItemRendererProps['presentation']>,
  ): React.ReactNode => {
    if (item.type === 'tool' && isFileMutationTool(item)) {
      return (
        <FileMutationItemView
          diffMarkerStyle={diffMarkerStyle}
          disclosureStore={disclosureState}
          item={item}
          key={item.id}
          readThreadPatchDiff={readThreadPatchDiff}
          threadId={threadId}
        />
      )
    }
    if (item.type === 'tool' && isStandaloneLifecycleTool(item)) {
      return <LifecycleToolItemView item={item} isSubagent={isSubagent} key={item.id} />
    }
    return renderItem(item, {
      disclosureId: `process-item:${item.id}`,
      presentation,
    })
  }
  const active = isActiveTurn(entry.turn.status)
  const historicalDeliveries = !isSubagent
    ? entry.processItems.filter(
        (item) => item.type === 'tool' && historicalDeliveryText(item) !== null,
      )
    : []
  const historicalDeliveryIds = new Set(historicalDeliveries.map((item) => item.id))
  const processItems = entry.processItems.filter((item) => !historicalDeliveryIds.has(item.id))
  const hasAssistantResult =
    entry.assistantResultItems.length > 0 ||
    historicalDeliveries.length > 0 ||
    entry.contentBlocks.some((block) => block.kind === 'visualization')
  const activitySliceClosed = hasAssistantResult && !entry.forceExpandActivity
  const processActivity = buildProcessActivityModel(
    questionTimelineItems(processItems, entry.items),
    {
      activitySliceClosed,
      hasBlockingRequest: entry.blockers.length > 0,
      turnActive: active,
    },
  )
  const hasVisibleActivityContent =
    processActivity.units.length > 0 || processActivity.showThinkingFallback
  const turnActivityDisclosureId = `turn-activity:${entry.turn.id}`
  const canCollapseTurnActivity = activitySliceClosed && hasVisibleActivityContent
  const syntheticPatch =
    !active && entry.patchItems.length === 0 ? syntheticPatchDisplay(entry.processItems) : null
  const activityContent = hasVisibleActivityContent ? (
    <section className="canonical-turn__process" aria-label="处理过程">
      {processActivity.units.map((unit) => {
        if (unit.kind === 'activity') {
          return (
            <React.Fragment key={unit.key}>
              {renderProcessItem(unit.item, 'grouped')}
            </React.Fragment>
          )
        }
        if (unit.kind === 'standalone') {
          return (
            <React.Fragment key={unit.key}>
              {renderProcessItem(unit.item, 'standalone')}
            </React.Fragment>
          )
        }
        const summary = summarizeTurnProcessItems(
          unit.items,
          unit.key === processActivity.activeGroupKey ? entry.turn.status : 'completed',
        )
        return (
          <CanonicalProcessGroup
            {...summary}
            canExpand={unit.items.length > 0}
            disclosure={disclosure(`process-group:${entry.turn.id}:${unit.key}`)}
            key={unit.key}
          >
            {unit.items.map((item) => (
              <div
                className="cpx-agent-activity__path-step"
                data-state={processItemPathState(item)}
                key={item.id}
              >
                {renderProcessItem(item, 'grouped')}
              </div>
            ))}
          </CanonicalProcessGroup>
        )
      })}
      {processActivity.showThinkingFallback ? (
        <div className="canonical-turn__thinking" role="status" aria-live="polite">
          <LoaderCircle size={APP_ICON_SIZES.sm} className="canonical-spin" aria-hidden="true" />
          <ReasoningStatusHeading
            item={processItems.findLast((item) => item.type === 'reasoning')}
            threadId={threadId}
          />
        </div>
      ) : null}
    </section>
  ) : null

  return (
    <article className="canonical-turn" data-status={entry.turn.status}>
      {entry.userItems.length ? (
        <section className="canonical-turn__user" aria-label="用户消息">
          {entry.userItems.map((input) => (
            <CanonicalUserInput
              attachments={entry.attachments.filter((attachment) =>
                input.attachmentIds?.includes(attachment.id),
              )}
              contextReferences={entry.contextReferences.filter((reference) =>
                input.contextReferenceIds?.includes(reference.id),
              )}
              input={input}
              registerInputRow={registerInputRow}
              key={input.id}
            />
          ))}
        </section>
      ) : null}
      <CanonicalTurnActivityController
        active={active}
        canCollapse={canCollapseTurnActivity && !entry.forceExpandActivity}
        forceExpanded={entry.forceExpandActivity}
        disclosureId={turnActivityDisclosureId}
        hasWork={
          entry.turn.startedAt != null || entry.processItems.length > 0 || hasAssistantResult
        }
        store={disclosureState}
        turn={entry.turn}
      >
        {activityContent}
      </CanonicalTurnActivityController>
      {entry.blockers.length ? (
        <section className="canonical-turn__blockers" aria-label="等待处理">
          {entry.blockers.map((blocker) => (
            <CanonicalBlocker blocker={blocker} key={blocker.id} renderItem={renderItem} />
          ))}
        </section>
      ) : null}
      {entry.planItem ? (
        <section className="canonical-turn__plan">{renderItem(entry.planItem)}</section>
      ) : null}
      {hasAssistantResult ? (
        <section className="canonical-turn__result" aria-label="助手回复">
          {entry.contentBlocks.map((block) =>
            block.kind === 'visualization' ? (
              <VisualizationView item={block.item} threadId={threadId} key={block.id} />
            ) : block.kind === 'assistant' ? (
              block.items.map((item) => renderItem(item, { showAssistantActions: true }))
            ) : null,
          )}
          {historicalDeliveries.map((item) =>
            item.type === 'tool' ? <LifecycleToolItemView item={item} key={item.id} /> : null,
          )}
        </section>
      ) : null}
      {!active && entry.patchItems.length > 0 ? (
        <section className="canonical-turn__post" aria-label="文件更改">
          {entry.patchItems.map((item) => renderItem(item))}
        </section>
      ) : null}
      {syntheticPatch ? (
        <section className="canonical-turn__post" aria-label="文件更改">
          <PatchSummaryView onOpenReview={onOpenPatchReview} patch={syntheticPatch} />
        </section>
      ) : null}
      {entry.postAssistantItems.length > 0 ? (
        <section className="canonical-turn__post">
          {entry.postAssistantItems.map((item) => renderItem(item))}
        </section>
      ) : null}
      {entry.turn.error ? (
        <div className="canonical-turn__status canonical-turn__status--error">
          <CircleAlert size="var(--inline-icon-size, 1em)" aria-hidden="true" />
          <span>{entry.turn.error}</span>
        </div>
      ) : null}
    </article>
  )
}

export const CanonicalConversationTurn = React.memo(CanonicalConversationTurnComponent)

function CanonicalBlocker({
  blocker,
  renderItem,
}: {
  blocker: RenderBlocker
  renderItem: (item: RenderTurnEntry['items'][number]) => React.ReactNode
}): React.ReactNode {
  if (blocker.kind === 'question') return renderItem(blocker.question)
  return (
    <article
      className="canonical-blocker-card tw:grid tw:gap-3 tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-3 tw:shadow-none"
      data-state={blocker.approval.status}
    >
      <header className="tw:flex tw:items-start tw:gap-2">
        <CircleAlert
          className="tw:flex-none tw:text-app-accent-fg"
          size={APP_ICON_SIZES.lg}
          aria-hidden="true"
        />
        <strong>{blocker.approval.tool} 需要授权</strong>
      </header>
      <p className="tw:m-0 tw:text-app-text-soft">{blocker.approval.reason}</p>
    </article>
  )
}

function isActiveTurn(status: RenderTurnEntry['turn']['status']): boolean {
  return (
    status === 'running' ||
    status === 'waiting-permission' ||
    status === 'waiting-question' ||
    status === 'waiting-subagents'
  )
}
