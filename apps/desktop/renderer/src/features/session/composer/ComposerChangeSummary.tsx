import React from 'react'
import { ArrowDown, Check, CircleX, Ellipsis } from 'lucide-react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import type { ExecutionPlanItem } from '@pidex/shared/thread'

import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import {
  fastTween,
  instantTween,
  motionTransition,
  standardTween,
} from '../../motion/MotionTransitions.js'
import {
  TooltipContent,
  TooltipPortal,
  TooltipRoot,
  TooltipTrigger,
} from '../../../components/ui/Tooltip.js'
import { ExecutionPlanCard } from '../workflow/ExecutionPlanCard.js'
import type { ConversationChangedFile } from './ConversationChangeSummary.js'

type ComposerChangeSummaryProps = {
  executionPlan: ExecutionPlanItem | null
  active: boolean
  failed: boolean
  changedFiles: readonly ConversationChangedFile[]
  additions: number | null
  deletions: number | null
  canReturnToBottom: boolean
  onOpenReview: () => void
  onOpenReviewFile: (path: string) => void
  onReturnToBottom: () => void
}

const RETURN_BUTTON_ENTER_DELAY_SECONDS = 0.06

type ComposerPlanLifecycle = ExecutionPlanItem['status'] | 'failed'
type ComposerSummaryPreviewKind = 'plan' | 'files' | null

