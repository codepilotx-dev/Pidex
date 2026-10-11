import React from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Download, Maximize2, PanelRight } from 'lucide-react'
import type { StructuredPlan } from '@pidex/shared/thread'
import { APP_ICON_STROKE_WIDTH, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { MarkdownMessage } from '../../markdown/index.js'
import {
  createKeyedDisclosureStore,
  useDisclosureExpanded,
} from '../../../components/ui/KeyedDisclosureStore.js'
import { usePlanDocumentActions } from './PlanDocumentActions.js'

export const planDisclosureStore = createKeyedDisclosureStore({ initialExpandedKeys: [] })

const WORKFLOW_PLAN_DOCK_BUTTON_CLASS =
  'workflow-plan-card__dock tw:inline-flex tw:size-6 tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:text-app-text-meta tw:cursor-pointer tw:transition-[background,color] tw:duration-feedback tw:ease-out tw:hover:bg-app-hover tw:hover:text-app-text'

export function usePlanExpanded(
  threadId: string | undefined,
  eventId: string,
): [boolean, (expanded: boolean) => void] {
  const key = `${threadId ?? 'default'}:${eventId}`
  const expanded = useDisclosureExpanded(planDisclosureStore, key)
  const setExpanded = React.useCallback(
    (next: boolean) => {
      planDisclosureStore.setExpanded(key, next)
    },
    [key],
  )
  return [expanded, setExpanded]
}

export type OpenPlanInDockRequest = {
  eventId: string
  title: string
  content: string
  /**
   * 计划是否已生成完成。右栏计划 tab 的内容是打开瞬间的快照，因此流式期间
   * 打开会冻结半成品；打开入口必须据此拒绝，而不是只隐藏按钮。
   */
  openable: boolean
}

/**
 * 构造右栏打开请求。`openable` 只在计划生成完成后为真：右栏 tab 的内容是打开
 * 瞬间的快照，流式期间打开会冻结半成品。打开入口据此拒绝，而不是只隐藏按钮。
 */
export function createPlanDockRequest(input: {
  eventId: string
  title: string
  content: string
  streaming: boolean
}): OpenPlanInDockRequest {
  return {
    eventId: input.eventId,
    title: input.title,
    content: input.content,
    openable: !input.streaming,
  }
}

export function WorkflowPlanCard({
  eventId,
  summary,
  structured,
  streaming,
  isDocked,
  onOpenInRightDock,
  threadId,
}: {
  eventId: string
  summary: string
  structured?: StructuredPlan
  streaming: boolean
  isDocked: boolean
  onOpenInRightDock: (plan: OpenPlanInDockRequest) => void
  threadId?: string
}): React.ReactNode {
  const title = structured?.title ?? planTitleFromSummary(summary)
  const presentation = planCardPresentation({ streaming, isDocked })
  const plan = createPlanDockRequest({ eventId, title, content: summary, streaming })
  const [expanded, setExpanded] = usePlanExpanded(threadId, eventId)
  const { copied, copy: handleCopy, exportMarkdown: handleExport } = usePlanDocumentActions(summary)

  if (presentation.compact) {
    return (
      <article className="workflow-plan-card workflow-plan-card--compact tw:flex tw:w-full tw:min-w-0 tw:max-w-none tw:flex-col tw:gap-0 tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-underlay tw:p-0 tw:text-app-text tw:type-body tw:shadow-none">
        <button
          className="workflow-plan-card__compact-button tw:grid tw:w-full tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:px-4 tw:py-4 tw:text-left tw:text-app-text tw:cursor-pointer tw:hover:bg-app-hover"
          type="button"
          onClick={() => onOpenInRightDock(plan)}
        >
          <span className="workflow-plan-card__label tw:text-app-text-meta tw:type-label">
            {presentation.label}
          </span>
          <span className="workflow-plan-card__compact-title tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:type-row-title">
            {title}
          </span>
          <PanelRight size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </button>
      </article>
    )
  }

  return (
    <article
      className="workflow-plan-card tw:relative tw:flex tw:w-full tw:min-w-0 tw:max-w-none tw:flex-col tw:gap-3 tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-underlay tw:p-4 tw:text-app-text tw:type-body tw:shadow-none tw:animate-[workflow-item-in_var(--cpx-sys-motion-enter)_var(--cpx-sys-ease-out)]"
      data-expanded={expanded ? 'true' : 'false'}
    >
      <header className="workflow-plan-card__header tw:flex tw:items-center tw:justify-between tw:gap-3">
        <span className="workflow-plan-card__label tw:text-app-text-meta tw:type-label">
          {presentation.label}
        </span>
        <div className="workflow-plan-card__actions tw:inline-flex tw:flex-none tw:items-center tw:gap-1">
          {!streaming ? (
            <>
              <button
                aria-label={copied ? '已复制计划' : '复制计划'}
                className={WORKFLOW_PLAN_DOCK_BUTTON_CLASS}
                title={copied ? '已复制' : '复制计划'}
                type="button"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                ) : (
                  <Copy size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                )}
              </button>
              <button
                aria-label="导出计划 (PLAN.md)"
                className={WORKFLOW_PLAN_DOCK_BUTTON_CLASS}
                title="导出计划 (PLAN.md)"
                type="button"
                onClick={handleExport}
              >
                <Download size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </button>
            </>
          ) : null}
          {presentation.showOpenInRightDock ? (
            <button
              aria-label="在右侧打开计划"
              className={WORKFLOW_PLAN_DOCK_BUTTON_CLASS}
              title="在右侧打开计划"
              type="button"
              onClick={() => onOpenInRightDock(plan)}
            >
              <Maximize2 size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          ) : null}
        </div>
      </header>

      <h2 className="workflow-plan-card__title tw:m-0 tw:text-app-text tw:type-body-lg">{title}</h2>

      <div
        className="workflow-plan-card__body tw:relative tw:max-h-80 tw:overflow-hidden tw:[&_.md-body]:text-app-text tw:[&_.md-body_h1:first-child]:hidden tw:[&_.md-body_code:not(pre_code)]:border tw:[&_.md-body_code:not(pre_code)]:border-app-border tw:[&_.md-body_code:not(pre_code)]:bg-app-editor tw:[&_.md-body_code:not(pre_code)]:text-app-text tw:data-[expanded=true]:max-h-none tw:data-[expanded=true]:overflow-visible"
        data-expanded={expanded ? 'true' : 'false'}
      >
        {structured ? <StructuredPlanView plan={structured} /> : <MarkdownMessage text={summary} />}
      </div>

      {!streaming ? (
        <div className="workflow-plan-card__footer tw:flex tw:justify-center tw:pt-2">
          <button
            className="workflow-plan-card__expand-button tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-pill tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:text-app-text-soft tw:type-label tw:cursor-pointer tw:transition-[background,color] tw:duration-state tw:ease-out tw:hover:bg-app-hover tw:hover:text-app-text"
            type="button"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                <span>收起计划</span>
              </>
            ) : (
              <>
                <ChevronDown size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                <span>展开计划</span>
              </>
            )}
          </button>
        </div>
      ) : null}
    </article>
  )
}

