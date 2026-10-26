import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import React from 'react'
import { Circle, CircleCheck, LoaderCircle } from 'lucide-react'
import type { Item } from '@pidex/shared/thread'
import { useScrollEdgeState } from '../../../hooks/UseScrollEdgeState.js'

type ExecutionPlanItem = Extract<Item, { type: 'execution-plan' }>
type ExecutionPlanStep = ExecutionPlanItem['steps'][number]

/**
 * The preview panel positions the card relative to its own marker, so the
 * placement that used to come from
 * `.composer-change-summary__plan-preview .execution-plan-card` lives on the
 * card itself: it is the only mount point for this component.
 */
const EXECUTION_PLAN_CARD_CLASS =
  'execution-plan-card tw:absolute tw:z-0 tw:bottom-[calc(100%+var(--cpx-sys-space-2))] tw:left-1/2 tw:w-max tw:max-w-[min(20rem,100%)] tw:-translate-x-1/2 tw:overflow-hidden tw:rounded-none tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-2 tw:text-app-text tw:shadow-none tw:pointer-events-none tw:[backdrop-filter:none]'

export function ExecutionPlanCard({ item }: { item: ExecutionPlanItem }): React.ReactNode {
  const stepsScrollerRef = React.useRef<HTMLDivElement | null>(null)
  const stepsRef = React.useRef<HTMLOListElement | null>(null)
  const edge = useScrollEdgeState(stepsScrollerRef, {
    contentRef: stepsRef,
    version: item.steps,
  })

  return (
    <article aria-label="执行计划" className={EXECUTION_PLAN_CARD_CLASS} data-status={item.status}>
      <div
        className="execution-plan-card__edge-fade tw:[--edge-fade-distance:2rem] tw:[--edge-fade-fill:var(--cpx-sys-glass-bg)]"
        data-at-end={edge.atEnd}
        data-at-start={edge.atStart}
        data-scrollable={edge.scrollable}
      >
        <div
          className="execution-plan-card__steps-scroller tw:max-h-80 tw:overflow-y-auto tw:[scrollbar-gutter:stable]"
          ref={stepsScrollerRef}
        >
          <ol
            className="execution-plan-card__steps tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0"
            ref={stepsRef}
          >
            {item.steps.map((step, index) => (
              <ExecutionPlanStepView index={index} key={`${index}:${step.step}`} step={step} />
            ))}
          </ol>
        </div>
      </div>
    </article>
  )
}

function ExecutionPlanStepView({
  index,
  step,
}: {
  index: number
  step: ExecutionPlanStep
}): React.ReactNode {
  const label =
    step.status === 'completed' ? '已完成' : step.status === 'in_progress' ? '进行中' : '待处理'

  return (
    <li
      aria-label={`第 ${index + 1} 步，${step.step}，${label}`}
      className="tw:grid tw:min-h-4 tw:grid-cols-[var(--cpx-sys-space-4)_minmax(0,1fr)] tw:items-start tw:gap-2 tw:text-app-text-meta tw:[line-height:var(--cpx-sys-line-height-tight)]"
      data-status={step.status}
    >
      <span
        className={
          step.status === 'in_progress'
            ? 'execution-plan-card__step-icon tw:mt-1 tw:inline-flex tw:items-center tw:justify-center tw:text-app-focus tw:[&>svg]:size-[var(--inline-icon-size,1em)]'
            : 'execution-plan-card__step-icon tw:mt-1 tw:inline-flex tw:items-center tw:justify-center tw:text-app-text-meta tw:[&>svg]:size-[var(--inline-icon-size,1em)]'
        }
        aria-hidden="true"
      >
        {step.status === 'completed' ? (
          <CircleCheck size={APP_ICON_SIZES.sm} />
        ) : step.status === 'in_progress' ? (
          <LoaderCircle size={APP_ICON_SIZES.sm} className="canonical-spin" />
        ) : (
          <Circle size={APP_ICON_SIZES.sm} />
        )}
      </span>
      <span
        className={
          step.status === 'completed'
            ? 'execution-plan-card__step-text tw:min-w-0 tw:wrap-anywhere tw:line-through tw:decoration-1'
            : step.status === 'in_progress'
              ? 'execution-plan-card__step-text tw:min-w-0 tw:wrap-anywhere tw:text-app-text'
              : 'execution-plan-card__step-text tw:min-w-0 tw:wrap-anywhere'
        }
      >
        {step.step}
      </span>
    </li>
  )
}