export function ComposerChangeSummary({
  executionPlan,
  active,
  failed,
  changedFiles,
  additions,
  deletions,
  canReturnToBottom,
  onOpenReview,
  onOpenReviewFile,
  onReturnToBottom,
}: ComposerChangeSummaryProps): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const planPanelId = React.useId()
  const filesPanelId = React.useId()
  const [activePreview, setActivePreview] = React.useState<ComposerSummaryPreviewKind>(null)
  const summaryRef = React.useRef<HTMLDivElement | null>(null)
  const planPopoverRef = React.useRef<HTMLDivElement | null>(null)
  const filesPopoverRef = React.useRef<HTMLDivElement | null>(null)

  const changedFileCount = changedFiles.length
  const hasPlan = executionPlan !== null && executionPlan.steps.length > 0
  if (!hasPlan && changedFileCount <= 0) return null

  function openReview(): void {
    setActivePreview(null)
    onOpenReview()
  }

  function openReviewFile(path: string): void {
    setActivePreview(null)
    onOpenReviewFile(path)
  }

  const currentStep = executionPlan ? executionPlanStepPosition(executionPlan) : 0
  const planExpanded = hasPlan && activePreview === 'plan'
  const filesExpanded = changedFileCount > 0 && activePreview === 'files'
  const diffStatsAvailable = additions !== null && deletions !== null
  const formattedAdditions = formatSummaryNumber(additions ?? 0)
  const formattedDeletions = formatSummaryNumber(deletions ?? 0)
  const running = active && !failed
  const planLifecycle: ComposerPlanLifecycle = failed
    ? 'failed'
    : active
      ? 'streaming'
      : (executionPlan?.status ?? 'interrupted')
  const planStatusText =
    planLifecycle === 'completed'
      ? '已全部完成'
      : planLifecycle === 'failed'
        ? '执行出错'
        : planLifecycle === 'interrupted'
          ? '执行已中断'
          : hasPlan
            ? `第 ${currentStep} / ${executionPlan.steps.length} 步`
            : ''

  return (
    <div
      className="composer-change-summary tw:relative tw:flex tw:w-full tw:max-w-full tw:items-center tw:justify-center tw:self-center tw:gap-2 tw:box-border tw:rounded-xl tw:pointer-events-auto"
      ref={summaryRef}
    >
      <motion.div
        className="composer-change-summary__bar-shell tw:flex tw:w-fit tw:min-w-0 tw:max-w-full tw:flex-[0_1_auto]"
        layout="position"
        transition={motionTransition(reducedMotion, standardTween)}
      >
        <div
          aria-label="任务变更摘要"
          className="composer-change-summary__bar tw:relative tw:inline-flex tw:z-1 tw:h-8 tw:min-h-8 tw:w-auto tw:min-w-0 tw:max-w-full tw:flex-[1_1_auto] tw:items-center tw:justify-center tw:gap-0 tw:box-border tw:overflow-hidden tw:rounded-xl tw:border tw:border-app-border-subtle tw:bg-app-raised tw:p-0 tw:text-app-text tw:type-body-sm tw:shadow-lg tw:backdrop-blur-md"
          role="group"
        >
          {hasPlan ? (
            <TooltipRoot
              delayDuration={0}
              interactive
              open={planExpanded}
              onOpenChange={(open) => setActivePreview(open ? 'plan' : null)}
            >
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-controls={planPanelId}
                  aria-expanded={planExpanded}
                  className="composer-change-summary__plan tw:inline-flex tw:h-full tw:min-h-0 tw:min-w-0 tw:flex-none tw:items-center tw:gap-2 tw:rounded-none tw:border-0 tw:bg-transparent tw:py-0 tw:ps-4 tw:pe-0 tw:only:ps-4 tw:only:pe-4 tw:text-inherit tw:whitespace-nowrap tw:enabled:hover:bg-transparent tw:enabled:hover:text-app-text tw:enabled:hover:shadow-none tw:aria-expanded:bg-transparent tw:aria-expanded:text-app-text tw:aria-expanded:shadow-none"
                  onBlur={(e) => {
                    const related = e.relatedTarget as Node | null
                    if (
                      (related && planPopoverRef.current?.contains(related)) ||
                      planPopoverRef.current?.matches(':hover')
                    ) {
                      e.preventDefault()
                    }
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    setActivePreview((prev) => (prev === 'plan' ? null : 'plan'))
                  }}
                >
                  <ExecutionPlanStatusIcon steps={executionPlan.steps} status={planLifecycle} />
                  {planStatusText}
                </button>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent
                  align="center"
                  aria-label="执行计划"
                  className="composer-change-summary__plan-popover tw:z-tooltip tw:box-border tw:w-max tw:min-w-[min(16rem,calc(100vw-var(--cpx-sys-space-4)))] tw:max-w-[min(22rem,calc(100vw-var(--cpx-sys-space-4)))] tw:overflow-hidden tw:rounded-xl tw:border tw:border-app-border-subtle tw:bg-app-raised tw:text-app-text tw:shadow-lg tw:backdrop-blur-md"
                  id={planPanelId}
                  ref={planPopoverRef}
                  side="top"
                  sideOffset={8}
                  variant="unstyled"
                  onBlurCapture={(e) => {
                    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) {
                      return
                    }
                    setActivePreview(null)
                  }}
                >
                  <ExecutionPlanCard item={executionPlan} />
                </TooltipContent>
              </TooltipPortal>
            </TooltipRoot>
          ) : null}
          {hasPlan && changedFileCount > 0 ? (
            <span
              aria-hidden="true"
              className="composer-change-summary__separator tw:mx-2 tw:flex-none tw:text-app-text-meta"
            >
              ·
            </span>
          ) : null}
          {changedFileCount > 0 ? (
            <TooltipRoot
              delayDuration={0}
              interactive
              open={filesExpanded}
              onOpenChange={(open) => setActivePreview(open ? 'files' : null)}
            >
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-controls={filesPanelId}
                  aria-expanded={filesExpanded}
                  aria-label={
                    diffStatsAvailable
                      ? `打开审阅面板，${changedFileCount} 个文件已更改，新增 ${formattedAdditions} 行，删除 ${formattedDeletions} 行`
                      : `打开审阅面板，${changedFileCount} 个文件已更改，增删行数统计暂不可用`
                  }
                  className="composer-change-summary__changes tw:inline-flex tw:h-full tw:min-h-0 tw:min-w-0 tw:flex-[1_1_auto] tw:items-center tw:gap-2 tw:overflow-hidden tw:rounded-none tw:border-0 tw:bg-transparent tw:py-0 tw:ps-0 tw:pe-4 tw:text-ellipsis tw:text-inherit tw:whitespace-nowrap tw:only:ps-4 tw:only:pe-4 tw:enabled:hover:bg-transparent tw:enabled:hover:text-app-text tw:enabled:hover:shadow-none tw:aria-expanded:bg-transparent tw:aria-expanded:text-app-text tw:aria-expanded:shadow-none"
                  onBlur={(e) => {
                    const related = e.relatedTarget as Node | null
                    if (
                      (related && filesPopoverRef.current?.contains(related)) ||
                      filesPopoverRef.current?.matches(':hover')
                    ) {
                      e.preventDefault()
                    }
                  }}
                  onClick={openReview}
                >
                  {changedFileCount} 个文件已更改
                  {diffStatsAvailable ? (
                    <span
                      aria-hidden="true"
                      className="composer-change-summary__diff tw:inline-flex tw:flex-none tw:items-center tw:gap-1 tw:tabular-nums"
                    >
                      <strong className="tw:text-app-success tw:type-weight-label">
                        +{formattedAdditions}
                      </strong>
                      <em className="tw:text-app-danger tw:not-italic">-{formattedDeletions}</em>
                    </span>
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent
                  align="center"
                  aria-label="修改文件"
                  className="composer-change-summary__files-popover tw:z-tooltip tw:box-border tw:w-max tw:min-w-[min(16rem,calc(100vw-var(--cpx-sys-space-4)))] tw:max-w-[min(22rem,calc(100vw-var(--cpx-sys-space-4)))] tw:overflow-hidden tw:rounded-xl tw:border tw:border-app-border-subtle tw:bg-app-raised tw:text-app-text tw:shadow-lg tw:backdrop-blur-md"
                  id={filesPanelId}
                  ref={filesPopoverRef}
                  side="top"
                  sideOffset={8}
                  variant="unstyled"
                  onBlurCapture={(e) => {
                    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) {
                      return
                    }
                    setActivePreview(null)
                  }}
                >
                  <div
                    className="composer-change-summary__files-list tw:grid tw:w-full tw:max-h-[min(18rem,calc(100vh-var(--cpx-sys-space-8)))] tw:gap-1 tw:overflow-y-auto tw:[scrollbar-gutter:stable] tw:p-1.5 tw:[&>[role=listitem]]:w-full tw:[&>[role=listitem]]:min-w-0"
                    role="list"
                  >
                    {changedFiles.map((file) => {
                      const statsAvailable = file.additions !== null && file.deletions !== null
                      const fileName = basenameOf(file.path)
                      return (
                        <div key={file.path} role="listitem">
                          <button
                            aria-label={
                              statsAvailable
                                ? `${file.path}，新增 ${file.additions} 行，删除 ${file.deletions} 行`
                                : `${file.path}，增删行数统计暂不可用`
                            }
                            className="composer-change-summary__file-row"
                            title={file.path}
                            type="button"
                            onClick={() => openReviewFile(file.path)}
                          >
                            <span className="composer-change-summary__file-name tw:flex-[1_1_auto] tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-start">
                              {fileName}
                            </span>
                            {statsAvailable ? (
                              <span
                                aria-hidden="true"
                                className="composer-change-summary__file-diff tw:inline-flex tw:flex-none tw:ms-auto tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption tw:tabular-nums"
                              >
                                <strong className="tw:text-app-success tw:type-weight-label">
                                  +{formatSummaryNumber(file.additions ?? 0)}
                                </strong>
                                <em className="tw:text-app-danger tw:not-italic">
                                  -{formatSummaryNumber(file.deletions ?? 0)}
                                </em>
                              </span>
                            ) : null}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </TooltipContent>
              </TooltipPortal>
            </TooltipRoot>
          ) : null}
        </div>
      </motion.div>
      <AnimatePresence initial={false}>
        {canReturnToBottom ? (
          <ComposerReturnToBottomPresence
            key="return-to-bottom"
            onReturnToBottom={onReturnToBottom}
            reducedMotion={reducedMotion}
            running={running}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function EllipsisAnimationIcon({
  className,
  size = APP_ICON_SIZE,
  strokeWidth = APP_ICON_STROKE_WIDTH,
}: {
  className?: string
  size?: number
  strokeWidth?: number
}): React.ReactNode {
  return (
    <Ellipsis
      aria-hidden="true"
      className={
        className
          ? `composer-change-summary__ellipsis composer-change-summary__animation-icon ${className}`
          : 'composer-change-summary__ellipsis composer-change-summary__animation-icon'
      }
      size={size}
      strokeWidth={strokeWidth}
    />
  )
}

function ComposerReturnToBottomPresence({
  onReturnToBottom,
  reducedMotion,
  running,
}: {
  onReturnToBottom: () => void
  reducedMotion: boolean
  running: boolean
}): React.ReactNode {
  const isPresent = useIsPresent()
  const [entryComplete, setEntryComplete] = React.useState(reducedMotion)
  const presenceRef = React.useRef<HTMLDivElement | null>(null)
  const interactive = isPresent && entryComplete

  React.useLayoutEffect(() => {
    if (isPresent) return
    setEntryComplete(false)
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && presenceRef.current?.contains(activeElement)) {
      activeElement.blur()
    }
  }, [isPresent])

  React.useEffect(() => {
    if (reducedMotion && isPresent) setEntryComplete(true)
  }, [isPresent, reducedMotion])

  return (
    <motion.div
      ref={presenceRef}
      animate={{ opacity: 1, scale: 1 }}
      aria-hidden={!interactive ? true : undefined}
      className="composer-change-summary__return-presence tw:flex tw:h-8 tw:w-8 tw:min-w-8 tw:flex-[0_0_32px] tw:items-center tw:justify-center tw:origin-center"
      exit={{
        opacity: 0,
        scale: 0.72,
        transition: motionTransition(reducedMotion, fastTween),
      }}
      inert={!interactive ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.72 }}
      onAnimationComplete={() => {
        if (isPresent) setEntryComplete(true)
      }}
      transition={
        reducedMotion
          ? instantTween
          : {
              ...standardTween,
              delay: RETURN_BUTTON_ENTER_DELAY_SECONDS,
            }
      }
    >
      <button
        aria-label="回到底部"
        className="composer-change-summary__return"
        data-running={running || undefined}
        onClick={onReturnToBottom}
        title="回到底部"
        type="button"
      >
        {running ? (
          <EllipsisAnimationIcon />
        ) : null}
        <ArrowDown
          aria-hidden="true"
          className="composer-change-summary__down-arrow"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      </button>
    </motion.div>
  )
}

export function findLatestExecutionPlan(
  turns: readonly {
    executionPlanItems: readonly ExecutionPlanItem[]
  }[],
): ExecutionPlanItem | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const executionPlan = turns[index]?.executionPlanItems.at(-1)
    if (executionPlan) return executionPlan
  }
  return null
}

export function executionPlanStepPosition(item: ExecutionPlanItem): number {
  const total = item.steps.length
  if (total === 0) return 0

  const inProgressIndex = item.steps.findIndex((step) => step.status === 'in_progress')
  if (inProgressIndex >= 0) return inProgressIndex + 1

  const unfinishedIndex = item.steps.findIndex((step) => step.status !== 'completed')
  if (unfinishedIndex >= 0) return unfinishedIndex + 1

  return total
}

function ExecutionPlanStatusIcon({
  steps,
  status,
}: {
  steps: ExecutionPlanItem['steps']
  status: ComposerPlanLifecycle
}): React.ReactNode {
  const totalSteps = steps.length
  const completedSteps =
    status === 'completed' ? totalSteps : steps.filter((step) => step.status === 'completed').length
  const progress = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 10_000) / 100
  const lifecycleLabel =
    status === 'failed'
      ? '执行计划出错'
      : status === 'streaming'
        ? '执行计划进行中'
        : status === 'completed'
          ? '执行计划已完成'
          : '执行计划已中断'

  return (
    <span
      aria-label={`${lifecycleLabel}，已完成 ${completedSteps} / ${totalSteps} 步`}
      className={`composer-change-summary__plan-icon tw:inline-flex tw:flex-none tw:items-center${
        status === 'failed'
          ? ' composer-change-summary__plan-icon--error tw:text-app-danger'
          : status === 'streaming'
            ? ' composer-change-summary__plan-icon--running tw:text-app-accent-fg'
            : status === 'completed'
              ? ' composer-change-summary__plan-icon--completed tw:text-app-success'
              : ' tw:text-app-accent-fg'
      }`}
      data-progress={status === 'failed' ? undefined : progress}
      role="img"
    >
      {status === 'failed' ? (
        <CircleX aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      ) : status === 'completed' ? (
        <Check aria-hidden="true" size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
      ) : (
        <svg
          aria-hidden="true"
          className="composer-change-summary__plan-progress-ring tw:block tw:-rotate-90 tw:overflow-visible"
          height={APP_ICON_SIZE}
          viewBox="0 0 20 20"
          width={APP_ICON_SIZE}
        >
          <circle
            className="composer-change-summary__plan-progress-track tw:stroke-app-border-subtle"
            cx="10"
            cy="10"
            fill="none"
            pathLength="100"
            r="8"
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
          <circle
            className="composer-change-summary__plan-progress-value tw:stroke-current tw:transition-[stroke-dashoffset] tw:duration-enter tw:ease-standard tw:[stroke-linecap:round]"
            cx="10"
            cy="10"
            fill="none"
            pathLength="100"
            r="8"
            strokeDasharray="100"
            strokeDashoffset={100 - progress}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </svg>
      )}
    </span>
  )
}

function formatSummaryNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function basenameOf(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}