/**
 * 结构化计划的唯一展示实现：按固定语义顺序渲染摘要、按 area 分组的实现项、
 * 接口变化、测试和假设；空的可选章节不渲染。Markdown 只作为历史与兼容回退。
 */
export function StructuredPlanView({ plan }: { plan: StructuredPlan }): React.ReactNode {
  return (
    <div className="workflow-plan-structured tw:flex tw:flex-col tw:gap-3 tw:text-app-text tw:type-reading">
      <p className="workflow-plan-structured__summary tw:m-0 tw:text-app-text-soft">
        {plan.summary}
      </p>
      <StructuredPlanSection title="实现变更">
        {plan.changes.map((change, index) => (
          <div
            className="workflow-plan-structured__change tw:flex tw:flex-col tw:gap-1"
            key={`${change.area}:${index}`}
          >
            <h4 className="workflow-plan-structured__area tw:m-0 tw:text-app-text tw:type-row-title">
              {change.area}
            </h4>
            <ul className="workflow-plan-structured__list tw:m-0 tw:flex tw:flex-col tw:gap-1 tw:pl-4">
              {change.items.map((item, itemIndex) => (
                <li className="tw:wrap-anywhere" key={`${item}:${itemIndex}`}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </StructuredPlanSection>
      <StructuredPlanListSection title="接口变化" items={plan.interfaceChanges} />
      <StructuredPlanListSection title="测试" items={plan.tests} />
      <StructuredPlanListSection title="假设" items={plan.assumptions} />
    </div>
  )
}

function StructuredPlanListSection({
  title,
  items,
}: {
  title: string
  items: readonly string[]
}): React.ReactNode {
  if (items.length === 0) return null
  return (
    <StructuredPlanSection title={title}>
      <ul className="workflow-plan-structured__list tw:m-0 tw:flex tw:flex-col tw:gap-1 tw:pl-4">
        {items.map((item, index) => (
          <li className="tw:wrap-anywhere" key={`${item}:${index}`}>
            {item}
          </li>
        ))}
      </ul>
    </StructuredPlanSection>
  )
}

function StructuredPlanSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <section className="workflow-plan-structured__section tw:flex tw:flex-col tw:gap-2">
      <h3 className="workflow-plan-structured__heading tw:m-0 tw:text-app-text-meta tw:type-label tw:normal-case">
        {title}
      </h3>
      {children}
    </section>
  )
}

export function planTitleFromSummary(summary: string): string {
  const heading = summary.match(/^\s*#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  const proposedTitle = summary.match(/^\s*title:\s*(.+)$/im)?.[1]?.trim()
  return proposedTitle || '计划书'
}

export function planCardPresentation({
  streaming,
  isDocked,
}: {
  streaming: boolean
  isDocked: boolean
}): {
  compact: boolean
  label: string
  showOpenInRightDock: boolean
  showFoldControls: boolean
} {
  return {
    compact: isDocked,
    label: streaming ? '编写计划' : '计划',
    showOpenInRightDock: !streaming,
    showFoldControls: !streaming,
  }
}
